// Scroll the landing page and shoot it at many positions, desktop + phone + reduced motion.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const base = process.argv[2] ?? "http://localhost:3000";
const out = "docs/screenshots/landing"; mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
async function run(name, vp, opts = {}) {
  const ctx = await browser.newContext({ viewport: vp, reducedMotion: opts.rm ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", e => errs.push(e.message)); page.on("console", m => { if (m.type()==="error") errs.push(m.text().slice(0,160)); });
  await page.goto(base + "/landing", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
  const H = await page.evaluate(() => document.documentElement.scrollHeight);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  const fracs = opts.rm ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.06, 0.14, 0.22, 0.28, 0.33, 0.38, 0.44, 0.5, 0.56, 0.62, 0.68, 0.74, 0.8, 0.86, 0.92, 1];
  for (const f of fracs) {
    await page.evaluate((y) => scrollTo(0, y), Math.round((H - vp.height) * f));
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${out}/${name}-${String(Math.round(f*100)).padStart(3,"0")}.png` });
  }
  const text = await page.evaluate(() => document.body.innerText.length);
  console.log(`${name}: height=${H} (${(H/vp.height).toFixed(1)} vh) overflowX=${overflow} text=${text} errors=${errs.length} ${errs.slice(0,3).join(" | ")}`);
  await ctx.close();
}
await run("desktop", { width: 1440, height: 900 });
await run("phone", { width: 390, height: 844 });
await run("reduced", { width: 1440, height: 900 }, { rm: true });
await browser.close();
