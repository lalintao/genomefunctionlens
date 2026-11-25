from __future__ import annotations

import argparse
import gzip
import json
import shutil
import sqlite3
from pathlib import Path
from types import SimpleNamespace

import pandas as pd

from .io_utils import write_json
from .runtime_package import (
    RANKS,
    RANK_TO_TAXONOMY_COLUMN,
    _build_display_tree_model,
    _build_tree_model,
    _build_tree_core_payload,
    _build_tree_node_table,
    _create_runtime_indexes,
    _read_genome_leaf_map,
)
from .models import SpeciesTreeInput


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Rebuild an existing runtime package with taxonomy indexes anchored on its original tree nodes."
    )
    parser.add_argument(
        "--package-root",
        type=Path,
        required=True,
        help="Path to an existing runtime package, e.g. GTDB232/project_data.",
    )
    parser.add_argument(
        "--source-tree",
        type=Path,
        default=None,
        help="Optional source Newick tree to copy into processed/tree_core when the package is missing tree_newick_path.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    summary = upgrade_runtime_package(
        package_root=args.package_root.resolve(),
        source_tree_path=args.source_tree.resolve() if args.source_tree else None,
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def upgrade_runtime_package(
    *,
    package_root: Path,
    source_tree_path: Path | None = None,
) -> dict[str, object]:
    manifest_path = package_root / "backend_ready" / "manifest.json"
    sqlite_path = package_root / "database" / "web_database.sqlite"
    tree_core_path = package_root / "processed" / "tree_core" / "tree_core.bin"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    tree_core_payload = _read_tree_core_payload(tree_core_path)
    tree_model = _build_tree_model_from_runtime_package(sqlite_path=sqlite_path, tree_core_payload=tree_core_payload)

    with sqlite3.connect(sqlite_path) as conn:
        genome_df = pd.read_sql_query("SELECT * FROM genome ORDER BY genome_id", conn)
        tree_dataset_df = pd.read_sql_query("SELECT * FROM tree_dataset", conn)

    old_leaf_label_by_node = _leaf_label_by_node_from_payload(tree_core_payload)
    old_leaf_label_lookup = {
        node_id: label
        for node_id, label in enumerate(old_leaf_label_by_node)
        if label
    }
    new_leaf_node_by_label = {
        tree_model.leaf_labels_by_node[node_id]: node_id
        for node_id in tree_model.leaf_node_ids_in_row_order
    }
    genome_df["leaf_label"] = genome_df["leaf_node_id"].map(old_leaf_label_lookup)
    missing_leaf_labels = genome_df.loc[genome_df["leaf_label"].isna(), "leaf_node_id"].tolist()
    if missing_leaf_labels:
        raise ValueError(f"Failed to resolve leaf labels for existing genome rows. Examples: {missing_leaf_labels[:10]}")
    genome_df["leaf_node_id"] = genome_df["leaf_label"].map(new_leaf_node_by_label)
    missing_new_leaf_ids = genome_df.loc[genome_df["leaf_node_id"].isna(), "leaf_label"].astype(str).tolist()
    if missing_new_leaf_ids:
        raise ValueError(f"Failed to map runtime leaves onto upgraded tree. Examples: {missing_new_leaf_ids[:10]}")
    genome_df["leaf_node_id"] = genome_df["leaf_node_id"].astype(int)

    taxonomy_rows: list[dict[str, object]] = []
    for record in genome_df.loc[:, ["leaf_node_id"]].to_dict(orient="records"):
        leaf_node_id = int(record["leaf_node_id"])
        taxonomy_path = tree_model.leaf_taxonomy_node_ids[leaf_node_id]
        row = {"node_id": leaf_node_id}
        for rank_name, column_name in RANK_TO_TAXONOMY_COLUMN.items():
            row[column_name] = taxonomy_path.get(rank_name)
        taxonomy_rows.append(row)
    taxonomy_df = pd.DataFrame(taxonomy_rows)

    tree_node_df = _build_tree_node_table(tree_model)
    tree_named_taxon_index_df = pd.DataFrame(
        tree_model.named_taxon_rows,
        columns=["rank", "taxon_name", "taxon_name_norm", "node_id"],
    )
    tree_dataset_df.loc[:, "node_count"] = int(len(tree_model.parent))
    tree_dataset_df.loc[:, "leaf_count"] = int(len(tree_model.leaf_node_ids_in_row_order))
    tree_dataset_df.loc[:, "genome_count"] = int(len(genome_df))

    tree_core_payload_new = _build_tree_core_payload(
        tree_input=SimpleNamespace(
            tree_stem=str(tree_dataset_df.iloc[0]["species_tree"]),
            genome_database=str(tree_dataset_df.iloc[0]["genome_database"]),
        ),
        tree_model=tree_model,
    )
    _write_tree_core_payload(tree_core_path, tree_core_payload_new)

    expected_tree_rel = manifest.get("tree", {}).get("tree_newick_path", "")
    expected_tree_path = package_root / expected_tree_rel if expected_tree_rel else None
    copied_tree = False
    if expected_tree_path is not None and not expected_tree_path.exists() and source_tree_path is not None:
        expected_tree_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_tree_path, expected_tree_path)
        copied_tree = True

    with sqlite3.connect(sqlite_path) as conn:
        tree_node_df.to_sql("tree_node", conn, index=False, if_exists="replace")
        tree_named_taxon_index_df.to_sql("tree_named_taxon_index", conn, index=False, if_exists="replace")
        genome_df.drop(columns=["leaf_label"]).to_sql("genome", conn, index=False, if_exists="replace")
        taxonomy_df.to_sql("taxonomy", conn, index=False, if_exists="replace")
        tree_dataset_df.to_sql("tree_dataset", conn, index=False, if_exists="replace")
        _create_runtime_indexes(conn)

    manifest.setdefault("tree", {})
    manifest["tree"]["root_id"] = int(tree_model.root_id)
    manifest["tree"]["node_count"] = int(len(tree_model.parent))
    manifest["tree"]["leaf_count"] = int(len(tree_model.leaf_node_ids_in_row_order))
    manifest.setdefault("entity_counts", {})
    manifest["entity_counts"]["genome"] = int(len(genome_df))
    manifest["entity_counts"]["tree_node"] = int(len(tree_model.parent))
    write_json(manifest_path, manifest)

    return validate_runtime_package(package_root=package_root, copied_tree=copied_tree)


