from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from webdb_pipeline.models import SpeciesTreeInput
from webdb_pipeline.runtime_package import _build_tree_model, _parse_newick


class SourceTopologyTaxonIndexTests(unittest.TestCase):
    def test_taxon_index_is_many_to_many_without_virtual_nodes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            tree_path = root / "tree.tre"
            taxonomy_path = root / "taxonomy.tsv"
            tree_path.write_text("((a:1,b:1):1,c:1);", encoding="utf-8")
            taxonomy_path.write_text(
                "accession\tgtdb_taxonomy\n"
                "a\td__D;p__P1;c__C1;o__O1;f__F1;g__Repeated;s__A\n"
                "b\td__D;p__P1;c__C1;o__O1;f__F1;g__B;s__B\n"
                "c\td__D;p__P2;c__C2;o__O2;f__F2;g__Repeated;s__C\n",
                encoding="utf-8",
            )
            source = _parse_newick(tree_path)
            model = _build_tree_model(
                SpeciesTreeInput(
                    tree_file=tree_path.name,
                    tree_stem="fixture",
                    genome_database="fixture",
                    tree_path=tree_path,
                    taxonomy_path=taxonomy_path,
                )
            )

        source_root, source_children, source_parent, source_lengths, source_labels = source
        self.assertEqual(model.root_id, source_root)
        self.assertEqual(model.children, source_children)
        self.assertEqual(model.parent, source_parent)
        self.assertEqual(model.branch_length, source_lengths)
        self.assertEqual(model.leaf_labels_by_node, source_labels)

        index = {(row["rank"], row["taxon_name"]): [] for row in model.named_taxon_rows}
        for row in model.named_taxon_rows:
            index[(row["rank"], row["taxon_name"])].append(int(row["node_id"]))
        shared_rank_node = index[("class", "C1")][0]
        self.assertEqual(index[("order", "O1")], [shared_rank_node])
        self.assertEqual(len(index[("genus", "Repeated")]), 2)

        a_leaf = model.leaf_labels_by_node.index("a")
        path = model.leaf_taxonomy_node_ids[a_leaf]
        self.assertEqual(path["class"], shared_rank_node)
        self.assertEqual(path["order"], shared_rank_node)


if __name__ == "__main__":
    unittest.main()
