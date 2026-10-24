from dataclasses import dataclass

import numpy as np
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.schemas.common import AnnotationQuery
from app.schemas.heatmap import (
    HeatmapAggregateRequest,
    HeatmapAggregateResponse,
    HeatmapColumn,
)
from app.services.annotation_service import AnnotationService
from app.services.matrix_service import MatrixService
from app.services.module_service import ModuleService
from app.services.tree_runtime_service import TreeRuntimeService


@dataclass
class _GroupedColumnRequest:
    values: list[str]
    value_indexes: dict[str, int]
    positions: list[tuple[int, int]]


@dataclass(frozen=True)
class _ResolvedHeatmapColumn:
    annotation_id: int | None
    type: str
    value: str
    label: str
    short_name: str | None
    full_name: str | None
    source: str | None
    source_version: str | None


class HeatmapAggregateService:
    SUPPORTED_ANNOTATION_TYPES = frozenset({"cog", "kegg", "pfam", "module"})

    def __init__(self, db: Session):
        self.db = db
        self.annotation_service = AnnotationService(db)
        self.matrix_service = MatrixService(db)
        self.module_service = ModuleService(db)
        self.tree_runtime = TreeRuntimeService(db)

    def aggregate(self, payload: HeatmapAggregateRequest) -> HeatmapAggregateResponse:
        runtime = self.tree_runtime.get_runtime(payload.species_tree, payload.genome_database)
        module_completeness_threshold = payload.module_completeness_threshold
        if module_completeness_threshold is None:
            module_completeness_threshold = 80.0
        module_completeness_threshold = max(0.0, min(100.0, float(module_completeness_threshold)))
        resolved_columns = self._resolve_requested_columns(payload.annotation_columns)
        grouped_columns: dict[str, _GroupedColumnRequest] = {}
        for position, meta in enumerate(resolved_columns):
            group = grouped_columns.get(meta.type)
            if group is None:
                group = _GroupedColumnRequest(values=[], value_indexes={}, positions=[])
                grouped_columns[meta.type] = group
            value_index = group.value_indexes.get(meta.value)
            if value_index is None:
                group.values.append(meta.value)
                value_index = len(group.values) - 1
                group.value_indexes[meta.value] = value_index
            group.positions.append((position, value_index))

        row_leaf_counts = [len(row.owned_leaf_node_ids) for row in payload.terminal_rows]
        row_genome_ids = [
            runtime.genome_id_by_leaf_node[leaf_node_id]
            for terminal_row in payload.terminal_rows
            for leaf_node_id in terminal_row.owned_leaf_node_ids
        ]
        row_membership = np.repeat(np.arange(len(payload.terminal_rows), dtype=np.intp), row_leaf_counts)
        genome_rows = np.asarray(row_genome_ids, dtype=np.intp)
        row_counts_array = np.zeros((len(payload.terminal_rows), len(resolved_columns)), dtype=np.int64)
        row_hits_array = np.zeros_like(row_counts_array)

        for annotation_type, group in grouped_columns.items():
            frame = (
                self.matrix_service.load_module_completeness_frame(
                    payload.species_tree,
                    payload.genome_database,
                    group.values,
                )
                if annotation_type == "module"
                else self.matrix_service.load_annotation_frame(
                    payload.species_tree,
                    payload.genome_database,
                    annotation_type,
                    group.values,
                )
            )
            matrix = np.asarray(frame.to_numpy(copy=False), dtype=np.float64)
            selected = matrix[genome_rows, :] if len(genome_rows) else np.empty((0, len(group.values)))
            for value_index in range(len(group.values)):
                values = selected[:, value_index] if len(selected) else np.empty(0, dtype=np.float64)
                if annotation_type == "module":
                    summed = np.bincount(
                        row_membership,
                        weights=(values >= module_completeness_threshold).astype(np.int64),
                        minlength=len(payload.terminal_rows),
                    )
                    hits = summed
                else:
                    summed = np.bincount(row_membership, weights=values, minlength=len(payload.terminal_rows))
                    hits = np.bincount(
                        row_membership,
                        weights=(values > 0).astype(np.int64),
                        minlength=len(payload.terminal_rows),
                    )
                for column_position, grouped_value_index in group.positions:
                    if grouped_value_index == value_index:
                        row_counts_array[:, column_position] = summed.astype(np.int64)
                        row_hits_array[:, column_position] = hits.astype(np.int64)

        self.db.close()
        count_matrix = row_counts_array.tolist()
        species_hit_count_matrix = row_hits_array.tolist()
        ratio_matrix = [
            [
                (int(row_hits_array[row_index, column_index]) / row_leaf_counts[row_index])
                if row_leaf_counts[row_index] else 0.0
                for column_index in range(len(resolved_columns))
            ]
            for row_index in range(len(payload.terminal_rows))
        ]

        return HeatmapAggregateResponse(
            species_tree=payload.species_tree,
            genome_database=payload.genome_database,
            row_node_ids=[row.node_id for row in payload.terminal_rows],
            columns=[
                HeatmapColumn(
                    annotation_id=meta.annotation_id,
                    type=meta.type,
                    value=meta.value,
                    label=meta.label,
                    short_name=meta.short_name,
                    full_name=meta.full_name,
                    source=meta.source,
                    source_version=meta.source_version,
                )
                for meta in resolved_columns
            ],
            count_matrix=count_matrix,
            species_hit_count_matrix=species_hit_count_matrix,
            ratio_matrix=ratio_matrix,
            row_leaf_counts=row_leaf_counts,
        )

    def _resolve_requested_columns(self, annotation_columns: list[AnnotationQuery]) -> list[_ResolvedHeatmapColumn]:
        resolved_columns: list[_ResolvedHeatmapColumn] = []
        module_ids = list(
            dict.fromkeys(
                annotation.value.strip().upper()
                for annotation in annotation_columns
                if annotation.type == "module"
            )
        )
        module_meta_by_id = {
            meta.module_id: meta
            for meta in self.module_service.get_modules(module_ids)
        } if module_ids else {}

        for annotation in annotation_columns:
            if annotation.type not in self.SUPPORTED_ANNOTATION_TYPES:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Heatmap aggregation currently supports only "
                        "cog, kegg, pfam, and module completeness columns"
                    ),
                )
            if annotation.type == "module":
                module_id = annotation.value.strip().upper()
                module_meta = module_meta_by_id.get(module_id)
                if module_meta is None:
                    raise HTTPException(status_code=404, detail=f"Module not found: {module_id}")
                resolved_columns.append(
                    _ResolvedHeatmapColumn(
                        annotation_id=None,
                        type="module",
                        value=module_meta.module_id,
                        label=module_meta.module_id,
                        short_name=module_meta.short_name,
                        full_name=module_meta.module_name,
                        source=module_meta.source,
                        source_version=module_meta.source_version,
                    )
                )
                continue

            meta = self.annotation_service.resolve_by_id(annotation.type, annotation.annotation_id, annotation.value) \
                if annotation.annotation_id is not None \
                else self.annotation_service.resolve_one(annotation.type, annotation.value)
            resolved_columns.append(
                _ResolvedHeatmapColumn(
                    annotation_id=meta.annotation_id,
                    type=meta.type,
                    value=meta.value,
                    label=meta.label,
                    short_name=meta.short_name,
                    full_name=meta.full_name,
                    source=meta.source,
                    source_version=meta.source_version,
                )
            )
        return resolved_columns
