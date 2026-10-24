import { ChevronDown, FolderOpen, FolderPlus, RotateCcw, Trash2 } from "lucide-react";

import type { SavedQueryCategory, SavedQueryRecord } from "../api";
import type { Language } from "../shared/types";

type Props = {
  language: Language;
  categories: SavedQueryCategory[];
  records: SavedQueryRecord[];
  onCreateCategory: () => void;
  onDeleteCategory: (id: number) => void;
  onDeleteRecord: (id: number) => void;
  onRestore: (id: number) => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
};

const savedQueriesCopy = {
  zh: {
    uncategorized: "未分类", kicker: "查询档案", title: "我的查询记录",
    description: "恢复已保存的查询、物种树、热图和物种范围状态。", recordUnit: "条记录",
    createCategory: "新建分类", record: "记录", dataset: "数据集", lastSaved: "最后保存",
    deleteCategory: "删除分类", restore: "恢复", deleteRecord: "删除记录", empty: "此分类中还没有记录。",
  },
  en: {
    uncategorized: "Uncategorized", kicker: "Query Archive", title: "My Saved Queries",
    description: "Restore saved query, species-tree, heatmap, and species-scope state.", recordUnit: "records",
    createCategory: "New Category", record: "Record", dataset: "Dataset", lastSaved: "Last Saved",
    deleteCategory: "Delete category", restore: "Restore", deleteRecord: "Delete record", empty: "No records in this category yet.",
  },
} as const;

export function localizeSavedQueriesPage(language: Language) {
  return savedQueriesCopy[language];
}

export default function SavedQueriesPage(props: Props) {
  const text = localizeSavedQueriesPage(props.language);
  const groups = [
    ...props.categories.map((category) => ({ id: category.id, name: category.name })),
    { id: null, name: text.uncategorized },
  ];

  return (
    <main className="saved-query-page">
      <header className="saved-query-header">
        <div>
          <p className="saved-query-kicker">{text.kicker}</p>
          <h1>{text.title}</h1>
          <p>{text.description}</p>
        </div>
        <div className="saved-query-total"><b>{props.records.length}</b><span>{text.recordUnit}</span></div>
      </header>

      <div className="saved-query-actions">
        <button type="button" className="saved-query-primary-action" onClick={props.onCreateCategory}>
          <FolderPlus size={16} aria-hidden="true" />
          {text.createCategory}
        </button>
      </div>

      <div className="saved-query-ledger">
        <div className="saved-query-column-head"><span>{text.record}</span><span>{text.dataset}</span><span>{text.lastSaved}</span><span /></div>
        {groups.map((category) => {
          const records = props.records.filter((record) => record.category_id === category.id);
          return (
            <details key={category.id ?? "uncategorized"} className="saved-query-category" open>
              <summary><ChevronDown className="saved-query-category-mark" size={16} aria-hidden="true" /><strong>{category.name}</strong><em>{records.length}</em></summary>
              {category.id !== null ? <button type="button" className="saved-query-icon-action danger" title={text.deleteCategory} aria-label={`${text.deleteCategory} ${category.name}`} onClick={() => props.onDeleteCategory(category.id!)}><Trash2 size={15} /></button> : null}
              <div className="saved-query-records">
                {records.length ? records.map((record) => (
                  <div key={record.id} className="saved-query-row">
                    <div><strong>{record.title}</strong><small>{record.dataset_revision}</small></div>
                    <span>{record.genome_database} / {record.species_tree}</span>
                    <time>{new Date(record.updated_at).toLocaleString(props.language === "zh" ? "zh-CN" : "en-US")}</time>
                    <div className="saved-query-row-actions">
                      <button type="button" className="saved-query-restore-action" onClick={() => props.onRestore(record.id)}><RotateCcw size={15} aria-hidden="true" />{text.restore}</button>
                      <button type="button" className="saved-query-icon-action danger" title={text.deleteRecord} aria-label={`${text.deleteRecord} ${record.title}`} onClick={() => props.onDeleteRecord(record.id)}><Trash2 size={15} /></button>
                    </div>
                  </div>
                )) : <p className="saved-query-empty"><FolderOpen size={18} aria-hidden="true" /><span>{text.empty}</span></p>}
              </div>
            </details>
          );
        })}
      </div>
      {props.hasMore ? <button type="button" className="button subtle" disabled={props.loadingMore} onClick={props.onLoadMore}>{props.language === "zh" ? "加载更多" : "Load more"}</button> : null}
    </main>
  );
}
