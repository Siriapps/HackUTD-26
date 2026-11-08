"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useOps } from "@/store";
import { useMounted } from "./useMounted";

const ITEMS = [
  { href: "/", label: "Board", hint: "Alerts by time to shutdown", icon: "M3 5h18v4H3zM3 11h11v8H3zM16 11h5v8h-5z", match: (p: string) => p === "/" || p.startsWith("/alert") || p.startsWith("/facility") },
  { href: "/timeline", label: "Timeline", hint: "Replay the week", icon: "M3 12h18M7 8v8M12 6v12M17 9v6", match: (p: string) => p.startsWith("/timeline") },
  { href: "/dispatch", label: "On-call", hint: "Texts and replies", icon: "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM10 18h4", match: (p: string) => p.startsWith("/dispatch") },
  { href: "/handoff", label: "Handoff", hint: "Morning brief", icon: "M4 6h16M4 12h10M4 18h7", match: (p: string) => p.startsWith("/handoff") },
  { href: "/log", label: "Log", hint: "Events, resolutions, reports", icon: "M4 5h16v15H4zM4 9h16M9 5V3M15 5V3", match: (p: string) => p.startsWith("/log") },
  { href: "/landing", label: "Story", hint: "The pitch", icon: "M5 4l14 8-14 8z", match: (p: string) => p.startsWith("/landing") },
];
const KEY = "flare:rail";

/** Left rail: the places. Collapses to icons; the choice is remembered. */
export function SideRail() {
  const pathname = usePathname();
  const mounted = useMounted();
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return localStorage.getItem(KEY) !== "closed";
    } catch {
      return true;
    }
  });
  const alerts = useOps((s) => s.analysis?.alerts.length ?? 0);
  const failing = useOps((s) => s.analysis?.alerts.filter((e) => e.category === "pump_failure").length ?? 0);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(KEY, next ? "open" : "closed");
    } catch {
      /* private mode */
    }
  };
  const expanded = mounted ? open : true;

  return (
    <nav className={`rail ${expanded ? "rail--open" : "rail--closed"}`} aria-label="Sections">
      <div className="rail__top">
        <Link href="/" className="rail__brand brand" aria-label="Flare home">
          {expanded ? "Flare" : "F"}
        </Link>
        <button type="button" className="rail__toggle" onClick={toggle} aria-expanded={expanded} aria-label={expanded ? "Collapse navigation" : "Expand navigation"} title={expanded ? "Collapse" : "Expand"}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={expanded ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
          </svg>
        </button>
      </div>
      <ul>
        {ITEMS.map((it) => {
          const active = it.match(pathname);
          return (
            <li key={it.href}>
              <Link href={it.href} className={`rail__item ${active ? "is-active" : ""}`} aria-current={active ? "page" : undefined} title={expanded ? undefined : `${it.label} · ${it.hint}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={it.icon} />
                </svg>
                <span className="rail__text">
                  <span className="rail__label">{it.label}</span>
                  {expanded && <span className="rail__hint">{it.hint}</span>}
                </span>
                {it.href === "/" && alerts > 0 && (
                  <span className="rail__badge num" style={{ background: failing ? "var(--cat-failure)" : "var(--surface-3)", color: failing ? "var(--text-inverse)" : "var(--text-2)" }}>
                    {alerts}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="rail__foot">
        <span className="live-dot" />
        {expanded && <span>night shift</span>}
      </div>
    </nav>
  );
}
