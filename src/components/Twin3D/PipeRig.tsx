"use client";

/**
 * Industrial pipe rack inspired by field gas-pipe photography (elbows, flanges, supports, valve).
 * Procedural geometry only — the Sketchfab source is NoAI / not redistributed.
 */
import { useMemo } from "react";
import * as THREE from "three";

const STEEL = "#8a939e";
const STEEL_DARK = "#5c6573";
const PAINT = "#6f7d6a"; // weathered industrial green-grey
const FLANGE = "#9aa3ae";
const BOLT = "#3a4250";

function Flange({ radius = 0.12 }: { radius?: number }) {
  return (
    <group>
      <mesh>
        <cylinderGeometry args={[radius * 1.55, radius * 1.55, 0.028, 20]} />
        <meshStandardMaterial color={FLANGE} roughness={0.45} metalness={0.75} />
      </mesh>
      <mesh>
        <cylinderGeometry args={[radius * 1.05, radius * 1.05, 0.036, 16]} />
        <meshStandardMaterial color={STEEL_DARK} roughness={0.5} metalness={0.7} />
      </mesh>
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * radius * 1.28, 0, Math.sin(a) * radius * 1.28]}>
            <cylinderGeometry args={[0.012, 0.012, 0.04, 6]} />
            <meshStandardMaterial color={BOLT} roughness={0.6} metalness={0.85} />
          </mesh>
        );
      })}
    </group>
  );
}

function StraightPipe({
  length,
  radius = 0.09,
  color = PAINT,
}: {
  length: number;
  radius?: number;
  color?: string;
}) {
  return (
    <mesh>
      <cylinderGeometry args={[radius, radius, length, 16]} />
      <meshStandardMaterial color={color} roughness={0.55} metalness={0.55} />
    </mesh>
  );
}

function Elbow90({ radius = 0.09, color = PAINT }: { radius?: number; color?: string }) {
  const geo = useMemo(() => {
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(radius * 2.2, 0, 0),
      new THREE.Vector3(radius * 2.2, radius * 2.2, 0),
    );
    return new THREE.TubeGeometry(curve, 10, radius, 12, false);
  }, [radius]);
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial color={color} roughness={0.55} metalness={0.55} />
    </mesh>
  );
}

function PipeSupport({ height = 0.55 }: { height?: number }) {
  return (
    <group>
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[0.06, height, 0.06]} />
        <meshStandardMaterial color={STEEL_DARK} roughness={0.7} metalness={0.5} />
      </mesh>
      <mesh position={[0, height, 0]}>
        <boxGeometry args={[0.22, 0.04, 0.1]} />
        <meshStandardMaterial color={STEEL} roughness={0.6} metalness={0.55} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[0.28, 0.04, 0.18]} />
        <meshStandardMaterial color={STEEL_DARK} roughness={0.85} metalness={0.3} />
      </mesh>
    </group>
  );
}

function GateValve({ radius = 0.1 }: { radius?: number }) {
  return (
    <group>
      <mesh>
        <boxGeometry args={[radius * 2.4, radius * 2.2, radius * 1.6]} />
        <meshStandardMaterial color={STEEL} roughness={0.4} metalness={0.7} />
      </mesh>
      <mesh position={[0, radius * 1.55, 0]}>
        <cylinderGeometry args={[0.035, 0.035, radius * 1.1, 10]} />
        <meshStandardMaterial color={STEEL_DARK} roughness={0.45} metalness={0.7} />
      </mesh>
      <mesh position={[0, radius * 2.25, 0]} rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[0.11, 0.016, 8, 20]} />
        <meshStandardMaterial color={FLANGE} roughness={0.35} metalness={0.8} />
      </mesh>
      {Array.from({ length: 4 }, (_, i) => {
        const a = (i / 4) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.11, radius * 2.25, Math.sin(a) * 0.11]} rotation={[0, a, 0]}>
            <boxGeometry args={[0.02, 0.02, 0.12]} />
            <meshStandardMaterial color={FLANGE} roughness={0.4} metalness={0.75} />
          </mesh>
        );
      })}
    </group>
  );
}

