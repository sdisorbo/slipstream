// A Curve is a list of control points (x in 0..1, y in meters or chord-fractions).
// Interpolation is monotone-cubic (Fritsch–Carlson): smooth, never overshoots the points you drew.
export type Pt = { x: number; y: number };
export type Curve = Pt[];
export type Envelope = { upper: Curve; lower: Curve };

export function sortCurve(c: Curve): Curve {
  return [...c].sort((a, b) => a.x - b.x);
}

export function evalCurve(c: Curve, x: number): number {
  const n = c.length;
  if (n === 0) return 0;
  if (n === 1) return c[0].y;
  if (x <= c[0].x) return c[0].y;
  if (x >= c[n - 1].x) return c[n - 1].y;
  // tangents
  const d: number[] = [];
  const m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((c[i + 1].y - c[i].y) / Math.max(1e-9, c[i + 1].x - c[i].x));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const a = m[i] / d[i];
      const b = m[i + 1] / d[i];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        m[i] = t * a * d[i];
        m[i + 1] = t * b * d[i];
      }
    }
  }
  let i = 0;
  while (i < n - 2 && x > c[i + 1].x) i++;
  const h = c[i + 1].x - c[i].x;
  const t = (x - c[i].x) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * c[i].y +
    (t3 - 2 * t2 + t) * h * m[i] +
    (-2 * t3 + 3 * t2) * c[i + 1].y +
    (t3 - t2) * h * m[i + 1]
  );
}

export function sampleCurve(c: Curve, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(evalCurve(c, i / (n - 1)));
  return out;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keep upper >= lower + minThk everywhere, and everything inside [yMin,yMax]. */
export function sanitizeEnvelope(e: Envelope, yMin: number, yMax: number, minThk: number): Envelope {
  let upper = sortCurve(e.upper).map((p) => ({ x: p.x, y: clamp(p.y, yMin + minThk, yMax) }));
  let lower = sortCurve(e.lower).map((p) => ({ x: p.x, y: clamp(p.y, yMin, yMax - minThk) }));
  upper = upper.map((p) => ({ x: p.x, y: Math.max(p.y, evalCurve(lower, p.x) + minThk) }));
  lower = lower.map((p) => ({ x: p.x, y: Math.min(p.y, evalCurve(upper, p.x) - minThk) }));
  return { upper, lower };
}
