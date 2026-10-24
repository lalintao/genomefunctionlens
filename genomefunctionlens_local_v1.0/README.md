# GenomeFunctionLens Local（Windows）

GenomeFunctionLens Local 是面向 Windows 的本地单用户版本，面向本地查询、物种树/热图浏览、结果导出、查询保存和序列下载。

本地版与在线版的主要区别：

- 不包含登录、注册、账号菜单和密码功能；
- 不包含 Chat、DeepSeek、RAG 和 Europe PMC 检索；
- 部署包不携带 `project_data`；
- 部署过程不创建账号数据库、Chat 数据库或下载任务数据库；
- 保存查询、分类和下载任务使用项目目录下的 JSON 文件；
- 默认只监听 `127.0.0.1`，不向局域网公开。

> 科学数据仍由本项目配套的 `project_data` 构建工具生成。该数据包是只读科学数据，其中包含运行期科学查询所需的 `database/web_database.sqlite`。它不是本部署包创建或维护的账号/业务数据库。

## 1. 功能范围

保留：

- 数据集选择；
- COG、KEGG、Pfam 和 KEGG Module 查询；
- 物种树和热图；
- 物种范围、树样式和热图样式；
- SVG、PNG、PDF 和数据表导出；
- 保存当前查询和“我的查询记录”；
- 序列下载。

移除：

- 登录、注册、找回密码、修改密码；
- 账号会话和安全审计；
- Chat 对话和 Chat 画布操作；
- RAG、Embedding、Reranker；
- SMTP 邮件；
- 反馈页面和反馈接口。

前端不会显示上述已移除功能的入口。

## 2. 环境要求

- Windows 10 或 Windows 11；
- Python 3.10 或更高版本，推荐 Python 3.11；
- 首次安装 Python 依赖时需要访问 PyPI；
- 普通使用者不需要安装 Node.js，也不需要编译前端。

检查 Python：

```powershell
python --version
```

如果系统同时安装多个版本，也可以显式传入解释器：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\windows\start_local.ps1 `
  -PythonExecutable "C:\Python311\python.exe"
```

## 3. 准备 project_data

本地版不包含科学数据。请使用配套的 `project_data` 构建工具生成数据包，并保证目录结构包含：

```text
project_data/
  backend_ready/
    manifest.json
  database/
    web_database.sqlite
  processed/
    tree_core/
    matrices/
    module_completeness/
```

默认把 `project_data` 放在本目录下：

```text
genomefunctionlens_local_v1.0/
  project_data/
  local_data/
  src/
  deploy/
  README.md
```

如果数据位于其他位置，使用 `-ProjectDataRoot`：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\windows\start_local.ps1 `
  -ProjectDataRoot "D:\datasets\my_project_data"
```

启动脚本会读取 `backend_ready/manifest.json`，并检查 SQLite、tree core 和矩阵文件是否存在。

## 4. 一键启动

最直接的方式是在本目录双击：

```text
start_local.bat
```

或在 PowerShell 中运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\start_local.ps1
```

如果使用包含 `project_data_pipeline_v1.1.0` 的总发布目录，也可以回到上一级目录双击：

```text
start_local_web.bat
```

首次运行会自动：

1. 创建 `.venv-local`；
2. 安装 `src/backend/requirements.txt`；
3. 检查 `project_data`；
4. 创建 `local_data`；
5. 启动 Web 服务和内置下载 worker；
6. 打开 `http://127.0.0.1:8000/`。

关闭 PowerShell 或按 `Ctrl+C` 即可停止服务。

常用参数：

```powershell
# 不自动打开浏览器
powershell -ExecutionPolicy Bypass -File .\start_local.ps1 -NoBrowser

# 更换端口
powershell -ExecutionPolicy Bypass -File .\start_local.ps1 -Port 8080

# 指定 project_data
powershell -ExecutionPolicy Bypass -File .\start_local.ps1 -ProjectDataRoot "D:\my_project_data"

# 重新安装 Python 依赖
powershell -ExecutionPolicy Bypass -File .\start_local.ps1 -Reinstall
```

## 5. 本地数据目录

运行期内容统一写入：

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

说明：

- `saved_queries/`：保存查询和分类。无账号隔离，访问同一个本地实例的所有人看到同一份记录。
- `downloads/jobs/`：下载任务状态 JSON。
- `downloads/temp/`：下载任务的临时文件，可清理。
- `downloads/archive/`：已生成的 ZIP，下载任务过期后自动清理。
- `downloads/logs/`：启动脚本或排查用日志目录。

需要备份时至少备份：

```text
local_data/saved_queries/
```

`project_data` 应作为独立科学数据版本管理，不要和 `local_data` 混在一起。

## 6. 访问范围和安全说明

默认地址：

```text
http://127.0.0.1:8000/
```

默认只监听本机回环地址。由于本地版没有登录和权限控制，不建议直接使用 `-BindAddress 0.0.0.0` 开放到局域网或公网。如果确实需要局域网访问，应自行通过 Windows 防火墙和网络边界限制访问者。

本地版不包含 CSRF、账号会话、下载授权令牌等服务端安全机制。它只适合受信任的单机环境。

## 7. 常见问题

### 启动提示找不到 Python

安装 Python 3.10 或更高版本，并勾选“Add Python to PATH”。也可以使用：

```powershell
-PythonExecutable "C:\path\to\python.exe"
```

### 首次启动安装依赖失败

检查网络是否可以访问 PyPI。企业代理环境需要先配置 `pip` 的代理或镜像。

### 启动提示 project_data 不完整

确认 `backend_ready/manifest.json`、`database/web_database.sqlite`、tree core 和矩阵文件都来自同一个 `project_data` 版本。

### 下载任务一直显示排队

本地版下载 worker 与 Web 服务在同一个进程内启动。确认启动窗口没有报错，并检查：

```text
local_data/downloads/
```

如果服务刚启动，等待几秒后重试。服务异常退出时，未完成的下载任务会在下次启动后被恢复或标记失败。

### 保存查询后在哪里查看

点击顶部“我的查询记录”，或直接查看：

```text
local_data/saved_queries/
```

### 端口被占用

```powershell
powershell -ExecutionPolicy Bypass -File .\start_local.ps1 -Port 8080
```

## 8. 开发与重新构建前端

发布 ZIP 已经包含构建好的 `src/frontend/dist`，普通用户不需要执行本节。

开发者需要：

- Node.js 24 或更高版本；
- npm。

```powershell
cd src/frontend
npm ci
npm run build
```

构建结束后重新执行 `start_local.ps1`。

## 9. 运行测试

安装测试依赖后运行：

```powershell
python -m pip install pytest
python -m pytest
```

测试覆盖本地 JSON 保存存储和文件化下载队列，不依赖 `project_data`。

## 10. GitHub 上传说明

建议上传：

- `README.md`
- `VERSION`
- `.gitignore`
- `deploy/`
- `src/backend/`（不包含 `.env`、虚拟环境和缓存）
- `src/frontend/`（包含源码、`package-lock.json` 和 `dist/`）
- `tests/`
- `local_data/README.md`

不要上传：

- `project_data/`
- `local_data/saved_queries/`
- `local_data/downloads/`
- `.venv-local/`
- `src/frontend/node_modules/`
- `.npm-cache/`
- `__pycache__/`
- `*.log`

GitHub Release 可以上传一个不包含 `project_data` 的 ZIP。科学数据由用户使用配套 `project_data` 流程单独生成。

## 11. 版本

当前版本：见 `VERSION`。
