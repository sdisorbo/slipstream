// Closed-loop track: a polyline centerline with a constant width.
// Travel direction is the order of the points; positive lateral offset is to the LEFT.
export interface Track {
  name: string;
  n: number;
  px: number[];
  py: number[];
  cum: number[]; // arc length at point i
  length: number;
  halfWidth: number;
  wallOffset: number; // distance from centerline to the wall
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function makeTrack(name: string, pts: [number, number][], width: number, wallGap = 12): Track {
  const n = pts.length;
  const px = pts.map((p) => r3(p[0]));
  const py = pts.map((p) => r3(p[1]));
  const cum = [0];
  for (let i = 1; i <= n; i++) {
    const a = i - 1;
    const b = i % n;
    cum.push(cum[i - 1] + Math.hypot(px[b] - px[a], py[b] - py[a]));
  }
  return { name, n, px, py, cum, length: cum[n], halfWidth: width / 2, wallOffset: width / 2 + wallGap };
}

// Stadium oval. Start/finish is in the middle of the bottom straight, heading +x, turning left.
export function ovalTrack(straight = 650, radius = 110, width = 18): Track {
  const arc = Math.PI * radius;
  const L = 2 * straight + 2 * arc;
  const N = Math.round(L / 8);
  const pts: [number, number][] = [];
  const hs = straight / 2;
  for (let i = 0; i < N; i++) {
    let s = (i * L) / N;
    let x: number;
    let y: number;
    if (s < hs) {
      x = s;
      y = -radius;
    } else if ((s -= hs) < arc) {
      const a = -Math.PI / 2 + s / radius;
      x = hs + radius * Math.cos(a);
      y = radius * Math.sin(a);
    } else if ((s -= arc) < straight) {
      x = hs - s;
      y = radius;
    } else if ((s -= straight) < arc) {
      const a = Math.PI / 2 + s / radius;
      x = -hs + radius * Math.cos(a);
      y = radius * Math.sin(a);
    } else {
      s -= arc;
      x = -hs + s;
      y = -radius;
    }
    pts.push([x, y]);
  }
  return makeTrack("Practice oval", pts, width);
}

export function pointAt(t: Track, s: number) {
  s = ((s % t.length) + t.length) % t.length;
  let lo = 0;
  let hi = t.n;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (t.cum[m] <= s) lo = m;
    else hi = m;
  }
  const b = (lo + 1) % t.n;
  const f = (s - t.cum[lo]) / (t.cum[lo + 1] - t.cum[lo]);
  const dx = t.px[b] - t.px[lo];
  const dy = t.py[b] - t.py[lo];
  const l = Math.sqrt(dx * dx + dy * dy);
  return { x: t.px[lo] + dx * f, y: t.py[lo] + dy * f, tx: dx / l, ty: dy / l };
}

export interface Loc {
  seg: number;
  s: number; // arc length along the centerline
  d: number; // signed lateral offset (left positive)
  tx: number;
  ty: number;
}

function proj(t: Track, i: number, x: number, y: number): { dist: number; f: number } {
  const b = (i + 1) % t.n;
  const ax = t.px[i];
  const ay = t.py[i];
  const dx = t.px[b] - ax;
  const dy = t.py[b] - ay;
  const l2 = dx * dx + dy * dy;
  let f = ((x - ax) * dx + (y - ay) * dy) / l2;
  f = f < 0 ? 0 : f > 1 ? 1 : f;
  const qx = ax + dx * f - x;
  const qy = ay + dy * f - y;
  return { dist: qx * qx + qy * qy, f };
}

export function locate(t: Track, x: number, y: number, hint: number): Loc {
  let best = -1;
  let bd = Infinity;
  let bf = 0;
  const scan = (i: number) => {
    const p = proj(t, i, x, y);
    if (p.dist < bd) {
      bd = p.dist;
      best = i;
      bf = p.f;
    }
  };
  for (let k = -6; k <= 12; k++) scan((((hint + k) % t.n) + t.n) % t.n);
  if (bd > 50 * 50) {
    best = -1;
    bd = Infinity;
    for (let i = 0; i < t.n; i++) scan(i);
  }
  const b = (best + 1) % t.n;
  const dx = t.px[b] - t.px[best];
  const dy = t.py[b] - t.py[best];
  const l = Math.sqrt(dx * dx + dy * dy);
  const tx = dx / l;
  const ty = dy / l;
  const qx = t.px[best] + dx * bf;
  const qy = t.py[best] + dy * bf;
  const d = tx * (y - qy) - ty * (x - qx);
  return { seg: best, s: t.cum[best] + l * bf, d, tx, ty };
}
