# web_sever 本地版与 project_data 构建发布说明

本目录包含两个相互配套、但独立分发的发布物：

1. **`web_sever_local_v1.0/`**：Windows 10/11 本地 Web 版，负责查询、物种树、热图、结果导出、保存查询和序列下载。
2. **`project_data_pipeline_v1.1.0/`**：科学数据构建流水线，负责从 `row_data/` 生成 Web 版所需的 `project_data/`。

> Web 发布包**不包含** `project_data`。使用者需要先用数据流水线生成 `project_data`，再启动本地 Web 版。

推荐使用顺序：

```text
安装 Python
  -> 准备 row_data
  -> 用 project_data_pipeline_v1.1.0 生成 project_data
  -> 用 start_local_web.bat / deploy_local_web.ps1 一键启动 Web 版
  -> 浏览器打开 http://127.0.0.1:8000/
```

---

# 第一部分：本地 Web 版

## 1. 发布目录

```text
releases/
  README.md                        本说明
  start_local_web.bat              双击启动本地 Web 版
  deploy_local_web.ps1             顶层 PowerShell 部署入口
  web_sever_local_v1.0/            本地 Web 版源码、前端构建产物和说明
    start_local.bat                本地版目录内双击启动
    start_local.ps1                本地版 PowerShell 启动入口
    deploy/windows/start_local.ps1 实际安装与启动脚本
    src/backend/                   FastAPI 后端
    src/frontend/                  React/Vite 前端源码与 dist
    local_data/                    本地保存和下载目录（运行后生成内容）
  project_data_pipeline_v1.1.0/      project_data 构建流水线
```

## 2. 本地 Web 版包含什么

保留：

- 数据集选择；
- COG、KEGG、Pfam、KEGG Module 查询；
- 物种树和热图交互；
- 物种范围、树样式和热图样式；
- SVG、PNG、PDF 和数据表导出；
- 保存当前查询和“我的查询记录”；
- 序列下载；
- 本地 JSON 保存和下载任务队列。

不包含：

- 登录、注册、找回密码、修改密码；
- 账号、会话和安全审计数据库；
- Chat、DeepSeek、RAG、Embedding、Reranker；
- SMTP 邮件；
- 反馈页面和反馈接口；
- Nginx、systemd、Gunicorn 等服务器部署组件。

本地 Web 版是**单用户、单机模式**。保存查询和下载记录不区分账号，也不提供多人权限隔离。

## 3. 环境要求

本地 Web 版：

- Windows 10 或 Windows 11；
- Python 3.10 或更高版本，推荐 Python 3.11；
- 首次安装后端依赖时需要网络访问 PyPI；
- 不需要安装 Node.js，发布包已包含构建后的前端 `dist`。

project_data 流水线：

- Python 3.11 或更高版本；
- `biopython`、`numpy`、`pandas`、`pyarrow`、`tqdm`；
- 推荐使用流水线目录内独立的 Python 虚拟环境。

检查 Python：

```powershell
python --version
```

如果系统有多个 Python，可显式指定：

```powershell
-PythonExecutable "C:\Python311\python.exe"
```

## 4. 一键部署本地 Web 版

### 方式 A：双击启动（推荐给普通用户）

在 `releases` 目录双击：

```text
start_local_web.bat
```

脚本会：

1. 查找 `project_data`；
2. 如果没有找到，提示输入 `project_data` 路径；
3. 首次运行创建 `web_sever_local_v1.0\.venv-local`；
4. 安装后端依赖；
5. 校验 `backend_ready/manifest.json`、科学 SQLite、tree core 和矩阵；
6. 创建 `local_data`；
7. 启动 Web 服务和内置下载 worker；
8. 自动打开浏览器。

默认地址：

```text
http://127.0.0.1:8000/
```

### 方式 B：PowerShell 一键部署

