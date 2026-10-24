export type AnnotationType = "cog" | "kegg" | "pfam" | "module" | string;
export type GenomeDatabase = "archaea" | "bacteria" | string;

export interface DatasetItem {
  species_tree: string;
  genome_database: GenomeDatabase;
  label: string;
  available: boolean;
  tree_core_path?: string | null;
  tree_core_format?: string | null;
  node_count?: number | null;
  leaf_count?: number | null;
  genome_count?: number | null;
  dataset_revision?: string;
}

export interface DatasetResponse {
  genome_databases: GenomeDatabase[];
  species_trees: string[];
  annotation_types: AnnotationType[];
  datasets: DatasetItem[];
}

export interface TreeCoreResponse {
  species_tree: string;
  genome_database: GenomeDatabase;
  tree_core_format: string;
  tree_core_download_url: string;
  tree_newick_download_url: string;
  node_count: number;
  leaf_count: number;
  genome_count: number;
}

export interface TreeScopeOptionMember {
  node_id: number;
  taxon_name: string;
  rank: string;
  leaf_count: number;
}

export interface TreeScopeOption {
  key: "archaea_bacteria" | "archaea" | "bacteria";
  status: "available" | "unavailable";
  members: TreeScopeOptionMember[];
}

export interface TreeScopeOptionsResponse {
  species_tree: string;
  genome_database: GenomeDatabase;
  options: TreeScopeOption[];
}

export interface TreeScopeRequest {
  node_ids: number[];
  leaf_node_ids: number[];
  genome_ids: number[];
}

export interface GenomeFilterRequest {
  if_refseq?: boolean | null;
  min_checkm2_completeness?: number | null;
  max_checkm2_contamination?: number | null;
  min_quality_score?: number | null;
  max_contig?: number | null;
}

export interface TreeFilterGenomesRequest {
  species_tree: string;
  genome_database: GenomeDatabase;
  scope: TreeScopeRequest;
  filters: GenomeFilterRequest;
}

export interface TreeFilterGenomesResponse {
  kept_leaf_node_ids: number[];
  removed_leaf_node_ids: number[];
  kept_genome_ids: number[];
  removed_genome_ids: number[];
  kept_leaf_count: number;
  kept_genome_count: number;
}

export interface AnnotationCondition {
  id: string;
  type: AnnotationType;
  value: string;
  selected?: SuggestItem | null;
  moduleSelected?: ModuleSuggestItem | null;
}

export interface SuggestItem {
  annotation_id?: number | null;
  type: AnnotationType;
  value: string;
  label: string;
  short_name?: string | null;
  full_name?: string | null;
  source?: string | null;
  source_version?: string | null;
}

export interface ModuleSuggestItem {
  kind: "module";
  module_id: string;
  module_name: string;
  label: string;
  aliases?: string | null;
}

export interface SearchColumn {
  annotation_id?: number | null;
  type: AnnotationType;
  value: string;
  label: string;
  column_id?: string | null;
  column_role?: string | null;
  short_name?: string | null;
  full_name?: string | null;
  source?: string | null;
  source_version?: string | null;
  module_id?: string | null;
  module_name?: string | null;
  step_id?: string | null;
  step_index?: number | null;
  display_order?: number | null;
  step_label?: string | null;
  step_logic?: string | null;
  step_type?: string | null;
  is_optional?: boolean | null;
  raw_expression?: string | null;
  source_ast_node_id?: string | null;
  source_ir_node_id?: string | null;
  source_group_id?: string | null;
  completeness_block_id?: string | null;
  display_path?: string | null;
  semantic_path?: string | null;
}

export interface TreeNodeSearchItem {
  id: number;
  label: string;
  rank: string;
  path?: string;
  speciesCount?: number;
  genomeCount?: number;
}

export interface ModuleGroup {
  module_id: string;
  module_name: string;
  column_ids: string[];
  completeness_column_id?: string | null;
  detail_column_ids?: string[];
  ko_values?: string[];
}

export interface ModuleQueryInfo {
  enabled: boolean;
  modules: ModuleGroup[];
}

export interface AnnotationColumnSearchResult {
  species_tree: string;
  genome_database: GenomeDatabase;
  columns: SearchColumn[];
  module_groups: ModuleGroup[];
}

export interface HeatmapAggregateColumn {
  annotation_id?: number | null;
  type: AnnotationType;
  value: string;
  label: string;
  short_name?: string | null;
  full_name?: string | null;
  source?: string | null;
  source_version?: string | null;
}

export interface HeatmapAggregateResponse {
  species_tree: string;
  genome_database: GenomeDatabase;
  row_node_ids: number[];
  columns: HeatmapAggregateColumn[];
  count_matrix: number[][];
  species_hit_count_matrix: number[][];
  ratio_matrix: number[][];
  row_leaf_counts: number[];
}

