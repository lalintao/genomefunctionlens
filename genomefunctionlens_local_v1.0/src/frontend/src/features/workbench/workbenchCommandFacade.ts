import { rerootSpecsEqual } from "../tree-core/aliveTreeRuntime";
import type { TreeCoreRuntime } from "../tree-core/treeCoreTypes";
import type { LocalRankConstraint, LocalRankRule } from "../tree-core/treeState";
import type { TerminalNodeTableRow } from "../tree-core/terminalNodeTable";
import { createTreeCoreViewModel } from "../tree-core/treeCoreView";
import { cartWorkspaceApplication, copyCartWorkspaceSnapshot, createCartWorkspace, executeCartWorkspace, type CartWorkspaceCommand, type CartWorkspaceSnapshot } from "./cartWorkspace";
import { createHeatmapPresentation, executeHeatmapPresentation, type HeatmapPresentationCommand, type HeatmapPresentationSnapshot } from "./heatmapPresentation";
import { EMPTY_QUERY_SPECIFICATION, executeQuerySpecification, type QuerySpecificationCommand, type QuerySpecificationSnapshot } from "./querySpecification";
import { captureTreeWorkspaceResetBaseline, createTreeWorkspace, executeTreeWorkspace, type TreeWorkspaceCommand, type TreeWorkspaceInvalidation, type TreeWorkspaceSnapshot } from "./treeWorkspace";
import { createWorkbenchAppearance, executeWorkbenchAppearance, type WorkbenchAppearanceCommand, type WorkbenchAppearanceSnapshot } from "./workbenchAppearance";

interface WorkbenchDomainSnapshot {
  tree: TreeWorkspaceSnapshot;
  cart: CartWorkspaceSnapshot;
  query: QuerySpecificationSnapshot;
  heatmap: HeatmapPresentationSnapshot;
  appearance: WorkbenchAppearanceSnapshot;
}

export interface WorkbenchDatasetIdentity {
  speciesTree: string;
  genomeDatabase: string;
  datasetRevision: string;
}

export interface WorkbenchSnapshot extends WorkbenchDomainSnapshot {
  datasetIdentity: WorkbenchDatasetIdentity;
  revision: number;
}

export type WorkbenchCommand =
  | { type: "tree"; command: TreeWorkspaceCommand }
  | { type: "cart"; command: CartWorkspaceCommand }
  | { type: "query"; command: QuerySpecificationCommand }
  | { type: "heatmap"; command: HeatmapPresentationCommand }
  | { type: "appearance"; command: WorkbenchAppearanceCommand }
  | { type: "apply-cart" }
  | {
    type: "apply-chat-change";
    preparedCart?: CartWorkspaceSnapshot;
    scope?:
      | { type: "cart" }
      | { type: "dataset-default"; displayRank: string; stripRank: string };
    query?: Extract<QuerySpecificationCommand, { type: "replace" | "append" }>;
  };

export const WORKBENCH_COMMAND_SCHEMA_VERSION = 1 as const;

export interface WorkbenchCommandEnvelopeV1 {
  schemaVersion: typeof WORKBENCH_COMMAND_SCHEMA_VERSION;
  datasetIdentity: WorkbenchDatasetIdentity;
  expectedRevision: number;
  command: WorkbenchCommand;
}

export type WorkbenchCommandEnvelope = WorkbenchCommandEnvelopeV1;

export interface WorkbenchInvalidation extends TreeWorkspaceInvalidation {
  query: boolean;
  appearance: boolean;
  aggregate: boolean;
}

const COMMIT_RECEIPT = Symbol("workbench-commit-receipt");

export type WorkbenchCommitReceipt = {
  readonly [COMMIT_RECEIPT]: true;
  readonly committedRevision: number;
  readonly previous: WorkbenchSnapshot;
};

export type WorkbenchCommandResult =
  | { accepted: true; snapshot: WorkbenchSnapshot; invalidation: WorkbenchInvalidation; receipt: WorkbenchCommitReceipt }
  | { accepted: false; snapshot: WorkbenchSnapshot; rejection: string; invalidation: WorkbenchInvalidation };

