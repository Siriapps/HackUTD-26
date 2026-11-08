/**
 * Incident memory public API.
 * P3 (Photon / tickets) should import `recordResolution` and `similar` from here
 * and never edit this folder.
 */
export {
  CATEGORY_LABEL,
  RUNBOOKS,
  addFieldNote,
  addVisualReport,
  corpus,
  feedbackCounts,
  fieldNotes,
  htlBand,
  incidentFromEvent,
  levelBand,
  recordFeedback,
  recordResolution,
  similar,
  similarityScore,
  visualReports,
  type Feedback,
  type FeedbackCounts,
  type FieldNote,
  type Incident,
  type NoteKind,
  type Runbook,
  type Severity,
  type VisualReport,
} from "./incidents";
export { FIELD_TOOLS, buildBriefing, describeActions } from "./briefing";
