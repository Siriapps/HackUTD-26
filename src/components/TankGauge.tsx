/** Vertical tank strip: fill to level, warning/shutdown ticks on the right, pump start/stop setpoints on the left. */
export function TankGauge({
  level,
  warning,
  shutdown,
  start,
  stop,
  tone = "healthy",
  height = 150,
}: {
  level: number;
  warning: number;
  shutdown: number;
  start: number;
  stop: number;
  tone?: "healthy" | "failure" | "shutdown";
  height?: number;
}) {
  const w = 34;
  const x = 46;
  const top = 8;
  const h = height - 16;
  const y = (pct: number) => top + h - (Math.max(0, Math.min(100, pct)) / 100) * h;
  const fill = tone === "shutdown" ? "var(--shutdown)" : tone === "failure" ? "var(--cat-failure-mark)" : "var(--ok-mark)";
  const ok = Number.isFinite(level);
  return (
    <svg width={190} height={height} viewBox={`0 0 190 ${height}`} role="img" aria-label={`Tank level ${ok ? level.toFixed(1) : "unknown"} percent`}>
      <rect x={x} y={top} width={w} height={h} rx={3} fill="var(--surface-3)" stroke="var(--line-2)" />
      {ok && <rect x={x} y={y(level)} width={w} height={top + h - y(level)} rx={2} fill={fill} opacity={0.9} />}
      {/* limits */}
      {[
        { v: shutdown, label: `shutdown ${shutdown}%`, color: "var(--shutdown)" },
        { v: warning, label: `warning ${warning}%`, color: "var(--warn)" },
      ].map((l) => (
        <g key={l.label}>
          <line x1={x - 2} x2={x + w + 6} y1={y(l.v)} y2={y(l.v)} stroke={l.color} strokeWidth={1} />
          <text x={x + w + 9} y={y(l.v) + 3.5} fontSize={10} fill={l.color} className="num">
            {l.label}
          </text>
        </g>
      ))}
      {/* pump setpoints */}
      {[
        { v: start, label: `start ${start}` },
        { v: stop, label: `stop ${stop}` },
      ].map((s) => (
        <g key={s.label}>
          <line x1={x - 8} x2={x} y1={y(s.v)} y2={y(s.v)} stroke="var(--text-3)" strokeWidth={1} />
          <text x={x - 10} y={y(s.v) + 3.5} fontSize={9} fill="var(--text-3)" textAnchor="end" className="num">
            {s.label}
          </text>
        </g>
      ))}
      {ok && (
        <text x={x + w / 2} y={top + h + 2} fontSize={0} fill="transparent">
          {level}
        </text>
      )}
    </svg>
  );
}