def migrate_runtime_tree_from_row_data(
    *,
    package_root: Path,
    source_tree_path: Path,
    taxonomy_path: Path,
    genome_leaf_map_path: Path,
) -> dict[str, object]:
    """Replace only tree-derived package data using complete raw inputs.

    Protein, annotation, and matrix payloads are deliberately left untouched.
    Their stable join key is genome_id, while leaf_node_id is rebuilt from the
    supplied source tree and genome leaf-label mapping.
    """
    manifest_path = package_root / "backend_ready" / "manifest.json"
    sqlite_path = package_root / "database" / "web_database.sqlite"
    tree_core_path = package_root / "processed" / "tree_core" / "tree_core.bin"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    with sqlite3.connect(sqlite_path) as conn:
        genome_df = pd.read_sql_query("SELECT * FROM genome ORDER BY genome_id", conn)
        tree_dataset_df = pd.read_sql_query("SELECT * FROM tree_dataset", conn)

    tree_stem = str(tree_dataset_df.iloc[0]["species_tree"])
    genome_database = str(tree_dataset_df.iloc[0]["genome_database"])
    tree_model = _build_tree_model(
        SpeciesTreeInput(
            tree_file=source_tree_path.name,
            tree_stem=tree_stem,
            genome_database=genome_database,
            tree_path=source_tree_path,
            taxonomy_path=taxonomy_path,
        )
    )
    leaf_map_df = _read_genome_leaf_map(genome_leaf_map_path)
    genome_name_by_leaf_label = (
        leaf_map_df.drop_duplicates(subset=["leaf_label"])
        .set_index("leaf_label")["genome_name"]
        .astype(str)
        .to_dict()
    )
    leaf_node_by_genome_name = {
        genome_name_by_leaf_label[tree_model.leaf_labels_by_node[node_id]]: node_id
        for node_id in tree_model.leaf_node_ids_in_row_order
        if tree_model.leaf_labels_by_node[node_id] in genome_name_by_leaf_label
    }
    genome_df["leaf_node_id"] = genome_df["genome_name"].astype(str).map(leaf_node_by_genome_name)
    missing = genome_df.loc[genome_df["leaf_node_id"].isna(), "genome_name"].astype(str).tolist()
    if missing:
        raise ValueError(f"Existing package genomes are absent from the source leaf mapping. Examples: {missing[:10]}")
    genome_df["leaf_node_id"] = genome_df["leaf_node_id"].astype(int)

    taxonomy_rows: list[dict[str, object]] = []
    for leaf_node_id in genome_df["leaf_node_id"].astype(int):
        row = {"node_id": leaf_node_id}
        for rank_name, column_name in RANK_TO_TAXONOMY_COLUMN.items():
            row[column_name] = tree_model.leaf_taxonomy_node_ids[leaf_node_id].get(rank_name)
        taxonomy_rows.append(row)
    taxonomy_df = pd.DataFrame(taxonomy_rows)
    tree_node_df = _build_tree_node_table(tree_model)
    named_taxon_df = pd.DataFrame(tree_model.named_taxon_rows, columns=["rank", "taxon_name", "taxon_name_norm", "node_id"])
    tree_dataset_df.loc[:, "tree_file"] = source_tree_path.name
    tree_dataset_df.loc[:, "node_count"] = len(tree_model.parent)
    tree_dataset_df.loc[:, "leaf_count"] = len(tree_model.leaf_node_ids_in_row_order)
    tree_dataset_df.loc[:, "genome_count"] = len(genome_df)

    tree_core_payload = _build_tree_core_payload(
        tree_input=SimpleNamespace(tree_stem=tree_stem, genome_database=genome_database),
        tree_model=tree_model,
    )
    _write_tree_core_payload(tree_core_path, tree_core_payload)
    tree_copy_path = package_root / "processed" / "tree_core" / source_tree_path.name
    shutil.copyfile(source_tree_path, tree_copy_path)

    with sqlite3.connect(sqlite_path) as conn:
        tree_node_df.to_sql("tree_node", conn, index=False, if_exists="replace")
        named_taxon_df.to_sql("tree_named_taxon_index", conn, index=False, if_exists="replace")
        genome_df.to_sql("genome", conn, index=False, if_exists="replace")
        taxonomy_df.to_sql("taxonomy", conn, index=False, if_exists="replace")
        tree_dataset_df.to_sql("tree_dataset", conn, index=False, if_exists="replace")
        _create_runtime_indexes(conn)

    manifest["tree"] = {
        **manifest.get("tree", {}),
        "tree_core_path": "processed/tree_core/tree_core.bin",
        "tree_core_format": "json-gzip",
        "tree_newick_path": f"processed/tree_core/{source_tree_path.name}",
        "root_id": tree_model.root_id,
        "node_count": len(tree_model.parent),
        "leaf_count": len(tree_model.leaf_node_ids_in_row_order),
    }
    manifest.setdefault("entity_counts", {})
    manifest["entity_counts"]["genome"] = len(genome_df)
    manifest["entity_counts"]["tree_node"] = len(tree_model.parent)
    write_json(manifest_path, manifest)
    return validate_runtime_package(package_root=package_root, copied_tree=True)


