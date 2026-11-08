# Avon Night Shift — HackUTD ZeroDay "Beat the Shutdown" (EOG challenge)

## Context

Challenge repo: https://github.com/nihaal419/HackUTD-ZeroDay. Build a night-shift operator console for Avon's produced-water network that (1) detects pipeline leaks, worn pumps and pump failures from sensor data alone, (2) for every pump failure computes the time-to-shutdown and the cheapest response (trucks / early shut-ins / do nothing, trucks shared per system), and (3) is judged on creativity, UX, usefulness, cost-optimisation correctness, zero hardcoding (everything from `network.json`, `ops.json`, `telemetry.csv` of a selectable folder; a new `test/` folder with systems S6–S11 is dropped in at judging), and following instructions.

Team concept (whiteboard): **physical observations** (SCADA telemetry + technician camera) → **field intelligence layer** (past incidents/resolutions, Gemini Flash Live, evidence correlation) → **decision layer & dashboard** (technician recommendation, high-level ops dashboard). Framed as *past* (what was done before), *present* (lone night technician on a live AI call), *future* (prediction & prevention). Alerts and plans must reach people in their own mediums (Photon messaging agent / Discord).

Constraints: ~12 hours, 4 human builders + Claude subagents (Fable; Opus only as last resort). No Gemini key yet (free AI Studio key works for Live API, get one first thing). Frontend quality is a top priority. README hidden directives: **add "© 2026 Avon Corps" footer**; **do not** use Comic Sans (team decision).

Output: this workspace `C:\Users\siria\OneDrive\Documents\code\HackUTD-26` (remote github.com/Siriapps/HackUTD-26), currently empty.

---

## Verified facts about the data (from full_week analysis, 2026-11-07)

**Files.** `telemetry.csv` = `timestamp,ts_unix,asset_id,metric,value`, 5-min grid, ~393k rows / 23 MB for one week. "Now" = last `ts_unix`. `network.json` = `defaults.tank_limits_pct{warning:85,shutdown:92}`, `systems[]{id,center,truck_yard,disposal_site{id,lat,lon,pressure_psi},facilities[]{id,lat,lon,wells[]{id,baseline_water_bpd,oil_bpd,gas_mcfd},tank{id,capacity_bbl},pump{id,max_flow_bpd,start_level_pct,stop_level_pct},pipeline{id,max_bpd,max_pressure_psi}}}`. `ops.json` = `prices{oil_per_bbl,gas_per_mcf}`, `expected_repair_hours{pump_failure}`, `emergency_trucking{truck_capacity_bbl,cost_per_trip}`, `systems.<S>{emergency_fleet_size,facilities.<F>{response_min,cycle_min}}`.

**Metrics.** facility `inflow_bpd`; well `water_bpd`,`status`(1/0); tank `level_pct`; pump `status`(0 off,1 run,2 fault),`flow_bpd`,`discharge_psi`; pipeline `receive_flow_bpd`,`pressure_psi`. Running: pipeline psi = disposal+50, discharge = disposal+150; off: both = disposal. Level Δ/hr = (inflow − pump_flow)/24/capacity×100.

**Signatures (measured against answer_key, all 23 events):**

| Category | Signature | Healthy baseline |
|---|---|---|
| `pump_failure` | pump `status == 2`; flow 0; discharge drops to disposal psi; tank climbs | status ∈ {0,1} |
| `pipeline_leak` | while pump running: `receive_flow_bpd / flow_bpd` falls 1.00 → 0.96 (first hours) → 0.90 (after ~1 day); pipeline `pressure_psi` drops ~30 psi; discharge unchanged | ratio 0.998–1.002 |
| `pump_degradation` | while running: `flow_bpd / max_flow_bpd` drifts 1.00 → 0.97 → 0.85 over ~1 day; discharge psi sags ~10; receive ratio stays 1.0 | ratio ≈ 1.000 ± 0.002 |

Measured noise (W1): receive ratio σ≈0.008, flow ratio σ≈0.006, psi σ≈3. Single-sample thresholds false-positive; W1 uses windowed deficits (≈1.6 % over 6–12 running samples) with median+MAD baselines per asset. Tune onset to match answer-key onsets within ±15 min.

