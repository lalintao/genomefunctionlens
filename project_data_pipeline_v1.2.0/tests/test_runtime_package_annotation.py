from __future__ import annotations

import sqlite3
from contextlib import closing
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd
import pyarrow.parquet as pq

from webdb_pipeline.models import GenomeDatabaseInput
from webdb_pipeline.runtime_package import (
    AnnotationStage,
    _init_annotation_worker,
    _read_annotation_file_worker,
    _append_annotation_rows_from_line,
    _build_annotation_matrices,
    _read_annotation_hits_for_package,
    _validate_annotation_stage,
    _validate_annotation_worker_count,
)


class AnnotationShardBoundaryTests(unittest.TestCase):
    def test_exact_line_boundary_does_not_drop_a_record(self) -> None:
        payload = (
            b"protein_id\tannotation\n"
            b"p1\tK00001\n"
            b"p2\tK00002\n"
            b"p3\tK00003\n"
            b"p4\tK00004\n"
        )
        boundary = payload.index(b"p3")
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            annotation_path = root / "kegg.tsv"
            annotation_path.write_bytes(payload)
            _init_annotation_worker(
                {"p1": 1, "p2": (1 << 32) | 2, "p3": (2 << 32) | 3, "p4": (3 << 32) | 4},
                annotation_chunk_rows=2,
            )
            output_dir = root / "chunks"
            tasks = [
                (str(annotation_path), str(output_dir), 0, 0, boundary),
                (str(annotation_path), str(output_dir), 1, boundary, len(payload)),
            ]
            chunk_paths = [
                Path(path)
                for task in tasks
                for path in _read_annotation_file_worker(task)
            ]
            observed = pd.concat([pd.read_parquet(path) for path in chunk_paths], ignore_index=True)

        self.assertEqual(list(observed.columns), ["annotation_type", "annotation_value", "genome_id", "protein_key"])
        self.assertEqual(sorted(observed["genome_id"].tolist()), [0, 1, 2, 3])

    def test_mid_line_boundary_does_not_duplicate_or_drop_a_record(self) -> None:
        payload = (
            b"protein_id\tannotation\n"
            b"p1\tK00001\n"
            b"p2\tK00002\n"
            b"p3\tK00003\n"
            b"p4\tK00004\n"
        )
        boundary = payload.index(b"p3") + 1
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            annotation_path = root / "kegg.tsv"
            annotation_path.write_bytes(payload)
            _init_annotation_worker(
                {"p1": 1, "p2": (1 << 32) | 2, "p3": (2 << 32) | 3, "p4": (3 << 32) | 4},
                annotation_chunk_rows=2,
            )
            output_dir = root / "chunks"
            tasks = [
                (str(annotation_path), str(output_dir), 0, 0, boundary),
                (str(annotation_path), str(output_dir), 1, boundary, len(payload)),
            ]
            chunk_paths = [
                Path(path)
                for task in tasks
                for path in _read_annotation_file_worker(task)
            ]
            observed = pd.concat([pd.read_parquet(path) for path in chunk_paths], ignore_index=True)

        self.assertEqual(list(observed.columns), ["annotation_type", "annotation_value", "genome_id", "protein_key"])
        self.assertEqual(sorted(observed["genome_id"].tolist()), [0, 1, 2, 3])


class AnnotationWorkerGuardTests(unittest.TestCase):
    def test_large_lookup_rejects_parallel_workers(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "Use --workers 1"):
            _validate_annotation_worker_count(20_000_001, 8)

    def test_large_lookup_allows_single_worker(self) -> None:
        _validate_annotation_worker_count(20_000_001, 1)


class AnnotationLineFormatTests(unittest.TestCase):
    def test_gtdb_protein_ids_and_common_column_separators(self) -> None:
        ids = {
            "AP022133.1_1553": (7 << 32) | 101,
            "AP022133.1_2553": (8 << 32) | 102,
            "AP022133.1_3553": (9 << 32) | 103,
            "AP022133.1_553": (10 << 32) | 104,
        }
        _init_annotation_worker(ids, annotation_chunk_rows=10)
        for separator in (b"\t", b" ", b",", b"|"):
            with self.subTest(separator=separator):
                rows: list[tuple[str, str, int, int]] = []
                _append_annotation_rows_from_line(
                    raw_line=b"AP022133.1_1553" + separator + b"K00001;;K00002",
                    annotation_type="kegg",
                    rows=rows,
                )
                self.assertEqual(
                    rows,
                    [("kegg", "K00001", 7, 101), ("kegg", "K00002", 7, 101)],
                )

    def test_gtdb_ids_without_double_underscore_are_not_treated_as_headers(self) -> None:
        _init_annotation_worker({"AP023240.1_1118": (11 << 32) | 105}, annotation_chunk_rows=10)
        rows: list[tuple[str, str, int, int]] = []
        _append_annotation_rows_from_line(
            raw_line=b"AP023240.1_1118 COG0001",
            annotation_type="cog",
            rows=rows,
        )
        self.assertEqual(rows, [("cog", "COG0001", 11, 105)])