```powershell
cd F:\path\to\releases
powershell -ExecutionPolicy Bypass -File .\deploy_local_web.ps1 `
  -ProjectDataRoot "D:\datasets\my_project_data"
```

如果 `project_data` 位于以下任一位置，可以省略 `-ProjectDataRoot`：

```text
releases/web_sever_local_v1.0/project_data
releases/project_data
web_database_deel/project_data
```

常用参数：

```powershell
# 修改端口
powershell -ExecutionPolicy Bypass -File .\deploy_local_web.ps1 `
  -ProjectDataRoot "D:\my_project_data" `
  -Port 8080

# 不自动打开浏览器
powershell -ExecutionPolicy Bypass -File .\deploy_local_web.ps1 `
  -ProjectDataRoot "D:\my_project_data" `
  -NoBrowser

# 重新安装 Python 依赖
powershell -ExecutionPolicy Bypass -File .\deploy_local_web.ps1 `
  -ProjectDataRoot "D:\my_project_data" `
  -Reinstall
```

### 方式 C：直接使用 Web 发布目录

```powershell
cd web_sever_local_v1.0
.\start_local.bat
```

或：

```powershell
powershell -ExecutionPolicy Bypass -File .\start_local.ps1 `
  -ProjectDataRoot "D:\my_project_data"
```

## 5. project_data 放置位置

本地 Web 版启动时会检查 `project_data` 是否完整。单树单数据库包应包含：

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
      {tree_dir}.tre
    matrices/
      cog.parquet
      kegg.parquet
      pfam.parquet
    module_completeness/
      module_completeness.parquet
```

多树包的结构为：

```text
project_data/
  {tree_dir_1}/
    backend_ready/
    database/
    processed/
    数据库4.0运行期数据库说明.md
  {tree_dir_2}/
    ...
```

当前本地 Web 版启动器默认需要一个具体运行期包目录。多树包请把 `-ProjectDataRoot` 指向实际子包，例如：

```powershell
-ProjectDataRoot "D:\project_data\GTDB226"
```

## 6. 本地运行数据

Web 版运行后，在 `web_sever_local_v1.0/local_data/` 下生成：

```text
local_data/
  saved_queries/
    categories.json
    records/
    requests/
  downloads/
    jobs/
    temp/
    archive/
    logs/
