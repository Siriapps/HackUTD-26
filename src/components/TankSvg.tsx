import { eventActiveAt } from "./Twin3D/derive";
import { CATEGORY_LABEL, type Twin3DProps } from "./Twin3D/types";

/** 2D fallback for the twin (no WebGL): tank fill, limit lines, pump state, pipeline and leak. Same props. */
export function TankSvg({ facility, readings, limits, event, t }: Twin3DProps) {
  const level = Math.min(100, Math.max(0, readings.level_pct));
  const active = event && eventActiveAt(event, t) ? event.category : null;
  const top = 24;
  const bottom = 156;
  const y = (pct: number) => bottom - ((bottom - top) * pct) / 100;
  const fill = level >= limits.shutdown ? "var(--shutdown)" : level >= limits.warning ? "var(--warn)" : "var(--accent)";
  const fault = readings.pump_status === 2 || active === "pump_failure";
  const pumpColor = fault
    ? "var(--cat-failure)"
    : active === "pump_degradation"
      ? "var(--cat-degradation)"
      : readings.pump_status === 1
        ? "var(--ok)"
        : "var(--text-3)";
  const flowing = readings.receive_flow_bpd > 0;
  const label = `${facility.id}: tank ${level.toFixed(1)} percent, pump ${fault ? "fault" : readings.pump_status === 1 ? "running" : "off"}${
    active ? `, ${CATEGORY_LABEL[active]}` : ""
  }`;
  return (
    <svg viewBox="0 0 320 180" role="img" aria-label={label} className="absolute inset-0 h-full w-full font-mono text-[9px]">
      <rect x="0" y="0" width="320" height="180" fill="var(--surface-0)" />
      {/* Tank */}
      <rect x="40" y={y(level)} width="80" height={bottom - y(level)} fill={fill} opacity="0.8" />
      <rect x="40" y={top} width="80" height={bottom - top} fill="none" stroke="var(--text-3)" strokeWidth="1.5" rx="4" />
      <line x1="36" x2="124" y1={y(limits.warning)} y2={y(limits.warning)} stroke="var(--warn)" strokeDasharray="3 3" />
      <text x="128" y={y(limits.warning) + 3} fill="var(--warn)">
        {limits.warning}
      </text>
      <line x1="36" x2="124" y1={y(limits.shutdown)} y2={y(limits.shutdown)} stroke="var(--shutdown)" strokeWidth="1.5" />
      <text x="128" y={y(limits.shutdown) + 3} fill="var(--shutdown)">
        {limits.shutdown}
      </text>
      <text x="80" y={Math.min(bottom - 6, Math.max(top + 14, y(level) - 6))} textAnchor="middle" fill="var(--text-1)" fontSize="12">
        {level.toFixed(1)}%
      </text>
      {/* Pump */}
      <rect x="150" y="136" width="26" height="20" rx="3" fill={pumpColor} opacity={fault ? 1 : 0.9}>
        {fault && <animate attributeName="opacity" values="1;0.35;1" dur="1.2s" repeatCount="indefinite" />}
      </rect>
      <line x1="120" x2="150" y1="150" y2="150" stroke="var(--text-3)" strokeWidth="2" />
      {/* Pipeline to disposal */}
      <line
        x1="176"
        x2="296"
        y1="146"
        y2="146"
        stroke={flowing ? "var(--text-2)" : "var(--text-3)"}
        strokeWidth="3"
        strokeDasharray={flowing ? "6 4" : undefined}
      >
        {flowing && <animate attributeName="stroke-dashoffset" from="20" to="0" dur="1s" repeatCount="indefinite" />}
      </line>
      <circle cx="300" cy="146" r="6" fill="var(--surface-3)" stroke="var(--text-3)" />
      {active === "pipeline_leak" && (
        <g fill="var(--cat-leak)">
          <path d="M232 150 c0 -4 4 -8 4 -12 c0 4 4 8 4 12 a4 4 0 0 1 -8 0z" />
          <ellipse cx="236" cy="166" rx="12" ry="3" opacity="0.5" />
          <text x="236" y="176" textAnchor="middle">
            leak
          </text>
        </g>
      )}
      <text x="40" y="14" fill="var(--text-2)" fontSize="10">
        {facility.id}
      </text>
      <text x="300" y="14" textAnchor="end" fill="var(--text-3)">
        2D view
      </text>
    </svg>
  );
}
