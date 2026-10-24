import { ExternalLink, ListPlus, Minus, Plus, Trash2, X } from "lucide-react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Language } from "../../shared/types";
import type { AnnotationColumnSearchResult, ModuleQueryInfo, TreeNodeSearchItem } from "../../types";
import type { BranchPruneDraft, BranchPruneStatus } from "./branchPrune";
import { activeCircularTreeLayoutPreset, type CircularTreeLayoutPreset } from "./circularTreeLayoutPreset";
import type { TreeStyleKind, TreeStyleRecord } from "./treeStyleModel";
import { CIRCULAR_HEATMAP_SHAPES, DISPLAY_RANKS, RANKS, RECTANGULAR_HEATMAP_SHAPES } from "./resultConstants";
import { shapeLabel } from "./resultLabels";
import { colorScalesForStyle } from "./heatmapStyleModel";
import type { ColumnLabelPart, LocalRankRuleRow, DisplayColumn, HeatmapBorderMode, HeatmapMetric, HeatmapStyleRecord, PartitionShape, RatioDisplayMode, TreeViewMode, VisibleRow } from "./resultTypes";
import { normalizeColumnKey } from "./resultVisualUtils";
import type { TaxonDisplayStyle, TaxonNameDisplayMode } from "../workbench/workbenchAppearance";
import { InstrumentSelect, TreeCombobox } from "./resultScopeControls";

export { SelectedBranchesTable, TreeCombobox } from "./resultScopeControls";

function text(language: Language, zh: string, en: string) {
  return language === "zh" ? zh : en;
}

function HeatmapStylePreview(props: { style: HeatmapStyleRecord }) {
  const stops = colorScalesForStyle(props.style).count.stops;
  const color = stops[stops.length - 1]?.color ?? "#6A0624";
  const gradientId = `heatmap-style-preview-${props.style.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  if (props.style.shape === "fill") {
    return (
      <svg className="dp-style-preview-svg" viewBox="0 0 34 34" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" x2="1">
            {stops.map((stop, index) => <stop key={`${stop.color}-${index}`} offset={`${index / Math.max(1, stops.length - 1) * 100}%`} stopColor={stop.color} />)}
          </linearGradient>
        </defs>
        {props.style.treeViewMode === "rectangular" ? (
          <rect x="3" y="9" width="28" height="16" rx="0.75" fill={`url(#${gradientId})`} stroke="rgba(17,17,17,0.42)" strokeWidth="1.2" />
        ) : (
          <path d="M5.5 25.5 A15 15 0 0 1 28.5 6.5 L24 11 A8.5 8.5 0 0 0 11 22.5 Z" fill={`url(#${gradientId})`} stroke="rgba(17,17,17,0.42)" strokeWidth="1.2" strokeLinejoin="round" />
        )}
      </svg>
    );
  }
  return (
    <svg className="dp-style-preview-svg" viewBox="0 0 34 34" aria-hidden="true">
      {props.style.shape === "circle" ? <circle cx="17" cy="17" r="9.5" fill={color} stroke="rgba(17,17,17,0.35)" strokeWidth="1.4" /> : null}
      {props.style.shape === "square" ? <rect x="8" y="8" width="18" height="18" rx="0.75" fill={color} stroke="rgba(17,17,17,0.35)" strokeWidth="1.4" /> : null}
      {props.style.shape === "triangle" ? <path d="M17 6 L28 26 H6 Z" fill={color} stroke="rgba(17,17,17,0.35)" strokeWidth="1.4" /> : null}
    </svg>
  );
}

function InstrumentPanelShell(props: {
  title: string;
  details: Array<{ label: string; value: ReactNode }>;
  children: ReactNode;
}) {
  return (
    <div className="dp-instrument-panel">
      <header className="dp-instrument-hero">
        <h2>{props.title}</h2>
        <div className="dp-instrument-details">
          {props.details.map((detail) => (
            <div key={detail.label} className="dp-instrument-detail">
              <b>{detail.label}</b>
              <span>{detail.value}</span>
            </div>
          ))}
        </div>
      </header>
      {props.children}
    </div>
  );
}

function InstrumentSection(props: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  alwaysOpen?: boolean;
  titleMeta?: ReactNode;
  headerActions?: ReactNode;
  order?: number;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const expanded = props.alwaysOpen || open;
  return (
    <section className="dp-instrument-section" style={props.order === undefined ? undefined : { order: props.order }}>
      <div className="dp-instrument-section-head">
        {props.alwaysOpen ? (
          <div className="dp-instrument-section-toggle">
            <div className="dp-instrument-section-title">
              <h3>{props.title}</h3>
              {props.titleMeta ? <small>{props.titleMeta}</small> : null}
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="dp-instrument-section-toggle"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            <div className="dp-instrument-section-title">
              <h3>{props.title}</h3>
              {props.titleMeta ? <small>{props.titleMeta}</small> : null}
            </div>
            <span className="dp-instrument-section-state" aria-hidden="true">
              {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </span>
          </button>
        )}
        {props.headerActions ? <div className="dp-instrument-section-actions">{props.headerActions}</div> : null}
      </div>
      {expanded ? <div className="dp-instrument-section-body">{props.children}</div> : null}
    </section>
  );
}

function InstrumentSubsection(props: {
  title: string;
  note?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="dp-instrument-subsection">
      <div className="dp-instrument-subsection-head">
        <h4>{props.title}</h4>
        {props.note ? <p>{props.note}</p> : null}
        {props.actions ? <div className="dp-instrument-subsection-actions">{props.actions}</div> : null}
      </div>
      <div className="dp-instrument-subsection-body">{props.children}</div>
    </div>
  );
}

function InstrumentRow(props: {
  label: string;
  hint?: ReactNode;
  layout?: "inline" | "stacked";
  children: ReactNode;
}) {
  return (
    <div className={`dp-instrument-row${props.layout === "stacked" ? " stacked" : ""}`}>
      <div className="dp-instrument-row-copy">
        <span>{props.label}</span>
        {props.hint ? <em>{props.hint}</em> : null}
      </div>
      <div className="dp-instrument-row-control">{props.children}</div>
    </div>
  );
}

function InstrumentSwitch(props: {
  checked: boolean;
  ariaLabel?: string;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="dp-instrument-switch"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.ariaLabel}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
    >
      <span />
    </button>
  );
}