export interface Selection {
  rowId: string;
  leafNodeIds?: number[];
  leafCount?: number;
  nodeId?: number;
  nodeIds?: number[];
  selectionScope?: "node" | "annotation_all_hits" | "all_tree" | string;
  rowNodeId?: number;
  rowRank?: string | null;
  rowLabel?: string;
  rowKind?: "terminal" | string;
  columnId?: string | null;
  annotationType: AnnotationType;
  annotationValue: string;
  annotationId?: number | null;
  annotationLabel?: string;
  proteinCountAll?: number;
  moduleId?: string | null;
  moduleName?: string | null;
  stepId?: string | null;
  stepLabel?: string | null;
}

export interface DownloadBranchScope {
  branchId: string;
  branchLabel?: string;
  branchRank?: string | null;
  nodeId?: number;
  leafCount?: number;
  leafNodeIds?: number[];
}

export interface DownloadColumnScope {
  columnId?: string | null;
  annotationType: AnnotationType;
  annotationValue: string;
  annotationId?: number | null;
  annotationLabel?: string;
  moduleId?: string | null;
  moduleName?: string | null;
  stepId?: string | null;
  stepLabel?: string | null;
}

export interface DownloadResponse {
  download_url: string;
  task_id: string;
  file_count: number;
}

export interface DownloadTaskStartResponse {
  task_id: string;
  status: "queued";
  status_url: string;
}

export interface DownloadTaskStatusResponse {
  task_id: string;
  status: "queued" | "running" | "ready" | "failed" | "cancelled";
  stage?: "queued" | "preparing" | "writing_files" | "archiving" | "ready" | "failed" | "cancelled";
  completed_files: number;
  total_files: number;
  download_url?: string | null;
  file_count?: number | null;
  error?: string | null;
}

export interface DownloadPreviewItem {
  row_id: string;
  column_id?: string | null;
  annotation_type: string;
  annotation_value: string;
  annotation_label: string;
  module_id?: string | null;
  module_name?: string | null;
  step_id?: string | null;
  step_label?: string | null;
  row_node_id?: number | null;
  row_rank?: string | null;
  row_label?: string | null;
  row_kind?: string | null;
  leaf_count: number;
  protein_count_all: number;
  protein_count_representative: number;
  representative_missing: boolean;
  representative_species?: string | null;
}

export interface DownloadPreviewResponse {
  items: DownloadPreviewItem[];
}

export interface AppConfigDataset {
  species_tree: string;
  genome_database: GenomeDatabase;
  label: string;
}

export interface AppConfigQueryCondition {
  id: string;
  type: AnnotationType;
  input_value: string;
  selected_value?: string | null;
  selected_label?: string | null;
  selected_short_name?: string | null;
  selected_full_name?: string | null;
  module_id?: string | null;
  module_name?: string | null;
}

export interface AppConfigQuery {
  mode: "manual" | "batch";
  manual_conditions: AppConfigQueryCondition[];
  batch_text: string;
}

export interface AppConfigColumnSnapshot {
  key: string;
  type: AnnotationType | "empty";
  value: string;
  label: string;
  column_id?: string | null;
  column_role?: string | null;
  module_id?: string | null;
  module_name?: string | null;
  step_id?: string | null;
  step_label?: string | null;
}

export interface AppConfigRowSnapshot {
  key: string;
  node_id: number;
  rank: string | null;
  label: string;
  kind: "terminal";
  owned_leaf_node_ids: number[];
}

export interface AppConfigResultSnapshot {
  columns: AppConfigColumnSnapshot[];
  visible_rows: AppConfigRowSnapshot[];
}

export interface AppConfigTreeState {
  view_mode: "rectangular" | "circular";
  global_rank: string;
  strip_rank: string;
  branch_scale: number;
  spacing_scale: number;
  show_strip: boolean;
  show_branch_labels: boolean;
  show_species_count: boolean;
  show_branch_lengths: boolean;
  show_internal_nodes: boolean;
  show_branch_guides: boolean;
  show_strip_labels: boolean;
  strip_min_leaf_count?: number;
  force_show_branch_labels: boolean;
  force_show_strip_labels: boolean;
  force_show_species_count: boolean;
  species_count_style: "plain" | "bar";
  species_count_color_scheme: string;
  branch_stroke_width?: number;
  branch_label_font_size: number;
  branch_length_font_size?: number;
  species_count_font_size: number;
  strip_name_font_size: number;
  circular_arc_degrees: number;
  circular_rotation_degrees: number;
  branch_prune?: {
    refseq_only: boolean;
    min_completeness: string;
    max_contamination: string;
    min_quality: string;
    max_contig: string;
    long_branch_iqr_multiplier: string;
    minimum_terminal_leaf_count: string;
  };
  custom_terminal_labels: Record<number, string>;
  view_root: number | null;
  selected_node_id: number | null;
  hovered_node_id: number | null;
  pending_center_node_id: number | null;
  tree_search: {
    text: string;
    rank: string;
  };
  tree_styles?: AppConfigTreeStyle[];
  alive_leaf_node_ids?: number[];
  local_rank_rules?: Array<{ node_id: number; expand_rank: string; enabled: boolean }>;
  local_rank_constraints?: Array<{ node_id: number; expand_rank: string }>;
  terminal_node_table?: Array<{ node_id: number; rank: string; label: string; collapse_ceiling_rank: string; owned_leaf_node_ids: number[] }>;
}

