from pydantic import BaseModel, Field, field_validator


class ModuleSuggestItem(BaseModel):
    kind: str = "module"
    module_id: str
    module_name: str
    label: str
    aliases: str | None = None


class ModuleSuggestResponse(BaseModel):
    items: list[ModuleSuggestItem]


class ModuleExpandRequest(BaseModel):
    module_id: str = Field(min_length=1)

    @field_validator("module_id")
    @classmethod
    def normalize_module_id(cls, value: str) -> str:
        stripped = value.strip().upper()
        if not stripped:
            raise ValueError("module_id cannot be empty")
        return stripped


class ModuleExpandMember(BaseModel):
    annotation_id: int
    annotation_value: str
    label: str
    short_name: str | None = None
    full_name: str | None = None
    display_order: int


class ModuleExpandResponse(BaseModel):
    module_id: str
    module_name: str
    members: list[ModuleExpandMember]


class ModuleSuggestQuery(BaseModel):
    type: str = Field(min_length=1)
    keyword: str = ""
    limit: int = Field(default=12, ge=1, le=50)

    @field_validator("type")
    @classmethod
    def normalize_type(cls, value: str) -> str:
        stripped = value.strip().lower()
        if not stripped:
            raise ValueError("type cannot be empty")
        return stripped
