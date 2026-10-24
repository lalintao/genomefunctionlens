import {
  DEFAULT_CIRCULAR_ARC_DEGREES,
  DEFAULT_CIRCULAR_ROTATION_DEGREES,
} from "./resultVisualConstants";

export type CircularTreeLayoutPreset = "three-quarter" | "full" | "upper-half";

export interface CircularTreeLayoutPresetSettings {
  arcDegrees: number;
  rotationDegrees?: number;
  clearColumnLabels: boolean;
  fitView: true;
}

export function circularTreeLayoutPresetSettings(
  preset: CircularTreeLayoutPreset,
): CircularTreeLayoutPresetSettings {
  switch (preset) {
    case "three-quarter":
      return {
        arcDegrees: DEFAULT_CIRCULAR_ARC_DEGREES,
        rotationDegrees: DEFAULT_CIRCULAR_ROTATION_DEGREES,
        clearColumnLabels: false,
        fitView: true,
      };
    case "full":
      return { arcDegrees: 360, clearColumnLabels: true, fitView: true };
    case "upper-half":
      return { arcDegrees: 180, rotationDegrees: 180, clearColumnLabels: false, fitView: true };
  }
}

export function activeCircularTreeLayoutPreset(
  arcDegrees: number,
  rotationDegrees: number,
): CircularTreeLayoutPreset | null {
  if (arcDegrees === 360) return "full";
  if (arcDegrees === 180 && rotationDegrees === 180) return "upper-half";
  if (
    arcDegrees === DEFAULT_CIRCULAR_ARC_DEGREES
    && rotationDegrees === DEFAULT_CIRCULAR_ROTATION_DEGREES
  ) return "three-quarter";
  return null;
}
