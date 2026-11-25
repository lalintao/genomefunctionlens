#!/usr/bin/env python3
"""Update an existing project_data SQLite database without project imports.

Run this file from a project_data directory:

    python update_project_data_indexes.py

The script intentionally does not create a database backup. Stop the backend
before running it.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from contextlib import closing
from pathlib import Path


REQUIRED_INDEXES = (
    (
        "idx_protein_annotation_lookup",
        "CREATE INDEX IF NOT EXISTS idx_protein_annotation_lookup "
        "ON protein_annotation(annotation_type, annotation_id, genome_id, protein_key)",
        "protein_annotation",
        False,
        ("annotation_type", "annotation_id", "genome_id", "protein_key"),
    ),
    (
        "idx_protein_annotation_genome",
        "CREATE INDEX IF NOT EXISTS idx_protein_annotation_genome "
        "ON protein_annotation(genome_id, annotation_type, annotation_id)",
        "protein_annotation",
        False,
        ("genome_id", "annotation_type", "annotation_id"),
    ),
    (
        "idx_protein_genome_range",
        "CREATE INDEX IF NOT EXISTS idx_protein_genome_range ON protein(genome_id, protein_key)",
        "protein",
        False,
        ("genome_id", "protein_key"),
    ),
    (
        "idx_genome_id",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_genome_id ON genome(genome_id)",
        "genome",
        True,
        ("genome_id",),
    ),
    (
        "idx_genome_leaf_node",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_genome_leaf_node ON genome(leaf_node_id)",
        "genome",
        True,
        ("leaf_node_id",),
    ),
    (
        "idx_tree_node_id",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_tree_node_id ON tree_node(node_id)",
        "tree_node",
        True,
        ("node_id",),
    ),
    (
        "idx_taxonomy_leaf_node",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_taxonomy_leaf_node ON taxonomy(node_id)",
        "taxonomy",
        True,
        ("node_id",),
    ),
    (
        "idx_module_kegg_member_module_annotation_id",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_module_kegg_member_module_annotation_id "
        "ON module_kegg_member(module_annotation_id)",
        "module_kegg_member",
        True,
        ("module_annotation_id",),
    ),
)

LEGACY_INDEX_NAMES = (
    "idx_download_protein_annotation_lookup",
    "idx_genome_leaf_node_id",
    "idx_taxonomy_node_id",
    "idx_module_member_module",
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Update project_data indexes in-place without creating a database backup."
    )
    parser.add_argument(
        "--package-root",
        type=Path,
        default=Path.cwd(),
        help="Existing project_data directory. Defaults to the current directory.",
    )
    args = parser.parse_args()
    package_root = args.package_root.resolve()
    sqlite_path = package_root / "database" / "web_database.sqlite"
    if not sqlite_path.is_file():
        raise FileNotFoundError(f"Runtime database does not exist: {sqlite_path}")

    print("Stop the backend before continuing. No database backup will be created.")
    with closing(sqlite3.connect(sqlite_path, timeout=30)) as conn:
        conn.execute("PRAGMA busy_timeout = 30000")
        apply_indexes(conn)
        summary = verify_indexes(conn, sqlite_path)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def apply_indexes(conn: sqlite3.Connection) -> None:
    if conn.in_transaction:
        raise RuntimeError("Database connection has an active transaction")
    try:
        conn.execute("BEGIN IMMEDIATE")
        for _, statement, _, _, _ in REQUIRED_INDEXES:
            conn.execute(statement)
        for index_name in LEGACY_INDEX_NAMES:
            conn.execute(f"DROP INDEX IF EXISTS {index_name}")
        validate_index_definitions(conn)
        conn.execute("ANALYZE")
        conn.execute("COMMIT")
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    conn.execute("PRAGMA optimize")


def verify_indexes(conn: sqlite3.Connection, sqlite_path: Path) -> dict[str, object]:
    integrity = [str(row[0]) for row in conn.execute("PRAGMA integrity_check")]
    if integrity != ["ok"]:
        raise RuntimeError(f"PRAGMA integrity_check failed: {integrity}")

    validate_index_definitions(conn)
    index_rows = conn.execute(
        "SELECT name, sql FROM sqlite_master WHERE type = 'index' ORDER BY tbl_name, name"
    ).fetchall()
    index_names = {str(row[0]) for row in index_rows}
    required_names = {item[0] for item in REQUIRED_INDEXES}
    missing = sorted(required_names - index_names)
    remaining_legacy = sorted(set(LEGACY_INDEX_NAMES) & index_names)
    if missing or remaining_legacy:
        raise RuntimeError(f"Index verification failed: missing={missing}, remaining_legacy={remaining_legacy}")

    sample = conn.execute(
        "SELECT annotation_type, annotation_id, genome_id FROM protein_annotation LIMIT 1"
    ).fetchone()
    if sample is None:
        raise RuntimeError("protein_annotation has no rows; cannot verify a real query plan")
    plan = [
        str(row[3])
        for row in conn.execute(
            "EXPLAIN QUERY PLAN "
            "SELECT protein_key FROM protein_annotation "
            "WHERE annotation_type = ? AND annotation_id = ? AND genome_id = ?",
            tuple(sample),
        )
    ]
    if any("SCAN protein_annotation" in detail for detail in plan) or not any(
        "SEARCH protein_annotation USING" in detail for detail in plan
    ):
        raise RuntimeError(f"protein_annotation query plan does not use an index: {plan}")

    return {
        "database": str(sqlite_path),
        "backup": None,
        "integrity_check": integrity,
        "indexes": [{"name": str(name), "sql": sql} for name, sql in index_rows],
        "query_plan_sample": {
            "annotation_type": sample[0],
            "annotation_id": sample[1],
            "genome_id": sample[2],
        },
        "query_plan": plan,
    }


def validate_index_definitions(conn: sqlite3.Connection) -> None:
    problems: list[str] = []
    for index_name, _, expected_table, expected_unique, expected_columns in REQUIRED_INDEXES:
        row = conn.execute(
            "SELECT tbl_name FROM sqlite_master WHERE type = 'index' AND name = ?",
            (index_name,),
        ).fetchone()
        if row is None:
            problems.append(f"{index_name}: missing")
            continue
        actual_table = str(row[0])
        list_row = conn.execute(
            'SELECT "unique", partial FROM pragma_index_list(?) WHERE name = ?',
            (actual_table, index_name),
        ).fetchone()
        actual_unique = bool(list_row[0]) if list_row is not None else False
        actual_partial = bool(list_row[1]) if list_row is not None else False
        actual_columns = tuple(
            (str(item[0]), bool(item[1]), str(item[2]).upper())
            for item in conn.execute(
                "SELECT name, desc, coll FROM pragma_index_xinfo(?) "
                "WHERE key = 1 ORDER BY seqno",
                (index_name,),
            )
        )
        expected_key_columns = tuple(
            (column, False, "BINARY") for column in expected_columns
        )
        if (
            actual_table != expected_table
            or actual_unique != expected_unique
            or actual_partial
            or actual_columns != expected_key_columns
        ):
            problems.append(
                f"{index_name}: expected table={expected_table}, unique={expected_unique}, "
                f"partial=False, columns={expected_key_columns}; got table={actual_table}, "
                f"unique={actual_unique}, partial={actual_partial}, columns={actual_columns}"
            )
    if problems:
        raise RuntimeError("Required index definitions are invalid: " + "; ".join(problems))


if __name__ == "__main__":
    main()
