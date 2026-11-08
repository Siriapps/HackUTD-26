# data/external — optional cross-dataset prior

Drop the Kaggle **SCADA Pipeline Operations Dataset** (https://www.kaggle.com/datasets/zara2099/scada-pipeline-operations-dataset, CC0, simulated digital-twin SCADA data with event labels *Normal / surge / leak / blockage / degradation*) here as one or more `*.csv` files, e.g.

```
data/external/scada_pipeline_operations.csv
```

`npx tsx scripts/retrain/run.ts` then fits a tiny anomaly scorer on it and stores it as `external_prior` in `src/lib/calibration/calibration.json` (`provenance.external` = rows used). Without a CSV the step is skipped and the calibration says so. CSVs are gitignored (too big for the repo); the nightly job only sees them if a small sample is committed deliberately.

## Schema mapping (inferred, override if wrong)

Kaggle does not publish the column list for this dataset, so the script maps columns by name:

| Role | Rule | Notes |
|---|---|---|
| Features (≤ 8) | numeric columns whose header matches `flow`, `pressure`, `temp`, `speed`, `rpm`, `power`, `energy`, `vibration`, `current`, `level`, `density`, `viscosity` | rows with a missing feature are dropped |
| Label | first header matching `label`, `class`, `event`, `fault`, `anomaly`, `status`, `target`, `condition`, `state` | values `0`, `false`, `no`, `normal`, `ok`, `healthy`, `none`, `nominal` (case-insensitive) count as normal; everything else is a fault |
| Timestamp | ignored | the prior is per-row, not sequential |

With a usable label (both classes present) the scorer is a logistic regression on standardised features (`model: "logistic_regression"`, with in-sample AUC); otherwise a per-feature robust z-score (`model: "zscore"`). At most the first 100 000 rows are read so the nightly run stays fast and deterministic.

To pin the mapping, add `data/external/mapping.json`:

```json
{
  "label": "event_label",
  "features": ["inlet_flow", "outlet_flow", "inlet_pressure", "outlet_pressure"],
  "normal": ["Normal"]
}
```

Set `"label": null` to force the unlabelled z-score scorer.
