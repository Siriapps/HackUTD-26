"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import * as THREE from "three";
import type { Event, Plan } from "@/lib/data/types";
import { eventActiveAt, planLevelAt, truckSchedule } from "./derive";
import { PipeRig } from "./PipeRig";
import type { Twin3DProps, TwinLimits, TwinTrucking } from "./types";

/*
 * Performance budget (integrated GPU, 60 fps): ~30 draw calls, two instanced particle systems, no shadows,
 * no post-processing, DPR capped at 2. The scene graph is memoised; sub-components read the latest props from a
 * ref inside useFrame and mutate preallocated objects, so a scrub step costs no React work and no allocations.
 */

type Live = RefObject<Twin3DProps & { motion: boolean }>;

// Colours come from the design tokens so the twin never duplicates a hex. Fallback grey only without a stylesheet.
const TOKENS = {
  failure: "--cat-failure",
  leak: "--cat-leak",
  degradation: "--cat-degradation",
  ok: "--ok",
  warn: "--warn",
  shutdown: "--shutdown",
  accent: "--accent",
  water: "--water",
  surface0: "--surface-0",
  surface1: "--surface-1",
  surface2: "--surface-2",
  surface3: "--surface-3",
  text2: "--text-2",
  text3: "--text-3",
} as const;
type Palette = Record<keyof typeof TOKENS, THREE.Color>;

function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const out = {} as Palette;
  for (const k of Object.keys(TOKENS) as (keyof typeof TOKENS)[]) {
    out[k] = new THREE.Color(cs.getPropertyValue(TOKENS[k]).trim() || "#808080");
  }
  return out;
}

// Renderer setup, hoisted so Canvas sees stable props across re-renders.
const DPR: [number, number] = [1, 2];
const GL = { antialias: true, powerPreference: "high-performance" as const, alpha: false, stencil: false };
const CAMERA = { fov: 32, position: [3.6, 3.1, 7.4] as [number, number, number], near: 0.1, far: 80 };

// Scene layout (scene units; one unit ≈ a few metres).
const TANK = { x: -1.7, r: 0.85, h: 2.0 };
const PUMP = { x: 0.15, y: 0.22 };
const DISPOSAL = new THREE.Vector3(4.9, 0.14, -0.8);
const ROAD = { x: -1.7, zFar: 7.5, zPad: 1.95 };
const FLOW_N = 72;
const DRIP_N = 40;
const LEAK_U = 0.45; // where along the pipeline the leak is drawn
const CURVE_SAMPLES = 256;
// Motion (see docs/DESIGN.md → Motion): fault pulse 1 Hz, eased values reach 63 % in ~170 ms, idle orbit ~150 s/turn.
const PULSE_HZ = 1;
const EASE_PER_S = 6;
const ORBIT_SPEED = 0.4;
const ORBIT_RESUME_MS = 3000;
// Truck animation timing in dataset minutes (presentation only; arrival times come from ops.json).
const APPROACH_MIN = 8;
const DWELL_MIN = 25;
const LEAVE_MIN = 8;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (p: number) => 1 - (1 - p) ** 3;
const easeIn = (p: number) => p ** 3;
/** Frame-rate-independent smoothing factor; snaps when motion is off. */
const smooth = (dt: number, motion: boolean, speed = EASE_PER_S) => (motion ? Math.min(1, dt * speed) : 1);

const reducedMotionQuery = () => window.matchMedia("(prefers-reduced-motion: reduce)");
function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const mq = reducedMotionQuery();
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => reducedMotionQuery().matches,
    () => false,
  );
}