const NONE: WorkbenchInvalidation = {
  terminalCut: false, heatmap: false, layout: false, treeStyles: false, selection: false, fitView: false,
  query: false, appearance: false, aggregate: false,
};

const ALL: WorkbenchInvalidation = {
  terminalCut: true, heatmap: true, layout: true, treeStyles: true, selection: true, fitView: true,
  query: true, appearance: true, aggregate: true,
};

function shareDomain(snapshot: WorkbenchDomainSnapshot): WorkbenchDomainSnapshot {
  return {
    tree: snapshot.tree,
    cart: snapshot.cart,
    query: snapshot.query,
    heatmap: snapshot.heatmap,
    appearance: snapshot.appearance,
  };
}

export function createWorkbenchSnapshot(rawTree: TreeCoreRuntime, displayRank: string, stripRank: string): WorkbenchSnapshot {
  const tree = createTreeWorkspace(rawTree, displayRank, stripRank);
  return {
    datasetIdentity: {
      speciesTree: rawTree.dataset.species_tree,
      genomeDatabase: rawTree.dataset.genome_database,
      datasetRevision: rawTree.dataset.dataset_revision ?? "unversioned",
    },
    revision: 0,
    tree,
    cart: createCartWorkspace(createTreeCoreViewModel(rawTree)),
    query: EMPTY_QUERY_SPECIFICATION,
    heatmap: createHeatmapPresentation("circular"),
    appearance: createWorkbenchAppearance(),
  };
}

function commit(
  current: WorkbenchSnapshot,
  domain: WorkbenchDomainSnapshot,
  invalidation: WorkbenchInvalidation,
): WorkbenchCommandResult {
  const snapshot = {
    ...domain,
    datasetIdentity: current.datasetIdentity,
    revision: current.revision + 1,
  };
  return {
    accepted: true,
    snapshot,
    invalidation,
    receipt: {
      [COMMIT_RECEIPT]: true,
      committedRevision: snapshot.revision,
      // Every command handler creates new branches and leaves the current
      // snapshot untouched, so the previous snapshot is already immutable.
      previous: current,
    },
  };
}

function reject(current: WorkbenchSnapshot, rejection: string): WorkbenchCommandResult {
  return { accepted: false, snapshot: current, rejection, invalidation: NONE };
}

/** Restore one committed operation without overwriting any intervening edit. */
export function rollbackWorkbenchCommit(
  current: WorkbenchSnapshot,
  receipt: WorkbenchCommitReceipt,
): WorkbenchCommandResult {
  if (receipt?.[COMMIT_RECEIPT] !== true) return reject(current, "The commit receipt is invalid.");
  if (current.revision !== receipt.committedRevision) {
    return reject(current, "The workbench changed after this operation was committed.");
  }
  if (current.datasetIdentity.speciesTree !== receipt.previous.datasetIdentity.speciesTree
    || current.datasetIdentity.genomeDatabase !== receipt.previous.datasetIdentity.genomeDatabase
    || current.datasetIdentity.datasetRevision !== receipt.previous.datasetIdentity.datasetRevision) {
    return reject(current, "The commit receipt belongs to a different dataset.");
  }
  return commit(current, shareDomain(receipt.previous), ALL);
}

function arraysEqual<T>(left: ArrayLike<T>, right: ArrayLike<T>): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function localRankRulesEqual(left: readonly LocalRankRule[], right: readonly LocalRankRule[]): boolean {
  return left.length === right.length && left.every((rule, index) => {
    const candidate = right[index];
    return candidate !== undefined
      && rule.nodeId === candidate.nodeId
      && rule.expandRank === candidate.expandRank
      && rule.taxonRank === candidate.taxonRank
      && rule.taxonName === candidate.taxonName
      && rule.enabled === candidate.enabled;
  });
}

function localRankConstraintsEqual(left: readonly LocalRankConstraint[], right: readonly LocalRankConstraint[]): boolean {
  return left.length === right.length && left.every((constraint, index) => {
    const candidate = right[index];
    return candidate !== undefined
      && constraint.nodeId === candidate.nodeId
      && constraint.expandRank === candidate.expandRank
      && constraint.taxonRank === candidate.taxonRank
      && constraint.taxonName === candidate.taxonName;
  });
}

