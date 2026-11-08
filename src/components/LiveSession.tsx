"use client";

import { FunctionResponseScheduling, GoogleGenAI, type FunctionCall, type LiveServerMessage, type Session } from "@google/genai";
import { useCallback, useEffect, useRef, useState } from "react";
import Transcript, { type Line } from "@/components/Transcript";
import { notifyOps } from "@/lib/dispatch";
import type { EventContext } from "@/lib/events";
import { FIELD_TOOLS } from "@/lib/memory/briefing";
import { addFieldNote, addVisualReport, fieldNotes, recordFeedback, similar } from "@/lib/memory/incidents";

type Status = "idle" | "starting" | "live" | "ended";
interface Availability {
  configured: boolean;
  model: string;
}
interface Frame {
  at: number;
  jpeg: string;
}
interface Props {
  ctx: EventContext;
  /** System instruction built from the EventContext; locked into the ephemeral token server-side. */
  briefing: string;
  /** Called after any tool call or report touched incident memory, so the page re-reads it. */
  onMemoryChange: () => void;
}

// Mic → 16-bit PCM chunks (~2048 samples). Sent at the context's native rate; the API resamples.
const WORKLET = `class PCM16 extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const out = new Int16Array(ch.length);
    for (let i = 0; i < ch.length; i++) { const s = Math.max(-1, Math.min(1, ch[i])); out[i] = s < 0 ? s * 32768 : s * 32767; }
    this.buf.push(out); this.n += out.length;
    if (this.n >= 2048) {
      const merged = new Int16Array(this.n); let o = 0;
      for (const b of this.buf) { merged.set(b, o); o += b.length; }
      this.port.postMessage(merged.buffer, [merged.buffer]); this.buf = []; this.n = 0;
    }
    return true;
  }
}
registerProcessor("pcm16", PCM16);`;

