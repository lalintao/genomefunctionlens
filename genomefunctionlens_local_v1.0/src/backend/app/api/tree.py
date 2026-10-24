from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.tree import (
    TreeCoreResponse,
    TreeFilterGenomesRequest,
    TreeFilterGenomesResponse,
    TreeScopeOptionsRequest,
    TreeScopeOptionsResponse,
)
from app.services.genome_scope_service import FilteredGenomeScope, GenomeFilterInput, GenomeScopeService
from app.services.taxonomy_scope_service import TaxonomyScopeService
from app.services.tree_runtime_service import TreeRuntimeService

router = APIRouter(prefix="/api/tree", tags=["tree"])


@router.post("/scope-options", response_model=TreeScopeOptionsResponse)
def resolve_scope_options(
    payload: TreeScopeOptionsRequest,
    db: Session = Depends(get_db),
) -> TreeScopeOptionsResponse:
    return TaxonomyScopeService(db).resolve_options(
        payload.species_tree,
        payload.genome_database,
    )


@router.get("/core", response_model=TreeCoreResponse)
def get_tree_core(
    species_tree: str = Query(..., min_length=1),
    genome_database: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
) -> TreeCoreResponse:
    service = TreeRuntimeService(db)
    artifacts = service.get_artifacts(species_tree, genome_database)
    return TreeCoreResponse(
        species_tree=artifacts.dataset.species_tree,
        genome_database=artifacts.dataset.genome_database,
        tree_core_format=artifacts.dataset.tree_core_format,
        tree_core_download_url=(
            f"/api/tree/core/file?species_tree={artifacts.dataset.species_tree}"
            f"&genome_database={artifacts.dataset.genome_database}"
        ),
        tree_newick_download_url=(
            f"/api/tree/newick/file?species_tree={artifacts.dataset.species_tree}"
            f"&genome_database={artifacts.dataset.genome_database}"
        ),
        node_count=artifacts.dataset.node_count,
        leaf_count=artifacts.dataset.leaf_count,
        genome_count=artifacts.dataset.genome_count,
    )


@router.get("/core/file")
def download_tree_core(
    species_tree: str = Query(..., min_length=1),
    genome_database: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
) -> FileResponse:
    service = TreeRuntimeService(db)
    artifacts = service.get_artifacts(species_tree, genome_database)
    return FileResponse(
        artifacts.tree_core_file,
        media_type="application/octet-stream",
        filename=artifacts.tree_core_file.name,
        # tree_core is regenerated in place.  A cached binary must never be
        # combined with a newer database summary in the frontend bootstrap.
        headers={"Cache-Control": "no-store"},
    )


@router.get("/newick/file")
def download_tree_newick(
    species_tree: str = Query(..., min_length=1),
    genome_database: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
) -> FileResponse:
    service = TreeRuntimeService(db)
    artifacts = service.get_artifacts(species_tree, genome_database)
    return FileResponse(
        artifacts.tree_newick_file,
        media_type="text/plain; charset=utf-8",
        filename=artifacts.tree_newick_file.name,
    )


@router.post("/filter-genomes", response_model=TreeFilterGenomesResponse)
def filter_genomes(
    payload: TreeFilterGenomesRequest,
    db: Session = Depends(get_db),
) -> TreeFilterGenomesResponse:
    service = GenomeScopeService(db)
    filtered_scope = service.filter_scope(
        payload.species_tree,
        payload.genome_database,
        node_ids=payload.scope.node_ids,
        leaf_node_ids=payload.scope.leaf_node_ids,
        genome_ids=payload.scope.genome_ids,
        filters=GenomeFilterInput(
            if_refseq=payload.filters.if_refseq,
            min_checkm2_completeness=payload.filters.min_checkm2_completeness,
            max_checkm2_contamination=payload.filters.max_checkm2_contamination,
            min_quality_score=payload.filters.min_quality_score,
            max_contig=payload.filters.max_contig,
        ),
    )
    return _to_filter_response(filtered_scope)


def _to_filter_response(filtered_scope: FilteredGenomeScope) -> TreeFilterGenomesResponse:
    return TreeFilterGenomesResponse(
        kept_leaf_node_ids=filtered_scope.kept_leaf_node_ids,
        removed_leaf_node_ids=filtered_scope.removed_leaf_node_ids,
        kept_genome_ids=filtered_scope.kept_genome_ids,
        removed_genome_ids=filtered_scope.removed_genome_ids,
        kept_leaf_count=len(filtered_scope.kept_leaf_node_ids),
        kept_genome_count=len(filtered_scope.kept_genome_ids),
    )
