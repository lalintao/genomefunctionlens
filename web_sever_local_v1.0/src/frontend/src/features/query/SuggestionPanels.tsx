import { ParentAnchoredFloatingLayer } from "../../components/floating/viewportFloating";
import type { ModuleSuggestItem, SuggestItem } from "../../types";

export function SuggestionPanel({ items, onPick }: { items: SuggestItem[]; onPick: (item: SuggestItem) => void }) {
  return (
    <ParentAnchoredFloatingLayer className="suggestion-panel viewport-suggestion-panel" role="listbox" matchAnchorWidth maxHeight={320} gap={8}>
      {items.map((item) => (
        <button key={`${item.type}-${item.value}`} type="button" role="option" onClick={() => onPick(item)}>
          <strong>{item.short_name || item.value}</strong>
          <span>{item.value}</span>
          {item.full_name ? <em>{item.full_name}</em> : null}
        </button>
      ))}
    </ParentAnchoredFloatingLayer>
  );
}

export function ModuleSuggestionPanel({ items, onPick }: { items: ModuleSuggestItem[]; onPick: (item: ModuleSuggestItem) => void }) {
  return (
    <ParentAnchoredFloatingLayer className="suggestion-panel viewport-suggestion-panel" role="listbox" matchAnchorWidth maxHeight={320} gap={8}>
      {items.map((item) => (
        <button key={item.module_id} type="button" role="option" onClick={() => onPick(item)}>
          <strong>{item.module_id}</strong>
          <span>{item.module_name}</span>
          {item.aliases ? <em>{item.aliases}</em> : null}
        </button>
      ))}
    </ParentAnchoredFloatingLayer>
  );
}
