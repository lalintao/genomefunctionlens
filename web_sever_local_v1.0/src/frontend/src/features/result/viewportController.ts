import { useRef, useSyncExternalStore, type SetStateAction } from "react";

import type { TreeViewMode } from "./resultTypes";

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ViewportOffset {
  x: number;
  y: number;
}

export interface ModeFitSnapshot {
  fitScale: number;
}

export interface ViewportSnapshot {
  zoom: number;
  offset: ViewportOffset;
  viewport: ViewportSize;
  fitZoom: number;
  interactionZoom: number;
  rectangular: ModeFitSnapshot;
  circular: ModeFitSnapshot;
  pendingFit: boolean;
  resetCircularFitReference: boolean;
  fitSettled: boolean;
  previousCircularSize: number | null;
}

export interface ViewportController {
  getSnapshot(): ViewportSnapshot;
  subscribe(listener: () => void): () => void;
  setZoom(value: SetStateAction<number>): void;
  setOffset(value: SetStateAction<ViewportOffset>): void;
  setViewport(value: SetStateAction<ViewportSize>): void;
  setFitZoom(value: SetStateAction<number>): void;
  setInteractionZoom(value: SetStateAction<number>): void;
  setModeFitScale(mode: TreeViewMode, value: SetStateAction<number>): void;
  setPendingFit(value: SetStateAction<boolean>): void;
  setResetCircularFitReference(value: SetStateAction<boolean>): void;
  setFitSettled(value: SetStateAction<boolean>): void;
  setPreviousCircularSize(value: SetStateAction<number | null>): void;
  reset(): void;
}

type Listener = () => void;

const INITIAL_VIEWPORT: ViewportSnapshot = Object.freeze({
  zoom: 1,
  offset: Object.freeze({ x: 36, y: 24 }),
  viewport: Object.freeze({ width: 1200, height: 800 }),
  fitZoom: 1,
  interactionZoom: 1,
  rectangular: Object.freeze({ fitScale: 1 }),
  circular: Object.freeze({ fitScale: 1 }),
  pendingFit: false,
  resetCircularFitReference: false,
  fitSettled: true,
  previousCircularSize: null,
});

function resolve<T>(value: SetStateAction<T>, current: T): T {
  return typeof value === "function" ? (value as (current: T) => T)(current) : value;
}

export function createViewportController(initial: ViewportSnapshot = INITIAL_VIEWPORT): ViewportController {
  let state = initial;
  const listeners = new Set<Listener>();
  const commit = (next: ViewportSnapshot) => {
    if (Object.is(next, state)) return;
    state = next;
    listeners.forEach((listener) => listener());
  };
  const update = (patch: Partial<ViewportSnapshot>) => commit({ ...state, ...patch });

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setZoom(value) {
      const zoom = resolve(value, state.zoom);
      if (!Object.is(zoom, state.zoom)) update({ zoom });
    },
    setOffset(value) {
      const offset = resolve(value, state.offset);
      if (!Object.is(offset, state.offset)) update({ offset });
    },
    setViewport(value) {
      const viewport = resolve(value, state.viewport);
      if (!Object.is(viewport, state.viewport)) update({ viewport });
    },
    setFitZoom(value) {
      const fitZoom = resolve(value, state.fitZoom);
      if (!Object.is(fitZoom, state.fitZoom)) update({ fitZoom });
    },
    setInteractionZoom(value) {
      const interactionZoom = resolve(value, state.interactionZoom);
      if (!Object.is(interactionZoom, state.interactionZoom)) update({ interactionZoom });
    },
    setModeFitScale(mode, value) {
      const fitScale = resolve(value, state[mode].fitScale);
      if (Object.is(fitScale, state[mode].fitScale)) return;
      update({ [mode]: { fitScale } });
    },
    setPendingFit(value) {
      const pendingFit = resolve(value, state.pendingFit);
      if (!Object.is(pendingFit, state.pendingFit)) update({ pendingFit });
    },
    setResetCircularFitReference(value) {
      const resetCircularFitReference = resolve(value, state.resetCircularFitReference);
      if (!Object.is(resetCircularFitReference, state.resetCircularFitReference)) update({ resetCircularFitReference });
    },
    setFitSettled(value) {
      const fitSettled = resolve(value, state.fitSettled);
      if (!Object.is(fitSettled, state.fitSettled)) update({ fitSettled });
    },
    setPreviousCircularSize(value) {
      const previousCircularSize = resolve(value, state.previousCircularSize);
      if (!Object.is(previousCircularSize, state.previousCircularSize)) update({ previousCircularSize });
    },
    reset() {
      commit(INITIAL_VIEWPORT);
    },
  };
}

export function useViewportController(): readonly [ViewportSnapshot, ViewportController] {
  const controllerRef = useRef<ViewportController | null>(null);
  if (!controllerRef.current) controllerRef.current = createViewportController();
  const controller = controllerRef.current;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return [snapshot, controller] as const;
}
