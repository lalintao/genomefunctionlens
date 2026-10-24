#!/usr/bin/env python3
"""Rebuild COG, KEGG, and Pfam matrices from a completed runtime package.

This repair tool deliberately uses the package SQLite ``protein`` table instead
of loading every FASTA record into memory. Annotation identifiers are compared
as exact strings from the first TSV column; no identifier pattern is assumed.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor
import json
import math
import re
import shutil
import sqlite3
import tempfile
from pathlib import Path

import pandas as pd


ANNOTATION_TYPES = ("cog", "kegg", "pfam")
MIN_SHARD_BYTES = 64 * 1024 * 1024
TASKS_PER_WORKER = 2


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package-root", type=Path, required=True, help="Existing project_data directory.")
    parser.add_argument("--workspace", type=Path, default=Path.cwd(), help="Workspace containing row_data.")
    parser.add_argument("--annotation-dir", type=Path, default=None, help="Directory containing cog.tsv, kegg.tsv, and pfam.tsv.")
    parser.add_argument("--temp-root", type=Path, default=None, help="Filesystem with ample temporary space for SQLite indexes.")
    parser.add_argument("--workers", type=int, default=8, help="Parallel TSV parsing workers.")
    parser.add_argument("--annotation-chunk-rows", type=int, default=250_000, help="Rows per temporary Parquet chunk.")
    parser.add_argument("--output-dir", type=Path, required=True, help="Directory where the portable repair bundle will be created.")
    parser.add_argument("--force", action="store_true", help="Replace an existing repair bundle.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    package_root = args.package_root.resolve()
    manifest_path = package_root / "backend_ready" / "manifest.json"
    sqlite_path = package_root / "database" / "web_database.sqlite"
    output_dir = args.output_dir.resolve()
    matrices_dir = output_dir / "processed" / "matrices"
    if not manifest_path.is_file() or not sqlite_path.is_file():
        raise FileNotFoundError("package-root must contain backend_ready/manifest.json and database/web_database.sqlite")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    database_name = str(manifest["genome_database"])
    annotation_dir = (args.annotation_dir or args.workspace / "row_data" / "protein_anno" / database_name / "annotation").resolve()
    missing = [annotation_dir / f"{kind}.tsv" for kind in ANNOTATION_TYPES if not (annotation_dir / f"{kind}.tsv").is_file()]
    if missing:
        raise FileNotFoundError(f"Annotation files not found: {', '.join(map(str, missing))}")

    if output_dir.exists():
        if not args.force:
            raise FileExistsError(f"Repair bundle already exists: {output_dir}. Re-run with --force.")
        shutil.rmtree(output_dir)
    matrices_dir.mkdir(parents=True, exist_ok=True)

    temp_root = (args.temp_root or args.workspace / "temporary_file" / "matrix_rebuild").resolve()
    temp_root.mkdir(parents=True, exist_ok=True)
    # SQLite can keep a short-lived file handle open on Windows after DETACH.
    # Ignoring that cleanup error is safe: the directory contains only rebuild
    # scratch data and is removed normally on Linux, where this runs in bulk.
    with tempfile.TemporaryDirectory(prefix="annotation_matrix_", dir=temp_root, ignore_cleanup_errors=True) as temp_dir:
        result_rows = _rebuild_all(
            sqlite_path=sqlite_path,
            annotation_dir=annotation_dir,
            matrices_dir=matrices_dir,
            temporary_db_path=Path(temp_dir) / "annotation_input.sqlite",
            chunk_root=Path(temp_dir) / "annotation_chunks",
            repair_sqlite_path=output_dir / "database" / "annotation_repair.sqlite",
            database_name=database_name,
            workers=max(1, args.workers),
            annotation_chunk_rows=max(1, args.annotation_chunk_rows),
        )

    protein_annotation_rows = sum(int(row.pop("protein_annotation_rows")) for row in result_rows)
    patched_matrices = [
        row for row in manifest.get("matrices", []) if row.get("matrix_kind") != "annotation"
    ] + result_rows
    repair_manifest = {
        "format": "webdb_annotation_repair_v1",
        "source_genome_database": database_name,
        "matrices": patched_matrices,
        "protein_annotation_rows": protein_annotation_rows,
        "annotation_tables": {f"{kind}_annotation": _annotation_table_count(sqlite_path, kind) for kind in ANNOTATION_TYPES},
    }
    repair_manifest["repair"] = {
        "source": str(annotation_dir),
        "matched_annotation_rows": {row["annotation_type"]: row["matched_hit_rows"] for row in result_rows},
    }
    for row in result_rows:
        row.pop("matched_hit_rows")
    (output_dir / "repair_manifest.json").write_text(json.dumps(repair_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"repair_bundle": str(output_dir), "matrices": result_rows, "protein_annotation_rows": protein_annotation_rows}, ensure_ascii=False, indent=2))


def _rebuild_all(*, sqlite_path: Path, annotation_dir: Path, matrices_dir: Path, temporary_db_path: Path, chunk_root: Path, repair_sqlite_path: Path, database_name: str, workers: int, annotation_chunk_rows: int) -> list[dict[str, object]]:
    repair_sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(sqlite_path) as runtime_conn, sqlite3.connect(temporary_db_path) as input_conn, sqlite3.connect(repair_sqlite_path) as repair_conn:
        repair_conn.execute("CREATE TABLE protein_annotation (annotation_hit_id INTEGER, annotation_type TEXT, annotation_id INTEGER, genome_id INTEGER, protein_key INTEGER)")
        repair_conn.execute("CREATE TABLE matrix_file (matrix_kind TEXT, genome_database TEXT, annotation_type TEXT, matrix_path TEXT, matrix_format TEXT, row_count INTEGER, column_count INTEGER, value_type TEXT)")
        runtime_conn.execute("CREATE INDEX IF NOT EXISTS idx_protein_id_rebuild ON protein(protein_id)")
        runtime_conn.commit()
        input_conn.execute("ATTACH DATABASE ? AS runtime", (str(sqlite_path),))
        genome_ids = pd.read_sql_query("SELECT genome_id FROM genome ORDER BY genome_id", runtime_conn)["genome_id"].astype(int).tolist()
        rows: list[dict[str, object]] = []
        next_hit_id = 1
        for annotation_type in ANNOTATION_TYPES:
            source_path = annotation_dir / f"{annotation_type}.tsv"
            chunk_paths = _stage_annotation_tsv(
                source_path=source_path,
                output_dir=chunk_root / annotation_type,
                workers=workers,
                chunk_rows=annotation_chunk_rows,
            )
            _load_annotation_chunks(input_conn, chunk_paths)
            grouped = pd.read_sql_query(
                """
                SELECT p.genome_id, a.annotation_value, COUNT(DISTINCT p.protein_key) AS hit_count
                FROM annotation_input AS a
                JOIN runtime.protein AS p ON p.protein_id = a.protein_id
                GROUP BY p.genome_id, a.annotation_value
                ORDER BY p.genome_id, a.annotation_value
                """,
                input_conn,
            )
            if grouped.empty:
                examples = input_conn.execute("SELECT protein_id FROM annotation_input LIMIT 5").fetchall()
                raise ValueError(f"No {annotation_type} annotation IDs matched the runtime protein table. Examples: {examples}")
            _ensure_annotation_values(runtime_conn, annotation_type, grouped["annotation_value"].astype(str).unique().tolist())
            annotation_id_lookup = dict(runtime_conn.execute(f"SELECT annotation_value, annotation_id FROM {annotation_type}_annotation"))
            ordered_columns = pd.read_sql_query(
                f"SELECT annotation_value FROM {annotation_type}_annotation WHERE annotation_value IN ({','.join('?' for _ in grouped['annotation_value'].unique())}) ORDER BY annotation_value",
                runtime_conn,
                params=grouped["annotation_value"].astype(str).unique().tolist(),
            )["annotation_value"].astype(str).tolist()
            matrix = grouped.pivot(index="genome_id", columns="annotation_value", values="hit_count").fillna(0)
            matrix = matrix.reindex(index=genome_ids, columns=ordered_columns, fill_value=0).astype("int32")
            output_path = matrices_dir / f"{annotation_type}.parquet"
            matrix.reset_index(drop=True).to_parquet(output_path, index=False)
            hit_rows = 0
            hits_sql = """
                SELECT p.genome_id, p.protein_key, a.annotation_value
                FROM annotation_input AS a JOIN runtime.protein AS p ON p.protein_id = a.protein_id
                ORDER BY a.annotation_value, p.genome_id, p.protein_key
            """
            for hit_chunk in pd.read_sql_query(hits_sql, input_conn, chunksize=annotation_chunk_rows):
                hit_chunk.insert(0, "annotation_hit_id", range(next_hit_id, next_hit_id + len(hit_chunk)))
                hit_chunk.insert(1, "annotation_type", annotation_type)
                hit_chunk.insert(2, "annotation_id", hit_chunk.pop("annotation_value").map(annotation_id_lookup).astype(int))
                repair_conn.executemany("INSERT INTO protein_annotation VALUES (?, ?, ?, ?, ?)", hit_chunk.itertuples(index=False, name=None))
                next_hit_id += len(hit_chunk)
                hit_rows += len(hit_chunk)
            rows.append({
                "matrix_kind": "annotation",
                "genome_database": database_name,
                "annotation_type": annotation_type,
                "matrix_path": f"processed/matrices/{annotation_type}.parquet",
                "matrix_format": "parquet_wide_row_ordered",
                "row_count": len(genome_ids),
                "column_count": len(ordered_columns),
                "value_type": "protein_hit_count",
                "matched_hit_rows": int(len(grouped)),
                "protein_annotation_rows": hit_rows,
            })
            input_conn.execute("DROP TABLE annotation_input")
            input_conn.commit()
        input_conn.execute("DETACH DATABASE runtime")
        for annotation_type in ANNOTATION_TYPES:
            pd.read_sql_query(f"SELECT * FROM {annotation_type}_annotation", runtime_conn).to_sql(annotation_type + "_annotation", repair_conn, index=False, if_exists="replace")
        registry_columns = ["matrix_kind", "genome_database", "annotation_type", "matrix_path", "matrix_format", "row_count", "column_count", "value_type"]
        repair_conn.executemany("INSERT INTO matrix_file VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [tuple(row[column] for column in registry_columns) for row in rows])
        repair_conn.execute("CREATE INDEX idx_protein_annotation_lookup ON protein_annotation(annotation_type, annotation_id, genome_id, protein_key)")
        repair_conn.execute("CREATE INDEX idx_protein_annotation_genome ON protein_annotation(genome_id, annotation_type, annotation_id)")
        repair_conn.commit()
    return rows


def _stage_annotation_tsv(*, source_path: Path, output_dir: Path, workers: int, chunk_rows: int) -> list[Path]:
    """Reuse the main build's byte-sharded worker pattern without ID filtering."""
    output_dir.mkdir(parents=True, exist_ok=True)
    file_size = max(1, source_path.stat().st_size)
    target_tasks = max(1, workers * TASKS_PER_WORKER)
    shard_bytes = max(MIN_SHARD_BYTES, math.ceil(file_size / target_tasks))
    shard_count = max(1, math.ceil(file_size / shard_bytes))
    tasks = [
        (str(source_path), str(output_dir), shard_index, math.floor(file_size * shard_index / shard_count), math.floor(file_size * (shard_index + 1) / shard_count), chunk_rows)
        for shard_index in range(shard_count)
    ]
    if workers > 1 and len(tasks) > 1:
        with ProcessPoolExecutor(max_workers=min(workers, len(tasks))) as executor:
            chunks_by_task = list(executor.map(_parse_annotation_shard, tasks))
    else:
        chunks_by_task = [_parse_annotation_shard(task) for task in tasks]
    return [Path(chunk) for chunks in chunks_by_task for chunk in chunks]


