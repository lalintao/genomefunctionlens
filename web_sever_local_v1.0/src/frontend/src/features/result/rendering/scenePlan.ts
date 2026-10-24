import { sceneRevisionKey, type SceneRevision } from "./renderContracts";


export interface SceneBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ScenePoint {
  x: number;
  y: number;
}

export type SceneLayerName = "background" | "tree" | "taxonomy" | "heatmap" | "labels" | "overlayBase";

export interface SceneFont {
  family: string;
  size: number;
  weight?: number;
}

export interface SceneRenderObject {
  id: string;
  kind: string;
  layer: SceneLayerName;
  bounds: SceneBounds;
  payload?: unknown;
}

export interface SceneHitRegion {
  kind: string;
  key: string;
  bounds: SceneBounds;
  payload?: unknown;
  contains?: (point: ScenePoint) => boolean;
}

export interface SceneHitIndex {
  resolve(point: ScenePoint): SceneHitRegion | null;
}

export interface ScenePlanBounds {
  focus: SceneBounds;
  content: SceneBounds;
  export: SceneBounds;
}

export interface ScenePlanDependencies {
  semanticKey: string;
  layoutKey: string;
  frameKey: string;
}

export interface ScenePlan<Geometry = unknown> {
  readonly version: "2";
  readonly unit: "graphic";
  readonly mode: "rectangular" | "circular";
  readonly rootAnchor: ScenePoint;
  readonly bounds: ScenePlanBounds;
  readonly partitions: Readonly<Record<string, number>>;
  readonly fonts: Readonly<Record<string, SceneFont>>;
  readonly layers: Readonly<Record<SceneLayerName, readonly SceneRenderObject[]>>;
  readonly hitIndex: SceneHitIndex;
  readonly dependencies: ScenePlanDependencies;
  readonly revision: SceneRevision;
  readonly geometry: Geometry;
}

export function createScenePlan<Geometry>(input: {
  mode: ScenePlan<Geometry>["mode"];
  rootAnchor: ScenePoint;
  bounds: ScenePlanBounds;
  partitions: Readonly<Record<string, number>>;
  fonts: Readonly<Record<string, SceneFont>>;
  layers: Readonly<Record<SceneLayerName, readonly SceneRenderObject[]>>;
  hitIndex: SceneHitIndex;
  semantic: readonly unknown[];
  layout: readonly unknown[];
  frame?: readonly unknown[];
  revision?: Partial<SceneRevision>;
  geometry: Geometry;
}): ScenePlan<Geometry> {
  return Object.freeze({
    version: "2" as const,
    unit: "graphic" as const,
    mode: input.mode,
    rootAnchor: Object.freeze({ ...input.rootAnchor }),
    bounds: Object.freeze({
      focus: Object.freeze({ ...input.bounds.focus }),
      content: Object.freeze({ ...input.bounds.content }),
      export: Object.freeze({ ...input.bounds.export }),
    }),
    partitions: Object.freeze({ ...input.partitions }),
    fonts: Object.freeze({ ...input.fonts }),
    layers: Object.freeze({ ...input.layers }),
    hitIndex: input.hitIndex,
    dependencies: Object.freeze({
      semanticKey: sceneRevisionKey(input.semantic),
      layoutKey: sceneRevisionKey(input.layout),
      frameKey: sceneRevisionKey(input.frame ?? []),
    }),
    revision: Object.freeze({
      semantic: input.revision?.semantic ?? 0,
      layout: input.revision?.layout ?? 0,
      frame: input.revision?.frame ?? 0,
    }),
    geometry: input.geometry,
  });
}

export interface ScenePlanMetadata {
  /** Semantic inputs that determine what is shown. */
  semanticKey: string;
  /** Geometry inputs that determine positions and hit regions. */
  layoutKey: string;
  frameKey: string;
  revision: SceneRevision;
}

export function createScenePlanMetadata(input: {
  semantic: readonly unknown[];
  layout: readonly unknown[];
  frame?: readonly unknown[];
  revision?: Partial<SceneRevision>;
}): ScenePlanMetadata {
  return {
    semanticKey: sceneRevisionKey(input.semantic),
    layoutKey: sceneRevisionKey(input.layout),
    frameKey: sceneRevisionKey(input.frame ?? []),
    revision: {
      semantic: input.revision?.semantic ?? 0,
      layout: input.revision?.layout ?? 0,
      frame: input.revision?.frame ?? 0,
    },
  };
}
