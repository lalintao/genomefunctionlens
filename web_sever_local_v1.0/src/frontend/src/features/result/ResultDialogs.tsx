import { LoaderCircle, X } from "lucide-react";
import { useEffect, useRef } from "react";
import AnnotationConditionEditor from "../query/AnnotationConditionEditor";
import { SuggestionPanel } from "../query/SuggestionPanels";
import { annotationDisplayValue, annotationTypeLabel } from "../../shared/annotation";
import type { Language } from "../../shared/types";
import type { AnnotationCondition, AnnotationType, DownloadTaskStatusResponse, ModuleSuggestItem, SuggestItem } from "../../types";
import type { InsertDialogState } from "./resultTypes";

export { default as ActionConfirmDialog } from "./ActionConfirmDialog";

export function InsertColumnDialog(props: {
  language: Language;
  state: InsertDialogState;
  suggestions: SuggestItem[];
  annotationTypes: AnnotationType[];
  onChange: (value: InsertDialogState) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const zh = props.language === "zh";
  return (
    <div className="modal-overlay">
      <div className="modal-card insert-modal-card">
        <div className="modal-header">
          <h2>{props.state.side === "left" ? (zh ? "在左侧插入新注释" : "Insert Annotation Left") : (zh ? "在右侧插入新注释" : "Insert Annotation Right")}</h2>
          <button type="button" className="icon-button modal-close" aria-label={zh ? "关闭插入弹窗" : "Close insert dialog"} onClick={props.onCancel}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <p className="muted">{zh ? "新列会插入到当前目标列的左侧或右侧，并保留现有顺序和样式。" : "The new column will be inserted beside the current target column while preserving order and styles."}</p>
        <label className="field"><span>{zh ? "注释类型" : "Annotation Type"}</span><select value={props.state.type} onChange={(event) => props.onChange({ ...props.state, type: event.target.value, selected: null })}>{props.annotationTypes.map((type) => <option key={type} value={type}>{annotationTypeLabel(type)}</option>)}</select></label>
        <label className="field">
          <span>{zh ? "注释条目" : "Annotation Entry"}</span>
          <div className="condition-input-wrap">
            <input value={props.state.value} placeholder={zh ? "注释编号、短名称或全称" : "Annotation ID, short name, or full name"} onChange={(event) => props.onChange({ ...props.state, value: event.target.value, selected: null })} />
            {props.suggestions.length && props.state.value.trim() ? <SuggestionPanel items={props.suggestions} onPick={(item) => props.onChange({ ...props.state, type: item.type, value: annotationDisplayValue(item), selected: item })} /> : null}
          </div>
        </label>
        <div className="modal-actions"><button type="button" className="button subtle" onClick={props.onCancel}>{zh ? "取消" : "Cancel"}</button><button type="button" className="button primary" onClick={props.onConfirm}>{zh ? "确定" : "Confirm"}</button></div>
      </div>
    </div>
  );
}

export function CandidateDialog(props: {
  language: Language;
  items: SuggestItem[];
  onPick: (item: SuggestItem) => void;
  onCancel: () => void;
}) {
  const zh = props.language === "zh";
  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-header">
          <h2>{zh ? "选择明确注释条目" : "Choose an Exact Annotation"}</h2>
          <button type="button" className="icon-button modal-close" aria-label={zh ? "关闭候选弹窗" : "Close candidate dialog"} onClick={props.onCancel}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <p className="muted">{zh ? "该关键词匹配到多个注释条目，请选择一个明确项用于热图查询。" : "This keyword matched multiple annotations. Choose one exact item for the heatmap query."}</p>
        <div className="candidate-list">
          {props.items.map((item) => (
            <button key={`${item.type}-${item.value}`} type="button" onClick={() => props.onPick(item)}>
              <strong>{item.short_name || item.value}</strong>
              <span>{annotationTypeLabel(item.type)} / {item.value}</span>
              {item.full_name ? <em>{item.full_name}</em> : null}
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="button subtle" onClick={props.onCancel}>{zh ? "取消" : "Cancel"}</button>
        </div>
      </div>
    </div>
  );
}

export function HeatmapQueryDialog(props: {
  open: boolean;
  language: Language;
  conditions: AnnotationCondition[];
  annotationTypes: AnnotationType[];
  activeSuggestionId: string | null;
  suggestions: Record<string, SuggestItem[]>;
  moduleSuggestions: Record<string, ModuleSuggestItem[]>;
  isSubmitting: boolean;
  onUpdateCondition: (id: string, patch: Partial<AnnotationCondition>) => void;
  onAddCondition: () => void;
  onRemoveCondition: (id: string) => void;
  onActiveSuggestionChange: (id: string | null) => void;
  onSuggestionApply: (conditionId: string, item: SuggestItem) => void;
  onModuleSuggestionApply: (conditionId: string, item: ModuleSuggestItem) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!props.open) return null;

  const zh = props.language === "zh";

  return (
    <div className="modal-overlay">
      <div className="modal-card heatmap-query-modal-card">
        <div className="modal-header">
          <h2>{zh ? "新增查询列" : "Add Query Column"}</h2>
          <button type="button" className="icon-button modal-close" aria-label={zh ? "关闭追加查询弹窗" : "Close append query dialog"} onClick={props.onCancel}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <p className="muted">
          {zh
            ? "每次新增一条查询。普通注释会直接加入热图列，Module 会按完整语义展开成完整度列和 KO detail 列。"
            : "Add one query at a time. Standard annotations are added directly, while Module queries expand into completeness and KO detail columns."}
        </p>
        <AnnotationConditionEditor
          language={props.language}
          conditions={props.conditions}
          annotationTypes={props.annotationTypes}
          activeSuggestionId={props.activeSuggestionId}
          suggestions={props.suggestions}
          moduleSuggestions={props.moduleSuggestions}
          annotationPlaceholder={zh ? "注释编号、短名称或全称" : "Annotation ID, short name, or full name"}
          modulePlaceholder={zh ? "Module ID 或名称" : "Module ID or name"}
          onUpdateCondition={props.onUpdateCondition}
          onAddCondition={props.onAddCondition}
          onRemoveCondition={props.onRemoveCondition}
          onActiveSuggestionChange={props.onActiveSuggestionChange}
          onSuggestionApply={props.onSuggestionApply}
          onModuleSuggestionApply={props.onModuleSuggestionApply}
        />
        <div className="modal-actions">
          <button type="button" className="button subtle" onClick={props.onCancel}>
            {zh ? "取消" : "Cancel"}
          </button>
          <button type="button" className="button primary" disabled={props.isSubmitting} onClick={props.onConfirm}>
            {props.isSubmitting ? (zh ? "追加中..." : "Appending...") : (zh ? "追加到热图" : "Append To Heatmap")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function HeatmapBatchQueryDialog(props: {
  open: boolean;
  language: Language;
  value: string;
  isSubmitting: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!props.open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!props.isSubmitting) props.onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'textarea, button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [props.isSubmitting, props.onCancel, props.open]);

  if (!props.open) return null;
  const zh = props.language === "zh";
  return (
    <div className="modal-overlay">
      <div ref={dialogRef} className="modal-card heatmap-batch-query-modal-card" role="dialog" aria-modal="true" aria-labelledby="heatmap-batch-query-title">
        <div className="modal-header">
          <h2 id="heatmap-batch-query-title">{zh ? "批量添加功能注释列" : "Batch Add Annotation Columns"}</h2>
          <button type="button" className="icon-button modal-close" disabled={props.isSubmitting} aria-label={zh ? "关闭批量添加弹窗" : "Close batch add dialog"} onClick={props.onCancel}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <label className="field heatmap-batch-query-field">
          <span>{zh ? "功能注释" : "Annotation queries"}</span>
          <textarea
            autoFocus
            aria-label={zh ? "批量功能注释查询" : "Batch annotation queries"}
            value={props.value}
            placeholder={"COG0001\nPF00001.1\nM00357"}
            onChange={(event) => props.onChange(event.currentTarget.value)}
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="button subtle" disabled={props.isSubmitting} onClick={props.onCancel}>{zh ? "取消" : "Cancel"}</button>
          <button type="button" className="button primary" disabled={!props.value.trim() || props.isSubmitting} onClick={props.onConfirm}>
            {props.isSubmitting ? (zh ? "批量添加中..." : "Appending...") : (zh ? "添加到热图" : "Append To Heatmap")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DownloadHeaderDialog(props: {
  language: Language;
  open: boolean;
  mode: "all" | "representative";
  selectedFields: string[];
  isPreparing: boolean;
  progress: DownloadTaskStatusResponse | null;
  onModeChange: (mode: "all" | "representative") => void;
  onToggleField: (field: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const zh = props.language === "zh";
  const fields = [
    { key: "protein_name", zh: "protein_name", en: "protein_name" },
    { key: "genome_name", zh: "genome_name", en: "genome_name" },
    { key: "domain", zh: "domain", en: "domain" },
    { key: "phylum", zh: "phylum", en: "phylum" },
    { key: "class", zh: "class", en: "class" },
    { key: "order", zh: "order", en: "order" },
    { key: "family", zh: "family", en: "family" },
    { key: "genus", zh: "genus", en: "genus" },
    { key: "species", zh: "species", en: "species" },
  ];
  if (!props.open) return null;
  const stage = props.progress?.stage;
  const preparationTitle = stage === "writing_files"
    ? (zh ? "正在生成序列文件" : "Generating sequence files")
    : stage === "archiving"
      ? (zh ? "正在打包下载文件" : "Packaging download")
      : (zh ? "正在准备序列文件" : "Preparing sequence files");
  const preparationDetail = stage === "writing_files" && props.progress?.total_files
    ? (zh
        ? `已完成 ${props.progress.completed_files}/${props.progress.total_files} 个注释列`
        : `${props.progress.completed_files}/${props.progress.total_files} annotation columns complete`)
    : stage === "archiving"
      ? (zh ? "正在压缩已生成的 FASTA 文件" : "Compressing the generated FASTA files")
      : (zh ? "正在整理物种范围与注释数据" : "Resolving the species scope and annotation data");
  return (
    <div className="modal-overlay">
      <div className="modal-card download-dialog-card">
        <div className="modal-header">
          <h2>{zh ? "下载序列" : "Download Sequences"}</h2>
          <button type="button" className="icon-button modal-close" disabled={props.isPreparing} aria-label={zh ? "\u5173\u95ed\u4e0b\u8f7d\u5f39\u7a97" : "Close download dialog"} onClick={props.onCancel}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {props.isPreparing ? (
          <div className="download-dialog-preparing" role="status" aria-live="polite" aria-busy="true">
            <LoaderCircle className="download-dialog-spinner" size={24} aria-hidden="true" />
            <div>
              <strong>{preparationTitle}</strong>
              <span>{preparationDetail}</span>
            </div>
          </div>
        ) : (
          <>
            <label className="toggle-line">
              <span>{zh ? "仅下载代表序列" : "Representative sequences only"}</span>
              <button
                type="button"
                className="dp-instrument-switch"
                role="switch"
                aria-label={zh ? "仅下载代表序列" : "Representative sequences only"}
                aria-checked={props.mode === "representative"}
                onClick={() => props.onModeChange(props.mode === "representative" ? "all" : "representative")}
              >
                <span />
              </button>
            </label>
            <p className="muted">{zh ? "\u9009\u62e9 FASTA \u5934\u90e8\u9700\u8981\u663e\u793a\u7684\u4fe1\u606f\u3002\u82e5\u5168\u90e8\u53d6\u6d88\uff0c\u4e0b\u8f7d\u7ed3\u679c\u4f1a\u5199\u51fa\u7a7a\u5934\u90e8 `>`\u3002" : "Choose which fields appear in the FASTA header. If everything is cleared, the download will use a bare `>` header."}</p>
            <div className="candidate-list">
              {fields.map((field) => (
                <label key={field.key} className="toggle-line">
                  <span>{zh ? field.zh : field.en}</span>
                  <input
                    type="checkbox"
                    checked={props.selectedFields.includes(field.key)}
                    onChange={() => props.onToggleField(field.key)}
                  />
                </label>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="button subtle" onClick={props.onCancel}>{zh ? "\u53d6\u6d88" : "Cancel"}</button>
              <button type="button" className="button primary" onClick={props.onConfirm}>{zh ? "\u786e\u5b9a" : "Confirm"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
