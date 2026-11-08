// Capture the digital twin over a real incident as an image sequence + scrub-encoded mp4.
//   node scripts/smoke/capture-twin.mjs [baseUrl]  → public/landing/twin/f-000.jpg … and public/landing/twin.mp4
// Window: EVENT_9 on S1_FACILITY_C (pump fails 2026-10-08 00:20Z, 1 truck arrives +75 min, repaired 06:20Z).
import { chromium } from "playwright";
import { mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const base = process.argv[2] ?? "http://localhost:3000";
const out = "public/landing/twin";
mkdirSync(out, { recursive: true });
const FRAMES = 96;
const T0 = 1791418800 - 2.5 * 3600; // 21:50 the evening before: pump running, tank draining
const T1 = 1791418800 + 6.5 * 3600; // 06:50, just after repair
const folder = "full_week";
const facility = "S1_FACILITY_C";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(`${base}/twin-preview?folder=${folder}&facility=${facility}&t=${T0}&plan=1x1`, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(4000);
const stage = page.locator("canvas").first();
await stage.waitFor({ timeout: 30000 });
for (let i = 0; i < FRAMES; i++) {
  const t = Math.round(T0 + ((T1 - T0) * i) / (FRAMES - 1));
  await page.evaluate((t) => {
    const u = new URL(location.href);
    u.searchParams.set("t", String(t));
    history.replaceState(null, "", u.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, t);
  // The preview reads `t` from the URL only on mount; drive its slider instead.
  const slider = page.locator('input[type="range"]').first();
  await slider.evaluate((el, t) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(el, String(t));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, t);
  await page.waitForTimeout(i === 0 ? 1500 : 650);
  await stage.screenshot({ path: `${out}/f-${String(i).padStart(3, "0")}.jpg`, type: "jpeg", quality: 82 });
  if (i % 16 === 0) console.log(`frame ${i}/${FRAMES} t=${new Date(t * 1000).toISOString()}`);
}
await browser.close();
try {
  execSync(`ffmpeg -y -framerate 24 -i ${out}/f-%03d.jpg -c:v libx264 -pix_fmt yuv420p -g 6 -keyint_min 6 -crf 20 -movflags +faststart -an public/landing/twin.mp4`, { stdio: "inherit" });
  console.log("wrote public/landing/twin.mp4");
} catch (e) {
  console.log("ffmpeg failed, frames only", String(e).slice(0, 120));
}
console.log(existsSync("public/landing/twin.mp4") ? "ok" : "frames only");
