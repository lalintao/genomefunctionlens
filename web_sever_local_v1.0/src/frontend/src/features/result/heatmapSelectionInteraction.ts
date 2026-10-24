interface HeatmapSelectionPointerInput {
  isStyleSelecting: boolean;
  button?: number;
  ctrlKey: boolean;
}

export function shouldStartHeatmapMarquee(input: Required<Pick<HeatmapSelectionPointerInput, "isStyleSelecting" | "button" | "ctrlKey">>) {
  return input.isStyleSelecting && input.button === 0 && input.ctrlKey;
}

export function shouldHandleHeatmapCellClick(input: Pick<HeatmapSelectionPointerInput, "isStyleSelecting" | "ctrlKey">) {
  return input.isStyleSelecting && !input.ctrlKey;
}
