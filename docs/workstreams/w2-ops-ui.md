# W2 — Operations dashboard (the judge's screen)

**Priority 3.** Build against a fixture `Analysis` until W1 lands (hour ~2.5 detection, ~4.5 plans), then swap
to the real `analyse()`. Frontend quality is a top judging axis: use `frontend-design` and `impeccable` on every screen.

## Owns
`src/app/(ops)/**` (dashboard, `facility/[id]`, `timeline`), `src/app/layout.tsx`, `src/app/globals.css` (tokens,
coordinate with W4), `src/components/{Alerts,PlanCard,PlanCompare,Map,Trend,Countdown,FolderPicker,TimeScrubber,HandoffCard,Footer}*`,
`src/store/**` (zustand: current folder, dataset, now override, analysis), `src/lib/export/**` (events.json, handoff text).

## Screens
1. **Dashboard** `/` — top bar: folder picker (`/api/datasets`), dataset "now", time-scrub control, Discord
   dispatch button. Left: **alerts list** in SPEC order (countdown ring, category chip, confidence, cost, evidence
   lines, one-tap actions: open plan / open field view / dispatch). Centre: **network map** (react-leaflet, CARTO dark
   tiles, facilities coloured by worst active event, disposal sites, truck yards, system hulls). Right: system fleet
   cards (trucks free / committed), 30-second **shift handoff** card with copy.
2. **Facility** `/facility/[id]` — header with tank gauge, pump state, wells; **PlanCompare** chart (projected level
   curve per option, shutdown line, truck arrival ticks, repair end; recommended highlighted, cost labels); **Trend**
   panel: any metric for any asset, multi-sensor overlay, side-by-side with another facility, event spans shaded.
   Slot for W4's `Twin3D` (render a placeholder box until it exists).
3. **Timeline** `/timeline` — scrub "now" across the whole telemetry; alerts/plans recompute; "what we'd have said
   then" vs what actually happened (peak level, shut-in time). Reuses the same store `nowOverride`.
4. **Exports** — `events.json` in the SPEC shape (`fixtures/SPEC.md` → events.json); handoff summary template
   (deterministic text from `Analysis`; W3 may add Gemini polish).

## Rules
- Nothing hardcoded: every label, limit, price comes from `dataset`. Must look right on `mock_test_2026-10-10T1530`
  and on a folder you have never opened.
- Footer "© 2026 Avon Corps" in `layout.tsx` on every page. No Comic Sans.
- Loading state while the 23 MB CSV streams (progress from `loadDataset`).
- Keep heavy work out of render: `analyse()` runs once per (dataset, nowOverride) in the store.

## Done when
All three screens finished-looking on mock_test; alerts order matches SPEC; time travel works; screenshots attached
to the PR (desktop 1440 and 1024). `npm run build` and `npx tsc --noEmit` clean.

## Skills
`frontend-design`, `impeccable`, `dataviz` (charts), `superpowers:verification-before-completion`.

## Added: `/admin` analytics (plan item 17)
Issue frequency per system/asset/category (bar + heatmap by day×system), MTBF per pump, events per day, cost of
recommended plan vs do-nothing per failure and total cost avoided, plan adherence/outcome stats (from
`src/lib/memory/outcomes.ts` once W5 lands; stub with zeros), fleet utilisation. Derived from `Analysis.events` only.
