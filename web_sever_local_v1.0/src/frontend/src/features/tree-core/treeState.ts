import type { TreeCoreRuntime, TreeCoreTaxonBinding } from "./treeCoreTypes";

export interface LocalRankConstraint {
  nodeId: number;
  expandRank: string;
  /** Taxon identity used to remap one rule to every component after reroot. */
  taxonRank?: string;
  taxonName?: string;
}

/** A control-panel rule. It becomes a drawing constraint only after Apply. */
export interface LocalRankRule extends LocalRankConstraint {
  enabled: boolean;
}

export interface TaxonScopeIdentity {
  taxonRank: string;
  taxonName: string;
  taxonNameNorm: string;
}

export function taxonScopeIdentityForNode(
  tree: TreeCoreRuntime,
  scope: Pick<LocalRankConstraint, "nodeId" | "taxonRank" | "taxonName">,
): TaxonScopeIdentity | null {
  if (scope.taxonRank && scope.taxonName) {
    return {
      taxonRank: scope.taxonRank,
      taxonName: scope.taxonName,
      taxonNameNorm: scope.taxonName.trim().toLowerCase(),
    };
  }
  const bindings = tree.taxonBindingsByNode.get(scope.nodeId) ?? [];
  const binding = bindings.reduce<TreeCoreTaxonBinding | null>((deepest, candidate) => {
    if (!deepest) return candidate;
    return tree.ranks.indexOf(candidate.rank) > tree.ranks.indexOf(deepest.rank) ? candidate : deepest;
  }, null);
  return binding ? {
    taxonRank: binding.rank,
    taxonName: binding.taxonName,
    taxonNameNorm: binding.taxonNameNorm,
  } : null;
}

/** Rebinds taxon-scoped rows to all maximal pure components in a rerooted tree. */
export function remapTaxonScopedNodesAfterReroot<T extends LocalRankConstraint>(
  oldTree: TreeCoreRuntime,
  newTree: TreeCoreRuntime,
  scopes: readonly T[],
  includeNode: (nodeId: number) => boolean = () => true,
) {
  const remapped: T[] = [];
  scopes.forEach((scope) => {
    const identity = taxonScopeIdentityForNode(oldTree, scope);
    if (!identity) {
      if (includeNode(scope.nodeId)) remapped.push({ ...scope });
      return;
    }
    (newTree.rankIndexes[identity.taxonRank] ?? [])
      .filter((entry) => entry.taxonNameNorm === identity.taxonNameNorm && includeNode(entry.nodeId))
      .forEach((entry) => remapped.push({
        ...scope,
        nodeId: entry.nodeId,
        taxonRank: identity.taxonRank,
        taxonName: identity.taxonName,
      }));
  });
  const byTaxonComponent = new Map<string, T>();
  remapped.forEach((scope) => {
    const identity = taxonScopeIdentityForNode(newTree, scope);
    const key = identity
      ? `${identity.taxonRank}\u0000${identity.taxonNameNorm}\u0000${scope.nodeId}`
      : `node\u0000${scope.nodeId}`;
    byTaxonComponent.set(key, scope);
  });
  return Array.from(byTaxonComponent.values()).sort((left, right) => newTree.nodeIn[left.nodeId] - newTree.nodeIn[right.nodeId]);
}

/** Returns the first component assigned incompatible target ranks. */
export function conflictingLocalRankNodeId(scopes: readonly LocalRankConstraint[]) {
  const targetRankByNodeId = new Map<number, string>();
  return scopes.find((scope) => {
    const existingRank = targetRankByNodeId.get(scope.nodeId);
    targetRankByNodeId.set(scope.nodeId, scope.expandRank);
    return existingRank !== undefined && existingRank !== scope.expandRank;
  })?.nodeId ?? null;
}