export default function Scene(props: Twin3DProps) {
  const reduced = usePrefersReducedMotion();
  const live = useRef({ ...props, motion: !reduced });
  useEffect(() => {
    live.current = { ...props, motion: !reduced };
  });
  // Idle orbit pauses while the pointer is over the twin or dragging it, and resumes a moment after.
  const [idle, setIdle] = useState(true);
  const hovering = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pause = useCallback(() => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    setIdle(false);
  }, []);
  const resumeLater = useCallback(() => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => {
      if (!hovering.current) setIdle(true);
    }, ORBIT_RESUME_MS);
  }, []);
  useEffect(
    () => () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    },
    [],
  );
  return (
    <div
      className="absolute inset-0"
      onPointerEnter={() => {
        hovering.current = true;
        pause();
      }}
      onPointerLeave={() => {
        hovering.current = false;
        resumeLater();
      }}
    >
      <Canvas dpr={DPR} frameloop={reduced ? "demand" : "always"} gl={GL} camera={CAMERA}>
        <Redraw when={props.t} enabled={reduced} />
        <World live={live} limits={props.limits} orbit={!reduced && idle} onInteractStart={pause} onInteractEnd={resumeLater} />
      </Canvas>
    </div>
  );
}

/** With reduced motion the loop is on demand: redraw once per displayed moment. */
function Redraw({ when, enabled }: { when: number; enabled: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (enabled) invalidate();
  }, [when, enabled, invalidate]);
  return null;
}

const World = memo(function World({
  live,
  limits,
  orbit,
  onInteractStart,
  onInteractEnd,
}: {
  live: Live;
  limits: TwinLimits;
  orbit: boolean;
  onInteractStart: () => void;
  onInteractEnd: () => void;
}) {
  const palette = useMemo(() => readPalette(), []);
  const curve = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(PUMP.x + 0.32, 0.3, 0),
        new THREE.Vector3(1.7, 0.46, -0.25),
        new THREE.Vector3(3.4, 0.34, -0.55),
        DISPOSAL.clone(),
      ]),
    [],
  );
  return (
    <>
      <color attach="background" args={[palette.surface0.getHex()]} />
      <fogExp2 attach="fog" args={[palette.surface0.getHex(), 0.038]} />
      <hemisphereLight color={palette.text2} groundColor={palette.surface0} intensity={0.55} />
      <directionalLight position={[4, 7, 4]} intensity={1.4} color={0xdbe4ff} />
      <ambientLight intensity={0.22} />
      <Ground palette={palette} />
      <Tank live={live} palette={palette} limits={limits} />
      <Pump live={live} palette={palette} />
      <PipeRig curve={curve} />
      <Pipeline live={live} palette={palette} curve={curve} />
      <Leak live={live} palette={palette} curve={curve} />
      <Disposal palette={palette} />
      <Trucks live={live} palette={palette} />
      <OrbitControls
        makeDefault
        enablePan={false}
        enableZoom={false}
        enableDamping
        dampingFactor={0.08}
        autoRotate={orbit}
        autoRotateSpeed={ORBIT_SPEED}
        minPolarAngle={0.55}
        maxPolarAngle={1.3}
        target={[1.3, 0.5, 0]}
        onStart={onInteractStart}
        onEnd={onInteractEnd}
      />
    </>
  );
});

function Ground({ palette }: { palette: Palette }) {
  const major = useMemo(() => palette.text3.clone().lerp(palette.surface1, 0.5), [palette]);
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.002}>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color={palette.surface1} roughness={1} />
      </mesh>
      <Grid
        position-y={0.001}
        args={[60, 60]}
        cellSize={0.5}
        cellThickness={0.5}
        cellColor={palette.surface3}
        sectionSize={2.5}
        sectionThickness={0.9}
        sectionColor={major}
        fadeDistance={18}
        fadeStrength={1.2}
      />
      {/* Truck road */}
      <mesh rotation-x={-Math.PI / 2} position={[ROAD.x, 0.004, (ROAD.zFar + ROAD.zPad) / 2 + 0.3]}>
        <planeGeometry args={[1.1, ROAD.zFar - ROAD.zPad + 1.2]} />
        <meshStandardMaterial color={palette.surface2} roughness={1} />
      </mesh>
    </>
  );
}

