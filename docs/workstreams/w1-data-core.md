# W1 — Data core (detector · countdown · optimiser · analyse)

**Priority 1 and 2 of the build order. Nothing demos without this.** Ship detection first (so W2 gets real
alerts), then the optimiser. Work TDD against the answer keys in `fixtures/`.

## Owns
`src/lib/analyse.ts`, `src/lib/detect/**`, `src/lib/plan/**`, `src/lib/forecast/countdown.ts`,
`src/lib/data/load.ts` (may refine), `src/lib/**/*.test.ts`, `fixtures/**` (read-only data).
Does **not** touch `src/app`, `src/components`, or `src/lib/data/types.ts` (contract PR if truly needed).

## Inputs
- Contract: `src/lib/data/types.ts`. Entry point: `analyse(dataset, nowOverride?) → Analysis`.
- Loader: `datasetFromStrings(folder, network, ops, csv)` in `src/lib/data/load.ts` for tests.
- Physics + signatures: `CLAUDE.md` cheat-sheet and `docs/PLAN.md` → "Verified facts about the data".
- Reference numbers: `docs/PLAN.md` → "Reference plan costs to reproduce"; `fixtures/*/answer_key.json`.

## Deliverables
1. **Detector** (`src/lib/detect`): `pump_failure` (status 2), `pipeline_leak` (receive/pump flow ratio while
   running, plus pipeline psi drop), `pump_degradation` (running flow / max_flow drift, discharge sag).
   Baselines derived from the dataset itself (healthy ratio median + MAD over the first clean window), not constants.
   Each event: onset (±15 min of key), end (first return to baseline / pump status leaves 2 / tank resumes draining),
   `confidence` (margin × persistence), 2–4 `evidence` strings with numbers.
   Degrading pump that later fails = two events. Resolved vs ongoing from `now`.
2. **Countdown** (`src/lib/forecast/countdown.ts`): hours to `warning` and `shutdown` from current level and
   observed inflow (last ~1 h mean); p10/p50/p90 from inflow spread. `trips_at_unix`.
3. **Optimiser** (`src/lib/plan`):
   - `tank.ts` 1-minute sim over the horizon: inflow (planning = Σ baseline_water_bpd of producing wells; if a well is
     shut in from t_s its share stops), truck removals at arrival times (capped at tank content, only if before trip
     and before repair end), shutdown clamp. Returns curve, peak, trips_at.
   - `trucks.ts` arrivals `response_min + k·cycle_min`, cost per trip, truck busy until `cycle_min` after last arrival.
   - `shutin.ts` per well subset: latest start keeping peak < shutdown (binary search on the sim); cost
     `(oil×oil_per_bbl + gas×gas_per_mcf)/24 × (horizon_end − t_s)`.
   - `optimise.ts` per facility: enumerate trucks ≤ free, trips while arrivals fit, well subsets (≤ 8), mixes; include
     "none" when the tank never trips and "accept trip" (facility lost $/hr × hours shut in). Pick min cost; keep all
     options as `alternatives` with curves. **Joint fleet** at `now`: enumerate truck allocations across the system's
     ongoing failures (Σ ≤ fleet), minimise total.
   - `ledger.ts` historical replay: when `nowOverride` < dataset.now, assume earlier recommended plans were followed
     so trucks are busy accordingly (reproduces full_week reference actions, e.g. EVENT_13 "0 of 2 trucks free").
4. **analyse.ts**: wires it together; `alerts` in SPEC order (failures by `hours_to_limit.p50` asc, tie higher
   `lost_revenue_per_hr`; then others); `fleet` committed counts; `forecasts` may be `[]` (W4 fills).

## Done when (`npm test` green)
- All 23 full_week events detected with correct category/asset, onset within ±15 min; no extra events.
- Reference costs reproduced within $5: EVENT_9 → $905 recommended, alternatives include $1,958 (shut in S1_WELL_C2)
  and $5,016 (do nothing); EVENT_6 → none; EVENT_15 → $1,810; EVENT_18 → $478; EVENT_13 → $3,384 with 0 trucks free;
  EVENT_21 (at onset, ledger) → $2,414.
- Snapshots at their own `now`: `hours_to_limit_final` within 0.1 h and `order` matches; joint plans match
  (10-08T1200: E11 $905, E12 shut in S2_WELL_C1 at +46 min $1,298, E13 $905; 10-10T0900: E21 $975, E19 $905, E20 $1,215;
  10-09T0330: E15 2 trucks $1,810).
- `analyse(full_week)` runs in < 2 s in Node.

## Skills
`superpowers:test-driven-development`, `superpowers:systematic-debugging`, `superpowers:verification-before-completion`.
