import { Keyboard, MessageSquareText, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type {
  AnnotationCondition,
  DatasetItem,
  DatasetResponse,
  ModuleSuggestItem,
  SuggestItem,
} from "../../types";
import type { Language } from "../../shared/types";
import { DESIGN_PREVIEW_TEXT } from "../../shared/designPreviewText";
import AnnotationConditionEditor from "./AnnotationConditionEditor";
import type { QueryScopeOption, QueryScopePresetKey } from "./queryScope";

export interface QueryCardProps {
  language: Language;
  datasets: DatasetResponse | null;
  activeDataset: DatasetItem | null;
  conditions: AnnotationCondition[];
  queryMode: "manual" | "batch";
  batchQueryText: string;
  suggestions: Record<string, SuggestItem[]>;
  moduleSuggestions: Record<string, ModuleSuggestItem[]>;
  activeSuggestionId: string | null;
  isSearching: boolean;
  revealVisible?: boolean;
  onDatasetChange: (dataset: DatasetItem) => void;
  onQueryModeChange: (mode: "manual" | "batch") => void;
  onUpdateCondition: (id: string, patch: Partial<AnnotationCondition>) => void;
  onAddCondition: () => void;
  onRemoveCondition: (id: string) => void;
  onBatchQueryChange: (value: string) => void;
  onActiveSuggestionChange: (id: string | null) => void;
  onSuggestionApply: (conditionId: string, item: SuggestItem) => void;
  onModuleSuggestionApply: (conditionId: string, item: ModuleSuggestItem) => void;
  onSearch: () => void;
  onOpenSavedQueries?: () => void;
  queryScopeSelection: QueryScopePresetKey | null;
  queryScopeOptions: QueryScopeOption[];
  queryScopeOptionsLoading: boolean;
  queryScopeLeafCount: number;
  queryScopeCustomCount: number;
  onQueryScopeSelect: (selection: Exclude<QueryScopePresetKey, "other">) => void;
  onOpenCustomQueryScope: () => void;
  chatEntry?: ReactNode;
}

export default function QueryCard(props: QueryCardProps) {
  const [entryMode, setEntryMode] = useState<"manual" | "chat">("manual");
  const chatPanelRef = useRef<HTMLElement>(null);
  const copy = DESIGN_PREVIEW_TEXT[props.language];
  const zh = props.language === "zh";
  const hasChatEntry = props.chatEntry != null;
  const datasets = props.datasets?.datasets ?? [];
  const annotationTypes = Array.from(
    new Set(
      [...(props.datasets?.annotation_types.length ? props.datasets.annotation_types : ["cog", "kegg", "pfam"]), "module"]
        .filter((type) => type !== "keggmodule"),
    ),
  );
  const scopeLabels: Record<QueryScopePresetKey, string> = {
    archaea_bacteria: zh ? "古菌 + 细菌" : "Archaea + Bacteria",
    archaea: zh ? "古菌" : "Archaea",
    bacteria: zh ? "细菌" : "Bacteria",
    other: zh ? "其他" : "Other",
  };
  const optionByKey = new Map(props.queryScopeOptions.map((option) => [option.key, option]));
  useEffect(() => {
    if (entryMode !== "chat") return;
    const frame = window.requestAnimationFrame(() => chatPanelRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [entryMode]);

  useEffect(() => {
    if (hasChatEntry || entryMode !== "chat") return;
    setEntryMode("manual");
  }, [entryMode, hasChatEntry]);

  return (
    <section id="query" className={`dp-query-section dp-reveal${props.revealVisible ? " visible" : ""}`}>
      <div className="dp-section-intro">
        <div className="dp-entry-switch" role="tablist" aria-label={zh ? "选择输入方式" : "Choose an entry mode"}>
          <button
            id="manual-entry-tab"
            type="button"
            role="tab"
            aria-selected={entryMode === "manual"}
            aria-controls="manual-entry-panel"
            tabIndex={entryMode === "manual" ? 0 : -1}
            className={entryMode === "manual" ? "active" : ""}
            onClick={() => setEntryMode("manual")}
          >
            <Keyboard size={16} aria-hidden="true" />
            {copy.queryPanelTitle}
          </button>
          {hasChatEntry ? (
            <button
              id="chat-entry-tab"
              type="button"
              role="tab"
              aria-selected={entryMode === "chat"}
              aria-controls="chat-entry-panel"
              tabIndex={entryMode === "chat" ? 0 : -1}
              className={entryMode === "chat" ? "active" : ""}
              onClick={() => setEntryMode("chat")}
            >
              <MessageSquareText size={16} aria-hidden="true" />
              {copy.chatPanelTitle}
            </button>
          ) : null}
        </div>
      </div>

      <div className={`dp-query-frame ${entryMode === "chat" ? "chat-active" : "manual-active"}`}>
        <div
          id="manual-entry-panel"
          className={`dp-query-column dp-entry-panel${entryMode === "manual" ? " active" : " inactive"}`}
          role="tabpanel"
          aria-labelledby="manual-entry-tab"
          aria-hidden={entryMode !== "manual"}
        >
          <div className="dp-query-toolbar">
            <div className="dp-segmented">
              <button
                type="button"
                className={props.queryMode === "manual" ? "active" : ""}
                onClick={() => props.onQueryModeChange("manual")}
              >
                {copy.manual}
              </button>
              <button
                type="button"
                className={props.queryMode === "batch" ? "active" : ""}
                onClick={() => props.onQueryModeChange("batch")}
              >
                {copy.batch}
              </button>
            </div>
            <div className="dp-query-dataset-control">
              <span>{zh ? "数据集：" : "Dataset:"}</span>
              <div className="dp-dataset-switch">
                {datasets.map((dataset) => {
                  const isActive = props.activeDataset?.species_tree === dataset.species_tree
                    && props.activeDataset?.genome_database === dataset.genome_database;
                  return (
                    <button
                      key={`${dataset.genome_database}:${dataset.species_tree}`}
                      type="button"
                      disabled={!dataset.available}
                      className={isActive ? "active" : ""}
                      onClick={() => props.onDatasetChange(dataset)}
                    >
                      {dataset.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="dp-query-scope-row">
            <span className="dp-query-control-label">{zh ? "查询物种范围：" : "Species scope:"}</span>
            <div className="dp-query-scope-switch" role="radiogroup" aria-label={zh ? "查询范围" : "Query scope"}>
              {(["archaea_bacteria", "archaea", "bacteria"] as const).map((key) => {
                const available = optionByKey.get(key)?.status === "available";
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={props.queryScopeSelection === key}
                    aria-disabled={!available || props.queryScopeOptionsLoading}
                    disabled={!available || props.queryScopeOptionsLoading}
                    className={props.queryScopeSelection === key ? "active" : ""}
                    title={!available && !props.queryScopeOptionsLoading ? (zh ? "当前数据集没有匹配的分类范围" : "No matching scope in the current dataset") : undefined}
                    onClick={() => props.onQueryScopeSelect(key)}
                  >
                    {scopeLabels[key]}
                  </button>
                );
              })}
              <button
                type="button"
                role="radio"
                aria-checked={props.queryScopeSelection === "other"}
                className={props.queryScopeSelection === "other" ? "active" : ""}
                disabled={props.queryScopeOptionsLoading}
                onClick={props.onOpenCustomQueryScope}
              >
                {scopeLabels.other}
              </button>
            </div>
          </div>
          {props.queryMode === "manual" ? (
            <AnnotationConditionEditor
              language={props.language}
              conditions={props.conditions}
              annotationTypes={annotationTypes}
              activeSuggestionId={props.activeSuggestionId}
              suggestions={props.suggestions}
              moduleSuggestions={props.moduleSuggestions}
              annotationPlaceholder={copy.manualPlaceholders[0]}
              modulePlaceholder={copy.manualPlaceholders[1]}
              onUpdateCondition={props.onUpdateCondition}
              onAddCondition={props.onAddCondition}
              onRemoveCondition={props.onRemoveCondition}
              onActiveSuggestionChange={props.onActiveSuggestionChange}
              onSuggestionApply={props.onSuggestionApply}
              onModuleSuggestionApply={props.onModuleSuggestionApply}
            />
          ) : (
            <div className="dp-batch-box">
              <textarea
                value={props.batchQueryText}
                onChange={(event) => props.onBatchQueryChange(event.target.value)}
                placeholder={zh ? "COG0001\nPF00001.1\nM00357" : "COG0001\nPF00001.1\nM00357"}
              />
            </div>
          )}

          <div className="dp-query-submit">
            <button
              type="button"
              className="dp-button dp-button-primary"
              disabled={props.isSearching || props.queryScopeOptionsLoading || !props.queryScopeSelection || !props.queryScopeLeafCount}
              onClick={props.onSearch}
            >
              <Search size={16} aria-hidden="true" />
              {props.isSearching ? (zh ? "查询中..." : "Searching...") : copy.search}
            </button>
          </div>
        </div>
        {hasChatEntry ? (
          <aside
            ref={chatPanelRef}
            id="chat-entry-panel"
            className={`dp-chat-entry dp-entry-panel${entryMode === "chat" ? " active" : " inactive"}`}
            role="tabpanel"
            aria-labelledby="chat-entry-tab"
            aria-hidden={entryMode !== "chat"}
          >
            {props.chatEntry}
          </aside>
        ) : null}
      </div>
    </section>
  );
}
