import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef } from "react";

import type { Language } from "../../shared/types";
import type { BranchCartRecord } from "../result/resultTypes";
import type { TreeNodeSearchItem } from "../../types";
import { RANKS } from "../result/resultConstants";
import { SelectedBranchesTable, TreeCombobox } from "../result/resultScopeControls";

function text(language: Language, zh: string, en: string) {
  return language === "zh" ? zh : en;
}

export interface QueryScopeDialogProps {
  open: boolean;
  language: Language;
  query: string;
  rank: string;
  expandRank: string;
  candidates: TreeNodeSearchItem[];
  pickedItem: TreeNodeSearchItem | null;
  records: BranchCartRecord[];
  leafCount: number;
  onQueryChange: (value: string) => void;
  onRankChange: (value: string) => void;
  onExpandRankChange: (value: string) => void;
  onPick: (item: TreeNodeSearchItem) => void;
  onAdd: () => void;
  onRecordRankChange: (recordId: string, rank: string) => void;
  onDelete: (recordId: string) => void;
  onClear: () => void;
  onCancel: () => void;
  onConfirm?: () => void;
  onReplace?: () => void;
  onAppend?: () => void;
}

export default function QueryScopeDialog(props: QueryScopeDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCancelRef = useRef(props.onCancel);

  useEffect(() => {
    onCancelRef.current = props.onCancel;
  }, [props.onCancel]);

  useEffect(() => {
    if (!props.open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCancelRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [props.open]);

  if (!props.open) return null;
  const zh = props.language === "zh";
  return (
    <div className="modal-overlay">
      <div ref={dialogRef} className="modal-card query-scope-modal-card" role="dialog" aria-modal="true" aria-labelledby="query-scope-dialog-title" tabIndex={-1}>
        <div className="modal-header">
          <h2 id="query-scope-dialog-title">{text(props.language, "自定义查询范围", "Custom Query Scope")}</h2>
          <button type="button" className="icon-button modal-close" aria-label={text(props.language, "关闭范围弹窗", "Close scope dialog")} onClick={props.onCancel}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <p className="muted">
          {text(props.language, "添加一个或多个分类单元，查询时只使用已选类群的物种范围。", "Add one or more taxa. The query will use only species within the selected clades.")}
        </p>

        <section className="query-scope-dialog-section">
          <div className="query-scope-dialog-section-head">
            <h3>{text(props.language, "添加分类单元或类群", "Add Taxa or Clades")}</h3>
          </div>
          <div className="query-scope-add-grid">
            <TreeCombobox
              language={props.language}
              rank={props.rank}
              query={props.query}
              placeholder={text(props.language, "输入物种或分类名称", "Type a taxon name")}
              suggestions={props.candidates}
              pickedItem={props.pickedItem}
              showSearchButton={false}
              onRankChange={props.onRankChange}
              onQueryChange={props.onQueryChange}
              onPick={props.onPick}
              onSearch={props.onAdd}
            />
            <label className="query-scope-expand-rank">
              <span>{text(props.language, "展开 rank", "Expand rank")}</span>
              <select value={props.expandRank} onChange={(event) => props.onExpandRankChange(event.target.value)}>
                {RANKS.map((rank) => <option key={rank} value={rank}>{rank}</option>)}
              </select>
            </label>
          </div>
          <div className="modal-actions query-scope-add-actions">
            <button type="button" className="button primary" disabled={!props.pickedItem} onClick={props.onAdd}>
              <Plus size={15} aria-hidden="true" />
              {text(props.language, "加入范围", "Add to scope")}
            </button>
          </div>
        </section>

        <section className="query-scope-dialog-section">
          <div className="query-scope-dialog-section-head">
            <div>
              <h3>{text(props.language, "已选类群", "Selected Clades")}</h3>
              <small>{props.records.length} {text(props.language, "个类群", "clades")} / {props.leafCount} {text(props.language, "个物种", "species")}</small>
            </div>
            <button type="button" className="icon-button" disabled={!props.records.length} aria-label={text(props.language, "清空已选类群", "Clear selected clades")} title={text(props.language, "清空已选类群", "Clear selected clades")} onClick={props.onClear}>
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </div>
          {props.records.length ? (
            <div className="query-scope-table-wrap">
              <SelectedBranchesTable
                language={props.language}
                records={props.records}
                editMode={false}
                selectedBatchIds={new Set()}
                rankOptions={RANKS.map((rank) => ({ value: rank, label: rank }))}
                onToggleSelection={() => undefined}
                onRecordRankChange={props.onRecordRankChange}
                onDeleteRecord={props.onDelete}
              />
            </div>
          ) : (
            <p className="query-scope-empty">{text(props.language, "还没有选择类群。", "No clades selected yet.")}</p>
          )}
        </section>

        <div className="modal-actions">
          <button type="button" className="button subtle" onClick={props.onCancel}>{zh ? "取消" : "Cancel"}</button>
          {props.onReplace || props.onAppend ? (
            <>
              <button type="button" className="button subtle" disabled={!props.records.length} onClick={props.onReplace}>{zh ? "更换查询范围" : "Replace scope"}</button>
              <button type="button" className="button primary" disabled={!props.records.length} onClick={props.onAppend}>{zh ? "增加查询物种范围" : "Append scope"}</button>
            </>
          ) : (
            <button type="button" className="button primary" disabled={!props.records.length} onClick={props.onConfirm}>{zh ? "确认范围" : "Use this scope"}</button>
          )}
        </div>
      </div>
    </div>
  );
}
