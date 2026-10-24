from sqlalchemy import Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class MatrixFile(Base):
    __tablename__ = "matrix_file"

    matrix_kind: Mapped[str] = mapped_column(Text, primary_key=True)
    genome_database: Mapped[str] = mapped_column(Text, primary_key=True)
    annotation_type: Mapped[str] = mapped_column(Text, primary_key=True)
    matrix_path: Mapped[str] = mapped_column(Text)
    matrix_format: Mapped[str] = mapped_column(Text)
    row_count: Mapped[int] = mapped_column(Integer)
    column_count: Mapped[int] = mapped_column(Integer)
    value_type: Mapped[str] = mapped_column(Text)
