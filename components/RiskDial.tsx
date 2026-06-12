// A semicircular risk gauge (0–100). Calm green on the left, gold in the middle,
// reckless red on the right; a dot marks the pundit's current appetite.
export function RiskDial({ value, color, size = 168 }: { value: number; color?: string; size?: number }) {
  const v = Math.max(0, Math.min(100, value));
  const cx = 80;
  const cy = 80;
  const r = 62;
  const pt = (deg: number) => ({
    x: cx + r * Math.cos((deg * Math.PI) / 180),
    y: cy - r * Math.sin((deg * Math.PI) / 180),
  });
  const left = pt(180);
  const right = pt(0);
  const end = pt(180 - 1.8 * v);
  const track = `M${left.x},${left.y} A${r},${r} 0 0 1 ${right.x},${right.y}`;
  const fill = `M${left.x},${left.y} A${r},${r} 0 0 1 ${end.x},${end.y}`;
  const label = v < 35 ? "Disciplined" : v < 55 ? "Measured" : v < 72 ? "Aggressive" : "Reckless";

  return (
    <svg viewBox="0 0 160 100" width={size} height={size * 0.625} role="img" aria-label={`Risk ${v} of 100`}>
      <defs>
        <linearGradient id="riskGrad" x1="0" y1="0" x2="160" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--color-up)" />
          <stop offset="55%" stopColor="var(--color-accent)" />
          <stop offset="100%" stopColor="var(--color-down)" />
        </linearGradient>
      </defs>
      <path d={track} fill="none" stroke="var(--color-line)" strokeWidth={9} strokeLinecap="round" />
      <path d={fill} fill="none" stroke="url(#riskGrad)" strokeWidth={9} strokeLinecap="round" />
      <circle cx={end.x} cy={end.y} r={5.5} fill={color ?? "var(--color-foreground)"} stroke="var(--color-background)" strokeWidth={2} />
      <text x={cx} y={68} textAnchor="middle" fontSize={24} fontFamily="var(--font-mono), monospace" className="fill-foreground tabular-nums">
        {v}
      </text>
      <text x={cx} y={86} textAnchor="middle" fontSize={8.5} letterSpacing={2.4} fontFamily="var(--font-mono), monospace" className="fill-faint">
        {label.toUpperCase()}
      </text>
    </svg>
  );
}
