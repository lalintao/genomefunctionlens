# annotation 零命中修复说明

修复日期：2026-10-22

## 背景

旧发布版在 annotation 解析阶段出现 0 命中时，仍会继续写出 `project_data`：

```text
protein_annotation = 0
processed/matrices/ = 空目录
manifest.matrices = 只有 module_completeness
```

这种包会被误认为构建成功，但 COG/KEGG/PFAM 矩阵全部缺失。

## v1.1.0 热修复内容

1. 任一必需注释类型最终命中数为 0 时，构建立即失败。
2. 不再生成缺少 COG/KEGG/PFAM 矩阵的假成功包。
3. manifest 增加：

```json
"build_performance": {
  "annotation_hit_counts": {
    "cog": 0,
    "kegg": 0,
    "pfam": 0
  }
}
```

4. 蛋白查找表超过 20,000,000 条时，禁止 `--workers > 1`，避免多进程复制超大查找表。
5. annotation 阶段缺少 `.tsv` 文件时直接失败。
6. annotation 两列解析统一支持 tab、空格、逗号、竖线 `|` 等列分隔符，不再依赖 `genome__gene` 命名格式；`;;` 仍作为多值分隔符。
7. 超宽 annotation 矩阵改为按 `genome_id` 分块写入 Parquet，不再对大矩阵执行整表 `pivot`。
8. 新增单元测试覆盖：

- 三种注释全部零命中必须失败
- 三种注释都有命中必须通过
- 超大查找表必须使用单进程
- GTDB 风格蛋白 ID（如 `AP022133.1_1553`）和常见列分隔符
- 分块矩阵写出与全表 pivot 结果一致

## 推荐运行参数

```bash
python run_pipeline.py build   --workspace /share/.../GTDB_arc_bac_232   --output-root /share/.../GTDB_arc_bac_232/project_data   --temp-root /share/.../GTDB_arc_bac_232/temporary_file/build_stage   --workers 1   --annotation-chunk-rows 250000   --force
```

## 失败时如何判断

如果构建报错包含：

```text
Annotation stage produced zero protein hits
```

说明 annotation TSV 的 protein ID 没有匹配到 FASTA 构建出的 protein 表，或者 annotation worker 初始化异常。此时不会生成新的不完整包。

如果构建报错包含：

```text
Annotation parallel parsing is unsafe for this dataset
```

请改用 `--workers 1`。

## 旧包修复

对于已经生成但没有 annotation 矩阵的旧包，可继续使用本发布包 `tools/` 目录中的：

```text
tools/rebuild_annotation_matrices.py
tools/apply_annotation_repair.py
```

修复工具只重建 annotation 派生层，不需要重新读取全部 FASTA。
