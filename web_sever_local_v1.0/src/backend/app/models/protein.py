from sqlalchemy import Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Protein(Base):
    __tablename__ = "protein"

    protein_key: Mapped[int] = mapped_column(Integer, primary_key=True)
    genome_id: Mapped[int] = mapped_column(Integer)
    protein_id: Mapped[str] = mapped_column(Text)
    protein_name: Mapped[str] = mapped_column(Text)
    sequence: Mapped[str] = mapped_column(Text)
    sequence_length: Mapped[int] = mapped_column(Integer)
