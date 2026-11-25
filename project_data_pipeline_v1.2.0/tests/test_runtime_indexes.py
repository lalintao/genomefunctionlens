from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from webdb_pipeline.runtime_indexes import (
    LEGACY_INDEX_NAMES,
    REQUIRED_INDEX_STATEMENTS,
    apply_runtime_indexes,
    upgrade_runtime_indexes,
    verify_runtime_indexes,
)


class RuntimeIndexTests(unittest.TestCase):
    def test_apply_runtime_indexes_creates_required_indexes_and_drops_legacy_indexes(self) -> None:
        with sqlite3.connect(":memory:") as conn:
            _create_runtime_schema(conn)
            _insert_runtime_rows(conn)
            _create_legacy_indexes(conn)

            apply_runtime_indexes(conn)
            verification = verify_runtime_indexes(conn)

            index_names = {row[1] for row in conn.execute("PRAGMA index_list('protein_annotation')")}
            self.assertIn("idx_protein_annotation_lookup", index_names)
            self.assertTrue(
                any("SEARCH protein_annotation USING" in detail for detail in verification["query_plan"])
            )
            all_index_names = {
                row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'index'")
            }
            self.assertTrue(_required_index_names() <= all_index_names)
            self.assertTrue(set(LEGACY_INDEX_NAMES).isdisjoint(all_index_names))
            module_member_indexes = {
                row[1] for row in conn.execute("PRAGMA index_list('module_kegg_member')")
            }
            self.assertEqual(
                module_member_indexes,
                {"idx_module_kegg_member_module_annotation_id"},
            )

    def test_upgrade_runtime_indexes_backs_up_database_before_modifying_it(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            package_root = Path(temp_dir) / "project_data"
            database_dir = package_root / "database"
            database_dir.mkdir(parents=True)
            sqlite_path = database_dir / "web_database.sqlite"
            with closing(sqlite3.connect(sqlite_path)) as conn:
                _create_runtime_schema(conn)
                _insert_runtime_rows(conn)
                _create_legacy_indexes(conn)

            backup_path = database_dir / "before-runtime-indexes.sqlite"
            result = upgrade_runtime_indexes(package_root=package_root, backup_path=backup_path)

            self.assertTrue(backup_path.is_file())
            with closing(sqlite3.connect(backup_path)) as backup_conn:
                backup_indexes = {
                    row[0] for row in backup_conn.execute("SELECT name FROM sqlite_master WHERE type = 'index'")
                }
                self.assertIn("idx_download_protein_annotation_lookup", backup_indexes)
                self.assertNotIn("idx_module_kegg_member_module_annotation_id", backup_indexes)
            with closing(sqlite3.connect(sqlite_path)) as upgraded_conn:
                upgraded_indexes = {
                    row[0] for row in upgraded_conn.execute("SELECT name FROM sqlite_master WHERE type = 'index'")
                }
                self.assertTrue(_required_index_names() <= upgraded_indexes)
                self.assertTrue(set(LEGACY_INDEX_NAMES).isdisjoint(upgraded_indexes))
                self.assertEqual(upgraded_conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")

    def test_apply_runtime_indexes_rolls_back_when_unique_data_is_invalid(self) -> None:
        with sqlite3.connect(":memory:") as conn:
            _create_runtime_schema(conn)
            conn.executemany(
                "INSERT INTO genome VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (0, 10, "a", "db", 90.0, 1.0, 89.0, 0),
                    (0, 11, "b", "db", 90.0, 1.0, 89.0, 0),
                ],
            )
            conn.commit()

            with self.assertRaises(sqlite3.IntegrityError):
                apply_runtime_indexes(conn)

            index_names = {
                row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'index'")
            }
            self.assertTrue(_required_index_names().isdisjoint(index_names))

    def test_apply_runtime_indexes_rejects_a_same_name_index_with_the_wrong_definition(self) -> None:
        with sqlite3.connect(":memory:") as conn:
            _create_runtime_schema(conn)
            _insert_runtime_rows(conn)
            conn.execute("CREATE INDEX idx_genome_id ON genome(leaf_node_id)")
            conn.commit()

            with self.assertRaisesRegex(RuntimeError, "idx_genome_id"):
                apply_runtime_indexes(conn)

            index_names = {
                row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'index'")
            }
            self.assertEqual(index_names, {"idx_genome_id"})

    def test_upgrade_cleans_up_an_invalid_temporary_backup(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            package_root = Path(temp_dir) / "project_data"
            database_dir = package_root / "database"
            database_dir.mkdir(parents=True)
            sqlite_path = database_dir / "web_database.sqlite"
            with closing(sqlite3.connect(sqlite_path)) as conn:
                _create_runtime_schema(conn)
                _insert_runtime_rows(conn)

            with patch(
                "webdb_pipeline.runtime_indexes._integrity_check_rows",
                return_value=["invalid backup"],
            ):
                with self.assertRaisesRegex(RuntimeError, "Backup integrity check failed"):
                    upgrade_runtime_indexes(
                        package_root=package_root,
                        backup_path=database_dir / "backup.sqlite",
                    )

            self.assertFalse((database_dir / "backup.sqlite").exists())
            self.assertEqual(list(database_dir.glob(".*.tmp")), [])

    def test_apply_runtime_indexes_rejects_a_partial_same_name_index(self) -> None:
        with sqlite3.connect(":memory:") as conn:
            _create_runtime_schema(conn)
            _insert_runtime_rows(conn)
            conn.execute(
                "CREATE UNIQUE INDEX idx_genome_id ON genome(genome_id) WHERE genome_id >= 0"
            )
            conn.commit()

            with self.assertRaisesRegex(RuntimeError, "partial=True"):
                apply_runtime_indexes(conn)

    def test_upgrade_does_not_overwrite_a_backup_created_concurrently(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            package_root = Path(temp_dir) / "project_data"
            database_dir = package_root / "database"
            database_dir.mkdir(parents=True)
            sqlite_path = database_dir / "web_database.sqlite"
            backup_path = database_dir / "reserved-backup.sqlite"
            with closing(sqlite3.connect(sqlite_path)) as conn:
                _create_runtime_schema(conn)
                _insert_runtime_rows(conn)

            def reserve_backup_path(_conn: sqlite3.Connection) -> list[str]:
                backup_path.write_text("other process", encoding="ascii")
                return ["ok"]

            with patch(
                "webdb_pipeline.runtime_indexes._integrity_check_rows",
                side_effect=reserve_backup_path,
            ):
                with self.assertRaises(FileExistsError):
                    upgrade_runtime_indexes(
                        package_root=package_root,
                        backup_path=backup_path,
                    )

            self.assertEqual(backup_path.read_text(encoding="ascii"), "other process")
            self.assertEqual(list(database_dir.glob(".*.tmp")), [])

    def test_upgrade_does_not_create_a_backup_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            package_root = Path(temp_dir) / "project_data"
            database_dir = package_root / "database"
            database_dir.mkdir(parents=True)
            sqlite_path = database_dir / "web_database.sqlite"
            with closing(sqlite3.connect(sqlite_path)) as conn:
                _create_runtime_schema(conn)
                _insert_runtime_rows(conn)
                _create_legacy_indexes(conn)

            result = upgrade_runtime_indexes(package_root=package_root)

            self.assertIsNone(result["backup"])
            self.assertEqual(list(database_dir.glob("*before-runtime-indexes*")), [])
            self.assertEqual(list(database_dir.glob(".*.tmp")), [])
            with closing(sqlite3.connect(sqlite_path)) as upgraded_conn:
                upgraded_indexes = {
                    row[0]
                    for row in upgraded_conn.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'index'"
                    )
                }
            self.assertTrue(_required_index_names() <= upgraded_indexes)
            self.assertTrue(set(LEGACY_INDEX_NAMES).isdisjoint(upgraded_indexes))

    def test_standalone_script_runs_without_project_imports(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            package_root = Path(temp_dir) / "project_data"
            database_dir = package_root / "database"
            database_dir.mkdir(parents=True)
            sqlite_path = database_dir / "web_database.sqlite"
            with closing(sqlite3.connect(sqlite_path)) as conn:
                _create_runtime_schema(conn)
                _insert_runtime_rows(conn)
                _create_legacy_indexes(conn)

            script_path = Path(__file__).parents[1] / "update_project_data_indexes.py"
            completed = subprocess.run(
                [sys.executable, str(script_path), "--package-root", str(package_root)],
                check=True,
                capture_output=True,
                text=True,
            )
            summary = json.loads(completed.stdout[completed.stdout.index("{") :])

            self.assertIsNone(summary["backup"])
            self.assertEqual(summary["integrity_check"], ["ok"])
            self.assertTrue(any("SEARCH protein_annotation USING" in detail for detail in summary["query_plan"]))
            self.assertEqual(list(database_dir.glob("*before-runtime-indexes*")), [])

    def test_apply_runtime_indexes_rejects_a_different_same_name_collation(self) -> None:
        with sqlite3.connect(":memory:") as conn:
            _create_runtime_schema(conn)
            _insert_runtime_rows(conn)
            conn.execute(
                "CREATE INDEX idx_protein_annotation_lookup ON protein_annotation("
                "annotation_type COLLATE NOCASE, annotation_id, genome_id, protein_key)"
            )
            conn.commit()

            with self.assertRaisesRegex(RuntimeError, "NOCASE"):
                apply_runtime_indexes(conn)


def _create_runtime_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE protein_annotation (
            annotation_type TEXT,
            annotation_id INTEGER,
            genome_id INTEGER,
            protein_key INTEGER
        );
        CREATE TABLE protein (genome_id INTEGER, protein_key INTEGER);
        CREATE TABLE genome (
            genome_id INTEGER,
            leaf_node_id INTEGER,
            genome_accession TEXT,
            genome_database TEXT,
            checkm2_completeness REAL,
            checkm2_contamination REAL,
            quality_score REAL,
            if_refseq INTEGER DEFAULT 0
        );
        CREATE TABLE tree_node (node_id INTEGER, parent_id INTEGER, node_in INTEGER, node_out INTEGER);
        CREATE TABLE taxonomy (node_id INTEGER);
        CREATE TABLE module_kegg_member (module_annotation_id INTEGER);
        CREATE TABLE tree_named_taxon_index (rank TEXT, taxon_name_norm TEXT, node_id INTEGER);
        CREATE TABLE matrix_file (genome_database TEXT, matrix_kind TEXT, annotation_type TEXT);
        CREATE TABLE tree_dataset (species_tree TEXT, genome_database TEXT);
        CREATE TABLE cog_annotation (annotation_id INTEGER, annotation_value TEXT);
        CREATE TABLE pfam_annotation (annotation_id INTEGER, annotation_value TEXT);
        CREATE TABLE kegg_annotation (annotation_id INTEGER, annotation_value TEXT);
        CREATE TABLE module_annotation (annotation_id INTEGER, annotation_value TEXT);
        """
    )


def _insert_runtime_rows(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT INTO genome "
        "(genome_id, leaf_node_id, genome_accession, genome_database, "
        "checkm2_completeness, checkm2_contamination, quality_score, if_refseq) "
        "VALUES (0, 10, 'genome-a', 'fixture', 95.0, 1.0, 94.0, 1)"
    )
    conn.execute("INSERT INTO tree_node VALUES (10, NULL, 0, 1)")
    conn.execute("INSERT INTO taxonomy VALUES (10)")
    conn.execute("INSERT INTO module_kegg_member VALUES (1)")
    conn.execute("INSERT INTO protein VALUES (0, 100)")
    conn.executemany(
        "INSERT INTO protein_annotation VALUES (?, ?, ?, ?)",
        [("kegg", annotation_id, 0, 100 + annotation_id) for annotation_id in range(1_000)],
    )
    conn.execute("INSERT INTO tree_named_taxon_index VALUES ('species', 'fixture', 10)")
    conn.execute("INSERT INTO matrix_file VALUES ('fixture', 'annotation', 'kegg')")
    conn.execute("INSERT INTO tree_dataset VALUES ('fixture', 'fixture')")
    for table_name in ("cog_annotation", "pfam_annotation", "kegg_annotation", "module_annotation"):
        conn.execute(f"INSERT INTO {table_name} VALUES (1, 'value')")
    conn.commit()


def _create_legacy_indexes(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE INDEX idx_download_protein_annotation_lookup
        ON protein_annotation(annotation_type, annotation_id, genome_id, protein_key);
        CREATE UNIQUE INDEX idx_genome_leaf_node_id ON genome(leaf_node_id);
        CREATE UNIQUE INDEX idx_taxonomy_node_id ON taxonomy(node_id);
        CREATE UNIQUE INDEX idx_module_member_module
        ON module_kegg_member(module_annotation_id);
        """
    )


def _required_index_names() -> set[str]:
    names = set()
    for statement in REQUIRED_INDEX_STATEMENTS:
        tokens = statement.split()
        names.add(tokens[tokens.index("EXISTS") + 1])
    return names


if __name__ == "__main__":
    unittest.main()
