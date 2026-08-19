/**
 * Ritual's mark, from public/ritual-mark.png.
 *
 * The source artwork is black on transparent, which would be invisible on this
 * background, so it is used as a CSS mask and filled with `currentColor` instead of
 * being drawn as an image. That keeps the original alpha — and therefore the antialiased
 * edges of the knot — while letting the mark take the colour of whatever it sits in.
 * Inverting it with a filter would have worked too, but it degrades those edges.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={`logo ${className ?? ""}`.trim()}
      role="img"
      aria-label="Ritual Predict"
    />
  );
}
