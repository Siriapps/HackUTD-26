# PRODUCT.md — Flare (Avon Night Shift console)

## What it is
A night-shift operations console for a produced-water network (oil-field salt water: wells → tank → pump → pipeline → disposal site). Built for the HackUTD ZeroDay EOG challenge "Beat the Shutdown". It detects pipeline leaks, worn pumps and pump failures from sensor telemetry alone, prices the cheapest response to a pump failure (emergency trucks, early well shut-ins, or nothing, with trucks shared per system), and puts that plan in front of three people: the operator on the console, the lone technician on a phone at 3 a.m. (Gemini Live call with the telemetry and the plan as context, SMS alerts and replies via Photon), and the morning crew (shift handoff).

## Who uses it
- **Night-shift operator** (console, desktop): triages alerts, confirms plans, dispatches.
- **Field technician** (phone, outdoors, at night, gloves): receives the SMS, opens the field page, talks to the AI, replies one word.
- **Morning crew / supervisor** (phone + console): reads the handoff, sees what was done and what it cost.
- **Judges** (demo, 3 minutes): need to see correctness (answer-key costs), the unseen `test/` folder loading, and the creative twist.

## What must be true
- Everything comes from the loaded folder (`network.json`, `ops.json`, `telemetry.csv`). No dataset constants in code. The judging folder arrives last minute.
- Cost recommendations must match the reference plans exactly; this is scored.
- Detection is rules on physics with learned confidence; plans are physics. No "AI decided the cost".
- Footer on every page: "© 2026 Avon Corps". No Comic Sans.
- Honest claims only: real numbers from `analyse()`, no invented statistics.

## Surfaces
- `/` ops dashboard (Operate), `/facility/[id]` (Operate), `/timeline` (Operate), `/field/[eventId]` (Operate, phone), `/twin-preview` (Experience), `/landing` (Persuade: the pitch page for judges and Devpost).

## Voice
Calm, specific, operational. Short sentences. Numbers in mono. No hype verbs. The product is competent at 3 a.m.; the copy sounds like someone who has been paged before.

## Brand assets
Name: **Flare**. "Avon Night Shift" is the scenario (the city of Avon, the night shift), Flare is the product. Palette, type and tokens: `DESIGN.md`, `src/app/tokens.css`. Real imagery: the digital twin (Three.js) and the console itself; no stock photography.
