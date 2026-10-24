from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor
from contextlib import closing
import gzip
import json
import math
import os
import re
import shutil
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

from Bio import SeqIO
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from . import __version__
from .builders import (
    _clean_kegg_module_name,
    build_kegg_module_resources,
    genome_accession_from_protein_fasta_path,
    iter_protein_fasta_paths,
)
from .io_utils import ensure_dirs, write_json, write_parquet
from .models import GenomeDatabaseInput, ModuleSourceInput, SpeciesTreeInput
from .runtime_indexes import apply_runtime_indexes


EXPECTED_ANNOTATION_TYPES = ("cog", "kegg", "pfam")
RANKS = ["domain", "phylum", "class", "order", "family", "genus", "species"]
RANK_TO_TAXONOMY_COLUMN = {
    "domain": "domain",
    "phylum": "phylum",
    "class": "class_name",
    "order": "order_name",
    "family": "family",
    "genus": "genus",
    "species": "species",
}
PREFIXES = ["d__", "p__", "c__", "o__", "f__", "g__", "s__"]

_ANNOTATION_PROTEIN_INFO_LOOKUP: dict[str, int] = {}
_ANNOTATION_COLUMN_DELIMITERS = re.compile(r"[\s,|]+")
_ANNOTATION_CHUNK_ROWS: int = 250_000
_ANNOTATION_MIN_SHARD_BYTES: int = 64 * 1024 * 1024
_ANNOTATION_TARGET_TASKS_PER_WORKER: int = 2
ANNOTATION_MATRIX_TARGET_CELLS: int = 50_000_000
_PROTEIN_KEY_MASK: int = (1 << 32) - 1
MAX_PARALLEL_PROTEIN_LOOKUP_ENTRIES: int = 20_000_000


@dataclass(slots=True)
class TreeModel:
    root_id: int
    parent: list[int]
    children: list[list[int]]
    branch_length: list[float]
    cumulative_branch_length: list[float]
    leaf_labels_by_node: list[str]
    leaf_node_ids_in_row_order: list[int]
    node_in: list[int]
    node_out: list[int]
    consensus_taxonomy: list[list[str]]
    named_taxon_rows: list[dict[str, object]]
    leaf_taxonomy_node_ids: dict[int, dict[str, int | None]]
    node_rank: list[str]
    node_taxon_name: list[str]


@dataclass(slots=True)
class AnnotationStage:
    sqlite_path: Path
    chunk_paths: list[Path]
    input_file_count: int = 0
    shard_count: int = 0
    dispatch_strategy: str = "byte_sharded_stream_parse"
    staging_strategy: str = "workers_write_parquet_chunks_then_parent_merges"


@dataclass(slots=True)
class StagedTable:
    chunk_paths: list[Path]
    columns: list[str]


def build_runtime_packages(
    *,
    output_root: Path,
    temporary_root: Path,
    species_tree_inputs: dict[str, SpeciesTreeInput],
    genome_databases: dict[str, GenomeDatabaseInput],
    annotation_name_files: dict[str, Path],
    module_source_input: ModuleSourceInput,
    module_completeness_dir: Path,
    workers: int,
    annotation_chunk_rows: int,
) -> dict[str, object]:
    annotation_metadata_by_type = {
        annotation_type: _load_annotation_metadata_table(path)
        for annotation_type, path in sorted(annotation_name_files.items())
    }
    module_resources = _load_module_resources(module_source_input)
    multi_package = len(species_tree_inputs) > 1
    package_summaries: list[dict[str, object]] = []

    for tree_stem, tree_input in sorted(species_tree_inputs.items()):
        package_root = output_root / tree_stem if multi_package else output_root
        genome_database = genome_databases[tree_input.genome_database]
        package_summaries.append(
            _build_single_runtime_package(
                package_root=package_root,
                temporary_root=temporary_root,
                tree_input=tree_input,
                genome_database=genome_database,
                annotation_metadata_by_type=annotation_metadata_by_type,
                module_resources=module_resources,
                module_completeness_dir=module_completeness_dir,
                workers=workers,
                annotation_chunk_rows=annotation_chunk_rows,
            )
        )

    return {
        "ok": True,
        "schema_version": "4.0",
        "package_count": len(package_summaries),
        "packages": package_summaries,
    }


def _build_single_runtime_package(
    *,
    package_root: Path,
    temporary_root: Path,
    tree_input: SpeciesTreeInput,
    genome_database: GenomeDatabaseInput,
    annotation_metadata_by_type: dict[str, pd.DataFrame],
    module_resources: dict[str, pd.DataFrame],
    module_completeness_dir: Path,
    workers: int,
    annotation_chunk_rows: int,
) -> dict[str, object]:
    database_dir = package_root / "database"
    processed_dir = package_root / "processed"
    tree_core_dir = processed_dir / "tree_core"
    matrices_dir = processed_dir / "matrices"
    module_dir = processed_dir / "module_completeness"
    backend_ready_dir = package_root / "backend_ready"
    stage_dir = temporary_root / package_root.name / tree_input.tree_stem
    if stage_dir.exists():
        shutil.rmtree(stage_dir)
    ensure_dirs([stage_dir])
    ensure_dirs([package_root, database_dir, processed_dir, tree_core_dir, matrices_dir, module_dir, backend_ready_dir])

    build_timings: dict[str, float] = {}
    phase_start = time.perf_counter()
    tree_model = _build_tree_model(tree_input)
    genome_map_df = _read_genome_leaf_map(genome_database.genome_leaf_map_path)
    taxonomy_source_df = _read_taxonomy_table(tree_input.taxonomy_path)
    included_leaf_labels = {
        tree_model.leaf_labels_by_node[node_id]
        for node_id in tree_model.leaf_node_ids_in_row_order
    }
    protein_accession_by_genome, fasta_path_by_genome = _resolve_package_protein_fastas(
        genome_database=genome_database,
        genome_map_df=genome_map_df,
        included_leaf_labels=included_leaf_labels,
    )
    genome_df, taxonomy_df, genome_build_df = _build_genome_related_tables(
        tree_model=tree_model,
        genome_database=genome_database,
        genome_map_df=genome_map_df,
        taxonomy_source_df=taxonomy_source_df,
        protein_accession_by_genome=protein_accession_by_genome,
    )
    _validate_dense_genome_ids(genome_df)
    build_timings["prepare_inputs"] = round(time.perf_counter() - phase_start, 3)
    phase_start = time.perf_counter()
    protein_stage, protein_info_lookup, protein_row_count = _stage_protein_table(
        genome_df=genome_df,
        fasta_path_by_genome=fasta_path_by_genome,
        output_dir=stage_dir / "protein_chunks",
    )
    build_timings["stage_proteins"] = round(time.perf_counter() - phase_start, 3)
    phase_start = time.perf_counter()
    annotation_stage = _read_annotation_hits_for_package(
        genome_database=genome_database,
        protein_info_lookup=protein_info_lookup,
        stage_dir=stage_dir / "annotation_chunks",
        workers=workers,
        annotation_chunk_rows=annotation_chunk_rows,
    )
    build_timings["parse_annotations"] = round(time.perf_counter() - phase_start, 3)
    phase_start = time.perf_counter()

    module_annotation_df = _build_module_annotation_table(module_resources)
    kegg_codes_from_modules = set(
        module_resources.get("module_column_registry_df", pd.DataFrame()).get("ko_id", pd.Series(dtype=str)).astype(str)
    )
    annotation_tables = _build_annotation_tables(
        annotation_stage=annotation_stage,
        annotation_metadata_by_type=annotation_metadata_by_type,
        required_kegg_codes=kegg_codes_from_modules,
    )
    module_kegg_member_df = _build_module_kegg_member_table(
        module_resources=module_resources,
        module_annotation_df=module_annotation_df,
        kegg_annotation_df=annotation_tables.get("kegg", pd.DataFrame()),
    )
    build_timings["build_annotation_tables"] = round(time.perf_counter() - phase_start, 3)
    phase_start = time.perf_counter()
    protein_annotation_stage, protein_annotation_row_count = _build_protein_annotation_table(
        annotation_stage=annotation_stage,
        annotation_tables=annotation_tables,
        output_dir=stage_dir / "protein_annotation_chunks",
        chunk_rows=annotation_chunk_rows,
    )
    build_timings["build_protein_annotation"] = round(time.perf_counter() - phase_start, 3)
    phase_start = time.perf_counter()

    tree_node_df = _build_tree_node_table(tree_model)
    tree_named_taxon_index_df = pd.DataFrame(
        tree_model.named_taxon_rows,
        columns=["rank", "taxon_name", "taxon_name_norm", "node_id"],
    )
    tree_core_payload = _build_tree_core_payload(
        tree_input=tree_input,
        tree_model=tree_model,
    )

    tree_core_path = tree_core_dir / "tree_core.bin"
    tree_copy_path = tree_core_dir / tree_input.tree_file
    _write_tree_core(tree_core_payload, tree_core_path)
    shutil.copyfile(tree_input.tree_path, tree_copy_path)
    build_timings["write_tree_core"] = round(time.perf_counter() - phase_start, 3)
    phase_start = time.perf_counter()

    matrix_registry_df = _build_annotation_matrices(
        matrices_dir=matrices_dir,
        genome_df=genome_df,
        annotation_stage=annotation_stage,
        annotation_tables=annotation_tables,
        package_root=package_root,
        genome_database=tree_input.genome_database,
    )
    module_matrix_df = _build_module_completeness_matrix(
        source_dir=module_completeness_dir,
        output_dir=module_dir,
        genome_build_df=genome_build_df,
        module_annotation_df=module_annotation_df,
        package_root=package_root,
        genome_database=tree_input.genome_database,
    )
    matrix_registry_df = pd.concat([matrix_registry_df, module_matrix_df], ignore_index=True, sort=False)
    build_timings["build_matrices"] = round(time.perf_counter() - phase_start, 3)
    phase_start = time.perf_counter()
    tree_dataset_df = pd.DataFrame(
        [
            {
                "species_tree": tree_input.tree_stem,
                "genome_database": tree_input.genome_database,
                "tree_file": tree_input.tree_file,
                "tree_newick_path": _relative_to_package(tree_copy_path, package_root),
                "tree_core_path": _relative_to_package(tree_core_path, package_root),
                "tree_core_format": "json-gzip",
                "node_count": len(tree_model.parent),
                "leaf_count": len(tree_model.leaf_node_ids_in_row_order),
                "genome_count": len(genome_df),
            }
        ]
    )

    sqlite_path = _write_runtime_sqlite(
        sqlite_path=database_dir / "web_database.sqlite",
        tables={
            "tree_node": tree_node_df,
            "tree_named_taxon_index": tree_named_taxon_index_df,
            "genome": genome_df,
            "taxonomy": taxonomy_df,
            "matrix_file": matrix_registry_df,
            "tree_dataset": tree_dataset_df,
            "cog_annotation": annotation_tables.get("cog", pd.DataFrame()),
            "pfam_annotation": annotation_tables.get("pfam", pd.DataFrame()),
            "kegg_annotation": annotation_tables.get("kegg", pd.DataFrame()),
            "module_annotation": module_annotation_df,
            "module_kegg_member": module_kegg_member_df,
            "protein": protein_stage,
            "protein_annotation": protein_annotation_stage,
        },
    )
    build_timings["write_runtime_sqlite"] = round(time.perf_counter() - phase_start, 3)
    build_timings["total"] = round(sum(build_timings.values()), 3)
    manifest = _build_manifest(
        tree_input=tree_input,
        package_root=package_root,
        sqlite_path=sqlite_path,
        tree_core_path=tree_core_path,
        tree_copy_path=tree_copy_path,
        tree_model=tree_model,
        genome_df=genome_df,
        protein_row_count=protein_row_count,
        protein_annotation_row_count=protein_annotation_row_count,
        matrix_registry_df=matrix_registry_df,
        annotation_tables=annotation_tables,
        module_annotation_df=module_annotation_df,
        annotation_stage=annotation_stage,
        workers=workers,
        annotation_chunk_rows=annotation_chunk_rows,
        stage_dir=stage_dir,
        build_timings=build_timings,
    )
    write_json(backend_ready_dir / "manifest.json", manifest)

    return {
        "species_tree": tree_input.tree_stem,
        "genome_database": tree_input.genome_database,
        "package_root": str(package_root),
        "sqlite_path": str(sqlite_path),
        "tree_core_path": str(tree_core_path),
        "genome_rows": int(len(genome_df)),
        "tree_node_rows": int(len(tree_node_df)),
        "protein_rows": int(protein_row_count),
        "protein_annotation_rows": int(protein_annotation_row_count),
        "matrix_files": int(len(matrix_registry_df)),
        "module_completeness_files": int(len(module_matrix_df)),
        "workers_used": int(workers),
        "annotation_chunk_rows": int(annotation_chunk_rows),
        "build_timing_seconds": build_timings,
    }


