import { useEffect, useMemo, useState } from "react";

import { fetchTreeCoreFile, fetchTreeCoreSummary } from "../../api";
import type { DatasetItem } from "../../types";
import { createTreeCoreSession } from "./treeCoreRuntime";
import type { TreeCoreLoadState } from "./treeCoreTypes";

const idleTreeCoreState: TreeCoreLoadState = {
  status: "idle",
  dataset: null,
  session: null,
  error: null,
};

export function useTreeCoreBootstrap(dataset: DatasetItem | null, prepared: TreeCoreLoadState | null = null): TreeCoreLoadState {
  const [state, setState] = useState<TreeCoreLoadState>(idleTreeCoreState);

  const ready = useMemo(() => prepared?.status === "ready" && dataset
    && prepared.dataset.species_tree === dataset.species_tree
    && prepared.dataset.genome_database === dataset.genome_database
    && prepared.dataset.dataset_revision === dataset.dataset_revision ? prepared : null, [dataset, prepared]);

  useEffect(() => {
    if (ready) { setState(ready); return; }
    if (!dataset) {
      setState(idleTreeCoreState);
      return;
    }

    let cancelled = false;

    const loadTreeCore = async () => {
      setState({
        status: "loading",
        dataset,
        session: null,
        error: null,
      });

      try {
        const summary = await fetchTreeCoreSummary(dataset.species_tree, dataset.genome_database);
        const archive = await fetchTreeCoreFile(summary.tree_core_download_url);
        const session = await createTreeCoreSession(dataset, summary, archive);
        if (cancelled) {
          return;
        }
        setState({
          status: "ready",
          dataset,
          session,
          error: null,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setState({
          status: "error",
          dataset,
          session: null,
          error: error instanceof Error ? error.message : "Failed to load tree core.",
        });
      }
    };

    void loadTreeCore();

    return () => {
      cancelled = true;
    };
  }, [dataset?.genome_database, dataset?.species_tree, dataset?.dataset_revision, ready]);

  return ready ?? state;
}
