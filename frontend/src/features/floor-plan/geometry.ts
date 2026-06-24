import { TableShape } from '../../types';

/** Round a value to the nearest grid line. gridSize<=0 disables snapping. */
export const snap = (value: number, gridSize: number): number =>
  gridSize > 0 ? Math.round(value / gridSize) * gridSize : value;

export const snapPoint = (
  p: { x: number; y: number },
  gridSize: number,
): { x: number; y: number } => ({ x: snap(p.x, gridSize), y: snap(p.y, gridSize) });

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Keep a placed item's top-left inside the canvas bounds. */
export const clampToCanvas = (
  x: number,
  y: number,
  w: number,
  h: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } => ({
  x: clamp(x, 0, Math.max(0, canvasWidth - w)),
  y: clamp(y, 0, Math.max(0, canvasHeight - h)),
});

/**
 * Seat marker positions (local coords relative to the table's top-left box of
 * size w×h) for a table of the given shape + capacity. Used to draw the little
 * seat dots around a table so the floor plan reads like a real seating chart.
 *
 * ROUND: evenly spaced on a circle just outside the table.
 * SQUARE/RECT: distributed across the four edges proportional to edge length,
 * so a long rectangle gets more seats on its long sides.
 */
export function computeSeatPositions(
  shape: TableShape,
  w: number,
  h: number,
  capacity: number,
): { x: number; y: number }[] {
  const n = Math.max(0, Math.floor(capacity));
  if (n === 0) return [];

  const cx = w / 2;
  const cy = h / 2;
  const gap = 10; // distance of the seat dot beyond the table edge

  if (shape === TableShape.ROUND) {
    const r = Math.max(w, h) / 2 + gap;
    return Array.from({ length: n }, (_, i) => {
      // start at the top (-90°) and go clockwise
      const angle = (-Math.PI / 2) + (i * 2 * Math.PI) / n;
      return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    });
  }

  // Rectangular: split seats across edges proportional to their length.
  const perimeterTop = w;
  const perimeterBottom = w;
  const perimeterLeft = h;
  const perimeterRight = h;
  const total = perimeterTop + perimeterBottom + perimeterLeft + perimeterRight;

  // Largest-remainder apportionment so the counts sum exactly to n.
  const rawShares = [
    (n * perimeterTop) / total,
    (n * perimeterRight) / total,
    (n * perimeterBottom) / total,
    (n * perimeterLeft) / total,
  ];
  const floors = rawShares.map((s) => Math.floor(s));
  let remaining = n - floors.reduce((a, b) => a + b, 0);
  const order = rawShares
    .map((s, i) => ({ i, frac: s - Math.floor(s) }))
    .sort((a, b) => b.frac - a.frac);
  const counts = [...floors];
  for (const { i } of order) {
    if (remaining <= 0) break;
    counts[i] += 1;
    remaining -= 1;
  }

  const [top, right, bottom, left] = counts;
  const out: { x: number; y: number }[] = [];
  // top edge (left→right)
  for (let i = 0; i < top; i++) {
    out.push({ x: ((i + 1) * w) / (top + 1), y: -gap });
  }
  // right edge (top→bottom)
  for (let i = 0; i < right; i++) {
    out.push({ x: w + gap, y: ((i + 1) * h) / (right + 1) });
  }
  // bottom edge (right→left)
  for (let i = 0; i < bottom; i++) {
    out.push({ x: w - ((i + 1) * w) / (bottom + 1), y: h + gap });
  }
  // left edge (bottom→top)
  for (let i = 0; i < left; i++) {
    out.push({ x: -gap, y: h - ((i + 1) * h) / (left + 1) });
  }
  return out;
}
