from __future__ import annotations

import argparse
import json
import os
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path


REQUIRED_INDEX_STATEMENTS = (
    "CREATE INDEX IF NOT EXISTS idx_protein_annotation_lookup "
    "ON protein_annotation(annotation_type, annotation_id, genome_id, protein_key)",
    "CREATE INDEX IF NOT EXISTS idx_protein_annotation_genome "
    "ON protein_annotation(genome_id, annotation_type, annotation_id)",
    "CREATE INDEX IF NOT EXISTS idx_protein_genome_range "
    "ON protein(genome_id, protein_key)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_genome_id ON genome(genome_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_genome_leaf_node ON genome(leaf_node_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_tree_node_id ON tree_node(node_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_taxonomy_leaf_node ON taxonomy(node_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_module_kegg_member_module_annotation_id "
    "ON module_kegg_member(module_annotation_id)",
)

REQUIRED_INDEX_SPECS = {
    "idx_protein_annotation_lookup": (
        "protein_annotation",
        False,
        ("annotation_type", "annotation_id", "genome_id", "protein_key"),
    ),
    "idx_protein_annotation_genome": (
        "protein_annotation",
        False,
        ("genome_id", "annotation_type", "annotation_id"),
    ),
    "idx_protein_genome_range": ("protein", False, ("genome_id", "protein_key")),
    "idx_genome_id": ("genome", True, ("genome_id",)),
    "idx_genome_leaf_node": ("genome", True, ("leaf_node_id",)),
    "idx_tree_node_id": ("tree_node", True, ("node_id",)),
    "idx_taxonomy_leaf_node": ("taxonomy", True, ("node_id",)),
    "idx_module_kegg_member_module_annotation_id": (
        "module_kegg_member",
        True,
        ("module_annotation_id",),
    ),
}

SUPPORTING_INDEX_STATEMENTS = (
    "CREATE INDEX IF NOT EXISTS idx_tree_node_parent ON tree_node(parent_id, node_id)",
    "CREATE INDEX IF NOT EXISTS idx_tree_node_dfs ON tree_node(node_in, node_out)",
    "CREATE INDEX IF NOT EXISTS idx_tree_named_taxon_lookup "
    "ON tree_named_taxon_index(rank, taxon_name_norm, node_id)",
    "CREATE INDEX IF NOT EXISTS idx_tree_named_taxon_rank_node ON tree_named_taxon_index(rank, node_id)",
    "CREATE INDEX IF NOT EXISTS idx_genome_accession ON genome(genome_accession)",
    "CREATE INDEX IF NOT EXISTS idx_genome_quality "
    "ON genome(genome_database, checkm2_completeness, checkm2_contamination, quality_score)",
    "CREATE INDEX IF NOT EXISTS idx_genome_refseq ON genome(genome_database, if_refseq)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_protein_key ON protein(protein_key)",
    "CREATE INDEX IF NOT EXISTS idx_matrix_file_lookup "
    "ON matrix_file(genome_database, matrix_kind, annotation_type)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_tree_dataset_key ON tree_dataset(species_tree, genome_database)",
)

LEGACY_INDEX_NAMES = (
    "idx_download_protein_annotation_lookup",
    "idx_genome_leaf_node_id",
    "idx_taxonomy_node_id",
    "idx_module_member_module",
)

