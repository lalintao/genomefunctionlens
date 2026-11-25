# project_data Pipeline v1.2.0

发布日期：2026-11-25

## 主要更新

- 新增 `add-annotation-matrix`，可向已有运行期包加入新的注释类型。
- 新增 `update-annotation-matrix`，可全量替换已有注释类型的命中数据。
- 新命令直接处理运行期包，无需重新读取 `row_data`、FASTA 或物种树。
- 同步维护 SQLite、Parquet 矩阵、`matrix_file` 与 `backend_ready/manifest.json`。
- 普通异常会回滚数据库并恢复矩阵和 manifest；跨文件发布前仍建议备份运行期包。
- 新增蛋白与 COG/KEGG/Pfam 注释覆盖率统计脚本及说明。

## 兼容范围

- Python 3.11+。
- 运行期 schema 4.0。
- 新增注释类型可以写入数据包，但冻结网页后端仍只展示 cog/kegg/pfam/module，除非网页端同步增加动态类型支持。
- `project_data_pipeline_v1.1.0` 保持冻结，不随本版本修改。

## 验证

- 发布包测试：32 passed, 1 skipped, 4 subtests passed。
- 未运行真实全量数据包修改；生产数据首次使用前应保留外部备份。

## 下载

- `project_data_pipeline_v1.2.0.zip`
- `project_data_pipeline_v1.2.0.zip.sha256`

SHA256：`86afe994d51a6c324934da70fb57b8d7dee4477a3ae95bdccd770ff037325d4e`
