from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True)
class GenomeDatabaseInput:
    name: str
    root_dir: Path
    protein_dir: Path
    annotation_dir: Path
    genome_leaf_map_path: Path


@dataclass(slots=True)
class SpeciesTreeInput:
    tree_file: str
    tree_stem: str
    genome_database: str
    tree_path: Path
    taxonomy_path: Path


@dataclass(slots=True)
class ModuleSourceInput:
    root_dir: Path
    raw_dir: Path
    info_path: Path
    list_path: Path
    link_ko_module_path: Path
    entries_dir: Path
