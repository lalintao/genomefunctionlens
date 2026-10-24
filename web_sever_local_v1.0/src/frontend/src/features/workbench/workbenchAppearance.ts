import type { TreeViewMode } from "../result/resultTypes";
import {
  DEFAULT_CIRCULAR_BRANCH_LABEL_FONT_SIZE,
  DEFAULT_CIRCULAR_HEATMAP_COLUMN_LABEL_FONT_SIZE,
  DEFAULT_CIRCULAR_MODULE_LABEL_FONT_SIZE,
  DEFAULT_RECTANGULAR_BRANCH_LENGTH_FONT_SIZE,
  DEFAULT_BRANCH_SCALE,
  DEFAULT_CIRCULAR_HEATMAP_RING_WIDTH,
  DEFAULT_CIRCULAR_HEATMAP_VALUE_FONT_SIZE,
  DEFAULT_CIRCULAR_BRANCH_LENGTH_FONT_SIZE,
  DEFAULT_CIRCULAR_TAXON_LEGEND_FONT_SIZE,
  DEFAULT_RECTANGULAR_TAXON_LEGEND_FONT_SIZE,
  DEFAULT_CIRCULAR_STRIP_RING_WIDTH,
  DEFAULT_CIRCULAR_ARC_DEGREES,
  DEFAULT_CIRCULAR_ROTATION_DEGREES,
  DEFAULT_HEATMAP_COLUMN_WIDTH,
  DEFAULT_FLOATING_LEGEND_FONT_SIZE,
  DEFAULT_RECTANGULAR_BRANCH_LABEL_FONT_SIZE,
  DEFAULT_RECTANGULAR_HEATMAP_COLUMN_LABEL_FONT_SIZE,
  DEFAULT_RECTANGULAR_MODULE_LABEL_FONT_SIZE,
  DEFAULT_RECTANGULAR_STRIP_LABEL_FONT_SIZE,
  DEFAULT_RECTANGULAR_HEATMAP_VALUE_FONT_SIZE,
  DEFAULT_RECTANGULAR_STRIP_COLUMN_WIDTH,
  DEFAULT_STRIP_LABEL_FONT_SIZE,
  DEFAULT_TREE_BRANCH_STROKE_WIDTH,
  DEFAULT_TREE_SPACING_SCALE,
} from "../result/resultVisualConstants";

export interface TreeFontProfile {
  branchLabel: number;
  branchLength: number;
  speciesCount: number;
  stripLabel: number;
  heatmapValue: number;
  heatmapColumnLabel: number;
  moduleLabel: number;
}

export type TaxonDisplayStyle = "strip" | "background";
export type TaxonNameDisplayMode = "embedded" | "annotation";
export const DEFAULT_TAXON_DISPLAY_STYLE: TaxonDisplayStyle = "background";
export const DEFAULT_TAXON_NAME_DISPLAY_MODE: TaxonNameDisplayMode = "annotation";
export const DEFAULT_STRIP_MINIMUM_LEAF_COUNT = 1;
const CIRCULAR_TREE_TERMINAL_THRESHOLD = 100;

export function initialTreeViewModeForTerminalCount(terminalCount: number): TreeViewMode {
  return terminalCount < CIRCULAR_TREE_TERMINAL_THRESHOLD ? "rectangular" : "circular";
}

export interface WorkbenchAppearanceSnapshot {
  treeViewMode: TreeViewMode;
  showStrip: boolean;
  taxonDisplayStyle: TaxonDisplayStyle;
  taxonNameDisplayMode: TaxonNameDisplayMode;
  taxonLegendFontSize: number;
  rectangularTaxonLegendFontSize: number;
  circularTaxonLegendFontSize: number;
  heatmapLegendFontSize: number;
  rectangularHeatmapLegendFontSize: number;
  circularHeatmapLegendFontSize: number;
  branchScale: number;
  spacingScale: number;
  showStripLabels: boolean;
  stripMinimumLeafCount: number;
  showSpeciesCount: boolean;
  showBranchLabels: boolean;
  forceShowBranchLabels: boolean;
  forceShowStripLabels: boolean;
  forceShowSpeciesCount: boolean;
  branchStrokeWidth: number;
  rectangularFontProfile: TreeFontProfile;
  circularFontProfile: TreeFontProfile;
  rectangularStripColumnWidth: number;
  circularStripRingWidth: number;
  rectangularHeatmapColumnWidth: number;
  circularHeatmapRingWidth: number;
  showInternalNodes: boolean;
  showBranchGuides: boolean;
  showBranchLengths: boolean;
  circularArcDegrees: number;
  circularRotationDegrees: number;
}

