/** A small vacuum-truck glyph for arrival marks. Inherits `currentColor`. */
export function TruckGlyph({ size = 14, className, title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg width={size} height={size * 0.64} viewBox="0 0 28 18" className={className} aria-hidden={!title} role={title ? "img" : undefined}>
      {title && <title>{title}</title>}
      {/* tank body */}
      <rect x="1" y="3" width="17" height="9" rx="4.5" fill="currentColor" />
      {/* cab */}
      <path d="M18 5h5.2l3.3 4v3H18z" fill="currentColor" opacity="0.85" />
      {/* window */}
      <path d="M19.5 6.2h3.2l2.1 2.6h-5.3z" fill="var(--surface-0)" opacity="0.9" />
      {/* wheels */}
      <circle cx="6" cy="14" r="2.6" fill="var(--surface-0)" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="13" cy="14" r="2.6" fill="var(--surface-0)" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="22.5" cy="14" r="2.6" fill="var(--surface-0)" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
