from __future__ import annotations

import shutil
from dataclasses import asdict
from pathlib import Path

from .config import PipelineConfig
from .inputs import (
    discover_annotation_name_files,
    discover_genome_databases,
    discover_module_source_input,
    discover_species_tree_inputs,
    validate_required_inputs,
)
from .runtime_package import build_runtime_packages


def run_pipeline(config: PipelineConfig) -> dict[str, object]:
    # Validate all build inputs before touching the existing output. A failed
    # preflight must never delete a previously good project_data package.
    genome_databases = discover_genome_databases(config.protein_anno_dir)
    species_tree_inputs = discover_species_tree_inputs(config.species_tree_dir, genome_databases)
    annotation_name_files = discover_annotation_name_files(config.protein_anno_dir)
    module_source_input = discover_module_source_input(config.module_source_dir)

    errors = validate_required_inputs(
        config.protein_anno_dir,
        config.species_tree_dir,
        genome_databases,
        species_tree_inputs,
        module_source_input,
    )
    if errors:
        raise FileNotFoundError("\n".join(errors))
    if module_source_input is None:
        raise FileNotFoundError(f"KEGG Module source directory not found: {config.module_source_dir}")

    _validate_output_target(config)
    if config.output_root.exists():
        if config.force:
            shutil.rmtree(config.output_root)
        elif any(config.output_root.iterdir()):
            raise FileExistsError(
                "Output root is not empty. Re-run with --force to replace it, "
                f"or choose a new --output-root: {config.output_root}"
            )
    config.output_root.mkdir(parents=True, exist_ok=True)
    config.temporary_root.mkdir(parents=True, exist_ok=True)

    result = build_runtime_packages(
        output_root=config.output_root,
        species_tree_inputs=species_tree_inputs,
        genome_databases=genome_databases,
        annotation_name_files=annotation_name_files,
        module_source_input=module_source_input,
        module_completeness_dir=config.module_completeness_dir,
        temporary_root=config.temporary_root,
        workers=config.workers,
        annotation_chunk_rows=config.annotation_chunk_rows,
    )
    _copy_runtime_document(config.output_root, result)
    result["config"] = _config_to_json(config)
    return result


def _validate_output_target(config: PipelineConfig) -> None:
    workspace = config.workspace.resolve()
    output_root = config.output_root.resolve()
    temporary_root = config.temporary_root.resolve()

    if output_root == temporary_root:
        raise ValueError(f"output-root and temp-root must be different: {output_root}")
    if not config.force:
        return

    protected_paths = {workspace, *workspace.parents}
    if output_root in protected_paths:
        raise ValueError(
            "--force refuses to delete the workspace root or one of its ancestors: "
            f"{output_root}"
        )


def _copy_runtime_document(output_root: Path, result: dict[str, object]) -> None:
    runtime_doc_source = Path(__file__).resolve().parents[1] / "docs" / "数据库4.0运行期数据库说明.md"
    if not runtime_doc_source.exists():
        return

    package_roots = {
        Path(str(package["package_root"])).resolve()
        for package in result.get("packages", [])
        if isinstance(package, dict) and package.get("package_root")
    }
    if not package_roots:
        package_roots = {output_root.resolve()}
    for package_root in sorted(package_roots):
        if package_root.is_dir():
            shutil.copyfile(runtime_doc_source, package_root / runtime_doc_source.name)


def _config_to_json(config: PipelineConfig) -> dict[str, object]:
    data = asdict(config)
    return {key: str(value) if hasattr(value, "as_posix") else value for key, value in data.items()}
