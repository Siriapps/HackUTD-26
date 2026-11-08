# Avon Night Shift — HackUTD ZeroDay (EOG "Beat the Shutdown")

Night-shift operator console for Avon's produced-water network. Detect pipeline leaks, worn pumps and pump
failures from sensor data alone; for every pump failure compute hours-to-shutdown and the cheapest response
(trucks / early well shut-ins / do nothing, trucks shared per system); put the plan in front of the operator,
the lone night technician (Gemini Live on a phone) and the morning crew (Discord / Photon).

Full plan: `docs/PLAN.md`. Challenge spec: `fixtures/SPEC.md`, `fixtures/examples.md`, `fixtures/HISTORY_README.md`.

## Hard rules (judging criteria)
- **Everything comes from the loaded folder's `network.json`, `ops.json`, `telemetry.csv`.** No dataset constants
  in code (no "S1", no 92, no 905, no 6 h). An unseen `public/data/test/` folder (systems S6–S11) must work untouched.
- **Never load `answer_key.json` in the app.** It lives in `fixtures/` for tests only.
- Every page shows the footer **"© 2026 Avon Corps"**. Do **not** use Comic Sans anywhere.
- Alerts order: pump failures first by `hours_to_limit` ascending (tie → higher lost $/hr), then leaks and worn pumps.
- Reference costs in `docs/PLAN.md` ("Reference plan costs to reproduce") must hold; `npm test` asserts them.

## Stack
Next.js 16 (app router, `src/`), TypeScript strict, Tailwind v4, zustand, Recharts, react-leaflet (CARTO dark tiles),
@react-three/fiber + drei, `@google/genai` (Live API via ephemeral tokens), vitest. npm, not pnpm/bun.
Read `node_modules/next/dist/docs/` before using a Next API you are unsure about (this Next version differs from training data).

Commands: `npm run dev` · `npm test` (vitest) · `npm run lint` · `npx tsc --noEmit` · `npm run build`.

## Contract (frozen — changes go in their own PR labelled `contract`)
`src/lib/data/types.ts` defines `Dataset`, `Event`, `Plan`, `Action`, `Analysis`.
`analyse(dataset, nowOverride?) → Analysis` in `src/lib/analyse.ts` is the single entry point; time travel is just
an earlier `nowOverride`. UI never computes physics itself.

Series are keyed `"${asset_id}|${metric}"` → `Float64Array` aligned to `dataset.ts` (unix seconds, 5-min grid).

## Physics cheat-sheet (verified on full_week)
- Level Δ per hour (pct points) = (inflow_bpd − pump_flow_bpd) / 24 / capacity_bbl × 100.
- Running pump: pipeline psi ≈ disposal + 50, discharge ≈ disposal + 150. Off/failed: both ≈ disposal.
- `pump_failure`: pump `status == 2`, flow 0, discharge collapses to disposal psi, tank climbs.
- `pipeline_leak`: while running, `receive_flow_bpd / flow_bpd` drifts 1.00 → 0.96 → 0.90 over ~1 day; pipeline psi −30.
- `pump_degradation`: while running, `flow_bpd / max_flow_bpd` drifts 1.00 → 0.97 → 0.85 over ~1 day; discharge −10; receive ratio stays 1.0.
- Healthy ratios sit at 1.000 ± 0.002, so derive baselines from the loaded folder itself, never hardcode.
- Trucks: all called at plan start, first arrival `response_min`, then every `cycle_min`; each trip removes
  `truck_capacity_bbl` for `cost_per_trip`; every trip must land before repair ends and before the tank trips.
- Shut-in cost = (oil_bpd×oil_per_bbl + gas_mcfd×gas_per_mcf)/24 × hours shut in; latest feasible start is cheapest.
- Horizon = `expected_repair_hours.pump_failure` minus elapsed since onset. At "now" nothing is dispatched: all
  ongoing failures in a system share the whole fleet and are planned jointly.

## Design direction
Dark night-shift control room: near-black navy surfaces, amber = pump failure, cyan = leak, violet = degradation,
green = healthy, mono numerics, dense but calm. Desktop for ops, mobile-first for `/field`. Use the
`frontend-design` and `impeccable` skills for every UI change; screenshot-verify before reporting done.

## Team workflow
- Workstreams and briefs: `docs/workstreams/w1-data-core.md`, `w2-ops-ui.md`, `w3-tech-ai.md`, `w4-twin-forecast.md`.
  Each brief lists owned files; do not edit files owned by another workstream without a PR comment.
- Branch per workstream `ws/w1-data-core` etc. Small PRs to `main`, CI green, squash-merge. Use the `gh` CLI.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Secrets only in `.env.local` (see `.env.example`).
