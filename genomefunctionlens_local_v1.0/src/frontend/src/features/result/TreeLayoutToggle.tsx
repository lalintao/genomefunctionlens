import type { Language } from "../../shared/types";
import type { TreeViewMode } from "./resultTypes";
import { localizedText } from "./resultLabels";

export function nextTreeViewMode(mode: TreeViewMode): TreeViewMode {
  return mode === "rectangular" ? "circular" : "rectangular";
}

export function RectangularTreeIcon() {
  return (
    <svg data-tree-icon="rectangular" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 12h4M7.5 6v12M7.5 6h4.5M7.5 18h4.5M12 3.5v5M12 3.5h6.5M12 8.5h6.5M12 15.5v5M12 15.5h6.5M12 20.5h6.5" />
      <path d="M18.5 2.5v2M18.5 7.5v2M18.5 14.5v2M18.5 19.5v2" />
    </svg>
  );
}

function CircularTreeIcon() {
  return (
    <svg data-tree-icon="circular-binary" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" strokeWidth="1.15" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none" />
      <path d="M12.8 12H14M12 10V7M12 14v2M12 10a2 2 0 0 0 0 4" />
      <path d="M12 7a5 5 0 0 0-4.33 2.5M12 7a5 5 0 0 1 4.33 2.5M7.67 9.5 4.21 7.5M16.33 9.5l3.46-2" />
      <path d="M12 16a4 4 0 0 0-3.46-2M12 16a4 4 0 0 1 2.83-1.17M8.54 14l-4.33 2.5M14.83 14.83l1.41 1.41" />
      <path d="M16.24 16.24a6 6 0 0 0 1.56-2.69M16.24 16.24a6 6 0 0 1-2.69 1.56M17.8 13.55l2.89.78M13.55 17.8l.78 2.89" />
      <g fill="currentColor" stroke="none">
        <circle cx="4.21" cy="7.5" r="0.62" />
        <circle cx="19.79" cy="7.5" r="0.62" />
        <circle cx="4.21" cy="16.5" r="0.62" />
        <circle cx="20.69" cy="14.33" r="0.62" />
        <circle cx="14.33" cy="20.69" r="0.62" />
      </g>
    </svg>
  );
}

export function TreeLayoutToggle(props: {
  language: Language;
  currentMode: TreeViewMode;
  onChange: (mode: TreeViewMode) => void;
}) {
  const targetMode = nextTreeViewMode(props.currentMode);
  const label = targetMode === "rectangular"
    ? localizedText(props.language, "切换到矩形树", "Switch to rectangular tree")
    : localizedText(props.language, "切换到环形树", "Switch to circular tree");

  return (
    <button
      type="button"
      className="viewer-locate-button tree-layout-toggle"
      aria-label={label}
      title={label}
      data-target-layout={targetMode}
      onClick={() => props.onChange(targetMode)}
    >
      {targetMode === "rectangular" ? <RectangularTreeIcon /> : <CircularTreeIcon />}
    </button>
  );
}