def validate_runtime_package(*, package_root: Path, copied_tree: bool = False) -> dict[str, object]:
    manifest_path = package_root / "backend_ready" / "manifest.json"
    sqlite_path = package_root / "database" / "web_database.sqlite"
    tree_core_path = package_root / "processed" / "tree_core" / "tree_core.bin"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    tree_core_payload = _read_tree_core_payload(tree_core_path)

    checks: dict[str, object] = {
        "package_root": str(package_root),
        "copied_tree_file": copied_tree,
        "manifest_exists": manifest_path.exists(),
        "sqlite_exists": sqlite_path.exists(),
        "tree_core_exists": tree_core_path.exists(),
        "tree_newick_exists": (package_root / manifest["tree"]["tree_newick_path"]).exists(),
    }
    with sqlite3.connect(sqlite_path) as conn:
        counts = {
            "tree_node": int(conn.execute("SELECT COUNT(*) FROM tree_node").fetchone()[0]),
            "tree_named_taxon_index": int(conn.execute("SELECT COUNT(*) FROM tree_named_taxon_index").fetchone()[0]),
            "genome": int(conn.execute("SELECT COUNT(*) FROM genome").fetchone()[0]),
            "taxonomy": int(conn.execute("SELECT COUNT(*) FROM taxonomy").fetchone()[0]),
        }
        invariants = {
            "genome_leaf_nodes_exist": int(
                conn.execute(
                    """
                    SELECT COUNT(*)
                    FROM genome AS g
                    JOIN tree_node AS t
                      ON t.node_id = g.leaf_node_id
                    WHERE t.is_leaf = 1
                    """
                ).fetchone()[0]
            ),
            "genome_leaf_nodes_are_species": int(
                conn.execute(
                    """
                    SELECT COUNT(*)
                    FROM genome AS g
                    JOIN tree_node AS t
                      ON t.node_id = g.leaf_node_id
                    WHERE t.is_leaf = 1
                      AND t.rank = 'species'
                    """
                ).fetchone()[0]
            ),
            "species_named_taxa_on_leaves": int(
                conn.execute(
                    """
                    SELECT COUNT(*)
                    FROM tree_named_taxon_index AS nti
                    JOIN tree_node AS t
                      ON t.node_id = nti.node_id
                    WHERE nti.rank = 'species'
                      AND t.is_leaf = 1
                    """
                ).fetchone()[0]
            ),
        }
    checks["counts"] = counts
    checks["invariants"] = invariants
    checks["manifest_tree_node_count"] = int(manifest["tree"]["node_count"])
    checks["manifest_leaf_count"] = int(manifest["tree"]["leaf_count"])
    checks["tree_core_node_count"] = int(tree_core_payload["node_count"])
    checks["tree_core_leaf_count"] = int(tree_core_payload["leaf_count"])
    checks["complete"] = all(
        [
            checks["manifest_exists"],
            checks["sqlite_exists"],
            checks["tree_core_exists"],
            checks["tree_newick_exists"],
            counts["tree_node"] == checks["manifest_tree_node_count"] == checks["tree_core_node_count"],
            counts["genome"] == counts["taxonomy"] == checks["manifest_leaf_count"] == checks["tree_core_leaf_count"],
            invariants["genome_leaf_nodes_exist"] == counts["genome"],
            invariants["genome_leaf_nodes_are_species"] == counts["genome"],
            invariants["species_named_taxa_on_leaves"] == counts["genome"],
        ]
    )
    return checks


