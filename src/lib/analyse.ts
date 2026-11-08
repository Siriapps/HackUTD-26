import type { Analysis, Dataset } from "./data/types";

/**
 * Single entry point for all analytics. W1 replaces this stub.
 * Time travel = pass an earlier `nowOverride`; only telemetry at or before it may be used.
 */
export function analyse(dataset: Dataset, nowOverride?: number): Analysis {
  const now = nowOverride ?? dataset.now;
  return { folder: dataset.folder, now, events: [], alerts: [], forecasts: [], fleet: {} };
}