def _load_module_resources(module_source_input: ModuleSourceInput) -> dict[str, pd.DataFrame]:
    return build_kegg_module_resources(module_source_input=module_source_input)


def _build_tree_model(tree_input: SpeciesTreeInput) -> TreeModel:
    root_id, children, parent, branch_length, leaf_labels_by_node = _parse_newick(tree_input.tree_path)
    leaf_node_ids_in_row_order = [node_id for node_id, child_list in enumerate(children) if not child_list]
    leaf_accessions = [leaf_labels_by_node[node_id] for node_id in leaf_node_ids_in_row_order]
    taxonomy_by_accession = _read_metadata_taxonomy(tree_input.taxonomy_path, leaf_accessions)
    missing = [leaf for leaf in leaf_accessions if leaf not in taxonomy_by_accession]
    if missing:
        raise ValueError(
            f"{tree_input.tree_stem}: {len(missing)} tree leaves are missing taxonomy rows. Examples: {missing[:10]}"
        )

    consensus_taxonomy = [[""] * len(RANKS) for _ in parent]
    postorder = _postorder(root_id, children)
    for node_id in postorder:
        child_ids = children[node_id]
        if not child_ids:
            consensus_taxonomy[node_id] = taxonomy_by_accession[leaf_labels_by_node[node_id]]
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


def _build_display_tree_model(
    *,
    root_id: int,
    children: list[list[int]],
    parent: list[int],
    branch_length: list[float],
    leaf_labels_by_node: list[str],
    consensus_taxonomy: list[list[str]],
) -> TreeModel:
    """Create taxon indexes without changing the source-tree topology.

    A source-tree node may anchor several ranks, and a (rank, taxon name) may
    occur at several nodes.  The named-taxon index is therefore the authority
    for taxonomy; node_rank/node_taxon_name remain only compact display hints.
    """
    rooted_ranks_by_node = [
        _ranks_rooted_at_node(
            node_id=node_id,
            parent=parent,
            consensus_taxonomy=consensus_taxonomy,
        )
        for node_id in range(len(parent))
    ]
    node_rank = [ranks[-1] if ranks else "" for ranks in rooted_ranks_by_node]
    node_taxon_name = [
        consensus_taxonomy[node_id][RANKS.index(rank)] if rank else ""
        for node_id, rank in enumerate(node_rank)
    ]
    leaf_node_ids_in_row_order = [node_id for node_id, child_ids in enumerate(children) if not child_ids]

    # Species is deliberately anchored on every real leaf.  This keeps
    # genome.leaf_node_id and species node ids aligned even when one GTDB
    # species name occurs on more than one leaf.
    named_taxon_rows: list[dict[str, object]] = []
    for node_id, ranks in enumerate(rooted_ranks_by_node):
        for rank_name in ranks:
            if rank_name == "species":
                continue
            taxon_name = consensus_taxonomy[node_id][RANKS.index(rank_name)]
            named_taxon_rows.append(
                {
                    "rank": rank_name,
                    "taxon_name": taxon_name,
                    "taxon_name_norm": _normalize_taxon_name(taxon_name),
                    "node_id": node_id,
                }
            )
    for leaf_node_id in leaf_node_ids_in_row_order:
        species_name = consensus_taxonomy[leaf_node_id][RANKS.index("species")]
        if species_name:
            named_taxon_rows.append(
                {
                    "rank": "species",
                    "taxon_name": species_name,
                    "taxon_name_norm": _normalize_taxon_name(species_name),
                    "node_id": leaf_node_id,
                }
            )

    leaf_taxonomy_node_ids = _build_leaf_taxonomy_node_ids_by_anchor(
        leaf_node_ids=leaf_node_ids_in_row_order,
        parent=parent,
        consensus_taxonomy=consensus_taxonomy,
        rooted_ranks_by_node=rooted_ranks_by_node,
    )
    node_in, node_out = _compute_node_intervals(root_id, children)
    cumulative_branch_length = _compute_cumulative_branch_lengths(root_id, children, branch_length)
    return TreeModel(
        root_id=root_id,
        parent=parent,
        children=children,
        branch_length=[round(float(value), 8) for value in branch_length],
        cumulative_branch_length=cumulative_branch_length,
        leaf_labels_by_node=leaf_labels_by_node,
        leaf_node_ids_in_row_order=leaf_node_ids_in_row_order,
        node_in=node_in,
        node_out=node_out,
        consensus_taxonomy=consensus_taxonomy,
        named_taxon_rows=named_taxon_rows,
        leaf_taxonomy_node_ids=leaf_taxonomy_node_ids,
        node_rank=node_rank,
        node_taxon_name=node_taxon_name,
    )


def _ranks_rooted_at_node(
    *,
    node_id: int,
    parent: list[int],
    consensus_taxonomy: list[list[str]],
) -> list[str]:
    rooted_here: list[str] = []
    taxonomy = consensus_taxonomy[node_id]
    parent_id = parent[node_id]
    parent_taxonomy = consensus_taxonomy[parent_id] if parent_id >= 0 else [""] * len(RANKS)
    for rank_index, rank_name in enumerate(RANKS):
        taxon_name = taxonomy[rank_index]
        if not taxon_name:
            continue
        if parent_id >= 0 and parent_taxonomy[rank_index] == taxon_name:
            continue
        rooted_here.append(rank_name)
    return rooted_here




