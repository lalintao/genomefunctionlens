import type { TerminalNodeTableRow } from "./terminalNodeTable";
import type { TreeCoreViewModel } from "./treeCoreView";

export interface CollapseTerminalChoice {
  rank: string;
  label: string;
}

function taxonomicRanks(tree: TreeCoreViewModel) {
  return tree.runtime.ranks.filter(Boolean);
}

/**
 * Finds the next classification resolution for one terminal node. A binding
 * on the same original node wins over bindings deeper in its real subtree.
 */
export function nextAvailableTerminalRank(
  tree: TreeCoreViewModel,
  nodeId: number,
  currentRank: string,
) {
  const ranks = taxonomicRanks(tree);
  const currentRankIndex = ranks.indexOf(currentRank);
  const lowerRanks = ranks.slice(Math.max(0, currentRankIndex + 1));
  const sameNodeRank = lowerRanks.find((rank) => tree.runtime.taxonNameByRankAndNode[rank]?.has(nodeId));
  if (sameNodeRank) return sameNodeRank;
  return lowerRanks.find((rank) => (
    (tree.runtime.rankIndexes[rank] ?? []).some((entry) => tree.isAncestorOf(nodeId, entry.nodeId))
  )) ?? null;
}

/** Returns the coarsest collapse ceiling inherited by terminals below a node. */
export function collapseCeilingRankForNode(
  tree: TreeCoreViewModel,
  nodeId: number,
  terminalRows: readonly TerminalNodeTableRow[],
  fallbackRank: string,
) {
  const ranks = taxonomicRanks(tree);
  const coveredCeilings = terminalRows
    .filter((row) => tree.isAncestorOf(nodeId, row.nodeId))
    .map((row) => row.collapseCeilingRank)
    .filter((rank) => ranks.includes(rank));
  if (!coveredCeilings.length) return fallbackRank;
  return coveredCeilings.reduce((coarsest, rank) => (
    ranks.indexOf(rank) < ranks.indexOf(coarsest) ? rank : coarsest
  ));
}

/**
 * Chooses the label for a collapsed internal node from that node's own taxon
 * bindings only. Descendant bindings must never name the collapsed node.
 */
export function collapseTerminalChoice(
  tree: TreeCoreViewModel,
  nodeId: number,
  collapseCeilingRank: string,
): CollapseTerminalChoice | null {
  const ranks = taxonomicRanks(tree);
  const ceilingIndex = ranks.indexOf(collapseCeilingRank);
  if (ceilingIndex < 0) return null;
  const binding = (tree.runtime.taxonBindingsByNode.get(nodeId) ?? []).find((item) => {
    const bindingRankIndex = ranks.indexOf(item.rank);
    return bindingRankIndex >= 0 && bindingRankIndex <= ceilingIndex;
  });
  return binding ? { rank: binding.rank, label: binding.taxonName } : null;
}

/**
 * A manually named internal node has no taxon rank of its own. Its temporary
 * terminal rank therefore inherits the deepest binding on the nearest named
 * ancestor, so the normal expand transition can continue below that rank.
 */
export function nearestNamedAncestorTerminalRank(
  tree: TreeCoreViewModel,
  nodeId: number,
  fallbackRank: string,
) {
  const ranks = taxonomicRanks(tree);
  let current = tree.parentOf(nodeId);
  while (current >= 0) {
    const bindings = (tree.runtime.taxonBindingsByNode.get(current) ?? [])
      .filter((binding) => ranks.includes(binding.rank));
    if (bindings.length) {
      return bindings.reduce((deepest, binding) => (
        ranks.indexOf(binding.rank) > ranks.indexOf(deepest) ? binding.rank : deepest
      ), bindings[0].rank);
    }
    current = tree.parentOf(current);
  }
  return fallbackRank;
}
