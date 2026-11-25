from __future__ import annotations

import json
import os
import re
import sqlite3
import tempfile
from pathlib import Path



_TYPE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
_HEADER_NAMES = {"protein_id", "proteinid", "protein", "gene", "gene_id", "geneid"}


def add_annotation_matrix(*, package_root: Path, mapping_file: Path, annotation_type: str) -> dict[str, object]:
    return _rebuild_annotation_matrix(
        package_root=package_root,
        mapping_file=mapping_file,
        annotation_type=annotation_type,
        replace=False,
    )


def update_annotation_matrix(*, package_root: Path, mapping_file: Path, annotation_type: str) -> dict[str, object]:
    return _rebuild_annotation_matrix(
        package_root=package_root,
        mapping_file=mapping_file,
        annotation_type=annotation_type,
        replace=True,
    )


def _rebuild_annotation_matrix(
    *, package_root: Path, mapping_file: Path, annotation_type: str, replace: bool
) -> dict[str, object]:
    package_root = package_root.resolve()
    mapping_file = mapping_file.resolve()
    kind = _normalize_type(annotation_type)
    sqlite_path = package_root / "database" / "web_database.sqlite"
    manifest_path = package_root / "backend_ready" / "manifest.json"
    if not sqlite_path.is_file() or not manifest_path.is_file():
        raise FileNotFoundError("package-root must contain database/web_database.sqlite and backend_ready/manifest.json")
    if not mapping_file.is_file():
        raise FileNotFoundError(mapping_file)

    from contextlib import closing
    from .runtime_package import AnnotationStage, _write_annotation_matrix_parquet

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    table_name = f"{kind}_annotation"
    matrix_dir = package_root / "processed" / "matrices"
    matrix_path = matrix_dir / f"{kind}.parquet"
    # Keep staging on the package filesystem so publication uses atomic renames.
    with tempfile.TemporaryDirectory(prefix=".annotation-update-", dir=package_root) as scratch:
        stage_path = Path(scratch) / "stage.sqlite"
        staged_matrix = Path(scratch) / "matrix.parquet"
        staged_manifest = Path(scratch) / "manifest.json"
        with closing(sqlite3.connect(sqlite_path)) as conn:
            conn.execute("ATTACH DATABASE ? AS stage", (str(stage_path),))
            conn.execute("BEGIN IMMEDIATE")
            installed = False
            old_matrix = Path(scratch) / "old.parquet"
            old_manifest = manifest_path.read_bytes()
            try:
                registered = conn.execute("SELECT 1 FROM matrix_file WHERE matrix_kind='annotation' AND annotation_type=?", (kind,)).fetchone()
                exists = _table_exists(conn, table_name)
                if not replace and (exists or registered or matrix_path.exists()):
                    raise FileExistsError(f"Annotation type already exists: {kind}; use update-annotation-matrix")
                if replace and not (exists and registered):
                    raise ValueError(f"Annotation type does not exist: {kind}; use add-annotation-matrix")
                genome_ids = [int(row[0]) for row in conn.execute("SELECT genome_id FROM genome ORDER BY genome_id")]
                if not genome_ids or genome_ids != list(range(len(genome_ids))):
                    raise ValueError("genome_id must be nonempty, dense and zero-based")
                stats = _load_mapping(conn, mapping_file)
                conn.execute("CREATE TABLE stage.annotation_hit_stage AS SELECT DISTINCT ? AS annotation_type, a.annotation_value, p.genome_id, p.protein_key FROM stage.mapping a JOIN protein p ON p.protein_id=a.protein_id", (kind,))
                conn.execute("CREATE INDEX stage.hit_lookup ON annotation_hit_stage(annotation_type, genome_id, annotation_value)")
                matched_count = conn.execute("SELECT COUNT(*) FROM stage.annotation_hit_stage").fetchone()[0]
                if not matched_count:
                    raise ValueError("No mapping protein IDs matched the runtime protein table")
                values = [r[0] for r in conn.execute("SELECT DISTINCT annotation_value FROM stage.annotation_hit_stage ORDER BY annotation_value")]
                # The writer reads staging through its own connection.
                conn.commit()
                stage = AnnotationStage(sqlite_path=stage_path, chunk_paths=[], input_file_count=1, shard_count=1)
                _write_annotation_matrix_parquet(annotation_stage=stage, annotation_type=kind, columns=values, genome_ids=genome_ids, output_path=staged_matrix)
                conn.execute("BEGIN IMMEDIATE")
                _ensure_annotation_table(conn, table_name)
                _merge_annotation_dictionary(conn, table_name, values)
                conn.execute("DELETE FROM protein_annotation WHERE annotation_type=?", (kind,))
                next_id = conn.execute("SELECT COALESCE(MAX(annotation_hit_id),0) FROM protein_annotation").fetchone()[0]
                conn.execute(f"INSERT INTO protein_annotation (annotation_hit_id,annotation_type,annotation_id,genome_id,protein_key) SELECT ? + ROW_NUMBER() OVER (ORDER BY h.genome_id,h.protein_key,h.annotation_value), ?, d.annotation_id,h.genome_id,h.protein_key FROM stage.annotation_hit_stage h JOIN {table_name} d ON d.annotation_value=h.annotation_value", (next_id,kind))
                _upsert_matrix_registry(conn, kind, package_root, len(genome_ids), len(values))
                conn.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS idx_{table_name}_id ON {table_name}(annotation_id)")
                conn.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS idx_{table_name}_value ON {table_name}(annotation_value)")
                staged_manifest.write_bytes(old_manifest)
                _update_manifest(staged_manifest, kind, len(genome_ids), len(values), matched_count)
                updated = json.loads(staged_manifest.read_text(encoding="utf-8"))
                updated["entity_counts"]["protein_annotation"] = conn.execute("SELECT COUNT(*) FROM protein_annotation").fetchone()[0]
                updated["annotation_tables"][table_name] = conn.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
                if "annotation_hit_counts" in updated:
                    updated["annotation_hit_counts"][kind] = matched_count
                updated.setdefault("build_performance", {}).setdefault("annotation_hit_counts", {})[kind] = matched_count
                staged_manifest.write_text(json.dumps(updated, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
                matrix_dir.mkdir(parents=True, exist_ok=True)
                if matrix_path.exists():
                    os.replace(matrix_path, old_matrix)
                installed = True
                os.replace(staged_matrix, matrix_path)
                os.replace(staged_manifest, manifest_path)
                conn.commit()
            except BaseException:
                conn.rollback()
                if installed:
                    matrix_path.unlink(missing_ok=True)
                    if old_matrix.exists():
                        os.replace(old_matrix, matrix_path)
                    manifest_path.write_bytes(old_manifest)
                raise
    return {"operation": "update" if replace else "add", "annotation_type": kind,
            "matrix_path": str(matrix_path), "row_count": len(genome_ids),
            "column_count": len(values), "matched_mapping_rows": matched_count, **stats}


def _normalize_type(value: str) -> str:
    result = value.strip().lower()
    if not _TYPE_RE.fullmatch(result):
        raise ValueError("annotation-type must contain only letters, digits, and underscores, and start with a letter")
    if result in {"module", "annotation", "protein", "genome"}:
        raise ValueError(f"reserved annotation type: {result}")
    return result


def _load_mapping(conn: sqlite3.Connection, path: Path) -> dict[str, int]:
    conn.execute("CREATE TABLE stage.mapping (protein_id TEXT, annotation_value TEXT, PRIMARY KEY(protein_id, annotation_value))")
    rows = []
    with path.open("r", encoding="utf-8-sig") as handle:
        for number, raw in enumerate(handle, 1):
            if not raw.strip():
                continue
            fields = re.split(r"[\s,|]+", raw.strip(), maxsplit=1)
            if len(fields) != 2:
                raise ValueError(f"Invalid mapping at line {number}: expected two columns")
            protein_id, values = fields
            if number == 1 and protein_id.lower() in _HEADER_NAMES and values.lower() in {"annotation", "annotation_value", "annotation_name", "annotations"}:
                continue
            annotations = [v.strip() for v in values.split(";;") if v.strip()]
            if not annotations:
                raise ValueError(f"Empty annotation at line {number}")
            rows.extend((protein_id, v) for v in annotations)
            if len(rows) >= 250000:
                conn.executemany("INSERT OR IGNORE INTO stage.mapping VALUES (?,?)", rows)
                rows.clear()
    conn.executemany("INSERT OR IGNORE INTO stage.mapping VALUES (?,?)", rows)
    # Scan proteins once instead of performing a full protein-table scan per input ID.
    conn.execute("CREATE TABLE stage.matched_ids AS SELECT DISTINCT p.protein_id FROM protein p JOIN stage.mapping a ON a.protein_id=p.protein_id")
    conn.execute("CREATE UNIQUE INDEX stage.matched_id ON matched_ids(protein_id)")
    unknown = conn.execute("SELECT COUNT(DISTINCT a.protein_id) FROM stage.mapping a LEFT JOIN stage.matched_ids m ON a.protein_id=m.protein_id WHERE m.protein_id IS NULL").fetchone()[0]
    return {"unmatched_protein_ids": unknown}


def _table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table_name,)).fetchone() is not None


