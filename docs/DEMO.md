# Flare — demo storyline (3 minutes, with the 8-minute full cut)

Everything below is live, from the judges' files. Say the numbers; they match the answer key.

## Setup (before the judges arrive)
- `npm run dev`, open `http://localhost:3000/?folder=snapshot_2026-10-08T1200` on the big screen, left rail open.
- Phone on the LAN: `http://<laptop-ip>:3000/field/EV-0011?folder=snapshot_2026-10-08T1200` ready, Gemini key set.
- Photon on-call handle = the teammate holding the phone. Auto-text ON in the top bar.
- Second tab: `/landing` (the Story) for the opener if there is time.

## 3-minute cut
1. **Their data, in.** (15 s) "These are the three files you gave us." Drag the folder onto the console: it appears in the picker, loads, and the board fills. No config, nothing hardcoded; the `test/` folder will go in the same way.
2. **Urgency.** (20 s) The hero: "Next shutdown 1 h 25 min, S2_FACILITY_B, trips at 13:24 if nobody acts; plan 1 truck 1 trip, $905." The race under it: three tanks, nearest first, green where the plan holds, red tick where each would trip.
3. **The decision.** (40 s) Click S2_FACILITY_C. The twin fills the stage. Under it: "Do this now: $1,298, shut in S2_WELL_C1 at +46 min." Read the sentence: both S2 trucks are committed to B and A, so C's cheapest safe move is a shut-in. The chart shows every option; the recommended line peaks at 92.0 and never crosses. Open ⓘ once: "minute-by-minute simulation, trucks shared across the system, matches the reference answers."
4. **The moment it fires.** (40 s) Scrub to 08:50, press Play at 10 min/s. At 09:00 S2_FACILITY_B fires: toast runs Detected → Countdown → Priced → Texted. The phone buzzes. Read the text aloud: countdown, plan, cost, "Reply YES".
5. **The technician.** (40 s) Teammate taps the link, the field page opens with the countdown and the plan of action checklist, taps **Start live call**, points the camera at the pump photo, asks "what do I do first?" Gemini answers from the briefing: lockout/tagout, breaker, VFD code. Teammate replies **YES** by text; the dispatch log on the big screen shows the approval.
6. **Close-out and learning.** (25 s) Teammate texts **FIXED**, then "replaced the seal". Open the alert page: tracking strip Detected → Texted → Acknowledged → Approved → Fixed; raise the ticket (a GitHub issue opens). Open **Log**: today's events on the calendar and the learning-loop card: thresholds and the scorer retrained nightly from outcomes like this one. "The physics never changes; what we learn is how early to warn and how much to trust it."

## Full cut adds
- **Forecast**: in the queue, S3_PUMP_A shows "~6.3 h until this pump fails"; select it, the forecast card says inspect before 12:20. That is prevention, not response.
- **What if**: scroll down. Fill rates per facility (inflow ÷ 24 ÷ capacity). Tick S2_FACILITY_A as failed too, or remove a truck: total cost re-plans jointly in front of them.
- **Ask Flare**: "Why does S2_FACILITY_C get a shut-in instead of a truck?" Gemini answers from the live analysis with the exact numbers.
- **Voice** (if PR 56 is in): the technician calls the Photon number and an AI engineer who already knows the alert answers.
- **Time travel**: Timeline page, scrub back to the opening scene on the full week; the console recommends exactly what the key lists.
- **Story**: `/landing`, scroll the scrubbed twin through the same night.

## If something breaks
- No wifi for Gemini Live: use the **Photo** button (one snapshot, same briefing) or skip to the text replies.
- Photon down: auto-text shows "not sent", the alert page still shows the plan; narrate the SMS from the dispatch log screenshot in `docs/screenshots`.
- Browser WebGL off: the twin falls back to the SVG tank automatically.
