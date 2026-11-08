# Handover: technician side (glasses camera → Gemini Live → report → data update)

Written for the teammate taking the technician loop to the finish. Everything here is on `main`.

## What already works
- **Field page** `/field/[eventId]?folder=…` (`src/app/(tech)/field/[eventId]/FieldView.tsx`, `src/components/FieldCard.tsx`): countdown, plan of action, runbook, similar incidents, Plan confirmed / False alarm, Escalate.
- **Gemini Live** (`src/components/LiveSession.tsx`): phone camera + mic → `ai.live.connect` with an ephemeral token from `POST /api/gemini/token` (`src/app/api/gemini/token/route.ts`), briefing built by `buildBriefing` in `src/lib/memory/briefing.ts`. Tools: confirm_plan, log_observation, escalate, get_past_incidents. Photo fallback: `POST /api/gemini/snapshot`. Keyframes → `POST /api/gemini/report` → `VisualReport` (`src/components/VisualReportCard.tsx`).
- **Texts and replies** (P3): `POST /api/dispatch/alert`, replies YES / OMW / FIXED / HELP, escalation ladder, voice line (`src/lib/voice/*`, ElevenLabs over Photon). Console decisions: `POST /api/dispatch/decide` with `approve`, `opt N`, `trucks`, `shut in`, `fixed`.
- **Memory**: `recordResolution` / `similar` in `src/lib/memory` (localStorage + Tiger Data `incidents` once wired).
- **Training loop**: `data/outcomes/*.json` → `scripts/retrain/run.ts` (thresholds, confidence weights, forecast band) and `scripts/ml/train.ts` (early-warning scorer) → `.github/workflows/nightly-retrain.yml` opens a PR. Verified running on GitHub today; the "open PR" step needs Settings → Actions → "Allow GitHub Actions to create and approve pull requests".

## 1. Meta glasses as the camera (1–2 h)
The web page cannot talk to the glasses. Two routes:
- **Demo route (recommended):** glasses stream into a WhatsApp/Messenger video call from the Meta AI app; the demo laptop joins the call in a window. In `LiveSession.tsx`, next to "Start live call", add **"Use glasses (shared window)"**: `navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })`, let the user pick the call window, and feed that `MediaStream` into the exact same frame-capture (`canvas.drawImage(video)` → JPEG) and audio (PCM) pipeline that the phone camera uses. Nothing else changes; Gemini sees what the tech sees.
- **Proper route:** Meta Wearables Device Access Toolkit (native iOS/Android companion app) forwards camera frames + mic to Gemini Live or relays to the page over a local WebSocket. Needs the developer preview entitlement; don't bet the demo on it.

## 2. End-of-call analysis report
- Call `POST /api/gemini/report` with the captured keyframes + briefing at **FIXED** (or when the call ends). Structured output: `{ observed_condition, severity, components_visible, matches_telemetry, notes, photos[] }`.
- Show it on the field page (`VisualReportCard`) and on `/alert/[id]` (there is a "Technician thread" panel; add the report under it).
- Attach it to the ticket: `POST /api/ticket` creates a GitHub issue; add the report text to `body`.

## 3. Data update: a resolved alert becomes training data
Call this once per close-out (from the field page after FIXED, and from the voice `mark_fixed` tool):
```
POST /api/outcomes
{ folder, event_id, asset, facility, system, category, onset_unix, end_unix,
  verdict: "confirmed" | "dismissed", resolution: "<tech note>", report: <VisualReport>, by: "<handle>" }
```
It appends to `data/outcomes/session.json`, which the nightly job merges with the telemetry-derived outcomes:
- **verdict** → per-category confidence weights (Laplace-smoothed precision), `src/lib/calibration/calibration.json`.
- **end_unix / resolution** → outcome record, threshold refit (max margin, zero false positives on healthy windows), forecast fail band from wear→failure pairs.
- **the event's own telemetry windows** → labelled training windows for the early-warning scorer (`scripts/ml/train.ts` reads folders + outcomes; synthetic early-phase windows are generated from the physics at measured noise to balance the classes).
Run it locally to see the effect: `npx tsx scripts/retrain/run.ts --dry-run` prints a before/after table; `npx tsx scripts/ml/train.ts --dry-run` prints held-out metrics. The Log page's "Learning loop" card reads the written files.

"Synthetic data added to the existing data" means exactly this: the alert's real telemetry windows plus the technician's verdict and notes become labelled examples, and the physics-generated windows fill in the rare classes. The challenge folders themselves are never modified.

## 4. Tiger Data persistence (optional, 30 min)
`src/lib/db.ts` + `db/schema.sql` are live (telemetry ingested). To make memory survive machines: on `recordResolution`, also `INSERT … ON CONFLICT` into `incidents` (columns: id, dataset, event_id, system_id, facility_id, asset_id, category, onset_ts, end_ts, status, confidence, evidence, plan, visual_report, verdict, resolution). `DATABASE_URL` is in `.env`.

## Where to look when something breaks
- Token mint fails: `curl localhost:3000/api/gemini/token` → `configured` must be true; model/API version in `src/app/api/gemini/gemini.ts`.
- No text arrives: `curl localhost:3000/api/dispatch/state`; Photon keys in `.env`; `npm run photon:webhook` to register the webhook URL.
- Demo script and fallbacks: `docs/DEMO.md`. Proof against the answer key: `docs/VERIFY.md` and `npm test`.
