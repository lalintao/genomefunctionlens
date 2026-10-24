from sqlalchemy import Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ProteinAnnotation(Base):
    __tablename__ = "protein_annotation"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    genome_database: Mapped[str] = mapped_column(Text)
    protein_id: Mapped[str] = mapped_column(Text)
    annotation_value: Mapped[str] = mapped_column(Text)
    annotation_type: Mapped[str] = mapped_column(Text)
