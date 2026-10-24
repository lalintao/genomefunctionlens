import { Check, Search, Trash2, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ParentAnchoredFloatingLayer, ViewportFloatingLayer } from "../../components/floating/viewportFloating";
import type { Language } from "../../shared/types";
import type { TreeNodeSearchItem } from "../../types";
import { RANKS } from "./resultConstants";
import type { BranchCartRecord } from "./resultTypes";

function text(language: Language, zh: string, en: string) {
  return language === "zh" ? zh : en;
}

export function InstrumentIconButton(props: {
  label: string;
  active?: boolean;
  danger?: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`dp-instrument-icon-button${props.active ? " active" : ""}${props.danger ? " danger" : ""}`}
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export function InstrumentSelect(props: {
  value: string;
  options: Array<{ value: string; label: string }>;
  fallbackLabel?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const matchedOption = props.options.find((option) => option.value === props.value);
  const activeOption = matchedOption ?? (props.fallbackLabel ? null : props.options[0] ?? null);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`dp-instrument-select-shell${open ? " open" : ""}${props.disabled ? " disabled" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="dp-instrument-select"
        disabled={props.disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => {
          if (!props.disabled) setOpen((current) => !current);
        }}
      >
        <span>{activeOption?.label ?? props.fallbackLabel ?? props.value}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <ViewportFloatingLayer
          ref={dropdownRef}
          anchorRef={triggerRef}
          className="dp-instrument-select-dropdown"
          role="listbox"
          id={listboxId}
          aria-activedescendant={`${listboxId}-${props.value}`}
          matchAnchorWidth
          maxHeight={260}
        >
          {props.options.map((option) => (
            <button
              key={option.value}
              id={`${listboxId}-${option.value}`}
              type="button"
              role="option"
              className={option.value === props.value ? "active" : ""}
              aria-selected={option.value === props.value}
              onClick={() => {
                props.onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === props.value ? <Check size={14} aria-hidden="true" /> : null}
            </button>
          ))}
        </ViewportFloatingLayer>
      ) : null}
    </div>
  );
}

function BranchCartRecordRow(props: {
  language: Language;
  record: BranchCartRecord;
  editMode: boolean;
  selectionVisible: boolean;
  checked: boolean;
  rankOptions: Array<{ value: string; label: string }>;
  onToggle: () => void;
  onRankChange: (value: string) => void;
  onDelete: () => void;
}) {
  return (
    <tr>
      <td className="dp-cart-record-id">
        {props.selectionVisible ? <input type="checkbox" checked={props.checked} onChange={props.onToggle} aria-label={text(props.language, "选择批次", "Select batch")} /> : null}
        <strong>#{props.record.batchId}</strong>
      </td>
      <td className="dp-cart-record-name">
        <b title={props.record.path}>{props.record.taxonLabel || props.record.label}</b>
        <em>{props.record.sourceType === "heatmap" ? text(props.language, "热图", "Heatmap") : text(props.language, "手动", "Manual")}</em>
      </td>
      <td className="dp-cart-record-source">
        {props.record.scopeSource === "current_view"
          ? text(props.language, "当前视图", "Current View")
          : text(props.language, "完整数据库", "Full Database")}
      </td>
      <td className="dp-cart-record-count">{props.record.leafCount}</td>
      <td className="dp-cart-record-rank">
        <InstrumentSelect value={props.record.expandRank} options={props.rankOptions} onChange={props.onRankChange} />
      </td>
      <td className="dp-cart-record-actions">
        <InstrumentIconButton label={text(props.language, "删除类群", "Delete clade")} danger onClick={props.onDelete}>
          <Trash2 size={15} aria-hidden="true" />
        </InstrumentIconButton>
      </td>
    </tr>
  );
}

export function SelectedBranchesTable(props: {
  language: Language;
  records: BranchCartRecord[];
  editMode: boolean;
  selectedBatchIds: Set<number>;
  rankOptions: Array<{ value: string; label: string }>;
  onToggleSelection: (batchId: number) => void;
  onRecordRankChange: (recordId: string, value: string) => void;
  onDeleteRecord: (recordId: string) => void;
}) {
  return (
    <table className="dp-cart-record-table">
      <thead>
        <tr>
          <th>id</th>
          <th>{text(props.language, "分类单元", "Taxon")}</th>
          <th>{text(props.language, "数据来源", "Data Source")}</th>
          <th>{text(props.language, "后代末端数", "Descendant Tips")}</th>
          <th>{text(props.language, "目标展开层级", "Target Expansion Rank")}</th>
          <th>{text(props.language, "删除", "Delete")}</th>
        </tr>
      </thead>
      <tbody>
        {props.records.map((record) => (
          <BranchCartRecordRow
            key={record.id}
            language={props.language}
            record={record}
            editMode={props.editMode}
            selectionVisible={false}
            checked={props.selectedBatchIds.has(record.batchId)}
            rankOptions={props.rankOptions}
            onToggle={() => props.onToggleSelection(record.batchId)}
            onRankChange={(value) => props.onRecordRankChange(record.id, value)}
            onDelete={() => props.onDeleteRecord(record.id)}
          />
        ))}
      </tbody>
    </table>
  );
}

function TreeSuggestionList(props: {
  language: Language;
  items: TreeNodeSearchItem[];
  pickedItem: TreeNodeSearchItem | null;
  onPick: (item: TreeNodeSearchItem) => void;
}) {
  if (!props.items.length || props.pickedItem) return null;
  return (
    <ParentAnchoredFloatingLayer className="suggestion-panel viewport-suggestion-panel dp-instrument-suggestions" role="listbox" matchAnchorWidth maxHeight={320} gap={8}>
      {props.items.map((item, index) => (
        <button key={`${item.id}-${item.rank}-${item.label}`} type="button" role="option" aria-selected={index === 0} className={index === 0 ? "active" : ""} onClick={() => props.onPick(item)}>
          {index === 0 ? <Check size={14} aria-hidden="true" /> : <span />}
          <span>{item.label}</span>
          <em>
            {item.rank}
            {item.speciesCount !== undefined ? ` / ${item.speciesCount} ${text(props.language, "物种", "species")}` : ""}
            {item.path ? ` / ${item.path}` : ""}
          </em>
        </button>
      ))}
    </ParentAnchoredFloatingLayer>
  );
}

export function TreeCombobox(props: {
  language: Language;
  rank: string;
  query: string;
  placeholder: string;
  suggestions: TreeNodeSearchItem[];
  pickedItem: TreeNodeSearchItem | null;
  searchDisabled?: boolean;
  showSearchButton?: boolean;
  onRankChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onPick: (item: TreeNodeSearchItem) => void;
  onSearch: () => void;
}) {
  return (
    <div className="dp-instrument-combo">
      <div className={props.showSearchButton === false ? "dp-instrument-combo-input no-search" : "dp-instrument-combo-input"}>
        <select value={props.rank} onChange={(event) => props.onRankChange(event.target.value)} aria-label="Rank">
          <option value="all">{text(props.language, "全部", "All")}</option>
          {RANKS.map((rank) => <option key={rank} value={rank}>{rank}</option>)}
        </select>
        <input value={props.query} placeholder={props.placeholder} onChange={(event) => props.onQueryChange(event.target.value)} />
        {props.showSearchButton === false ? null : (
          <button type="button" aria-label="Search" disabled={props.searchDisabled} onClick={props.onSearch}>
            <Search size={15} aria-hidden="true" />
          </button>
        )}
      </div>
      <TreeSuggestionList
        language={props.language}
        items={props.suggestions}
        pickedItem={props.pickedItem}
        onPick={(item) => {
          props.onQueryChange(item.label);
          props.onPick(item);
        }}
      />
    </div>
  );
}
