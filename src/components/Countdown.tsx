/** Time-to-shutdown ring: the arc is the share of the repair horizon still left before the tank trips. */
export function CountdownRing({
  hours,
  horizonHours,
  size = 40,
  children,
  caption,
}: {
  hours: number;
  horizonHours: number;
  size?: number;
  children?: React.ReactNode;
  /** Tiny word under the value, e.g. "tank", so the number is never a bare percentage. */
  caption?: string;
}) {
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, horizonHours > 0 ? hours / horizonHours : 0));
  const urgent = hours < 1;
  const color = urgent ? "var(--shutdown)" : "var(--cat-failure-mark)";
  return (
    <span className="relative inline-grid place-items-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`}
          style={{ transition: "stroke-dasharray 300ms ease-out" }}
        />
        {urgent && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={1} className="ring-pulse" />}
      </svg>
      <span className="relative grid place-items-center leading-none">
        <span className="num text-[11px] text-ink-1">{children}</span>
        {caption && <span className="text-[9px] uppercase tracking-wide text-ink-3 mt-px">{caption}</span>}
      </span>
    </span>
  );
}