def _build_genome_related_tables(
    *,
    tree_model: TreeModel,
    genome_database: GenomeDatabaseInput,
    genome_map_df: pd.DataFrame,
    taxonomy_source_df: pd.DataFrame,
    protein_accession_by_genome: dict[str, str],
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    leaf_to_genome = (
        genome_map_df.drop_duplicates(subset=["leaf_label"])
        .set_index("leaf_label")["genome_name"]
        .to_dict()
    )
    taxonomy_lookup = (
        taxonomy_source_df.drop_duplicates(subset=["accession"])
        .set_index("accession")
        .to_dict(orient="index")
    )

    genome_rows: list[dict[str, object]] = []
    genome_build_rows: list[dict[str, object]] = []
    taxonomy_rows: list[dict[str, object]] = []

    for genome_id, leaf_node_id in enumerate(tree_model.leaf_node_ids_in_row_order):
        leaf_label = tree_model.leaf_labels_by_node[leaf_node_id]
        genome_name = str(leaf_to_genome.get(leaf_label, "")).strip()
        if not genome_name:
            raise ValueError(f"Tree leaf is missing genome mapping: {leaf_label}")
        genome_accession = str(protein_accession_by_genome.get(genome_name, "")).strip()
        if not genome_accession:
            raise ValueError(f"Mapped genome is missing protein FASTA: {genome_name}")
        metadata = taxonomy_lookup.get(leaf_label)
        if metadata is None:
            raise ValueError(f"Leaf label is missing taxonomy metadata: {leaf_label}")

        genome_rows.append(
            {
                "genome_id": genome_id,
                "leaf_node_id": leaf_node_id,
                "genome_database": genome_database.name,
                "genome_accession": genome_accession,
                "genome_name": genome_name,
                "if_refseq": _to_int_or_none(metadata.get("if_refseq", "")),
                "checkm2_completeness": _to_float_or_none(metadata.get("checkm2_completeness", "")),
                "checkm2_contamination": _to_float_or_none(metadata.get("checkm2_contamination", "")),
                "quality_score": _to_float_or_none(metadata.get("quality_score", "")),
                "contig": _to_int_or_none(metadata.get("contig", "")),
                "species_genome_count": _to_int_or_none(metadata.get("species_genome_count", "")),
                "source": genome_database.name,
                "source_version": "",
                "protein_key_start": None,
                "protein_key_end_exclusive": None,
            }
        )
        genome_build_rows.append(
            {
                "genome_id": genome_id,
                "leaf_node_id": leaf_node_id,
                "leaf_label": leaf_label,
                "genome_name": genome_name,
                "genome_accession": genome_accession,
            }
        )

        taxonomy_path = tree_model.leaf_taxonomy_node_ids[leaf_node_id]
        row = {"node_id": leaf_node_id}
        for rank_name, column_name in RANK_TO_TAXONOMY_COLUMN.items():
            row[column_name] = taxonomy_path.get(rank_name)
        taxonomy_rows.append(row)

    genome_df = pd.DataFrame(genome_rows)
    genome_build_df = pd.DataFrame(genome_build_rows)
    taxonomy_df = pd.DataFrame(taxonomy_rows)
    return genome_df, taxonomy_df, genome_build_df


def _build_leaf_taxonomy_node_ids_by_anchor(
    *,
    leaf_node_ids: list[int],
    parent: list[int],
    consensus_taxonomy: list[list[str]],
    rooted_ranks_by_node: list[list[str]],
) -> dict[int, dict[str, int | None]]:
    """Return each leaf's rank anchors on the unmodified source tree."""
    result: dict[int, dict[str, int | None]] = {}
    species_index = RANKS.index("species")
    for leaf_node_id in leaf_node_ids:
        anchors = {rank_name: None for rank_name in RANKS}
        leaf_taxonomy = consensus_taxonomy[leaf_node_id]
        node_id = leaf_node_id
        while node_id >= 0:
            for rank_name in rooted_ranks_by_node[node_id]:
                rank_index = RANKS.index(rank_name)
                if anchors[rank_name] is None and consensus_taxonomy[node_id][rank_index] == leaf_taxonomy[rank_index]:
                    anchors[rank_name] = node_id
            node_id = parent[node_id]
        # Species rank is intentionally an occurrence at the real leaf.
        if leaf_taxonomy[species_index]:
            anchors["species"] = leaf_node_id
        result[leaf_node_id] = anchors
    return result


def _resolve_package_protein_fastas(
    *,
    genome_database: GenomeDatabaseInput,
    genome_map_df: pd.DataFrame,
    included_leaf_labels: set[str],
) -> tuple[dict[str, str], dict[str, Path]]:
    """Resolve included genomes to FASTA paths without reading protein sequences."""
    genome_name_by_leaf = (
        genome_map_df.drop_duplicates(subset=["leaf_label"])
        .set_index("leaf_label")["genome_name"]
        .to_dict()
    )
    included_genome_names = {
        str(genome_name_by_leaf[leaf_label]).strip()
        for leaf_label in included_leaf_labels
        if leaf_label in genome_name_by_leaf
    }
    fasta_path_by_genome: dict[str, Path] = {}
    protein_accession_by_genome: dict[str, str] = {}
    for fasta_path in iter_protein_fasta_paths(genome_database.protein_dir):
        accession = genome_accession_from_protein_fasta_path(fasta_path)
        genome_name = _resolve_genome_name(accession, included_genome_names)
        if genome_name in included_genome_names:
            fasta_path_by_genome[genome_name] = fasta_path
            protein_accession_by_genome[genome_name] = accession
    missing = sorted(included_genome_names - set(fasta_path_by_genome))
    if missing:
        raise ValueError(f"No protein FASTA found for included genomes. Examples: {missing[:10]}")
    return protein_accession_by_genome, fasta_path_by_genome


def _stage_protein_table(
    *,
    genome_df: pd.DataFrame,
    fasta_path_by_genome: dict[str, Path],
    output_dir: Path,
    chunk_rows: int = 100_000,
) -> tuple[StagedTable, dict[str, int], int]:
    """Build the protein table in bounded Parquet chunks ordered by genome id."""
    ensure_dirs([output_dir])
    columns = ["protein_key", "genome_id", "protein_id", "protein_name", "sequence", "sequence_length"]
    rows: list[dict[str, object]] = []
    chunk_paths: list[Path] = []
    protein_info_lookup: dict[str, int] = {}
    next_key = 1

    def flush() -> None:
        if not rows:
            return
        path = output_dir / f"protein_chunk_{len(chunk_paths):05d}.parquet"
        write_parquet(pd.DataFrame(rows, columns=columns), path)
        chunk_paths.append(path)
        rows.clear()

    for record in genome_df.sort_values("genome_id").loc[:, ["genome_id", "genome_name"]].itertuples(index=False):
        genome_id = int(record.genome_id)
        genome_name = str(record.genome_name)
        fasta_path = fasta_path_by_genome[genome_name]
        first_key = next_key
        for fasta_record in SeqIO.parse(str(fasta_path), "fasta"):
            protein_id = str(fasta_record.id)
            if protein_id in protein_info_lookup:
                raise ValueError(f"Duplicate protein id across included genomes: {protein_id}")
            sequence = str(fasta_record.seq)
            # Pack genome_id and protein_key into one Python int. This avoids
            # allocating a tuple for every protein while keeping O(1) lookup.
            protein_info_lookup[protein_id] = (genome_id << 32) | next_key
            rows.append(
                {
                    "protein_key": next_key,
                    "genome_id": genome_id,
                    "protein_id": protein_id,
                    "protein_name": protein_id,
                    "sequence": sequence,
                    "sequence_length": len(sequence),
                }
            )
            next_key += 1
            if len(rows) >= chunk_rows:
                flush()
        if next_key == first_key:
            raise ValueError(f"Protein FASTA has no records for genome: {genome_name}")
        genome_df.loc[genome_df["genome_id"].eq(genome_id), "protein_key_start"] = first_key
        genome_df.loc[genome_df["genome_id"].eq(genome_id), "protein_key_end_exclusive"] = next_key
    flush()
    return StagedTable(chunk_paths=chunk_paths, columns=columns), protein_info_lookup, next_key - 1


def _init_annotation_worker(
    protein_info_lookup: dict[str, int],
    annotation_chunk_rows: int,
) -> None:
    global _ANNOTATION_PROTEIN_INFO_LOOKUP
    global _ANNOTATION_CHUNK_ROWS
    # In worker processes this dict has already been unpickled into a private
    # object. In single-process mode it is the parent's lookup table. In both
    # cases copying 18M+ entries again is unnecessary and very expensive.
    _ANNOTATION_PROTEIN_INFO_LOOKUP = protein_info_lookup
    _ANNOTATION_CHUNK_ROWS = max(1, int(annotation_chunk_rows))


def _read_annotation_file_worker(task: tuple[str, str, int, int, int]) -> list[str]:
    annotation_path_str, output_dir_str, shard_index, start_offset, end_offset = task
    annotation_path = Path(annotation_path_str)
    annotation_type = annotation_path.stem
    output_dir = Path(output_dir_str)
    output_dir.mkdir(parents=True, exist_ok=True)
    chunk_paths: list[str] = []
    rows: list[tuple[str, str, int, int]] = []
    chunk_index = 0

    with annotation_path.open("rb") as handle:
        if start_offset > 0:
            # A byte boundary may land exactly at the start of a line. Peek at
            # the preceding byte so an aligned boundary does not discard a
            # complete record; otherwise skip only the partial first line.
            handle.seek(start_offset - 1)
            if handle.read(1) != b"\n":
                handle.readline()
        else:
            handle.seek(0)

        while True:
            if handle.tell() >= end_offset:
                break
            raw_line = handle.readline()
            if not raw_line:
                break
            _append_annotation_rows_from_line(
                raw_line=raw_line,
                annotation_type=annotation_type,
                rows=rows,
            )
            if len(rows) >= _ANNOTATION_CHUNK_ROWS:
                chunk_path = _flush_annotation_rows_to_parquet(
                    rows=rows,
                    output_dir=output_dir,
                    annotation_type=annotation_type,
                    shard_index=shard_index,
                    chunk_index=chunk_index,
                )
                if chunk_path:
                    chunk_paths.append(chunk_path)
                    chunk_index += 1

    chunk_path = _flush_annotation_rows_to_parquet(
        rows=rows,
        output_dir=output_dir,
        annotation_type=annotation_type,
        shard_index=shard_index,
        chunk_index=chunk_index,
    )
    if chunk_path:
        chunk_paths.append(chunk_path)
    return chunk_paths


def _split_annotation_line(raw_line: bytes) -> tuple[str, str] | None:
    """Parse one two-column annotation line.

    Accepted column separators are tabs, spaces, commas, and pipes. The parser
    splits only once so annotation values may contain ``+``, commas, or ``;;``.
    """
    line = raw_line.decode("utf-8", errors="replace").strip().lstrip("\ufeff")
    if not line or line.startswith("#"):
        return None
    fields = _ANNOTATION_COLUMN_DELIMITERS.split(line, maxsplit=1)
    if len(fields) != 2:
        return None
    protein_id = fields[0].strip()
    annotation_values = fields[1].strip()
    if not protein_id or not annotation_values:
        return None
    return protein_id, annotation_values


def _append_annotation_rows_from_line(
    *,
    raw_line: bytes,
    annotation_type: str,
    rows: list[tuple[str, str, int, int]],
) -> None:
    parsed = _split_annotation_line(raw_line)
    if parsed is None:
        return
    protein_id, annotation_values = parsed
    packed_protein_info = _ANNOTATION_PROTEIN_INFO_LOOKUP.get(protein_id)
    if packed_protein_info is None:
        return
    genome_id = packed_protein_info >> 32
    protein_key = packed_protein_info & _PROTEIN_KEY_MASK
    for annotation_value in annotation_values.split(";;"):
        annotation_value = annotation_value.strip()
        if not annotation_value:
            continue
        # protein_id is intentionally not stored in the staging layer: it is
        # not consumed after this lookup and was the largest repeated string in
        # the intermediate Parquet and SQLite files.
        rows.append((annotation_type, annotation_value, genome_id, protein_key))


def _flush_annotation_rows_to_parquet(
    *,
    rows: list[tuple[str, str, int, int]],
    output_dir: Path,
    annotation_type: str,
    shard_index: int,
    chunk_index: int,
) -> str:
    if not rows:
        return ""
    chunk_output_path = output_dir / f"{annotation_type}_shard_{shard_index:05d}_chunk_{chunk_index:05d}.parquet"
    write_parquet(
        pd.DataFrame.from_records(
            rows,
            columns=["annotation_type", "annotation_value", "genome_id", "protein_key"],
        ),
        chunk_output_path,
    )
    rows.clear()
    return str(chunk_output_path)


def _configure_stage_sqlite(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode=OFF")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA cache_size=-524288")  # 512 MiB
    conn.execute("PRAGMA mmap_size=2147483648")
    conn.execute("PRAGMA locking_mode=EXCLUSIVE")


def _create_annotation_stage_schema(conn: sqlite3.Connection) -> str:
    conn.execute(
        """
        CREATE TABLE annotation_hit_stage (
            annotation_type TEXT NOT NULL,
            annotation_value TEXT NOT NULL,
            genome_id INTEGER NOT NULL,
            protein_key INTEGER NOT NULL,
            PRIMARY KEY (annotation_type, annotation_value, genome_id, protein_key)
        )
        WITHOUT ROWID
        """
    )
    return """
        INSERT OR IGNORE INTO annotation_hit_stage
        (annotation_type, annotation_value, genome_id, protein_key)
        VALUES (?, ?, ?, ?)
    """


def _create_annotation_stage_index(conn: sqlite3.Connection) -> None:
    conn.execute(
        "CREATE INDEX idx_annotation_hit_stage_type_genome "
        "ON annotation_hit_stage(annotation_type, genome_id, annotation_value)"
    )


def _materialize_annotation_stage_sqlite(chunk_paths: list[Path], sqlite_path: Path) -> None:
    if sqlite_path.exists():
        sqlite_path.unlink()
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(sqlite_path)) as conn:
        _configure_stage_sqlite(conn)
        insert_sql = _create_annotation_stage_schema(conn)
        with conn:
            for chunk_path in sorted(chunk_paths):
                chunk_df = pd.read_parquet(chunk_path)
                if chunk_df.empty:
                    continue
                chunk_df = chunk_df.astype(object).where(pd.notna(chunk_df), None)
                conn.executemany(insert_sql, chunk_df.itertuples(index=False, name=None))
        _create_annotation_stage_index(conn)
        conn.commit()