class AnnotationMatrixWriterTests(unittest.TestCase):
    def test_matrix_is_written_in_bounded_genome_chunks(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            sqlite_path = root / "annotation_hits.sqlite"
            with closing(sqlite3.connect(sqlite_path)) as conn:
                conn.execute(
                    "CREATE TABLE annotation_hit_stage ("
                    "annotation_type TEXT, annotation_value TEXT, genome_id INTEGER, protein_key INTEGER)"
                )
                conn.executemany(
                    "INSERT INTO annotation_hit_stage VALUES (?, ?, ?, ?)",
                    [
                        ("kegg", "K00001", 0, 1),
                        ("kegg", "K00002", 0, 2),
                        ("kegg", "K00001", 1, 3),
                        ("kegg", "K00001", 2, 4),
                    ],
                )
                conn.commit()
            stage = AnnotationStage(sqlite_path=sqlite_path, chunk_paths=[], input_file_count=1, shard_count=1)
            matrices_dir = root / "processed" / "matrices"
            matrices_dir.mkdir(parents=True)
            with patch("webdb_pipeline.runtime_package.ANNOTATION_MATRIX_TARGET_CELLS", 2):
                registry = _build_annotation_matrices(
                    matrices_dir=matrices_dir,
                    genome_df=pd.DataFrame({"genome_id": [0, 1, 2]}),
                    annotation_stage=stage,
                    annotation_tables={"kegg": pd.DataFrame({"annotation_value": ["K00002", "K00001"]})},
                    package_root=root,
                    genome_database="fixture",
                )
            matrix = pd.read_parquet(matrices_dir / "kegg.parquet")
            num_row_groups = pq.ParquetFile(matrices_dir / "kegg.parquet").num_row_groups

        self.assertEqual(list(matrix.columns), ["K00002", "K00001"])
        self.assertEqual(matrix["K00002"].tolist(), [1, 0, 0])
        self.assertEqual(matrix["K00001"].tolist(), [1, 1, 1])
        self.assertEqual(int(registry.iloc[0]["row_count"]), 3)
        self.assertEqual(int(registry.iloc[0]["column_count"]), 2)
        self.assertGreater(num_row_groups, 1)


class AnnotationStageValidationTests(unittest.TestCase):
    def test_zero_hits_fail_instead_of_publishing_empty_matrices(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            sqlite_path = root / "annotation_hits.sqlite"
            with closing(sqlite3.connect(sqlite_path)) as conn:
                conn.execute(
                    "CREATE TABLE annotation_hit_stage ("
                    "annotation_type TEXT, annotation_value TEXT, genome_id INTEGER, protein_key INTEGER)"
                )
                conn.commit()
            stage = AnnotationStage(sqlite_path=sqlite_path, chunk_paths=[], input_file_count=3, shard_count=17)
            annotation_paths = [root / "cog.tsv", root / "kegg.tsv", root / "pfam.tsv"]
            for path in annotation_paths:
                path.write_text("protein_id\tannotation\n", encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "zero protein hits"):
                _validate_annotation_stage(annotation_stage=stage, annotation_paths=annotation_paths)

    def test_nonzero_hits_for_all_types_pass(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            sqlite_path = root / "annotation_hits.sqlite"
            with closing(sqlite3.connect(sqlite_path)) as conn:
                conn.execute(
                    "CREATE TABLE annotation_hit_stage ("
                    "annotation_type TEXT, annotation_value TEXT, genome_id INTEGER, protein_key INTEGER)"
                )
                conn.executemany(
                    "INSERT INTO annotation_hit_stage VALUES (?, ?, ?, ?)",
                    [("cog", "COG1", 0, 1), ("kegg", "K00001", 0, 1), ("pfam", "PF1", 0, 1)],
                )
                conn.commit()
            stage = AnnotationStage(sqlite_path=sqlite_path, chunk_paths=[], input_file_count=3, shard_count=3)
            annotation_paths = [root / name for name in ("cog.tsv", "kegg.tsv", "pfam.tsv")]

            counts = _validate_annotation_stage(annotation_stage=stage, annotation_paths=annotation_paths)

        self.assertEqual(counts, {"cog": 1, "kegg": 1, "pfam": 1})


class DirectAnnotationStageTests(unittest.TestCase):
    def test_single_process_mode_writes_directly_to_stage_sqlite(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            annotation_dir = root / "annotation"
            annotation_dir.mkdir()
            (annotation_dir / "kegg.tsv").write_text(
                "protein_id\tannotation\n"
                "p1\tK00001;;K00001\n"
                "p2\tK00002\n"
                "unknown\tK99999\n",
                encoding="utf-8",
            )
            database = GenomeDatabaseInput(
                name="fixture",
                root_dir=root,
                protein_dir=root / "protein",
                annotation_dir=annotation_dir,
                genome_leaf_map_path=root / "genome_leafLabel_mapping.tsv",
            )
            stage = _read_annotation_hits_for_package(
                genome_database=database,
                protein_info_lookup={"p1": (2 << 32) | 7, "p2": (3 << 32) | 8},
                stage_dir=root / "stage",
                workers=1,
                annotation_chunk_rows=2,
            )
            with closing(sqlite3.connect(stage.sqlite_path)) as conn:
                columns = [row[1] for row in conn.execute("PRAGMA table_info(annotation_hit_stage)")]
                rows = conn.execute(
                    "SELECT annotation_type, annotation_value, genome_id, protein_key "
                    "FROM annotation_hit_stage ORDER BY genome_id, protein_key"
                ).fetchall()

        self.assertEqual(columns, ["annotation_type", "annotation_value", "genome_id", "protein_key"])
        self.assertEqual(
            rows,
            [("kegg", "K00001", 2, 7), ("kegg", "K00002", 3, 8)],
        )
        self.assertEqual(stage.chunk_paths, [])
        self.assertEqual(stage.dispatch_strategy, "direct_sqlite_stream_parse")


if __name__ == "__main__":
    unittest.main()