/** Secondary rack of parallel process pipes (visual signature of a pad manifold). */
function SideRack() {
  const runs = [
    { z: 0.55, y: 0.42, r: 0.055, color: PAINT },
    { z: 0.72, y: 0.58, r: 0.045, color: STEEL },
    { z: 0.88, y: 0.38, r: 0.05, color: STEEL_DARK },
  ];
  return (
    <group position={[1.15, 0, 0.15]}>
      {runs.map((run, i) => (
        <group key={i} position={[0, run.y, run.z]}>
          <group rotation={[0, 0, Math.PI / 2]}>
            <StraightPipe length={2.6} radius={run.r} color={run.color} />
          </group>
          <group position={[-1.1, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <Flange radius={run.r} />
          </group>
          <group position={[1.1, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <Flange radius={run.r} />
          </group>
          <group position={[-0.35, -run.y, 0]}>
            <PipeSupport height={run.y} />
          </group>
          <group position={[0.55, -run.y, 0]}>
            <PipeSupport height={run.y} />
          </group>
        </group>
      ))}
      {/* Vertical riser with elbow into the rack */}
      <group position={[-1.35, 0.2, 0.55]}>
        <StraightPipe length={0.4} radius={0.055} />
        <group position={[0, 0.22, 0]} rotation={[0, Math.PI / 2, 0]}>
          <Elbow90 radius={0.055} />
        </group>
      </group>
    </group>
  );
}

/**
 * Main export line dressing around the live flow curve: flanges, valve near the pump,
 * mid-span supports, and a disposal-side riser. The translucent TubeGeometry stays for flow particles.
 */
export function PipeRig({ curve }: { curve: THREE.CatmullRomCurve3 }) {
  const stations = useMemo(() => {
    const us = [0.08, 0.22, 0.38, 0.55, 0.72, 0.9];
    const tangent = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const binormal = new THREE.Vector3();
    return us.map((u) => {
      const p = curve.getPointAt(u);
      curve.getTangentAt(u, tangent).normalize();
      // Build a stable frame so flanges sit perpendicular to the pipe.
      if (Math.abs(tangent.y) < 0.9) normal.set(0, 1, 0).cross(tangent).normalize();
      else normal.set(1, 0, 0).cross(tangent).normalize();
      binormal.copy(tangent).cross(normal).normalize();
      const m = new THREE.Matrix4().makeBasis(normal, tangent, binormal);
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      return { p, q, u };
    });
  }, [curve]);

  return (
    <group>
      <SideRack />

      {/* Pump-side suction / discharge dressing */}
      <group position={[0.15 + 0.32, 0.3, 0]}>
        <group rotation={[0, 0, Math.PI / 2]}>
          <Flange radius={0.085} />
        </group>
        <group position={[0.28, 0, 0]}>
          <GateValve radius={0.09} />
        </group>
        <group position={[0.55, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <Flange radius={0.085} />
        </group>
      </group>

      {stations.map(({ p, q, u }, i) => (
        <group key={i} position={[p.x, p.y, p.z]} quaternion={q}>
          <Flange radius={u > 0.7 ? 0.075 : 0.09} />
          {i % 2 === 1 && (
            <group position={[0, -p.y, 0]}>
              <PipeSupport height={Math.max(0.25, p.y)} />
            </group>
          )}
        </group>
      ))}

      {/* Disposal riser head */}
      <group position={[4.9, 0.45, -0.8]}>
        <StraightPipe length={0.55} radius={0.08} color={STEEL} />
        <group position={[0, 0.32, 0]} rotation={[0, 0, Math.PI / 2]}>
          <Flange radius={0.08} />
        </group>
        <group position={[0.18, 0.32, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <Elbow90 radius={0.08} color={STEEL} />
        </group>
      </group>

      {/* Insulation wrap mid-span (foam cylinder over a short run) */}
      <group position={[2.4, 0.4, -0.35]} rotation={[0.05, 0.35, Math.PI / 2]}>
        <mesh>
          <cylinderGeometry args={[0.13, 0.13, 0.85, 14]} />
          <meshStandardMaterial color="#c4b8a4" roughness={0.9} metalness={0.05} />
        </mesh>
        <mesh position={[0, 0.42, 0]}>
          <cylinderGeometry args={[0.135, 0.135, 0.04, 14]} />
          <meshStandardMaterial color="#8b7f6c" roughness={0.8} metalness={0.1} />
        </mesh>
        <mesh position={[0, -0.42, 0]}>
          <cylinderGeometry args={[0.135, 0.135, 0.04, 14]} />
          <meshStandardMaterial color="#8b7f6c" roughness={0.8} metalness={0.1} />
        </mesh>
      </group>
    </group>
  );
}
