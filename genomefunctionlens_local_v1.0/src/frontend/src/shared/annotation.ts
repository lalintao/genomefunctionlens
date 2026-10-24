import type { AnnotationType, ModuleSuggestItem, SuggestItem } from "../types";

export function annotationTypeLabel(type: string) {
  if (type === "cog") return "COG";
  if (type === "kegg") return "KEGG";
  if (type === "pfam") return "Pfam";
  if (type === "module") return "Module";
  return type.toUpperCase();
}

export function annotationDisplayValue(item: SuggestItem) {
  return [item.value, item.short_name, item.full_name].filter(Boolean).join(":");
}

export function moduleDisplayValue(item: ModuleSuggestItem) {
  return `${item.module_id} - ${item.module_name}`;
}

export function inferAnnotationType(value: string): AnnotationType {
  const upper = value.trim().toUpperCase();
  if (upper.startsWith("COG")) return "cog";
  if (/^M\d{5}$/.test(upper)) return "module";
  if (upper.startsWith("K")) return "kegg";
  if (upper.startsWith("PF")) return "pfam";
  return "cog";
}
