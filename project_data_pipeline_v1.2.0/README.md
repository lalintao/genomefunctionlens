# project_data Pipeline 1.2.0

基于 1.1.0，新增 `add-annotation-matrix` 和 `update-annotation-matrix`，可直接维护已有运行期包的注释矩阵。

安装：`pip install -e .`。入口：`python run_pipeline.py --help`。

新增与更新说明见 [annotation_matrix_commands.md](annotation_matrix_commands.md)。完整构建说明见 src/docs。

蛋白与注释覆盖率统计见 [蛋白注释覆盖率统计说明.md](蛋白注释覆盖率统计说明.md)，脚本仅依赖 Python 标准库。

验证：32 passed, 1 skipped, 4 subtests passed。未运行真实全量数据包修改。