export type WorkbenchAppearanceCommand =
  | { type: "set-tree-view-mode"; mode: TreeViewMode }
  | { type: "set-visibility"; key: "showStrip" | "showStripLabels" | "showSpeciesCount" | "showBranchLabels" | "showInternalNodes" | "showBranchGuides" | "showBranchLengths"; visible: boolean }
  | { type: "set-taxon-display"; style?: TaxonDisplayStyle; nameMode?: TaxonNameDisplayMode }
  | { type: "set-legend-font-size"; legend: "taxon" | "heatmap"; value: number }
  | { type: "set-density-override"; key: "forceShowBranchLabels" | "forceShowStripLabels" | "forceShowSpeciesCount"; enabled: boolean }
  | { type: "set-scale"; key: "branchScale" | "spacingScale" | "branchStrokeWidth" | "rectangularStripColumnWidth" | "circularStripRingWidth" | "rectangularHeatmapColumnWidth" | "circularHeatmapRingWidth"; value: number }
  | { type: "set-strip-minimum"; leafCount: number }
  | { type: "set-font-profile"; mode: TreeViewMode; patch: Partial<TreeFontProfile> }
  | { type: "set-circular-geometry"; arcDegrees?: number; rotationDegrees?: number }
  | { type: "replace"; snapshot: WorkbenchAppearanceSnapshot }
  | { type: "reset" };

export const RECTANGULAR_FONT_PROFILE: TreeFontProfile = {
  branchLabel: DEFAULT_RECTANGULAR_BRANCH_LABEL_FONT_SIZE,
  branchLength: DEFAULT_RECTANGULAR_BRANCH_LENGTH_FONT_SIZE,
  speciesCount: DEFAULT_RECTANGULAR_BRANCH_LABEL_FONT_SIZE,
  stripLabel: DEFAULT_RECTANGULAR_STRIP_LABEL_FONT_SIZE,
  heatmapValue: DEFAULT_RECTANGULAR_HEATMAP_VALUE_FONT_SIZE,
  heatmapColumnLabel: DEFAULT_RECTANGULAR_HEATMAP_COLUMN_LABEL_FONT_SIZE,
  moduleLabel: DEFAULT_RECTANGULAR_MODULE_LABEL_FONT_SIZE,
};

export const CIRCULAR_FONT_PROFILE: TreeFontProfile = {
  branchLabel: DEFAULT_CIRCULAR_BRANCH_LABEL_FONT_SIZE,
  branchLength: DEFAULT_CIRCULAR_BRANCH_LENGTH_FONT_SIZE,
  speciesCount: DEFAULT_CIRCULAR_BRANCH_LABEL_FONT_SIZE,
  stripLabel: DEFAULT_STRIP_LABEL_FONT_SIZE,
  heatmapValue: DEFAULT_CIRCULAR_HEATMAP_VALUE_FONT_SIZE,
  heatmapColumnLabel: DEFAULT_CIRCULAR_HEATMAP_COLUMN_LABEL_FONT_SIZE,
  moduleLabel: DEFAULT_CIRCULAR_MODULE_LABEL_FONT_SIZE,
};

