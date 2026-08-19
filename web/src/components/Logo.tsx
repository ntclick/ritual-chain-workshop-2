/**
 * The endless knot.
 *
 * Drawn as two square-wave bands crossing at 90° on a 45° diamond, each stroked twice:
 * a wide casing in the page background first, then the white band on top. That casing
 * is what makes one band appear to pass under the other — the standard way knotwork is
 * rendered in vector, and the reason this reads as woven rather than as a flat grid.
 *
 * To use Ritual's official artwork instead, put the file at `web/public/ritual-logo.svg`
 * and swap the body of this component for:
 *
 *   <img src="/ritual-logo.svg" alt="Ritual Predict" className={...} />
 *
 * Done deliberately as a one-line manual swap rather than an automatic fallback: a CSS
 * mask that fails to load is treated as no mask at all, which paints a solid block over
 * the mark, and an <img> probe would log a 404 on every page load when the file is
 * absent. Neither is worth it for an asset that changes once.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={`logo ${className ?? ""}`.trim()} aria-label="Ritual Predict" role="img">
      <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <g transform="rotate(45 50 50)" fill="none" strokeLinecap="square">
          {/* Band A — vertical square wave */}
          <path
            d="M28 22 V78 M28 22 H50 V78 H72 V22"
            stroke="var(--logo-casing, #05060a)"
            strokeWidth="15"
          />
          <path
            d="M28 22 V78 M28 22 H50 V78 H72 V22"
            stroke="currentColor"
            strokeWidth="8"
          />

          {/* Band B — the same wave turned 90°, drawn after so it passes over */}
          <path
            d="M22 28 H78 M22 28 V50 H78 V72 H22"
            stroke="var(--logo-casing, #05060a)"
            strokeWidth="15"
          />
          <path
            d="M22 28 H78 M22 28 V50 H78 V72 H22"
            stroke="currentColor"
            strokeWidth="8"
          />

          {/* Outer frame closing the weave into one continuous figure */}
          <rect
            x="22"
            y="22"
            width="56"
            height="56"
            stroke="var(--logo-casing, #05060a)"
            strokeWidth="15"
          />
          <rect x="22" y="22" width="56" height="56" stroke="currentColor" strokeWidth="8" />
        </g>

        {/* The small diamonds at the top and bottom points */}
        <rect
          x="44"
          y="2"
          width="12"
          height="12"
          transform="rotate(45 50 8)"
          fill="currentColor"
        />
        <rect
          x="44"
          y="86"
          width="12"
          height="12"
          transform="rotate(45 50 92)"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}