function toB64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(s: string) {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export default function LiveSession({ ctx, briefing, onMemoryChange }: Props) {
  const [avail, setAvail] = useState<Availability | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [busy, setBusy] = useState<"snapshot" | "report" | null>(null);
  const [armed, setArmed] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);

  const statusRef = useRef<Status>("idle");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<AudioNode[]>([]);
  const timersRef = useRef<number[]>([]);
  const playHeadRef = useRef(0);
  const sourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const framesRef = useRef<Frame[]>([]);
  const lineId = useRef(0);

  const setStatusBoth = (s: Status) => {
    statusRef.current = s;
    setStatus(s);
  };

  // ─── transcript ───────────────────────────────────────────────────────────
  const sysLine = useCallback((text: string) => setLines((ls) => [...ls, { id: ++lineId.current, role: "system", text }]), []);
  const append = useCallback((role: "tech" | "gemini", text: string) => {
    setLines((ls) => {
      for (let i = ls.length - 1; i >= 0; i--) {
        if (ls[i].role === role) {
          if (!ls[i].open) break;
          const next = ls.slice();
          next[i] = { ...ls[i], text: ls[i].text + text };
          return next;
        }
      }
      return [...ls, { id: ++lineId.current, role, text, open: true }];
    });
  }, []);
  const closeOpen = useCallback((role?: "tech" | "gemini") => setLines((ls) => ls.map((l) => (l.open && (!role || l.role === role) ? { ...l, open: false } : l))), []);

  // ─── audio out ────────────────────────────────────────────────────────────
  function playPcm(b64: string) {
    const ac = audioRef.current;
    if (!ac) return;
    const bytes = fromB64(b64);
    const i16 = new Int16Array(bytes.buffer, 0, bytes.byteLength >> 1);
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
    const buf = ac.createBuffer(1, f32.length, 24000); // Gemini replies at 24 kHz; the context resamples
    buf.copyToChannel(f32, 0);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(ac.destination);
    const t = Math.max(ac.currentTime, playHeadRef.current);
    src.start(t);
    playHeadRef.current = t + buf.duration;
    sourcesRef.current.add(src);
    setSpeaking(true);
    src.onended = () => {
      sourcesRef.current.delete(src);
      if (!sourcesRef.current.size) setSpeaking(false);
    };
  }
  function flushAudio() {
    sourcesRef.current.forEach((s) => {
      try {
        s.stop();
      } catch {
        /* already ended */
      }
    });
    sourcesRef.current.clear();
    playHeadRef.current = 0;
    setSpeaking(false);
  }

  // ─── camera ───────────────────────────────────────────────────────────────
  async function ensureCamera(withAudio: boolean) {
    let stream = streamRef.current;
    if (!stream || (withAudio && !stream.getAudioTracks().some((t) => t.readyState === "live"))) {
      stream?.getTracks().forEach((t) => t.stop());
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: withAudio ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false,
      });
      streamRef.current = stream;
      setCamOn(true);
    }
    const v = videoRef.current;
    if (v && v.srcObject !== stream) {
      v.srcObject = stream;
      await v.play().catch(() => undefined);
    }
    return stream;
  }
  function grab(width: number, quality: number): string | null {
    const v = videoRef.current;
    if (!v || v.readyState < 2 || !v.videoWidth) return null;
    const c = (canvasRef.current ??= document.createElement("canvas"));
    const h = Math.round((v.videoHeight / v.videoWidth) * width);
    c.width = width;
    c.height = h;
    c.getContext("2d")?.drawImage(v, 0, 0, width, h);
    return c.toDataURL("image/jpeg", quality).split(",")[1] ?? null;
  }
  /** Keyframes for the visual report: on log_observation, on tap, every 30 s, and on each snapshot. Keeps the last 8. */
  function keyframe(reason: "start" | "timer" | "observation" | "tap" | "snapshot", jpeg = grab(512, 0.55)) {
    if (!jpeg) return;
    framesRef.current = [...framesRef.current.slice(-7), { at: Date.now(), jpeg }];
    setFrameCount(framesRef.current.length);
    if (reason === "tap") sysLine("Frame saved for the visual report.");
  }

  // ─── tools ────────────────────────────────────────────────────────────────
  async function handleTools(calls: FunctionCall[]) {
    const functionResponses = [];
    for (const fc of calls) {
      const args = (fc.args ?? {}) as Record<string, string | undefined>;
      let response: Record<string, unknown>;
      let scheduling = FunctionResponseScheduling.WHEN_IDLE;
      switch (fc.name) {
        case "confirm_plan": {
          addFieldNote(ctx.event.id, "confirmation", args.note ?? "Confirmed on the live call");
          recordFeedback(ctx.event.category, "confirm");
          sysLine("Plan confirmed. Logged and sent to ops.");
          void notifyOps({ event: ctx.event, folder: ctx.folder, kind: "confirmation", note: args.note });
          response = { result: "confirmed; ops notified" };
          break;
        }
        case "log_observation": {
          addFieldNote(ctx.event.id, "observation", args.text ?? "");
          keyframe("observation");
          sysLine(`Logged: ${args.text ?? ""}`);
          response = { result: "logged with a keyframe" };
          break;
        }
        case "escalate": {
          addFieldNote(ctx.event.id, "escalation", args.reason ?? "");
          sysLine(`Escalating to ops: ${args.reason ?? ""}`);
          const r = await notifyOps({ event: ctx.event, folder: ctx.folder, kind: "escalation", note: args.reason });
          response = { result: r.ok ? "ops notified on Discord" : `Discord unavailable (${r.reason}); logged locally` };
          scheduling = FunctionResponseScheduling.INTERRUPT;
          break;
        }
        case "get_past_incidents": {
          response = { incidents: similar(ctx.event, ctx).map((i) => ({ summary: i.summary, outcome: i.outcome, source: i.source })) };
          scheduling = FunctionResponseScheduling.INTERRUPT;
          break;
        }
        default:
          response = { error: `unknown tool ${fc.name}` };
      }
      functionResponses.push({ id: fc.id, name: fc.name, response, scheduling });
    }
    onMemoryChange();
    sessionRef.current?.sendToolResponse({ functionResponses });
  }

  function onMessage(msg: LiveServerMessage) {
    const sc = msg.serverContent;
    if (sc?.interrupted) {
      flushAudio();
      closeOpen("gemini");
    }
    if (sc?.inputTranscription?.text) append("tech", sc.inputTranscription.text);
    if (sc?.outputTranscription?.text) append("gemini", sc.outputTranscription.text);
    for (const p of sc?.modelTurn?.parts ?? []) if (p.inlineData?.data) playPcm(p.inlineData.data);
    if (sc?.turnComplete) closeOpen();
    if (msg.toolCall?.functionCalls?.length) void handleTools(msg.toolCall.functionCalls);
    if (msg.goAway) sysLine(`Google will end this call in ${msg.goAway.timeLeft ?? "a moment"}. Tap Start again to reconnect.`);
  }

  // ─── session lifecycle ────────────────────────────────────────────────────
  function teardown() {
    timersRef.current.forEach((t) => window.clearInterval(t));
    timersRef.current = [];
    sessionRef.current?.close();
    sessionRef.current = null;
    nodesRef.current.forEach((n) => n.disconnect());
    nodesRef.current = [];
    flushAudio();
    streamRef.current?.getAudioTracks().forEach((t) => t.stop()); // camera stays on for photos and the report
  }

  const end = (reason: string) => {
    teardown();
    closeOpen();
    setStatusBoth("ended");
    sysLine(reason);
  };

  async function start() {
    if (!avail?.configured || statusRef.current === "starting" || statusRef.current === "live") return;
    setLines([]);
    setStatusBoth("starting");
    // Created inside the tap so iOS lets it play.
    const ac = audioRef.current ?? new AudioContext();
    audioRef.current = ac;
    try {
      const stream = await ensureCamera(true);
      const res = await fetch("/api/gemini/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ systemInstruction: briefing, tools: FIELD_TOOLS }),
      });
      const tok = (await res.json()) as { ok: boolean; reason?: string; token: string; model: string; apiVersion: string; config: Record<string, unknown> };
      if (!res.ok || !tok.ok) throw new Error(tok.reason ?? `token request failed (${res.status})`);

      const ai = new GoogleGenAI({ apiKey: tok.token, httpOptions: { apiVersion: tok.apiVersion } });
      const session = await ai.live.connect({
        model: tok.model,
        config: tok.config,
        callbacks: {
          onopen: () => setStatusBoth("live"),
          onmessage: onMessage,
          onerror: (ev) => end(`Connection error: ${ev.message || "unknown"}. Tap Start again.`),
          onclose: (ev) => {
            if (statusRef.current === "live" || statusRef.current === "starting") end(ev.reason ? `Call ended: ${ev.reason}` : "Call ended.");
          },
        },
      });
      sessionRef.current = session;

      await ac.resume();
      await ac.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" })));
      const source = ac.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ac, "pcm16");
      node.port.onmessage = (ev: MessageEvent<ArrayBuffer>) =>
        sessionRef.current?.sendRealtimeInput({ audio: { data: toB64(ev.data), mimeType: `audio/pcm;rate=${ac.sampleRate}` } });
      source.connect(node);
      nodesRef.current = [source, node];

      timersRef.current.push(
        window.setInterval(() => {
          const jpeg = grab(512, 0.6);
          if (jpeg) sessionRef.current?.sendRealtimeInput({ video: { data: jpeg, mimeType: "image/jpeg" } });
        }, 1000),
        window.setInterval(() => keyframe("timer"), 30_000),
      );
      window.setTimeout(() => keyframe("start"), 1500);
      setStatusBoth("live");
      sysLine(`Live with ${tok.model}. Say what you see; it hears you and watches the camera.`);
    } catch (err) {
      const e = err as Error;
      const msg = e.name === "NotAllowedError" ? "Camera or microphone permission was denied. Allow both in the browser settings and try again." : e.message;
      teardown();
      setStatusBoth("ended");
      sysLine(`Could not start the call: ${msg}`);
    }
  }

  async function snapshot() {
    if (!avail?.configured || busy) return;
    setBusy("snapshot");
    try {
      await ensureCamera(false);
      await new Promise((r) => window.setTimeout(r, 300)); // first frame after the camera opens
      const jpeg = grab(768, 0.7);
      if (!jpeg) throw new Error("the camera is not ready yet");
      keyframe("snapshot", jpeg);
      setLines((ls) => [...ls, { id: ++lineId.current, role: "tech", text: "(photo) What do you see, and what is my next step?" }]);
      const res = await fetch("/api/gemini/snapshot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: jpeg, systemInstruction: briefing }),
      });
      const j = (await res.json()) as { ok: boolean; text?: string; reason?: string };
      if (!res.ok || !j.ok) throw new Error(j.reason ?? `HTTP ${res.status}`);
      setLines((ls) => [...ls, { id: ++lineId.current, role: "gemini", text: j.text || "(no reply)" }]);
    } catch (err) {
      sysLine(`Photo failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function buildReport() {
    if (!avail?.configured || busy || !framesRef.current.length) return;
    setBusy("report");
    try {
      const frames = framesRef.current;
      const observations = fieldNotes(ctx.event.id)
        .filter((n) => n.kind === "observation")
        .map((n) => n.text);
      const res = await fetch("/api/gemini/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ systemInstruction: briefing, frames: frames.map((f) => f.jpeg), observations }),
      });
      const j = (await res.json()) as {
        ok: boolean;
        reason?: string;
        model?: string;
        report?: { observed_condition: string; severity: "low" | "medium" | "high" | "critical"; components_visible: string[]; matches_telemetry: boolean; notes: string };
      };
      if (!res.ok || !j.ok || !j.report) throw new Error(j.reason ?? `HTTP ${res.status}`);
      const report = addVisualReport({
        eventId: ctx.event.id,
        at: Date.now(),
        ...j.report,
        photos: frames.slice(-4).map((f) => `data:image/jpeg;base64,${f.jpeg}`),
        model: j.model,
      });
      sysLine(`Visual report saved: ${report.observed_condition} (${report.severity}).`);
      onMemoryChange();
    } catch (err) {
      sysLine(`Visual report failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function escalateTap() {
    if (!armed) {
      setArmed(true);
      window.setTimeout(() => setArmed(false), 4000);
      return;
    }
    setArmed(false);
    const reason = "Technician requested help from the field view";
    addFieldNote(ctx.event.id, "escalation", reason);
    onMemoryChange();
    const r = await notifyOps({ event: ctx.event, folder: ctx.folder, kind: "escalation", note: reason });
    sysLine(r.ok ? "Escalated to ops on Discord." : `Escalation logged locally; Discord unavailable (${r.reason}).`);
  }

  useEffect(() => {
    fetch("/api/gemini/token")
      .then((r) => r.json() as Promise<Availability>)
      .then(setAvail)
      .catch(() => setAvail({ configured: false, model: "" }));
    return () => {
      teardown();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void audioRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount only
  }, []);

  const live = status === "live";
  const off = avail !== null && !avail.configured;

  return (
    <>
      <section className="px-4 pt-7">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-[var(--muted)]">Live with Gemini</h2>
          <span className={`flex items-center gap-2 text-[14px] ${live ? "text-[var(--text)]" : "text-[var(--dim)]"} ${speaking ? "speaking" : ""}`} aria-live="polite">
            {live ? <span className="live-dot" aria-hidden /> : null}
            {live ? (speaking ? "Speaking" : "Listening") : status === "starting" ? "Connecting…" : avail === null ? "Checking…" : avail.configured ? `Ready · ${avail.model}` : "Off"}
          </span>
        </div>
        <button
          type="button"
          className="relative mt-3 block aspect-[4/3] w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]"
          onClick={() => camOn && keyframe("tap")}
          aria-label={camOn ? "Save this frame for the visual report" : "Camera preview"}
          disabled={!camOn}
        >
          <video ref={videoRef} muted playsInline autoPlay className={`h-full w-full object-cover ${camOn ? "" : "hidden"}`} />
          {!camOn ? (
            <span className="absolute inset-0 grid place-items-center p-6 text-center text-[15px] leading-6 text-[var(--dim)]">
              {avail === null
                ? "Checking the server…"
                : avail.configured
                  ? "The camera starts with the call. Point it at the pump, the VFD panel or the leak."
                  : "Gemini is not configured on this server (GEMINI_API_KEY), so the live call and photos are off. Plan, runbook and memory still work."}
            </span>
          ) : (
            <span className="absolute bottom-2 right-2 rounded-md bg-black/55 px-2 py-1 text-[12px] font-medium text-white">Tap to save a frame</span>
          )}
        </button>
        <Transcript lines={lines} speaking={speaking} />
      </section>

      <nav className="bar" aria-label="Call controls">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          {live || status === "starting" ? (
            <button type="button" className="btn btn-ghost" onClick={() => end("Call ended.")} disabled={status === "starting"}>
              {status === "starting" ? "Connecting…" : "End call"}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={start} disabled={!avail?.configured}>
              {off ? "Live call unavailable" : status === "ended" ? "Start again" : "Start live call"}
            </button>
          )}
          <button type="button" className="btn btn-ghost px-5" onClick={snapshot} disabled={!avail?.configured || !!busy}>
            {busy === "snapshot" ? "Asking…" : "Photo"}
          </button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={buildReport} disabled={!avail?.configured || !!busy || !frameCount}>
            {busy === "report" ? "Writing report…" : `Visual report${frameCount ? ` · ${frameCount} frames` : ""}`}
          </button>
          <button type="button" className="btn btn-danger btn-sm" data-armed={armed} onClick={escalateTap}>
            {armed ? "Tap again to escalate" : "Escalate to ops"}
          </button>
        </div>
      </nav>
    </>
  );
}