def _read_annotation_hits_to_sqlite_direct(
    *,
    annotation_paths: list[Path],
    sqlite_path: Path,
    chunk_rows: int,
) -> AnnotationStage:
    """Parse annotation files directly into the staging SQLite DB.

    This removes the intermediate annotation Parquet round-trip in the common
    single-process mode. The database primary key still performs the same
    de-duplication as the multi-process path.
    """
    if sqlite_path.exists():
        sqlite_path.unlink()
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    batch_rows = max(1, int(chunk_rows))
    with closing(sqlite3.connect(sqlite_path)) as conn:
        _configure_stage_sqlite(conn)
        insert_sql = _create_annotation_stage_schema(conn)
        rows: list[tuple[str, str, int, int]] = []
        with conn:
            for annotation_path in annotation_paths:
                annotation_type = annotation_path.stem
                with annotation_path.open("rb") as handle:
                    for raw_line in handle:
                        _append_annotation_rows_from_line(
                            raw_line=raw_line,
                            annotation_type=annotation_type,
                            rows=rows,
                        )
                        if len(rows) >= batch_rows:
                            conn.executemany(insert_sql, rows)
                            rows.clear()
            if rows:
                conn.executemany(insert_sql, rows)
        _create_annotation_stage_index(conn)
        conn.commit()
    return AnnotationStage(
        sqlite_path=sqlite_path,
        chunk_paths=[],
        input_file_count=len(annotation_paths),
        shard_count=0,
        dispatch_strategy="direct_sqlite_stream_parse",
        staging_strategy="single_process_direct_sqlite_merge",
    )


def _load_observed_annotation_values(annotation_stage: AnnotationStage) -> dict[str, set[str]]:
    observed_by_type: dict[str, set[str]] = {}
    if not annotation_stage.sqlite_path.exists():
        return observed_by_type
    with sqlite3.connect(annotation_stage.sqlite_path) as conn:
        rows = conn.execute(
            """
            SELECT annotation_type, annotation_value
            FROM annotation_hit_stage
            GROUP BY annotation_type, annotation_value
            ORDER BY annotation_type, annotation_value
            """
        ).fetchall()
    for annotation_type, annotation_value in rows:
        observed_by_type.setdefault(str(annotation_type), set()).add(str(annotation_value))
    return observed_by_type


def _build_annotation_worker_tasks(
    *,
    annotation_paths: list[Path],
    stage_dir: Path,
    workers: int,
) -> list[tuple[str, str, int, int, int]]:
    if not annotation_paths:
        return []

    file_sizes = [max(1, int(path.stat().st_size)) for path in annotation_paths]
    total_bytes = sum(file_sizes)
    target_task_count = max(len(annotation_paths), max(1, int(workers)) * _ANNOTATION_TARGET_TASKS_PER_WORKER)
    target_shard_bytes = max(_ANNOTATION_MIN_SHARD_BYTES, math.ceil(total_bytes / max(1, target_task_count)))

    tasks: list[tuple[str, str, int, int, int]] = []
    for annotation_path, file_size in zip(annotation_paths, file_sizes):
        shard_count = max(1, math.ceil(file_size / target_shard_bytes))
        output_dir = stage_dir / annotation_path.stem
        for shard_index in range(shard_count):
            start_offset = math.floor(file_size * shard_index / shard_count)
            end_offset = math.floor(file_size * (shard_index + 1) / shard_count)
            tasks.append(
                (
                    str(annotation_path),
                    str(output_dir),
                    shard_index,
                    start_offset,
                    end_offset,
                )
            )
    return tasks


def _validate_annotation_worker_count(protein_count: int, workers: int) -> None:
    """Avoid copying a very large protein lookup into multiple workers."""
    if workers > 1 and protein_count > MAX_PARALLEL_PROTEIN_LOOKUP_ENTRIES:
        raise RuntimeError(
            "Annotation parallel parsing is unsafe for this dataset: "
            f"protein_lookup_entries={protein_count:,}, workers={workers}. "
            "Use --workers 1; direct single-process SQLite parsing avoids "
            "copying the lookup table into worker processes."
        )


def _annotation_hit_counts(annotation_stage: AnnotationStage) -> dict[str, int]:
    if not annotation_stage.sqlite_path.exists():
        return {}
    with closing(sqlite3.connect(annotation_stage.sqlite_path)) as conn:
        rows = conn.execute(
            "SELECT annotation_type, COUNT(*) FROM annotation_hit_stage GROUP BY annotation_type"
        ).fetchall()
    return {str(annotation_type): int(count) for annotation_type, count in rows}


def _validate_annotation_stage(
    *,
    annotation_stage: AnnotationStage,
    annotation_paths: list[Path],
) -> dict[str, int]:
    """Refuse to publish a package when an annotation type produced no hits."""
    counts = _annotation_hit_counts(annotation_stage)
    expected_types = [path.stem for path in annotation_paths]
    missing = [annotation_type for annotation_type in expected_types if counts.get(annotation_type, 0) <= 0]
    if missing:
        total = sum(counts.values())
        raise RuntimeError(
            "Annotation stage produced zero protein hits for required annotation types: "
            f"{missing}. total_hits={total}. "
            "This usually means the annotation TSV first-column protein_id values "
            "do not match FASTA-derived protein IDs, or annotation workers failed "
            "to initialize. Inspect the build log and raw annotation/FASTA IDs. "
            "Refusing to write an incomplete project_data package."
        )
    return counts


