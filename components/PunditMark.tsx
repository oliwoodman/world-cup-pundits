import { monogramFor } from "@/lib/format";

// A custom brand mark for each pundit: a serif monogram in the pundit's colour,
// on a faint tint with a hairline ring. Premium, original, no emoji.
export function PunditMark({
  name,
  color,
  size = 36,
}: {
  name?: string | null;
  color?: string | null;
  size?: number;
}) {
  const initial = name ? monogramFor(name) : "?";
  const c = color ?? "var(--color-foreground)";
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-[0.4em] font-serif font-semibold leading-none"
      style={{
        width: size,
        height: size,
        color: c,
        background: color ? `${color}14` : "var(--color-surface-2)",
        boxShadow: `inset 0 0 0 1px ${color ? color + "4d" : "var(--color-line)"}`,
        fontSize: size * 0.44,
      }}
    >
      {initial}
    </span>
  );
}
