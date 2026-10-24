# genomefunctionlens
# GenomeFunctionLens Local

GenomeFunctionLens Local（`genomefunctionlens_local`）是面向 Windows 的单用户本地科学数据应用，用于浏览和查询微生物基因组功能注释，并在物种树与热图之间进行联动分析。

应用支持 COG、KEGG、Pfam 和 KEGG Module 查询，提供结果可视化、数据表与图片导出、查询保存和序列下载。科学数据由配套的 `project_data` 构建流水线生成，源代码仓库不包含运行期数据。

> **说明：** 本仓库不包含 `project_data/`。首次运行前，请先使用流水线构建数据，或准备一个已有的 `project_data` 目录。

## 功能特性

- 按数据集浏览基因组功能注释结果。
- 查询 COG、KEGG、Pfam 和 KEGG Module。
- 交互式浏览物种树与热图。
- 按物种范围筛选结果，并调整树和热图的显示样式。
- 将结果导出为 SVG、PNG、PDF 或数据表。
- 保存当前查询并管理本地查询记录。
- 下载蛋白质序列，并通过内置任务队列查看下载进度。
- 使用本地 JSON 文件保存查询和下载状态，无需外部数据库。

## 仓库结构

```text
.
├── README.md
├── start_local_web.bat
├── deploy_local_web.ps1
├── genomefunctionlens_local_v1.0/
│   ├── deploy/
│   ├── local_data/
│   ├── src/
│   │   ├── backend/
│   │   └── frontend/
│   ├── start_local.bat
│   └── start_local.ps1
└── project_data_pipeline_v1.1.0/
    ├── src/
    ├── tests/
    ├── run_pipeline.py
    └── 运行说明.md
```

以下目录不会提交到 Git：

```text
project_data/
row_data/
temporary_file/
```

## 环境要求

| 组件 | 要求 |
| --- | --- |
| 操作系统 | Windows 10 或 Windows 11 |
| GenomeFunctionLens Local | Python 3.10+，推荐 Python 3.11 |
| 数据构建流水线 | Python 3.11+ |
| 浏览器 | 当前版本的 Chrome、Edge 或 Firefox |
| 首次启动 | 可访问 PyPI 的网络环境 |

仓库中已包含构建后的前端资源，普通使用者不需要安装 Node.js。

检查 Python 版本：

```powershell
python --version
```

如果系统中存在多个 Python 版本，可以通过 `-PythonExecutable` 指定解释器路径。

## 快速开始

### 1. 准备 `project_data`

GenomeFunctionLens Local 不包含科学数据。单树数据包应包含以下内容：

```text
project_data/
├── 数据库4.0运行期数据库说明.md
├── backend_ready/
│   └── manifest.json
├── database/
│   └── web_database.sqlite
└── processed/
    ├── tree_core/
    │   ├── tree_core.bin
    │   └── {tree_dir}.tre
    ├── matrices/
    │   ├── cog.parquet
    │   ├── kegg.parquet
    │   └── pfam.parquet
    └── module_completeness/
        └── module_completeness.parquet
```