def _read_annotation_hits_for_package(
    *,
    genome_database: GenomeDatabaseInput,
    protein_info_lookup: dict[str, int],
    stage_dir: Path,
    workers: int,
    annotation_chunk_rows: int,
) -> AnnotationStage:
    annotation_paths = sorted(genome_database.annotation_dir.glob("*.tsv"))
    sqlite_path = stage_dir / "annotation_hits.sqlite"
    if not annotation_paths:
        raise FileNotFoundError(
            f"No annotation .tsv files found under {genome_database.annotation_dir}. "
            "Refusing to write a project_data package without annotation inputs."
        )
    _validate_annotation_worker_count(len(protein_info_lookup), workers)
    ensure_dirs([stage_dir])
    if workers == 1:
        _init_annotation_worker(protein_info_lookup, annotation_chunk_rows)
        return _read_annotation_hits_to_sqlite_direct(
            annotation_paths=annotation_paths,
            sqlite_path=sqlite_path,
            chunk_rows=annotation_chunk_rows,
        )

    tasks = _build_annotation_worker_tasks(
        annotation_paths=annotation_paths,
        stage_dir=stage_dir,
        workers=workers,
    )

    if workers > 1 and len(tasks) > 1:
        with ProcessPoolExecutor(
            max_workers=min(workers, len(tasks)),
            initializer=_init_annotation_worker,
            initargs=(protein_info_lookup, annotation_chunk_rows),
        ) as executor:
            chunk_path_lists = list(executor.map(_read_annotation_file_worker, tasks))
    else:
        _init_annotation_worker(protein_info_lookup, annotation_chunk_rows)
        chunk_path_lists = [_read_annotation_file_worker(task) for task in tasks]

    chunk_paths = [Path(chunk_path) for chunk_list in chunk_path_lists for chunk_path in chunk_list if chunk_path]
    _materialize_annotation_stage_sqlite(chunk_paths, sqlite_path)
    annotation_stage = AnnotationStage(
        sqlite_path=sqlite_path,
        chunk_paths=chunk_paths,
        input_file_count=len(annotation_paths),
        shard_count=len(tasks),
    )
    _validate_annotation_stage(annotation_stage=annotation_stage, annotation_paths=annotation_paths)
    return annotation_stage


def _build_annotation_tables(
    *,
    annotation_stage: AnnotationStage,
    annotation_metadata_by_type: dict[str, pd.DataFrame],
    required_kegg_codes: set[str],
) -> dict[str, pd.DataFrame]:
    tables: dict[str, pd.DataFrame] = {}
    observed_by_type = _load_observed_annotation_values(annotation_stage)

    for annotation_type in sorted(set(annotation_metadata_by_type) | set(observed_by_type)):
        metadata_df = annotation_metadata_by_type.get(annotation_type, pd.DataFrame())
        observed_values = set(observed_by_type.get(annotation_type, set()))
        if annotation_type == "kegg":
            observed_values |= {value for value in required_kegg_codes if value}
        table_df = _build_single_annotation_table(
            annotation_type=annotation_type,
            observed_values=observed_values,
            metadata_df=metadata_df,
        )
        tables[annotation_type] = table_df
    return tables


def _build_single_annotation_table(
    *,
    annotation_type: str,
    observed_values: set[str],
    metadata_df: pd.DataFrame,
) -> pd.DataFrame:
    rows_by_value: dict[str, dict[str, object]] = {}
    for value in sorted(observed_values):
        rows_by_value[value] = {
            "annotation_id": None,
            "annotation_value": value,
            "short_name": "",
            "full_name": "",
            "source": "",
            "source_version": "",
            "extra_json": "",
            "search_text": value,
        }

    if not metadata_df.empty:
        for record in metadata_df.to_dict(orient="records"):
            value = str(record.get("annotation_value", "")).strip()
            if not value:
                continue
            row = rows_by_value.setdefault(
                value,
                {
                    "annotation_id": None,
                    "annotation_value": value,
                    "short_name": "",
                    "full_name": "",
                    "source": "",
                    "source_version": "",
                    "extra_json": "",
                    "search_text": value,
                },
            )
            row["short_name"] = str(record.get("short_name", "")).strip()
            row["full_name"] = str(record.get("full_name", "")).strip()
            row["source"] = str(record.get("source", "")).strip()
            row["source_version"] = str(record.get("source_version", "")).strip()
            row["extra_json"] = str(record.get("extra_json", "")).strip()
            row["search_text"] = " ".join(
                part
                for part in [
                    value,
                    row["short_name"],
                    row["full_name"],
                ]
                if part
            ).strip()

    rows = [rows_by_value[value] for value in sorted(rows_by_value)]
    for annotation_id, row in enumerate(rows, start=1):
        row["annotation_id"] = annotation_id
    return pd.DataFrame(
        rows,
        columns=[
            "annotation_id",
            "annotation_value",
            "short_name",
            "full_name",
            "source",
            "source_version",
            "extra_json",
            "search_text",
        ],
    )


def _build_module_annotation_table(module_resources: dict[str, pd.DataFrame]) -> pd.DataFrame:
    metadata_df = module_resources.get("module_metadata_df", pd.DataFrame()).copy()
    if metadata_df.empty:
        return pd.DataFrame(
            columns=[
                "annotation_id",
                "annotation_value",
                "short_name",
                "full_name",
                "module_class",
                "module_category",
                "module_subcategory",
                "description",
                "source",
                "source_version",
                "search_text",
            ]
        )
    metadata_df = metadata_df.sort_values("module_id").reset_index(drop=True)
    cleaned_full_name = metadata_df["module_name"].astype(str).map(_clean_kegg_module_name)
    cleaned_search_text = [
        " ".join(part for part in [module_id, full_name] if part).strip()
        for module_id, full_name in zip(metadata_df["module_id"].astype(str), cleaned_full_name, strict=False)
    ]
    metadata_df.insert(0, "annotation_id", range(1, len(metadata_df) + 1))
    return pd.DataFrame(
        {
            "annotation_id": metadata_df["annotation_id"],
            "annotation_value": metadata_df["module_id"].astype(str),
            "short_name": metadata_df["module_id"].astype(str),
            "full_name": cleaned_full_name,
            "module_class": _series_or_empty(metadata_df, "module_class"),
            "module_category": _series_or_empty(metadata_df, "module_category"),
            "module_subcategory": _series_or_empty(metadata_df, "module_subcategory"),
            "description": _series_or_empty(metadata_df, "description"),
            "source": _series_or_empty(metadata_df, "source"),
            "source_version": _series_or_empty(metadata_df, "source_version"),
            "search_text": cleaned_search_text,
        }
    )


def _build_module_kegg_member_table(
    *,
    module_resources: dict[str, pd.DataFrame],
    module_annotation_df: pd.DataFrame,
    kegg_annotation_df: pd.DataFrame,
) -> pd.DataFrame:
    column_df = module_resources.get("module_column_registry_df", pd.DataFrame()).copy()
    if column_df.empty or module_annotation_df.empty or kegg_annotation_df.empty:
        return pd.DataFrame(
            columns=["module_annotation_id", "kegg_annotation_ids_json"]
        )
    module_id_lookup = (
        module_annotation_df.set_index("annotation_value")["annotation_id"].to_dict()
    )
    kegg_id_lookup = (
        kegg_annotation_df.set_index("annotation_value")["annotation_id"].to_dict()
    )
    members_by_module: dict[int, list[int]] = {}
    missing_kos: list[str] = []
    for record in column_df.to_dict(orient="records"):
        module_id = str(record["module_id"])
        ko_id = str(record["ko_id"])
        module_annotation_id = module_id_lookup.get(module_id)
        kegg_annotation_id = kegg_id_lookup.get(ko_id)
        if module_annotation_id is None or kegg_annotation_id is None:
            missing_kos.append(ko_id)
            continue
        members_by_module.setdefault(int(module_annotation_id), []).append(int(kegg_annotation_id))
    if missing_kos:
        missing_unique = sorted(set(missing_kos))
        raise ValueError(f"Module KO members are missing in kegg_annotation: {missing_unique[:10]}")
    rows = [
        {
            "module_annotation_id": module_annotation_id,
            "kegg_annotation_ids_json": json.dumps(kegg_annotation_ids, ensure_ascii=False, separators=(",", ":")),
        }
        for module_annotation_id, kegg_annotation_ids in sorted(members_by_module.items())
    ]
    return pd.DataFrame(rows, columns=["module_annotation_id", "kegg_annotation_ids_json"])


def _build_protein_annotation_table(
    *,
    annotation_stage: AnnotationStage,
    annotation_tables: dict[str, pd.DataFrame],
    output_dir: Path,
    chunk_rows: int,
) -> tuple[StagedTable, int]:
    columns = [
        "annotation_hit_id",
        "annotation_type",
        "annotation_id",
        "genome_id",
        "protein_key",
    ]
    ensure_dirs([output_dir])
    chunk_paths: list[Path] = []
    if not annotation_tables:
        return StagedTable(chunk_paths=[], columns=columns), 0

    next_annotation_hit_id = 1
    total_rows = 0
    sql = """
        SELECT annotation_value, genome_id, protein_key
        FROM annotation_hit_stage
        WHERE annotation_type = ?
        ORDER BY annotation_value, genome_id, protein_key
    """
    with sqlite3.connect(annotation_stage.sqlite_path) as conn:
        for annotation_type, table_df in sorted(annotation_tables.items()):
            annotation_id_lookup = (
                table_df.loc[:, ["annotation_value", "annotation_id"]]
                .dropna(subset=["annotation_id"])
                .set_index("annotation_value")["annotation_id"]
                .to_dict()
            )
            chunk_index = 0
            for chunk in pd.read_sql_query(sql, conn, params=[annotation_type], chunksize=max(1, int(chunk_rows))):
                if chunk.empty:
                    continue
                chunk["annotation_id"] = chunk["annotation_value"].map(annotation_id_lookup)
                chunk = chunk.dropna(subset=["annotation_id"]).copy()
                if chunk.empty:
                    continue
                chunk["annotation_type"] = annotation_type
                chunk["annotation_id"] = chunk["annotation_id"].astype(int)
                chunk["genome_id"] = chunk["genome_id"].astype(int)
                chunk["protein_key"] = chunk["protein_key"].astype(int)
                chunk = chunk.loc[:, ["annotation_type", "annotation_id", "genome_id", "protein_key"]]
                chunk = chunk.sort_values(
                    ["annotation_type", "annotation_id", "genome_id", "protein_key"],
                    kind="stable",
                ).reset_index(drop=True)
                chunk.insert(0, "annotation_hit_id", range(next_annotation_hit_id, next_annotation_hit_id + len(chunk)))
                next_annotation_hit_id += len(chunk)
                total_rows += len(chunk)
                chunk_path = output_dir / f"{annotation_type}_protein_annotation_{chunk_index:05d}.parquet"
                write_parquet(chunk, chunk_path)
                chunk_paths.append(chunk_path)
                chunk_index += 1
    return StagedTable(chunk_paths=chunk_paths, columns=columns), total_rows


