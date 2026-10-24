#!/usr/bin/env python3
r"""Diagnose annotation protein_id mismatches without a full rebuild.

The script samples the first N lines of each annotation TSV and searches those
IDs directly in the source .faa files. It does not assume a genome prefix
format such as "<genome>__gene". Matching FASTA paths are used to infer the
genome, and the runtime protein table is then checked by genome_id.

    conda activate web_deel
    python diagnose_annotation_ids.py \
      --workspace /share/cn1_fs/project/LLT/GTDB_arc_bac_232 \
      --package-root /share/cn1_fs/project/LLT/GTDB_arc_bac_232/project_data \
      --max-lines-per-type 5000 \
      --json-report ./diagnose_annotation_ids.json
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path


ANNOTATION_TYPES = ("cog", "kegg", "pfam")
HEADER_FIRST_FIELDS = {
    "protein_id", "proteinid", "protein", "gene", "gene_id", "geneid",
    "name", "id", "accession", "seq_id", "sequence_id",
}
HEADER_SECOND_FIELDS = {
    "annotation", "annotations", "predict", "prediction", "cog", "kegg",
    "pfam", "ko", "ko_id", "value",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare sampled annotation IDs with source FASTA and runtime protein table.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--workspace", type=Path, default=Path.cwd(), help="Workspace containing row_data")
    parser.add_argument("--package-root", type=Path, required=True, help="Existing project_data directory")
    parser.add_argument("--annotation-dir", type=Path, default=None, help="Override annotation directory")
    parser.add_argument("--max-lines-per-type", type=int, default=5000, help="Annotation lines sampled per type")
    parser.add_argument("--max-examples", type=int, default=10, help="Example IDs per category")
    parser.add_argument("--json-report", type=Path, default=None, help="Optional JSON report path")
    return parser.parse_args()


def fasta_stem(path: Path) -> str:
    stem = path.stem.strip()
    for suffix in ("_protein", ".protein", "-protein"):
        if stem.endswith(suffix):
            return stem[: -len(suffix)]
    return stem


def fasta_candidates(name: str) -> list[str]:
    result = [name]
    if name.startswith("GB_"):
        result.append(name[3:])
    if name.startswith("RS_"):
        result.append(name[3:])
    if name.startswith("GCA_"):
        result.append(f"GB_{name}")
    if name.startswith("GCF_"):
        result.append(f"RS_{name}")
    return list(dict.fromkeys(result))


def iter_fasta_paths(protein_dir: Path) -> list[Path]:
    paths: list[Path] = []
    visited_dirs: set[Path] = set()
    seen_files: set[Path] = set()
    if not protein_dir.exists():
        return paths
    for root, dirnames, filenames in os.walk(protein_dir, followlinks=True):
        try:
            resolved_root = Path(root).resolve()
        except OSError:
            dirnames[:] = []
            continue
        if resolved_root in visited_dirs:
            dirnames[:] = []
            continue
        visited_dirs.add(resolved_root)
        kept: list[str] = []
        for dirname in sorted(dirnames):
            try:
                resolved_child = (Path(root) / dirname).resolve()
            except OSError:
                continue
            if resolved_child not in visited_dirs:
                kept.append(dirname)
        dirnames[:] = kept
        for filename in sorted(filenames):
            path = Path(root) / filename
            if path.suffix.lower() != ".faa" or not path.is_file():
                continue
            try:
                resolved_path = path.resolve()
            except OSError:
                continue
            if resolved_path not in seen_files:
                seen_files.add(resolved_path)
                paths.append(path)
    return sorted(paths)


def read_genome_map(path: Path) -> tuple[dict[str, str], dict[str, str]]:
    by_name: dict[str, str] = {}
    by_leaf: dict[str, str] = {}
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle, delimiter="\t")
        header = [item.strip().lower() for item in next(reader)]
        name_idx = header.index("genome_name")
        leaf_idx = header.index("leaf_label")
        for row in reader:
            if max(name_idx, leaf_idx) >= len(row):
                continue
            name = row[name_idx].strip()
            leaf = row[leaf_idx].strip()
            if name and leaf:
                by_name[name] = leaf
                by_leaf[leaf] = name
    return by_name, by_leaf


def sample_annotations(annotation_dir: Path, max_lines: int) -> tuple[dict[str, set[str]], dict[str, int], dict[str, int]]:
    ids_by_type: dict[str, set[str]] = {kind: set() for kind in ANNOTATION_TYPES}
    line_counts: dict[str, int] = defaultdict(int)
    malformed_counts: dict[str, int] = defaultdict(int)
    first_seen = {kind: False for kind in ANNOTATION_TYPES}
    for kind in ANNOTATION_TYPES:
        path = annotation_dir / f"{kind}.tsv"
        if not path.is_file():
            raise FileNotFoundError(f"Missing annotation file: {path}")
        with path.open("r", encoding="utf-8-sig", errors="strict", newline="") as handle:
            for raw_line in handle:
                if line_counts[kind] >= max_lines:
                    break
                line = raw_line.strip()
                if not line:
                    continue
                fields = re.split(r"[\s,|]+", line, maxsplit=1)
                if len(fields) != 2:
                    malformed_counts[kind] += 1
                    continue
                protein_id = fields[0].lstrip("\ufeff").strip()
                annotation_value = fields[1].strip()
                if not protein_id or not annotation_value:
                    malformed_counts[kind] += 1
                    continue
                if not first_seen[kind]:
                    first_seen[kind] = True
                    if protein_id.lower() in HEADER_FIRST_FIELDS or annotation_value.lower() in HEADER_SECOND_FIELDS:
                        continue
                ids_by_type[kind].add(protein_id)
                line_counts[kind] += 1
    return ids_by_type, line_counts, malformed_counts


def search_fasta_hits(ids: set[str], protein_dir: Path) -> tuple[dict[str, set[Path]], str]:
    if not ids:
        return {}, "none"
    tool = shutil.which("rg") or shutil.which("grep")
    if tool is None:
        raise RuntimeError("Neither rg nor grep is available for FASTA ID search")
    with tempfile.TemporaryDirectory(prefix="annotation_id_diag_") as temp_dir:
        patterns_path = Path(temp_dir) / "ids.txt"
        patterns_path.write_text("\n".join(sorted(ids)) + "\n", encoding="utf-8")
        tool_name = Path(tool).name.lower()
        if tool_name.startswith("rg"):
            command = [
                tool, "--follow", "--no-ignore", "--fixed-strings", "--line-number",
                "--no-heading", "--with-filename", "--color", "never", "--file",
                str(patterns_path), str(protein_dir),
            ]
        else:
            command = [tool, "-R", "-n", "-F", "-f", str(patterns_path), "--", str(protein_dir)]
        completed = subprocess.run(
            command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=False
        )
        if completed.returncode not in (0, 1):
            raise RuntimeError(f"FASTA search failed ({tool_name}): {completed.stderr[:1000]}")
        hits: dict[str, set[Path]] = defaultdict(set)
        for line in completed.stdout.splitlines():
            match = re.match(r"^(.*?):(\d+):(.*)$", line)
            if not match:
                continue
            path = Path(match.group(1))
            content = match.group(3).strip().lstrip(">")
            protein_id = content.split(None, 1)[0]
            if protein_id in ids:
                hits[protein_id].add(path)
    return dict(hits), tool_name


def load_runtime_genomes(conn: sqlite3.Connection) -> tuple[dict[str, int], dict[str, int]]:
    by_name: dict[str, int] = {}
    by_accession: dict[str, int] = {}
    for genome_id, genome_name, genome_accession in conn.execute(
        "SELECT genome_id, genome_name, genome_accession FROM genome"
    ):
        genome_id = int(genome_id)
        if genome_name:
            by_name[str(genome_name)] = genome_id
        if genome_accession:
            by_accession[str(genome_accession)] = genome_id
    return by_name, by_accession


def runtime_protein_ids(conn: sqlite3.Connection, genome_id: int, limit: int = 500_000) -> set[str]:
    rows = conn.execute(
        "SELECT protein_id FROM protein WHERE genome_id = ? LIMIT ?",
        (genome_id, limit),
    ).fetchall()
    return {str(row[0]) for row in rows if row[0] is not None}


def genome_name_for_fasta(path: Path, genome_names: dict[str, str], genome_leaves: dict[str, str]) -> str | None:
    stem = fasta_stem(path)
    if stem in genome_names:
        return stem
    for candidate in fasta_candidates(stem):
        if candidate in genome_names:
            return candidate
    if stem in genome_leaves:
        return genome_leaves[stem]
    return None


def short_examples(items: set[str], limit: int) -> list[str]:
    return sorted(items)[:limit]


def main() -> int:
    args = parse_args()
    workspace = args.workspace.resolve()
    package_root = args.package_root.resolve()
    manifest_path = package_root / "backend_ready" / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"manifest.json not found: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    database_name = str(manifest["genome_database"])
    sqlite_path = package_root / manifest.get("database", {}).get("sqlite", "database/web_database.sqlite")
    annotation_dir = (
        args.annotation_dir.resolve()
        if args.annotation_dir
        else workspace / "row_data" / "protein_anno" / database_name / "annotation"
    )
    genome_map_path = workspace / "row_data" / "protein_anno" / database_name / "genome_leafLabel_mapping.tsv"
    if not genome_map_path.is_file():
        raise FileNotFoundError(f"genome map not found: {genome_map_path}")

    genome_names, genome_leaves = read_genome_map(genome_map_path)
    ids_by_type, line_counts, malformed = sample_annotations(annotation_dir, max(1, args.max_lines_per_type))
    all_ids = set().union(*ids_by_type.values())
    fasta_hits, search_tool = search_fasta_hits(all_ids, workspace / "row_data" / "protein_anno" / database_name / "protein")

    # Map each matched FASTA file to its genome and load runtime IDs once per genome.
    genome_for_fasta: dict[Path, str] = {}
    for path in {path for paths in fasta_hits.values() for path in paths}:
        genome_name = genome_name_for_fasta(path, genome_names, genome_leaves)
        if genome_name:
            genome_for_fasta[path] = genome_name

    with sqlite3.connect(f"file:{sqlite_path.as_posix()}?mode=ro", uri=True) as conn:
        conn.execute("PRAGMA query_only=ON")
        runtime_by_name, runtime_by_accession = load_runtime_genomes(conn)
        runtime_cache: dict[int, set[str]] = {}
        for genome_name in set(genome_for_fasta.values()):
            genome_id = runtime_by_name.get(genome_name) or runtime_by_accession.get(genome_name)
            if genome_id is not None:
                runtime_cache[genome_id] = runtime_protein_ids(conn, genome_id)

        results: dict[str, dict[str, object]] = {}
        for kind in ANNOTATION_TYPES:
            ids = ids_by_type[kind]
            fasta_matched = {item for item in ids if fasta_hits.get(item)}
            runtime_matched: set[str] = set()
            matched_genomes: set[str] = set()
            for item in fasta_matched:
                for path in fasta_hits[item]:
                    genome_name = genome_for_fasta.get(path)
                    if genome_name:
                        matched_genomes.add(genome_name)
                    genome_id = runtime_by_name.get(genome_name) if genome_name else None
                    if genome_id is None and genome_name:
                        genome_id = runtime_by_accession.get(genome_name)
                    if genome_id is not None and item in runtime_cache.get(genome_id, set()):
                        runtime_matched.add(item)
            missing_fasta = ids - fasta_matched
            missing_runtime = fasta_matched - runtime_matched
            results[kind] = {
                "sampled_ids": len(ids),
                "in_fasta": len(fasta_matched),
                "in_runtime": len(runtime_matched),
                "matched_genome_count": len(matched_genomes),
                "matched_genomes": sorted(matched_genomes)[: args.max_examples],
                "missing_from_fasta": short_examples(missing_fasta, args.max_examples),
                "missing_from_runtime": short_examples(missing_runtime, args.max_examples),
            }

    report = {
        "workspace": str(workspace),
        "package_root": str(package_root),
        "sqlite": str(sqlite_path),
        "annotation_dir": str(annotation_dir),
        "database_name": database_name,
        "annotation_lines_sampled": dict(line_counts),
        "malformed_annotation_lines": dict(malformed),
        "fasta_search_tool": search_tool,
        "sampled_fasta_files": len(genome_for_fasta),
        "results": results,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.json_report:
        args.json_report.parent.mkdir(parents=True, exist_ok=True)
        args.json_report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"JSON report: {args.json_report.resolve()}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())