ANNOTATION_TABLE_NAMES = (
    "cog_annotation",
    "pfam_annotation",
    "kegg_annotation",
    "module_annotation",
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Update an existing project_data database's runtime indexes, optionally "
            "back it up, and run integrity and query-plan checks."
        )
    )
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
    args = parser.parse_args()
    if args.backup_path:
        print("Stop the backend before continuing. Creating a database backup before changing indexes.")
    else:
        print("Stop the backend before continuing. No database backup will be created.")
    summary = upgrade_runtime_indexes(
        package_root=args.package_root.resolve(),
        backup_path=args.backup_path.resolve() if args.backup_path else None,
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def apply_runtime_indexes(
    conn: sqlite3.Connection,
    *,
    include_supporting_indexes: bool = False,
) -> None:
    """Create runtime indexes and update SQLite planner statistics atomically."""
    if conn.in_transaction:
        raise RuntimeError("apply_runtime_indexes requires a connection with no active transaction")

    supporting_statements: list[str] = []
    if include_supporting_indexes:
        supporting_statements.extend(SUPPORTING_INDEX_STATEMENTS)
        for table_name in ANNOTATION_TABLE_NAMES:
            supporting_statements.extend(
                [
                    f"CREATE UNIQUE INDEX IF NOT EXISTS idx_{table_name}_id ON {table_name}(annotation_id)",
                    f"CREATE UNIQUE INDEX IF NOT EXISTS idx_{table_name}_value ON {table_name}(annotation_value)",
                ]
            )

    try:
        conn.execute("BEGIN IMMEDIATE")
        for statement in (*REQUIRED_INDEX_STATEMENTS, *supporting_statements):
            conn.execute(statement)
        _validate_required_index_definitions(conn)
        for index_name in LEGACY_INDEX_NAMES:
            conn.execute(f"DROP INDEX IF EXISTS {index_name}")
        conn.execute("ANALYZE")
        conn.execute("COMMIT")
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise

    conn.execute("PRAGMA optimize")


def verify_runtime_indexes(conn: sqlite3.Connection) -> dict[str, object]:
    integrity_rows = _integrity_check_rows(conn)
    if integrity_rows != ["ok"]:
        raise RuntimeError(f"PRAGMA integrity_check failed: {integrity_rows}")

    index_rows = conn.execute(
        "SELECT name, sql FROM sqlite_master WHERE type = 'index' ORDER BY tbl_name, name"
    ).fetchall()
    index_names = {str(row[0]) for row in index_rows}
    required_names = set(REQUIRED_INDEX_SPECS)
    missing_indexes = sorted(required_names - index_names)
    remaining_legacy_indexes = sorted(set(LEGACY_INDEX_NAMES) & index_names)
    if missing_indexes or remaining_legacy_indexes:
        raise RuntimeError(
            "Runtime index verification failed: "
            f"missing={missing_indexes}, remaining_legacy={remaining_legacy_indexes}"
        )
    _validate_required_index_definitions(conn)

    sample = conn.execute(
        "SELECT annotation_type, annotation_id, genome_id FROM protein_annotation LIMIT 1"
    ).fetchone()
    if sample is None:
        raise RuntimeError(
            "Cannot verify the protein_annotation query plan because protein_annotation has no rows"
        )
    sample_ids = {
        "annotation_type": sample[0],
        "annotation_id": sample[1],
        "genome_id": sample[2],
    }
    query_plan = [
        str(row[3])
        for row in conn.execute(
            "EXPLAIN QUERY PLAN "
            "SELECT protein_key FROM protein_annotation "
            "WHERE annotation_type = ? AND annotation_id = ? AND genome_id = ?",
            tuple(sample),
        )
    ]
    if any("SCAN protein_annotation" in detail for detail in query_plan) or not any(
        "SEARCH protein_annotation USING" in detail for detail in query_plan
    ):
        raise RuntimeError(f"protein_annotation query plan does not use an index: {query_plan}")

    return {
        "integrity_check": integrity_rows,
        "indexes": [{"name": str(name), "sql": sql} for name, sql in index_rows],
        "query_plan_sample": sample_ids,
        "query_plan": query_plan,
    }


def upgrade_runtime_indexes(
    *,
    package_root: Path,
    backup_path: Path | None = None,
) -> dict[str, object]:
    sqlite_path = package_root / "database" / "web_database.sqlite"
    if not sqlite_path.is_file():
        raise FileNotFoundError(f"Runtime database does not exist: {sqlite_path}")

    resolved_backup_path = backup_path.resolve() if backup_path else None
    if resolved_backup_path is not None:
        if resolved_backup_path == sqlite_path.resolve():
            raise ValueError("Backup path must be different from the runtime database path")
        if resolved_backup_path.exists():
            raise FileExistsError(f"Backup path already exists: {resolved_backup_path}")
        resolved_backup_path.parent.mkdir(parents=True, exist_ok=True)

    with closing(sqlite3.connect(sqlite_path, timeout=30)) as conn:
        conn.execute("PRAGMA busy_timeout = 30000")
        if resolved_backup_path is not None:
            _write_verified_backup(conn, resolved_backup_path)
        apply_runtime_indexes(conn)
        verification = verify_runtime_indexes(conn)

    return {
        "database": str(sqlite_path.resolve()),
        "backup": str(resolved_backup_path) if resolved_backup_path else None,
        **verification,
    }


def _write_verified_backup(source_conn: sqlite3.Connection, backup_path: Path) -> None:
    file_descriptor, temp_name = tempfile.mkstemp(
        prefix=f".{backup_path.name}.",
        suffix=".tmp",
        dir=backup_path.parent,
    )
    os.close(file_descriptor)
    temp_path = Path(temp_name)
    try:
        with closing(sqlite3.connect(temp_path)) as backup_conn:
            source_conn.backup(backup_conn)
            backup_conn.commit()
            integrity_rows = _integrity_check_rows(backup_conn)
            if integrity_rows != ["ok"]:
                raise RuntimeError(f"Backup integrity check failed: {integrity_rows}")
        os.link(temp_path, backup_path)
        temp_path.unlink()
    except BaseException:
        temp_path.unlink(missing_ok=True)
        raise


def _validate_required_index_definitions(conn: sqlite3.Connection) -> None:
    problems: list[str] = []
    for index_name, (expected_table, expected_unique, expected_columns) in REQUIRED_INDEX_SPECS.items():
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
        actual_key_columns = tuple(
            (str(item[0]), bool(item[1]), str(item[2]).upper())
            for item in conn.execute(
                "SELECT name, desc, coll FROM pragma_index_xinfo(?) "
                "WHERE key = 1 ORDER BY seqno",
                (index_name,),
            )
        )
        expected_key_columns = tuple(
            (column_name, False, "BINARY") for column_name in expected_columns
        )
        if (
            actual_table != expected_table
            or actual_unique != expected_unique
            or actual_partial
            or actual_key_columns != expected_key_columns
        ):
            problems.append(
                f"{index_name}: expected table={expected_table}, unique={expected_unique}, "
                f"partial=False, key_columns={expected_key_columns}; got table={actual_table}, "
                f"unique={actual_unique}, partial={actual_partial}, "
                f"key_columns={actual_key_columns}"
            )
    if problems:
        raise RuntimeError("Required runtime index definitions are invalid: " + "; ".join(problems))


def _integrity_check_rows(conn: sqlite3.Connection) -> list[str]:
    return [str(row[0]) for row in conn.execute("PRAGMA integrity_check")]


if __name__ == "__main__":
    main()
