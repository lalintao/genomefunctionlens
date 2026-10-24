import type { Language } from "../../shared/types";
import { RANKS, SHAPE_LABEL_EN } from "./resultConstants";
import type { PartitionShape } from "./resultTypes";

export function localizedText(language: Language, zh: string, en: string) {
  return language === "zh" ? zh : en;
}

export function shapeLabel(shape: { value: PartitionShape; label: string }, language: Language) {
  return language === "zh" ? shape.label : SHAPE_LABEL_EN[shape.value];
}

export function allowedStripRanks(displayRank: string) {
  const index = RANKS.indexOf(displayRank);
  return RANKS.slice(0, Math.max(1, index + 1));
}

export function defaultAnnotationRankForLocalRules(
  displayRank: string,
  localRules: readonly { enabled: boolean; expandRank: string }[],
) {
  const displayRankIndex = RANKS.indexOf(displayRank);
  const highestRankIndex = localRules.reduce<number | null>((highest, rule) => {
    if (!rule.enabled) return highest;
    const index = RANKS.indexOf(rule.expandRank);
    if (index < 0) return highest;
    return highest === null || index < highest ? index : highest;
  }, displayRankIndex >= 0 ? displayRankIndex : null);

  if (highestRankIndex === null) return "domain";
  return RANKS[Math.max(0, highestRankIndex - 1)];
}
