from pathlib import Path

import pandas as pd


def read_parquet_columns(path: Path, columns: list[str]) -> pd.DataFrame:
    return pd.read_parquet(path, columns=columns)