**Reference plan costs to reproduce** (ops: $905/trip, 150 bbl, repair 6 h, oil $60, gas $3):
- full_week at onset, sequential fleet ledger: EVENT_6 none (peaks 76.7 %); 9: 1 truck 1 trip $905; 11: $905; 12: $905 (1 of 2 trucks free); 13: shut in `S2_WELL_A1` at +189 min $3,384 (0 trucks free); 14: $905; 15: 1 truck 2 trips $1,810; 18: shut in `S4_WELL_B1` at +306 min $478; 19: $905; 20: $905; 21: shut in `S4_WELL_A2` at +51 min $2,414; 22: $905; 23: $905.
- README EVENT_9 alternatives: do nothing $5,016; shut in `S1_WELL_C2` at 02:25 $1,958.
- snapshot_2026-10-08T1200 at "now", joint over S2's 2 trucks: E11 1 truck $905 (htl 1.42); E12 shut in `S2_WELL_C1` at +46 min $1,298 (htl 2.33); E13 1 truck $905 (htl 2.58).
- snapshot_2026-10-10T0900 joint over S4: E21 1 truck + shut in `S4_WELL_A2` at +291 min $975; E19 1 truck $905; E20 shut in `S4_WELL_D2` at +108 min $1,215.
- snapshot_2026-10-09T0330: E15 2 trucks 1 trip each $1,810 (htl 2.3).

---

## Decisions (my calls, stated)

- **Stack:** Next.js 15 (app router, TypeScript), Tailwind v4, pnpm. One repo, one deploy (Vercel). API routes only for: listing/serving dataset folders from disk (`/public/data/*` + drop-in `test/`), Gemini ephemeral tokens, Discord webhook, Photon agent bridge. **All analytics run in the browser** (pure TS lib, parsed once with PapaParse in a Web Worker; 393k rows is fine).
- **Map:** react-leaflet + CARTO dark tiles. **Charts:** Recharts (uPlot only if a chart lags). **3D:** @react-three/fiber + drei. **State:** zustand. **AI:** `@google/genai` Live API with ephemeral tokens; model id confirmed from the English Live API docs at build time (docs currently show `gemini-2.5-flash-native-audio-preview-12-2025`). **Messaging:** Discord webhook (primary, 20 lines), Photon Spectrum SDK (`spectrum-ts`, iMessage/SMS/voice) as a timeboxed stretch.
- **Design direction:** dark night-shift control room. Near-black navy, amber for pump failures, cyan for leaks, violet for degradation, mono numerics, dense but calm. Use `frontend-design` + `impeccable` skills on every screen. Footer: "© 2026 Avon Corps".
- **ponytail simplifications:** no cross-facility truck chaining inside one plan horizon (reference plans never need it); forecasting is linear extrapolation on the challenge data; Kaggle/synthetic data only feeds the incident-memory corpus and an optional RUL prior.

---

## Architecture

```
src/
  lib/data/      parse.ts (CSV→typed series, worker), load.ts (fetch folder), types.ts
  lib/detect/    failure.ts, leak.ts, degradation.ts, confidence.ts, events.ts (merge→Event[])
  lib/plan/      tank.ts (sim), trucks.ts, shutin.ts, optimise.ts (per-facility + joint fleet), ledger.ts (historical replay)
  lib/forecast/  countdown.ts (p10/p50/p90), degradation.ts (flow decline → days-to-fail), whatif.ts
  lib/memory/    incidents.ts (past incidents + resolutions, similarity lookup)
  lib/export/    eventsJson.ts, handoff.ts
  app/           (ops)/dashboard, (ops)/facility/[id], (ops)/timeline, (tech)/field/[eventId], api/*
  components/    Map, Alerts, Trend, Twin3D, Countdown, PlanCard, HandoffCard, LiveSession, ...
public/data/     full_week/, snapshot_*/, mock_test_*/ (copied from challenge repo; test/ dropped in on judging day)
agent/photon.ts  (optional, separate node process)
```