如需从原始数据构建 `project_data`，请参阅[构建 project_data](#构建-project_data)。

### 2. 启动应用

在仓库根目录双击：

```text
start_local_web.bat
```

或在 PowerShell 中运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy_local_web.ps1 `
  -ProjectDataRoot "D:\datasets\my_project_data"
```

启动器会自动完成以下操作：

1. 创建本地 Python 虚拟环境。
2. 首次启动时安装后端依赖。
3. 检查 manifest、SQLite 数据库、树核心文件和矩阵文件。
4. 创建本地运行数据目录。
5. 启动 Web 服务和下载 worker。
6. 在浏览器中打开 `http://127.0.0.1:8000/`。

如果 `project_data` 位于以下任一位置，可以省略 `-ProjectDataRoot`：

```text
genomefunctionlens_local_v1.0/project_data/
project_data/
../project_data/
```

### 3. 启动参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `-ProjectDataRoot` | 自动查找 | 具体运行期数据包的路径 |
| `-Port` | `8000` | 本地 Web 服务端口 |
| `-BindAddress` | `127.0.0.1` | 服务监听地址 |
| `-NoBrowser` | 关闭 | 不自动打开浏览器 |
| `-Reinstall` | 关闭 | 重新安装 Python 依赖 |
| `-PythonExecutable` | 自动查找 | 指定 Python 解释器路径 |

示例：

```powershell
# 使用其他端口
powershell -ExecutionPolicy Bypass -File .\deploy_local_web.ps1 `
  -ProjectDataRoot "D:\my_project_data" `
  -Port 8080

# 不自动打开浏览器
powershell -ExecutionPolicy Bypass -File .\deploy_local_web.ps1 `
  -ProjectDataRoot "D:\my_project_data" `
  -NoBrowser

# 重新安装依赖
powershell -ExecutionPolicy Bypass -File .\deploy_local_web.ps1 `
  -ProjectDataRoot "D:\my_project_data" `
  -Reinstall
```

也可以从应用目录启动：

```powershell
cd genomefunctionlens_local_v1.0
.\start_local.bat
```

## 多树数据包

当 `project_data` 包含多个树数据包时，请将 `-ProjectDataRoot` 指向具体的子目录：

```text
project_data/
├── GTDB226/
│   ├── backend_ready/
│   ├── database/
│   ├── processed/
│   └── 数据库4.0运行期数据库说明.md
└── GTDB232/
    ├── backend_ready/
    ├── database/
    ├── processed/
    └── 数据库4.0运行期数据库说明.md
```

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy_local_web.ps1 `
  -ProjectDataRoot "D:\datasets\project_data\GTDB226"
```

## 本地运行数据

保存的查询和下载任务存放在 `genomefunctionlens_local_v1.0/local_data/`：

```text
local_data/
├── saved_queries/
│   ├── categories.json
│   ├── records/
│   └── requests/
└── downloads/
    ├── jobs/
    ├── temp/
    ├── archive/
    └── logs/
```

| 目录 | 用途 |
| --- | --- |
| `saved_queries/` | 保存的查询和分类 |
| `downloads/jobs/` | 下载任务状态 |
| `downloads/temp/` | 临时下载文件 |
| `downloads/archive/` | 生成的 ZIP 归档 |
| `downloads/logs/` | 下载日志 |

如需保留查询记录，请备份 `genomefunctionlens_local_v1.0/local_data/saved_queries/`。

## 构建 project_data

配套流水线从 `row_data/` 读取原始输入，并将运行期数据包写入 `project_data/`。

### 安装流水线

Windows PowerShell：

```powershell
cd project_data_pipeline_v1.1.0
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -e .
```

Linux 或 macOS：

```bash
cd project_data_pipeline_v1.1.0
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -e .
```

冻结依赖信息见 `requirements-lock.txt`、`environment.yml` 和 `pyproject.toml`。

### 准备 row_data

<details>
<summary>展开查看 row_data 目录结构</summary>

```text
row_data/
├── protein_anno/
│   ├── {genome_database}/
│   │   ├── protein/*.faa
│   │   ├── annotation/cog.tsv
│   │   ├── annotation/kegg.tsv
│   │   ├── annotation/pfam.tsv
│   │   └── genome_leafLabel_mapping.tsv
│   ├── cog_annotation_names.tsv
│   ├── kegg_annotation_names.tsv
│   └── pfam_annotation_names.tsv
├── GTDB_speciesTree/
│   ├── speciesTree_genomesDatabase_mapping.txt
│   └── {tree_dir}/
│       ├── taxonomy.tsv
│       └── {tree_dir}.tre
├── module_source/
│   └── kegg_module/
│       └── raw/
│           ├── info_module.txt
│           ├── list_module.tsv
│           ├── link_ko_module.tsv
│           └── entries/M*.txt
└── kegg_module_completeness/
    └── completeness_matrix.tsv
```

</details>

物种树映射文件每行定义一组对应关系：

```text
{tree_dir} : {genome_database}
```

示例：

```text
GTDB226 : archaea226
```

只有映射文件中引用的 genome database 会参与构建。

### 审计原始输入

构建前先执行审计：

```powershell
python run_pipeline.py audit-row-data `
  --workspace F:\path\to\workspace `
  --mode deep
```

返回码：

- `0`：没有错误，可以继续构建。
- `1`：存在校验错误，需要修复后再构建。

`fast` 模式检查目录、schema、树叶节点对齐、genome 映射和 completeness 对齐；`deep` 模式还会解析 KEGG Module 源文件。

如需检查注释文件中的 `protein_id` 与 FASTA 是否一致：

```powershell
python run_pipeline.py audit-row-data `
  --workspace F:\path\to\workspace `
  --mode deep `
  --scan-annotation-proteins
```

该选项会扫描全部 FASTA 和注释文件，耗时明显更长。

### 构建运行期数据包

Windows PowerShell：

```powershell
python run_pipeline.py build `
  --workspace F:\path\to\workspace `
  --output-root F:\path\to\workspace\project_data `
  --temp-root F:\path\to\workspace\temporary_file\build_stage `
  --workers 1 `
  --annotation-chunk-rows 250000 `
  --force
```

Linux 或 macOS：

```bash
python run_pipeline.py build \
  --workspace /path/to/workspace \
  --output-root /path/to/workspace/project_data \
  --temp-root /path/to/workspace/temporary_file/build_stage \
  --workers 1 \
  --annotation-chunk-rows 250000 \
  --force
```

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--workspace` | 当前目录 | 工作区根目录 |
| `--output-root` | `<workspace>/project_data` | 运行期数据包输出目录 |
| `--temp-root` | `<workspace>/temporary_file/build_stage` | 分块和暂存目录 |
| `--workers` | `1` | annotation TSV 解析进程数 |
| `--annotation-chunk-rows` | `250000` | 流式读取 annotation 时每个 chunk 的行数 |
| `--force` | 关闭 | 删除已有输出目录后重新构建 |

> **警告：** `--force` 会在重新构建前删除已有的 `--output-root`，执行前务必确认路径正确。

每个 annotation worker 都会复制一份蛋白查找表。大库建议先使用 `--workers 1`。`--workers` 不控制 FASTA 读取并发数。

### 验证构建结果

检查关键文件是否存在：

```powershell
Test-Path project_data\backend_ready\manifest.json
Test-Path project_data\database\web_database.sqlite
Test-Path project_data\processed\tree_core\tree_core.bin
Test-Path project_data\数据库4.0运行期数据库说明.md
```

运行流水线测试：

```powershell
cd project_data_pipeline_v1.1.0
python -m pytest
```

使用数据包前，请确认：

- SQLite `PRAGMA integrity_check` 返回 `ok`。
- 每个矩阵的 shape 与 manifest 中的 `row_count` 和 `column_count` 一致。
- 每个矩阵的行数与 `genome` 表行数一致。
- `manifest.json` 中的 `pipeline_version` 为 `1.1.0`，`schema_version` 为 `4.0`。

### 运行期数据约束

- 运行期 schema 不包含 `tree_leaf`。
- `genome.leaf_node_id` 用于连接物种 rank 叶子节点。
- `genome.genome_id` 是连续、稳定、无空洞的 0-based 标识符。
- annotation 和 module completeness 矩阵严格按 `genome_id ASC` 排序。
- `module_completeness_file` 已并入 `matrix_file`。
- `module_kegg_member` 仅保留 `module_annotation_id` 和 `kegg_annotation_ids_json`。

## 安全边界与使用范围

GenomeFunctionLens Local 是单用户、本地运行的应用。

- 不提供登录、账号、角色或多用户隔离。
- 保存的查询和下载任务不按用户区分。
- 服务默认仅监听 `127.0.0.1`。
- 不提供身份认证或下载授权令牌。

除非额外配置防火墙和网络隔离，否则不要绑定 `0.0.0.0`，也不要在不可信网络中公开服务。

## 文档

- [GenomeFunctionLens Local 使用说明](genomefunctionlens_local_v1.0/README.md)
- [流水线运行说明](project_data_pipeline_v1.1.0/运行说明.md)
- [构建逻辑与输入规范](project_data_pipeline_v1.1.0/src/docs/数据库4.0构建逻辑与输入规范.md)
- [运行期数据库说明](project_data_pipeline_v1.1.0/src/docs/数据库4.0运行期数据库说明.md)

## 版本

| 组件 | 版本 |
| --- | --- |
| GenomeFunctionLens Local | `1.0.0` |
| project_data 流水线 | `1.1.0` |
| 运行期 schema | `4.0` |
