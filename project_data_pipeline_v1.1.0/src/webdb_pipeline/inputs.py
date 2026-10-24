from __future__ import annotations

from pathlib import Path

from .builders import iter_protein_fasta_paths
from .models import GenomeDatabaseInput, ModuleSourceInput, SpeciesTreeInput


TREE_SUFFIX = ".tre"


def discover_genome_databases(protein_anno_dir: Path) -> dict[str, GenomeDatabaseInput]:
    databases: dict[str, GenomeDatabaseInput] = {}
    if not protein_anno_dir.exists():
        return databases

    for path in sorted(protein_anno_dir.iterdir()):
        if not path.is_dir():
            continue
        protein_dir = path / "protein"
        annotation_dir = path / "annotation"
        mapping_path = path / "genome_leafLabel_mapping.tsv"
        if protein_dir.exists() or annotation_dir.exists() or mapping_path.exists():
            databases[path.name] = GenomeDatabaseInput(
                name=path.name,
                root_dir=path,
                protein_dir=protein_dir,
                annotation_dir=annotation_dir,
                genome_leaf_map_path=mapping_path,
            )
    return databases


def discover_annotation_name_files(protein_anno_dir: Path) -> dict[str, Path]:
    files: dict[str, Path] = {}
    if not protein_anno_dir.exists():
        return files

    for path in sorted(protein_anno_dir.glob("*_annotation_names.tsv")):
        annotation_type = path.name.removesuffix("_annotation_names.tsv")
        files[annotation_type] = path
    return files


