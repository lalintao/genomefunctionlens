# project_data Pipeline 1.1

这是 `web_database_deel` 项目 `project_data` 构建流程的优化冻结版本。

- 流水线版本：`1.1.0`
- 运行期 schema：`4.0`
- 冻结日期：`2026-10-21`
- 适用入口：`python run_pipeline.py build ...`

## 主要优化

- 单进程 annotation 解析直接写入临时 SQLite，移除 annotation Parquet 中继
- annotation 中间层不再保存未使用的 `protein_id`
- 蛋白查找表使用打包整数，避免单进程重复复制整表
- 最终 SQLite 使用构建期 PRAGMA、批量事务和延迟索引创建
- manifest 记录分阶段耗时

完整库基准从约 **1,071 秒** 降到 **844 秒**，约提速 **21.2%**。

## 快速开始

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -e .
python run_pipeline.py audit-row-data --workspace /path/to/workspace --mode deep
python run_pipeline.py build --workspace /path/to/workspace --force
```

完整说明见 [运行说明.md](运行说明.md)，优化细节见 [性能优化报告.md](性能优化报告.md)。
