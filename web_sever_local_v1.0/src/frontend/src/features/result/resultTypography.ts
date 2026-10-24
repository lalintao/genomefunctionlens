export const RESULT_FONT_WEIGHTS = {
  branchLabel: 600,
  branchLength: 600,
  speciesCount: 700,
  taxonLabel: 600,
  columnLabel: 500,
  moduleLabel: 500,
  heatmapValue: 700,
  legendTitle: 700,
  legendItem: 700,
} as const;

export type ResultFontRole = keyof typeof RESULT_FONT_WEIGHTS;

export function svgTextAttributes(role: ResultFontRole, fontSize: number) {
  return `font-size="${fontSize}" font-weight="${RESULT_FONT_WEIGHTS[role]}"`;
}