def discover_species_tree_inputs(
    species_tree_dir: Path,
    genome_databases: dict[str, GenomeDatabaseInput],
) -> dict[str, SpeciesTreeInput]:
    mapping_path = species_tree_dir / "speciesTree_genomesDatabase_mapping.txt"
    if not mapping_path.exists():
        return {}

    inputs: dict[str, SpeciesTreeInput] = {}
    for line_number, raw_line in enumerate(mapping_path.read_text(encoding="utf-8-sig").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        separator = ":" if ":" in line else "：" if "：" in line else ""
        if not separator:
            raise ValueError(f"Invalid tree mapping line {line_number}: {raw_line}")
        tree_ref, genome_database_ref = [part.strip() for part in line.split(separator, 1)]
        genome_database = _resolve_genome_database_name(genome_database_ref, genome_databases)
        tree_path, taxonomy_path, tree_stem = _resolve_tree_mapping_input(species_tree_dir, tree_ref)
        inputs[tree_stem] = SpeciesTreeInput(
            tree_file=tree_path.name,
            tree_stem=tree_stem,
            genome_database=genome_database,
            tree_path=tree_path,
            taxonomy_path=taxonomy_path,
        )
    return inputs


def discover_module_source_input(module_source_dir: Path) -> ModuleSourceInput | None:
    if not module_source_dir.exists():
        return None

    raw_dir = module_source_dir / "raw"
    info_path = raw_dir / "info_module.txt"
    list_path = raw_dir / "list_module.tsv"
    link_ko_module_path = raw_dir / "link_ko_module.tsv"
    entries_dir = raw_dir / "entries"
    return ModuleSourceInput(
        root_dir=module_source_dir,
        raw_dir=raw_dir,
        info_path=info_path,
        list_path=list_path,
        link_ko_module_path=link_ko_module_path,
        entries_dir=entries_dir,
    )


def validate_required_inputs(
    protein_anno_dir: Path,
    species_tree_dir: Path,
    genome_databases: dict[str, GenomeDatabaseInput],
    species_tree_inputs: dict[str, SpeciesTreeInput],
    module_source_input: ModuleSourceInput | None = None,
) -> list[str]:
    errors: list[str] = []
    if not protein_anno_dir.exists():
        errors.append(f"protein_anno directory not found: {protein_anno_dir}")
    if not species_tree_dir.exists():
        errors.append(f"GTDB_speciesTree directory not found: {species_tree_dir}")
    if not (species_tree_dir / "speciesTree_genomesDatabase_mapping.txt").exists():
        errors.append(
            "Species tree to genome database mapping not found: "
            f"{species_tree_dir / 'speciesTree_genomesDatabase_mapping.txt'}"
        )
    if not genome_databases:
        errors.append(f"No genome database directories found under: {protein_anno_dir}")
    if not species_tree_inputs:
        errors.append(f"No species tree mappings discovered under: {species_tree_dir}")
    if module_source_input is None:
        errors.append(
            f"KEGG Module source directory not found: "
            f"{protein_anno_dir.parent / 'module_source' / 'kegg_module'}"
        )

    # A workspace may contain partial/staged genome-database directories.  They
    # are not build inputs unless a species-tree mapping explicitly references
    # them, so validating every discovered directory would block an otherwise
    # complete package build.
    referenced_database_names = {tree_input.genome_database for tree_input in species_tree_inputs.values()}
    for database_name in sorted(referenced_database_names):
        database = genome_databases[database_name]
        if not database.protein_dir.exists():
            errors.append(f"Protein directory not found for {database.name}: {database.protein_dir}")
        if not database.annotation_dir.exists():
            errors.append(f"Annotation directory not found for {database.name}: {database.annotation_dir}")
        if not database.genome_leaf_map_path.exists():
            errors.append(
                f"genome_leafLabel_mapping.tsv not found for {database.name}: "
                f"{database.genome_leaf_map_path}"
            )
        if database.protein_dir.exists() and not iter_protein_fasta_paths(database.protein_dir):
            errors.append(f"No .faa protein files found for {database.name}: {database.protein_dir}")
        if database.annotation_dir.exists() and not list(database.annotation_dir.glob("*.tsv")):
            errors.append(f"No annotation .tsv files found for {database.name}: {database.annotation_dir}")

    if module_source_input is not None:
        if not module_source_input.raw_dir.exists():
            errors.append(f"Module raw directory not found: {module_source_input.raw_dir}")
        if not module_source_input.info_path.exists():
            errors.append(f"Module info file not found: {module_source_input.info_path}")
        if not module_source_input.list_path.exists():
            errors.append(f"Module list file not found: {module_source_input.list_path}")
        if not module_source_input.link_ko_module_path.exists():
            errors.append(
                f"Module link file not found: {module_source_input.link_ko_module_path}"
            )
        if not module_source_input.entries_dir.exists():
            errors.append(f"Module entries directory not found: {module_source_input.entries_dir}")
        elif not list(module_source_input.entries_dir.glob("M*.txt")):
            errors.append(f"No Module entry files found under: {module_source_input.entries_dir}")

    for tree_input in species_tree_inputs.values():
        if not tree_input.tree_path.exists():
            errors.append(f"Tree file not found: {tree_input.tree_path}")
        if tree_input.tree_path.suffix.lower() != TREE_SUFFIX:
            errors.append(f"Tree file must use {TREE_SUFFIX} suffix: {tree_input.tree_path}")
        if not tree_input.taxonomy_path.exists():
            errors.append(f"Taxonomy file not found: {tree_input.taxonomy_path}")

    return errors


def _resolve_genome_database_name(
    genome_database_ref: str,
    genome_databases: dict[str, GenomeDatabaseInput],
) -> str:
    normalized_ref = genome_database_ref.strip()
    if normalized_ref in genome_databases:
        return normalized_ref
    ref_name = Path(normalized_ref).name
    if ref_name in genome_databases:
        return ref_name
    raise FileNotFoundError(f"Genome database in tree mapping not found: {genome_database_ref}")


def _resolve_tree_mapping_input(
    species_tree_dir: Path,
    tree_ref: str,
) -> tuple[Path, Path, str]:
    normalized_ref = tree_ref.strip()
    candidate_path = species_tree_dir / normalized_ref
    if not candidate_path.exists():
        raise FileNotFoundError(
            "Tree mapping target not found. "
            f"Expected a tree directory under {species_tree_dir}: {tree_ref}"
        )
    if not candidate_path.is_dir():
        raise ValueError(
            "Tree mapping target must be a tree directory name, not a tree file path. "
            f"Invalid mapping target: {tree_ref}"
        )
    tree_path = _find_tree_file_in_dir(candidate_path)
    taxonomy_path = _find_taxonomy_in_dir(candidate_path)
    return tree_path, taxonomy_path, candidate_path.name


def _find_tree_file_in_dir(tree_dir: Path) -> Path:
    tree_files = sorted(path for path in tree_dir.glob(f"*{TREE_SUFFIX}") if path.is_file())
    if len(tree_files) == 1:
        return tree_files[0]
    if not tree_files:
        raise FileNotFoundError(
            f"No {TREE_SUFFIX} tree file found under tree directory: {tree_dir}"
        )
    raise ValueError(
        f"Expected exactly one {TREE_SUFFIX} tree file under tree directory {tree_dir}, "
        f"found: {[path.name for path in tree_files]}"
    )


def _find_taxonomy_in_dir(tree_dir: Path) -> Path:
    taxonomy_path = tree_dir / "taxonomy.tsv"
    if not taxonomy_path.exists():
        raise FileNotFoundError(f"No taxonomy.tsv found under tree directory: {tree_dir}")
    return taxonomy_path