export interface AppConfigTreeStyle {
  id: string;
  created_order: number;
  kind: "label" | "branch" | "background";
  color: string;
  name: string;
  node_id: number;
  node_ids: number[];
}

export interface AppConfigHeatmapStyle {
  id: string;
  role?: "default" | "selection";
  tree_view_mode: "rectangular" | "circular";
  palette_id: string;
  shape: "fill" | "circle" | "triangle" | "square";
  border_mode?: "none" | "outer" | "inner";
  name?: string;
  cell_keys: string[];
}

export interface AppConfigHeatmapState {
  show_numbers: boolean;
  heatmap_metric: "count" | "ratio";
  ratio_display_mode: "fraction" | "percent";
  value_font_size: number;
  column_label_font_size?: number;
  strip_column_width?: number;
  heatmap_column_width?: number;
  global_shape_size: number;
  column_slots?: Array<{
    slot_id: string;
    column_key?: string | null;
    slot_index?: number;
  }>;
  heatmap_styles: AppConfigHeatmapStyle[];
  selected_cell_keys: string[];
  show_module_names: boolean;
  show_module_full_name?: boolean;
  show_module_detail: boolean;
  module_completeness_threshold: string;
  active_module_id: string;
  column_label_parts: Array<"value" | "short_name" | "full_name">;
}

export interface AppConfigCartItem {
  row_id: string;
  column_id?: string | null;
  annotation_type: AnnotationType;
  annotation_value: string;
  annotation_label: string;
  module_id?: string | null;
  module_name?: string | null;
  step_id?: string | null;
  step_label?: string | null;
  row_node_id?: number | null;
  row_rank?: string | null;
  row_label?: string | null;
  row_kind?: string | null;
  leaf_count: number;
  protein_count_all: number;
  protein_count_representative: number;
  representative_missing: boolean;
  representative_species?: string | null;
}

export interface AppConfigCartState {
  active_tab: string;
  filters: {
    representative_only: boolean;
    excluded_ranks: string[];
  };
  items: AppConfigCartItem[];
  selected_item_keys: string[];
}

export interface AppConfigBranchCartRecord {
  id: string;
  node_id: number;
  label: string;
  taxon_label?: string;
  rank: string | null;
  expand_rank: string;
  ancestor_node_id: number | null;
  ancestor_label: string;
  ancestor_rank: string;
  path: string;
  leaf_count: number;
  full_tree_leaf_count?: number;
  leaf_node_ids?: number[];
  is_exact_node_scope?: boolean;
  batch_id: number;
  source_type: "manual" | "heatmap";
}

export interface AppConfigBranchCartBatch {
  id: number;
  source_type: "manual" | "heatmap";
  ancestor_node_id: number | null;
  ancestor_label: string;
  ancestor_rank: string;
  expand_rank: string;
  record_count: number;
}

export interface AppConfigBranchCartState {
  drawer_open: boolean;
  drawer_expanded: boolean;
  filter_open: boolean;
  edit_mode: boolean;
  selected_batch_ids: number[];
  alive_leaf_node_ids?: number[];
  records: AppConfigBranchCartRecord[];
  batches: AppConfigBranchCartBatch[];
  filters: {
    ancestor_rank: string;
    ancestor_query: string;
    expand_rank: string;
    filter_rank: string;
    filter_ancestor: string;
    filter_expand_rank: string;
    filter_batch_id: string;
  };
}

export interface AppConfigUiState {
  language: "zh" | "en";
  active_page: "home" | "query" | "about" | "result";
  drawer_panel: "tree" | "heatmap" | "download";
  drawer_open: boolean;
  control_drawer_width: number;
  cart_drawer_width: number;
  branch_cart_drawer_width: number;
  download_taxon_ranks: string[];
  cart_column_key: string;
  cart_drawer_open: boolean;
  cart_drawer_expanded: boolean;
  cart_filter_open: boolean;
  branch_cart_drawer_open: boolean;
  branch_cart_drawer_expanded: boolean;
}

export interface AppConfigExport {
  version: string;
  exported_at: string;
  app_version: string;
  dataset: AppConfigDataset;
  query: AppConfigQuery;
  annotation_column_search: AnnotationColumnSearchResult;
  result_snapshot: AppConfigResultSnapshot;
  tree_state: AppConfigTreeState;
  heatmap_state: AppConfigHeatmapState;
  cart_state: AppConfigCartState;
  branch_cart_state: AppConfigBranchCartState;
  ui_state: AppConfigUiState;
}
