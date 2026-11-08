---
target: ops dashboard, facility and field screens
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 4
target_identity: "file:C:\\Users\\siria\\OneDrive\\Documents\\code\\HackUTD-26\\src\\app\\(ops)\\page.tsx"
target_fingerprint: "sha256:e56dbc6af002bfda454b013ef6ffc9973fe806ee3a17ca2c79193f1da239b7ef"
target_path: "C:\\Users\\siria\\OneDrive\\Documents\\code\\HackUTD-26\\src\\app\\(ops)\\page.tsx"
timestamp: 2026-11-08T04-34-11Z
slug: src-app-ops-page-tsx
---
Method: dual-agent (A: design review sub-agent · B: detector + browser sub-agent)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Dispatch feedback is a fading 12px note; nothing marks a row as already dispatched |
| 2 | Match System / Real World | 3 | Two unlabeled percentages per alert row (tank ring vs confidence) |
| 3 | User Control and Freedom | 2 | Dispatch and False alarm are one tap, no confirm, no undo |
| 4 | Consistency and Standards | 2 | ?folder= honoured on /field, ignored on / and /facility; twin 69.3 % vs gauge 69.5 % |
| 5 | Error Prevention | 2 | Single-tap destructive actions (Escalate is correctly two-tap) |
| 6 | Recognition Rather Than Recall | 3 | Alternative-plan labels truncate ("Shut in S2_WELL_C1, S2_WELL_C2 a…") |
| 7 | Flexibility and Efficiency | 3 | No keyboard path through alerts; row click does not open the plan |
| 8 | Aesthetic and Minimalist Design | 3 | Handoff card is a 20-line paragraph; wells table clips its last column |
| 9 | Error Recovery | 3 | Missing-facility/event pages are good; no path when analyse() returns nothing |
| 10 | Help and Documentation | 2 | p10–p90, confidence %, "pct/h" never explained in-product |
| **Total** | | **26/40** | Solid real-UI band |

## Design Specificity Verdict
Authored for this product. The countdown ring encodes hours-to-limit over the repair horizon, the fleet card says "2 committed · 0 free · 3 failures", and the evidence copy is physics with baselines. Generic seams: handoff card as prose wall, standard map legend, centred progress-bar loading screen, and the display italic on every panel title contradicting DESIGN.md's "Plex Sans for everything that is read".
Deterministic scan: 67 advisory findings (52 off-ramp font sizes, 9 undocumented colours, 6 radii), mostly in the field route's own scale and FieldCard. Provable false positives: 17px sizes (documented --fs-lg), html 16px root, box-shadow rgba, and var() fallbacks in VisualReportCard. Real: 9–10px text in Countdown/Alerts/EventStrip/TankSvg below the 11px floor.
Browser overlay: injected on the dashboard, 10 anti-patterns: six 10px functional numerals, one cramped 44px cell, Leaflet attribution at 3.3:1 and its link at 2.1:1 (leaflet.css loads after globals.css and wins), one 11px body line. 390px dashboard overflows horizontally (948px: top bar does not wrap). No button on dashboard/facility reaches 44px.

## Priority Issues
- [P0] Deep links open the wrong dataset: / and /facility ignore ?folder=; store restores localStorage folder. Fix: read the param in src/store/index.ts init(), append ?folder= to links in Alerts.tsx and notify/dispatch links.
- [P1] 1024px layout: map overflows and paints over the Truck fleets card (the one card that explains the joint plan). Fix grid rows in globals.css (@media max-width:1279px) and let the handoff scroll inside its card.
- [P1] Alert row hierarchy: plan and cost at 12px are the 5th most prominent element; confidence and tank % unlabeled. Fix: cost first and larger, "tank" caption under ring, "conf" label or move to evidence, whole row clickable.
- [P1] Plan comparison tells no "why cheapest" story and the winning curve visually touches the red line; repair-end label clipped. Fix: margin.right ~96, wrap labels, holds/trips word per option, one data-generated lede sentence, dot + "peak 92.0 % at the limit, not over".
- [P1] 390px dashboard horizontal overflow (top bar) and all console buttons under 44px.
- [P2] Field bottom bar covers Plan confirmed / False alarm; four controls, two disabled. Keep Start live call + Escalate in the bar, move Photo/Visual report into the live section.
- [P2] TankGauge labels clipped ("shutdown 9"); Leaflet attribution contrast; 10px numerals.
- [P3] Naming: Flare (top bar) vs Avon Night Shift vs Avon Corps; twin vs gauge reading mismatch.

## Persona Red Flags
Alex (night operator): no keyboard path, 28px quiet buttons at 12px, "Dispatch" means two things, no confirm, nothing persists after dispatch.
Jordan (judge, 3 min): 20 s blank loading bar, two unlabeled percentages, winning plan touching the cliff, Discord/SMS link lands on a healthy facility (P0), fleet card hidden at 1024.
Ray (3 a.m., gloves): confirm answers under the bottom bar, checked runbook steps dim to invisible, 13px grey captions unreadable in glare.
