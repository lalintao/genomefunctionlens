from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True)
class PipelineConfig:
    workspace: Path
    output_root: Path
    temporary_root: Path
    protein_anno_dir: Path
    species_tree_dir: Path
    module_source_dir: Path
    module_completeness_dir: Path
    workers: int
    annotation_chunk_rows: int
    force: bool = False


def make_config(
    workspace: Path,
    output_root: Path | None = None,
    temporary_root: Path | None = None,
    protein_anno_dir: Path | None = None,
    species_tree_dir: Path | None = None,
    module_source_dir: Path | None = None,
    module_completeness_dir: Path | None = None,
    workers: int | None = None,
    annotation_chunk_rows: int = 250_000,
    force: bool = False,
) -> PipelineConfig:
    workspace = workspace.resolve()
    # Annotation workers each receive a copy of the protein lookup table. On
    # large datasets that table can consume several GB per process, so use a
    # conservative default and require an explicit opt-in for parallel parsing.
    default_workers = 1
    return PipelineConfig(
        workspace=workspace,
        output_root=(output_root or workspace / "project_data").resolve(),
        temporary_root=(temporary_root or workspace / "temporary_file" / "build_stage").resolve(),
        protein_anno_dir=(protein_anno_dir or workspace / "row_data" / "protein_anno").resolve(),
        species_tree_dir=(species_tree_dir or workspace / "row_data" / "GTDB_speciesTree").resolve(),
        module_source_dir=(module_source_dir or workspace / "row_data" / "module_source" / "kegg_module").resolve(),
        module_completeness_dir=(module_completeness_dir or workspace / "row_data" / "kegg_module_completeness").resolve(),
        workers=max(1, int(workers if workers is not None else default_workers)),
        annotation_chunk_rows=max(1, int(annotation_chunk_rows)),
        force=force,
    )
