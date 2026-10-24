from sqlalchemy.orm import Session

from app.schemas.common import AnnotationQuery
from app.schemas.search import (
    ModuleGroup,
    SearchColumn,
    SearchColumnsResponse,
    SearchRequest,
)
from app.services.annotation_service import AnnotationMeta, AnnotationService
from app.services.module_service import ModuleService
from app.services.runtime_catalog import RuntimeCatalog


class SearchService:
    def __init__(self, db: Session):
        self.db = db
        self.catalog = RuntimeCatalog(db)
        self.annotation_service = AnnotationService(db)
        self.module_service = ModuleService(db)

    def search_columns(self, payload: SearchRequest) -> SearchColumnsResponse:
        self._require_dataset(payload.species_tree, payload.genome_database)
        columns, module_groups = self._resolve_annotations(payload.annotations)
        return SearchColumnsResponse(
            species_tree=payload.species_tree,
            genome_database=payload.genome_database,
            columns=columns,
            module_groups=module_groups,
        )

    def _require_dataset(self, species_tree: str, genome_database: str) -> None:
        self.catalog.get_dataset(species_tree, genome_database)

    def _resolve_annotations(
        self,
        annotations: list[AnnotationQuery],
    ) -> tuple[list[SearchColumn], list[ModuleGroup]]:
        columns: list[SearchColumn] = []
        module_groups: list[ModuleGroup] = []

        for annotation in annotations:
            if annotation.type == "module":
                module_columns, module_group = self._build_module_group(
                    annotation.value, include_members=annotation.include_module_members,
                )
                columns.extend(module_columns)
                module_groups.append(module_group)
                continue

            meta = self.annotation_service.resolve_one(annotation.type, annotation.value)
            columns.append(self._to_search_column(meta))

        return columns, module_groups

    def _build_module_group(
        self, raw_module_id: str, *, include_members: bool = False,
    ) -> tuple[list[SearchColumn], ModuleGroup]:
        expanded_module = self.module_service.expand_module(raw_module_id.strip().upper())
        completeness_column_id = f"module:{expanded_module.module_id}:completeness"

        columns = [
            SearchColumn(
                type="module",
                value=expanded_module.module_id,
                label=expanded_module.module_id,
                column_id=completeness_column_id,
                column_role="module_completeness",
                short_name=expanded_module.short_name,
                full_name=expanded_module.module_name,
                module_id=expanded_module.module_id,
                module_name=expanded_module.module_name,
            )
        ]
        detail_column_ids: list[str] = []
        ko_values: list[str] = []

        for member in expanded_module.members if include_members else ():
            detail_column_id = member.column_id
            detail_column_ids.append(detail_column_id)
            ko_values.append(member.annotation_value)
            columns.append(
                SearchColumn(
                    column_id=detail_column_id,
                    column_role="module_detail",
                    type="kegg",
                    value=member.annotation_value,
                    annotation_id=member.annotation_id,
                    label=member.short_name or member.annotation_value,
                    short_name=member.short_name,
                    full_name=member.full_name,
                    module_id=expanded_module.module_id,
                    module_name=expanded_module.module_name,
                    step_id=f"{expanded_module.module_id}:ko:{member.display_order}",
                    step_index=member.display_order,
                    display_order=member.display_order,
                    step_label=member.short_name or member.annotation_value,
                    step_logic="ordered_ko_member",
                    is_optional=False,
                )
            )

        return columns, ModuleGroup(
            module_id=expanded_module.module_id,
            module_name=expanded_module.module_name,
            column_ids=[completeness_column_id, *detail_column_ids],
            completeness_column_id=completeness_column_id,
            detail_column_ids=detail_column_ids,
            ko_values=ko_values,
        )

    def _to_search_column(self, meta: AnnotationMeta) -> SearchColumn:
        return SearchColumn(
            type=meta.type,
            value=meta.value,
            annotation_id=meta.annotation_id,
            column_role=None,
            short_name=meta.short_name,
            full_name=meta.full_name,
            source=meta.source,
            source_version=meta.source_version,
            label=meta.short_name or meta.value,
        )