def _build_tree_node_table(tree_model: TreeModel) -> pd.DataFrame:
    rows = []
    for node_id in range(len(tree_model.parent)):
        rows.append(
            {
                "node_id": node_id,
                "parent_id": tree_model.parent[node_id] if tree_model.parent[node_id] >= 0 else None,
                "node_in": tree_model.node_in[node_id],
                "node_out": tree_model.node_out[node_id],
                "rank": tree_model.node_rank[node_id] or None,
                "is_leaf": 0 if tree_model.children[node_id] else 1,
                "branch_length": round(float(tree_model.branch_length[node_id]), 8),
                "cumulative_branch_length": round(float(tree_model.cumulative_branch_length[node_id]), 8),
            }
        )
    return pd.DataFrame(rows)


def _build_tree_core_payload(
    *,
    tree_input: SpeciesTreeInput,
    tree_model: TreeModel,
) -> dict[str, object]:
    strings = [""]
    string_lookup = {"": 0}

    def intern(value: str) -> int:
        value = str(value or "")
        if value in string_lookup:
            return string_lookup[value]
        string_lookup[value] = len(strings)
        strings.append(value)
        return string_lookup[value]

    rank_values = ["", *RANKS]
    rank_lookup = {value: index for index, value in enumerate(rank_values)}
    leaf_name_id = [intern(tree_model.leaf_labels_by_node[node_id]) if not tree_model.children[node_id] else 0 for node_id in range(len(tree_model.parent))]
    taxon_name_id = [intern(tree_model.node_taxon_name[node_id]) if tree_model.node_taxon_name[node_id] else 0 for node_id in range(len(tree_model.parent))]
    rank_id = [rank_lookup.get(tree_model.node_rank[node_id], 0) for node_id in range(len(tree_model.parent))]

    children_offsets = [0]
    children_pool: list[int] = []
    for child_ids in tree_model.children:
        children_pool.extend(child_ids)
        children_offsets.append(len(children_pool))

    named_taxa = sorted(
        tree_model.named_taxon_rows,
        key=lambda item: (RANKS.index(str(item["rank"])), int(item["node_id"]), str(item["taxon_name"])),
    )

    return {
        "schema_version": "4.0",
        "species_tree": tree_input.tree_stem,
        "genome_database": tree_input.genome_database,
        "root_id": tree_model.root_id,
        "node_count": len(tree_model.parent),
        "leaf_count": len(tree_model.leaf_node_ids_in_row_order),
        "strings": strings,
        "ranks": rank_values,
        "parent": tree_model.parent,
        "node_in": tree_model.node_in,
        "node_out": tree_model.node_out,
        "rank_id": rank_id,
        "is_leaf": [0 if tree_model.children[node_id] else 1 for node_id in range(len(tree_model.parent))],
        "branch_length": [round(float(value), 8) for value in tree_model.branch_length],
        "cumulative_branch_length": [round(float(value), 8) for value in tree_model.cumulative_branch_length],
        "leaf_name_id": leaf_name_id,
        "taxon_name_id": taxon_name_id,
        "children_offsets": children_offsets,
        "children_pool": children_pool,
        "named_taxa_rank_id": [rank_lookup[str(item["rank"])] for item in named_taxa],
        "named_taxa_node_id": [int(item["node_id"]) for item in named_taxa],
        "named_taxa_name_id": [intern(str(item["taxon_name"])) for item in named_taxa],
    }


