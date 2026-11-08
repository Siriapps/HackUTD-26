# How to prove the answers match theirs

The app never reads `answer_key.json` (the history README forbids it, and judging has none). The proof lives in the
test suite, which reads the keys from `fixtures/` and asserts that `analyse()` on the raw telemetry reproduces them.

## One command, on stage

```
npm test -- --run
```

Expect `Tests  16x passed`. What those tests pin down, by file:

| Test file | What it proves against the key |
|---|---|
| `src/lib/detect/events.test.ts` | All 23 labelled events in `full_week` found with the right category and asset, onsets within 15 min, zero extra events; the three snapshot folders report the right ongoing events. |
| `src/lib/analyse.test.ts` | Countdown `hours_to_limit` within 0.1 h of the key's `hours_to_limit_final`, alert order per spec, `lost_revenue_per_hr` exact, time travel equals analysing the cut folder. |
| `src/lib/plan/optimise.test.ts` | EVENT_9: 1 truck 1 trip **$905**, alternatives **$1,958** (shut in S1_WELL_C2 at +125) and **$5,016** (do nothing); EVENT_6 no action; EVENT_15 **$1,810** as 1 truck × 2 trips; EVENT_18 shut-in **$478**; snapshot 10-09 EVENT_15 **$1,810** as 2 trucks × 1 trip. |
| `src/lib/plan/joint.test.ts` | Shared trucks: EVENT_12 $905 with 1 of 2 free, EVENT_13 **$3,384** with 0 free (shut in S2_WELL_A1 at +189), EVENT_21 **$2,414**; joint snapshot plans $905 / **$1,298** / $905 (S2) and $975 / $905 / $1,215 (S4), fleets 2 of 2 committed. |
| `src/lib/plan/tank.test.ts` | The README opening scene by hand: trips at 4.48 h, one truck → peak 87.5 %, latest shut-in +125 min. |
| `src/lib/forecast/degradation.test.ts` | Every worn pump fits a negative slope and a finite predicted failure; healthy pumps get none. |
| `src/lib/ml/model.test.ts` | The shipped scorer agrees with the rules on every ongoing drift event and raises no warning on the healthy first day. |
| `src/lib/memory/outcomes.test.ts`, `src/lib/calibration/fit.test.ts` | Outcomes derived from telemetry match what the key says happened; recalibration never raises thresholds past the weakest real event. |

## Show it in the UI (same numbers, no key involved)

1. Load `snapshot_2026-10-08T1200`. The three S2 alerts read **$905**, **$1,298** (shut in S2_WELL_C1 at +46 min), **$905**, fleet **2 of 2 committed**. The key's `reference_action` for EVENT_11/12/13 says exactly that.
2. Load `full_week`, open Timeline, scrub to **2026-10-08 00:25**. S1_FACILITY_C shows **$905**, alternatives $1,958 and $5,016: the README's own worked example.
3. Scrub to **2026-10-08 10:05**: S2_FACILITY_A's alert evidence says "0 of 2 trucks free at onset" and the plan is shut in S2_WELL_A1 at +189 min for **$3,384**.
4. Drop the judges' `test/` folder in. Everything recomputes from the three files; the same tests can be pointed at their key afterwards if they share it.

## Synthetic data, honestly

- The telemetry in every folder is EOG's synthetic week. We generated none of it.
- Our own synthetic data is 3,000 early-phase windows made from the physics at measured noise, used only to train the early-warning scorer (`scripts/ml/train.ts`); its held-out numbers are on the Log page.
- The nightly GitHub Action (`nightly-retrain.yml`) refits thresholds, the forecast band and the scorer from resolved outcomes and opens a PR. It ran successfully today; only the "open PR" step waits on the repo permission.
