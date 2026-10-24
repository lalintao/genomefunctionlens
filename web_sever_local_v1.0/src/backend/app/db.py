from collections.abc import Generator

from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.config import get_settings

settings = get_settings()

engine = create_engine(
    f"sqlite:///{settings.sqlite_path.as_posix()}",
    connect_args={"check_same_thread": False, "timeout": 60},
    poolclass=NullPool,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


@event.listens_for(engine, "connect")
def make_research_database_read_only(dbapi_connection, connection_record) -> None:
    dbapi_connection.execute("pragma query_only = on")


DOWNLOAD_PERFORMANCE_INDEXES = (
    (
        "protein_annotation",
        ("annotation_type", "annotation_id", "genome_id", "protein_key"),
    ),
    (
        "protein_annotation",
        ("genome_id", "annotation_type", "annotation_id"),
    ),
    (
        "protein",
        ("genome_id", "protein_key"),
    ),
    (
        "genome",
        ("genome_id",),
    ),
    (
        "genome",
        ("leaf_node_id",),
    ),
    (
        "tree_node",
        ("node_id",),
    ),
    (
        "taxonomy",
        ("node_id",),
    ),
    (
        "module_kegg_member",
        ("module_annotation_id",),
    ),
)


def validate_download_performance_indexes() -> None:
    try:
        with engine.connect() as connection:
            tables = {
                row[0]
                for row in connection.execute(
                    text("select name from sqlite_master where type='table'")
                ).fetchall()
            }
            missing: list[str] = []
            for table_name, required_columns in DOWNLOAD_PERFORMANCE_INDEXES:
                if table_name not in tables:
                    continue
                index_rows = connection.execute(text(f"pragma index_list('{table_name}')")).fetchall()
                indexed_column_sets = []
                for index_row in index_rows:
                    index_name = str(index_row[1]).replace("'", "''")
                    columns = tuple(
                        str(row[2])
                        for row in connection.execute(text(f"pragma index_info('{index_name}')")).fetchall()
                    )
                    indexed_column_sets.append(columns)
                if not any(columns[: len(required_columns)] == required_columns for columns in indexed_column_sets):
                    missing.append(f"{table_name}({', '.join(required_columns)})")
            if missing:
                print(
                    "Project-data download indexes are missing: " + "; ".join(missing),
                    flush=True,
                )
    except OperationalError as exc:
        print(f"Project-data download indexes could not be validated: {exc}", flush=True)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