def _write_tree_core(payload: dict[str, object], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with gzip.open(path, "wb") as handle:
        handle.write(raw)


def _annotation_matrix_chunk_rows(column_count: int) -> int:
    return max(1, min(50_000, ANNOTATION_MATRIX_TARGET_CELLS // max(1, int(column_count))))


def _write_annotation_matrix_parquet(
    *,
    annotation_stage: AnnotationStage,
    annotation_type: str,
    columns: list[str],
    genome_ids: list[int],
    output_path: Path,
) -> None:
    """Write a wide annotation matrix in bounded genome_id row chunks."""
    if not columns:
        raise ValueError(f"No annotation columns available for {annotation_type}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    column_lookup = {value: index for index, value in enumerate(columns)}
    schema = pa.schema([pa.field(str(value), pa.int32()) for value in columns])
    chunk_rows = _annotation_matrix_chunk_rows(len(columns))
    sql = """
        SELECT genome_id, annotation_value, COUNT(DISTINCT protein_key) AS hit_count
        FROM annotation_hit_stage
        WHERE annotation_type = ? AND genome_id BETWEEN ? AND ?
        GROUP BY genome_id, annotation_value
    """
    writer = pq.ParquetWriter(output_path, schema, compression="snappy")
    try:
        with closing(sqlite3.connect(annotation_stage.sqlite_path)) as conn:
            for start in range(0, len(genome_ids), chunk_rows):
                chunk_ids = genome_ids[start : start + chunk_rows]
                row_lookup = {genome_id: index for index, genome_id in enumerate(chunk_ids)}
                matrix = np.zeros((len(chunk_ids), len(columns)), dtype=np.int32)
                query_rows = conn.execute(
                    sql,
                    (annotation_type, chunk_ids[0], chunk_ids[-1]),
                ).fetchall()
                for genome_id, annotation_value, hit_count in query_rows:
                    row_index = row_lookup.get(int(genome_id))
                    column_index = column_lookup.get(str(annotation_value))
                    if row_index is None or column_index is None:
                        continue
                    matrix[row_index, column_index] = int(hit_count)
                arrays = [pa.array(matrix[:, index], type=pa.int32()) for index in range(len(columns))]
                table = pa.Table.from_arrays(arrays, schema=schema)
                writer.write_table(table, row_group_size=len(chunk_ids))
    finally:
        writer.close()


def _build_annotation_matrices(
    *,
    matrices_dir: Path,
    genome_df: pd.DataFrame,
    annotation_stage: AnnotationStage,
    annotation_tables: dict[str, pd.DataFrame],
    package_root: Path,
    genome_database: str,
) -> pd.DataFrame:
    registry_columns = ["matrix_kind", "genome_database", "annotation_type", "matrix_path", "matrix_format", "row_count", "column_count", "value_type"]
    if not annotation_tables:
        return pd.DataFrame(columns=registry_columns)
    genome_ids = sorted(genome_df["genome_id"].astype(int).tolist())
    registry_rows: list[dict[str, object]] = []
    with closing(sqlite3.connect(annotation_stage.sqlite_path)) as conn:
        for annotation_type, table_df in sorted(annotation_tables.items()):
            observed_values = {
                str(row[0])
                for row in conn.execute(
                    "SELECT DISTINCT annotation_value FROM annotation_hit_stage WHERE annotation_type = ?",
                    (annotation_type,),
                )
            }
            if not observed_values:
                continue
            table_values = table_df["annotation_value"].astype(str).tolist()
            ordered_columns = [value for value in table_values if value in observed_values]
            missing_values = sorted(observed_values - set(ordered_columns))
            ordered_columns.extend(missing_values)
            matrix_path = matrices_dir / f"{annotation_type}.parquet"
            _write_annotation_matrix_parquet(
                annotation_stage=annotation_stage,
                annotation_type=annotation_type,
                columns=ordered_columns,
                genome_ids=genome_ids,
                output_path=matrix_path,
            )
            registry_rows.append(
                {
                    "matrix_kind": "annotation",
                    "genome_database": genome_database,
                    "annotation_type": annotation_type,
                    "matrix_path": _relative_to_package(matrix_path, package_root),
                    "matrix_format": "parquet_wide_row_ordered",
                    "row_count": len(genome_ids),
                    "column_count": len(ordered_columns),
                    "value_type": "protein_hit_count",
                }
            )
    return pd.DataFrame(registry_rows, columns=registry_columns)


def _build_module_completeness_matrix(
    *,
    source_dir: Path,
    output_dir: Path,
    genome_build_df: pd.DataFrame,
    module_annotation_df: pd.DataFrame,
    package_root: Path,
    genome_database: str,
) -> pd.DataFrame:
    source_path = source_dir / "completeness_matrix.tsv"
    if not source_path.exists():
        return pd.DataFrame(
            columns=["matrix_kind", "genome_database", "annotation_type", "matrix_path", "matrix_format", "row_count", "column_count", "value_type"]
        )
    raw_df = pd.read_csv(source_path, sep="\t", dtype=str, keep_default_na=False)
    if raw_df.empty or len(raw_df.columns) < 2:
        raise ValueError(f"Module completeness matrix is empty or invalid: {source_path}")
    source_key = str(raw_df.columns[0])
    raw_df = raw_df.rename(columns={source_key: "source_accession"})
    raw_df["source_accession"] = raw_df["source_accession"].astype(str).str.strip()
    empty_accessions = raw_df["source_accession"].eq("")
    if empty_accessions.any():
        raise ValueError(f"Module completeness matrix has empty source accessions: {source_path}")
    duplicate_accessions = raw_df.loc[
        raw_df["source_accession"].duplicated(), "source_accession"
    ].unique().tolist()
    if duplicate_accessions:
        raise ValueError(
            "Module completeness matrix has duplicate source accessions. "
            f"Examples: {duplicate_accessions[:10]}"
        )
    for column in raw_df.columns[1:]:
        raw_df[column] = pd.to_numeric(raw_df[column], errors="raise")

    source_accessions = set(raw_df["source_accession"].astype(str))
    match_column = _choose_module_match_column(genome_build_df, source_accessions)
    aligned_df = genome_build_df[[match_column, "genome_id"]].merge(
        raw_df,
        left_on=match_column,
        right_on="source_accession",
        how="left",
    )
    missing = aligned_df.loc[aligned_df["source_accession"].isna(), match_column].astype(str).tolist()
    if missing:
        raise ValueError(f"Module completeness matrix is missing genomes. Examples: {missing[:10]}")
    module_columns = module_annotation_df["annotation_value"].astype(str).tolist()
    missing_module_columns = [column for column in module_columns if column not in raw_df.columns]
    if missing_module_columns:
        raise ValueError(
            "Module completeness matrix is missing Module columns. "
            f"Examples: {missing_module_columns[:10]}"
        )
    matrix_df = aligned_df.sort_values("genome_id").loc[:, module_columns]
    if len(matrix_df) != len(genome_build_df):
        raise ValueError(
            "Module completeness alignment changed the genome row count: "
            f"expected={len(genome_build_df)}, actual={len(matrix_df)}"
        )
    matrix_path = output_dir / "module_completeness.parquet"
    write_parquet(matrix_df.reset_index(drop=True), matrix_path)
    return pd.DataFrame(
        [
            {
                "matrix_kind": "module_completeness",
                "genome_database": genome_database,
                "annotation_type": "module",
                "matrix_path": _relative_to_package(matrix_path, package_root),
                "matrix_format": "parquet_wide_row_ordered",
                "row_count": int(matrix_df.shape[0]),
                "column_count": int(matrix_df.shape[1]),
                "value_type": "percent_0_100_external",
            }
        ]
    )


def _choose_module_match_column(leaf_join_df: pd.DataFrame, source_accessions: set[str]) -> str:
    candidates = ["genome_name", "genome_accession", "leaf_label"]
    for column in candidates:
        values = set(leaf_join_df[column].astype(str))
        if values == source_accessions:
            return column
    scores = {
        column: len(set(leaf_join_df[column].astype(str)) & source_accessions)
        for column in candidates
    }
    best = max(scores, key=scores.get)
    raise ValueError(
        "Module completeness accessions do not fully match leaf/genome identifiers. "
        f"Best match: {best}={scores[best]}"
    )


def _configure_build_sqlite(conn: sqlite3.Connection) -> None:
    """Use build-only SQLite settings for the disposable output database."""
    conn.execute("PRAGMA journal_mode=OFF")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA cache_size=-524288")  # 512 MiB page cache
    conn.execute("PRAGMA mmap_size=2147483648")  # 2 GiB mmap window
    conn.execute("PRAGMA locking_mode=EXCLUSIVE")
    thread_count = max(1, min(4, os.cpu_count() or 1))
    try:
        conn.execute(f"PRAGMA threads={thread_count}")
    except sqlite3.DatabaseError:
        # Older SQLite builds may not expose PRAGMA threads.
        pass


def _write_runtime_sqlite(
    *,
    sqlite_path: Path,
    tables: dict[str, object],
) -> Path:
    if sqlite_path.exists():
        sqlite_path.unlink()
    with closing(sqlite3.connect(sqlite_path)) as conn:
        _configure_build_sqlite(conn)
        for table_name, table_payload in tables.items():
            if isinstance(table_payload, StagedTable):
                _write_chunked_table_to_sqlite(conn, table_name, table_payload)
                continue
            table_payload.to_sql(table_name, conn, index=False, if_exists="replace")
        _create_runtime_indexes(conn)
    return sqlite_path


def _write_chunked_table_to_sqlite(
    conn: sqlite3.Connection,
    table_name: str,
    staged_table: StagedTable,
) -> None:
    if not staged_table.chunk_paths:
        pd.DataFrame(columns=staged_table.columns).to_sql(table_name, conn, index=False, if_exists="replace")
        return

    first_chunk = pd.read_parquet(staged_table.chunk_paths[0])
    # Create the table schema once, then append every chunk inside one
    # transaction. pandas.to_sql commits after each call, which previously
    # caused one transaction per 100k-row chunk.
    first_chunk.iloc[:0].to_sql(table_name, conn, index=False, if_exists="replace")
    placeholders = ", ".join("?" for _ in staged_table.columns)
    insert_sql = f'INSERT INTO "{table_name}" VALUES ({placeholders})'
    with conn:
        for chunk_path in staged_table.chunk_paths:
            chunk_df = pd.read_parquet(chunk_path)
            if chunk_df.empty:
                continue
            # Convert numpy scalar values to native Python values so sqlite3's
            # executemany can bind them without pandas' per-row overhead.
            chunk_df = chunk_df.astype(object).where(pd.notna(chunk_df), None)
            conn.executemany(
                insert_sql,
                chunk_df.itertuples(index=False, name=None),
            )


def _create_runtime_indexes(conn: sqlite3.Connection) -> None:
    conn.commit()
    # Approximate statistics are sufficient for this read-mostly runtime DB and
    # are much cheaper than a full ANALYZE over 39M annotation rows.
    conn.execute("PRAGMA analysis_limit=1000")
    apply_runtime_indexes(conn, include_supporting_indexes=True)


def _build_manifest(
    *,
    tree_input: SpeciesTreeInput,
    package_root: Path,
    sqlite_path: Path,
    tree_core_path: Path,
    tree_copy_path: Path,
    tree_model: TreeModel,
    genome_df: pd.DataFrame,
    protein_row_count: int,
    protein_annotation_row_count: int,
    matrix_registry_df: pd.DataFrame,
    annotation_tables: dict[str, pd.DataFrame],
    module_annotation_df: pd.DataFrame,
    annotation_stage: AnnotationStage,
    workers: int,
    annotation_chunk_rows: int,
    stage_dir: Path,
    build_timings: dict[str, float],
) -> dict[str, object]:
    return {
        "schema_version": "4.0",
        "pipeline_version": __version__,
        "package_mode": "single_tree_single_database",
        "species_tree": tree_input.tree_stem,
        "genome_database": tree_input.genome_database,
        "database": {
            "sqlite": _relative_to_package(sqlite_path, package_root),
        },
        "tree": {
            "tree_core_path": _relative_to_package(tree_core_path, package_root),
            "tree_core_format": "json-gzip",
            "tree_newick_path": _relative_to_package(tree_copy_path, package_root),
            "root_id": tree_model.root_id,
            "node_count": len(tree_model.parent),
            "leaf_count": len(tree_model.leaf_node_ids_in_row_order),
        },
        "matrices": matrix_registry_df.to_dict(orient="records"),
        "annotation_tables": {
            f"{annotation_type}_annotation": int(len(table_df))
            for annotation_type, table_df in sorted(annotation_tables.items())
        },
        "build_performance": {
            "annotation_hit_counts": _annotation_hit_counts(annotation_stage),
            "workers_used": int(workers),
            "annotation_chunk_rows": int(annotation_chunk_rows),
            "parallel_fasta_reader": False,
            "parallel_annotation_reader": bool(workers > 1),
            "fasta_reader_strategy": "sequential_single_process",
            "staging_dir": str(stage_dir),
            "annotation_input_files": int(annotation_stage.input_file_count),
            "annotation_shards": int(annotation_stage.shard_count),
            "annotation_stage_chunk_files": int(len(annotation_stage.chunk_paths)),
            "annotation_dispatch_strategy": annotation_stage.dispatch_strategy,
            "staging_strategy": annotation_stage.staging_strategy,
            "timing_seconds": build_timings,
        },
        "entity_counts": {
            "genome": int(len(genome_df)),
            "tree_node": len(tree_model.parent),
            "protein": int(protein_row_count),
            "protein_annotation": int(protein_annotation_row_count),
            "module_annotation": int(len(module_annotation_df)),
        },
    }


def _load_annotation_metadata_table(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, sep="\t", dtype=str, keep_default_na=False)
    if "accession" not in df.columns:
        raise ValueError(f"Annotation names file is missing accession column: {path}")
    table_df = pd.DataFrame()
    table_df["annotation_value"] = df["accession"].astype(str).str.strip()
    table_df["short_name"] = df["short_name"].astype(str).str.strip() if "short_name" in df.columns else ""
    table_df["full_name"] = df["full_name"].astype(str).str.strip() if "full_name" in df.columns else ""
    table_df["source"] = df["source"].astype(str).str.strip() if "source" in df.columns else ""
    table_df["source_version"] = df["source_version"].astype(str).str.strip() if "source_version" in df.columns else ""
    core_columns = {"accession", "short_name", "full_name", "source", "source_version"}
    extra_columns = [column for column in df.columns if column not in core_columns]
    table_df["extra_json"] = [
        json.dumps({column: row[column] for column in extra_columns}, ensure_ascii=False)
        for row in df.to_dict(orient="records")
    ]
    return table_df.loc[table_df["annotation_value"].ne("")].drop_duplicates(subset=["annotation_value"])


def _read_genome_leaf_map(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, sep="\t", dtype=str, keep_default_na=False)
    required = {"genome_name", "leaf_label"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"{path} is missing required columns: {sorted(missing)}")
    df["genome_name"] = df["genome_name"].astype(str).str.strip()
    df["leaf_label"] = df["leaf_label"].astype(str).str.strip()
    df = df.loc[df["genome_name"].ne("") & df["leaf_label"].ne("")].copy()
    if df["leaf_label"].duplicated().any():
        duplicates = df.loc[df["leaf_label"].duplicated(), "leaf_label"].head(10).tolist()
        raise ValueError(f"Duplicate leaf_label entries in mapping file: {duplicates}")
    if df["genome_name"].duplicated().any():
        duplicates = df.loc[df["genome_name"].duplicated(), "genome_name"].head(10).tolist()
        raise ValueError(f"Duplicate genome_name entries in mapping file: {duplicates}")
    return df


def _read_taxonomy_table(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, sep="\t", dtype=str, keep_default_na=False)
    lower_map = {str(column).strip().lower(): column for column in df.columns}
    accession_col = lower_map.get("accession") or lower_map.get("genome_name")
    taxonomy_col = lower_map.get("gtdb_taxonomy") or lower_map.get("gtdb_taxon")
    if accession_col is None or taxonomy_col is None:
        raise KeyError(f"Taxonomy file must contain accession/genome_name and gtdb_taxonomy: {path}")
    result = pd.DataFrame(
        {
            "accession": df[accession_col].astype(str).str.strip(),
            "gtdb_taxonomy": df[taxonomy_col].astype(str).str.strip(),
        }
    )
    for column in [
        "if_refseq",
        "checkm2_completeness",
        "checkm2_contamination",
        "quality_score",
        "contig",
        "species_genome_count",
    ]:
        source_col = lower_map.get(column)
        result[column] = df[source_col].astype(str).str.strip() if source_col is not None else ""
    return result.loc[result["accession"].ne("") & result["gtdb_taxonomy"].ne("")].drop_duplicates(subset=["accession"])


def _read_metadata_taxonomy(path: Path, accessions: list[str]) -> dict[str, list[str]]:
    wanted = set(accessions)
    found: dict[str, list[str]] = {}
    with path.open("r", encoding="utf-8", newline="") as handle:
        header = handle.readline().rstrip("\n").split("\t")
        normalized_header = [str(column).strip().lower().lstrip("\ufeff") for column in header]
        try:
            accession_index = normalized_header.index("accession")
        except ValueError:
            try:
                accession_index = normalized_header.index("genome_name")
            except ValueError as exc:
                raise ValueError(
                    f"{path} is missing required accession column. "
                    "Expected one of: accession, genome_name"
                ) from exc
        try:
            taxonomy_index = normalized_header.index("gtdb_taxonomy")
        except ValueError:
            try:
                taxonomy_index = normalized_header.index("gtdb_taxon")
            except ValueError as exc:
                raise ValueError(
                    f"{path} is missing required taxonomy column. "
                    "Expected one of: gtdb_taxonomy, gtdb_taxon"
                ) from exc
        max_index = max(accession_index, taxonomy_index)
        for line in handle:
            columns = line.rstrip("\n").split("\t")
            if len(columns) <= max_index:
                continue
            accession = columns[accession_index]
            if accession not in wanted:
                continue
            found[accession] = _parse_taxonomy(columns[taxonomy_index])
            if len(found) == len(wanted):
                break
    return found


def _parse_taxonomy(raw: str) -> list[str]:
    result = [""] * len(RANKS)
    for item in str(raw).split(";"):
        item = item.strip()
        for index, prefix in enumerate(PREFIXES):
            if item.startswith(prefix):
                result[index] = item[len(prefix) :]
                break
    return result


def _split_annotation_values(df: pd.DataFrame) -> pd.DataFrame:
    result = df.copy()
    result["annotation_value"] = result["annotation_value"].astype(str).str.split(";;")
    result = result.explode("annotation_value", ignore_index=True)
    result["annotation_value"] = result["annotation_value"].fillna("").astype(str).str.strip()
    return result.loc[:, df.columns]


def _parse_newick(path: Path) -> tuple[int, list[list[int]], list[int], list[float], list[str]]:
    text = path.read_text(encoding="utf-8")
    length = len(text)
    children: list[list[int]] = []
    parent: list[int] = []
    branch_length: list[float] = []
    names: list[str] = []

    def skip_ws(pos: int) -> int:
        while pos < length and text[pos].isspace():
            pos += 1
        return pos

    def new_node(parent_id: int) -> int:
        node_id = len(children)
        children.append([])
        parent.append(parent_id)
        branch_length.append(0.0)
        names.append("")
        return node_id

    def read_quoted(pos: int) -> tuple[str, int]:
        pos += 1
        out: list[str] = []
        while pos < length:
            char = text[pos]
            if char == "'":
                if pos + 1 < length and text[pos + 1] == "'":
                    out.append("'")
                    pos += 2
                    continue
                return "".join(out), pos + 1
            out.append(char)
            pos += 1
        raise ValueError(f"Unclosed quoted Newick label in {path}")

    def read_label_and_length(node_id: int, pos: int) -> int:
        pos = skip_ws(pos)
        if pos < length and text[pos] == "'":
            label, pos = read_quoted(pos)
            names[node_id] = label.strip()
        else:
            start = pos
            while pos < length and text[pos] not in ":,();" and not text[pos].isspace():
                pos += 1
            if pos > start:
                names[node_id] = text[start:pos].strip()
        pos = skip_ws(pos)
        if pos < length and text[pos] == ":":
            pos += 1
            pos = skip_ws(pos)
            start = pos
            while pos < length and text[pos] not in ",();" and not text[pos].isspace():
                pos += 1
            raw = text[start:pos].strip()
            if raw:
                try:
                    branch_length[node_id] = float(raw)
                except ValueError:
                    branch_length[node_id] = 0.0
        return skip_ws(pos)

    def parse_subtree(pos: int, parent_id: int) -> tuple[int, int]:
        pos = skip_ws(pos)
        if pos >= length:
            raise ValueError(f"Unexpected end of Newick file: {path}")
        if text[pos] == "(":
            node_id = new_node(parent_id)
            pos += 1
            while True:
                child_id, pos = parse_subtree(pos, node_id)
                children[node_id].append(child_id)
                pos = skip_ws(pos)
                if pos < length and text[pos] == ",":
                    pos += 1
                    continue
                if pos < length and text[pos] == ")":
                    pos += 1
                    break
                found = text[pos] if pos < length else "EOF"
                raise ValueError(f"Unexpected Newick character {found!r} at offset {pos} in {path}")
            return node_id, read_label_and_length(node_id, pos)
        node_id = new_node(parent_id)
        return node_id, read_label_and_length(node_id, pos)

    root_id, pos = parse_subtree(0, -1)
    pos = skip_ws(pos)
    if pos < length and text[pos] == ";":
        pos += 1
    if text[pos:].strip():
        raise ValueError(f"Unexpected trailing content in {path}")
    return root_id, children, parent, branch_length, names


def _compute_node_intervals(root_id: int, children: list[list[int]]) -> tuple[list[int], list[int]]:
    node_in = [0] * len(children)
    node_out = [0] * len(children)
    counter = 0
    stack = [(root_id, 0)]
    while stack:
        node_id, state = stack.pop()
        if state == 0:
            node_in[node_id] = counter
            counter += 1
            stack.append((node_id, 1))
            for child_id in reversed(children[node_id]):
                stack.append((child_id, 0))
        else:
            node_out[node_id] = counter
    return node_in, node_out


def _compute_cumulative_branch_lengths(
    root_id: int,
    children: list[list[int]],
    branch_length: list[float],
) -> list[float]:
    cumulative = [0.0] * len(children)
    stack = [root_id]
    while stack:
        node_id = stack.pop()
        for child_id in children[node_id]:
            cumulative[child_id] = cumulative[node_id] + float(branch_length[child_id])
            stack.append(child_id)
    return [round(value, 8) for value in cumulative]


def _postorder(root_id: int, children: list[list[int]]) -> list[int]:
    order: list[int] = []
    stack = [(root_id, False)]
    while stack:
        node_id, visited = stack.pop()
        if visited:
            order.append(node_id)
            continue
        stack.append((node_id, True))
        for child_id in reversed(children[node_id]):
            stack.append((child_id, False))
    return order


def _normalize_taxon_name(value: str) -> str:
    return " ".join(str(value).strip().lower().split())


def _resolve_genome_name(genome_accession: str, genome_names: set[str]) -> str:
    candidates = [genome_accession]
    if genome_accession.startswith("GCA_"):
        candidates.append(f"GB_{genome_accession}")
    if genome_accession.startswith("GCF_"):
        candidates.append(f"RS_{genome_accession}")
    for candidate in candidates:
        if candidate in genome_names:
            return candidate
    return candidates[-1] if len(candidates) > 1 else genome_accession


def _partition_evenly(items: list[Path], worker_count: int) -> list[list[Path]]:
    if not items:
        return []
    actual_workers = max(1, min(worker_count, len(items)))
    batch_size = math.ceil(len(items) / actual_workers)
    return [items[index : index + batch_size] for index in range(0, len(items), batch_size)]


def _read_parquet_chunks(chunk_paths: list[Path]) -> pd.DataFrame:
    if not chunk_paths:
        return pd.DataFrame()
    frames = [pd.read_parquet(chunk_path) for chunk_path in sorted(chunk_paths)]
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def _relative_to_package(path: Path, package_root: Path) -> str:
    return path.resolve().relative_to(package_root.resolve()).as_posix()


def _validate_dense_genome_ids(genome_df: pd.DataFrame) -> None:
    observed = genome_df["genome_id"].astype(int).tolist()
    expected = list(range(len(observed)))
    if observed != expected:
        raise ValueError(
            "genome_id must be 0-based, dense, stable, and gapless. "
            f"Observed head: {observed[:10]}, expected head: {expected[:10]}"
        )


def _series_or_empty(df: pd.DataFrame, column: str) -> pd.Series:
    if column in df.columns:
        return df[column].astype(str)
    return pd.Series([""] * len(df), index=df.index, dtype="string")


def _to_float_or_none(value: object) -> float | None:
    text = str(value).strip()
    if not text:
        return None
    return float(text)


def _to_int_or_none(value: object) -> int | None:
    text = str(value).strip()
    if not text:
        return None
    return int(float(text))
