import { Search } from "lucide-react";

import type { TreeNodeSearchItem } from "../../types";
import type { Language } from "../../shared/types";
import { TreeCombobox } from "./resultScopeControls";

function text(language: Language, zh: string, en: string) {
  return language === "zh" ? zh : en;
}

export function TreeSearchTool(props: {
  language: Language;
  open: boolean;
  query: string;
  rank: string;
  results: TreeNodeSearchItem[];
  pickedItem: TreeNodeSearchItem | null;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (value: string) => void;
  onRankChange: (value: string) => void;
  onPick: (item: TreeNodeSearchItem) => void;
  onSearch: () => void;
}) {
  const label = text(props.language, "搜索节点或分支", "Search nodes or branches");

  return (
    <aside
      className={`tree-search-tool${props.open ? " open" : ""}`}
      aria-label={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="tree-search-trigger"
        aria-label={label}
        aria-expanded={props.open}
        title={label}
        onClick={() => props.onOpenChange(!props.open)}
      >
        <Search size={18} aria-hidden="true" />
      </button>
      <div className="tree-search-content" aria-hidden={!props.open}>
        <TreeCombobox
          language={props.language}
          rank={props.rank}
          query={props.query}
          placeholder={text(props.language, "分类单元或 accession", "Taxon or accession")}
          suggestions={props.results}
          pickedItem={props.pickedItem}
          searchDisabled={!props.results.length}
          onRankChange={props.onRankChange}
          onQueryChange={props.onQueryChange}
          onPick={props.onPick}
          onSearch={props.onSearch}
        />
      </div>
    </aside>
  );
}
