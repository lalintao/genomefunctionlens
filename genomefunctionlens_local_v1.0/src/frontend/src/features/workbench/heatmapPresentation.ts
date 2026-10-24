import type { HeatmapStyleRecord, ColumnLabelPart, HeatmapMetric, RatioDisplayMode, TreeViewMode } from "../result/resultTypes";
import { ensureDefaultHeatmapStyles, updateHeatmapStyle } from "../result/heatmapStyleModel";

export interface HeatmapPresentationSnapshot {
  metric: HeatmapMetric;
  ratioDisplayMode: RatioDisplayMode;
  showNumbers: boolean;
  shapeSize: number;
  columnLabelParts: ColumnLabelPart[];
  styles: HeatmapStyleRecord[];
  selectedCellKeys: Set<string>;
  activeModuleId: string;
  showModuleNames: boolean;
  showModuleFullName: boolean;
  showModuleCompleteness: boolean;
  showModuleDetail: boolean;
  moduleCompletenessThreshold: string;
}

export type HeatmapPresentationCommand =
  | { type: "set-metric"; metric: HeatmapMetric }
  | { type: "set-ratio-display"; mode: RatioDisplayMode }
  | { type: "set-show-numbers"; visible: boolean }
  | { type: "set-shape-size"; size: number }
  | { type: "set-column-label-parts"; parts: ColumnLabelPart[] }
  | { type: "replace-styles"; styles: HeatmapStyleRecord[] }
  | { type: "update-style"; styleId: string; patch: Partial<Pick<HeatmapStyleRecord, "paletteId" | "colorScales" | "shape" | "borderMode" | "name">> }
  | { type: "set-selection"; cellKeys: Iterable<string> }
  | { type: "clear-selection" }
  | { type: "set-module-view"; activeModuleId?: string; showNames?: boolean; showFullName?: boolean; showCompleteness?: boolean; showDetail?: boolean; completenessThreshold?: string }
  | { type: "replace"; snapshot: HeatmapPresentationSnapshot }
  | { type: "reset"; treeViewMode: TreeViewMode };

export type HeatmapPresentationResult =
  | { accepted: true; snapshot: HeatmapPresentationSnapshot; aggregateInvalidated: boolean }
  | { accepted: false; snapshot: HeatmapPresentationSnapshot; rejection: string; aggregateInvalidated: false };

export const DEFAULT_SHOW_HEATMAP_NUMBERS = false;

export function createHeatmapPresentation(_treeViewMode: TreeViewMode): HeatmapPresentationSnapshot {
  return {
    metric: "ratio",
    ratioDisplayMode: "percent",
    showNumbers: DEFAULT_SHOW_HEATMAP_NUMBERS,
    shapeSize: 0.82,
    columnLabelParts: ["short_name"],
    styles: ensureDefaultHeatmapStyles([]),
    selectedCellKeys: new Set(),
    activeModuleId: "",
    showModuleNames: false,
    showModuleFullName: false,
    showModuleCompleteness: true,
    showModuleDetail: false,
    moduleCompletenessThreshold: "80",
  };
}

export function copyHeatmapPresentationSnapshot(snapshot: HeatmapPresentationSnapshot): HeatmapPresentationSnapshot {
  return {
    ...snapshot,
    columnLabelParts: [...snapshot.columnLabelParts],
    styles: snapshot.styles.map((style) => ({ ...style, leafCellKeys: [...style.leafCellKeys] })),
    selectedCellKeys: new Set(snapshot.selectedCellKeys),
  };
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function executeHeatmapPresentation(
  snapshot: HeatmapPresentationSnapshot,
  command: HeatmapPresentationCommand,
): HeatmapPresentationResult {
  const accept = (next: HeatmapPresentationSnapshot, aggregateInvalidated = false): HeatmapPresentationResult => ({ accepted: true, snapshot: next, aggregateInvalidated });
  const reject = (reason: string): HeatmapPresentationResult => ({ accepted: false, snapshot, rejection: reason, aggregateInvalidated: false });
  switch (command.type) {
    case "set-metric": return command.metric === snapshot.metric ? reject("Heatmap metric is unchanged.") : accept({ ...snapshot, metric: command.metric });
    case "set-ratio-display": return command.mode === snapshot.ratioDisplayMode ? reject("Ratio display is unchanged.") : accept({ ...snapshot, ratioDisplayMode: command.mode });
    case "set-show-numbers": return command.visible === snapshot.showNumbers ? reject("Number visibility is unchanged.") : accept({ ...snapshot, showNumbers: command.visible });
    case "set-shape-size": {
      const size = Math.max(0.1, Math.min(1, command.size));
      return size === snapshot.shapeSize ? reject("Heatmap shape size is unchanged.") : accept({ ...snapshot, shapeSize: size });
    }
    case "set-column-label-parts": return sameStrings(command.parts, snapshot.columnLabelParts) ? reject("Column labels are unchanged.") : accept({ ...snapshot, columnLabelParts: [...command.parts] });
    case "replace-styles": return accept({ ...snapshot, styles: ensureDefaultHeatmapStyles(command.styles) });
    case "update-style": {
      const nextStyles = updateHeatmapStyle(snapshot.styles, command.styleId, command.patch);
      return nextStyles === snapshot.styles ? reject("Heatmap style is unchanged.") : accept({ ...snapshot, styles: nextStyles });
    }
    case "set-selection": {
      const selectedCellKeys = new Set(command.cellKeys);
      return sameStrings([...selectedCellKeys].sort(), [...snapshot.selectedCellKeys].sort()) ? reject("Heatmap selection is unchanged.") : accept({ ...snapshot, selectedCellKeys });
    }
    case "clear-selection": return snapshot.selectedCellKeys.size ? accept({ ...snapshot, selectedCellKeys: new Set() }) : reject("Heatmap selection is already empty.");
    case "set-module-view": {
      const next = {
        ...snapshot,
        ...(command.activeModuleId !== undefined && { activeModuleId: command.activeModuleId }),
        ...(command.showNames !== undefined && { showModuleNames: command.showNames }),
        ...(command.showFullName !== undefined && { showModuleFullName: command.showFullName }),
        ...(command.showCompleteness !== undefined && { showModuleCompleteness: command.showCompleteness }),
        ...(command.showDetail !== undefined && { showModuleDetail: command.showDetail }),
        ...(command.completenessThreshold !== undefined && { moduleCompletenessThreshold: command.completenessThreshold }),
      };
      const aggregateInvalidated = command.completenessThreshold !== undefined && command.completenessThreshold !== snapshot.moduleCompletenessThreshold;
      return accept(next, aggregateInvalidated);
    }
    case "replace": return accept(copyHeatmapPresentationSnapshot(command.snapshot), true);
    case "reset": return accept(createHeatmapPresentation(command.treeViewMode), true);
  }
}
