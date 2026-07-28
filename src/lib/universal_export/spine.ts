// 15-minute chronological spine + contiguity flags. Pure functions.

export const FIFTEEN_MIN_MS = 15 * 60 * 1000;

/** Snap a timestamp down to its 15-minute boundary. */
export function floorTo15m(ts: number): number {
  return Math.floor(ts / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;
}

/** Ceil a timestamp up to the next 15-minute boundary (>=). */
export function ceilTo15m(ts: number): number {
  const f = floorTo15m(ts);
  return f === ts ? ts : f + FIFTEEN_MIN_MS;
}

/**
 * Return an ascending list of every expected 15-minute boundary ISO string
 * between `startMs` (inclusive, snapped down) and `endMs` (inclusive, snapped down).
 */
export function buildSpine(startMs: number, endMs: number): string[] {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return [];
  const s = floorTo15m(startMs);
  const e = floorTo15m(endMs);
  const out: string[] = [];
  for (let t = s; t <= e; t += FIFTEEN_MIN_MS) out.push(new Date(t).toISOString());
  return out;
}

/**
 * True when the previous `n` boundaries in the spine (inclusive of the
 * current row) are strictly contiguous 15-minute steps — i.e. no gap larger
 * than one boundary anywhere in that window.
 */
export function priorBoundariesContiguous(spine: string[], index: number, n: number): boolean {
  if (n <= 1) return true;
  if (index + 1 < n) return false;
  for (let i = index - n + 2; i <= index; i++) {
    const a = new Date(spine[i - 1]).getTime();
    const b = new Date(spine[i]).getTime();
    if (b - a !== FIFTEEN_MIN_MS) return false;
  }
  return true;
}