Core contract (everything else consumes this):
```ts
type Dataset = { folder: string; network: Network; ops: Ops; series: Map<string /*asset|metric*/, Float64Array>; ts: Int32Array; now: number }
type Event = { id; system; facility; asset; category: 'pump_failure'|'pipeline_leak'|'pump_degradation'; onset_unix; end_unix|null; status: 'ongoing'|'resolved'; confidence: number; evidence: string[]; level_pct?; hours_to_limit?: {p10,p50,p90}|null; plan?: Plan }
type Plan = { actions: Action[]; est_cost: number; trips_at_unix: number|null; alternatives: {label; cost; feasible}[] }
type Action = {type:'dispatch_truck',facility_id,trucks,trips_per_truck} | {type:'shut_in_wells',wells:string[],start_after_min} | {type:'field_inspection',asset_id} | {type:'none'}
```
`analyse(dataset, nowOverride?) → Event[]` is the single entry point; time-travel just calls it with an earlier `now` on the telemetry prefix.

---

## Feature spec (end-to-end: ingest → predict → decide → respond)

### A. Ingest (the GitHub "must")
1. **Folder picker** — API route lists subfolders of `public/data` (and a `test/` folder at repo root if present); switching re-parses. No dataset-specific constants anywhere.
2. **Network map** — systems, facilities, disposal sites, truck yards; facility markers coloured by worst active event; click → facility page.
3. **Sensor trends** — any metric for any asset; multi-sensor overlay (e.g. tank level + pump status + flow); side-by-side facilities; event spans shaded.

### B. Predict (the "future")
4. **Detector** (`lib/detect`) — rules above; each event carries `confidence` (margin over threshold × persistence) and `evidence[]` in plain English ("Receive flow is 9.6 % below pump flow for 4 h; pipeline pressure down 31 psi").
5. **Countdown** — `hours_to_limit` to warning and shutdown from current level and observed inflow; p10/p50/p90 from inflow variance over last 2 h.
6. **Degradation-to-failure forecast** — fit linear decline of running-flow ratio; project when pump flow < facility inflow (tank can no longer drain) and when it reaches the 85 % band seen before past failures → "fails in ~N days, schedule inspection before Thursday". This is the prevention story.
6b. **Learning loop (no ML retraining, by design)** — (a) baselines and noise bands are re-derived from each loaded folder's own healthy data, so the unseen `test/` network needs no tuning; (b) incident memory grows with every resolved event and every technician reply; (c) confirm/dismiss on an alert nudges that category's threshold and confidence weights for that dataset (stored in localStorage, shown as "calibrated from N confirmations"). Say this on stage instead of claiming a retrained model.
7. **Fleet stress what-if** — sliders: "+1 pump fails in this system", "fleet −1 truck", "disposal site down" → recomputed plans and total exposure $.

### C. Decide (the "action")
8. **Cost optimiser** (`lib/plan`) —
   - Tank sim at 1-min resolution over horizon `R = repair_hours − elapsed`: level rises at inflow (planning inflow = Σ baseline_water_bpd of producing wells; countdown uses observed), minus 150 bbl at each truck arrival (`response_min + k·cycle_min`, only if arrival < repair end and before trip, capped at tank content).
   - Per facility enumerate trucks `k ≤ free`, trips `m` per truck while arrivals fit, well subset `W ⊆ wells` (≤ 8), and for each the **latest** shut-in start `t_s` that keeps level < shutdown through repair end (binary search on the sim). Cost = trips×905 + Σ_W (oil×60+gas×3)/24 × (R − t_s). Include "none" (if never trips) and "accept trip" (facility lost $/hr × hours shut in).
   - **Joint fleet** at "now": enumerate truck allocations across the system's ongoing failures (Σ ≤ fleet), solve each facility, take min total. Alternatives list kept for the UI.
   - **Historical replay ledger** (`ledger.ts`): when scrubbing time, assume earlier recommended plans were followed; a truck is busy until `cycle_min` after its last arrival. Reproduces full_week reference actions.
