#!/usr/bin/env python3
"""Count FASTA proteins and COG/KEGG/PFAM coverage; Python 3.9+, stdlib only."""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import tempfile

SOURCES = ("cog", "kegg", "pfam")
MISSING = {"", "-", ".", "na", "n/a", "nan", "none", "null"}
HEADER_IDS = {"protein_id", "proteinid", "protein", "gene", "gene_id", "geneid",
              "name", "id", "accession", "seq_id", "sequence_id"}
HEADER_VALUES = {"annotation", "annotations", "predict", "prediction", "cog",
                 "kegg", "pfam", "ko", "ko_id", "value"}


def open_text(path):
    opener = gzip.open if path.name.lower().endswith(".gz") else open
    return opener(path, "rt", encoding="utf-8-sig", errors="strict")


def fasta_paths(root):
    """Follow directory links once; deduplicate file aliases, including hardlinks."""
    dirs, files, result = set(), set(), []

    def identity(path):
        stat = path.stat()  # Broken links and permission errors must not hide data.
        return (stat.st_dev, stat.st_ino) if stat.st_ino else str(path.resolve())

    def fail(error):
        raise error

    for base, children, names in os.walk(root, followlinks=True, onerror=fail):
        key = identity(Path(base))
        if key in dirs:
            children[:] = []
            continue
        dirs.add(key)
        children.sort()
        for name in sorted(names):
            if not name.lower().endswith((".faa", ".faa.gz")):
                continue
            path = Path(base) / name
            key = identity(path)
            if key not in files:
                files.add(key)
                result.append(path)
    return result


def discover(root, scope, selected):
    base = root / "protein_anno"
    if not base.is_dir():
        raise ValueError(f"Missing directory: {base}")
    candidates = {p.name: p for p in base.iterdir() if p.is_dir() and
                  any((p / name).exists() for name in ("protein", "annotation", "genome_leafLabel_mapping.tsv"))}
    names = set(candidates)
    if scope == "mapped":
        names = set()
        mapping = root / "GTDB_speciesTree/speciesTree_genomesDatabase_mapping.txt"
        with open_text(mapping) as handle:
            for number, raw in enumerate(handle, 1):
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                parts = re.split("[:：]", line, maxsplit=1)
                if len(parts) != 2 or not parts[1].strip():
                    raise ValueError(f"Invalid mapping: {mapping}:{number}")
                names.add(parts[1].strip().replace("\\", "/").rstrip("/").rsplit("/", 1)[-1])
    if selected:
        unknown = set(selected) - names
        if unknown:
            raise ValueError(f"Databases outside selected scope: {sorted(unknown)}")
        names = set(selected)
    if not names or names - candidates.keys():
        raise ValueError(f"No databases or missing mapped databases: {sorted(names - candidates.keys())}")
    return [candidates[name] for name in sorted(names)]


def scan_database(database, conn, batch_size):
    paths = fasta_paths(database / "protein")
    if not paths:
        raise ValueError(f"No .faa/.faa.gz files: {database / 'protein'}")
    conn.execute("DROP TABLE IF EXISTS protein")
    conn.execute("CREATE TABLE protein (id TEXT PRIMARY KEY, mask INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID")
    batch = []

    def insert():
        try:
            conn.executemany("INSERT INTO protein(id) VALUES (?)", batch)
        except sqlite3.IntegrityError as exc:
            raise ValueError(f"Duplicate FASTA protein ID in {database.name}; annotation IDs are ambiguous. "
                             "Check duplicate files/IDs before counting.") from exc
        conn.commit()
        batch.clear()

    for index, path in enumerate(paths, 1):
        records, has_sequence = 0, False
        with open_text(path) as handle:
            for number, raw in enumerate(handle, 1):
                line = raw.strip()
                if not line:
                    continue
                if line.startswith(">"):
                    if records and not has_sequence:
                        raise ValueError(f"Empty FASTA sequence: {path}:{number}")
                    fields = line[1:].split()
                    if not fields:
                        raise ValueError(f"Empty FASTA ID: {path}:{number}")
                    records += 1
                    has_sequence = False
                    batch.append((fields[0],))
                    if len(batch) >= batch_size:
                        insert()
                elif not records:
                    raise ValueError(f"Sequence before FASTA header: {path}:{number}")
                else:
                    has_sequence = True
        if not records or not has_sequence:
            raise ValueError(f"Empty FASTA file/sequence: {path}")
        if index % 1000 == 0:
            print(f"[{database.name}] FASTA {index}/{len(paths)}", file=sys.stderr, flush=True)
    insert()
    total = conn.execute("SELECT COUNT(*) FROM protein").fetchone()[0]
    result = {"database": database.name, "fasta_files": len(paths), "total_proteins": total, "sources": {}}
    for bit, source in enumerate(SOURCES):
        flag = 1 << bit
        candidates = [p for p in (database / "annotation" / f"{source}.tsv",
                                  database / "annotation" / f"{source}.tsv.gz") if p.exists()]
        if len(candidates) > 1:
            raise ValueError(f"Both compressed and uncompressed annotation files exist: {candidates}")
        stats = dict(status="missing", valid_rows=0, matched_rows=0, unknown_rows=0,
                     malformed_rows=0, empty_annotation_rows=0, header_rows=0)
        result["sources"][source] = stats
        if candidates:
            stats["status"] = "ok"
            first = True

            def update():
                cursor = conn.executemany("UPDATE protein SET mask = mask | ? WHERE id = ?", batch)
                stats["matched_rows"] += cursor.rowcount
                conn.commit()
                batch.clear()

            with open_text(candidates[0]) as handle:
                for raw in handle:
                    line = raw.strip()
                    if not line or line.startswith("#"):
                        continue
                    fields = re.split(r"[\s,|]+", line, maxsplit=1)
                    if len(fields) != 2:
                        stats["malformed_rows"] += 1
                        continue
                    pid, value = fields
                    if first and pid.lower() in HEADER_IDS and value.lower() in HEADER_VALUES:
                        stats["header_rows"] += 1
                        first = False
                        continue
                    first = False
                    if not any(v.strip().lower() not in MISSING for v in value.split(";;")):
                        stats["empty_annotation_rows"] += 1
                        continue
                    stats["valid_rows"] += 1
                    batch.append((flag, pid))
                    if len(batch) >= batch_size:
                        update()
            update()
            stats["unknown_rows"] = stats["valid_rows"] - stats["matched_rows"]
        stats["annotated_proteins"] = conn.execute(
            "SELECT COUNT(*) FROM protein WHERE mask & ? != 0", (flag,)).fetchone()[0]
        stats["coverage_percent"] = 100 * stats["annotated_proteins"] / total
        print(f"[{database.name}] {source}: {stats['annotated_proteins']:,}/{total:,} "
              f"({stats['coverage_percent']:.4f}%), unknown rows={stats['unknown_rows']:,}",
              file=sys.stderr, flush=True)
    result["overlap_counts"] = {str(mask): 0 for mask in range(8)}
    result["overlap_counts"].update({str(mask): count for mask, count in
                                    conn.execute("SELECT mask, COUNT(*) FROM protein GROUP BY mask")})
    return result


