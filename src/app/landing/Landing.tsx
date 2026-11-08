"use client";
// The pitch page. Persuade mode inside the Flare world. Scroll is the timeline: the visitor scrubs the
// real digital twin through a real incident (EVENT_9, S1_FACILITY_C, 2026-10-08) and watches the
// console's own numbers change under their hand. Every number below comes from the challenge data.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// ─── The incident (full_week answer key, README opening scene) ──────────────────────────────────
const ONSET = Date.UTC(2026, 9, 8, 0, 20) / 1000; // pump faults
const ARRIVE = ONSET + 75 * 60; // first truck lands (+75 min)
const REPAIR = ONSET + 6 * 3600; // repair complete
const T0 = ONSET - 2.5 * 3600; // clip start (frame 0)
const T1 = ONSET + 6.5 * 3600; // clip end (frame 95)
const CLIP_SEC = 4; // 96 frames at 24 fps
const FILL = 9.375; // pct/h: 1,800 bpd into an 800 bbl tank
const TRUCK_PCT = (150 / 800) * 100; // one trip
const SHUTDOWN = 92;
const CONSOLE = "/?folder=snapshot_2026-10-08T1200";

/** What the console knows at dataset time `t` under the recommended plan (1 truck, 1 trip). */
function stateAt(t: number) {
  if (t < ONSET) return { phase: "worn" as const, level: null, hours: null };
  if (t >= REPAIR) return { phase: "repaired" as const, level: 87.5, hours: null };
  const h = (t - ONSET) / 3600;
  const level = 50 + FILL * h - (t >= ARRIVE ? TRUCK_PCT : 0);
  const hours = Math.max(0, (SHUTDOWN - level) / FILL);
  return { phase: "failed" as const, level, hours };
}
const hm = (h: number) => `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, "0")} min`;
const clock = (t: number) => new Date(t * 1000).toISOString().slice(11, 16);

// Copy stops along the scrub, by progress (0..1 across the clip).
const STOPS = [
  { at: 0.06, kicker: "22:20 the night before", title: "A worn pump looks fine from the road.", body: "Flow is 10 % under rated. Discharge sags a few psi. The console has already flagged it and forecast when it fails." },
  { at: 0.27, kicker: "00:20 · pump faults", title: "The tank starts filling.", body: "1,800 barrels a day into an 800 barrel tank. Shutdown at 92 %. Nobody is awake but the technician." },
  { at: 0.37, kicker: "00:21 · one second later", title: "Three options, already priced.", body: "Do nothing: $5,016. Shut in the cheapest well at 02:25: $1,958. One truck, one trip: $905. The console picks $905 and says why." },
  { at: 0.47, kicker: "01:35 · truck arrives", title: "150 barrels out. The curve bends.", body: "The text to the technician said exactly this at 00:21. The truck is where the plan said it would be." },
  { at: 0.72, kicker: "04:49 · the trip that never came", title: "This is when the wells would have shut in.", body: "Instead the tank peaks at 87.5 %, under the limit, and keeps producing." },
  { at: 0.96, kicker: "06:20 · repaired", title: "Nothing tripped. $905 spent.", body: "The handoff for the morning crew is already written." },
];

function useProgress(ref: React.RefObject<HTMLElement | null>) {
  const [p, setP] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const total = el.offsetHeight - window.innerHeight;
      const v = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0;
      setP((prev) => (Math.abs(prev - v) > 0.0005 ? v : prev));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref]);
  return p;
}

function useReducedMotion() {
  const [rm, setRm] = useState(false);
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const f = () => setRm(mq.matches);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  return rm;
}

export function Landing() {
  const rm = useReducedMotion();
  return (
    <main className="ld" data-reduced-motion={rm || undefined}>
      <Hero rm={rm} />
      <Scrub rm={rm} />
      <Decision rm={rm} />
      <Reach rm={rm} />
      <Close />
    </main>
  );
}

