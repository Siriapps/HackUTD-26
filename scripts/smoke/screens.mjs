// Smoke screenshots + client-side error capture for every screen.
//   node scripts/smoke/screens.mjs [baseUrl]   (default http://localhost:3000) → docs/screenshots/smoke/*.png
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
const out = "docs/screenshots/smoke";
mkdirSync(out, { recursive: true });

const screens = [
  { name: "dashboard-snapshot-1008", path: "/?folder=snapshot_2026-10-08T1200", w: 1440, h: 900, wait: 25000 },
  { name: "dashboard-mock-test", path: "/?folder=mock_test_2026-10-10T1530", w: 1440, h: 900, wait: 25000 },
  { name: "facility-S2C", path: "/facility/S2_FACILITY_C?folder=snapshot_2026-10-08T1200", w: 1440, h: 900, wait: 25000 },
  { name: "timeline", path: "/timeline?folder=full_week", w: 1440, h: 900, wait: 25000 },
  { name: "field-EV19-390", path: "/field/EV-0019?folder=snapshot_2026-10-10T0900", w: 390, h: 844, wait: 25000 },
  { name: "twin-preview", path: "/twin-preview?folder=full_week&facility=S1_FACILITY_C", w: 1440, h: 900, wait: 20000 },
];

const browser = await chromium.launch();
const results = [];
for (const s of screens) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`); });
  const t0 = Date.now();
  try {
    await page.goto(base + s.path, { waitUntil: "networkidle", timeout: s.wait });
  } catch (e) {
    errors.push(`goto: ${String(e).slice(0, 120)}`);
  }
  await page.waitForTimeout(2500);
  const text = await page.evaluate(() => document.body.innerText);
  await page.screenshot({ path: `${out}/${s.name}.png`, fullPage: false });
  results.push({ name: s.name, ms: Date.now() - t0, chars: text.length, hasFooter: /Avon Corps/.test(text), loading: /loading|parsing/i.test(text), errors });
  await page.close();
}
await browser.close();
for (const r of results) console.log(`${r.name.padEnd(26)} ${String(r.ms).padStart(6)} ms  text=${String(r.chars).padStart(6)}  footer=${r.hasFooter}  loadingText=${r.loading}  errors=${r.errors.length}${r.errors.length ? "\n    " + r.errors.slice(0, 4).join("\n    ") : ""}`);
