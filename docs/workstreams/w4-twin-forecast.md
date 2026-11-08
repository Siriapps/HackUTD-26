# W4 — Three.js digital twin, degradation forecast, fleet what-if, design system

**Visual signature + the "future" story.** Cut order if time slips: Photon (W3) → twin polish → what-if. Never the core.

## Owns
`src/components/Twin3D/**`, `src/components/{TankSvg,WhatIf,ForecastCard}*`, `src/lib/forecast/{degradation,whatif}.ts`,
design tokens in `src/app/globals.css` (coordinate with W2; you own colour/typography scale, they own layout).

## Deliverables
1. **Design system** (first hour): tokens in `globals.css` — surfaces (near-black navy ramp), category colours
   (amber failure, cyan leak, violet degradation, green healthy), warning/shutdown accents, mono numerals, type scale,
   radii, focus rings. Document in `docs/DESIGN.md`. No Comic Sans. Use `frontend-design` + `impeccable`.
2. **Twin3D** (`@react-three/fiber` + drei): per facility — tank cylinder with animated fill to `level_pct`, warning
   and shutdown rings, pump body glowing by status (fault = amber pulse), pipeline tube to the disposal site with flow
   particles scaled to `receive_flow_bpd`, leak = drip particles leaving the pipeline, truck arrival animation when a
   plan runs (scrub-driven). Props: `{ facility, readings, event?, plan?, t }`. Must run at 60 fps on an integrated
   GPU; `TankSvg` fallback when WebGL is unavailable. Rendered on the facility page slot and as a dashboard hero.
3. **Degradation forecast** (`src/lib/forecast/degradation.ts`): for each ongoing `pump_degradation`, fit a line to the
   running-flow ratio since onset; project `cannot_drain_unix` (pump flow < facility inflow) and `predicted_fail_unix`
   (ratio reaches the band observed before historical failures in this dataset; fall back to a fixed fraction of
   max_flow if none). Return `DegradationForecast[]` for `Analysis.forecasts`; `ForecastCard` shows "fails in ~N days,
   inspect before <date>".
4. **Fleet what-if** (`src/lib/forecast/whatif.ts` + `WhatIf` panel): sliders "+1 pump fails in this system",
   "fleet −1 truck", "disposal site down" → re-run W1's optimiser with modified inputs; show total exposure $.

## Rules
Everything reads from `dataset`/`Analysis`; no asset ids or limits in code. Keep Three.js bundle lazy-loaded
(`next/dynamic`, `ssr:false`).

## Done when
Twin animates live state for any facility in any folder; forecast cards appear for worn pumps on full_week; what-if
recomputes; design tokens adopted by W2 screens. Screenshots in the PR.

## Skills
`threejs`, `frontend-design`, `impeccable`, `dataviz`, `superpowers:verification-before-completion`.
