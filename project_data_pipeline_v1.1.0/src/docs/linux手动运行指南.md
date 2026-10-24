# Linux 手动运行指南

本文说明在 Linux 环境里，怎样从当前工作区手动构建 4.0 数据库。

## 1. 前提

- Python `>= 3.11`
- 工作区目录结构已经整理为：
  - `row_data/`
  - `project_data/`
  - `src/`
  - `temporary_file/`

## 2. 安装依赖

在项目根目录执行：

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -e .
```

`pyproject.toml` 会安装当前构建器需要的依赖：

- `biopython`
- `numpy`
- `pandas`
- `pyarrow`
- `tqdm`

## 3. 检查输入目录

默认输入路径是：

```text
row_data/protein_anno/
row_data/GTDB_speciesTree/
row_data/module_source/kegg_module/
row_data/kegg_module_completeness/
```

只要你的工作区结构和这里一致，构建时不需要额外传输入路径。

其中 `row_data/GTDB_speciesTree/` 现在要求：

```text
GTDB_speciesTree/
  speciesTree_genomesDatabase_mapping.txt
  {tree_dir}/
    taxonomy.tsv
    *.tre
```

`speciesTree_genomesDatabase_mapping.txt` 里写的是：

```text
{tree_dir} : {genome_database_dir}
```

## 4. 执行输入审计和构建

先执行输入审计：

```bash
python run_pipeline.py audit-row-data \
  --workspace /path/to/web_database_deel \
  --mode deep
```

`--mode fast` 只做结构和交叉对齐检查；`--mode deep` 还会解析 KEGG Module 源文件。审计返回 `0` 后才继续构建。

在项目根目录执行：

```bash
python run_pipeline.py build \
  --workspace /path/to/web_database_deel \
  --output-root /path/to/web_database_deel/project_data \
  --temp-root /path/to/web_database_deel/temporary_file/build_stage \
  --workers 1 \
  --annotation-chunk-rows 250000 \
  --force
```

说明：

- `--workspace` 指向整个项目根目录
- `--output-root` 通常直接写 `project_data/`
- `--temp-root` 指向临时 SQLite 和多进程 Parquet 分片的目录
- `--workers` 控制 annotation TSV 的解析进程数，默认 `1`
- 单进程模式会把 annotation 直接写入临时 SQLite，不再产生 annotation Parquet 中继
- 每个额外 annotation worker 都会复制一份蛋白查找表；大库上提高该值可能导致内存成倍增长
- 当蛋白查找表超过 2000 万条时，`--workers > 1` 会直接报错，必须使用 `--workers 1`
- 如果 COG/KEGG/PFAM 任一注释类型最终命中数为 0，构建会立即失败，不再生成缺少矩阵的假成功包
- `--annotation-chunk-rows` 控制 annotation TSV 的分块读取大小
- `--force` 会先删除旧的 `project_data/` 再重建；输入校验失败时不会删除旧产物

## 5. 构建完成后应该看到什么

成功后，`project_data/` 至少会包含：

```text
project_data/
  数据库4.0运行期数据库说明.md
  backend_ready/
    manifest.json
  database/
    web_database.sqlite
  processed/
    tree_core/
      tree_core.bin
      {species_tree}.tre
    matrices/
      cog.parquet
      kegg.parquet
      pfam.parquet
    module_completeness/
      module_completeness.parquet
```

其中：

- `web_database.sqlite` 是运行期主库
- `manifest.json` 是后端入口清单
- `数据库4.0运行期数据库说明.md` 会在构建后自动复制到 `project_data/`
- `manifest.json.build_performance.timing_seconds` 会记录每个构建阶段的实际耗时
- `manifest.json.build_performance.annotation_dispatch_strategy` 会记录单进程直写或多进程分片策略

## 6. 常见问题

### 6.1 缺少 `pyarrow`

如果报 parquet 相关错误，通常是没装 `pyarrow`：

```bash
pip install pyarrow
```

### 6.2 找不到输入目录

如果报 `protein_anno`、`GTDB_speciesTree`、`module_source`、`kegg_module_completeness` 缺失，先确认它们都在 `row_data/` 下，而不是根目录。

### 6.3 如何理解当前并发

1.1.0 版本的并发边界如下：

- `.faa` 由主进程顺序读取，`--workers` 不控制 FASTA 并发
- `--workers 1` 时，annotation TSV 边解析边直接写入临时 `annotation_hits.sqlite`，跳过 annotation Parquet 中继
- `--workers > 1` 时，annotation TSV 按文件分片并发解析，worker 先写 Parquet chunk，再由主流程汇总到临时 SQLite
- `protein_annotation` 继续使用分块 Parquet，再并入最终 SQLite
- 最终 SQLite 使用构建期 PRAGMA 和批量事务写入，索引在数据写完后统一创建

默认 `--workers 1` 是为了避免每个 worker 都复制一份大型蛋白查找表。只有在内存足够、且已经确认机器可承受时，才建议提高到 `2` 或更高。`manifest.json` 中的 `build_performance.parallel_fasta_reader` 应始终为 `false`。

### 6.4 想手动指定输入路径

可以额外传：

```bash
python run_pipeline.py \
  --workspace /path/to/web_database_deel \
  --protein-anno-dir /custom/path/protein_anno \
  --species-tree-dir /custom/path/GTDB_speciesTree \
  --module-source-dir /custom/path/module_source/kegg_module \
  --module-completeness-dir /custom/path/kegg_module_completeness \
  --output-root /path/to/output/project_data \
  --force
```
