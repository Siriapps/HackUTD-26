import type { Action, Analysis, Dataset, Event } from "@/lib/data/types";
import { fmtClock, fmtDateTime, fmtHours, fmtMoney, fmtPct } from "@/components/format";

/** One-line description of a plan's actions, e.g. "1 truck, 1 trip" or "shut in S2_WELL_C1 at +46 min". */
export function describeActions(actions: Action[]): string {
  if (!actions.length) return "no action";
  return actions
    .map((a) => {
      switch (a.type) {
        case "dispatch_truck":
          return `${a.trucks} truck${a.trucks === 1 ? "" : "s"}, ${a.trips_per_truck} trip${a.trips_per_truck === 1 ? "" : "s"}`;
        case "shut_in_wells":
          return `shut in ${a.wells.join(", ")}${a.start_after_min ? ` at +${a.start_after_min} min` : " now"}`;
        case "field_inspection":
          return `inspect ${a.asset_id}`;
        case "none":
          return "no action needed";
      }
    })
    .join(" + ");
}

export function planLine(e: Event): string {
  if (e.plan) return `${describeActions(e.plan.recommended.actions)} (${fmtMoney(e.plan.recommended.cost)})`;
  return describeActions(e.actions);
}

/**
 * Deterministic 30-second shift handoff. Everything comes from the Analysis + dataset;
 * W3 may run it through Gemini for polish but this text stands on its own.
 */
export function handoffText(analysis: Analysis, dataset: Dataset): string {
  const { alerts, now, fleet } = analysis;
  const failures = alerts.filter((e) => e.category === "pump_failure");
  const leaks = alerts.filter((e) => e.category === "pipeline_leak");
  const worn = alerts.filter((e) => e.category === "pump_degradation");
  const lines: string[] = [];
  lines.push(`Avon night shift handoff — ${fmtDateTime(now)} (${dataset.folder})`);
  if (!alerts.length) {
    lines.push("All systems nominal: no pump failures, leaks or worn pumps in progress.");
  } else {
    lines.push(
      `${count(failures.length, "pump failure")}, ${count(leaks.length, "leak")}, ${count(worn.length, "worn pump")} in progress.`,
    );
  }
  failures.forEach((e, i) => {
    const htl = e.hours_to_limit?.p50;
    const level = e.level_pct != null ? `tank ${fmtPct(e.level_pct)}` : "tank level unknown";
    const cd = htl != null ? `shutdown in ${fmtHours(htl)} (${fmtClock(now + htl * 3600)})` : "no countdown";
    lines.push(`${i + 1}. ${e.facility}: pump failed ${fmtClock(e.onset_unix)}; ${level}, ${cd}. Plan: ${planLine(e)}.`);
  });
  if (leaks.length || worn.length) {
    lines.push(
      `Inspections: ${[...leaks, ...worn]
        .map((e) => `${e.asset} (${e.category === "pipeline_leak" ? "leak" : "wearing out"}: ${e.evidence[0] ?? "see console"})`)
        .join("; ")}.`,
    );
  }
  const committed = Object.entries(fleet).filter(([, f]) => f.committed > 0);
  if (committed.length) {
    lines.push(
      `Trucks: ${committed.map(([sys, f]) => `${sys} ${f.committed} of ${f.size} committed`).join(", ")}; other systems have their full fleet free.`,
    );
  }
  return lines.join("\n");
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
