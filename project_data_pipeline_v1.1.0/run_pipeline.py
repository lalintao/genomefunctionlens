#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from webdb_pipeline.cli import main

r"""
run
D:\anaconda\envs\web_sever\python.exe F:\Project\web_database_deel\run_pipeline.py --workspace F:\Project\web_database_deel --output-root F:\Project\web_database_deel\project_data --force


"""
if __name__ == "__main__":
    main()
