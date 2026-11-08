import type { Category, Event } from "@/lib/data/types";

export const CATEGORY: Record<Category, { label: string; short: string; mark: string; ink: string; wash: string }> = {
  pump_failure: {
    label: "Pump failure",
    short: "Failure",
    mark: "var(--cat-failure-mark)",
    ink: "var(--cat-failure)",
    wash: "var(--cat-failure-soft)",
  },
  pipeline_leak: { label: "Pipeline leak", short: "Leak", mark: "var(--cat-leak-mark)", ink: "var(--cat-leak)", wash: "var(--cat-leak-soft)" },
  pump_degradation: {
    label: "Worn pump",
    short: "Worn",
    mark: "var(--cat-degradation-mark)",
    ink: "var(--cat-degradation)",
    wash: "var(--cat-degradation-soft)",
  },
};

const SEVERITY: Record<Category, number> = { pump_failure: 3, pipeline_leak: 2, pump_degradation: 1 };

/** Highest-severity ongoing event among a list (failure > leak > worn). */
export function worstEvent(events: Event[]): Event | undefined {
  let best: Event | undefined;
  for (const e of events) if (!best || SEVERITY[e.category] > SEVERITY[best.category]) best = e;
  return best;
}

/** 16px glyphs, one 1.5px stroke family. */
export function CategoryIcon({ category, size = 14 }: { category: Category; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (category) {
    case "pump_failure":
      // pump with a broken drive line
      return (
        <svg {...common}>
          <circle cx="8" cy="9" r="4.5" />
          <path d="M8 4.5V1.5M5 2.5l1.2 2M11 2.5l-1.2 2" />
          <path d="M6 9.5l1.5-1.5L9 10l1.5-2" />
        </svg>
      );
    case "pipeline_leak":
      // pipe with a drop
      return (
        <svg {...common}>
          <path d="M1.5 5.5h13M1.5 8.5h5M9.5 8.5h5" />
          <path d="M8 9.2c-1.2 1.6-1.8 2.6-1.8 3.4a1.8 1.8 0 0 0 3.6 0c0-.8-.6-1.8-1.8-3.4Z" />
        </svg>
      );
    case "pump_degradation":
      // declining flow
      return (
        <svg {...common}>
          <path d="M1.5 4.5c2 0 2.5 2 4.5 2s2.5-2 4.5-2 2.5 2 4 2" />
          <path d="M1.5 9.5c2 0 2.5 2 4.5 2s2.5-2 4.5-2" strokeDasharray="1 2.2" />
          <path d="M11 14l3.5-3.5M14.5 14v-3.5H11" />
        </svg>
      );
  }
}

export function CategoryChip({ category, compact = false }: { category: Category; compact?: boolean }) {
  const c = CATEGORY[category];
  return (
    <span className="chip" style={{ background: c.wash, color: c.ink }}>
      <CategoryIcon category={category} size={12} />
      {compact ? c.short : c.label}
    </span>
  );
}