function InstrumentSegmented<T extends string>(props: {
  value: T;
  options: Array<{ value: T; label: string }>;
  ariaLabel: string;
  onChange: (value: T) => void;
}) {
  return (
    <div className="dp-instrument-segmented" role="tablist" aria-label={props.ariaLabel}>
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={props.value === option.value}
          className={props.value === option.value ? "active" : ""}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function InstrumentNumber(props: {
  value: string | number;
  min?: string;
  max?: string;
  step?: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(String(props.value));
  const focusedRef = useRef(false);

  // Keep the input stable while the user is replacing its contents. A
  // controlled numeric value is rewritten by the parent on every keystroke,
  // which moves the caret and makes select-all edits appear to "jump".
  useEffect(() => {
    if (!focusedRef.current) setDraft(String(props.value));
  }, [props.value]);

  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(parsed)) {
      setDraft(String(props.value));
      return;
    }
    props.onChange(draft);
  };

  return (
    <input
      className="dp-instrument-number"
      type="number"
      min={props.min}
      max={props.max}
      step={props.step}
      value={draft}
      placeholder={props.placeholder}
      disabled={props.disabled}
      onFocus={() => { focusedRef.current = true; }}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        // Propagate complete numeric edits immediately, while allowing an
        // empty/intermediate value during select-all replacement.
        if (next.trim() !== "" && Number.isFinite(Number(next))) props.onChange(next);
      }}
      onBlur={() => {
        focusedRef.current = false;
        commit();
        // Restore the parent value if it rejected or clamped this edit.
        setDraft(String(props.value));
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function InstrumentSliderNumber(props: {
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="dp-instrument-slider">
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
      <input
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </div>
  );
}

function InstrumentButton(props: {
  children: ReactNode;
  variant?: "primary" | "danger" | "default";
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`dp-instrument-button${props.variant === "primary" ? " primary" : ""}${props.variant === "danger" ? " danger" : ""}`}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function InstrumentActions(props: { children: ReactNode }) {
  return <div className="dp-instrument-actions">{props.children}</div>;
}

function InstrumentNote(props: {
  children: ReactNode;
  tone?: "muted" | "ready" | "error";
}) {
  return <p className={`dp-instrument-note ${props.tone ?? "muted"}`}>{props.children}</p>;
}

function InstrumentStatusRow(props: { label: string; value: ReactNode }) {
  return (
    <div className="dp-instrument-status-row">
      <b>{props.label}</b>
      <span>{props.value}</span>
    </div>
  );
}

function LocalRankRuleRow(props: {
  language: Language;
  rule: LocalRankRuleRow;
  rankOptions: Array<{ value: string; label: string }>;
  onRankChange: (value: string) => void;
  onEnabledChange: (value: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <tr>
      <td className="dp-cart-record-name">
        <b title={props.rule.path}>{props.rule.taxonName}</b>
        <em>{props.rule.path}</em>
      </td>
      <td className="dp-cart-record-rank">
        <InstrumentSelect value={props.rule.rank} options={props.rankOptions} onChange={props.onRankChange} />
      </td>
      <td className="dp-detail-rank-switch">
        <InstrumentSwitch checked={props.rule.enabled} onChange={props.onEnabledChange} />
      </td>
      <td className="dp-table-delete-cell">
        <button type="button" className="icon-button" aria-label={text(props.language, "删除局部层级", "Delete detail rank")} onClick={props.onDelete}><Trash2 size={15} aria-hidden="true" /></button>
      </td>
    </tr>
  );
}

function PillButtons<T extends string>(props: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="dp-instrument-pill-group">
      {props.options.map((option) => (
        <button key={option.value} type="button" className={props.value === option.value ? "active" : ""} onClick={() => props.onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}


function DenseHint(props: { language: Language; active: boolean }) {
  if (!props.active) return null;
  return <>{text(props.language, "自动隐藏", "Auto hidden")}</>;
}

export function TaxonAnnotationFontControl(props: {
  language: Language;
  mode: TaxonNameDisplayMode;
  embeddedFontSize: number;
  embeddedFontSizeMax: number;
  legendFontSize: number;
  onEmbeddedFontSizeChange: (value: number) => void;
  onLegendFontSizeChange: (value: number) => void;
}) {
  return props.mode === "embedded" ? (
    <InstrumentRow label={text(props.language, "分类注释字号", "Taxonomic Annotation Size")}>
      <InstrumentNumber value={props.embeddedFontSize} min="1" max={String(props.embeddedFontSizeMax)} step="1" onChange={(value) => props.onEmbeddedFontSizeChange(Number(value))} />
    </InstrumentRow>
  ) : (
    <InstrumentRow label={text(props.language, "图注字号", "Legend Font Size")}>
      <InstrumentNumber value={props.legendFontSize} min="1" step="1" onChange={(value) => props.onLegendFontSizeChange(Number(value))} />
    </InstrumentRow>
  );
}

export function HeatmapLegendFontControl(props: {
  language: Language;
  visible: boolean;
  fontSize: number;
  onFontSizeChange: (value: number) => void;
}) {
  if (!props.visible) return null;
  return (
    <InstrumentRow label={text(props.language, "图注字号", "Legend Font Size")}>
      <InstrumentNumber value={props.fontSize} min="1" step="1" onChange={(value) => props.onFontSizeChange(Number(value))} />
    </InstrumentRow>
  );
}

export function ModuleNameFontControl(props: {
  language: Language;
  visible: boolean;
  fontSize: number;
  onFontSizeChange: (value: number) => void;
}) {
  if (!props.visible) return null;
  return (
    <InstrumentRow label={text(props.language, "Module 名称字号", "Module Name Font Size")}>
      <InstrumentNumber value={props.fontSize} min="1" step="1" onChange={(value) => props.onFontSizeChange(Number(value))} />
    </InstrumentRow>
  );
}

export function TreePanel(props: {
  language: Language;
  resultSession: AnnotationColumnSearchResult;
  treeViewMode: TreeViewMode;
  displayRank: string;
  stripRank: string;
  showStrip: boolean;
  taxonDisplayStyle: TaxonDisplayStyle;
  taxonNameDisplayMode: TaxonNameDisplayMode;
  stripColumnWidth: number;
  stripColumnWidthMax: number;
  branchScale: number;
  spacingScale: number;
  stripMinimumLeafCount: number;
  showSpeciesCount: boolean;
  showBranchLabels: boolean;
  effectiveShowBranchLabels: boolean;
  effectiveShowSpeciesCount: boolean;
  branchLabelDense: boolean;
  speciesCountDense: boolean;
  branchStrokeWidth: number;
  branchLabelFontSize: number;
  branchLabelFontSizeMax: number;
  branchLengthFontSize: number;
  branchLengthFontSizeMax: number;
  speciesCountFontSize: number;
  speciesCountFontSizeMax: number;
  stripNameFontSize: number;
  stripNameFontSizeMax: number;
  taxonLegendFontSize: number;
  showInternalNodes: boolean;
  showBranchGuides: boolean;
  showBranchLengths: boolean;
  circularArcDegrees: number;
  circularRotationDegrees: number;
  detailRankSearch: string;
  detailRankSearchRank: string;
  detailRankPickedItem: TreeNodeSearchItem | null;
  detailRankResults: TreeNodeSearchItem[];
  detailRankTargetRank: string;
  localRankRules: LocalRankRuleRow[];
  detailRankAddOpen: boolean;
  visibleRows: VisibleRow[];
  branchCount: number;
  stripGroupCount: number;
  treeStyles: TreeStyleRecord[];
  branchPrune: {
    draft: BranchPruneDraft;
    active: boolean;
    status: BranchPruneStatus;
    feedback: { tone: "ready" | "error"; text: string } | null;
    currentScopeLeafCount: number;
    previewSourceCount: number;
  };
  onTreeViewModeChange: (value: TreeViewMode) => void;
  onDisplayRankChange: (value: string) => void;
  onStripRankChange: (value: string) => void;
  onShowStripChange: (value: boolean) => void;
  onTaxonDisplayStyleChange: (value: TaxonDisplayStyle) => void;
  onTaxonNameDisplayModeChange: (value: TaxonNameDisplayMode) => void;
  onStripColumnWidthChange: (value: number) => void;
  onBranchScaleChange: (value: number) => void;
  onSpacingScaleChange: (value: number) => void;
  onStripMinimumLeafCountChange: (value: number) => void;
  onShowSpeciesCountChange: (value: boolean) => void;
  onShowBranchLabelsChange: (value: boolean) => void;
  onBranchStrokeWidthChange: (value: number) => void;
  onBranchLabelFontSizeChange: (value: number) => void;
  onBranchLengthFontSizeChange: (value: number) => void;
  onSpeciesCountFontSizeChange: (value: number) => void;
  onStripNameFontSizeChange: (value: number) => void;
  onTaxonLegendFontSizeChange: (value: number) => void;
  onShowInternalNodesChange: (value: boolean) => void;
  onShowBranchGuidesChange: (value: boolean) => void;
  onShowBranchLengthsChange: (value: boolean) => void;
  onCircularArcDegreesChange: (value: number) => void;
  onCircularRotationDegreesChange: (value: number) => void;
  onCircularTreeLayoutPresetChange: (value: CircularTreeLayoutPreset) => void;
  onDetailRankSearchChange: (value: string) => void;
  onDetailRankSearchRankChange: (value: string) => void;
  onPickDetailRankItem: (item: TreeNodeSearchItem) => void;
  onDetailRankTargetRankChange: (value: string) => void;
  onToggleDetailRankAdd: () => void;
  onConfirmDetailRankRule: () => void;
  onDetailRankRuleRankChange: (taxonRank: string, taxonName: string, value: string) => void;
  onDetailRankRuleEnabledChange: (taxonRank: string, taxonName: string, value: boolean) => void;
  onRemoveDetailRankRule: (taxonRank: string, taxonName: string) => void;
  onApplyDetailRankRules: () => void;
  onClearDetailRankRules: () => void;
  onBranchPruneDraftChange: (patch: Partial<BranchPruneDraft>) => void;
  onPreviewBranchPrune: () => void;
  onApplyBranchPrune: () => void;
  onTreeStyleChange: (styleId: string, patch: Partial<Pick<TreeStyleRecord, "kind" | "name">>) => void;
  onTreeStyleColorCommit: (styleId: string, color: string) => boolean;
  onRemoveTreeStyle: (styleId: string) => void;
  onResetTreeStyles: () => void;
}) {
  const stripOptions = RANKS;
  const displayRankOptions = DISPLAY_RANKS.map((rank) => ({ value: rank, label: rank }));
  const treeViewModeOptions: Array<{ value: TreeViewMode; label: string }> = [
    { value: "rectangular", label: text(props.language, "矩形", "Rectangular") },
    { value: "circular", label: text(props.language, "环形", "Circular") },
  ];
  const renderLocalDisplayRankRules = () => (
    <InstrumentSubsection title={text(props.language, "局部展示层级", "Local Display Rank")}>
      {props.localRankRules.length ? (
        <div className="dp-cart-record-table-wrap dp-detail-rank-table-wrap">
          <table className="dp-cart-record-table dp-detail-rank-table">
            <thead><tr><th>{text(props.language, "分类单元", "Taxon")}</th><th>rank</th><th>switch</th><th>{text(props.language, "删除", "Delete")}</th></tr></thead>
            <tbody>
              {props.localRankRules.map((rule) => (
                <LocalRankRuleRow
                  key={`${rule.taxonRank}\u0000${rule.taxonName.trim().toLowerCase()}`}
                  language={props.language}
                  rule={rule}
                  rankOptions={displayRankOptions}
                  onRankChange={(value) => props.onDetailRankRuleRankChange(rule.taxonRank, rule.taxonName, value)}
                  onEnabledChange={(value) => props.onDetailRankRuleEnabledChange(rule.taxonRank, rule.taxonName, value)}
                  onDelete={() => props.onRemoveDetailRankRule(rule.taxonRank, rule.taxonName)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {props.detailRankAddOpen ? (
        <div className="dp-detail-rank-add-row">
          <TreeCombobox language={props.language} rank={props.detailRankSearchRank} query={props.detailRankSearch} placeholder={text(props.language, "在当前 alive 范围中搜索内部节点", "Search an internal node in the alive scope")} suggestions={props.detailRankResults} pickedItem={props.detailRankPickedItem} showSearchButton={false} onRankChange={props.onDetailRankSearchRankChange} onQueryChange={props.onDetailRankSearchChange} onPick={props.onPickDetailRankItem} onSearch={props.onConfirmDetailRankRule} />
          <InstrumentSelect value={props.detailRankTargetRank} options={displayRankOptions} onChange={props.onDetailRankTargetRankChange} />
          <InstrumentButton variant="primary" disabled={!props.detailRankResults.length && !props.detailRankPickedItem} onClick={props.onConfirmDetailRankRule}>{text(props.language, "确认", "Confirm")}</InstrumentButton>
        </div>
      ) : null}
      <div className="dp-query-add-row dp-instrument-query-add-row">
        <button type="button" aria-label={props.detailRankAddOpen ? text(props.language, "取消添加详细分类", "Cancel adding detail rank") : text(props.language, "添加详细分类", "Add detail rank")} onClick={props.onToggleDetailRankAdd}>
          {props.detailRankAddOpen ? <X size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
        </button>
      </div>
      <InstrumentActions>
        <InstrumentButton variant="primary" disabled={!props.localRankRules.length} onClick={props.onApplyDetailRankRules}>{text(props.language, "全部应用", "Apply All")}</InstrumentButton>
        <InstrumentButton variant="danger" disabled={!props.localRankRules.length} onClick={props.onClearDetailRankRules}>{text(props.language, "全部删除", "Delete All")}</InstrumentButton>
      </InstrumentActions>
    </InstrumentSubsection>
  );
  return (
    <InstrumentPanelShell
      title={text(props.language, "物种树", "Species Tree")}
      details={[
        { label: text(props.language, "分支", "Branches"), value: props.branchCount },
        { label: text(props.language, "分类注释层级", "Annotation Rank"), value: `${props.stripRank} / ${props.stripGroupCount} ${text(props.language, "组", "groups")}` },
      ]}
    >
      {false ? (<>
      <InstrumentSection title={text(props.language, "常用操作", "Common Operations")} alwaysOpen>
        <InstrumentRow label={text(props.language, "显示分类单元标签", "Show Taxon Labels")} hint={<DenseHint language={props.language} active={props.branchLabelDense} />}>
          <InstrumentSwitch checked={props.effectiveShowBranchLabels} onChange={props.onShowBranchLabelsChange} />
        </InstrumentRow>
        <InstrumentRow label={text(props.language, "分支长度缩放", "Branch Length Scale")}>
          <InstrumentSliderNumber value={props.branchScale} min={10} max={40} step={0.1} onChange={props.onBranchScaleChange} />
        </InstrumentRow>
        {props.treeViewMode === "rectangular" ? (
          <InstrumentRow label={text(props.language, "垂直间距", "Vertical Spacing")}>
            <InstrumentSliderNumber value={props.spacingScale} min={1} max={10} step={0.1} onChange={props.onSpacingScaleChange} />
          </InstrumentRow>
        ) : null}
        {props.treeViewMode === "circular" ? (
          <InstrumentRow label={text(props.language, "环形起始角", "Circular Start Angle")}>
            <InstrumentSliderNumber value={props.circularRotationDegrees} min={0} max={359} step={1} onChange={props.onCircularRotationDegreesChange} />
          </InstrumentRow>
        ) : null}
        <InstrumentRow label={text(props.language, "展示层级", "Display Rank")}>
          <InstrumentSelect value={props.displayRank} options={displayRankOptions} onChange={props.onDisplayRankChange} />
        </InstrumentRow>
        <InstrumentSubsection title={text(props.language, "局部展示层级", "Local Display Rank")}>
          {props.localRankRules.length ? (
            <div className="dp-cart-record-table-wrap dp-detail-rank-table-wrap">
              <table className="dp-cart-record-table dp-detail-rank-table">
                <thead>
                  <tr>
                    <th>{text(props.language, "分类单元", "Taxon")}</th>
                    <th>rank</th>
                    <th>switch</th>
                    <th>{text(props.language, "删除", "Delete")}</th>
                  </tr>
                </thead>
                <tbody>
                  {props.localRankRules.map((rule) => (
                    <LocalRankRuleRow
                      key={`${rule.taxonRank}\u0000${rule.taxonName.trim().toLowerCase()}`}
                      language={props.language}
                      rule={rule}
                      rankOptions={displayRankOptions}
                      onRankChange={(value) => props.onDetailRankRuleRankChange(rule.taxonRank, rule.taxonName, value)}
                      onEnabledChange={(value) => props.onDetailRankRuleEnabledChange(rule.taxonRank, rule.taxonName, value)}
                      onDelete={() => props.onRemoveDetailRankRule(rule.taxonRank, rule.taxonName)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {props.detailRankAddOpen ? (
            <div className="dp-detail-rank-add-row">
              <TreeCombobox
                language={props.language}
                rank={props.detailRankSearchRank}
                query={props.detailRankSearch}
                placeholder={text(props.language, "在当前 alive 范围中搜索内部节点", "Search an internal node in the alive scope")}
                suggestions={props.detailRankResults}
                pickedItem={props.detailRankPickedItem}
                showSearchButton={false}
                onRankChange={props.onDetailRankSearchRankChange}
                onQueryChange={props.onDetailRankSearchChange}
                onPick={props.onPickDetailRankItem}
                onSearch={props.onConfirmDetailRankRule}
              />
              <InstrumentSelect value={props.detailRankTargetRank} options={displayRankOptions} onChange={props.onDetailRankTargetRankChange} />
              <InstrumentButton variant="primary" disabled={!props.detailRankResults.length && !props.detailRankPickedItem} onClick={props.onConfirmDetailRankRule}>
                {text(props.language, "确认", "Confirm")}
              </InstrumentButton>
            </div>
          ) : null}
          <div className="dp-query-add-row dp-instrument-query-add-row">
            <button type="button" aria-label={props.detailRankAddOpen ? text(props.language, "取消添加详细分级", "Cancel adding detail rank") : text(props.language, "添加详细分级", "Add detail rank")} onClick={props.onToggleDetailRankAdd}>
              {props.detailRankAddOpen ? <X size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
            </button>
          </div>
          <InstrumentActions>
            <InstrumentButton variant="primary" disabled={!props.localRankRules.length} onClick={props.onApplyDetailRankRules}>
              {text(props.language, "全部应用", "Apply All")}
            </InstrumentButton>
            <InstrumentButton variant="danger" disabled={!props.localRankRules.length} onClick={props.onClearDetailRankRules}>
              {text(props.language, "全部删除", "Delete All")}
            </InstrumentButton>
          </InstrumentActions>
        </InstrumentSubsection>
        <InstrumentRow label={text(props.language, "分类注释层级", "Taxonomic Annotation Rank")}>
          <InstrumentSelect
            value={props.stripRank}
            options={stripOptions.map((rank) => ({ value: rank, label: rank }))}
            onChange={props.onStripRankChange}
          />
        </InstrumentRow>
      </InstrumentSection>

      <InstrumentSection title={text(props.language, "显示", "Display")}>
        <InstrumentSubsection title={text(props.language, "树", "Tree")}>
          <InstrumentRow label={text(props.language, "分支名字号", "Branch Name Size")}>
            <InstrumentNumber value={props.branchLabelFontSize} min="1" max={String(props.branchLabelFontSizeMax)} step="1" onChange={(value) => props.onBranchLabelFontSizeChange(Number(value))} />
          </InstrumentRow>
          <InstrumentRow label={text(props.language, "分支线宽", "Branch Line Width")}>
            <InstrumentNumber value={props.branchStrokeWidth} min="0.1" step="0.1" onChange={(value) => props.onBranchStrokeWidthChange(Number(value))} />
          </InstrumentRow>
          <InstrumentRow label={text(props.language, "显示内部节点", "Show Internal Nodes")}>
            <InstrumentSwitch checked={props.showInternalNodes} onChange={props.onShowInternalNodesChange} />
          </InstrumentRow>
          <InstrumentRow label={text(props.language, "显示分支引导线", "Show Branch Guides")}>
            <InstrumentSwitch checked={props.showBranchGuides} onChange={props.onShowBranchGuidesChange} />
          </InstrumentRow>
          <InstrumentRow label={text(props.language, "显示分支长度", "Show Branch Lengths")}>
            <InstrumentSwitch checked={props.showBranchLengths} onChange={props.onShowBranchLengthsChange} />
          </InstrumentRow>
          <InstrumentRow label={text(props.language, "分支长度字号", "Branch Length Size")}>
            <InstrumentNumber value={props.branchLengthFontSize} min="1" max={String(props.branchLengthFontSizeMax)} step="1" onChange={(value) => props.onBranchLengthFontSizeChange(Number(value))} />
          </InstrumentRow>
          {props.treeViewMode === "circular" ? (
            <InstrumentRow label={text(props.language, "环形跨度（°）", "Angular Span (°)")}>
              <InstrumentSliderNumber value={props.circularArcDegrees} min={180} max={360} step={5} onChange={props.onCircularArcDegreesChange} />
            </InstrumentRow>
          ) : null}
          {props.treeViewMode === "circular" ? (
            <InstrumentRow label={text(props.language, "环形树布局", "Circular Tree Layout")}>
              <InstrumentSelect
                value={activeCircularTreeLayoutPreset(props.circularArcDegrees, props.circularRotationDegrees) ?? "custom"}
                fallbackLabel={text(props.language, "自定义", "Custom")}
                options={[
                  { value: "three-quarter", label: text(props.language, "3/4 圆", "Three-quarter Circle") },
                  { value: "full", label: text(props.language, "整圆", "Full Circle") },
                  { value: "upper-half", label: text(props.language, "上半圆", "Upper Semicircle") },
                ]}
                onChange={(value) => props.onCircularTreeLayoutPresetChange(value as CircularTreeLayoutPreset)}
              />
            </InstrumentRow>
          ) : null}
        </InstrumentSubsection>
        <InstrumentSubsection title={text(props.language, "分类注释", "Taxonomic Annotation")}>
          <InstrumentRow label={text(props.language, "显示分类注释", "Show Taxonomic Annotation")}>
            <InstrumentSwitch checked={props.showStrip} onChange={props.onShowStripChange} />
          </InstrumentRow>
          {props.showStrip ? (
            <>
              <InstrumentRow label={text(props.language, "展示样式", "Display Style")}>
                <InstrumentSegmented
                  value={props.taxonDisplayStyle}
                  options={[
                    { value: "strip", label: text(props.language, "条带", "Strip") },
                    { value: "background", label: "Background" },
                  ]}
                  ariaLabel={text(props.language, "分类注释展示样式", "Taxonomic annotation display style")}
                  onChange={props.onTaxonDisplayStyleChange}
                />
              </InstrumentRow>
              <InstrumentRow label={text(props.language, "分类单元标签位置", "Taxon Label Placement")}>
                <InstrumentSegmented
                  value={props.taxonNameDisplayMode}
                  options={[
                    { value: "embedded", label: text(props.language, "内嵌", "Embedded") },
                    { value: "annotation", label: text(props.language, "图注", "Annotation") },
                  ]}
                  ariaLabel={text(props.language, "分类单元标签位置", "Taxon label placement")}
                  onChange={props.onTaxonNameDisplayModeChange}
                />
              </InstrumentRow>
              {props.taxonDisplayStyle === "strip" ? (
                <InstrumentRow label={props.treeViewMode === "rectangular" ? text(props.language, "分类条带宽度", "Taxonomic Band Width") : text(props.language, "分类环带宽度", "Taxonomic Ring Width")}>
                  <InstrumentNumber value={props.stripColumnWidth} min={props.treeViewMode === "rectangular" ? "8" : "4"} max={String(props.stripColumnWidthMax)} step="1" onChange={(value) => props.onStripColumnWidthChange(Number(value))} />
                </InstrumentRow>
              ) : null}
              <InstrumentRow label={text(props.language, "每组最小终端数", "Minimum Terminals per Group")}>
                <InstrumentNumber
                  value={props.stripMinimumLeafCount}
                  min="0"
                  step="1"
                  onChange={(value) => props.onStripMinimumLeafCountChange(Number(value))}
                />
              </InstrumentRow>
              <TaxonAnnotationFontControl language={props.language} mode={props.taxonNameDisplayMode} embeddedFontSize={props.stripNameFontSize} embeddedFontSizeMax={props.stripNameFontSizeMax} legendFontSize={props.taxonLegendFontSize} onEmbeddedFontSizeChange={props.onStripNameFontSizeChange} onLegendFontSizeChange={props.onTaxonLegendFontSizeChange} />
            </>
          ) : null}
        </InstrumentSubsection>

        <InstrumentSubsection title={text(props.language, "后代末端数", "Descendant Tip Count")}>
          <InstrumentRow label={text(props.language, "显示后代末端数", "Show Descendant Tip Count")} hint={<DenseHint language={props.language} active={props.speciesCountDense} />}>
            <InstrumentSwitch checked={props.effectiveShowSpeciesCount} onChange={props.onShowSpeciesCountChange} />
          </InstrumentRow>
          {props.showSpeciesCount ? (
            <InstrumentRow label={text(props.language, "后代末端数字号", "Descendant Tip Count Size")}>
              <InstrumentNumber value={props.speciesCountFontSize} min="1" max={String(props.speciesCountFontSizeMax)} step="1" onChange={(value) => props.onSpeciesCountFontSizeChange(Number(value))} />
            </InstrumentRow>
          ) : null}
        </InstrumentSubsection>

      </InstrumentSection>

      </>) : null}

      <InstrumentSection title={text(props.language, "常用功能", "Common Features")} alwaysOpen>
        <InstrumentRow label={text(props.language, "树布局", "Tree Layout")}>
          <InstrumentSegmented ariaLabel={text(props.language, "树布局", "Tree Layout")} value={props.treeViewMode} options={treeViewModeOptions} onChange={props.onTreeViewModeChange} />
        </InstrumentRow>
        <InstrumentRow label={text(props.language, "展示层级", "Display Rank")}>
          <InstrumentSelect value={props.displayRank} options={displayRankOptions} onChange={props.onDisplayRankChange} />
        </InstrumentRow>
        <InstrumentRow label={text(props.language, "分类注释层级", "Taxonomic Annotation Rank")}>
          <InstrumentSelect value={props.stripRank} options={stripOptions.map((rank) => ({ value: rank, label: rank }))} onChange={props.onStripRankChange} />
        </InstrumentRow>
        {renderLocalDisplayRankRules()}
      </InstrumentSection>

      <InstrumentSection title={text(props.language, "布局", "Layout")} order={4}>
        <InstrumentRow label={text(props.language, "树布局", "Tree Layout")}>
          <InstrumentSegmented ariaLabel={text(props.language, "树布局", "Tree Layout")} value={props.treeViewMode} options={treeViewModeOptions} onChange={props.onTreeViewModeChange} />
        </InstrumentRow>
        <InstrumentRow label={text(props.language, "分支长度缩放", "Branch Length Scale")}>
          <InstrumentSliderNumber value={props.branchScale} min={10} max={40} step={0.1} onChange={props.onBranchScaleChange} />
        </InstrumentRow>
        {props.treeViewMode === "rectangular" ? (
          <InstrumentRow label={text(props.language, "垂直间距", "Vertical Spacing")}>
            <InstrumentSliderNumber value={props.spacingScale} min={1} max={10} step={0.1} onChange={props.onSpacingScaleChange} />
          </InstrumentRow>
        ) : null}
        {props.treeViewMode === "circular" ? (
          <>
            <InstrumentRow label={text(props.language, "布局预设", "Layout Preset")}>
              <InstrumentSelect
                value={activeCircularTreeLayoutPreset(props.circularArcDegrees, props.circularRotationDegrees) ?? "custom"}
                fallbackLabel={text(props.language, "自定义", "Custom")}
                options={[
                  { value: "three-quarter", label: text(props.language, "3/4 圆", "Three-quarter Circle") },
                  { value: "full", label: text(props.language, "整圆", "Full Circle") },
                  { value: "upper-half", label: text(props.language, "上半圆", "Upper Semicircle") },
                ]}
                onChange={(value) => props.onCircularTreeLayoutPresetChange(value as CircularTreeLayoutPreset)}
              />
            </InstrumentRow>
            <InstrumentRow label={text(props.language, "环形起始角", "Circular Start Angle")}>
              <InstrumentSliderNumber value={props.circularRotationDegrees} min={0} max={359} step={1} onChange={props.onCircularRotationDegreesChange} />
            </InstrumentRow>
            <InstrumentRow label={text(props.language, "环形跨度（°）", "Angular Span (°)")}>
              <InstrumentSliderNumber value={props.circularArcDegrees} min={180} max={360} step={5} onChange={props.onCircularArcDegreesChange} />
            </InstrumentRow>
          </>
        ) : null}
      </InstrumentSection>

      <InstrumentSection title={text(props.language, "显示", "Display")} order={5}>
        <InstrumentRow label={text(props.language, "显示分类单元标签", "Show Taxon Labels")} hint={<DenseHint language={props.language} active={props.branchLabelDense} />}>
          <InstrumentSwitch checked={props.effectiveShowBranchLabels} onChange={props.onShowBranchLabelsChange} />
        </InstrumentRow>
        <InstrumentRow label={text(props.language, "分支名字号", "Branch Name Size")}>
          <InstrumentNumber value={props.branchLabelFontSize} min="1" max={String(props.branchLabelFontSizeMax)} step="1" onChange={(value) => props.onBranchLabelFontSizeChange(Number(value))} />
        </InstrumentRow>
        <InstrumentRow label={text(props.language, "分支线宽", "Branch Line Width")}>
          <InstrumentNumber value={props.branchStrokeWidth} min="0.1" step="0.1" onChange={(value) => props.onBranchStrokeWidthChange(Number(value))} />
        </InstrumentRow>
        <InstrumentRow label={text(props.language, "显示内部节点", "Show Internal Nodes")}>
          <InstrumentSwitch checked={props.showInternalNodes} onChange={props.onShowInternalNodesChange} />
        </InstrumentRow>
        <InstrumentRow label={text(props.language, "显示分支引导线", "Show Branch Guides")}>
          <InstrumentSwitch checked={props.showBranchGuides} onChange={props.onShowBranchGuidesChange} />
        </InstrumentRow>
        <InstrumentRow label={text(props.language, "显示分支长度", "Show Branch Lengths")}>
          <InstrumentSwitch checked={props.showBranchLengths} onChange={props.onShowBranchLengthsChange} />
        </InstrumentRow>
        <InstrumentRow label={text(props.language, "分支长度字号", "Branch Length Size")}>
          <InstrumentNumber value={props.branchLengthFontSize} min="1" max={String(props.branchLengthFontSizeMax)} step="1" onChange={(value) => props.onBranchLengthFontSizeChange(Number(value))} />
        </InstrumentRow>
      </InstrumentSection>

      <InstrumentSection title={text(props.language, "分类注释", "Taxonomic Annotation")} order={2}>
        <InstrumentRow label={text(props.language, "显示分类注释", "Show Taxonomic Annotation")}>
          <InstrumentSwitch checked={props.showStrip} onChange={props.onShowStripChange} />
        </InstrumentRow>
        {props.showStrip ? (
          <>
            <InstrumentRow label={text(props.language, "展示样式", "Display Style")}>
              <InstrumentSegmented value={props.taxonDisplayStyle} options={[{ value: "strip", label: text(props.language, "条带", "Strip") }, { value: "background", label: "Background" }]} ariaLabel={text(props.language, "分类注释展示样式", "Taxonomic annotation display style")} onChange={props.onTaxonDisplayStyleChange} />
            </InstrumentRow>
            <InstrumentRow label={text(props.language, "分类单元标签位置", "Taxon Label Placement")}>
              <InstrumentSegmented value={props.taxonNameDisplayMode} options={[{ value: "embedded", label: text(props.language, "内嵌", "Embedded") }, { value: "annotation", label: text(props.language, "图注", "Annotation") }]} ariaLabel={text(props.language, "分类单元标签位置", "Taxon label placement")} onChange={props.onTaxonNameDisplayModeChange} />
            </InstrumentRow>
            {props.taxonDisplayStyle === "strip" ? (
              <InstrumentRow label={props.treeViewMode === "rectangular" ? text(props.language, "分类条带宽度", "Taxonomic Band Width") : text(props.language, "分类环带宽度", "Taxonomic Ring Width")}>
                <InstrumentNumber value={props.stripColumnWidth} min={props.treeViewMode === "rectangular" ? "8" : "4"} max={String(props.stripColumnWidthMax)} step="1" onChange={(value) => props.onStripColumnWidthChange(Number(value))} />
              </InstrumentRow>
            ) : null}
            <InstrumentRow label={text(props.language, "每组最少终端数", "Minimum Terminals per Group")}>
              <InstrumentNumber value={props.stripMinimumLeafCount} min="0" step="1" onChange={(value) => props.onStripMinimumLeafCountChange(Number(value))} />
            </InstrumentRow>
            <TaxonAnnotationFontControl language={props.language} mode={props.taxonNameDisplayMode} embeddedFontSize={props.stripNameFontSize} embeddedFontSizeMax={props.stripNameFontSizeMax} legendFontSize={props.taxonLegendFontSize} onEmbeddedFontSizeChange={props.onStripNameFontSizeChange} onLegendFontSizeChange={props.onTaxonLegendFontSizeChange} />
          </>
        ) : null}
      </InstrumentSection>

      <InstrumentSection title={text(props.language, "后代末端数", "Descendant Tip Count")} order={6}>
        <InstrumentRow label={text(props.language, "显示后代末端数", "Show Descendant Tip Count")} hint={<DenseHint language={props.language} active={props.speciesCountDense} />}>
          <InstrumentSwitch checked={props.effectiveShowSpeciesCount} onChange={props.onShowSpeciesCountChange} />
        </InstrumentRow>
        {props.showSpeciesCount ? (
          <InstrumentRow label={text(props.language, "后代末端数字号", "Descendant Tip Count Size")}>
            <InstrumentNumber value={props.speciesCountFontSize} min="1" max={String(props.speciesCountFontSizeMax)} step="1" onChange={(value) => props.onSpeciesCountFontSizeChange(Number(value))} />
          </InstrumentRow>
        ) : null}
      </InstrumentSection>

      <InstrumentSection
        title={text(props.language, "样式", "Styles")}
        order={7}
        headerActions={<InstrumentButton disabled={!props.treeStyles.length} onClick={props.onResetTreeStyles}>{text(props.language, "恢复默认样式", "Restore Default Styles")}</InstrumentButton>}
      >
        {props.treeStyles.length ? (
          <div className="dp-cart-record-table-wrap tree-style-table-wrap">
            <table className="dp-cart-record-table tree-style-table">
              <thead>
                <tr>
                  <th>{text(props.language, "样式", "Style")}</th>
                  <th>{text(props.language, "颜色", "Color")}</th>
                  <th>name</th>
                  <th>{text(props.language, "删除", "Delete")}</th>
                </tr>
              </thead>
              <tbody>
                {props.treeStyles.map((style) => (
                  <tr key={style.id}>
                    <td>
                      <div className="tree-style-kind-cell">
                        <InstrumentSelect
                          value={style.kind}
                          options={[
                            { value: "label", label: "Label" },
                            { value: "branch", label: "branch" },
                            { value: "background", label: "background" },
                            { value: "strip", label: "strip" },
                          ]}
                          onChange={(value) => props.onTreeStyleChange(style.id, { kind: value as TreeStyleKind })}
                        />
                      </div>
                    </td>
                    <td>
                      <div className="tree-style-color-cell">
                        <input type="color" value={style.color} aria-label={text(props.language, "选择颜色", "Choose color")} onChange={(event) => props.onTreeStyleColorCommit(style.id, event.target.value)} />
                      </div>
                    </td>
                    <td><input className="dp-style-name-input" value={style.name} onChange={(event) => props.onTreeStyleChange(style.id, { name: event.target.value })} /></td>
                    <td className="dp-table-delete-cell"><button type="button" className="icon-button" aria-label={text(props.language, "删除样式", "Delete style")} onClick={() => props.onRemoveTreeStyle(style.id)}><Trash2 size={15} aria-hidden="true" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <InstrumentNote>{text(props.language, "尚未添加物种树颜色样式。", "No species-tree color styles have been added.")}</InstrumentNote>}
      </InstrumentSection>

      <InstrumentSection title={text(props.language, "树筛选与修剪", "Tree Filtering and Pruning")} order={3}>
        <InstrumentNote>
          {text(props.language, "可以根据以下条件来对当前视图中物种树的分支进行批量剪枝。多个条件下求并集，预览可以高亮显示条件下会被减除的分支", "Use the conditions below to batch-prune branches in the current tree view. Multiple conditions are combined as a union, and preview highlights the branches that would be pruned.")}
        </InstrumentNote>
        <InstrumentStatusRow label={text(props.language, "当前范围", "Current Scope")} value={`${props.branchPrune.currentScopeLeafCount} ${text(props.language, "叶节点", "leaf nodes")} / ${props.branchPrune.previewSourceCount} ${text(props.language, "预览分支", "preview branches")}`} />
        <InstrumentRow label={text(props.language, "仅保留 RefSeq 基因组", "Retain RefSeq Genomes Only")}>
          <InstrumentSwitch checked={props.branchPrune.draft.refseqOnly} onChange={(value) => props.onBranchPruneDraftChange({ refseqOnly: value })} />
        </InstrumentRow>
        <InstrumentRow label={text(props.language, "最低 CheckM2 完整度（%）", "Minimum CheckM2 Completeness (%)")}>
          <InstrumentNumber value={props.branchPrune.draft.minCompleteness} step="0.1" onChange={(value) => props.onBranchPruneDraftChange({ minCompleteness: value })} />
        </InstrumentRow>
        <InstrumentRow label={text(props.language, "最高 CheckM2 污染度（%）", "Maximum CheckM2 Contamination (%)")}>
          <InstrumentNumber value={props.branchPrune.draft.maxContamination} step="0.1" onChange={(value) => props.onBranchPruneDraftChange({ maxContamination: value })} />
        </InstrumentRow>
        <InstrumentRow label={text(props.language, "最低综合质量分数", "Minimum Composite Quality Score")}>
          <InstrumentNumber value={props.branchPrune.draft.minQuality} step="0.1" onChange={(value) => props.onBranchPruneDraftChange({ minQuality: value })} />
        </InstrumentRow>
        <InstrumentNote>quality_score = checkm2Completeness - 5 × checkM2Contamination + log10(N50)</InstrumentNote>
        <InstrumentRow label={text(props.language, "最大 Contig 数量", "Maximum Contig Count")}>
          <InstrumentNumber value={props.branchPrune.draft.maxContig} step="1" onChange={(value) => props.onBranchPruneDraftChange({ maxContig: value })} />
        </InstrumentRow>
        <InstrumentRow label={text(props.language, "长枝判定 IQR 倍数", "Long-branch IQR Multiplier")}>
          <InstrumentNumber value={props.branchPrune.draft.longBranchIqrMultiplier} min="0.1" step="0.1" onChange={(value) => props.onBranchPruneDraftChange({ longBranchIqrMultiplier: value })} />
        </InstrumentRow>
        <InstrumentNote>
          {text(props.language, "IQR 系数越大，超长支判定越宽松，被剪除的超长支越少。", "A larger IQR multiplier makes long-branch detection looser, so fewer long branches are pruned.")}
        </InstrumentNote>
        <InstrumentRow label={text(props.language, "每个终端最少后代数", "Minimum Descendant Tips per Terminal")}>
          <InstrumentNumber value={props.branchPrune.draft.minimumTerminalLeafCount} min="1" step="1" onChange={(value) => props.onBranchPruneDraftChange({ minimumTerminalLeafCount: value })} />
        </InstrumentRow>
        <InstrumentActions>
          <InstrumentButton disabled={props.branchPrune.status === "loading"} onClick={props.onPreviewBranchPrune}>
            {props.branchPrune.status === "loading" ? text(props.language, "规划中...", "Planning...") : text(props.language, "预览", "Preview")}
          </InstrumentButton>
          <InstrumentButton variant="primary" disabled={props.branchPrune.status === "loading"} onClick={props.onApplyBranchPrune}>
            {props.branchPrune.status === "loading" ? text(props.language, "应用中...", "Applying...") : text(props.language, "应用到当前树", "Apply to Current Tree")}
          </InstrumentButton>
        </InstrumentActions>
        {props.branchPrune.feedback ? <InstrumentNote tone={props.branchPrune.feedback.tone}>{props.branchPrune.feedback.text}</InstrumentNote> : null}
      </InstrumentSection>
    </InstrumentPanelShell>
  );
}

export function HeatmapPanel(props: {
  language: Language;
  treeViewMode: TreeViewMode;
  columns: DisplayColumn[];
  moduleQuery: ModuleQueryInfo | null;
  activeModuleId: string;
  showModuleNames: boolean;
  showModuleFullName: boolean;
  showModuleCompleteness: boolean;
  showModuleDetail: boolean;
  moduleNameFontSize: number;
  moduleCompletenessAvailable: boolean;
  moduleCompletenessThreshold: string;
  showNumbers: boolean;
  ratioDisplayMode: RatioDisplayMode;
  valueFontSize: number;
  valueFontSizeMax: number;
  heatmapColumnWidth: number;
  heatmapColumnWidthMax?: number;
  heatmapColumnWidthLocked: boolean;
  columnLabelFontSize: number;
  columnLabelFontSizeMax: number;
  heatmapMetric: HeatmapMetric;
  heatmapStyles: HeatmapStyleRecord[];
  heatmapShapeSize: number;
  showHeatmapLegend: boolean;
  heatmapLegendFontSize: number;
  columnLabelParts: ColumnLabelPart[];
  onActiveModuleChange: (moduleId: string) => void;
  onOpenModuleDiagram: (moduleId: string) => void;
  onOpenQueryDialog: () => void;
  batchQueryDialogOpen: boolean;
  onOpenBatchQueryDialog: () => void;
  onRemoveColumn: (columnKey: string) => void;
  onShowModuleNamesChange: (value: boolean) => void;
  onShowModuleFullNameChange: (value: boolean) => void;
  onShowModuleCompletenessChange: (value: boolean) => void;
  onShowModuleDetailChange: (value: boolean) => void;
  onModuleNameFontSizeChange: (value: number) => void;
  onModuleCompletenessThresholdChange: (value: string) => void;
  onShowNumbersChange: (value: boolean) => void;
  onRatioDisplayModeChange: (value: RatioDisplayMode) => void;
  onValueFontSizeChange: (value: number) => void;
  onHeatmapColumnWidthChange: (value: number) => void;
  onColumnLabelFontSizeChange: (value: number) => void;
  onHeatmapMetricChange: (value: HeatmapMetric) => void;
  onHeatmapStyleChange: (styleId: string, patch: Partial<Pick<HeatmapStyleRecord, "colorScales" | "shape" | "borderMode" | "name">>) => void;
  onRemoveHeatmapStyle: (styleId: string) => void;
  onOpenHeatmapColorScale: (styleId: string) => void;
  onHeatmapShapeSizeChange: (value: number) => void;
  onColumnLabelPartsChange: (value: ColumnLabelPart[]) => void;
  onStartHeatmapStyleSelection: () => void;
  onClearHeatmapStyles: () => void;
  onShowHeatmapLegendChange: (value: boolean) => void;
  onHeatmapLegendFontSizeChange: (value: number) => void;
}) {
  function togglePart(part: ColumnLabelPart) {
    const next = props.columnLabelParts.includes(part)
      ? props.columnLabelParts.filter((item) => item !== part)
      : [...props.columnLabelParts, part];
    props.onColumnLabelPartsChange(next);
  }

  const queryColumns = props.columns.filter((column) => column.kind === "column");
  const heatmapShapeOptions = props.treeViewMode === "rectangular" ? RECTANGULAR_HEATMAP_SHAPES : CIRCULAR_HEATMAP_SHAPES;
  const batchQueryTriggerRef = useRef<HTMLButtonElement | null>(null);
  const batchQueryWasOpenRef = useRef(props.batchQueryDialogOpen);

  useEffect(() => {
    if (batchQueryWasOpenRef.current && !props.batchQueryDialogOpen) batchQueryTriggerRef.current?.focus();
    batchQueryWasOpenRef.current = props.batchQueryDialogOpen;
  }, [props.batchQueryDialogOpen]);

  return (
    <InstrumentPanelShell
      title={text(props.language, "热图", "Heatmap")}
      details={[
        { label: text(props.language, "列", "Columns"), value: queryColumns.length },
      ]}
    >
      <InstrumentSection title={text(props.language, "添加功能注释列", "Add Annotation Columns")}>
        <InstrumentNote>
          {text(props.language, "这里显示当前热图查询列。使用下面的加号按钮可在模态框中一次追加多条查询，并将结果合并回当前工作区。", "This list shows the current heatmap query columns. Use the plus button below to append multiple queries in a modal and merge them back into the current workspace.")}
        </InstrumentNote>
        <div className="dp-instrument-list">
          {queryColumns.map((column, index) => (
            <div className="dp-instrument-list-row" key={column.column_id ?? `${column.type}-${column.value}-${index}`}>
              <span>{index + 1}</span>
              <div>
                <strong>{column.displayLabel || column.label || column.value}</strong>
                <em>{column.type.toUpperCase()} / {column.value}</em>
              </div>
              <button type="button" aria-label={text(props.language, "删除查询", "Remove query")} onClick={() => props.onRemoveColumn(normalizeColumnKey(column))}>
                <Minus size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        <div className="dp-query-add-row dp-instrument-query-add-row">
          <button type="button" aria-label={text(props.language, "追加查询列", "Append query columns")} onClick={props.onOpenQueryDialog}>
            <Plus size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            ref={batchQueryTriggerRef}
            title={text(props.language, "批量添加功能注释列", "Batch add annotation columns")}
            aria-label={text(props.language, "批量添加功能注释列", "Batch add annotation columns")}
            onClick={props.onOpenBatchQueryDialog}
          >
            <ListPlus size={15} aria-hidden="true" />
          </button>
        </div>
      </InstrumentSection>

      <InstrumentSection title={text(props.language, "显示", "Display")} defaultOpen>
        <InstrumentSubsection title={text(props.language, "数值", "Values")}>
          <InstrumentRow label={text(props.language, "显示单元格数值", "Show Cell Values")}>
            <InstrumentSwitch checked={props.showNumbers} onChange={props.onShowNumbersChange} />
          </InstrumentRow>
          <InstrumentRow label={text(props.language, "数值字号", "Value Font Size")}>
            <InstrumentNumber value={props.valueFontSize} min="1" max={String(props.valueFontSizeMax)} step="1" onChange={(value) => props.onValueFontSizeChange(Number(value))} />
          </InstrumentRow>
          <InstrumentRow label={props.treeViewMode === "circular" ? text(props.language, "热图环宽", "Heatmap Ring Width") : text(props.language, "热图列宽", "Heatmap Column Width")}>
            <InstrumentNumber value={props.heatmapColumnWidth} min={props.treeViewMode === "circular" ? "4" : "8"} max={props.heatmapColumnWidthMax === undefined ? undefined : String(props.heatmapColumnWidthMax)} step="1" disabled={props.heatmapColumnWidthLocked} onChange={(value) => props.onHeatmapColumnWidthChange(Number(value))} />
          </InstrumentRow>
          {props.heatmapColumnWidthLocked ? <InstrumentNote>{text(props.language, "当前矩形热图含圆形或正方形样式，列宽会与行高保持一致。", "Square and circle styles lock the rectangular column width to the row height.")}</InstrumentNote> : null}
          <InstrumentRow label={text(props.language, "比例显示", "Ratio Display")}>
            <InstrumentSegmented
              ariaLabel={text(props.language, "比例显示", "Ratio Display")}
              value={props.ratioDisplayMode}
              options={[
                { value: "fraction", label: text(props.language, "分数", "Fraction") },
                { value: "percent", label: text(props.language, "百分比", "Percent") },
              ]}
              onChange={props.onRatioDisplayModeChange}
            />
          </InstrumentRow>
          <InstrumentRow label={text(props.language, "指标", "Metric")}>
            <InstrumentSegmented
              ariaLabel={text(props.language, "指标", "Metric")}
              value={props.heatmapMetric}
              options={[
                { value: "count", label: text(props.language, "基因计数", "Gene Count") },
                { value: "ratio", label: text(props.language, "物种比例", "Species Ratio") },
              ]}
              onChange={props.onHeatmapMetricChange}
            />
          </InstrumentRow>
        </InstrumentSubsection>

        <InstrumentSubsection title={text(props.language, "列标签", "Column Labels")}>
          <InstrumentRow label={text(props.language, "标签字号", "Label Font Size")}>
            <InstrumentNumber value={props.columnLabelFontSize} min="1" max={String(props.columnLabelFontSizeMax)} step="1" onChange={(value) => props.onColumnLabelFontSizeChange(Number(value))} />
          </InstrumentRow>
          <InstrumentRow label={text(props.language, "注释 ID", "Annotation ID")}>
            <InstrumentSwitch checked={props.columnLabelParts.includes("value")} onChange={() => togglePart("value")} />
          </InstrumentRow>
          <InstrumentRow label={text(props.language, "短名称", "Short Name")}>
            <InstrumentSwitch checked={props.columnLabelParts.includes("short_name")} onChange={() => togglePart("short_name")} />
          </InstrumentRow>
          <InstrumentRow label={text(props.language, "全名称", "Full Name")}>
            <InstrumentSwitch checked={props.columnLabelParts.includes("full_name")} onChange={() => togglePart("full_name")} />
          </InstrumentRow>
        </InstrumentSubsection>
      </InstrumentSection>

      <InstrumentSection
        title={text(props.language, "热图样式", "Heatmap Styles")}
        headerActions={<InstrumentButton onClick={props.onClearHeatmapStyles}>{text(props.language, "恢复默认样式", "Restore Defaults")}</InstrumentButton>}
      >
        <div className="dp-style-table-wrap">
          <table className="dp-cart-record-table dp-style-table">
            <thead>
              <tr>
                <th>{text(props.language, "样式", "Style")}</th>
                <th>{text(props.language, "颜色", "Color")}</th>
                <th>{text(props.language, "形状", "Shape")}</th>
                <th>{text(props.language, "框线", "Border")}</th>
                <th>{text(props.language, "name", "Name")}</th>
                <th>{text(props.language, "删除", "Delete")}</th>
              </tr>
            </thead>
            <tbody>
              {props.heatmapStyles.map((style) => (
                <tr key={style.id} className={style.role === "default" ? "is-default" : undefined}>
                  <td><HeatmapStylePreview style={style} /></td>
                  <td>
                    <button type="button" className="button subtle heatmap-scale-edit-button" onClick={() => props.onOpenHeatmapColorScale(style.id)}>{text(props.language, "调整颜色", "Adjust Colors")}</button>
                  </td>
                  <td>
                    <InstrumentSelect value={style.shape} options={heatmapShapeOptions.map((shape) => ({ value: shape.value, label: shapeLabel(shape, props.language) }))} onChange={(value) => props.onHeatmapStyleChange(style.id, { shape: value as PartitionShape })} />
                  </td>
                  <td>
                    <InstrumentSelect
                      value={style.borderMode}
                      options={[
                        { value: "none", label: text(props.language, "无框线", "None") },
                        { value: "outer", label: text(props.language, "外框线", "Outer") },
                        { value: "inner", label: text(props.language, "内框线", "Inner") },
                      ]}
                      onChange={(value) => props.onHeatmapStyleChange(style.id, { borderMode: value as HeatmapBorderMode })}
                    />
                  </td>
                  <td>
                    <input className="dp-style-name-input" value={style.name} placeholder={text(props.language, "可选", "Optional")} onChange={(event) => props.onHeatmapStyleChange(style.id, { name: event.target.value })} />
                  </td>
                  <td className="dp-table-delete-cell">
                    <button
                      type="button"
                      className="icon-button"
                      disabled={style.role === "default"}
                      title={style.role === "default" ? text(props.language, "默认样式不能删除", "The default style cannot be deleted") : undefined}
                      aria-label={style.role === "default" ? text(props.language, "默认样式不能删除", "The default style cannot be deleted") : text(props.language, "删除样式", "Delete style")}
                      onClick={() => props.onRemoveHeatmapStyle(style.id)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="dp-query-add-row dp-instrument-query-add-row">
          <button type="button" aria-label={text(props.language, "新建热图样式", "Create heatmap style")} onClick={props.onStartHeatmapStyleSelection}>
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
        <InstrumentRow label={text(props.language, "标记大小", "Marker Size")}>
          <InstrumentSliderNumber value={props.heatmapShapeSize} min={0.1} max={1} step={0.05} onChange={props.onHeatmapShapeSizeChange} />
        </InstrumentRow>
        <InstrumentRow label={text(props.language, "显示图注", "Show Legend")}>
          <InstrumentSwitch checked={props.showHeatmapLegend} onChange={props.onShowHeatmapLegendChange} />
        </InstrumentRow>
        <HeatmapLegendFontControl language={props.language} visible={props.showHeatmapLegend} fontSize={props.heatmapLegendFontSize} onFontSizeChange={props.onHeatmapLegendFontSizeChange} />
      </InstrumentSection>

      {props.moduleQuery?.modules.length ? (
        <InstrumentSection title={text(props.language, "KEGG Modules", "KEGG Modules")} defaultOpen>
          <InstrumentNote>
            {text(props.language, "Module 结果会展开成 KO 热图列。你可以在这里聚焦某个 module，并打开官方 Diagram。", "Module results are expanded into KO heatmap columns. Use this section to focus a module and open the official diagram.")}
          </InstrumentNote>
          <InstrumentRow label={text(props.language, "显示 KO 组成", "Show KO Components")}>
            <InstrumentSwitch checked={props.showModuleDetail} onChange={props.onShowModuleDetailChange} />
          </InstrumentRow>
          {props.showModuleDetail ? (
            <>
              <InstrumentRow label={text(props.language, "显示 Module 名称", "Show Module Names")}>
                <InstrumentSwitch checked={props.showModuleNames} onChange={props.onShowModuleNamesChange} />
              </InstrumentRow>
              <ModuleNameFontControl language={props.language} visible={props.showModuleNames} fontSize={props.moduleNameFontSize} onFontSizeChange={props.onModuleNameFontSizeChange} />
              {props.showModuleNames ? (
                <InstrumentRow label={text(props.language, "显示全称", "Show Full Name")}>
                  <InstrumentSwitch checked={props.showModuleFullName} onChange={props.onShowModuleFullNameChange} />
                </InstrumentRow>
              ) : null}
            </>
          ) : null}
          <InstrumentRow label={text(props.language, "Module 完整度阈值（%）", "Module Completeness Threshold (%)")}>
            <div className="dp-instrument-slider">
              <input type="range" min="0" max="100" step="1" value={props.moduleCompletenessThreshold} disabled={!props.moduleCompletenessAvailable || !props.showModuleCompleteness} onChange={(event) => props.onModuleCompletenessThresholdChange(event.target.value)} />
              <input type="number" min="0" max="100" step="1" value={props.moduleCompletenessThreshold} disabled={!props.moduleCompletenessAvailable || !props.showModuleCompleteness} onChange={(event) => props.onModuleCompletenessThresholdChange(event.target.value)} />
            </div>
          </InstrumentRow>
          <InstrumentRow label={text(props.language, "选中的 KEGG Module", "Selected KEGG Module")} layout="stacked">
            <PillButtons
              value={props.activeModuleId}
              options={props.moduleQuery.modules.map((module) => ({ value: module.module_id, label: module.module_id }))}
              onChange={props.onActiveModuleChange}
            />
          </InstrumentRow>
          <InstrumentActions>
            <InstrumentButton
              onClick={() => {
                const target = props.activeModuleId || props.moduleQuery?.modules[0]?.module_id;
                if (target) props.onOpenModuleDiagram(target);
              }}
            >
              <ExternalLink size={15} aria-hidden="true" />
              {text(props.language, "打开 KEGG Diagram", "Open KEGG Diagram")}
            </InstrumentButton>
          </InstrumentActions>
        </InstrumentSection>
      ) : null}
    </InstrumentPanelShell>
  );
}
