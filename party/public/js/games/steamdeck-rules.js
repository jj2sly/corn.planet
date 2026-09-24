// Escape Thad's Steam Deck: how a drawn stroke becomes a plank. Shared by the server (which places the
// plank) and phones (which preview it while you draw), so the preview is exactly what you get.

/**
 * A flat plank across the stroke's width, at its average height, in world units. Null when the stroke
 * is too short sideways to be a plank.
 */
export function plankFromStroke(stroke, { width, height, minLength, maxLength }) {
  if (stroke.points.length < 2) return null;
  let minX = 1, maxX = 0, sumY = 0;
  for (const [x, y] of stroke.points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    sumY += y;
  }
  const x1 = minX * width;
  const x2 = maxX * width;
  if (x2 - x1 < minLength / 2) return null;
  const y = (sumY / stroke.points.length) * height;
  const length = Math.min(maxLength, Math.max(minLength, x2 - x1));
  const left = Math.max(0, Math.min(width - length, (x1 + x2) / 2 - length / 2));
  return { x1: Math.round(left), x2: Math.round(left + length), y: Math.round(Math.max(60, Math.min(height - 40, y))) };
}