def _parse_annotation_shard(task: tuple[str, str, int, int, int, int]) -> list[str]:
    source_path_str, output_dir_str, shard_index, start_offset, end_offset, chunk_rows = task
    source_path = Path(source_path_str)
    output_dir = Path(output_dir_str)
    rows: list[tuple[str, str]] = []
    chunk_paths: list[str] = []
    chunk_index = 0

    def flush() -> None:
        nonlocal chunk_index
        if not rows:
            return
        chunk_path = output_dir / f"shard_{shard_index:05d}_chunk_{chunk_index:05d}.parquet"
        pd.DataFrame.from_records(rows, columns=["protein_id", "annotation_value"]).drop_duplicates().to_parquet(chunk_path, index=False)
        rows.clear()
        chunk_paths.append(str(chunk_path))
        chunk_index += 1

    with source_path.open("rb") as handle:
        if start_offset > 0:
            # A byte boundary can land exactly at the first byte of a line.
            # Peek at the previous byte so an aligned boundary does not discard
            # a complete annotation record; only skip a partial first line.
            handle.seek(start_offset - 1)
            if handle.read(1) != b"\n":
                handle.readline()
        else:
            handle.seek(0)
        while handle.tell() < end_offset:
            raw_line = handle.readline()
            if not raw_line:
                break
            fields = re.split(r"[\s,|]+", raw_line.decode("utf-8", errors="replace").strip(), maxsplit=1)
            if len(fields) == 2 and fields[0].strip():
                protein_id, values = fields
                rows.extend((protein_id.strip(), value.strip()) for value in values.split(";;") if value.strip())
            if len(rows) >= chunk_rows:
                flush()
    flush()
    return chunk_paths


