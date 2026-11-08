# Team split (4 people) — adopted 2026-11-07 evening

Issue labels: `p1-data-core`, `p2-ops-ui`, `p3-photon`, `p4-field-visuals`. Start your agent with
"You are P3. Run `gh issue list --label p3-photon`, read CLAUDE.md and the brief(s) below, claim the top issue."

| Person | Owns (build order) | Briefs | Branch(es) to pick up | Folders owned |
|---|---|---|---|---|
| P1 Data core | detector → events.json shape → countdown → optimiser (single, then joint + ledger) → time-travel engine → what-if engine → degradation forecast → outcomes → learning loop → retraining | w1, w5, forecast part of w4 | `ws/w1-data-core`, `ws/w5-outcomes-retrain`, forecast files from `ws/w4-twin-forecast` | `src/lib/{analyse.ts,detect,plan,forecast,calibration}`, `src/lib/memory/outcomes.ts`, `scripts/retrain`, nightly workflow |
| P2 Ops UI | folder picker → alerts → map → plan chart → trends → time-travel UI → what-if sliders → handoff screen → admin → footer | w2 | `ws/w2-ops-ui` | `src/app/(ops)`, `src/store`, `src/components/{Alerts,PlanCard,PlanCompare,Map,Trend,Countdown,FolderPicker,TimeScrubber,HandoffCard,WhatIf}*`, `src/lib/export` |
| P3 Dispatch + twin | Discord dispatch → tickets → Three.js twin (+ TankSvg fallback, preview route) → Photon agent only if time remains (outbound, two-way, escalation, confirm loop) | w3 (Discord/tickets parts), w4 (twin) | Discord notify from `ws/w3-tech-ai`; twin from `ws/w4-twin-forecast` (PR 30) | `agent/**`, `src/app/api/{notify,ticket,photon}`, `ops-roster.json`, `src/components/{Twin3D,TankSvg}*`, `src/app/twin-preview` |
| P4 Field AI | Gemini Live → mobile layout → incident memory → video report | w3 (Gemini/memory parts) | Gemini routes + memory from `ws/w3-tech-ai` (PR 32) | `src/app/(tech)`, `src/app/api/gemini`, `src/lib/memory/**` (except outcomes.ts), `src/components/{LiveSession,Transcript,FieldCard,VisualReport}*` |

Boundaries: P3 calls `recordResolution` / `similar` from `src/lib/memory` (P4's) and never edits it. P2 renders
`Twin3D` (P3's) through the slot. Everyone consumes `analyse()` (P1's) and never computes physics in UI.
Contract (`src/lib/data/types.ts`) changes: own PR labelled `contract`, merged first.

P1 hands items outcomes / learning loop / retraining to subagents only after the reference-cost tests pass.
P3 first hour: confirm Photon track judging criteria and whether Spectrum does outbound push; post on the Photon issue.

## Tiger Data (required, decided 2026-11-07)
Synthetic telemetry store + shared persistence (see the Tiger Data issue for schema and split). P1 ships schema +
ingest + `src/lib/db.ts` + `/api/trends` first; P4/P3/P2 consume. Browser `analyse()` on the loaded folder remains
the source of truth for detection/plans (judging constraint); the app must fully work with DATABASE_URL unset.