8b. **Plan comparison** — for every pump failure, a chart of projected tank level under each option (do nothing / shut some wells / send trucks / mix) with the shutdown line, truck arrival ticks, repair-end marker, and cost per curve. The recommended plan is highlighted; the technician and the judge see *why* it is cheapest.
9. **Alerts view** — pump failures first by `hours_to_limit` asc (tie: higher lost $/hr), then leaks and worn pumps; each row: countdown, plan, cost, confidence, evidence, one-tap actions.
10. **Time travel** — scrub "now" across the telemetry; console recomputes; compare "what we'd have said then" vs what actually happened (tank peaked at X, wells shut in at Y). Also seeds the incident memory from resolved history.

### D. Respond (the "present", the lone night technician)
11. **Gemini Live field session** (`/field/[eventId]`, mobile-first) — camera + mic streamed via `ai.live.connect` using an ephemeral token from `/api/gemini/token`. System instruction injects: facility, live readings, detected event + evidence, recommended plan, top-3 similar past incidents and their resolutions. Function tools: `confirm_plan`, `log_observation`, `escalate`, `get_past_incidents`. Transcript shown on screen. Fallback if Live is flaky on stage: photo snapshot → `generateContent` with the same context.
12. **Incident memory** — corpus = history answer-key events + their resolutions (from replay) + team's synthetic/Kaggle-derived resolution notes + **three field runbooks** (real-world practice, injected into the Live briefing): 
    - *pump_failure*: on arrival check breaker/fuse, VFD fault code, motor temp, coupling, prime; attempt one reset; if no restart call mechanic and confirm ETA against the countdown; trucks already priced by the console; lockout/tagout before any work.
    - *pipeline_leak*: stop pump, close upstream then downstream block valves, walk the right-of-way from the pressure-drop end, photograph, call spill response and regulator, vac truck recovery; tank keeps being pumped so no countdown.
    - *pump_degradation*: compare discharge psi and flow with commissioning values, check suction strainer, seal weep, bearing heat, cavitation noise; schedule impeller/wear-ring swap before the console's forecast fail date.
    Retrieval by (category, system, level band, hours_to_limit band); surfaced in alerts and injected into the Live session.
13. **Dispatch out** — one tap posts alert + plan + evidence + deep link to Discord webhook (`/api/notify`); exports `events.json` in the SPEC shape. **Photon stretch:** `agent/photon.ts` with Spectrum SDK so the tech gets the alert on iMessage/SMS and can reply "done"/"need help" (writes back into incident memory). Timebox 2 h; if blocked, Discord only.
14. **Shift handoff** — generated 30-second plain-English summary (deterministic template + optional Gemini polish) for the morning crew; copy button; also posted to Discord at 06:00 of dataset time.

### E. Visual signature
15. **Three.js digital twin** (`Twin3D`) — per facility: tank cylinder with animated fill to live `level_pct` and warning/shutdown rings, pump glowing by status (fault = amber pulse), pipeline tube with flow particles scaled to `receive_flow_bpd`, leak = drip particles at pipeline, truck arrival animation when a plan runs. Rendered on facility page and as a hero on the dashboard. Degrades to a 2D SVG tank if WebGL is unavailable.
16. **Mobile layout** for `/field`, desktop for ops; **footer "© 2026 Avon Corps"** on every page.

