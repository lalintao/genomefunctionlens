import type { FigureScenePlan } from "./figureExport";

export interface ScenePlanStore {
  publish(plan: FigureScenePlan): void;
  get(mode: FigureScenePlan["mode"]): FigureScenePlan | null;
}

export function createScenePlanStore(): ScenePlanStore {
  const plans = new Map<FigureScenePlan["mode"], FigureScenePlan>();
  return {
    publish(plan) { plans.set(plan.mode, plan); },
    get(mode) { return plans.get(mode) ?? null; },
  };
}
