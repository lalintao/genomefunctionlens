import { useRef, useSyncExternalStore, type SetStateAction } from "react";
import {
  executeWorkbenchReactCommand,
  type WorkbenchReactCommandOptions,
  type WorkbenchReactState,
} from "./workbenchReactBridge";
import type { WorkbenchCommand, WorkbenchCommandResult } from "./workbenchCommandFacade";
import type { TreeCoreRuntime } from "../tree-core/treeCoreTypes";

type Listener = () => void;

export type PreparedWorkbenchState = Omit<WorkbenchReactState, "revision">;

export interface WorkbenchController {
  getSnapshot(): WorkbenchReactState;
  subscribe(listener: Listener): () => void;
  field<K extends keyof WorkbenchReactState>(key: K): (value: SetStateAction<WorkbenchReactState[K]>) => void;
  replace(state: WorkbenchReactState): void;
  promotePrepared(state: PreparedWorkbenchState): number;
  dispatch(
    rawTree: TreeCoreRuntime,
    command: WorkbenchCommand,
    options?: WorkbenchReactCommandOptions,
  ): WorkbenchCommandResult | null;
}


export function createWorkbenchController(initial: WorkbenchReactState, canWrite: () => boolean = () => true): WorkbenchController {
  let state = initial;
  let guard = canWrite;
  const listeners = new Set<Listener>();
  const fields = new Map<keyof WorkbenchReactState, (value: SetStateAction<unknown>) => void>();
  const commit = (next: WorkbenchReactState) => {
    if (Object.is(next, state)) return;
    state = next;
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    field<K extends keyof WorkbenchReactState>(key: K) {
      const cached = fields.get(key);
      if (cached) return cached as (value: SetStateAction<WorkbenchReactState[K]>) => void;
      const setter = (value: SetStateAction<WorkbenchReactState[K]>) => {
        if (!guard()) return;
        const current = state;
        const nextValue = typeof value === "function"
          ? (value as (current: WorkbenchReactState[K]) => WorkbenchReactState[K])(current[key])
          : value;
        if (Object.is(current[key], nextValue)) return;
        commit({ ...current, [key]: nextValue, revision: current.revision + 1 });
      };
      fields.set(key, setter as (value: SetStateAction<unknown>) => void);
      return setter;
    },
    replace(next) {
      commit(next);
    },
    promotePrepared(prepared) {
      const revision = state.revision + 1;
      commit({ ...prepared, revision });
      return revision;
    },
    dispatch(rawTree, command, options = {}) {
      const current = state;
      const outcome = executeWorkbenchReactCommand(rawTree, current, command, {
        ...options,
        effectiveAliveBitset: options.effectiveAliveBitset ?? current.aliveBitset,
      });
      if (!outcome) return null;
      if (outcome.result.accepted) commit(outcome.state);
      return outcome.result;
    },
  };
}

export function useWorkbenchController(
  initialize: () => WorkbenchReactState,
  canWrite: () => boolean,
): readonly [WorkbenchReactState, WorkbenchController] {
  const storeRef = useRef<WorkbenchController | null>(null);
  if (!storeRef.current) storeRef.current = createWorkbenchController(initialize(), canWrite);
  const store = storeRef.current;
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return [snapshot, store] as const;
}
