/**
 * A geometric mark in the spirit of the endless knot Ritual uses — an interlaced
 * lattice on a 45° diamond, drawn from square-capped strokes.
 *
 * Deliberately an interpretation rather than a copy of their brand asset: this is a
 * workshop fork, and shipping someone else's logo verbatim is not mine to do.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="Ritual Predict"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g
        transform="rotate(45 50 50)"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="square"
      >
        {/* outer frame, broken at the four midpoints so the weave can pass through */}
        <path d="M22 34 V22 H34" />
        <path d="M66 22 H78 V34" />
        <path d="M78 66 V78 H66" />
        <path d="M34 78 H22 V66" />

        {/* the four interlocking hooks that read as the crossings */}
        <path d="M22 46 H46 V22" />
        <path d="M54 22 V46 H78" />
        <path d="M78 54 H54 V78" />
        <path d="M46 78 V54 H22" />

        {/* centre square, the knot's core */}
        <path d="M38 38 H62 V62 H38 Z" />
      </g>
    </svg>
  );
}
