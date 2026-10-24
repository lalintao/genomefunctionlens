import csv
import json
import shutil
import zipfile
from collections.abc import Callable, Iterator
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.schemas.download import DownloadBranch, DownloadColumn, DownloadRequest, DownloadResponse
from app.services.annotation_service import AnnotationService
from app.services.tree_runtime_service import TreeRuntimeService
from app.utils.fasta_utils import write_fasta_file


HEADER_RANKS = ["domain", "phylum", "class", "order", "family", "genus", "species"]
TAXONOMY_COLUMN_BY_RANK = {
    "domain": "domain",
    "phylum": "phylum",
    "class": "class_name",
    "order": "order_name",
    "family": "family",
    "genus": "genus",
    "species": "species",
}
DownloadProgressCallback = Callable[[int, int], None]
DownloadStageCallback = Callable[[str], None]


class DownloadService:
    def __init__(self, db: Session):
        self.db = db
        self.settings = get_settings()
        self.annotation_service = AnnotationService(db)
        self.tree_runtime = TreeRuntimeService(db)
        self._node_genome_cache: dict[tuple[str, str, int], list[dict[str, object]]] = {}
        self._taxon_name_cache: dict[str, dict[tuple[str, int], str]] = {}

    def build_download(
        self,
        payload: DownloadRequest,
        *,
        task_id: str | None = None,
        progress_callback: DownloadProgressCallback | None = None,
        stage_callback: DownloadStageCallback | None = None,
    ) -> DownloadResponse:
        task_id = task_id or create_download_task_id()
        package_root = self.settings.download_temp_root / task_id / "download_package"
        archive_path = self.settings.download_archive_root / f"{task_id}.zip"
        partial_archive_path = self.settings.download_archive_root / f"{task_id}.zip.part"

        if package_root.parent.exists():
            shutil.rmtree(package_root.parent)
        package_root.mkdir(parents=True, exist_ok=True)
        self.settings.download_archive_root.mkdir(parents=True, exist_ok=True)
        partial_archive_path.unlink(missing_ok=True)

        branches = self._resolve_branches(payload.species_tree, payload.genome_database, payload.branches)
        columns = self._resolve_columns(payload.columns)

        metadata_rows: list[dict[str, object]] = []
        generated_annotations: dict[tuple[str, int | None], tuple[Path, int]] = {}
        total_columns = len(columns)
        for completed, (column, proteins) in enumerate(
            self._iter_column_proteins(
                species_tree=payload.species_tree,
                genome_database=payload.genome_database,
                columns=columns,
                branches=branches,
                header_fields=payload.header_fields,
                representative_only=payload.download_mode == "representative",
            ),
            start=1,
        ):
            output_path = self._output_path(package_root, column)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            annotation_id = column.get("annotation_id")
            annotation_key = (
                str(column["annotation_type"]),
                int(annotation_id) if annotation_id is not None else None,
            )
            generated = generated_annotations.get(annotation_key)
            if generated is None:
                protein_count = write_fasta_file(output_path, proteins)
                generated_annotations[annotation_key] = (output_path, protein_count)
            else:
                source_path, protein_count = generated
                if source_path != output_path:
                    shutil.copyfile(source_path, output_path)
            metadata_rows.append(
                {
                    "annotation_type": column["annotation_type"],
                    "annotation_value": column["annotation_value"],
                    "annotation_label": column["annotation_label"],
                    "annotation_id": column["annotation_id"],
                    "module_id": column["module_id"],
                    "branch_count": len(branches),
                    "protein_count": protein_count,
                    "download_mode": payload.download_mode,
                    "file_path": output_path.relative_to(package_root).as_posix(),
                }
            )
            if progress_callback is not None:
                progress_callback(completed, total_columns)

        if not metadata_rows:
            raise HTTPException(status_code=400, detail="No downloadable columns were provided")

        self._write_metadata(package_root / "metadata.tsv", metadata_rows)
        (package_root / "query.json").write_text(
            json.dumps(payload.model_dump(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        try:
            if stage_callback is not None:
                stage_callback("archiving")
            with zipfile.ZipFile(
                partial_archive_path,
                mode="w",
                compression=zipfile.ZIP_DEFLATED,
                compresslevel=6,
            ) as archive:
                for path in sorted(package_root.rglob("*")):
                    if path.is_file():
                        archive.write(path, path.relative_to(package_root).as_posix())
            partial_archive_path.replace(archive_path)
        except Exception:
            partial_archive_path.unlink(missing_ok=True)
            raise
        if not archive_path.is_file():
            raise HTTPException(status_code=500, detail="Failed to create archive")

        shutil.rmtree(package_root.parent, ignore_errors=True)

        return DownloadResponse(
            download_url=f"/api/download/file/{task_id}",
            task_id=task_id,
            file_count=len(metadata_rows),
        )

    def _iter_column_proteins(
        self,
        *,
        species_tree: str,
        genome_database: str,
        columns: list[dict[str, object]],
        branches: list[dict[str, object]],
        header_fields: list[str],
        representative_only: bool,
    ) -> Iterator[tuple[dict[str, object], Iterator[dict[str, str]]]]:
        genome_ids = sorted(
            {
                genome_id
                for branch in branches
                for genome_id in branch["genome_ids"]
            }
        )
        genome_ids_json = self._encode_integer_array(genome_ids)

        for column in columns:
            annotation_id = column.get("annotation_id")
            if annotation_id is None:
                yield column, iter(())
                continue
            yield column, self._iter_proteins_for_annotation(
                species_tree=species_tree,
                genome_database=genome_database,
                annotation_type=str(column["annotation_type"]),
                annotation_id=int(annotation_id),
                genome_ids=genome_ids,
                genome_ids_json=genome_ids_json,
                branches=branches,
                header_fields=header_fields,
                representative_only=representative_only,
            )

    def _iter_proteins_for_annotation(
        self,
        *,
        species_tree: str,
        genome_database: str,
        annotation_type: str,
        annotation_id: int,
        genome_ids: list[int],
        genome_ids_json: str,
        branches: list[dict[str, object]],
        header_fields: list[str],
        representative_only: bool,
    ) -> Iterator[dict[str, str]]:
        if representative_only:
            hit_genome_ids = self._load_hit_genome_ids(
                genome_database=genome_database,
                annotation_type=annotation_type,
                annotation_id=annotation_id,
                genome_ids=genome_ids,
                genome_ids_json=genome_ids_json,
            )
            representative_genome_ids: list[int] = []
            for branch in branches:
                candidates = [
                    genome
                    for genome in branch["genomes"]
                    if int(genome["genome_id"]) in hit_genome_ids
                ]
                if not candidates:
                    continue
                representative = min(candidates, key=self._representative_sort_key)
                representative_genome_ids.append(int(representative["genome_id"]))
            for hit in self._iter_annotation_hits(
                species_tree=species_tree,
                genome_database=genome_database,
                annotation_type=annotation_type,
                annotation_id=annotation_id,
                genome_ids=representative_genome_ids,
                preserve_genome_order=True,
            ):
                yield {
                    "header": self._format_header(hit, header_fields),
                    "sequence": str(hit["sequence"] or ""),
                }
            return

        for hit in self._iter_annotation_hits(
            species_tree=species_tree,
            genome_database=genome_database,
            annotation_type=annotation_type,
            annotation_id=annotation_id,
            genome_ids=genome_ids,
            genome_ids_json=genome_ids_json,
        ):
            yield {
                "header": self._format_header(hit, header_fields),
                "sequence": str(hit["sequence"] or ""),
            }

    def _load_hit_genome_ids(
        self,
        *,
        genome_database: str,
        annotation_type: str,
        annotation_id: int,
        genome_ids: list[int],
        genome_ids_json: str | None = None,
    ) -> set[int]:
        if not genome_ids:
            return set()
        result = self.db.execute(
            text(
                """
                select distinct pa.genome_id
                from protein_annotation as pa indexed by idx_protein_annotation_lookup
                join genome as g on g.genome_id = pa.genome_id
                where pa.annotation_type = :annotation_type
                  and pa.annotation_id = :annotation_id
                  and g.genome_database = :genome_database
                  and pa.genome_id in (
                      select cast(value as integer)
                      from json_each(:genome_ids_json)
                  )
                """
            ),
            {
                "annotation_type": annotation_type,
                "annotation_id": annotation_id,
                "genome_database": genome_database,
                "genome_ids_json": genome_ids_json or self._encode_integer_array(genome_ids),
            },
        )
        return {int(genome_id) for genome_id in result.scalars()}

    def _iter_annotation_hits(
        self,
        *,
        species_tree: str,
        genome_database: str,
        annotation_type: str,
        annotation_id: int,
        genome_ids: list[int],
        genome_ids_json: str | None = None,
        preserve_genome_order: bool = False,
    ) -> Iterator[dict[str, object]]:
        if not genome_ids:
            return
        requested_genome_join = """
            join json_each(:genome_ids_json) as requested_genome
              on cast(requested_genome.value as integer) = pa.genome_id
        """ if preserve_genome_order else ""
        requested_genome_filter = "" if preserve_genome_order else """
              and pa.genome_id in (
                  select cast(value as integer)
                  from json_each(:genome_ids_json)
              )
        """
        requested_genome_order = (
            "cast(requested_genome.key as integer) asc, "
            if preserve_genome_order
            else "tn.node_in asc, "
        )
        requested_genome_select = (
            ", cast(requested_genome.key as integer) as requested_genome_order"
            if preserve_genome_order
            else ""
        )
        statement = text(
            f"""
            select distinct
                pa.protein_key,
                p.protein_id,
                p.protein_name,
                p.sequence,
                p.sequence_length,
                g.genome_id,
                g.leaf_node_id,
                g.genome_accession,
                g.species_genome_count,
                g.quality_score,
                g.contig,
                tx.domain,
                tx.phylum,
                tx.class_name,
                tx.order_name,
                tx.family,
                tx.genus,
                tx.species
                {requested_genome_select}
            from protein_annotation as pa indexed by idx_protein_annotation_lookup
            {requested_genome_join}
            join protein as p
              on p.protein_key = pa.protein_key
             and p.genome_id = pa.genome_id
            join genome as g
              on g.genome_id = pa.genome_id
            join tree_node as tn
              on tn.node_id = g.leaf_node_id
            left join taxonomy as tx
              on tx.node_id = g.leaf_node_id
            where pa.annotation_type = :annotation_type
              and pa.annotation_id = :annotation_id
              and g.genome_database = :genome_database
              {requested_genome_filter}
            order by {requested_genome_order}p.protein_name asc, p.protein_id asc
            """
        ).execution_options(
            stream_results=True,
            max_row_buffer=100,
        )
        rows = self.db.execute(
            statement,
            {
                "annotation_type": annotation_type,
                "annotation_id": annotation_id,
                "genome_database": genome_database,
                "genome_ids_json": genome_ids_json or self._encode_integer_array(genome_ids),
            },
        ).mappings()
        taxon_names = self._load_taxon_names(species_tree)
        for row in rows:
            yield self._normalize_hit_row(row, taxon_names)

    def _resolve_columns(self, columns: list[DownloadColumn]) -> list[dict[str, object]]:
        resolved: list[dict[str, object]] = []
        seen: set[tuple[str | None, str, str]] = set()
        for column in columns:
            annotation_id = column.annotation_id
            if annotation_id is None:
                annotation_id = self.annotation_service.resolve_annotation_id(
                    column.annotation_type,
                    column.annotation_value,
                )
            key = (column.module_id, column.annotation_type, column.annotation_value)
            if key in seen:
                continue
            seen.add(key)
            resolved.append(
                {
                    "column_id": column.column_id,
                    "annotation_id": annotation_id,
                    "annotation_type": column.annotation_type,
                    "annotation_value": column.annotation_value,
                    "annotation_label": column.annotation_label or column.annotation_value,
                    "module_id": column.module_id,
                    "module_name": column.module_name,
                    "step_id": column.step_id,
                    "step_label": column.step_label,
                }
            )
        return resolved

    def _resolve_branches(
        self,
        species_tree: str,
        genome_database: str,
        branches: list[DownloadBranch],
    ) -> list[dict[str, object]]:
        explicit_leaf_node_ids = sorted(
            {
                leaf_node_id
                for branch in branches
                for leaf_node_id in branch.leaf_node_ids
            }
        )
        explicit_leaf_node_genomes = self._load_genomes_for_leaf_node_ids(
            species_tree,
            genome_database,
            explicit_leaf_node_ids,
        )

        node_ids = sorted(
            {
                branch.node_id
                for branch in branches
                if branch.node_id is not None and not branch.leaf_node_ids
            }
        )
        node_genomes = self._load_genomes_for_nodes(species_tree, genome_database, node_ids)

        resolved: list[dict[str, object]] = []
        for branch in branches:
            genomes: list[dict[str, object]] = []
            if branch.leaf_node_ids:
                genomes.extend(
                    explicit_leaf_node_genomes[leaf_node_id]
                    for leaf_node_id in branch.leaf_node_ids
                    if leaf_node_id in explicit_leaf_node_genomes
                )
            elif branch.node_id is not None:
                genomes.extend(node_genomes.get(branch.node_id, []))
            if not genomes:
                continue
            resolved.append(
                {
                    "branch_id": branch.branch_id,
                    "branch_label": branch.branch_label or branch.branch_id,
                    "branch_rank": branch.branch_rank,
                    "node_id": branch.node_id,
                    "leaf_count": branch.leaf_count or len(genomes),
                    "leaf_node_ids": [int(genome["leaf_node_id"]) for genome in genomes],
                    "genomes": genomes,
                    "genome_ids": [int(genome["genome_id"]) for genome in genomes],
                }
            )
        if not resolved:
            raise HTTPException(status_code=400, detail="No valid branch scope was provided")
        return resolved

    def _load_genomes_for_nodes(
        self,
        species_tree: str,
        genome_database: str,
        node_ids: list[int],
    ) -> dict[int, list[dict[str, object]]]:
        if not node_ids:
            return {}
        runtime = self.tree_runtime.get_runtime(species_tree, genome_database)
        missing = [
            node_id
            for node_id in node_ids
            if (species_tree, genome_database, node_id) not in self._node_genome_cache
        ]
        if missing:
            required_leaf_node_ids = sorted(
                {
                    leaf_node_id
                    for node_id in missing
                    for leaf_node_id in runtime.leaf_node_ids_for_node(node_id)
                }
            )
            genomes_by_leaf_node = self._load_genomes_for_leaf_node_ids(
                species_tree,
                genome_database,
                required_leaf_node_ids,
            )
            for node_id in missing:
                ordered_leaf_node_ids = runtime.leaf_node_ids_for_node(node_id)
                self._node_genome_cache[(species_tree, genome_database, node_id)] = [
                    genomes_by_leaf_node[leaf_node_id]
                    for leaf_node_id in ordered_leaf_node_ids
                    if leaf_node_id in genomes_by_leaf_node
                ]

        return {
            node_id: list(self._node_genome_cache.get((species_tree, genome_database, node_id), []))
            for node_id in node_ids
        }

    def _load_genomes_for_leaf_node_ids(
        self,
        species_tree: str,
        genome_database: str,
        leaf_node_ids: list[int],
    ) -> dict[int, dict[str, object]]:
        if not leaf_node_ids:
            return {}

        rows = self.db.execute(
            text(
                """
                select
                    g.genome_id,
                    g.leaf_node_id,
                    g.genome_accession,
                    g.species_genome_count,
                    g.quality_score,
                    g.contig,
                    tx.domain,
                    tx.phylum,
                    tx.class_name,
                    tx.order_name,
                    tx.family,
                    tx.genus,
                    tx.species
                from genome as g indexed by idx_genome_leaf_node
                join tree_node as tn
                  on tn.node_id = g.leaf_node_id
                left join taxonomy as tx
                  on tx.node_id = g.leaf_node_id
                where g.genome_database = :genome_database
                  and g.leaf_node_id in (
                      select cast(value as integer)
                      from json_each(:leaf_node_ids_json)
                  )
                order by tn.node_in asc
                """
            ),
            {
                "genome_database": genome_database,
                "leaf_node_ids_json": self._encode_integer_array(leaf_node_ids),
            },
        ).mappings().all()

        taxon_names = self._load_taxon_names(species_tree)
        return {
            int(row["leaf_node_id"]): self._normalize_genome_row(
                row,
                taxon_names,
            )
            for row in rows
        }

    def _representative_sort_key(self, genome: dict[str, object]) -> tuple[object, ...]:
        phylum = str(genome.get("phylum") or "")
        contig = int(genome.get("contig") or 0)
        species_genome_count = int(genome.get("species_genome_count") or 0)
        quality_score = float(genome.get("quality_score") or 0.0)
        genome_id = int(genome.get("genome_id") or 0)
        if phylum in {"Asgardarchaeota", "p__Asgardarchaeota"}:
            return (
                0 if contig == 1 else 1,
                -species_genome_count,
                -quality_score,
                genome_id,
            )
        return (
            -species_genome_count,
            -quality_score,
            genome_id,
        )

    def _format_header(self, hit: dict[str, object], header_fields: list[str]) -> str:
        parts: list[str] = []
        if "protein_name" in header_fields:
            protein_name = str(hit.get("protein_name") or "").strip()
            if protein_name:
                parts.append(protein_name)
        if "genome_name" in header_fields:
            genome_name = str(hit.get("genome_accession") or "").strip()
            if genome_name:
                parts.append(f"[genome_name:{genome_name}]")
        for rank in HEADER_RANKS:
            if rank not in header_fields:
                continue
            value = str(hit.get(rank) or "").strip()
            if value:
                parts.append(f"[{rank}:{value}]")
        return "_".join(parts)

    def _output_path(self, package_root: Path, column: dict[str, object]) -> Path:
        annotation_label = self._safe_filename(str(column["annotation_label"]))
        primary_label = str(column["module_id"] or str(column["annotation_type"]).upper())
        return package_root / self._safe_filename(primary_label) / f"{annotation_label}.faa"

    def _write_metadata(self, output_path: Path, rows: list[dict[str, object]]) -> None:
        if not rows:
            return
        with output_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()), delimiter="\t")
            writer.writeheader()
            writer.writerows(rows)

    def _normalize_genome_row(
        self,
        row: dict[str, object],
        taxon_names: dict[tuple[str, int], str],
    ) -> dict[str, object]:
        return {
            "genome_id": int(row["genome_id"]),
            "leaf_node_id": int(row["leaf_node_id"]),
            "genome_accession": str(row["genome_accession"] or ""),
            "species_genome_count": int(row["species_genome_count"] or 0),
            "quality_score": float(row["quality_score"] or 0.0),
            "contig": int(row["contig"] or 0),
            "domain": self._taxonomy_name(row, "domain", taxon_names),
            "phylum": self._taxonomy_name(row, "phylum", taxon_names),
            "class": self._taxonomy_name(row, "class", taxon_names),
            "order": self._taxonomy_name(row, "order", taxon_names),
            "family": self._taxonomy_name(row, "family", taxon_names),
            "genus": self._taxonomy_name(row, "genus", taxon_names),
            "species": self._taxonomy_name(row, "species", taxon_names),
        }

    def _normalize_hit_row(
        self,
        row: dict[str, object],
        taxon_names: dict[tuple[str, int], str],
    ) -> dict[str, object]:
        return {
            "protein_key": int(row["protein_key"]),
            "protein_id": str(row["protein_id"] or ""),
            "protein_name": str(row["protein_name"] or ""),
            "sequence": str(row["sequence"] or ""),
            "sequence_length": int(row["sequence_length"] or 0),
            "genome_id": int(row["genome_id"]),
            "leaf_node_id": int(row["leaf_node_id"]),
            "genome_accession": str(row["genome_accession"] or ""),
            "species_genome_count": int(row["species_genome_count"] or 0),
            "quality_score": float(row["quality_score"] or 0.0),
            "contig": int(row["contig"] or 0),
            "domain": self._taxonomy_name(row, "domain", taxon_names),
            "phylum": self._taxonomy_name(row, "phylum", taxon_names),
            "class": self._taxonomy_name(row, "class", taxon_names),
            "order": self._taxonomy_name(row, "order", taxon_names),
            "family": self._taxonomy_name(row, "family", taxon_names),
            "genus": self._taxonomy_name(row, "genus", taxon_names),
            "species": self._taxonomy_name(row, "species", taxon_names),
        }

    def _taxonomy_name(
        self,
        row: dict[str, object],
        rank: str,
        taxon_names: dict[tuple[str, int], str],
    ) -> str:
        node_id = row.get(TAXONOMY_COLUMN_BY_RANK[rank])
        if node_id is None:
            return ""
        return taxon_names.get((rank, int(node_id)), "")

    def _load_taxon_names(self, species_tree: str) -> dict[tuple[str, int], str]:
        cache_key = species_tree.strip()
        cached = self._taxon_name_cache.get(cache_key)
        if cached is not None:
            return cached

        rows = self.db.execute(
            text(
                """
                select node_id, rank, taxon_name
                from tree_named_taxon_index
                """
            )
        ).mappings().all()
        taxon_names = {
            (str(row["rank"]), int(row["node_id"])): str(row["taxon_name"])
            for row in rows
            if row["taxon_name"] is not None
        }
        self._taxon_name_cache[cache_key] = taxon_names
        return taxon_names

    def _safe_filename(self, value: str) -> str:
        safe = "".join(char if char.isalnum() or char in "._-" else "_" for char in value).strip(" ._")
        return safe or "annotation"

    def _encode_integer_array(self, values: list[int]) -> str:
        return json.dumps(values, separators=(",", ":"))


def create_download_task_id() -> str:
    return f"task_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid4().hex[:8]}"


def cleanup_download_artifacts(task_id: str, *, settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    shutil.rmtree(settings.download_temp_root / task_id, ignore_errors=True)
    (settings.download_archive_root / f"{task_id}.zip.part").unlink(missing_ok=True)
    (settings.download_archive_root / f"{task_id}.zip").unlink(missing_ok=True)