function Ring({ y, color, tube }: { y: number; color: THREE.Color; tube: number }) {
  return (
    <mesh rotation-x={Math.PI / 2} position-y={y}>
      <torusGeometry args={[TANK.r + 0.03, tube, 8, 72]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
}

function Tank({ live, palette, limits }: { live: Live; palette: Palette; limits: TwinLimits }) {
  const liquid = useRef<THREE.Mesh>(null);
  const liquidMat = useRef<THREE.MeshStandardMaterial>(null);
  const liquidGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(TANK.r * 0.94, TANK.r * 0.94, 1, 40);
    g.translate(0, 0.5, 0); // anchor at the bottom so scale.y is the fill height
    return g;
  }, []);
  const water = useMemo(() => palette.water.clone().lerp(palette.surface3, 0.2), [palette]);
  const target = useMemo(() => new THREE.Color(), []);
  const level = useRef(0);
  const flash = useRef(0);
  useFrame((_, dt) => {
    const { readings, plan, t, motion } = live.current;
    // While a plan is replayed the tank follows the optimiser's projected curve (truck slugs included).
    const planned = plan ? planLevelAt(plan, t) : null;
    const lp = Math.min(100, Math.max(0, planned ?? readings.level_pct));
    const shown = level.current;
    level.current += (lp - shown) * smooth(dt, motion);
    liquid.current!.scale.y = Math.max(0.001, (TANK.h * level.current) / 100);
    // A sudden drop (a truck slug) lights the liquid briefly, then decays.
    const drop = shown - lp;
    flash.current = Math.max(flash.current * (motion ? Math.max(0, 1 - dt * 2.5) : 0), drop > 1 ? clamp01(drop / 8) : 0);
    target.copy(lp >= limits.shutdown ? palette.shutdown : lp >= limits.warning ? palette.warn : water);
    const m = liquidMat.current!;
    m.color.lerp(target, smooth(dt, motion, 4));
    m.emissive.copy(m.color).multiplyScalar(0.35 + 0.8 * flash.current);
  });
  return (
    <group position={[TANK.x, 0, 0]}>
      <mesh position-y={0.025}>
        <cylinderGeometry args={[TANK.r + 0.25, TANK.r + 0.25, 0.05, 48]} />
        <meshStandardMaterial color={palette.surface3} roughness={0.9} />
      </mesh>
      <mesh ref={liquid} geometry={liquidGeo}>
        <meshStandardMaterial ref={liquidMat} color={water} emissive={water} roughness={0.25} metalness={0.1} />
      </mesh>
      <mesh position-y={TANK.h / 2}>
        <cylinderGeometry args={[TANK.r, TANK.r, TANK.h, 48, 1, false]} />
        <meshPhysicalMaterial
          color={palette.text2}
          transparent
          opacity={0.16}
          roughness={0.2}
          metalness={0.5}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <Ring y={(TANK.h * limits.warning) / 100} color={palette.warn} tube={0.012} />
      <Ring y={(TANK.h * limits.shutdown) / 100} color={palette.shutdown} tube={0.02} />
    </group>
  );
}

function makeHaloTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Pump({ live, palette }: { live: Live; palette: Palette }) {
  const bodyMat = useRef<THREE.MeshStandardMaterial>(null);
  const halo = useRef<THREE.Mesh>(null);
  const haloMat = useRef<THREE.MeshBasicMaterial>(null);
  const impeller = useRef<THREE.Mesh>(null);
  const haloTex = useMemo(() => makeHaloTexture(), []);
  const emissiveTarget = useMemo(() => new THREE.Color(), []);
  const black = useMemo(() => new THREE.Color(0, 0, 0), []);
  useFrame(({ clock }, dt) => {
    const { readings, event, t, facility, motion } = live.current;
    const active = event && eventActiveAt(event, t) ? event.category : null;
    const fault = readings.pump_status === 2 || active === "pump_failure";
    const running = !fault && readings.pump_status === 1 && readings.flow_bpd > 0;
    const pulse = motion ? 0.5 + 0.5 * Math.sin(clock.elapsedTime * 2 * Math.PI * PULSE_HZ) : 1;
    let intensity = 0;
    let haloOpacity = 0;
    if (fault) {
      emissiveTarget.copy(palette.failure);
      intensity = 0.45 + 0.6 * pulse;
      haloOpacity = 0.22 + 0.3 * pulse;
    } else if (active === "pump_degradation") {
      emissiveTarget.copy(palette.degradation);
      intensity = 0.55 + (motion ? 0.15 * Math.sin(clock.elapsedTime * 2) : 0);
      haloOpacity = 0.28;
    } else if (running) {
      emissiveTarget.copy(palette.ok);
      intensity = 0.35;
    } else {
      emissiveTarget.copy(black);
    }
    const k = smooth(dt, motion);
    const m = bodyMat.current!;
    m.emissive.lerp(emissiveTarget, k);
    m.emissiveIntensity += (intensity - m.emissiveIntensity) * k;
    const hm = haloMat.current!;
    hm.color.lerp(emissiveTarget, k);
    hm.opacity += (haloOpacity - hm.opacity) * k;
    halo.current!.scale.setScalar(fault ? 1.7 + 0.5 * pulse : 1.4);
    const ratio = running ? clamp01(readings.flow_bpd / facility.pump.max_flow_bpd) : 0;
    if (motion) impeller.current!.rotation.y += dt * 16 * ratio;
  });
  return (
    <group position={[PUMP.x, PUMP.y, 0]}>
      <mesh>
        <boxGeometry args={[0.5, 0.36, 0.36]} />
        <meshStandardMaterial ref={bodyMat} color={palette.text3} roughness={0.4} metalness={0.7} emissiveIntensity={0} />
      </mesh>
      <mesh position={[-0.42, 0.02, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.13, 0.13, 0.34, 20]} />
        <meshStandardMaterial color={palette.surface3} roughness={0.5} metalness={0.6} />
      </mesh>
      <group position={[0, 0, 0.19]} rotation-x={Math.PI / 2}>
        <mesh ref={impeller}>
          <cylinderGeometry args={[0.11, 0.11, 0.03, 6]} />
          <meshStandardMaterial color={palette.text2} roughness={0.3} metalness={0.8} />
        </mesh>
      </group>
      <mesh position-y={-0.22}>
        <boxGeometry args={[0.7, 0.04, 0.5]} />
        <meshStandardMaterial color={palette.surface3} roughness={0.9} />
      </mesh>
      <mesh ref={halo} rotation-x={-Math.PI / 2} position-y={-0.2}>
        <planeGeometry args={[1.4, 1.4]} />
        <meshBasicMaterial
          ref={haloMat}
          map={haloTex}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function Pipeline({ live, palette, curve }: { live: Live; palette: Palette; curve: THREE.CatmullRomCurve3 }) {
  const inst = useRef<THREE.InstancedMesh>(null);
  // Opaque industrial shell (gas-pipe look) + inner glow tube for live flow read.
  const shell = useMemo(() => new THREE.TubeGeometry(curve, 72, 0.095, 14, false), [curve]);
  const core = useMemo(() => new THREE.TubeGeometry(curve, 72, 0.055, 10, false), [curve]);
  const pts = useMemo(() => {
    const arr = new Float32Array((CURVE_SAMPLES + 1) * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i <= CURVE_SAMPLES; i++) {
      curve.getPointAt(i / CURVE_SAMPLES, v);
      arr.set([v.x, v.y, v.z], i * 3);
    }
    return arr;
  }, [curve]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const travel = useRef(0);
  const coreMat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((_, dt) => {
    const { readings, facility, motion, event, t } = live.current;
    const ratio = clamp01(readings.receive_flow_bpd / facility.pipeline.max_bpd);
    if (motion) travel.current = (travel.current + dt * 0.3 * ratio) % 1; // speed ∝ receive flow
    const visible = Math.round(FLOW_N * ratio); // density ∝ receive flow
    const mesh = inst.current!;
    for (let i = 0; i < FLOW_N; i++) {
      if (i >= visible) {
        dummy.scale.setScalar(0);
        dummy.position.set(0, -10, 0);
      } else {
        const k = (((i + 0.5) / FLOW_N + travel.current) % 1) * CURVE_SAMPLES;
        const j = Math.floor(k);
        const f = k - j;
        const a = j * 3;
        const b = Math.min(j + 1, CURVE_SAMPLES) * 3;
        dummy.position.set(
          pts[a] + (pts[b] - pts[a]) * f,
          pts[a + 1] + (pts[b + 1] - pts[a + 1]) * f,
          pts[a + 2] + (pts[b + 2] - pts[a + 2]) * f,
        );
        dummy.scale.setScalar(1);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    const leakOn = !!event && event.category === "pipeline_leak" && eventActiveAt(event, t);
    const m = coreMat.current!;
    if (leakOn) {
      m.color.copy(palette.leak);
      m.emissive.copy(palette.leak);
      m.emissiveIntensity = 0.55;
      m.opacity = 0.55;
    } else {
      m.color.copy(palette.text2);
      m.emissive.copy(palette.ok).multiplyScalar(ratio);
      m.emissiveIntensity = 0.15 + 0.45 * ratio;
      m.opacity = 0.22 + 0.35 * ratio;
    }
  });
  return (
    <>
      <mesh geometry={shell}>
        <meshStandardMaterial color="#6f7d6a" roughness={0.55} metalness={0.62} />
      </mesh>
      <mesh geometry={core}>
        <meshStandardMaterial
          ref={coreMat}
          color={palette.text2}
          transparent
          opacity={0.35}
          roughness={0.25}
          metalness={0.4}
          depthWrite={false}
          emissive={palette.ok}
          emissiveIntensity={0.2}
        />
      </mesh>
      <instancedMesh ref={inst} args={[undefined, undefined, FLOW_N]} frustumCulled={false}>
        <sphereGeometry args={[0.038, 6, 6]} />
        <meshBasicMaterial color={palette.ok} toneMapped={false} />
      </instancedMesh>
    </>
  );
}

function Leak({ live, palette, curve }: { live: Live; palette: Palette; curve: THREE.CatmullRomCurve3 }) {
  const inst = useRef<THREE.InstancedMesh>(null);
  const puddle = useRef<THREE.Mesh>(null);
  const lp = useMemo(() => curve.getPointAt(LEAK_U), [curve]);
  // Deterministic per-drop phase and sideways drift; no RNG per frame.
  const seeds = useMemo(
    () => Float32Array.from({ length: DRIP_N * 3 }, (_, i) => (i % 3 === 0 ? (i / 3 + 0.5) / DRIP_N : Math.sin(i * 12.9898) * 0.5)),
    [],
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const fall = useRef(0);
  useFrame((_, dt) => {
    const { event, t, readings, facility, motion } = live.current;
    const on = !!event && event.category === "pipeline_leak" && eventActiveAt(event, t);
    const ratio = clamp01(readings.flow_bpd / facility.pump.max_flow_bpd);
    if (motion) fall.current = (fall.current + dt * (on ? 0.4 + 0.6 * ratio : 0)) % 1;
    const n = on ? Math.round(DRIP_N * (0.3 + 0.7 * ratio)) : 0;
    const mesh = inst.current!;
    const y0 = lp.y - 0.06;
    for (let i = 0; i < DRIP_N; i++) {
      if (i >= n) {
        dummy.scale.setScalar(0);
        dummy.position.set(0, -10, 0);
      } else {
        const tau = (seeds[i * 3] + fall.current) % 1;
        dummy.position.set(lp.x + seeds[i * 3 + 1] * 0.3 * tau, y0 * (1 - tau * tau), lp.z + 0.12 + seeds[i * 3 + 2] * 0.3 * tau);
        dummy.scale.setScalar(0.7 + 0.5 * (1 - tau));
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    const hours = on && event ? (t - event.onset_unix) / 3600 : 0;
    puddle.current!.scale.setScalar(on ? 0.2 + 0.6 * clamp01(hours / 24) : 0.0001);
    puddle.current!.visible = on;
  });
  return (
    <>
      <instancedMesh ref={inst} args={[undefined, undefined, DRIP_N]} frustumCulled={false}>
        <sphereGeometry args={[0.028, 5, 5]} />
        <meshBasicMaterial color={palette.leak} toneMapped={false} />
      </instancedMesh>
      <mesh ref={puddle} rotation-x={-Math.PI / 2} position={[lp.x, 0.006, lp.z + 0.12]}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial color={palette.leak} transparent opacity={0.32} depthWrite={false} toneMapped={false} />
      </mesh>
    </>
  );
}

function Disposal({ palette }: { palette: Palette }) {
  return (
    <group position={DISPOSAL}>
      <mesh position-y={-0.1}>
        <cylinderGeometry args={[0.5, 0.5, 0.05, 32]} />
        <meshStandardMaterial color={palette.surface3} roughness={0.9} />
      </mesh>
      <mesh position-y={0.2}>
        <cylinderGeometry args={[0.1, 0.12, 0.6, 16]} />
        <meshStandardMaterial color={palette.text3} roughness={0.4} metalness={0.7} />
      </mesh>
      <mesh position={[0.35, 0.05, 0.2]}>
        <boxGeometry args={[0.4, 0.3, 0.3]} />
        <meshStandardMaterial color={palette.surface3} roughness={0.6} metalness={0.4} />
      </mesh>
    </group>
  );
}

function TruckMesh({ palette }: { palette: Palette }) {
  return (
    <>
      <mesh position={[0, 0.1, 0]}>
        <boxGeometry args={[0.32, 0.06, 1.1]} />
        <meshStandardMaterial color={palette.surface3} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.3, 0.42]}>
        <boxGeometry args={[0.34, 0.32, 0.3]} />
        <meshStandardMaterial color={palette.text2} roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.32, -0.14]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.17, 0.17, 0.74, 18]} />
        <meshStandardMaterial color={palette.text3} roughness={0.35} metalness={0.7} />
      </mesh>
      <mesh position={[0, 0.5, 0.42]}>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshStandardMaterial color={palette.failure} emissive={palette.failure} emissiveIntensity={1.2} toneMapped={false} />
      </mesh>
      {[-0.17, 0.17].map((x) =>
        [-0.36, 0.3].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.085, z]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.085, 0.085, 0.07, 12]} />
            <meshStandardMaterial color={palette.surface0} roughness={0.9} />
          </mesh>
        )),
      )}
    </>
  );
}