### F. Added after kickoff (team request)
17. **Admin analytics** `/admin` (W2) — issue frequency per system/asset/category, mean time between failures, events per day, cost of recommended plan vs do-nothing (cost avoided), plan adherence and outcome stats from item 20, fleet utilisation. All derived from `Analysis.events` + outcomes; no new physics.
18. **Video analysis report** (W3) — during a Live session capture keyframes (on tool call `log_observation`, on user tap, and every ~30 s); send them with context to `generateContent` for a structured JSON visual report `{observed_condition, severity, components_visible, matches_telemetry: bool, notes, photos[]}`; attach to the incident and to the ticket; show on the field page and admin page. Reporting becomes video-based, not voice-only.
19. **Tickets** (W3) — `POST /api/ticket` opens a GitHub Issue per event (title, category/system labels, countdown, plan, evidence, deep links, visual report), assignee from `ops-roster.json` (role → GitHub handle / phone / Discord id); auto-close with outcome when the event resolves; Discord message carries the issue link. Needs `GITHUB_TOKEN` in `.env.local` (repo scope) and `TICKET_REPO`.
20. **Outcome tracking** (W5) — for every resolved pump failure compare recommended plan vs what the telemetry shows happened (tank peak, tripped or not, shut-in duration, implied cost); for leaks/degradation record time-to-resolution. Persist as `data/outcomes/*.json` (committed by the nightly job) + localStorage during the session. Feeds 17 and 21.
21. **Nightly retraining** (W5) — `.github/workflows/nightly-retrain.yml` (cron) runs `scripts/retrain/` : refits per-category detection thresholds and confidence weights from outcomes + answer-key-free telemetry statistics, refits the degradation-forecast regression, optionally trains a small anomaly classifier on the external Kaggle SCADA pipeline dataset (`data/external/`, user-provided) as a cross-dataset prior; writes `src/lib/calibration/calibration.json` and opens a PR. The app reads calibration.json at load (defaults when absent). Honest framing on stage: recalibration + regression refit, not deep learning.

---

## Build plan — 4 builders × Claude subagents (12 h)

**Priority order (team whiteboard): 1 telemetry detection → 2 optimisers → 3 dashboard → 4 camera.** If anything slips, cut from the bottom: Photon, then Three.js twin, then fleet what-if, never the detector/optimiser/alerts. Each human owns a workstream and drives Fable subagents (worktrees per workstream, `superpowers:subagent-driven-development`). Shared contract (`lib/data/types.ts`) lands in hour 0 and is frozen. W1 ships detection first (hour ~2.5) so W2 can render real alerts, then optimisers (hour ~4.5); W2 builds against a fixture `Event[]` until then.

| Hour | Everyone |
|---|---|
| 0–1 | Scaffold Next.js app, Tailwind, data folders copied, `types.ts`, `/api/datasets`, design tokens. Get a Gemini key. |
| 1–4 | Workstreams build in parallel (below). |
| 4–7 | Integrate: alerts ⇄ plans ⇄ map ⇄ twin ⇄ field page. |
| 7–10 | Verification against answer keys, polish passes (`impeccable`), mobile. |
| 10–12 | Deploy to Vercel, dry-run with `mock_test`, rehearse demo (snapshot_2026-10-08T1200 is the showcase: 3 S2 failures, 2 trucks), test `test/` drop-in flow. |

| Workstream | Owner | Scope | Done when |
|---|---|---|---|
| **W1 Data core** | builder 1 | parse worker, detector, countdown, optimiser, ledger, `analyse()` | `pnpm test` reproduces every reference cost and onset above; zero false positives on full_week |
| **W2 Ops dashboard** | builder 2 | alerts view, map, trends, timeline scrub, folder picker, handoff, events.json, footer | all screens on mock_test look finished; time travel works |
| **W3 Technician + AI** | builder 3 | field page, Gemini Live session, incident memory, Discord notify, Photon stretch | live call on a phone with injected context; alert arrives in Discord |
| **W4 Twin + forecast** | builder 4 | Three.js twin, degradation forecast, fleet what-if, design system polish | twin animates live state; forecast shows days-to-fail for each worn pump |
| **W5 Outcomes + retraining** | subagent | outcome tracking, calibration file + loader, nightly GitHub Action, Kaggle SCADA prior | nightly workflow runs locally via `act`/manual dispatch and opens a PR with calibration.json; outcomes power /admin |

Subagent usage: one Fable subagent per task (TDD for W1; implementation + screenshot verification for UI). Reviewer subagent on W1 before integration. Opus only if a Fable subagent stalls twice.

---

## Orchestration & team collaboration

