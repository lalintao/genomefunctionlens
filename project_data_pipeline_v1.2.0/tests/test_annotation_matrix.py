import json
import sqlite3
from unittest.mock import patch

import pandas as pd
import pytest

from webdb_pipeline.annotation_matrix import add_annotation_matrix, update_annotation_matrix
from webdb_pipeline.cli import build_parser


@pytest.fixture
def package(tmp_path):
    root = tmp_path / "package"
    (root / "database").mkdir(parents=True)
    (root / "backend_ready").mkdir()
    with sqlite3.connect(root / "database/web_database.sqlite") as db:
        db.executescript("""
        CREATE TABLE genome(genome_id INTEGER, genome_database TEXT);
        INSERT INTO genome VALUES(0,'test'),(1,'test'),(2,'test');
        CREATE TABLE protein(protein_id TEXT, genome_id INTEGER, protein_key INTEGER);
        INSERT INTO protein VALUES('p1',0,1),('p2',0,2),('p3',1,3);
        CREATE TABLE protein_annotation(annotation_hit_id INTEGER,annotation_type TEXT,annotation_id INTEGER,genome_id INTEGER,protein_key INTEGER);
        INSERT INTO protein_annotation VALUES(1,'other',1,0,1);
        CREATE TABLE matrix_file(matrix_kind TEXT,genome_database TEXT,annotation_type TEXT,matrix_path TEXT,matrix_format TEXT,row_count INTEGER,column_count INTEGER,value_type TEXT);
        """)
    (root / "backend_ready/manifest.json").write_text(json.dumps({"genome_database":"test","matrices":[],"entity_counts":{"protein_annotation":1},"annotation_tables":{}}))
    return root


def mapping(root, text):
    path = root.parent / "mapping.tsv"
    path.write_text(text, encoding="utf-8")
    return path


def test_add_update_counts_and_stable_ids(package):
    path = mapping(package, "protein_id\tannotation\np1 A;;B\np1,A\np2|A\np3\tB\nunknown A\n")
    result = add_annotation_matrix(package_root=package,mapping_file=path,annotation_type="CUSTOM")
    assert result["unmatched_protein_ids"] == 1
    frame = pd.read_parquet(package / "processed/matrices/custom.parquet")
    assert frame.to_dict("list") == {"A":[2,0,0],"B":[1,1,0]}
    path = mapping(package, "p3 B;;C\n")
    update_annotation_matrix(package_root=package,mapping_file=path,annotation_type="custom")
    assert pd.read_parquet(package / "processed/matrices/custom.parquet").to_dict("list") == {"B":[0,1,0],"C":[0,1,0]}
    with sqlite3.connect(package / "database/web_database.sqlite") as db:
        assert db.execute("SELECT annotation_value,annotation_id FROM custom_annotation ORDER BY annotation_id").fetchall() == [("A",1),("B",2),("C",3)]
        assert db.execute("SELECT COUNT(*) FROM protein_annotation WHERE annotation_type='other'").fetchone()[0] == 1
        assert db.execute("SELECT COUNT(*) FROM protein_annotation WHERE annotation_type='custom'").fetchone()[0] == 2
    manifest = json.loads((package / "backend_ready/manifest.json").read_text())
    assert manifest["entity_counts"]["protein_annotation"] == 3
    assert manifest["annotation_tables"]["custom_annotation"] == 3


def test_reject_wrong_operation_and_bad_input(package):
    path = mapping(package,"p1 A\n")
    with pytest.raises(ValueError,match="does not exist"):
        update_annotation_matrix(package_root=package,mapping_file=path,annotation_type="new")
    add_annotation_matrix(package_root=package,mapping_file=path,annotation_type="new")
    with pytest.raises(FileExistsError):
        add_annotation_matrix(package_root=package,mapping_file=path,annotation_type="new")
    before = (package / "processed/matrices/new.parquet").read_bytes()
    for content in ["badline", "unknown A\n"]:
        with pytest.raises(ValueError):
            update_annotation_matrix(package_root=package,mapping_file=mapping(package,content),annotation_type="new")
    assert (package / "processed/matrices/new.parquet").read_bytes() == before


def test_publication_failure_restores_package(package):
    path = mapping(package,"p1 A\n")
    add_annotation_matrix(package_root=package,mapping_file=path,annotation_type="new")
    manifest = (package / "backend_ready/manifest.json").read_bytes()
    matrix = (package / "processed/matrices/new.parquet").read_bytes()
    import os
    original = os.replace
    def fail_manifest(src,dest):
        if str(src).endswith("manifest.json"):
            raise OSError("publication failed")
        return original(src,dest)
    with patch("webdb_pipeline.annotation_matrix.os.replace",side_effect=fail_manifest):
        with pytest.raises(OSError):
            update_annotation_matrix(package_root=package,mapping_file=mapping(package,"p3 C\n"),annotation_type="new")
    assert (package / "backend_ready/manifest.json").read_bytes() == manifest
    assert (package / "processed/matrices/new.parquet").read_bytes() == matrix
    with sqlite3.connect(package / "database/web_database.sqlite") as db:
        assert db.execute("SELECT annotation_value FROM new_annotation").fetchall() == [("A",)]


def test_cli_preserves_index_backup_option():
    args = build_parser().parse_args(["upgrade-runtime-indexes","--backup-path","backup.sqlite"])
    assert str(args.backup_path) == "backup.sqlite"
    for cmd in ("add-annotation-matrix","update-annotation-matrix"):
        args = build_parser().parse_args([cmd,"--package-root","pkg","--mapping-file","mapping.tsv","--annotation-type","COG"])
        assert args.annotation_type == "COG"