export function createWorkbenchAppearance(): WorkbenchAppearanceSnapshot {
  return {
    treeViewMode: "circular",
    showStrip: true,
    taxonDisplayStyle: DEFAULT_TAXON_DISPLAY_STYLE,
    taxonNameDisplayMode: DEFAULT_TAXON_NAME_DISPLAY_MODE,
    taxonLegendFontSize: DEFAULT_CIRCULAR_TAXON_LEGEND_FONT_SIZE,
    rectangularTaxonLegendFontSize: DEFAULT_RECTANGULAR_TAXON_LEGEND_FONT_SIZE,
    circularTaxonLegendFontSize: DEFAULT_CIRCULAR_TAXON_LEGEND_FONT_SIZE,
    heatmapLegendFontSize: DEFAULT_CIRCULAR_TAXON_LEGEND_FONT_SIZE,
    rectangularHeatmapLegendFontSize: DEFAULT_RECTANGULAR_TAXON_LEGEND_FONT_SIZE,
    circularHeatmapLegendFontSize: DEFAULT_CIRCULAR_TAXON_LEGEND_FONT_SIZE,
    branchScale: DEFAULT_BRANCH_SCALE,
    spacingScale: DEFAULT_TREE_SPACING_SCALE,
    showStripLabels: true,
    stripMinimumLeafCount: DEFAULT_STRIP_MINIMUM_LEAF_COUNT,
    showSpeciesCount: false,
    showBranchLabels: true,
    forceShowBranchLabels: false,
    forceShowStripLabels: false,
    forceShowSpeciesCount: false,
    branchStrokeWidth: DEFAULT_TREE_BRANCH_STROKE_WIDTH,
    rectangularFontProfile: { ...RECTANGULAR_FONT_PROFILE },
    circularFontProfile: { ...CIRCULAR_FONT_PROFILE },
    rectangularStripColumnWidth: DEFAULT_RECTANGULAR_STRIP_COLUMN_WIDTH,
    circularStripRingWidth: DEFAULT_CIRCULAR_STRIP_RING_WIDTH,
    rectangularHeatmapColumnWidth: DEFAULT_HEATMAP_COLUMN_WIDTH,
    circularHeatmapRingWidth: DEFAULT_CIRCULAR_HEATMAP_RING_WIDTH,
    showInternalNodes: true,
    showBranchGuides: true,
    showBranchLengths: false,
    circularArcDegrees: DEFAULT_CIRCULAR_ARC_DEGREES,
    circularRotationDegrees: DEFAULT_CIRCULAR_ROTATION_DEGREES,
  };
}

export function copyWorkbenchAppearanceSnapshot(snapshot: WorkbenchAppearanceSnapshot): WorkbenchAppearanceSnapshot {
  return { ...snapshot, rectangularFontProfile: { ...snapshot.rectangularFontProfile }, circularFontProfile: { ...snapshot.circularFontProfile } };
}