function terminalRowsEqual(left: readonly TerminalNodeTableRow[], right: readonly TerminalNodeTableRow[]): boolean {
  return left.length === right.length && left.every((row, index) => {
    const candidate = right[index];
    return candidate !== undefined
      && row.nodeId === candidate.nodeId
      && row.rank === candidate.rank
      && row.label === candidate.label
      && row.collapseCeilingRank === candidate.collapseCeilingRank
      && arraysEqual(row.ownedLeafNodeIds, candidate.ownedLeafNodeIds);
  });
}

function stringMapEqual(left: ReadonlyMap<number, string>, right: ReadonlyMap<number, string>): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false;
  }
  return true;
}

function treeStatesEqual(left: TreeWorkspaceSnapshot, right: TreeWorkspaceSnapshot): boolean {
  return left.displayRank === right.displayRank
    && left.stripRank === right.stripRank
    && left.viewRootNodeId === right.viewRootNodeId
    && rerootSpecsEqual(left.runtime.rerootSpec, right.runtime.rerootSpec)
    && arraysEqual(left.runtime.childrenIndex.pool, right.runtime.childrenIndex.pool)
    && arraysEqual(left.aliveBitset, right.aliveBitset)
    && localRankRulesEqual(left.localRankRules, right.localRankRules)
    && localRankConstraintsEqual(left.localRankConstraints, right.localRankConstraints)
    && terminalRowsEqual(left.terminalNodeTable, right.terminalNodeTable)
    && stringMapEqual(left.customTerminalLabels, right.customTerminalLabels);
}

