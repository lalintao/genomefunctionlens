from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.services.runtime_catalog import RuntimeCatalog


@dataclass(frozen=True)
class ModuleMeta:
    module_id: str
    short_name: str | None
    module_name: str
    aliases: str | None
    module_class: str | None
    module_category: str | None
    module_subcategory: str | None
    description: str | None
    source: str | None
    source_version: str | None


@dataclass(frozen=True)
class ExpandedModuleMember:
    column_id: str
    annotation_id: int
    annotation_value: str
    short_name: str | None
    full_name: str | None
    display_order: int


@dataclass(frozen=True)
class ExpandedModule:
    module_id: str
    short_name: str | None
    module_name: str
    members: list[ExpandedModuleMember]


class ModuleService:
    def __init__(self, db: Session):
        self.catalog = RuntimeCatalog(db)

    def suggest(self, query_type: str, keyword: str, limit: int) -> list[ModuleMeta]:
        if query_type.strip().lower() != "module":
            return []
        return [self._to_meta(record) for record in self.catalog.suggest_modules(keyword, limit)]

    def get_modules(self, module_ids: list[str]) -> list[ModuleMeta]:
        return [self._to_meta(record) for record in self.catalog.get_modules(module_ids)]

    def expand_module(self, module_id: str) -> ExpandedModule:
        module = self.get_modules([module_id])[0]
        members = self.catalog.get_module_members([module.module_id]).get(module.module_id, [])
        return ExpandedModule(
            module_id=module.module_id,
            short_name=module.short_name,
            module_name=module.module_name,
            members=[
                ExpandedModuleMember(
                    column_id=self._detail_column_id(
                        member.module_id,
                        member.display_order,
                        member.ko_value,
                    ),
                    annotation_id=member.ko_annotation_id,
                    annotation_value=member.ko_value,
                    short_name=member.ko_short_name,
                    full_name=member.ko_full_name,
                    display_order=member.display_order,
                )
                for member in members
            ],
        )

    def _to_meta(self, record) -> ModuleMeta:
        return ModuleMeta(
            module_id=record.module_id,
            short_name=record.short_name,
            module_name=record.module_name,
            aliases=None,
            module_class=record.module_class,
            module_category=record.module_category,
            module_subcategory=record.module_subcategory,
            description=record.description,
            source=record.source,
            source_version=record.source_version,
        )

    def _detail_column_id(
        self,
        module_id: str,
        display_order: int,
        ko_value: str,
    ) -> str:
        return f"module:{module_id}:ko:{display_order}:{ko_value}"
