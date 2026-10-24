import { useEffect, useRef } from "react";
import { Minus, Plus } from "lucide-react";

import type {
  AnnotationCondition,
  AnnotationType,
  ModuleSuggestItem,
  SuggestItem,
} from "../../types";
import type { Language } from "../../shared/types";
import { annotationTypeLabel } from "../../shared/annotation";
import { ModuleSuggestionPanel, SuggestionPanel } from "./SuggestionPanels";

export interface AnnotationConditionEditorProps {
  language: Language;
  conditions: AnnotationCondition[];
  annotationTypes: AnnotationType[];
  activeSuggestionId: string | null;
  suggestions: Record<string, SuggestItem[]>;
  moduleSuggestions: Record<string, ModuleSuggestItem[]>;
  annotationPlaceholder: string;
  modulePlaceholder: string;
  onUpdateCondition: (id: string, patch: Partial<AnnotationCondition>) => void;
  onAddCondition?: () => void;
  onRemoveCondition?: (id: string) => void;
  onActiveSuggestionChange: (id: string | null) => void;
  onSuggestionApply: (conditionId: string, item: SuggestItem) => void;
  onModuleSuggestionApply: (conditionId: string, item: ModuleSuggestItem) => void;
}

export default function AnnotationConditionEditor(props: AnnotationConditionEditorProps) {
  const zh = props.language === "zh";
  const rowsRef = useRef<HTMLDivElement>(null);
  const previousConditionCountRef = useRef(props.conditions.length);

  useEffect(() => {
    if (props.conditions.length > previousConditionCountRef.current && rowsRef.current) {
      rowsRef.current.scrollTop = rowsRef.current.scrollHeight;
    }
    previousConditionCountRef.current = props.conditions.length;
  }, [props.conditions.length]);

  return (
    <div className="dp-manual-stack">
      <div ref={rowsRef} className="dp-query-rows">
        {props.conditions.map((condition) => (
          <div className="dp-query-row" key={condition.id}>
            <select
              value={condition.type}
              onChange={(event) => props.onUpdateCondition(condition.id, {
                type: event.target.value as AnnotationType,
                selected: null,
                moduleSelected: null,
              })}
            >
              {props.annotationTypes.map((type) => (
                <option key={type} value={type}>{annotationTypeLabel(type)}</option>
              ))}
            </select>
            <div className="condition-input-wrap">
              <input
                value={condition.value}
                placeholder={condition.type === "module" ? props.modulePlaceholder : props.annotationPlaceholder}
                onFocus={() => props.onActiveSuggestionChange(condition.id)}
                onChange={(event) => {
                  props.onActiveSuggestionChange(condition.id);
                  props.onUpdateCondition(condition.id, {
                    value: event.target.value,
                    selected: null,
                    moduleSelected: null,
                  });
                }}
              />
              {condition.type === "module" && props.activeSuggestionId === condition.id && condition.value.trim() && props.moduleSuggestions[condition.id]?.length ? (
                <ModuleSuggestionPanel items={props.moduleSuggestions[condition.id]} onPick={(item) => props.onModuleSuggestionApply(condition.id, item)} />
              ) : null}
              {condition.type !== "module" && props.activeSuggestionId === condition.id && condition.value.trim() && props.suggestions[condition.id]?.length ? (
                <SuggestionPanel items={props.suggestions[condition.id]} onPick={(item) => props.onSuggestionApply(condition.id, item)} />
              ) : null}
            </div>
            {props.onAddCondition && props.onRemoveCondition && props.conditions.length > 1 ? (
              <div className="dp-query-row-actions">
                <button type="button" aria-label={zh ? "删除查询行" : "Remove query row"} onClick={() => props.onRemoveCondition?.(condition.id)}>
                  <Minus size={14} aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {props.onAddCondition ? (
        <div className="dp-query-add-row">
          <button type="button" aria-label={zh ? "新增查询行" : "Add query row"} onClick={props.onAddCondition}>
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