```

- `saved_queries/`：保存查询和分类，建议定期备份。
- `downloads/jobs/`：下载任务状态 JSON。
- `downloads/temp/`：临时文件，可清理。
- `downloads/archive/`：生成的 ZIP，过期后自动清理。
- `downloads/logs/`：日志目录。

需要备份时至少备份：

```text
web_sever_local_v1.0/local_data/saved_queries/
```

## 7. 访问范围与安全

默认只监听：

```text
127.0.0.1
```

本地版没有登录、权限控制和下载授权令牌，只适合受信任的单机环境。除非自行配置 Windows 防火墙和网络隔离，否则不建议使用：

```powershell
-BindAddress 0.0.0.0
```

---

# 第二部分：project_data 构建流水线

## 8. 流水线版本和范围

- 流水线版本：`1.1.0`
- 运行期 schema：`4.0`
- 冻结日期：`2026-10-20`
- Python：`>= 3.11`
- 已验证环境：Windows 10、Python 3.14.6、pandas 2.3.3、pyarrow 23.0.1、Biopython 1.88
- 目录内只包含构建代码、测试、构建文档和运行说明，不包含 `row_data/`、`project_data/` 或 smoke 产物

详细技术说明：

```text
project_data_pipeline_v1.1.0/运行说明.md
project_data_pipeline_v1.1.0/src/docs/数据库4.0构建逻辑与输入规范.md
project_data_pipeline_v1.1.0/src/docs/数据库4.0运行期数据库说明.md
```

## 9. 安装流水线

Windows PowerShell：

```powershell
cd project_data_pipeline_v1.1.0
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -e .
```

Linux / macOS：

```bash
cd project_data_pipeline_v1.1.0
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -e .
```

如需复现冻结依赖，可参考：

```text
requirements-lock.txt
environment.yml
pyproject.toml
```

## 10. 准备 row_data

默认从工作区的 `row_data/` 读取：

```text
row_data/
  protein_anno/
    {genome_database}/
      protein/*.faa
      annotation/cog.tsv
      annotation/kegg.tsv
      annotation/pfam.tsv
      genome_leafLabel_mapping.tsv
    cog_annotation_names.tsv
    kegg_annotation_names.tsv
    pfam_annotation_names.tsv
  GTDB_speciesTree/
    speciesTree_genomesDatabase_mapping.txt
    {tree_dir}/
      taxonomy.tsv
      {tree_dir}.tre
  module_source/
    kegg_module/
      raw/
        info_module.txt
        list_module.tsv
        link_ko_module.tsv
        entries/M*.txt
  kegg_module_completeness/
    completeness_matrix.tsv
```

物种树映射文件格式：

```text
{tree_dir} : {genome_database}
```

示例：

```text
GTDB226 : archaea226
```

只有映射文件引用的 genome database 会参与构建。

## 11. 构建前审计

先审计，再构建：

```powershell
python run_pipeline.py audit-row-data `
  --workspace F:\path\to\workspace `
  --mode deep
```

返回码：

- `0`：没有 error，可以继续构建；
- `1`：存在 error，不应继续构建。

`fast` 模式检查目录、schema、树叶子对齐、genome 映射和 completeness 对齐；`deep` 模式还会解析 KEGG Module 源文件。

如需检查注释文件中的 `protein_id` 与 FASTA 是否一致：

```powershell
python run_pipeline.py audit-row-data `
  --workspace F:\path\to\workspace `
  --mode deep `
  --scan-annotation-proteins
```

该选项会扫描全部 FASTA 和注释文件，速度明显更慢。

## 12. 生成 project_data

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

Linux / macOS：

```bash
python run_pipeline.py build \
  --workspace /path/to/workspace \
  --output-root /path/to/workspace/project_data \
  --temp-root /path/to/workspace/temporary_file/build_stage \
  --workers 1 \
  --annotation-chunk-rows 250000 \
  --force
```

参数：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--workspace` | 当前目录 | 工作区根目录 |
| `--output-root` | `<workspace>/project_data` | 产物根目录 |
| `--temp-root` | `<workspace>/temporary_file/build_stage` | 分块和暂存目录 |
| `--workers` | `1` | annotation TSV 解析进程数 |
| `--annotation-chunk-rows` | `250000` | annotation 流式读取 chunk 行数 |
| `--force` | 关闭 | 删除已有 output-root 后重建 |

注意：

- 每个 annotation worker 都会复制一份蛋白查找表。大库建议先使用 `--workers 1`。
- `--workers` 不控制 FASTA 读取并发。
- `--force` 会删除已有 `output-root`，执行前必须确认路径正确。
- 输入校验失败时不会删除旧产物。
- 构建中途失败可能留下不完整目录，需要修复原因后使用 `--force` 重跑。

## 13. 运行期数据约束

- 运行期 schema 不再保留 `tree_leaf`；
- `genome.leaf_node_id` 负责连接 species rank 叶子节点；
- `genome.genome_id` 必须是 0-based、连续、稳定、无空洞的 dense id；
- 所有 annotation matrix 和 module completeness matrix 严格按 `genome_id ASC` 构建；
- `module_completeness_file` 已并入 `matrix_file`；
- `module_kegg_member` 只保留 `module_annotation_id + kegg_annotation_ids_json`；
- `manifest.json` 的 `pipeline_version` 应为 `1.1.0`，`schema_version` 应为 `4.0`。

## 14. 构建后验收

检查文件：

```powershell
Test-Path project_data\backend_ready\manifest.json
Test-Path project_data\database\web_database.sqlite
Test-Path project_data\processed\tree_core\tree_core.bin
Test-Path project_data\数据库4.0运行期数据库说明.md
```

也可使用流水线目录中的验证脚本和测试：

```powershell
cd project_data_pipeline_v1.1.0
python -m pytest
```

验收要求：

- SQLite `PRAGMA integrity_check` 返回 `ok`；
- 每个矩阵 shape 与 manifest 中的 `row_count / column_count` 一致；
- 所有矩阵行数等于 `genome` 表行数；
- manifest 版本与流水线版本一致。

索引升级：

```powershell
python update_project_data_indexes.py --package-root F:\path\to\project_data
```

执行索引升级前应停止 Web 服务，并先备份 `web_database.sqlite`。

## 15. 流水线其他命令

```powershell
python run_pipeline.py make-taxonomy --help
python run_pipeline.py upgrade-runtime-indexes --help
python run_pipeline.py upgrade-runtime-tree --help
python run_pipeline.py migrate-runtime-tree --help
```

完整重建优先使用 `build`。

---

# 第三部分：故障排查

## 16. 本地 Web 版

### 找不到 Python

安装 Python 3.10+，勾选“Add Python to PATH”，或显式传入：

```powershell
-PythonExecutable "C:\path\to\python.exe"
```

### 首次安装依赖失败

检查网络和 PyPI 访问。企业代理环境需要配置 `pip` 代理或镜像。

### 找不到 project_data

使用：

```powershell
-ProjectDataRoot "D:\path\to\project_data"
```

并确认该目录包含 `backend_ready/manifest.json`。

### project_data 不完整

确认 SQLite、tree core、matrices 和 manifest 来自同一构建版本。

### 端口被占用

```powershell
-Port 8080
```

### 页面打不开

检查启动窗口是否有报错，再访问：

```text
http://127.0.0.1:8000/health
```

正常返回：

```json
{"status":"ok","edition":"local"}
```

### 下载一直排队

下载 worker 与 Web 服务在同一进程内启动。确认启动窗口没有异常，并检查：

```text
local_data/downloads/
```

## 17. project_data 流水线

### 审计失败

根据审计输出的 error 修复输入目录或字段后重新执行。不要跳过审计直接构建。

### 构建被拒绝

不带 `--force` 时，非空 `output-root` 会被拒绝。确认输出路径后使用 `--force`，或先手动移动旧产物。

### 磁盘或内存不足

- 清理 `temporary_file/build_stage`；
- 使用 `--workers 1`；
- 检查磁盘剩余空间；
- 大库构建前评估内存占用。

---

# 第四部分：GitHub 上传与发布

## 18. 建议上传内容

GitHub 源码仓库只提交以下内容：

- `README.md`
- `deploy_local_web.ps1`
- `start_local_web.bat`
- `project_data_pipeline_v1.1.0/`
- `web_sever_local_v1.0/`

不要提交：

- `project_data/`
- `row_data/`
- `local_data/saved_queries/`
- `local_data/downloads/`
- `.venv-local/`
- `project_data_pipeline_v1.1.0/.venv/`
- `node_modules/`
- `__pycache__/`
- `temporary_file/`
- `*.zip`
- `*.zip.sha256`
- `*.log`
- `*.err`
- `.Rhistory`

`web_sever_local_v1.0.zip` 与对应校验文件保留在本地，不进入 Git 历史。若以后需要提供二进制下载包，可在 GitHub 的 Releases 页面单独上传，不需要提交到源码仓库。

使用者获取源码后，按本说明生成自己的 `project_data`，然后双击 `start_local_web.bat` 或使用顶层 `deploy_local_web.ps1` 启动。

## 19. 版本

- Web 本地版：`1.0.0`，见 `web_sever_local_v1.0/VERSION`
- project_data pipeline：`1.1.0`
- project_data runtime schema：`4.0`