// ─── Act 1: hero, three planes moving at different rates ────────────────────────────────────────
function Hero({ rm }: { rm: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const p = useProgress(ref);
  const s = rm ? 0 : p;
  return (
    <section ref={ref} className="ld-hero" aria-labelledby="ld-h1">
      <div className="ld-hero__stage">
        <img className="ld-hero__bg" src="/landing/poster.jpg" alt="" width={1118} height={473} style={{ transform: `translate3d(0, ${s * -6}vh, 0) scale(${1.06 + s * 0.04})` }} />
        <div className="ld-hero__fog" style={{ transform: `translate3d(${s * -4}vw, ${s * -10}vh, 0)` }} aria-hidden />
        <div className="ld-hero__copy" style={{ transform: `translate3d(0, ${s * -18}vh, 0)`, opacity: 1 - s * 1.1 }}>
          <p className="ld-hero__eyebrow">Flare · HackUTD ZeroDay · EOG “Beat the Shutdown”</p>
          <h1 id="ld-h1">
            Everyone built the alarm.
            <br />
            <em>We built the night shift.</em>
          </h1>
          <p className="ld-hero__sub">The console that detects the fault, prices the response, and talks the lone technician through it at 3 a.m.</p>
          <Link href={CONSOLE} className="ld-cta">
            Open the console
          </Link>
        </div>
        <aside className="ld-hero__alert" style={{ transform: `translate3d(0, ${s * -34}vh, 0) rotate(${-1.5 + s * 1.5}deg)` }} aria-label="Example alert">
          <div className="ld-alert__row">
            <span className="ld-chip ld-chip--failure">Pump failure</span>
            <span className="ld-alert__id">S1_FACILITY_C</span>
          </div>
          <div className="ld-alert__big">
            4<small>h</small> 29<small>min</small>
          </div>
          <div className="ld-alert__meta">to shutdown · 04:49 UTC</div>
          <div className="ld-alert__plan">
            <span>1 truck, 1 trip</span>
            <strong>$905</strong>
          </div>
          <div className="ld-alert__alt">next best $1,958 · do nothing $5,016</div>
        </aside>
      </div>
    </section>
  );
}

// ─── Act 2: the signature move. Scrub the real twin; the console's numbers move with your hand. ──
function Scrub({ rm }: { rm: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const p = useProgress(ref);
  const [ready, setReady] = useState(false);
  const t = T0 + (T1 - T0) * p;
  const st = stateAt(t);

  useEffect(() => {
    const v = video.current;
    if (!v || rm) return;
    const target = p * CLIP_SEC;
    if (!Number.isFinite(v.duration)) return;
    if (Math.abs(v.currentTime - target) > 0.02) v.currentTime = Math.min(v.duration - 0.001, target);
  }, [p, rm]);

  return (
    <section ref={ref} className="ld-scrub" aria-label="The incident, scrubbed by scroll">
      <div className="ld-scrub__stage">
        <img className="ld-scrub__poster" src="/landing/poster.jpg" alt="Digital twin of S1_FACILITY_C: the tank filling while the pump is faulted" width={1118} height={473} style={{ opacity: ready && !rm ? 0 : 1 }} />
        {!rm && (
          <video
            ref={video}
            className="ld-scrub__video"
            src="/landing/twin.mp4"
            muted
            playsInline
            preload="auto"
            onLoadedData={() => setReady(true)}
            aria-hidden
          />
        )}
        <div className="ld-scrub__scrim" aria-hidden />

        <div className="ld-readout" aria-live="off">
          <div className="ld-readout__clock">{clock(t)} UTC</div>
          {st.phase === "worn" && (
            <div className="ld-readout__line">
              <span className="ld-chip ld-chip--degradation">Worn pump</span>
              <span>forecast to fail · inspect before it does</span>
            </div>
          )}
          {st.phase === "failed" && (
            <>
              <div className="ld-readout__big">
                {hm(st.hours!)}
                <span className="ld-readout__unit"> to shutdown</span>
              </div>
              <div className="ld-readout__bar" role="img" aria-label={`Tank ${st.level!.toFixed(1)} percent`}>
                <i style={{ transform: `scaleX(${Math.min(1, st.level! / 100)})` }} />
                <b style={{ left: "85%" }} />
                <b className="shut" style={{ left: `${SHUTDOWN}%` }} />
              </div>
              <div className="ld-readout__meta">
                tank <strong>{st.level!.toFixed(1)} %</strong> · plan <strong>1 truck, 1 trip · $905</strong>
                {t >= ARRIVE ? " · truck on site" : ` · truck arrives ${clock(ARRIVE)}`}
              </div>
            </>
          )}
          {st.phase === "repaired" && (
            <div className="ld-readout__line">
              <span className="ld-chip ld-chip--ok">Repaired</span>
              <span>peak 87.5 % · no shut-in · $905</span>
            </div>
          )}
        </div>

        <div className="ld-stops">
          {STOPS.map((s, i) => {
            const d = Math.abs(p - s.at);
            const vis = rm ? 1 : Math.max(0, 1 - d / 0.075);
            return (
              <div key={i} className="ld-stop" style={{ opacity: vis, transform: rm ? undefined : `translate3d(0, ${(1 - vis) * 12}px, 0)` }} aria-hidden={!rm && vis < 0.05}>
                <p className="ld-stop__kicker">{s.kicker}</p>
                <h2>{s.title}</h2>
                <p>{s.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── Act 3: the decision, pinned. Rows arrive as you scroll; the bars are the costs. ────────────
const OPTIONS = [
  { label: "Do nothing", detail: "Tank trips 04:49. Wells shut in until 06:20.", cost: 5016, tone: "bad" },
  { label: "Shut in S1_WELL_C2 at 02:25", detail: "Lose that well's oil and gas for 3 h 55 min.", cost: 1958, tone: "mid" },
  { label: "One truck, one trip", detail: "Arrives 01:35, removes 150 bbl. Peak 87.5 %.", cost: 905, tone: "good" },
];
function Decision({ rm }: { rm: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const p = useProgress(ref);
  return (
    <section ref={ref} className="ld-decide" aria-labelledby="ld-decide-h">
      <div className="ld-decide__stage">
        <div className="ld-decide__head">
          <h2 id="ld-decide-h">The cheapest plan, and why it is cheapest.</h2>
          <p>A minute-by-minute tank simulation under every option: trucks, early shut-ins, mixes, doing nothing. Trucks are shared across the whole system when several pumps fail together. The numbers match the reference answers to the dollar.</p>
        </div>
        <ol className="ld-options">
          {OPTIONS.map((o, i) => {
            const on = rm ? 1 : Math.min(1, Math.max(0, (p - 0.08 - i * 0.2) / 0.12));
            return (
              <li key={o.label} className={`ld-option ld-option--${o.tone}`} style={{ opacity: on, transform: rm ? undefined : `translate3d(0, ${(1 - on) * 16}px, 0)` }}>
                <div className="ld-option__text">
                  <span className="ld-option__label">{o.label}</span>
                  <span className="ld-option__detail">{o.detail}</span>
                </div>
                <div className="ld-option__bar" aria-hidden>
                  <i style={{ transform: `scaleX(${(on * o.cost) / 5016})` }} />
                </div>
                <span className="ld-option__cost">${o.cost.toLocaleString("en-US")}</span>
              </li>
            );
          })}
        </ol>
        <p className="ld-decide__foot" style={{ opacity: rm ? 1 : Math.min(1, Math.max(0, (p - 0.66) / 0.12)) }}>
          Recommended: <strong>$905</strong>. Three S2 pumps failing in one hour with two trucks? Planned jointly: $905, shut in S2_WELL_C1 at +46 min for $1,298, $905.
        </p>
      </div>
    </section>
  );
}

// ─── Act 4: reach. Lateral travel: three surfaces, three people. ────────────────────────────────
function Reach({ rm }: { rm: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const p = useProgress(ref);
  const x = rm ? 0 : -p * 100;
  return (
    <section ref={ref} className="ld-reach" aria-labelledby="ld-reach-h">
      <div className="ld-reach__stage">
        <h2 id="ld-reach-h" className="ld-reach__title">One plan. Three people.</h2>
        <div className="ld-track" style={{ transform: `translate3d(calc(${x}vw * 0.62), 0, 0)` }}>
          <article className="ld-panel ld-panel--sms">
            <h3>The technician, by text</h3>
            <div className="ld-sms" aria-label="SMS alert">
              <p>
                🟠 PUMP FAILURE EV-0019 · S4_FACILITY_C (S4)
                <br />
                Tank 60.4 % → shutdown in 3 h 15 min at 12:15 UTC.
              </p>
              <p>
                PLAN: 1 truck, 1 trip: $905
                <br />
                ALT: Shut in S4_WELL_C1 at +150 min: $1,547
                <br />
                Do nothing: trips at 12:15, $3,450/hr lost.
              </p>
              <p>Reply YES to approve · NO for options · ? for status</p>
              <p className="ld-sms__reply">yes omw</p>
              <p>✅ Approved. 1 truck dispatched, ETA 10:30. Escalation paused.</p>
            </div>
            <p className="ld-panel__note">If nobody answers, it reminds, pages the supervisor, then goes all hands. The timing comes from the countdown.</p>
          </article>
          <article className="ld-panel ld-panel--phone">
            <h3>The technician, on the call</h3>
            <img src="/landing/field-390.png" alt="Field page on a phone: countdown, plan, start live call" width={390} height={844} />
            <p className="ld-panel__note">Gemini Live, with the telemetry, the plan and what fixed this last time already in the briefing. Point the camera at the pump.</p>
          </article>
          <article className="ld-panel ld-panel--ops">
            <h3>The operator, on the console</h3>
            <img src="/landing/dashboard.png" alt="Operations dashboard: three S2 pump failures ordered by countdown with priced plans" width={1440} height={900} />
            <p className="ld-panel__note">Alerts in order of time to shutdown. Map, trends, time travel, handoff for the morning crew.</p>
          </article>
        </div>
      </div>
    </section>
  );
}

// ─── Close: resolves and holds. ─────────────────────────────────────────────────────────────────
function Close() {
  return (
    <section className="ld-close" aria-labelledby="ld-close-h">
      <div className="ld-close__inner">
        <h2 id="ld-close-h">Built from the three files. Nothing hardcoded.</h2>
        <ul className="ld-proof">
          <li>
            <strong>23 of 23</strong> labelled events detected, zero false alarms, onsets within 15 minutes.
          </li>
          <li>
            <strong>Every</strong> reference plan reproduced, including shared-truck cases.
          </li>
          <li>
            <strong>Any folder</strong> loads, including the one judges hand us last.
          </li>
          <li>
            <strong>A learned scorer</strong> runs beside the rules: 0.4 % false alarms on held-out healthy data.
          </li>
        </ul>
        <Link href={CONSOLE} className="ld-cta ld-cta--big">
          Open the console
        </Link>
      </div>
    </section>
  );
}