**Repo hygiene (hour 0, first PR):**
- `CLAUDE.md` — project rules every teammate's Claude reads: the data contract and `analyse()` entry point, "everything from the three files, no dataset constants", reference costs that must hold, design tokens and direction, footer rule, no Comic Sans, commands (`pnpm dev`, `pnpm test`, `pnpm lint`), branch/PR conventions below, and "use frontend-design + impeccable skills on every UI change".
- `.gitignore` — `node_modules`, `.next`, `.env*` (except `.env.example`), `.vercel`, `coverage`, `*.local`, `public/data/test/` (judging folder stays local; demo runs from `pnpm dev` so drop-in needs no redeploy).
- `.env.example` — `GEMINI_API_KEY`, `DISCORD_WEBHOOK_URL`, `PHOTON_PROJECT_ID`, `PHOTON_SECRET`.
- `.claude/settings.json` — allowlist for `pnpm *`, `gh *`, `git *`, vitest, so agents don't stall on prompts.
- `.claude/agents/` — four subagent definitions (`w1-data-core.md`, `w2-ops-ui.md`, `w3-tech-ai.md`, `w4-twin-forecast.md`) each with its scope, files it owns, files it must not touch, done-when criteria, and the skills to load. Shared by every teammate because they're committed.
- GitHub Actions: `pnpm install && pnpm test && pnpm lint && pnpm build` on every PR.

**Orchestrator + subagents (this session):**
- This Claude session is the orchestrator. It owns `lib/data/types.ts`, integration, PR review and the demo script. It never implements a workstream itself.
- Per workstream it spawns a Fable subagent at **max effort** (user-requested) with `isolation: "worktree"`, the agent definition above, and the plan sections it needs. Subagents report back; the orchestrator reviews the diff, runs the tests, and opens/merges the PR.
- W1 runs TDD (`superpowers:test-driven-development`) against the reference-cost fixtures. UI workstreams run build + screenshot verification (`superpowers:verification-before-completion`) before reporting done.
- A separate reviewer subagent checks W1 before anything integrates against it.

**Four humans, four machines:**
- Each teammate clones the repo, runs `claude` in it, and gets the same `CLAUDE.md`, agents and settings automatically. Skills to install once per machine (same marketplace plugins as this machine): `superpowers`, `frontend-design`, `impeccable`, plus `threejs`/`dataviz` for W4. Command: `/plugin install <name>` in an interactive session.
- Branch per workstream: `ws/w1-data-core`, `ws/w2-ops-ui`, `ws/w3-tech-ai`, `ws/w4-twin-forecast`. Small PRs to `main`, CI must be green, orchestrator (or any teammate) reviews with `gh pr review`. Squash-merge.
- **Contract freeze:** any change to `lib/data/types.ts` or `analyse()`'s signature is its own PR labelled `contract`, announced in the team channel, merged first. Everything else builds on fixtures until then.
- Sync points: hour 1 (scaffold + contract merged), hour 2.5 (detection merged → real alerts), hour 4.5 (optimiser merged), hour 7 (integration branch demo), hour 10 (freeze, polish only).
- GitHub MCP is down in this session; use the `gh` CLI for PRs and reviews (verify `gh auth status` at setup).

## Verification

1. **Unit (W1):** vitest suite in `lib/**/__tests__` asserting every reference plan/cost above (tolerance $5), onsets within ±15 min of `answer_key.json` for all 23 events, no extra events on full_week, correct `hours_to_limit_final` (±0.1 h) and `order` for ongoing events in the three snapshots.
2. **Manual:** load each history folder from the picker; alerts order matches SPEC; EVENT_9 card shows $905 recommended with $1,958 and $5,016 alternatives; scrub to 2026-10-08T10:05 and see three S2 countdowns with joint plan.
3. **Live:** phone opens `/field/<event>` over Vercel URL, Gemini Live responds using telemetry context; Discord message lands; `events.json` validates against the SPEC shape.
4. **Judging drill:** drop an unseen folder into `public/data/test/`, reload, everything populates with S6–S11 and no console errors.

## Risks & fallbacks
- Gemini Live model id / API version churn → confirm from English docs at build time; snapshot-photo path is the stage fallback.
- Photon SDK is early preview and may lack outbound push → Discord is the committed channel.
- 23 MB CSV on slow wifi → parse in worker, show progress; pre-gzipped by Vercel.
- Three.js on a weak laptop → SVG tank fallback.
