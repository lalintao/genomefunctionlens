#!/usr/bin/env python3
"""Apply a portable annotation repair bundle to an incomplete project_data."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
from pathlib import Path


ANNOTATION_TYPES = ("cog", "kegg", "pfam")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package-root", type=Path, required=True, help="Incomplete target project_data directory.")
    parser.add_argument("--repair-dir", type=Path, required=True, help="Directory produced by rebuild_annotation_matrices.py.")
    parser.add_argument("--force", action="store_true", help="Replace existing annotation matrix files.")
    args = parser.parse_args()

    package_root = args.package_root.resolve()
    repair_dir = args.repair_dir.resolve()
    target_manifest_path = package_root / "backend_ready" / "manifest.json"
    repair_manifest_path = repair_dir / "repair_manifest.json"
    target_sqlite = package_root / "database" / "web_database.sqlite"
    repair_sqlite = repair_dir / "database" / "annotation_repair.sqlite"
    required = [target_manifest_path, repair_manifest_path, target_sqlite, repair_sqlite]
    if any(not path.is_file() for path in required):
        raise FileNotFoundError(f"Missing repair input: {[str(path) for path in required if not path.is_file()]}")

    target_manifest = json.loads(target_manifest_path.read_text(encoding="utf-8"))
    repair_manifest = json.loads(repair_manifest_path.read_text(encoding="utf-8"))
    if repair_manifest.get("format") != "webdb_annotation_repair_v1":
        raise ValueError("Unsupported repair bundle format.")
    if target_manifest.get("genome_database") != repair_manifest.get("source_genome_database"):
        raise ValueError("Repair bundle genome database does not match target package.")
    matrix_sources = [repair_dir / row["matrix_path"] for row in repair_manifest["matrices"] if row["matrix_kind"] == "annotation"]
    if len(matrix_sources) != 3 or any(not path.is_file() for path in matrix_sources):
        raise FileNotFoundError("Repair bundle is missing one or more annotation matrix files.")
    existing = [package_root / row["matrix_path"] for row in repair_manifest["matrices"] if (package_root / row["matrix_path"]).exists()]
    if existing and not args.force:
        raise FileExistsError(f"Target matrix files already exist: {existing}. Re-run with --force.")

    # Install files before changing the registry. A failed copy then leaves the
    # target database in its prior state, with only harmless unregistered files.
    for source in matrix_sources:
        destination = package_root / source.relative_to(repair_dir)
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".repairing")
        shutil.copy2(source, temporary)
        os.replace(temporary, destination)

    _replace_sqlite_tables(target_sqlite, repair_sqlite)

    target_manifest["matrices"] = repair_manifest["matrices"]
    target_manifest.setdefault("entity_counts", {})["protein_annotation"] = int(repair_manifest["protein_annotation_rows"])
    target_manifest["annotation_tables"] = repair_manifest["annotation_tables"]
    target_manifest.setdefault("repair", {})["annotation_repair_applied"] = {
        "bundle": str(repair_dir),
        "protein_annotation_rows": int(repair_manifest["protein_annotation_rows"]),
    }
    target_manifest_path.write_text(json.dumps(target_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "package_root": str(package_root), "protein_annotation_rows": repair_manifest["protein_annotation_rows"]}, ensure_ascii=False, indent=2))


def _replace_sqlite_tables(target_sqlite: Path, repair_sqlite: Path) -> None:
    with sqlite3.connect(target_sqlite) as conn:
        conn.execute("ATTACH DATABASE ? AS repair", (str(repair_sqlite),))
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute("DROP TABLE protein_annotation")
            conn.execute("CREATE TABLE protein_annotation AS SELECT * FROM repair.protein_annotation")
            for annotation_type in ANNOTATION_TYPES:
                table = f"{annotation_type}_annotation"
                conn.execute(f"DROP TABLE {table}")
                conn.execute(f"CREATE TABLE {table} AS SELECT * FROM repair.{table}")
            conn.execute("DELETE FROM matrix_file WHERE matrix_kind = 'annotation'")
            conn.execute("INSERT INTO matrix_file SELECT * FROM repair.matrix_file")
            conn.execute("CREATE INDEX idx_protein_annotation_lookup ON protein_annotation(annotation_type, annotation_id, genome_id, protein_key)")
            conn.execute("CREATE INDEX idx_protein_annotation_genome ON protein_annotation(genome_id, annotation_type, annotation_id)")
            for annotation_type in ANNOTATION_TYPES:
                table = f"{annotation_type}_annotation"
                conn.execute(f"CREATE UNIQUE INDEX idx_{table}_id ON {table}(annotation_id)")
                conn.execute(f"CREATE UNIQUE INDEX idx_{table}_value ON {table}(annotation_value)")
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.execute("DETACH DATABASE repair")


if __name__ == "__main__":
    main()
