// After-fix screenshots for the three critiqued screens, with the folder set by deep link.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const base = process.argv[2] ?? "http://localhost:3000";
const out = "docs/screenshots/grill"; mkdirSync(out, { recursive: true });
const F = "snapshot_2026-10-08T1200";
const shots = [
  ["dash-1440", `/?folder=${F}`, 1440, 900],
  ["dash-1024", `/?folder=${F}`, 1024, 768],
  ["dash-390", `/?folder=${F}`, 390, 844],
  ["facility-1440", `/facility/S2_FACILITY_C?folder=${F}`, 1440, 900],
  ["field-390", `/field/EV-0019?folder=snapshot_2026-10-10T0900`, 390, 844],
];
const b = await chromium.launch();
for (const [name, path, w, h] of shots) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => errs.push(e.message)); p.on("console", m => { if (m.type()==="error") errs.push(m.text().slice(0,120)); });
  await p.goto(base + path, { waitUntil: "networkidle", timeout: 60000 }); await p.waitForTimeout(9000);
  const t = await p.evaluate(() => document.body.innerText);
  const ov = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  await p.screenshot({ path: `${out}/${name}.png` });
  console.log(`${name}: folder-honoured=${/S2_PUMP_|S2_FACILITY_|S4_FACILITY_C/.test(t)} inProgress=${(t.match(/\d+ in progress/)||["-"])[0]} overflowX=${ov} errors=${errs.length} ${errs.slice(0,2).join(" | ")}`);
  await ctx.close();
}
await b.close();
