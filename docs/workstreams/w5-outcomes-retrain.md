# W5 — Outcome tracking, calibration, nightly retraining (plan items 20, 21)

## Owns
`src/lib/memory/outcomes.ts`, `src/lib/calibration/**` (calibration.json + loader + typed defaults),
`scripts/retrain/**` (Node/TS, run with `npx tsx`), `.github/workflows/nightly-retrain.yml`, `data/outcomes/**`,
`data/external/README.md` (how to drop the Kaggle SCADA pipeline CSV in; https://www.kaggle.com/datasets/zara2099/scada-pipeline-operations-dataset).

## Deliverables
1. **Outcomes**: `deriveOutcomes(dataset, analysis)` — for each resolved pump failure: tank peak after onset, tripped?
   (wells status→0 while level at shutdown), shut-in hours, implied actual cost, recommended plan cost, delta; for
   leaks/degradation: time-to-resolution. Pure function on the contract types; vitest on full_week.
2. **Calibration**: `calibration.json` schema `{version, generated_at, detect:{leak:{ratio_threshold, min_persist}, degradation:{...}, failure:{...}}, confidence_weights:{...}, forecast:{fail_ratio_band, min_points}, provenance:{outcomes:n, external:n}}`
   + `loadCalibration()` with defaults. W1's detector should read thresholds through this (coordinate: open a tiny PR
   against `ws/w1-data-core` or leave a clear adapter `src/lib/calibration/index.ts` W1 can import).
3. **Retrain script** `scripts/retrain/run.ts`: loads every folder in public/data (never answer keys), computes healthy
   ratio statistics, merges `data/outcomes/*.json`, refits thresholds (maximise separation subject to zero false
   positives on healthy windows), refits degradation regression band, optionally trains a tiny logistic/isolation-forest
   style anomaly scorer on `data/external/*.csv` if present (document schema mapping; skip gracefully if absent),
   writes calibration.json with provenance. Deterministic; < 2 min.
4. **Workflow** `nightly-retrain.yml`: cron 03:00 UTC + `workflow_dispatch`; runs the script; if calibration.json changed,
   opens a PR via `peter-evans/create-pull-request` titled "nightly: recalibration <date>" with a summary table in the body.
   Verify locally with `workflow_dispatch`-equivalent: run the script and show the diff.

## Rules
No answer keys anywhere in scripts. No dataset constants. Honest naming: this is recalibration + regression refit.
