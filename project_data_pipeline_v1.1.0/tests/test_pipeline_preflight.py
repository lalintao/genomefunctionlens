from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from webdb_pipeline.config import make_config
from webdb_pipeline.pipeline import _validate_output_target, run_pipeline
from webdb_pipeline.row_data_audit import audit_row_data


class PipelinePreflightTests(unittest.TestCase):
    def test_failed_input_validation_does_not_delete_existing_output(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            output_root = workspace / "project_data"
            output_root.mkdir()
            sentinel = output_root / "keep.txt"
            sentinel.write_text("keep", encoding="utf-8")
            config = make_config(workspace=workspace, output_root=output_root, force=True)

            with self.assertRaises(FileNotFoundError):
                run_pipeline(config)

            self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep")

    def test_force_refuses_to_delete_workspace_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            config = make_config(workspace=workspace, output_root=workspace, force=True)
            with self.assertRaisesRegex(ValueError, "refuses to delete"):
                _validate_output_target(config)

    def test_audit_ignores_unreferenced_genome_database(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            _create_minimal_workspace(workspace)

            report = audit_row_data(workspace=workspace, mode="fast")

        self.assertTrue(report.ok, report.to_dict())
        self.assertIn("unreferenced_genome_database", {finding.check_id for finding in report.findings})
        self.assertEqual(report.summary["referenced_genome_databases"], ["referenced"])


def _create_minimal_workspace(workspace: Path) -> None:
    protein_root = workspace / "row_data" / "protein_anno"
    referenced = protein_root / "referenced"
    (referenced / "protein").mkdir(parents=True)
    (referenced / "annotation").mkdir()
    (referenced / "protein" / "a.faa").write_text(">p1\nMKT\n", encoding="utf-8")
    (referenced / "genome_leafLabel_mapping.tsv").write_text(
        "genome_name\tleaf_label\na\ta\n", encoding="utf-8"
    )
    for annotation_type in ("cog", "kegg", "pfam"):
        (referenced / "annotation" / f"{annotation_type}.tsv").write_text(
            "protein_id\tannotation\np1\tX\n", encoding="utf-8"
        )
        (protein_root / f"{annotation_type}_annotation_names.tsv").write_text(
            "accession\tshort_name\tfull_name\nX\tX\tX\n", encoding="utf-8"
        )

    unreferenced = protein_root / "unreferenced"
    (unreferenced / "annotation").mkdir(parents=True)

    tree_root = workspace / "row_data" / "GTDB_speciesTree"
    tree_dir = tree_root / "tree"
    tree_dir.mkdir(parents=True)
    (tree_root / "speciesTree_genomesDatabase_mapping.txt").write_text(
        "tree : referenced\n", encoding="utf-8"
    )
    (tree_dir / "tree.tre").write_text("(a:1);\n", encoding="utf-8")
    (tree_dir / "taxonomy.tsv").write_text(
        "accession\tgtdb_taxonomy\n"
        "a\td__D;p__P;c__C;o__O;f__F;g__G;s__S\n",
        encoding="utf-8",
    )

    module_root = workspace / "row_data" / "module_source" / "kegg_module"
    raw = module_root / "raw"
    (raw / "entries").mkdir(parents=True)
    (raw / "info_module.txt").write_text("md test\n", encoding="utf-8")
    (raw / "list_module.tsv").write_text("M00001\tModule\n", encoding="utf-8")
    (raw / "link_ko_module.tsv").write_text("M00001\tK00001\n", encoding="utf-8")
    (raw / "entries" / "M00001.txt").write_text(
        "NAME        Module\nDEFINITION  K00001\n///\n", encoding="utf-8"
    )

    completeness = workspace / "row_data" / "kegg_module_completeness"
    completeness.mkdir(parents=True)
    (completeness / "completeness_matrix.tsv").write_text(
        "genome_name\tM00001\na\t100\n", encoding="utf-8"
    )


if __name__ == "__main__":
    unittest.main()
