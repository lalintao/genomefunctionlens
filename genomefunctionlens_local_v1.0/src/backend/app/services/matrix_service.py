from dataclasses import dataclass
from collections import OrderedDict
from pathlib import Path

import pandas as pd
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.services.tree_runtime_service import TreeRuntimeService


@dataclass(frozen=True)
class MatrixDescriptor:
    matrix_kind: str
    genome_database: str
    annotation_type: str
    matrix_path: str
    matrix_format: str
    row_count: int
    column_count: int
    value_type: str


class MatrixService:
    _descriptor_cache: dict[tuple[str, str, str], MatrixDescriptor] = {}
    _schema_cache: dict[Path, list[str]] = {}
    _frame_cache: OrderedDict[tuple[Path, tuple[str, ...]], pd.DataFrame] = OrderedDict()
    _frame_cache_bytes = 0
    _FRAME_CACHE_MAX_ITEMS = 8
    _FRAME_CACHE_MAX_BYTES = 64 * 1024 * 1024

    def __init__(self, db: Session):
        self.db = db
        self.settings = get_settings()
        self.tree_runtime = TreeRuntimeService(db)

    def load_annotation_frame(
        self,
        species_tree: str,
        genome_database: str,
        annotation_type: str,
        annotation_values: list[str],
    ) -> pd.DataFrame:
        normalized_values = self._normalize_values(annotation_values)
        if not normalized_values:
            return pd.DataFrame()

        descriptor = self._get_descriptor("annotation", genome_database, annotation_type)
        return self._load_frame(
            descriptor,
            normalized_values,
            species_tree,
            genome_database,
            row_order=None,
        )

    def load_module_completeness_frame(
        self,
        species_tree: str,
        genome_database: str,
        module_ids: list[str],
    ) -> pd.DataFrame:
        normalized_values = self._normalize_values(module_ids)
        if not normalized_values:
            return pd.DataFrame()

        descriptor = self._find_descriptor("module_completeness", genome_database, "module")
        if descriptor is None:
            return pd.DataFrame(
                {
                    module_id: pd.Series([0.0] * self._genome_row_count(species_tree, genome_database))
                    for module_id in normalized_values
                }
            )

        frame = self._load_frame(
            descriptor,
            normalized_values,
            species_tree,
            genome_database,
            row_order=None,
        )
        numeric = frame.apply(pd.to_numeric, errors="coerce").fillna(0).clip(lower=0, upper=100)
        return numeric[normalized_values]

    def resolve_path(self, relative_path: str) -> Path:
        path = (self.settings.project_data_root / relative_path).resolve()
        root = self.settings.project_data_root.resolve()
        if root != path and root not in path.parents:
            raise HTTPException(status_code=400, detail="Resolved path is outside project_data_root")
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"Matrix file not found: {relative_path}")
        return path

    def _load_frame(
        self,
        descriptor: MatrixDescriptor,
        requested_values: list[str],
        species_tree: str,
        genome_database: str,
        *,
        row_order: list[int] | None,
    ) -> pd.DataFrame:
        expected_row_count = self._genome_row_count(species_tree, genome_database)
        if descriptor.row_count and descriptor.row_count != expected_row_count:
            raise HTTPException(status_code=500, detail="Matrix row count does not match tree dataset metadata")

        parquet_path = self.resolve_path(descriptor.matrix_path)
        available_columns = set(self._schema_columns(parquet_path))
        requested_columns = [value for value in requested_values if value in available_columns]

        cache_key = (parquet_path, tuple(requested_values)) if row_order is None else None
        if cache_key is not None:
            cached = self._frame_cache.get(cache_key)
            if cached is not None:
                self._frame_cache.move_to_end(cache_key)
                return cached.copy(deep=False)

        if requested_columns:
            try:
                frame = pd.read_parquet(parquet_path, columns=requested_columns)
            except Exception as exc:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to read matrix file {descriptor.matrix_path}: {exc}",
                ) from exc
            if len(frame.index) != expected_row_count:
                raise HTTPException(
                    status_code=500,
                    detail=f"Matrix row count does not match runtime row order: {descriptor.matrix_path}",
                )
        else:
            frame = pd.DataFrame(index=range(expected_row_count))

        if row_order is not None:
            frame = frame.iloc[row_order].reset_index(drop=True)

        missing_columns = [value for value in requested_values if value not in frame.columns]
        for column_name in missing_columns:
            frame[column_name] = 0

        result = frame[requested_values]
        if cache_key is not None:
            self._cache_frame(cache_key, result)
        return result.copy(deep=False)

    @classmethod
    def _cache_frame(cls, key: tuple[Path, tuple[str, ...]], frame: pd.DataFrame) -> None:
        global_bytes = int(frame.memory_usage(index=True, deep=True).sum())
        previous = cls._frame_cache.pop(key, None)
        if previous is not None:
            cls._frame_cache_bytes -= int(previous.memory_usage(index=True, deep=True).sum())
        if global_bytes > cls._FRAME_CACHE_MAX_BYTES:
            return
        cls._frame_cache[key] = frame
        cls._frame_cache_bytes += global_bytes
        while cls._frame_cache and (
            len(cls._frame_cache) > cls._FRAME_CACHE_MAX_ITEMS
            or cls._frame_cache_bytes > cls._FRAME_CACHE_MAX_BYTES
        ):
            _, evicted = cls._frame_cache.popitem(last=False)
            cls._frame_cache_bytes -= int(evicted.memory_usage(index=True, deep=True).sum())

    def _schema_columns(self, parquet_path: Path) -> list[str]:
        cached = self._schema_cache.get(parquet_path)
        if cached is not None:
            return cached

        try:
            import pyarrow.parquet as pq
        except ModuleNotFoundError as exc:
            raise HTTPException(status_code=500, detail="pyarrow is required to read parquet matrix files") from exc

        columns = list(pq.read_schema(parquet_path).names)
        self._schema_cache[parquet_path] = columns
        return columns

    def _genome_row_count(self, species_tree: str, genome_database: str) -> int:
        runtime = self.tree_runtime.get_runtime(species_tree, genome_database)
        return len(runtime.leaf_node_by_genome_id)

    def _get_descriptor(
        self,
        matrix_kind: str,
        genome_database: str,
        annotation_type: str,
    ) -> MatrixDescriptor:
        descriptor = self._find_descriptor(matrix_kind, genome_database, annotation_type)
        if descriptor is None:
            raise HTTPException(
                status_code=404,
                detail=(
                    "Matrix file not found for "
                    f"matrix_kind={matrix_kind}, genome_database={genome_database}, "
                    f"annotation_type={annotation_type}"
                ),
            )
        return descriptor

    def _find_descriptor(
        self,
        matrix_kind: str,
        genome_database: str,
        annotation_type: str,
    ) -> MatrixDescriptor | None:
        cache_key = (
            matrix_kind.strip().lower(),
            genome_database.strip(),
            annotation_type.strip().lower(),
        )
        cached = self._descriptor_cache.get(cache_key)
        if cached is not None:
            return cached

        row = self.db.execute(
            text(
                """
                select
                    matrix_kind,
                    genome_database,
                    annotation_type,
                    matrix_path,
                    matrix_format,
                    row_count,
                    column_count,
                    value_type
                from matrix_file
                where matrix_kind = :matrix_kind
                  and genome_database = :genome_database
                  and annotation_type = :annotation_type
                limit 1
                """
            ),
            {
                "matrix_kind": cache_key[0],
                "genome_database": cache_key[1],
                "annotation_type": cache_key[2],
            },
        ).mappings().first()
        if row is None:
            return None

        descriptor = MatrixDescriptor(
            matrix_kind=str(row["matrix_kind"]),
            genome_database=str(row["genome_database"]),
            annotation_type=str(row["annotation_type"]),
            matrix_path=str(row["matrix_path"]),
            matrix_format=str(row["matrix_format"]),
            row_count=int(row["row_count"]),
            column_count=int(row["column_count"]),
            value_type=str(row["value_type"]),
        )
        self._descriptor_cache[cache_key] = descriptor
        return descriptor

    def _normalize_values(self, values: list[str]) -> list[str]:
        return list(dict.fromkeys(value.strip() for value in values if value.strip()))
