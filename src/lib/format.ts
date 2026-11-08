/** Small formatters shared by the field UI, the Gemini briefing and the Discord embed. */
export const utc = (unix: number) => new Date(unix * 1000).toISOString().slice(11, 16) + " UTC";
export const hoursText = (h: number) => {
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
};
export const pct = (v: number, digits = 1) => `${v.toFixed(digits)} %`;
export const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
