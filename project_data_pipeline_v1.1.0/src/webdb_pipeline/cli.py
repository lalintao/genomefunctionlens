from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .config import make_config
from .gtdb_taxonomy_metadata import convert_gtdb_metadata_to_taxonomy_table
from .pipeline import run_pipeline
from .row_data_audit import audit_row_data
from .runtime_indexes import upgrade_runtime_indexes
from .runtime_tree_upgrade import migrate_runtime_tree_from_row_data, upgrade_runtime_package


DESCRIPTION = """Web database 4.0 command line interface.

Use this single entry point on the server:
  python run_pipeline.py <command> [options]

If <command> is omitted and options start with "--", the command is treated as
"build" for compatibility with older run_pipeline.py usage.
"""

EXAMPLES = """Examples:
  python run_pipeline.py -h
  python run_pipeline.py build -h
  python run_pipeline.py audit-row-data -h

  python run_pipeline.py audit-row-data --workspace F:\\Project\\web_database_deel --mode deep

  python run_pipeline.py build ^
    --workspace F:\\Project\\web_database_deel ^
    --output-root F:\\Project\\web_database_deel\\project_data ^
    --temp-root F:\\Project\\web_database_deel\\temporary_file\\build_stage ^
    --workers 1 ^
    --force
"""


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="run_pipeline.py",
        description=DESCRIPTION,
        epilog=EXAMPLES,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", metavar="<command>")

    build_parser = subparsers.add_parser(
        "build",
        help="Build project_data from row_data.",
        description="Build 4.0 runtime data packages for one or more species-tree datasets.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    _add_build_arguments(build_parser)
    build_parser.set_defaults(handler=_handle_build)

    audit_parser = subparsers.add_parser(
        "audit-row-data",
        aliases=["audit"],
        help="Check whether row_data is complete and internally consistent.",
        description="Audit row_data inputs before running the 4.0 build.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    _add_audit_arguments(audit_parser)
    audit_parser.set_defaults(handler=_handle_audit_row_data)

    taxonomy_parser = subparsers.add_parser(
        "make-taxonomy",
        help="Convert GTDB metadata tables into taxonomy.tsv directories.",
        description="Convert GTDB release metadata tables into taxonomy.tsv files used by this project.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    _add_make_taxonomy_arguments(taxonomy_parser)
    taxonomy_parser.set_defaults(handler=_handle_make_taxonomy)

    upgrade_parser = subparsers.add_parser(
        "upgrade-runtime-tree",
        help="Rebuild an existing runtime package with taxonomy indexes on original tree nodes.",
        description="Rebuild an existing runtime package in-place without inserting virtual taxonomy nodes.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    _add_upgrade_runtime_tree_arguments(upgrade_parser)
    upgrade_parser.set_defaults(handler=_handle_upgrade_runtime_tree)

    migrate_parser = subparsers.add_parser(
        "migrate-runtime-tree",
        help="Replace only a runtime package's tree data from complete row_data inputs.",
        description="Migrates an existing large project_data package to the original-tree, many-to-many taxon-index model without rebuilding proteins, annotations, or matrices.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    _add_migrate_runtime_tree_arguments(migrate_parser)
    migrate_parser.set_defaults(handler=_handle_migrate_runtime_tree)

    index_parser = subparsers.add_parser(
        "upgrade-runtime-indexes",
        help="Add the required indexes to an existing runtime package.",
        description="Update indexes in-place, optionally back up SQLite, and run integrity/query-plan checks.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    _add_upgrade_runtime_indexes_arguments(index_parser)
    index_parser.set_defaults(handler=_handle_upgrade_runtime_indexes)

    return parser


def _add_common_input_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--workspace",
        "--input-root",
        dest="workspace",
        type=Path,
        default=Path.cwd(),
        help="Workspace root containing row_data, project_data, src, and temporary_file.",
    )
    parser.add_argument(
        "--protein-anno-dir",
        type=Path,
        default=None,
        help="Directory containing genome database folders and annotation name files. Defaults to <workspace>/row_data/protein_anno.",
    )
    parser.add_argument(
        "--species-tree-dir",
        type=Path,
        default=None,
        help="Directory containing species-tree subdirectories and speciesTree_genomesDatabase_mapping.txt. Defaults to <workspace>/row_data/GTDB_speciesTree.",
    )
    parser.add_argument(
        "--module-source-dir",
        type=Path,
        default=None,
        help="Directory containing downloaded KEGG Module source files. Defaults to <workspace>/row_data/module_source/kegg_module.",
    )
    parser.add_argument(
        "--module-completeness-dir",
        type=Path,
        default=None,
        help="Directory containing external KEGG Module completeness_matrix.tsv. Defaults to <workspace>/row_data/kegg_module_completeness.",
    )


def _add_build_arguments(parser: argparse.ArgumentParser) -> None:
    _add_common_input_arguments(parser)
    parser.add_argument(
        "--output-root",
        type=Path,
        default=None,
        help="Output root directory. Defaults to <workspace>/project_data.",
    )
    parser.add_argument(
        "--temp-root",
        type=Path,
        default=None,
        help="Directory for temporary chunk files produced during the build. Defaults to <workspace>/temporary_file/build_stage.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=None,
        help="Max worker processes for annotation parsing. Defaults to 1 because each worker receives a copy of the protein lookup table.",
    )
    parser.add_argument(
        "--annotation-chunk-rows",
        type=int,
        default=250_000,
        help="Chunk size when streaming large annotation TSV files.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Remove output-root before rebuilding.",
    )


def _add_audit_arguments(parser: argparse.ArgumentParser) -> None:
    _add_common_input_arguments(parser)
    parser.add_argument(
        "--mode",
        choices=["fast", "deep"],
        default="fast",
        help="fast checks structure and cross-file alignment; deep also parses KEGG Module source.",
    )
    parser.add_argument(
        "--sample-limit",
        type=int,
        default=10,
        help="Maximum number of example values shown per finding.",
    )
    parser.add_argument(
        "--scan-annotation-proteins",
        action="store_true",
        help="Also scan annotation TSV protein_id values against FASTA records. This can be slow on full datasets.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the full audit report as JSON.",
    )


def _add_make_taxonomy_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "inputs",
        nargs="+",
        type=Path,
        help="One or more GTDB metadata tables, such as ar53_metadata_r232.txt or bac120_metadata_r232.txt.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        required=True,
        help="Directory where converted <tree_dir>/taxonomy.tsv files will be written.",
    )
    parser.add_argument(
        "--cluster-map",
        type=Path,
        default=None,
        help="Optional TSV containing species-cluster information for inputs that do not include gtdb_genome_representative.",
    )
    parser.add_argument(
        "--representatives-only",
        action="store_true",
        help="Keep only rows where gtdb_representative is true/t/1.",
    )


def _add_upgrade_runtime_tree_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--package-root",
        type=Path,
        required=True,
        help="Path to an existing runtime package, e.g. GTDB232/project_data.",
    )
    parser.add_argument(
        "--source-tree",
        type=Path,
        default=None,
        help="Optional source Newick tree to copy into processed/tree_core when the package is missing tree_newick_path.",
    )


def _add_migrate_runtime_tree_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--package-root", type=Path, required=True, help="Existing project_data package root.")
    parser.add_argument("--source-tree", type=Path, required=True, help="Original source Newick (.tre) file.")
    parser.add_argument("--taxonomy", type=Path, required=True, help="Original taxonomy.tsv matching the source tree leaves.")
    parser.add_argument("--genome-leaf-map", type=Path, required=True, help="Original genome_leafLabel_mapping.tsv matching the source tree leaves.")


def _add_upgrade_runtime_indexes_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--package-root",
        type=Path,
        default=Path.cwd(),
        help="Existing project_data package root. Defaults to the current directory.",
    )
    parser.add_argument(
        "--backup-path",
        type=Path,
        default=None,
        help="Optional backup file path. If omitted, no backup is created.",
    )


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    normalized_argv = _normalize_argv(sys.argv[1:] if argv is None else argv)
    args = parser.parse_args(normalized_argv)
    if not hasattr(args, "handler"):
        parser.print_help()
        raise SystemExit(0)
    args.handler(args)


def _normalize_argv(argv: list[str]) -> list[str]:
    if not argv:
        return ["build"]
    if argv[0] in {"-h", "--help"}:
        return argv
    known_commands = {
        "build",
        "audit-row-data",
        "audit",
        "make-taxonomy",
        "upgrade-runtime-tree",
        "migrate-runtime-tree",
        "upgrade-runtime-indexes",
    }
    if argv[0] in known_commands:
        return argv
    if argv[0].startswith("-"):
        return ["build", *argv]
    return argv


def _handle_build(args: argparse.Namespace) -> None:
    config = make_config(
        workspace=args.workspace,
        output_root=args.output_root,
        temporary_root=args.temp_root,
        protein_anno_dir=args.protein_anno_dir,
        species_tree_dir=args.species_tree_dir,
        module_source_dir=args.module_source_dir,
        module_completeness_dir=args.module_completeness_dir,
        workers=args.workers,
        annotation_chunk_rows=args.annotation_chunk_rows,
        force=args.force,
    )
    result = run_pipeline(config)
    print("Pipeline completed successfully.")
    for key, value in result.items():
        if key == "summary":
            continue
        print(f"{key}: {value}")


def _handle_audit_row_data(args: argparse.Namespace) -> None:
    report = audit_row_data(
        workspace=args.workspace,
        protein_anno_dir=args.protein_anno_dir,
        species_tree_dir=args.species_tree_dir,
        module_source_dir=args.module_source_dir,
        module_completeness_dir=args.module_completeness_dir,
        mode=args.mode,
        sample_limit=args.sample_limit,
        scan_annotation_proteins=args.scan_annotation_proteins,
    )
    if args.json:
        print(json.dumps(report.to_dict(), ensure_ascii=False, indent=2))
    else:
        print(f"row_data audit ok: {report.ok}")
        print(f"errors: {report.error_count}")
        print(f"warnings: {report.warning_count}")
        print(f"summary: {json.dumps(report.summary, ensure_ascii=False)}")
        for finding in report.findings:
            print(f"[{finding.severity}] {finding.check_id} {finding.scope}: {finding.message}")
            if finding.examples:
                print(f"  examples: {finding.examples}")
    raise SystemExit(0 if report.ok else 1)


def _handle_make_taxonomy(args: argparse.Namespace) -> None:
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for input_path in args.inputs:
        output_path = args.output_dir / _default_taxonomy_output_dir_name(input_path) / "taxonomy.tsv"
        output_df = convert_gtdb_metadata_to_taxonomy_table(
            input_path,
            cluster_map_path=args.cluster_map,
            representatives_only=args.representatives_only,
        )
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_df.to_csv(output_path, sep="\t", index=False)
        print(f"Wrote {len(output_df)} rows -> {output_path}")


def _default_taxonomy_output_dir_name(path: Path) -> str:
    stem = path.stem
    parts = stem.split("_metadata_", 1)
    if len(parts) == 2 and parts[1].startswith("r"):
        return f"{parts[0]}_{parts[1]}"
    return stem


def _handle_upgrade_runtime_tree(args: argparse.Namespace) -> None:
    summary = upgrade_runtime_package(
        package_root=args.package_root.resolve(),
        source_tree_path=args.source_tree.resolve() if args.source_tree else None,
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def _handle_migrate_runtime_tree(args: argparse.Namespace) -> None:
    summary = migrate_runtime_tree_from_row_data(
        package_root=args.package_root.resolve(),
        source_tree_path=args.source_tree.resolve(),
        taxonomy_path=args.taxonomy.resolve(),
        genome_leaf_map_path=args.genome_leaf_map.resolve(),
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def _handle_upgrade_runtime_indexes(args: argparse.Namespace) -> None:
    if args.backup_path:
        print("Stop the backend before continuing. Creating a database backup before changing indexes.")
    else:
        print("Stop the backend before continuing. No database backup will be created.")
    summary = upgrade_runtime_indexes(
        package_root=args.package_root.resolve(),
        backup_path=args.backup_path.resolve() if args.backup_path else None,
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
