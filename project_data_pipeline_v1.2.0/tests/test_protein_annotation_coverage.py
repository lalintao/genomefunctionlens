import importlib.util
import argparse
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("coverage_script", Path(__file__).resolve().parents[1] / "count_protein_annotation_coverage.py")
coverage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(coverage)


class CoverageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = Path(self.temp.name) / "db"
        (self.db / "protein/nested").mkdir(parents=True)
        (self.db / "annotation").mkdir()
        (self.db / "protein/nested/genome_protein.faa").write_text(">a description\nMA\n>b\nMS\n>c\nMT\n>d\nMV\n", encoding="utf-8")
        self.conn = sqlite3.connect(":memory:")
        self.addCleanup(self.conn.close)

    def annotation(self, kind, text):
        (self.db / f"annotation/{kind}.tsv").write_text(text, encoding="utf-8")

    def test_distinct_hits_mixed_separators_and_unknown_ids(self):
        self.annotation("cog", "\ufeff# comment\na\tCOG001;;COG002\na,COG003\nb|COG004\nx COG005\nc\t-\nbadline\n")
        self.annotation("kegg", "name\tpredict\nb K00001\nc\tK00002\n")
        self.annotation("pfam", "a\tPF001.2\nb\tPF002\n")
        result = coverage.scan_database(self.db, self.conn, 2)
        self.assertEqual(result["total_proteins"], 4)
        self.assertEqual(result["sources"]["cog"]["coverage_percent"], 50)
        self.assertEqual(result["sources"]["cog"]["unknown_rows"], 1)
        self.assertEqual(result["sources"]["cog"]["malformed_rows"], 1)
        self.assertEqual(result["sources"]["kegg"]["header_rows"], 1)
        self.assertEqual(result["overlap_counts"], {"0": 1, "1": 0, "2": 1, "3": 0, "4": 0, "5": 1, "6": 0, "7": 1})

    def test_missing_source_and_duplicate_fasta(self):
        result = coverage.scan_database(self.db, self.conn, 2)
        self.assertEqual(result["sources"]["pfam"]["status"], "missing")
        (self.db / "protein/other.faa").write_text(">a\nMA\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Duplicate FASTA"):
            coverage.scan_database(self.db, self.conn, 2)

    def test_link_loop_and_alias_are_counted_once(self):
        try:
            (self.db / "protein/nested/loop").symlink_to(self.db / "protein", target_is_directory=True)
            (self.db / "protein/alias.faa").symlink_to(self.db / "protein/nested/genome_protein.faa")
        except OSError as exc:
            self.skipTest(str(exc))
        self.assertEqual(len(coverage.fasta_paths(self.db / "protein")), 1)

    def test_all_scope_includes_unmapped_databases(self):
        root = Path(self.temp.name) / "row_data"
        for name in ("a", "b"):
            (root / "protein_anno" / name / "protein").mkdir(parents=True)
        (root / "GTDB_speciesTree").mkdir()
        (root / "GTDB_speciesTree/speciesTree_genomesDatabase_mapping.txt").write_text("tree : a\ntree2：a\n", encoding="utf-8")
        self.assertEqual([p.name for p in coverage.discover(root, "all", None)], ["a", "b"])
        self.assertEqual([p.name for p in coverage.discover(root, "mapped", None)], ["a"])

    def test_reports_and_review_exit_code(self):
        root = Path(self.temp.name) / "row_data"
        (root / "protein_anno").mkdir(parents=True)
        moved = root / "protein_anno/db"
        self.db.rename(moved)
        self.db = moved
        self.annotation("cog", "a\tCOG0001\n")
        args = argparse.Namespace(row_data=root, workspace=root.parent, scope="all", database=None,
                                  batch_size=2, output_dir=root.parent / "report", temp_dir=None)
        self.assertEqual(coverage.run(args), 2)
        report = json.loads((args.output_dir / "summary.json").read_text(encoding="utf-8"))
        self.assertEqual(report["total_proteins"], 4)
        self.assertEqual(report["sources"]["cog"]["coverage_percent"], 25)
        self.assertEqual(report["sources"]["kegg"]["missing_databases"], ["db"])
        self.assertEqual(report["any_annotated_proteins"], 1)
        self.assertIn("ALL\tcog\t4\t1\t25.000000", (args.output_dir / "coverage.tsv").read_text())


if __name__ == "__main__":
    unittest.main()