def run(args):
    root = args.row_data.resolve() if args.row_data else args.workspace.resolve() / "row_data"
    databases = discover(root, args.scope, args.database)
    if args.batch_size < 1:
        raise ValueError("--batch-size must be positive")
    # Refuse an existing output directory so failed/repeated runs cannot expose stale reports.
    args.output_dir.mkdir(parents=True, exist_ok=False)
    if args.temp_dir:
        args.temp_dir.mkdir(parents=True, exist_ok=True)
    results = []
    with tempfile.TemporaryDirectory(prefix="protein_coverage_", dir=args.temp_dir) as temporary:
        conn = sqlite3.connect(str(Path(temporary) / "counts.sqlite"))
        try:
            conn.execute("PRAGMA journal_mode=OFF")
            conn.execute("PRAGMA synchronous=OFF")
            conn.execute("PRAGMA cache_size=-65536")
            conn.execute("PRAGMA temp_store=FILE")
            for database in databases:
                print(f"Scanning {database}", file=sys.stderr, flush=True)
                results.append(scan_database(database, conn, args.batch_size))
        finally:
            conn.close()
    total = sum(item["total_proteins"] for item in results)
    summary = {}
    for source in SOURCES:
        values = [item["sources"][source] for item in results]
        count = sum(value["annotated_proteins"] for value in values)
        summary[source] = {
            "annotated_proteins": count, "coverage_percent": 100 * count / total,
            "missing_databases": [item["database"] for item in results if item["sources"][source]["status"] == "missing"],
            "unknown_rows": sum(value["unknown_rows"] for value in values),
            "malformed_rows": sum(value["malformed_rows"] for value in values),
        }
    clean = all(not v["missing_databases"] and not v["unknown_rows"] and not v["malformed_rows"]
                for v in summary.values())
    overlaps = {str(mask): sum(item["overlap_counts"][str(mask)] for item in results) for mask in range(8)}
    report = dict(status="ok" if clean else "needs_review", row_data=str(root), scope=args.scope,
                  protein_identity="(database, exact FASTA first-token ID); no sequence deduplication",
                  total_proteins=total, sources=summary, overlap_bits={"cog": 1, "kegg": 2, "pfam": 4},
                  overlap_counts=overlaps, any_annotated_proteins=total-overlaps["0"],
                  all_three_annotated_proteins=overlaps["7"], databases=results)
    (args.output_dir / "summary.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with (args.output_dir / "coverage.tsv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t")
        writer.writerow(["database", "source", "total_proteins", "annotated_proteins", "coverage_percent", "status"])
        for item in results:
            for source, stats in item["sources"].items():
                status = stats["status"] if not (stats["unknown_rows"] or stats["malformed_rows"]) else "needs_review"
                writer.writerow([item["database"], source, item["total_proteins"], stats["annotated_proteins"],
                                 f"{stats['coverage_percent']:.6f}", status])
        for source, stats in summary.items():
            writer.writerow(["ALL", source, total, stats["annotated_proteins"],
                             f"{stats['coverage_percent']:.6f}", report["status"]])
    print(f"Total proteins: {total:,}")
    for source, stats in summary.items():
        print(f"{source.upper()}: {stats['annotated_proteins']:,} / {total:,} = {stats['coverage_percent']:.6f}%")
    print(f"Status: {report['status']}; reports: {args.output_dir.resolve()}")
    return 0 if clean else 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    paths = parser.add_mutually_exclusive_group()
    paths.add_argument("--workspace", type=Path, default=Path.cwd(), help="Directory containing row_data")
    paths.add_argument("--row-data", type=Path, help="Explicit row_data directory")
    parser.add_argument("--scope", choices=("all", "mapped"), default="all")
    parser.add_argument("--database", action="append", help="Restrict to database name; repeatable")
    parser.add_argument("--output-dir", type=Path, default=Path("protein_coverage_report"), help="New report directory")
    parser.add_argument("--temp-dir", type=Path, help="Scratch parent; prefer a local SSD with enough free space")
    parser.add_argument("--batch-size", type=int, default=50000)
    args = parser.parse_args()
    try:
        return run(args)
    except (OSError, ValueError, sqlite3.Error) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
