# 新增与更新注释矩阵（Pipeline 1.2.0）

对一个现有运行期包执行操作。先停止读取该包的网页后端，操作完成后重启；不要并发运行多个维护程序。

这两个操作不需要原始 `row_data`。只要有完整的运行期包（至少包含
`database/web_database.sqlite` 和 `backend_ready/manifest.json`）以及新的 TSV
即可。TSV 第一列必须对应 SQLite `protein.protein_id`；如果手头只有
`protein_name`，需要先转换成 `protein_id`。

```powershell
python run_pipeline.py add-annotation-matrix --package-root F:/data/project_data --mapping-file F:/data/custom.tsv --annotation-type CUSTOM
python run_pipeline.py update-annotation-matrix --package-root F:/data/project_data --mapping-file F:/data/kegg.tsv --annotation-type KEGG
```

- 新增要求类型尚不存在；更新要求字典和矩阵注册项都已存在。
- 类型名转为小写，允许英文字母开头，后接字母、数字、下划线；module 等保留名称不能使用。
- 第一列匹配 SQLite `protein.protein_id`，不是描述字段 `protein_name`。同名 ID 若在多个基因组出现，将匹配所有对应蛋白，沿用现有修复工具的匹配语义。
- UTF-8 输入支持 tab、空格、逗号、竖线分隔两列，第二列可用 `;;` 分隔多个注释。可使用首行 `protein_id annotation` 表头。
- 完全重复的蛋白—注释映射去重。未知蛋白跳过并汇报数量；全部无法匹配、空文件或格式错误会失败。
- 矩阵行为全部 genome（严格 genome_id 升序），列为有命中的注释，值为不同蛋白的命中数，未命中填 0。
- 更新是全量替换该类型的命中数据，不是追加；新映射未出现的旧命中将删除。
- 同步更新 Parquet、protein_annotation、matrix_file、manifest。其他类型及蛋白、树、Module completeness 不重建。
- 字典保留已有 ID 和描述，新增注释追加 ID；无命中的旧字典项保留，避免破坏 Module 对 KO ID 的引用。输入只有两列，无法补充注释描述。
- 更新 KEGG 不重算外部提供的 Module completeness；如果需要与新 KO 命中重新一致，应另行计算 completeness。
- 映射分批导入临时 SQLite，矩阵按行分块写出，不将完整大矩阵载入内存。临时空间位于包所在文件系统。
- 运行时间主要取决于运行期 `protein` 表大小和新 TSV 大小；不会重复读取 FASTA、解析物种树或重建其他 annotation 类型，因此通常明显快于完整 `build`。新增和更新的耗时大致相近；更新会额外删除并重写该类型的 `protein_annotation` 行。
- 对超大包，优先把 TSV 预先去重、只保留需要的两列，并把临时目录放在本地 SSD。多次维护时可在 `protein(protein_id)` 上建立索引；首次建索引本身需要扫描和写入整个蛋白表，只有重复执行或 TSV 很大时才值得保留。
- 普通异常会回滚数据库并恢复矩阵、manifest。跨 SQLite/文件的发布不是断电原子事务；重要包请保留外部备份。

## 网页兼容范围

现有冻结网页后端的 heatmap 服务仅接受 cog/kegg/pfam/module。更新已有类型仍遵守原数据契约；新增自定义类型可生成完整数据包内容，但要在网页中搜索、展示它，需要网页端增加动态类型支持。本次功能属于数据流水线，不包含网页端改造。

## 版本

原 project_data_pipeline_v1.1.0 保持冻结。新增功能在工作区源码及 project_data_pipeline_v1.2.0 发布包中。
