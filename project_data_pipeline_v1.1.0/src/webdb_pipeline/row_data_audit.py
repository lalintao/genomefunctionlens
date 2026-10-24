from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable

import pandas as pd
from Bio import SeqIO

from .builders import build_kegg_module_resources, genome_accession_from_protein_fasta_path, iter_protein_fasta_paths
from .config import make_config
from .inputs import discover_genome_databases, discover_module_source_input
from .models import GenomeDatabaseInput, ModuleSourceInput
from .runtime_package import _parse_newick


EXPECTED_ANNOTATION_TYPES = ("cog", "kegg", "pfam")
TAXONOMY_REQUIRED_COLUMNS = {"accession", "gtdb_taxonomy"}
GENOME_MAP_REQUIRED_COLUMNS = {"genome_name", "leaf_label"}
MODULE_RAW_REQUIRED_FILES = ("info_module.txt", "list_module.tsv", "link_ko_module.tsv")


@dataclass(slots=True)
class AuditFinding:
    severity: str
    check_id: str
    scope: str
    message: str
    examples: list[str] = field(default_factory=list)


@dataclass(slots=True)
class AuditReport:
    ok: bool
    error_count: int
    warning_count: int
    summary: dict[str, object]
    findings: list[AuditFinding]

    def to_dict(self) -> dict[str, object]:
        return {
            "ok": self.ok,
            "error_count": self.error_count,
            "warning_count": self.warning_count,
            "summary": self.summary,
            "findings": [asdict(finding) for finding in self.findings],
        }


class _AuditBuilder:
    def __init__(self, *, sample_limit: int) -> None:
        self.sample_limit = max(1, int(sample_limit))
        self.findings: list[AuditFinding] = []

    def error(self, check_id: str, scope: str, message: str, examples: Iterable[object] = ()) -> None:
        self._add("error", check_id, scope, message, examples)

    def warning(self, check_id: str, scope: str, message: str, examples: Iterable[object] = ()) -> None:
        self._add("warning", check_id, scope, message, examples)

    def _add(
        self,
        severity: str,
        check_id: str,
        scope: str,
        message: str,
        examples: Iterable[object],
    ) -> None:
        self.findings.append(
            AuditFinding(
                severity=severity,
                check_id=check_id,
                scope=scope,
                message=message,
                examples=[str(example) for example in list(examples)[: self.sample_limit]],
            )
        )


def audit_row_data(
    *,
    workspace: Path,
    protein_anno_dir: Path | None = None,
    species_tree_dir: Path | None = None,
    module_source_dir: Path | None = None,
    module_completeness_dir: Path | None = None,
    mode: str = "fast",
    sample_limit: int = 10,
    scan_annotation_proteins: bool = False,
) -> AuditReport:
    config = make_config(
        workspace=workspace,
        protein_anno_dir=protein_anno_dir,
        species_tree_dir=species_tree_dir,
        module_source_dir=module_source_dir,
        module_completeness_dir=module_completeness_dir,
    )
    audit = _AuditBuilder(sample_limit=sample_limit)
    summary: dict[str, object] = {
        "workspace": str(config.workspace),
        "mode": mode,
        "protein_anno_dir": str(config.protein_anno_dir),
        "species_tree_dir": str(config.species_tree_dir),
        "module_source_dir": str(config.module_source_dir),
        "module_completeness_dir": str(config.module_completeness_dir),
    }

    _audit_required_roots(audit, config.protein_anno_dir, config.species_tree_dir, config.module_source_dir, config.module_completeness_dir)

    genome_databases = discover_genome_databases(config.protein_anno_dir)
    module_source_input = discover_module_source_input(config.module_source_dir)
    tree_mappings = _read_tree_mappings(audit, config.species_tree_dir, genome_databases)
    referenced_database_names = {
        database_name
        for _, database_name in tree_mappings
        if database_name in genome_databases
    }
    unreferenced_database_names = sorted(set(genome_databases) - referenced_database_names)
    summary["genome_databases"] = sorted(genome_databases)
    summary["referenced_genome_databases"] = sorted(referenced_database_names)
    summary["unreferenced_genome_databases"] = unreferenced_database_names
    summary["species_tree_mappings"] = len(tree_mappings)
    if unreferenced_database_names:
        audit.warning(
            "unreferenced_genome_database",
            "protein_anno",
            "Genome database directories are not referenced by any active tree mapping and will be ignored by the build.",
            unreferenced_database_names,
        )

    annotation_name_types = _audit_annotation_name_files(audit, config.protein_anno_dir)
    summary["annotation_name_types"] = sorted(annotation_name_types)

    # Match the builder's selection rule: only databases referenced by an
    # active tree mapping are required build inputs. Staged or stale database
    # directories must not make an otherwise buildable workspace fail audit.
    database_contexts = {
        name: _audit_genome_database(
            audit,
            genome_databases[name],
            mode=mode,
            scan_annotation_proteins=scan_annotation_proteins,
        )
        for name in sorted(referenced_database_names)
    }
    summary["protein_fasta_files"] = sum(int(context.get("protein_fasta_files", 0)) for context in database_contexts.values())
    summary["mapped_genomes"] = sum(int(context.get("mapped_genomes", 0)) for context in database_contexts.values())

    tree_contexts = [
        _audit_tree_mapping(
            audit,
            species_tree_dir=config.species_tree_dir,
            tree_dir_name=tree_dir_name,
            genome_database_name=genome_database_name,
            genome_databases=genome_databases,
            database_contexts=database_contexts,
            mode=mode,
        )
        for tree_dir_name, genome_database_name in tree_mappings
    ]
    summary["tree_leaf_count"] = sum(int(context.get("leaf_count", 0)) for context in tree_contexts)

    _audit_module_source(audit, module_source_input, mode=mode, summary=summary)
    _audit_module_completeness(
        audit,
        config.module_completeness_dir,
        tree_contexts=tree_contexts,
        database_contexts=database_contexts,
        summary=summary,
    )

    error_count = sum(1 for finding in audit.findings if finding.severity == "error")
    warning_count = sum(1 for finding in audit.findings if finding.severity == "warning")
    return AuditReport(
        ok=error_count == 0,
        error_count=error_count,
        warning_count=warning_count,
        summary=summary,
        findings=audit.findings,
    )