def _ensure_annotation_table(conn: sqlite3.Connection, table_name: str) -> None:
    conn.execute(
        f"""CREATE TABLE IF NOT EXISTS {table_name} (
            annotation_id INTEGER PRIMARY KEY,
            annotation_value TEXT NOT NULL UNIQUE,
            short_name TEXT NOT NULL DEFAULT '',
            full_name TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT '',
            source_version TEXT NOT NULL DEFAULT '',
            extra_json TEXT NOT NULL DEFAULT '',
            search_text TEXT NOT NULL DEFAULT ''
        )"""
    )


def _merge_annotation_dictionary(conn: sqlite3.Connection, table_name: str, values: list[str]) -> dict[str, int]:
    existing = {str(value): int(annotation_id) for annotation_id, value in conn.execute(f"SELECT annotation_id, annotation_value FROM {table_name}")}
    next_id = max(existing.values(), default=0) + 1
    for value in values:
        if value in existing:
            continue
        annotation_id = next_id
        next_id += 1
        conn.execute(
            f"INSERT INTO {table_name} (annotation_id, annotation_value, short_name, full_name, source, source_version, extra_json, search_text) VALUES (?, ?, '', '', '', '', '', ?)",
            (annotation_id, value, value),
        )
        existing[value] = annotation_id
    return existing


