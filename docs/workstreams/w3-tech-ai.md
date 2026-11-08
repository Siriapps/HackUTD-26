# W3 — Technician view, Gemini Live, incident memory, dispatch

**Priority 4 (camera) but start the server routes and memory corpus immediately; they don't depend on W1.**

## Owns
`src/app/(tech)/field/[eventId]/**`, `src/app/api/gemini/**`, `src/app/api/notify/**`, `src/components/{LiveSession,Transcript,FieldCard}*`,
`src/lib/memory/**`, `agent/**` (Photon), `.env.example` additions.

## Deliverables
1. **Incident memory** (`src/lib/memory/incidents.ts`): corpus = resolved events from `Analysis` (what happened, peak
   level, what the recommended plan was, outcome) + the three field runbooks (verbatim from `docs/PLAN.md` item 12)
   + optional team notes (`src/lib/memory/notes.json`, synthetic/Kaggle-derived resolution snippets). Retrieval:
   `similar(event, analysis, k=3)` scored on category, same system, level band, hours_to_limit band. Learning loop:
   `recordResolution(eventId, outcomeText)` persisted in localStorage; confirm/dismiss feedback counts per category.
2. **Gemini token route** `POST /api/gemini/token`: server holds `GEMINI_API_KEY`, returns an ephemeral token
   (`client.authTokens.create` with `liveConnectConstraints` locking model + system instruction). Confirm the current
   Live model id and API version from the English docs (https://ai.google.dev/gemini-api/docs/live-api and
   .../ephemeral-tokens) before coding; docs recently showed `gemini-2.5-flash-native-audio-preview-12-2025`.
3. **Field page** `/field/[eventId]` (mobile-first, dark, big type): event header with countdown + recommended plan;
   **LiveSession**: camera preview + mic, connects with `@google/genai` `ai.live.connect` using the token; streams
   JPEG frames (~1 fps) and PCM audio; plays audio replies; shows transcript. System instruction = facility, live
   readings, event + evidence, recommended plan and alternatives, top-3 similar incidents, the runbook for the category,
   and the rule "you are talking to a lone technician at night; be concrete; never invent readings".
   Function tools: `confirm_plan`, `log_observation(text)`, `escalate(reason)`, `get_past_incidents()` — wire to memory
   and to `/api/notify`. **Fallback button**: snapshot photo → `generateContent` with the same context (works if Live
   is flaky on stage).
4. **Dispatch** `POST /api/notify`: Discord webhook embed (category colour, countdown, plan, cost, evidence, deep link to
   `/field/[eventId]` and `/facility/[id]`). Used by W2's dispatch button and by the field page.
5. **Photon stretch (2 h timebox)**: `agent/photon.ts` with `spectrum-ts` — push the same alert to iMessage/SMS and
   accept "done" / "need help" replies → `recordResolution`. If outbound push isn't supported in the preview SDK, stop
   and document it; Discord is the committed channel.

## Rules
Secrets only server-side. No answer-key data in prompts. Everything the AI says about readings comes from `Analysis`.
Degrade gracefully with no key: page still shows plan + runbook + past incidents, Live button disabled with reason.

## Done when
On a phone over the LAN/Vercel URL: open an ongoing pump failure, start the session, point the camera, hear a reply
that cites the real countdown and plan; a Discord message lands with the deep link. Screenshots/recording in the PR.

## Skills
`frontend-design`, `impeccable`, `mobile-native`, `superpowers:verification-before-completion`.

## Added: video analysis report + tickets (plan items 18, 19)
- Keyframe capture during Live (on `log_observation`, on tap, every ~30 s) → `generateContent` with context →
  structured `VisualReport {observed_condition, severity, components_visible, matches_telemetry, notes, photos[]}`;
  attach to incident memory + ticket; render on field page (and expose a component W2 can drop into /admin).
- `POST /api/ticket`: GitHub Issue per event via REST (`GITHUB_TOKEN`, `TICKET_REPO` env), labels category/system,
  assignee from `ops-roster.json` (role → github handle / phone / discord id; include a sample roster), body with
  countdown, plan, evidence, deep links, visual report; `PATCH` to close with outcome when resolved; Discord embed
  links the issue. Degrade gracefully without token (return the would-be payload).