def _load_annotation_chunks(conn: sqlite3.Connection, chunk_paths: list[Path]) -> None:
    conn.execute("CREATE TABLE annotation_input (protein_id TEXT NOT NULL, annotation_value TEXT NOT NULL, PRIMARY KEY (protein_id, annotation_value))")
    for chunk_path in chunk_paths:
        rows = pd.read_parquet(chunk_path).itertuples(index=False, name=None)
        conn.executemany("INSERT OR IGNORE INTO annotation_input VALUES (?, ?)", rows)
    conn.execute("CREATE INDEX idx_annotation_input_protein ON annotation_input(protein_id)")
    conn.commit()


def _ensure_annotation_values(conn: sqlite3.Connection, annotation_type: str, values: list[str]) -> None:
    table = f"{annotation_type}_annotation"
    existing = {row[0] for row in conn.execute(f"SELECT annotation_value FROM {table}")}
    missing = sorted(set(values) - existing)
    if not missing:
        return
    next_id = conn.execute(f"SELECT COALESCE(MAX(annotation_id), 0) + 1 FROM {table}").fetchone()[0]
    conn.executemany(
        f"INSERT INTO {table} (annotation_id, annotation_value, short_name, full_name, source, source_version, extra_json, search_text) VALUES (?, ?, '', '', '', '', '', ?)",
        [(next_id + index, value, value) for index, value in enumerate(missing)],
    )
    conn.commit()


def _annotation_table_count(sqlite_path: Path, annotation_type: str) -> int:
    with sqlite3.connect(sqlite_path) as conn:
        return int(conn.execute(f"SELECT COUNT(*) FROM {annotation_type}_annotation").fetchone()[0])


if __name__ == "__main__":
    main()