def _audit_required_roots(
    audit: _AuditBuilder,
    protein_anno_dir: Path,
    species_tree_dir: Path,
    module_source_dir: Path,
    module_completeness_dir: Path,
) -> None:
    required = {
        "protein_anno": protein_anno_dir,
        "GTDB_speciesTree": species_tree_dir,
        "module_source/kegg_module": module_source_dir,
        "kegg_module_completeness": module_completeness_dir,
    }
    for label, path in required.items():
        if not path.exists():
            audit.error("missing_root", label, f"Required row_data input directory is missing: {path}")
        elif not path.is_dir():
            audit.error("root_not_directory", label, f"Required row_data input path is not a directory: {path}")


def _read_tree_mappings(
    audit: _AuditBuilder,
    species_tree_dir: Path,
    genome_databases: dict[str, GenomeDatabaseInput],
) -> list[tuple[str, str]]:
    mapping_path = species_tree_dir / "speciesTree_genomesDatabase_mapping.txt"
    if not mapping_path.exists():
        audit.error("missing_tree_mapping", str(mapping_path), "Species tree to genome database mapping file is missing.")
        return []

    mappings: list[tuple[str, str]] = []
    seen_tree_dirs: set[str] = set()
    for line_number, raw_line in enumerate(mapping_path.read_text(encoding="utf-8-sig").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        scope = f"{mapping_path}:{line_number}"
        separator = ":" if ":" in line else "：" if "：" in line else ""
        if not separator:
            audit.error("invalid_tree_mapping_line", scope, "Mapping line must contain ':' or '：'.", [raw_line])
            continue
        tree_dir_name, genome_database_name = [part.strip() for part in line.split(separator, 1)]
        if not tree_dir_name or not genome_database_name:
            audit.error("invalid_tree_mapping_line", scope, "Tree directory and genome database name must both be non-empty.", [raw_line])
            continue
        if tree_dir_name in seen_tree_dirs:
            audit.error("duplicate_tree_mapping", scope, f"Tree directory is mapped more than once: {tree_dir_name}")
        seen_tree_dirs.add(tree_dir_name)
        if genome_database_name not in genome_databases:
            audit.error(
                "unknown_genome_database",
                scope,
                f"Mapped genome database is not present under protein_anno: {genome_database_name}",
            )
        mappings.append((tree_dir_name, genome_database_name))
    if not mappings:
        audit.error("empty_tree_mapping", str(mapping_path), "No active tree mappings were found.")
    return mappings


def _audit_annotation_name_files(audit: _AuditBuilder, protein_anno_dir: Path) -> set[str]:
    found: set[str] = set()
    for annotation_type in EXPECTED_ANNOTATION_TYPES:
        path = protein_anno_dir / f"{annotation_type}_annotation_names.tsv"
        if not path.exists():
            audit.error("missing_annotation_names", str(path), f"Missing annotation names file for {annotation_type}.")
            continue
        df = _read_tsv(audit, path, check_id="invalid_annotation_names")
        if df is None:
            continue
        if "accession" not in df.columns:
            audit.error("invalid_annotation_names_schema", str(path), "Annotation names file is missing required column: accession.")
            continue
        empty = df["accession"].astype(str).str.strip().eq("")
        if empty.any():
            audit.warning("empty_annotation_name_accession", str(path), "Annotation names file has empty accession values.", df.index[empty].tolist())
        found.add(annotation_type)
    return found


def _audit_genome_database(
    audit: _AuditBuilder,
    database: GenomeDatabaseInput,
    *,
    mode: str,
    scan_annotation_proteins: bool,
) -> dict[str, object]:
    context: dict[str, object] = {"name": database.name}
    mapping_df = _read_genome_map(audit, database.genome_leaf_map_path)
    genome_names = set(mapping_df["genome_name"]) if mapping_df is not None else set()
    leaf_labels = set(mapping_df["leaf_label"]) if mapping_df is not None else set()
    context["mapped_genomes"] = len(genome_names)
    context["genome_names"] = genome_names
    context["leaf_labels"] = leaf_labels

    if not database.protein_dir.exists():
        audit.error("missing_protein_dir", str(database.protein_dir), f"Protein directory is missing for database {database.name}.")
        protein_paths: list[Path] = []
    else:
        protein_paths = iter_protein_fasta_paths(database.protein_dir)
        if not protein_paths:
            audit.error("missing_protein_fasta", str(database.protein_dir), f"No .faa files found for database {database.name}.")
    context["protein_fasta_files"] = len(protein_paths)

    resolved_protein_genomes = {
        _resolve_genome_name(genome_accession_from_protein_fasta_path(path), genome_names)
        for path in protein_paths
    }
    context["protein_genome_names"] = resolved_protein_genomes
    if genome_names:
        missing_protein = sorted(genome_names - resolved_protein_genomes)
        extra_protein = sorted(resolved_protein_genomes - genome_names)
        if missing_protein:
            audit.error("missing_protein_for_genome", database.name, "Mapped genomes are missing matching .faa files.", missing_protein)
        if extra_protein:
            audit.error("protein_without_mapping", database.name, ".faa files do not resolve to genome_leafLabel_mapping.tsv genome_name values.", extra_protein)

    if not database.annotation_dir.exists():
        audit.error("missing_annotation_dir", str(database.annotation_dir), f"Annotation directory is missing for database {database.name}.")
    else:
        _audit_annotation_files(audit, database, protein_paths, mode=mode, scan_annotation_proteins=scan_annotation_proteins)
    return context


def _read_genome_map(audit: _AuditBuilder, path: Path) -> pd.DataFrame | None:
    if not path.exists():
        audit.error("missing_genome_leaf_map", str(path), "genome_leafLabel_mapping.tsv is missing.")
        return None
    df = _read_tsv(audit, path, check_id="invalid_genome_leaf_map")
    if df is None:
        return None
    missing = GENOME_MAP_REQUIRED_COLUMNS - set(df.columns)
    if missing:
        audit.error("invalid_genome_leaf_map_schema", str(path), f"Missing required columns: {sorted(missing)}")
        return None
    result = df.loc[:, ["genome_name", "leaf_label"]].copy()
    result["genome_name"] = result["genome_name"].astype(str).str.strip()
    result["leaf_label"] = result["leaf_label"].astype(str).str.strip()
    empty_rows = result["genome_name"].eq("") | result["leaf_label"].eq("")
    if empty_rows.any():
        audit.error("empty_genome_leaf_map_value", str(path), "Mapping file has empty genome_name or leaf_label values.", result.loc[empty_rows].head(10).to_dict(orient="records"))
    for column in ("genome_name", "leaf_label"):
        duplicates = sorted(result.loc[result[column].duplicated(), column].unique())
        if duplicates:
            audit.error("duplicate_genome_leaf_map_value", str(path), f"Mapping file has duplicate {column} values.", duplicates)
    return result.loc[~empty_rows].drop_duplicates()


def _audit_annotation_files(
    audit: _AuditBuilder,
    database: GenomeDatabaseInput,
    protein_paths: list[Path],
    *,
    mode: str,
    scan_annotation_proteins: bool,
) -> None:
    annotation_paths = {path.stem: path for path in sorted(database.annotation_dir.glob("*.tsv"))}
    for annotation_type in EXPECTED_ANNOTATION_TYPES:
        if annotation_type not in annotation_paths:
            audit.error("missing_annotation_file", str(database.annotation_dir), f"Missing expected annotation file: {annotation_type}.tsv")

    if not scan_annotation_proteins:
        return

    protein_ids = _read_fasta_protein_ids(audit, protein_paths, scope=database.name)
    if not protein_ids:
        return
    for annotation_type, path in sorted(annotation_paths.items()):
        unknown = _find_unknown_annotation_proteins(path, protein_ids)
        if unknown:
            audit.error(
                "annotation_unknown_protein_id",
                str(path),
                f"{annotation_type} annotation file references protein_id values not present in FASTA files.",
                unknown,
            )


def _read_fasta_protein_ids(audit: _AuditBuilder, protein_paths: list[Path], *, scope: str) -> set[str]:
    protein_ids: set[str] = set()
    for path in protein_paths:
        try:
            for record in SeqIO.parse(path, "fasta"):
                protein_id = str(record.id).strip()
                if protein_id:
                    protein_ids.add(protein_id)
        except Exception as exc:
            audit.error("invalid_fasta", str(path), f"Failed to parse FASTA file: {exc}")
    if not protein_ids:
        audit.error("empty_fasta_records", scope, "No FASTA records were found across .faa files.")
    return protein_ids


def _find_unknown_annotation_proteins(path: Path, protein_ids: set[str]) -> list[str]:
    unknown: list[str] = []
    with path.open("r", encoding="utf-8", newline="") as handle:
        for raw_line in handle:
            line = raw_line.rstrip("\n")
            if not line:
                continue
            fields = re.split(r"[\s,|]+", line, maxsplit=1)
            if len(fields) != 2:
                continue
            protein_id = fields[0].strip()
            if protein_id and protein_id not in protein_ids:
                unknown.append(protein_id)
                if len(unknown) >= 10:
                    break
    return unknown


def _audit_tree_mapping(
    audit: _AuditBuilder,
    *,
    species_tree_dir: Path,
    tree_dir_name: str,
    genome_database_name: str,
    genome_databases: dict[str, GenomeDatabaseInput],
    database_contexts: dict[str, dict[str, object]],
    mode: str,
) -> dict[str, object]:
    context: dict[str, object] = {
        "tree_dir": tree_dir_name,
        "genome_database": genome_database_name,
        "leaf_count": 0,
    }
    tree_dir = species_tree_dir / tree_dir_name
    if not tree_dir.exists():
        audit.error("missing_tree_dir", str(tree_dir), f"Mapped tree directory is missing: {tree_dir_name}")
        return context
    if not tree_dir.is_dir():
        audit.error("tree_mapping_not_directory", str(tree_dir), "Mapped tree target must be a directory.")
        return context

    tree_files = sorted(path for path in tree_dir.glob("*.tre") if path.is_file())
    if len(tree_files) != 1:
        audit.error("invalid_tree_file_count", str(tree_dir), "Tree directory must contain exactly one .tre file.", [path.name for path in tree_files])
        return context
    tree_path = tree_files[0]
    taxonomy_path = tree_dir / "taxonomy.tsv"
    taxonomy_df = _read_taxonomy(audit, taxonomy_path)

    leaf_labels = _read_tree_leaf_labels(audit, tree_path)
    context["leaf_count"] = len(leaf_labels)
    context["leaf_labels"] = leaf_labels
    if taxonomy_df is not None and leaf_labels:
        taxonomy_accessions = set(taxonomy_df["accession"])
        missing_taxonomy = sorted(leaf_labels - taxonomy_accessions)
        extra_taxonomy = sorted(taxonomy_accessions - leaf_labels)
        if missing_taxonomy:
            audit.error("tree_leaf_missing_taxonomy", tree_dir_name, "Tree leaves are missing taxonomy.tsv rows.", missing_taxonomy)
        if extra_taxonomy:
            audit.warning("taxonomy_not_in_tree", tree_dir_name, "taxonomy.tsv has accessions that are not leaves of this tree.", extra_taxonomy)

    if genome_database_name not in genome_databases:
        return context
    database_context = database_contexts.get(genome_database_name, {})
    mapped_leaf_labels = set(database_context.get("leaf_labels", set()))
    if leaf_labels and mapped_leaf_labels:
        missing_mapping = sorted(leaf_labels - mapped_leaf_labels)
        extra_mapping = sorted(mapped_leaf_labels - leaf_labels)
        if missing_mapping:
            audit.error("tree_leaf_missing_genome_mapping", tree_dir_name, "Tree leaves are missing genome_leafLabel_mapping.tsv rows.", missing_mapping)
        if extra_mapping:
            audit.warning("genome_mapping_not_in_tree", tree_dir_name, "genome_leafLabel_mapping.tsv has leaf_label values not present in the tree.", extra_mapping)
    return context


def _read_taxonomy(audit: _AuditBuilder, path: Path) -> pd.DataFrame | None:
    if not path.exists():
        audit.error("missing_taxonomy", str(path), "taxonomy.tsv is missing.")
        return None
    df = _read_tsv(audit, path, check_id="invalid_taxonomy")
    if df is None:
        return None
    missing = TAXONOMY_REQUIRED_COLUMNS - set(df.columns)
    if missing:
        audit.error("invalid_taxonomy_schema", str(path), f"Missing required columns: {sorted(missing)}")
        return None
    result = df.copy()
    result["accession"] = result["accession"].astype(str).str.strip()
    result["gtdb_taxonomy"] = result["gtdb_taxonomy"].astype(str).str.strip()
    empty_accession = result["accession"].eq("")
    empty_taxonomy = result["gtdb_taxonomy"].eq("")
    if empty_accession.any():
        audit.error("empty_taxonomy_accession", str(path), "taxonomy.tsv has empty accession values.", result.index[empty_accession].tolist())
    if empty_taxonomy.any():
        audit.error("empty_taxonomy_value", str(path), "taxonomy.tsv has empty gtdb_taxonomy values.", result.loc[empty_taxonomy, "accession"].tolist())
    duplicates = sorted(result.loc[result["accession"].duplicated(), "accession"].unique())
    if duplicates:
        audit.error("duplicate_taxonomy_accession", str(path), "taxonomy.tsv has duplicate accession values.", duplicates)
    return result.loc[result["accession"].ne("")].drop_duplicates(subset=["accession"])


def _read_tree_leaf_labels(audit: _AuditBuilder, tree_path: Path) -> set[str]:
    try:
        _, children, _, _, names = _parse_newick(tree_path)
    except Exception as exc:
        audit.error("invalid_newick", str(tree_path), f"Failed to parse Newick tree: {exc}")
        return set()
    leaves = {names[node_id] for node_id, child_ids in enumerate(children) if not child_ids and names[node_id]}
    empty_leaf_count = sum(1 for node_id, child_ids in enumerate(children) if not child_ids and not names[node_id])
    if empty_leaf_count:
        audit.error("empty_tree_leaf_label", str(tree_path), f"Tree has {empty_leaf_count} leaves with empty labels.")
    if len(leaves) != sum(1 for child_ids in children if not child_ids) - empty_leaf_count:
        audit.error("duplicate_tree_leaf_label", str(tree_path), "Tree has duplicate leaf labels.")
    return leaves


def _audit_module_source(
    audit: _AuditBuilder,
    module_source_input: ModuleSourceInput | None,
    *,
    mode: str,
    summary: dict[str, object],
) -> None:
    if module_source_input is None:
        audit.error("missing_module_source", "module_source", "KEGG Module source directory is missing.")
        return
    for file_name in MODULE_RAW_REQUIRED_FILES:
        path = module_source_input.raw_dir / file_name
        if not path.exists():
            audit.error("missing_module_source_file", str(path), f"Missing KEGG Module source file: {file_name}")
    if not module_source_input.entries_dir.exists():
        audit.error("missing_module_entries", str(module_source_input.entries_dir), "KEGG Module entries directory is missing.")
        return
    entry_files = sorted(module_source_input.entries_dir.glob("M*.txt"))
    summary["module_entry_files"] = len(entry_files)
    if not entry_files:
        audit.error("missing_module_entry_files", str(module_source_input.entries_dir), "No M*.txt module entry files found.")
        return
    if mode == "deep":
        try:
            module_resources = build_kegg_module_resources(module_source_input=module_source_input)
            summary["module_annotations"] = int(len(module_resources.get("module_metadata_df", [])))
            summary["module_ko_columns"] = int(len(module_resources.get("module_column_registry_df", [])))
        except Exception as exc:
            audit.error("invalid_module_source", str(module_source_input.root_dir), f"Failed to parse KEGG Module source files: {exc}")


def _audit_module_completeness(
    audit: _AuditBuilder,
    module_completeness_dir: Path,
    *,
    tree_contexts: list[dict[str, object]],
    database_contexts: dict[str, dict[str, object]],
    summary: dict[str, object],
) -> None:
    path = module_completeness_dir / "completeness_matrix.tsv"
    if not path.exists():
        audit.error("missing_module_completeness", str(path), "Module completeness matrix is missing.")
        return
    try:
        matrix_header = pd.read_csv(path, sep="\t", dtype=str, keep_default_na=False, nrows=0)
        first_column = matrix_header.columns[0]
        source_values = set(pd.read_csv(path, sep="\t", dtype=str, keep_default_na=False, usecols=[first_column])[first_column].astype(str).str.strip())
    except Exception as exc:
        audit.error("invalid_module_completeness", str(path), f"Failed to read module completeness matrix: {exc}")
        return
    source_values.discard("")
    summary["module_completeness_rows"] = len(source_values)
    summary["module_completeness_columns"] = max(0, len(matrix_header.columns) - 1)
    for tree_context in tree_contexts:
        database_name = str(tree_context.get("genome_database", ""))
        database_context = database_contexts.get(database_name, {})
        genome_names = set(database_context.get("genome_names", set()))
        leaf_labels = set(database_context.get("leaf_labels", set()))
        genome_accessions = {_genome_accession_from_name(name) for name in genome_names}
        genome_accessions.discard("")
        candidates = {
            "genome_name": genome_names,
            "leaf_label": leaf_labels,
            "genome_accession": genome_accessions,
        }
        if source_values and not any(values == source_values for values in candidates.values()):
            scores = {name: len(values & source_values) for name, values in candidates.items()}
            best_name = max(scores, key=scores.get) if scores else "unknown"
            missing = sorted(candidates.get(best_name, set()) - source_values)
            extra = sorted(source_values - candidates.get(best_name, set()))
            audit.error(
                "module_completeness_alignment",
                database_name,
                f"Module completeness rows do not exactly match genome_name, leaf_label, or genome_accession. Best match: {best_name} ({scores.get(best_name, 0)} rows).",
                [f"missing={item}" for item in missing[:5]] + [f"extra={item}" for item in extra[:5]],
            )


def _read_tsv(audit: _AuditBuilder, path: Path, *, check_id: str) -> pd.DataFrame | None:
    try:
        return pd.read_csv(path, sep="\t", dtype=str, keep_default_na=False)
    except Exception as exc:
        audit.error(check_id, str(path), f"Failed to read TSV file: {exc}")
        return None


def _resolve_genome_name(genome_accession: str, genome_names: set[str]) -> str:
    candidates = [genome_accession]
    if genome_accession.startswith("GCA_"):
        candidates.append(f"GB_{genome_accession}")
    if genome_accession.startswith("GCF_"):
        candidates.append(f"RS_{genome_accession}")
    for candidate in candidates:
        if candidate in genome_names:
            return candidate
    return candidates[-1] if len(candidates) > 1 else genome_accession


def _genome_accession_from_name(genome_name: str) -> str:
    if genome_name.startswith(("GB_", "RS_")):
        return genome_name[3:]
    return genome_name


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Audit row_data inputs before building a 4.0 runtime package.")
    parser.add_argument("--workspace", type=Path, default=Path.cwd(), help="Workspace root containing row_data.")
    parser.add_argument("--protein-anno-dir", type=Path, default=None)
    parser.add_argument("--species-tree-dir", type=Path, default=None)
    parser.add_argument("--module-source-dir", type=Path, default=None)
    parser.add_argument("--module-completeness-dir", type=Path, default=None)
    parser.add_argument("--mode", choices=["fast", "deep"], default="fast")
    parser.add_argument("--sample-limit", type=int, default=10)
    parser.add_argument(
        "--scan-annotation-proteins",
        action="store_true",
        help="Also scan annotation TSV protein_id values against FASTA records. This can be slow on full datasets.",
    )
    parser.add_argument("--json", action="store_true", help="Print the full audit report as JSON.")
    return parser


def main() -> None:
    args = build_parser().parse_args()
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


if __name__ == "__main__":
    main()
