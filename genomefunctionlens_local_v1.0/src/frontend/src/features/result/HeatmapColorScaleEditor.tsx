import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { ViewportFloatingLayer } from "../../components/floating/viewportFloating";
import type { Language } from "../../shared/types";
import { applyHeatmapColorScheme, colorScalesForStyle, heatmapColorScalesForLevelCount, heatmapLevelCount, HEATMAP_LEVEL_COUNT_OPTIONS, normalizeHeatmapColorScale } from "./heatmapStyleModel";
import { HEATMAP_COLOR_SCHEMES } from "./resultConstants";
import type { HeatmapColorScale, HeatmapMetric, HeatmapStyleRecord } from "./resultTypes";

function text(language: Language, zh: string, en: string) {
  return language === "zh" ? zh : en;
}

function displayBound(value: number, metric: HeatmapMetric) {
  return metric === "ratio" ? Number((value * 100).toFixed(1)) : value;
}

function storedBound(value: string, metric: HeatmapMetric) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? (metric === "ratio" ? parsed / 100 : parsed) : null;
}

export default function HeatmapColorScaleEditor(props: {
  language: Language;
  metric: HeatmapMetric;
  style: HeatmapStyleRecord;
  onChange: (colorScales: HeatmapStyleRecord["colorScales"]) => void;
  onPaletteChange?: (paletteId: string, colorScales: HeatmapStyleRecord["colorScales"]) => void;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteSelectRef = useRef<HTMLDivElement | null>(null);
  const paletteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const paletteOptionsRef = useRef<HTMLDivElement | null>(null);
  const paletteOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const commitFrameRef = useRef<number | null>(null);
  const pendingCommitRef = useRef<HeatmapColorScale | null>(null);
  const rawScales = colorScalesForStyle(props.style);
  const rawScale = rawScales[props.metric];
  const levelCount = heatmapLevelCount(rawScale);
  const scales = rawScale.stops.length === levelCount
    ? rawScales
    : heatmapColorScalesForLevelCount(rawScales, levelCount, props.style.paletteId);
  const scale = scales[props.metric];
  const defaults = colorScalesForStyle({ paletteId: props.style.paletteId, colorScales: undefined })[props.metric];
  const selectedScheme = HEATMAP_COLOR_SCHEMES.find((scheme) => scheme.id === props.style.paletteId);
  const paletteColorsForLevelCount = (schemeId: string) => heatmapColorScalesForLevelCount(scales, levelCount, schemeId).count.stops.map((stop) => stop.color);
  const selectedColors = selectedScheme ? paletteColorsForLevelCount(selectedScheme.id) : scale.stops.map((stop) => stop.color);

  useEffect(() => {
    if (!paletteOpen) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!paletteSelectRef.current?.contains(target) && !paletteOptionsRef.current?.contains(target)) setPaletteOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPaletteOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [paletteOpen]);

  useEffect(() => () => {
    if (commitFrameRef.current !== null) cancelAnimationFrame(commitFrameRef.current);
  }, []);

  function commit(next: HeatmapColorScale) {
    pendingCommitRef.current = normalizeHeatmapColorScale(next, defaults);
    if (commitFrameRef.current !== null) return;
    commitFrameRef.current = requestAnimationFrame(() => {
      commitFrameRef.current = null;
      const pending = pendingCommitRef.current;
      pendingCommitRef.current = null;
      if (pending) props.onChange({ ...scales, [props.metric]: pending });
    });
  }

  function updateStop(index: number, patch: Partial<HeatmapColorScale["stops"][number]>) {
    commit({ stops: scale.stops.map((stop, current) => current === index ? { ...stop, ...patch } : stop) });
  }

  function selectScheme(schemeId: string) {
    const nextScales = applyHeatmapColorScheme(scales, schemeId);
    setPaletteOpen(false);
    if (props.onPaletteChange) props.onPaletteChange(schemeId, nextScales);
    else props.onChange(nextScales);
    requestAnimationFrame(() => paletteTriggerRef.current?.focus());
  }

  function openAndFocusPaletteOption(index: number) {
    setPaletteOpen(true);
    requestAnimationFrame(() => paletteOptionRefs.current[index]?.focus());
  }

  function handlePaletteOptionKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const finalIndex = HEATMAP_COLOR_SCHEMES.length - 1;
      const nextIndex = event.key === "Home" ? 0
        : event.key === "End" ? finalIndex
          : event.key === "ArrowDown" ? Math.min(finalIndex, index + 1)
            : Math.max(0, index - 1);
      paletteOptionRefs.current[nextIndex]?.focus();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setPaletteOpen(false);
      paletteTriggerRef.current?.focus();
    }
  }

  return (
    <div className="heatmap-scale-editor">
      <div className="heatmap-scale-controls">
        <label className="heatmap-level-field">
          <span>{text(props.language, "色阶数量", "Number of levels")}</span>
          <select
            value={levelCount}
            aria-label={text(props.language, "色阶数量", "Number of levels")}
            onChange={(event) => props.onChange(heatmapColorScalesForLevelCount(scales, Number(event.currentTarget.value), props.style.paletteId))}
          >
            {HEATMAP_LEVEL_COUNT_OPTIONS.map((option) => <option key={option} value={option}>{props.language === "zh" ? `${option} 色阶` : `${option} levels`}</option>)}
          </select>
        </label>
        <div className="heatmap-palette-field">
          <span>{text(props.language, "配色方案", "Palette")}</span>
          <div className="heatmap-palette-select" ref={paletteSelectRef}>
            <button
              type="button"
              ref={paletteTriggerRef}
              className="heatmap-palette-trigger"
              aria-haspopup="listbox"
              aria-expanded={paletteOpen}
              aria-label={selectedScheme
                ? text(props.language, `当前配色方案：${selectedScheme.nameZh}`, `Current palette: ${selectedScheme.nameEn}`)
                : text(props.language, "当前为自定义配色", "Current palette: Custom")}
              onClick={() => setPaletteOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                event.preventDefault();
                const selectedIndex = Math.max(0, HEATMAP_COLOR_SCHEMES.findIndex((scheme) => scheme.id === selectedScheme?.id));
                openAndFocusPaletteOption(event.key === "ArrowDown" ? selectedIndex : HEATMAP_COLOR_SCHEMES.length - 1);
              }}
            >
              <span className="heatmap-palette-trigger-copy">
                <span
                  className="heatmap-palette-ramp"
                  aria-hidden="true"
                  style={{ gridTemplateColumns: `repeat(${selectedColors.length}, minmax(0, 1fr))` }}
                >
                  {selectedColors.map((color, index) => <i key={`${color}-${index}`} style={{ backgroundColor: color }} />)}
                </span>
              </span>
              <ChevronDown size={16} aria-hidden="true" />
            </button>
            {paletteOpen ? (
              <ViewportFloatingLayer
                ref={paletteOptionsRef}
                anchorRef={paletteTriggerRef}
                className="heatmap-palette-options"
                role="listbox"
                aria-label={text(props.language, "热图配色方案", "Heatmap palettes")}
                matchAnchorWidth
                maxHeight={360}
                gap={6}
              >
                {HEATMAP_COLOR_SCHEMES.map((scheme, index) => (
                  <button
                    type="button"
                    role="option"
                    ref={(element) => { paletteOptionRefs.current[index] = element; }}
                    aria-selected={scheme.id === selectedScheme?.id}
                    aria-label={props.language === "zh" ? `配色方案 ${index + 1}` : `Palette ${index + 1}`}
                    className="heatmap-palette-option"
                    key={scheme.id}
                    onClick={() => selectScheme(scheme.id)}
                    onKeyDown={(event) => handlePaletteOptionKeyDown(event, index)}
                  >
                    <span
                      className="heatmap-palette-ramp"
                      aria-hidden="true"
                      style={{ gridTemplateColumns: `repeat(${levelCount}, minmax(0, 1fr))` }}
                    >
                      {paletteColorsForLevelCount(scheme.id).map((color, colorIndex) => <i key={`${color}-${colorIndex}`} style={{ backgroundColor: color }} />)}
                    </span>
                  </button>
                ))}
              </ViewportFloatingLayer>
            ) : null}
          </div>
        </div>
      </div>
      <div className="heatmap-scale-ramp" aria-label={text(props.language, "颜色尺度预览", "Color scale preview")}>
        {scale.stops.map((stop, index) => <span key={`${stop.upperBound ?? "max"}-${index}`} style={{ backgroundColor: stop.color }} />)}
      </div>
      <div className="heatmap-scale-table" role="table">
        <div className="heatmap-scale-table-head" role="row">
          <span>{text(props.language, "上界", "Upper bound")}{props.metric === "ratio" ? " (%)" : ""}</span>
          <span>{text(props.language, "颜色", "Color")}</span>
        </div>
        {scale.stops.map((stop, index) => {
          const finalStop = index === scale.stops.length - 1;
          return (
            <div className="heatmap-scale-row" role="row" key={`${stop.upperBound ?? "max"}-${index}`}>
              {finalStop ? <span className="heatmap-scale-maximum">{text(props.language, "最大值", "Maximum")}</span> : (
                <input
                  type="number"
                  min={index === 0 ? 0 : displayBound(scale.stops[index - 1].upperBound ?? 0, props.metric) + (props.metric === "ratio" ? 0.01 : 1)}
                  max={props.metric === "ratio" ? 100 : undefined}
                  step={props.metric === "ratio" ? 0.1 : 1}
                  value={displayBound(stop.upperBound ?? 0, props.metric)}
                  aria-label={text(props.language, "区间上界", "Interval upper bound")}
                  onChange={(event) => {
                    const upperBound = storedBound(event.currentTarget.value, props.metric);
                    if (upperBound !== null) updateStop(index, { upperBound, upperBoundExclusive: props.metric === "ratio" && upperBound === 1 });
                  }}
                />
              )}
              <div className="heatmap-scale-color-field">
                <input type="color" value={stop.color} aria-label={text(props.language, "选择颜色", "Choose color")} onChange={(event) => updateStop(index, { color: event.currentTarget.value.toUpperCase() })} />
                <input
                  key={stop.color}
                  defaultValue={stop.color}
                  aria-label={text(props.language, "十六进制颜色", "Hex color")}
                  onBlur={(event) => {
                    const color = event.currentTarget.value.trim().toUpperCase();
                    if (/^#[0-9A-F]{6}$/.test(color)) updateStop(index, { color });
                    else event.currentTarget.value = stop.color;
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