const MAX_TRUCKS = 3;

function Trucks({ live, palette }: { live: Live; palette: Palette }) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  const cache = useRef<{ plan?: Plan; event?: Event; trucking?: TwinTrucking; trucks: number; arrivals: number[] }>({
    trucks: 0,
    arrivals: [],
  });
  useFrame(() => {
    const { plan, event, trucking, t } = live.current;
    const c = cache.current;
    if (c.plan !== plan || c.event !== event || c.trucking !== trucking) {
      const s = truckSchedule(plan, event, trucking);
      c.plan = plan;
      c.event = event;
      c.trucking = trucking;
      c.trucks = Math.min(MAX_TRUCKS, s.trucks);
      c.arrivals = s.arrivals;
    }
    for (let j = 0; j < MAX_TRUCKS; j++) {
      const g = groups.current[j];
      if (!g) continue;
      let z = NaN;
      let heading = 0;
      if (j < c.trucks) {
        for (let i = 0; i < c.arrivals.length; i++) {
          const m = (t - c.arrivals[i]) / 60; // minutes since this arrival
          if (m >= -APPROACH_MIN && m < 0) {
            z = THREE.MathUtils.lerp(ROAD.zFar, ROAD.zPad, easeOut(1 + m / APPROACH_MIN));
            heading = Math.PI;
            break;
          }
          if (m >= 0 && m <= DWELL_MIN) {
            z = ROAD.zPad;
            heading = Math.PI;
            break;
          }
          if (m > DWELL_MIN && m <= DWELL_MIN + LEAVE_MIN) {
            z = THREE.MathUtils.lerp(ROAD.zPad, ROAD.zFar, easeIn((m - DWELL_MIN) / LEAVE_MIN));
            heading = 0;
            break;
          }
        }
      }
      g.visible = !Number.isNaN(z);
      if (g.visible) {
        g.position.set(ROAD.x + (j - (c.trucks - 1) / 2) * 0.55, 0, z);
        g.rotation.y = heading;
      }
    }
  });
  return (
    <>
      {Array.from({ length: MAX_TRUCKS }, (_, j) => (
        <group
          key={j}
          visible={false}
          ref={(el) => {
            groups.current[j] = el;
          }}
        >
          <TruckMesh palette={palette} />
        </group>
      ))}
    </>
  );
}