def _build_tree_model_from_runtime_package(
    *,
    sqlite_path: Path,
    tree_core_payload: dict[str, object],
):
    parent = [int(value) for value in tree_core_payload["parent"]]
    branch_length = [float(value) for value in tree_core_payload["branch_length"]]
    leaf_labels_by_node = _leaf_label_by_node_from_payload(tree_core_payload)
    children = _children_from_payload(tree_core_payload)
    root_id = int(tree_core_payload["root_id"])

    with sqlite3.connect(sqlite_path) as conn:
        named_taxa_df = pd.read_sql_query("SELECT rank, taxon_name, node_id FROM tree_named_taxon_index", conn)
        taxonomy_df = pd.read_sql_query("SELECT * FROM taxonomy", conn)

    name_lookup = {
        (str(record["rank"]), int(record["node_id"])): str(record["taxon_name"])
        for record in named_taxa_df.to_dict(orient="records")
    }
    taxonomy_by_leaf_label: dict[str, list[str]] = {}
    for record in taxonomy_df.to_dict(orient="records"):
        leaf_node_id = int(record["node_id"])
        leaf_label = leaf_labels_by_node[leaf_node_id]
        lineage: list[str] = []
        for rank_name, column_name in RANK_TO_TAXONOMY_COLUMN.items():
            node_value = record.get(column_name)
            if node_value is None or str(node_value).strip() == "":
                lineage.append("")
                continue
            lineage.append(name_lookup.get((rank_name, int(node_value)), ""))
        taxonomy_by_leaf_label[leaf_label] = lineage

    consensus_taxonomy = [[""] * len(RANKS) for _ in parent]
    postorder = _postorder(root_id, children)
    for node_id in postorder:
        child_ids = children[node_id]
        if not child_ids:
            consensus_taxonomy[node_id] = taxonomy_by_leaf_label[leaf_labels_by_node[node_id]]
            continue
        merged: list[str] = []
        for rank_index in range(len(RANKS)):
            values = [consensus_taxonomy[child_id][rank_index] for child_id in child_ids]
            first = values[0]
            merged.append(first if first and all(value == first for value in values) else "")
        consensus_taxonomy[node_id] = merged

    return _build_display_tree_model(
        root_id=root_id,
        children=children,
        parent=parent,
        branch_length=branch_length,
        leaf_labels_by_node=leaf_labels_by_node,
        consensus_taxonomy=consensus_taxonomy,
    )


def _children_from_payload(payload: dict[str, object]) -> list[list[int]]:
    offsets = [int(value) for value in payload["children_offsets"]]
    pool = [int(value) for value in payload["children_pool"]]
    return [pool[offsets[index] : offsets[index + 1]] for index in range(len(offsets) - 1)]


def _leaf_label_by_node_from_payload(payload: dict[str, object]) -> list[str]:
    strings = [str(value) for value in payload["strings"]]
    leaf_name_id = [int(value) for value in payload["leaf_name_id"]]
    return [strings[name_id] if name_id > 0 else "" for name_id in leaf_name_id]


def _read_tree_core_payload(path: Path) -> dict[str, object]:
    with gzip.open(path, "rb") as handle:
        return json.loads(handle.read().decode("utf-8"))


def _write_tree_core_payload(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with gzip.open(path, "wb") as handle:
        handle.write(raw)


def _postorder(root_id: int, children: list[list[int]]) -> list[int]:
    stack = [(root_id, False)]
    order: list[int] = []
    while stack:
        node_id, visited = stack.pop()
        if visited:
            order.append(node_id)
            continue
        stack.append((node_id, True))
        for child_id in reversed(children[node_id]):
            stack.append((child_id, False))
    return order


if __name__ == "__main__":
    main()