def _upsert_matrix_registry(conn: sqlite3.Connection, annotation_type: str, package_root: Path, row_count: int, column_count: int) -> None:
    database_name = str(conn.execute("SELECT genome_database FROM genome ORDER BY genome_id LIMIT 1").fetchone()[0])
    matrix_path = f"processed/matrices/{annotation_type}.parquet"
    conn.execute("DELETE FROM matrix_file WHERE matrix_kind='annotation' AND annotation_type=?", (annotation_type,))
    conn.execute(
        "INSERT INTO matrix_file VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ("annotation", database_name, annotation_type, matrix_path, "parquet_wide_row_ordered", row_count, column_count, "protein_hit_count"),
    )


def _update_manifest(path: Path, annotation_type: str, row_count: int, column_count: int, matched_rows: int) -> None:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    row = {
        "matrix_kind": "annotation",
        "genome_database": manifest.get("genome_database", ""),
        "annotation_type": annotation_type,
        "matrix_path": f"processed/matrices/{annotation_type}.parquet",
        "matrix_format": "parquet_wide_row_ordered",
        "row_count": row_count,
        "column_count": column_count,
        "value_type": "protein_hit_count",
    }
    matrices = [item for item in manifest.get("matrices", []) if not (item.get("matrix_kind") == "annotation" and item.get("annotation_type") == annotation_type)]
    matrices.append(row)
    manifest["matrices"] = matrices
    manifest.setdefault("entity_counts", {})["protein_annotation"] = None
    manifest.setdefault("annotation_tables", {})[f"{annotation_type}_annotation"] = column_count
    manifest.setdefault("annotation_matrix_updates", {})[annotation_type] = {"matched_mapping_rows": matched_rows}
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
