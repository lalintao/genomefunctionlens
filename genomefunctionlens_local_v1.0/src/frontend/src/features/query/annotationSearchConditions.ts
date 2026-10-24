import type { AnnotationCondition, ModuleSuggestItem, SuggestItem } from "../../types";

export type AnnotationSearchConditionPreparation =
  | { conditions: AnnotationCondition[]; ambiguity: null }
  | { conditions: AnnotationCondition[]; ambiguity: { conditionId: string; kind: "annotation" | "module" } };

function matchingAnnotations(items: SuggestItem[], value: string) {
  const normalized = value.trim().toLowerCase();
  return items.filter((item) => (
    item.value.toLowerCase() === normalized
    || item.short_name?.toLowerCase() === normalized
    || item.full_name?.toLowerCase() === normalized
  ));
}

function matchingModules(items: ModuleSuggestItem[], value: string) {
  const normalized = value.trim().toLowerCase();
  return items.filter((item) => (
    item.module_id.toLowerCase() === normalized
    || item.module_name.toLowerCase() === normalized
    || item.label.toLowerCase() === normalized
  ));
}

/** Selects an unambiguous suggestion without issuing a request or changing UI state. */
export function prepareAnnotationSearchConditions(
  conditions: AnnotationCondition[],
  annotationSuggestions: Record<string, SuggestItem[]>,
  moduleSuggestions: Record<string, ModuleSuggestItem[]>,
): AnnotationSearchConditionPreparation {
  const prepared = conditions.map((condition) => {
    if (condition.type === "module" || condition.moduleSelected) {
      if (condition.moduleSelected) return condition;
      const candidates = moduleSuggestions[condition.id] ?? [];
      const exact = matchingModules(candidates, condition.value);
      if (exact.length === 1) return { ...condition, moduleSelected: exact[0] };
      if (candidates.length === 1) return { ...condition, moduleSelected: candidates[0] };
      return condition;
    }

    if (condition.selected) return condition;
    const candidates = annotationSuggestions[condition.id] ?? [];
    const exact = matchingAnnotations(candidates, condition.value);
    if (exact.length === 1) return { ...condition, selected: exact[0] };
    if (candidates.length === 1) return { ...condition, selected: candidates[0] };
    return condition;
  });

  for (const condition of prepared) {
    if (condition.type === "module") {
      if (condition.moduleSelected) continue;
      const candidates = moduleSuggestions[condition.id] ?? [];
      if (candidates.length > 1 && matchingModules(candidates, condition.value).length !== 1) {
        return { conditions: prepared, ambiguity: { conditionId: condition.id, kind: "module" } };
      }
      continue;
    }

    if (condition.selected) continue;
    const candidates = annotationSuggestions[condition.id] ?? [];
    if (candidates.length > 1 && matchingAnnotations(candidates, condition.value).length !== 1) {
      return { conditions: prepared, ambiguity: { conditionId: condition.id, kind: "annotation" } };
    }
  }

  return { conditions: prepared, ambiguity: null };
}