export function executeWorkbenchCommand(
  rawTree: TreeCoreRuntime,
  current: WorkbenchSnapshot,
  command: WorkbenchCommand,
  expectedRevision: number = current.revision,
): WorkbenchCommandResult {
  if (rawTree.dataset.species_tree !== current.datasetIdentity.speciesTree
    || rawTree.dataset.genome_database !== current.datasetIdentity.genomeDatabase
    || (rawTree.dataset.dataset_revision ?? "unversioned") !== current.datasetIdentity.datasetRevision) {
    return reject(current, "The command dataset does not match the active workbench.");
  }
  if (expectedRevision !== current.revision) return reject(current, "The workbench changed while this command was running.");

  if (command.type === "tree") {
    const result = executeTreeWorkspace(rawTree, current.tree, command.command);
    if (!result.accepted) return reject(current, result.rejection);
    const tree = command.command.type === "apply-cart-scope" || command.command.type === "append-leaf-scope"
      ? captureTreeWorkspaceResetBaseline(result.snapshot)
      : result.snapshot;
    return commit(current, { ...shareDomain(current), tree }, { ...NONE, ...result.invalidation, aggregate: result.invalidation.heatmap });
  }
  if (command.type === "cart") {
    const result = executeCartWorkspace(createTreeCoreViewModel(rawTree), current.cart, command.command);
    if (!result.accepted) return reject(current, result.rejection);
    return commit(current, { ...shareDomain(current), cart: result.snapshot }, NONE);
  }
  if (command.type === "query") {
    const result = executeQuerySpecification(current.query, command.command);
    if (!result.accepted) return reject(current, result.rejection);
    // Slots describe presentation only. Moving a column must retain the
    // already aggregated matrix; column identity and terminal scope did not
    // change.
    const aggregate = command.command.type !== "move-column";
    return commit(current, { ...shareDomain(current), query: result.snapshot }, { ...NONE, query: true, heatmap: aggregate, aggregate });
  }
  if (command.type === "heatmap") {
    const result = executeHeatmapPresentation(current.heatmap, command.command);
    if (!result.accepted) return reject(current, result.rejection);
    return commit(current, { ...shareDomain(current), heatmap: result.snapshot }, { ...NONE, heatmap: true, aggregate: result.aggregateInvalidated });
  }
  if (command.type === "appearance") {
    const result = executeWorkbenchAppearance(current.appearance, command.command);
    if (!result.accepted) return reject(current, result.rejection);
    return commit(current, {
      tree: current.tree,
      cart: current.cart,
      query: current.query,
      heatmap: current.heatmap,
      appearance: result.snapshot,
    }, { ...NONE, appearance: true, layout: true });
  }

  if (command.type === "apply-chat-change") {
    let domain = shareDomain(current);
    let invalidation = { ...NONE };
    let scopeChanged = false;
    if (command.preparedCart) {
      if (command.scope?.type !== "cart") {
        return reject(current, "A prepared Cart must be committed with its Cart scope.");
      }
      domain = { ...domain, cart: copyCartWorkspaceSnapshot(command.preparedCart) };
    }
    if (command.scope) {
      const scoped = command.scope.type === "cart"
        ? (() => {
          const application = cartWorkspaceApplication(domain.cart);
          if (!application.leafNodeIds.length) return null;
          const localRankRules = application.localRankConstraints.map((constraint) => ({ ...constraint, enabled: true }));
          return executeTreeWorkspace(rawTree, domain.tree, {
            type: "apply-cart-scope",
            leafNodeIds: application.leafNodeIds,
            localRankRules,
            localRankConstraints: application.localRankConstraints,
          });
        })()
        : executeTreeWorkspace(rawTree, domain.tree, {
          type: "reset-default-tree",
          displayRank: command.scope.displayRank,
          stripRank: command.scope.stripRank,
        });
      if (!scoped) return reject(current, "The cart has no active leaf scope.");
      if (!scoped.accepted) return reject(current, scoped.rejection);
      scopeChanged = !treeStatesEqual(domain.tree, scoped.snapshot);
      if (scopeChanged) {
        domain = { ...domain, tree: captureTreeWorkspaceResetBaseline(scoped.snapshot) };
        invalidation = {
          ...invalidation,
          ...scoped.invalidation,
          treeStyles: true,
          selection: true,
          aggregate: true,
        };
      }
    }
    if (command.query) {
      const queried = executeQuerySpecification(domain.query, command.query);
      const duplicateAppend = !queried.accepted
        && scopeChanged
        && command.query.type === "append"
        && queried.rejection === "The requested columns already exist.";
      if (!queried.accepted && !duplicateAppend) return reject(current, queried.rejection);
      if (queried.accepted) {
        domain = { ...domain, query: queried.snapshot };
        invalidation = { ...invalidation, query: true, heatmap: true, aggregate: true };
      }
    }
    if (!scopeChanged && !command.query) {
      return reject(current, "The requested scope is already active.");
    }
    return commit(current, domain, invalidation);
  }

  if ((command as { type: string }).type !== "apply-cart") {
    return reject(current, "Unsupported workbench command.");
  }
  const application = cartWorkspaceApplication(current.cart);
  if (!application.leafNodeIds.length) return reject(current, "The cart has no active leaf scope.");
  const localRankRules = application.localRankConstraints.map((constraint) => ({ ...constraint, enabled: true }));
  const scoped = executeTreeWorkspace(rawTree, current.tree, {
    type: "apply-cart-scope",
    leafNodeIds: application.leafNodeIds,
    localRankRules,
    localRankConstraints: application.localRankConstraints,
  });
  if (!scoped.accepted) return reject(current, scoped.rejection);
  return commit(current, { ...shareDomain(current), tree: captureTreeWorkspaceResetBaseline(scoped.snapshot) }, {
    ...NONE,
    ...scoped.invalidation,
    treeStyles: true,
    selection: true,
    aggregate: true,
  });
}

export function executeWorkbenchCommandEnvelope(
  rawTree: TreeCoreRuntime,
  current: WorkbenchSnapshot,
  envelope: WorkbenchCommandEnvelope,
): WorkbenchCommandResult {
  if (envelope.schemaVersion !== WORKBENCH_COMMAND_SCHEMA_VERSION) {
    return reject(current, `Unsupported workbench command schema version: ${String(envelope.schemaVersion)}.`);
  }
  if (envelope.datasetIdentity.speciesTree !== current.datasetIdentity.speciesTree
    || envelope.datasetIdentity.genomeDatabase !== current.datasetIdentity.genomeDatabase
    || envelope.datasetIdentity.datasetRevision !== current.datasetIdentity.datasetRevision) {
    return reject(current, "The command envelope targets a different dataset.");
  }
  return executeWorkbenchCommand(rawTree, current, envelope.command, envelope.expectedRevision);
}