export function executeWorkbenchAppearance(
  snapshot: WorkbenchAppearanceSnapshot,
  command: WorkbenchAppearanceCommand,
): { accepted: true; snapshot: WorkbenchAppearanceSnapshot } | { accepted: false; snapshot: WorkbenchAppearanceSnapshot; rejection: string } {
  const accept = (next: WorkbenchAppearanceSnapshot) => ({ accepted: true as const, snapshot: next });
  const reject = (rejection: string) => ({ accepted: false as const, snapshot, rejection });
  switch (command.type) {
    case "set-tree-view-mode": {
      if (command.mode === snapshot.treeViewMode) return reject("Tree view mode is unchanged.");
      return accept({
        ...snapshot,
        treeViewMode: command.mode,
        taxonLegendFontSize: command.mode === "circular" ? snapshot.circularTaxonLegendFontSize : snapshot.rectangularTaxonLegendFontSize,
        heatmapLegendFontSize: command.mode === "circular" ? snapshot.circularHeatmapLegendFontSize : snapshot.rectangularHeatmapLegendFontSize,
        taxonNameDisplayMode: command.mode === "rectangular" ? "embedded" : "annotation",
      });
    }
    case "set-visibility": return snapshot[command.key] === command.visible ? reject("Visibility is unchanged.") : accept({ ...snapshot, [command.key]: command.visible });
    case "set-taxon-display": {
      const next = {
        ...snapshot,
        taxonDisplayStyle: command.style ?? snapshot.taxonDisplayStyle,
        taxonNameDisplayMode: command.nameMode ?? snapshot.taxonNameDisplayMode,
      };
      return next.taxonDisplayStyle === snapshot.taxonDisplayStyle && next.taxonNameDisplayMode === snapshot.taxonNameDisplayMode
        ? reject("Taxon display is unchanged.")
        : accept(next);
    }
    case "set-legend-font-size": {
      const key = command.legend === "taxon" ? "taxonLegendFontSize" : "heatmapLegendFontSize";
      const value = Math.max(1, command.value);
      if (snapshot[key] === value) return reject("Legend font size is unchanged.");
      if (command.legend === "taxon") {
        const modeKey = snapshot.treeViewMode === "circular" ? "circularTaxonLegendFontSize" : "rectangularTaxonLegendFontSize";
        return accept({ ...snapshot, taxonLegendFontSize: value, [modeKey]: value });
      }
      const modeKey = snapshot.treeViewMode === "circular" ? "circularHeatmapLegendFontSize" : "rectangularHeatmapLegendFontSize";
      return accept({ ...snapshot, heatmapLegendFontSize: value, [modeKey]: value });
    }
    case "set-density-override": return snapshot[command.key] === command.enabled ? reject("Density override is unchanged.") : accept({ ...snapshot, [command.key]: command.enabled });
    case "set-scale": {
      const value = Math.max(0.01, command.value);
      return snapshot[command.key] === value ? reject("Visual scale is unchanged.") : accept({ ...snapshot, [command.key]: value });
    }
    case "set-strip-minimum": {
      const leafCount = Math.max(0, Math.floor(command.leafCount));
      return snapshot.stripMinimumLeafCount === leafCount ? reject("Strip minimum is unchanged.") : accept({ ...snapshot, stripMinimumLeafCount: leafCount });
    }
    case "set-font-profile": {
      const key = command.mode === "circular" ? "circularFontProfile" : "rectangularFontProfile";
      const profile = { ...snapshot[key], ...command.patch };
      Object.keys(profile).forEach((role) => { profile[role as keyof TreeFontProfile] = Math.max(1, profile[role as keyof TreeFontProfile]); });
      return accept({ ...snapshot, [key]: profile });
    }
    case "set-circular-geometry": return accept({
      ...snapshot,
      circularArcDegrees: command.arcDegrees ?? snapshot.circularArcDegrees,
      circularRotationDegrees: command.rotationDegrees ?? snapshot.circularRotationDegrees,
    });
    case "replace": {
      const next = copyWorkbenchAppearanceSnapshot(command.snapshot);
      next.rectangularTaxonLegendFontSize ??= next.treeViewMode === "rectangular" ? next.taxonLegendFontSize : DEFAULT_FLOATING_LEGEND_FONT_SIZE;
      next.circularTaxonLegendFontSize ??= next.treeViewMode === "circular" ? next.taxonLegendFontSize : DEFAULT_CIRCULAR_TAXON_LEGEND_FONT_SIZE;
      next.rectangularHeatmapLegendFontSize ??= next.treeViewMode === "rectangular" ? next.heatmapLegendFontSize : DEFAULT_RECTANGULAR_TAXON_LEGEND_FONT_SIZE;
      next.circularHeatmapLegendFontSize ??= next.treeViewMode === "circular" ? next.heatmapLegendFontSize : DEFAULT_CIRCULAR_TAXON_LEGEND_FONT_SIZE;
      next.taxonLegendFontSize = next.treeViewMode === "circular" ? next.circularTaxonLegendFontSize : next.rectangularTaxonLegendFontSize;
      next.heatmapLegendFontSize = next.treeViewMode === "circular" ? next.circularHeatmapLegendFontSize : next.rectangularHeatmapLegendFontSize;
      return accept(next);
    }
    case "reset": return accept(createWorkbenchAppearance());
  }
}
