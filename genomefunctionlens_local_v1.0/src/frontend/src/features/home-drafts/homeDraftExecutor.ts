import type { BranchCartBatch, BranchCartRecord } from "../result/resultTypes";
import type { TreeCoreRuntime } from "../tree-core/treeCoreTypes";
import { initialTreeViewModeForTerminalCount } from "../workbench/workbenchAppearance";
import type { PreparedWorkbenchState } from "../workbench/workbenchController";
import type { WorkbenchCommand, WorkbenchCommandResult } from "../workbench/workbenchCommandFacade";
import {
  createDatasetWorkbenchReactState,
  executeWorkbenchReactCommand,
  type WorkbenchReactState,
} from "../workbench/workbenchReactBridge";

export type HomeDraftChannel = "manual";

export interface HomeDraftDatasetIdentity {
  readonly speciesTree: string;
  readonly genomeDatabase: string;
  readonly datasetRevision: string;
}

export interface HomeDraftSnapshot {
  readonly channel: HomeDraftChannel;
  readonly datasetIdentity: HomeDraftDatasetIdentity;
  readonly scopeCommitted: boolean;
  readonly state: WorkbenchReactState;
}

export interface HomeDraftPromotion {
  readonly channel: HomeDraftChannel;
  readonly draftRevision: number;
  readonly datasetIdentity: HomeDraftDatasetIdentity;
  readonly state: PreparedWorkbenchState;
}

export interface HomeDraftCartSnapshot {
  aliveBitset: Uint8Array;
  records: BranchCartRecord[];
  batches: BranchCartBatch[];
}

export interface HomeDraftExecutor {
  getSnapshot(channel: HomeDraftChannel): HomeDraftSnapshot | null;
  getOrCreateSnapshot(channel: HomeDraftChannel, rawTree: TreeCoreRuntime): HomeDraftSnapshot | null;
  dispatch(
    channel: HomeDraftChannel,
    rawTree: TreeCoreRuntime,
    command: WorkbenchCommand,
    expectedRevision?: number,
  ): WorkbenchCommandResult | null;
  markScopeCommitted(channel: HomeDraftChannel, expectedRevision: number): boolean;
  restoreCartSnapshot(
    channel: HomeDraftChannel,
    snapshot: HomeDraftCartSnapshot,
    expectedRevision: number,
  ): boolean;
  preparePromotion(channel: HomeDraftChannel, rawTree: TreeCoreRuntime): HomeDraftPromotion | null;
  clear(channel?: HomeDraftChannel): void;
}

interface InternalHomeDraft {
  channel: HomeDraftChannel;
  datasetIdentity: HomeDraftDatasetIdentity;
  scopeCommitted: boolean;
  state: WorkbenchReactState;
}

function datasetIdentity(rawTree: TreeCoreRuntime): HomeDraftDatasetIdentity {
  return Object.freeze({
    speciesTree: rawTree.dataset.species_tree,
    genomeDatabase: rawTree.dataset.genome_database,
    datasetRevision: rawTree.dataset.dataset_revision ?? "unversioned",
  });
}

function identitiesEqual(left: HomeDraftDatasetIdentity, right: HomeDraftDatasetIdentity): boolean {
  return left.speciesTree === right.speciesTree
    && left.genomeDatabase === right.genomeDatabase
    && left.datasetRevision === right.datasetRevision;
}

function createDraft(channel: HomeDraftChannel, rawTree: TreeCoreRuntime): InternalHomeDraft {
  const state = createDatasetWorkbenchReactState(rawTree, {
    displayRank: "class",
    stripRank: "phylum",
  });
  return {
    channel,
    datasetIdentity: datasetIdentity(rawTree),
    scopeCommitted: false,
    state,
  };
}

function snapshot(draft: InternalHomeDraft | null): HomeDraftSnapshot | null {
  if (!draft) return null;
  return Object.freeze({
    channel: draft.channel,
    datasetIdentity: draft.datasetIdentity,
    scopeCommitted: draft.scopeCommitted,
    state: draft.state,
  });
}

export function createHomeDraftExecutor(): HomeDraftExecutor {
  const drafts: Record<HomeDraftChannel, InternalHomeDraft | null> = {
    manual: null,
  };

  const getOrCreate = (channel: HomeDraftChannel, rawTree: TreeCoreRuntime): InternalHomeDraft => {
    const identity = datasetIdentity(rawTree);
    const current = drafts[channel];
    if (!current || !identitiesEqual(current.datasetIdentity, identity)) {
      drafts[channel] = createDraft(channel, rawTree);
    }
    return drafts[channel]!;
  };

  return {
    getSnapshot(channel) {
      return snapshot(drafts[channel]);
    },

    getOrCreateSnapshot(channel, rawTree) {
      return snapshot(getOrCreate(channel, rawTree));
    },

    dispatch(channel, rawTree, command, expectedRevision) {
      const draft = getOrCreate(channel, rawTree);
      const outcome = executeWorkbenchReactCommand(rawTree, draft.state, command, {
        effectiveAliveBitset: draft.state.aliveBitset,
        expectedRevision: expectedRevision ?? draft.state.revision,
      });
      if (!outcome) return null;
      if (outcome.result.accepted) draft.state = outcome.state;
      return outcome.result;
    },

    markScopeCommitted(channel, expectedRevision) {
      const draft = drafts[channel];
      if (!draft || draft.state.revision !== expectedRevision) return false;
      draft.scopeCommitted = true;
      return true;
    },

    restoreCartSnapshot(channel, cart, expectedRevision) {
      const draft = drafts[channel];
      if (!draft || draft.state.revision !== expectedRevision) return false;
      draft.state = {
        ...draft.state,
        cartAliveBitset: Uint8Array.from(cart.aliveBitset),
        branchCartRecords: cart.records.map((record) => ({ ...record, leafNodeIds: [...record.leafNodeIds] })),
        branchCartBatches: cart.batches.map((batch) => ({ ...batch })),
        revision: draft.state.revision + 1,
      };
      return true;
    },

    preparePromotion(channel, rawTree) {
      const draft = drafts[channel];
      if (!draft || !identitiesEqual(draft.datasetIdentity, datasetIdentity(rawTree))) return null;
      const mode = initialTreeViewModeForTerminalCount(draft.state.terminalNodeTable.length);
      const { revision, ...preparedState } = draft.state;
      return Object.freeze({
        channel,
        draftRevision: revision,
        datasetIdentity: draft.datasetIdentity,
        state: Object.freeze({
          ...preparedState,
          treeViewMode: mode,
          taxonNameDisplayMode: mode === "rectangular" ? "embedded" as const : "annotation" as const,
        }),
      });
    },

    clear(channel) {
      if (channel) {
        drafts[channel] = null;
        return;
      }
      drafts.manual = null;
    },
  };
}


