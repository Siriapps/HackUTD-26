/** Formatting helpers shared by the ops screens. Dataset time is UTC (network.meta.timezone). */

const pad = (n: number) => String(n).padStart(2, "0");

/** "10-08 12:00Z" */
export function fmtTime(unix: number): string {
  const d = new Date(unix * 1000);
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
}
/** "12:00Z" */
export function fmtClock(unix: number): string {
  const d = new Date(unix * 1000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
}
/** "2026-10-08 12:00 UTC" */
export function fmtDateTime(unix: number): string {
  const d = new Date(unix * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
/** "Thu 10-08" */
export function fmtDay(unix: number): string {
  const d = new Date(unix * 1000);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  return `${wd} ${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export const isoZ = (unix: number) => new Date(unix * 1000).toISOString().replace(".000Z", "Z");

/** 1.42 → "1h 25m"; 0.2 → "12m"; 30 → "1d 6h" */
export function fmtHours(h: number): string {
  if (!Number.isFinite(h)) return "—";
  const mins = Math.max(0, Math.round(h * 60));
  if (mins < 60) return `${mins}m`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ${pad(mins % 60)}m`;
  const days = Math.floor(mins / 1440);
  return `${days}d ${Math.floor((mins % 1440) / 60)}h`;
}
/** 1.42 → "+1h25" style compact, used in dense rows. */
export function fmtMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  return `${Math.floor(min / 60)}h ${pad(Math.round(min % 60))}m`;
}
export const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const fmtNum = (n: number, digits = 0) =>
  Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }) : "—";
export const fmtPct = (n: number, digits = 1) => (Number.isFinite(n) ? `${n.toFixed(digits)}%` : "—");

/** "S2_FACILITY_B" → "S2 Facility B" for headings; ids stay verbatim in mono elsewhere. */
export function prettyId(id: string): string {
  return id
    .split("_")
    .map((w, i) => (i === 0 ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(" ");
}
