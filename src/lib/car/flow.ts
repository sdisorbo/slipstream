// Visual flow field around the car, built from classical potential-flow pieces so it responds live to every edit:
//  - slender-body point sources along the body (S'(x) distribution) for displacement,
//  - dipoles for the four wheels,
//  - horseshoe vortices (Kutta-Joukowski circulation from the wing's downforce) for wing wake / tip vortices,
//  - mirror images in the ground plane for all of the above.
// Freestream is unit speed toward -X (the car drives toward +X).
import type { CarDesign } from "./types";
import {
  bodyStations,
  frontAxleX,
  frontWingEls,
  frontWingLEX,
  rearWingEls,
  wheels,
  floorGap,
  floorX,
} from "./shape";
import type { ModeResult } from "./aero";

interface Src { x: number; z: number; q: number; e2: number }
interface Dip { x: number; y: number; z: number; R3: number; e2: number }
interface Seg { ax: number; ay: number; az: number; bx: number; by: number; bz: number; g: number }

export interface FlowField {
  vel(x: number, y: number, z: number, out: [number, number, number]): void;
  push(p: [number, number, number]): void;
  traces: { pos: Float32Array; speed: Float32Array }[];
  speedAt(x: number, y: number, z: number): number;
}

export function buildFlow(d: CarDesign, mode: ModeResult, straight: boolean): FlowField {
  const st = bodyStations(d, 48);
  const srcs: Src[] = [];
  // sources go along the body from nose to tail; flow direction is -X, so area grows downstream
  const push = (x: number, zc: number, q: number, req: number) => {
    const e = 0.5 * req + 0.03;
    const qq = q * 2.4; // visual amplification: smoothed point sources under-predict surface speeds
    srcs.push({ x, z: zc, q: qq, e2: e * e });
    srcs.push({ x, z: -zc, q: qq, e2: e * e }); // ground image
  };
  push(st[0].X, st[0].zc, st[0].S, st[0].req);
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i];
    const b = st[i + 1];
    push((a.X + b.X) / 2, (a.zc + b.zc) / 2, b.S - a.S, (a.req + b.req) / 2);
  }
  const last = st[st.length - 1];
  push(last.X, last.zc, -last.S, last.req);

  const dips: Dip[] = [];
  for (const w of wheels(d)) {
    const R = Math.sqrt(w.r * w.width) * 0.9;
    const e = 0.4 * R;
    dips.push({ x: w.x, y: w.y, z: w.r, R3: R * R * R, e2: e * e });
    dips.push({ x: w.x, y: w.y, z: -w.r, R3: R * R * R, e2: e * e });
  }

  const segs: Seg[] = [];
  const addHorseshoe = (xq: number, z: number, span: number, ClA: number) => {
    const G = (0.5 * ClA) / span;
    const far = xq - 16;
    const h = span / 2;
    const add = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
      segs.push({ ax, ay, az, bx, by, bz, g: G });
      segs.push({ ax, ay, az: -az, bx, by, bz: -bz, g: -G }); // image vortex, opposite sense
    };
    add(far, -h, z, xq, -h, z);
    add(xq, -h, z, xq, h, z);
    add(xq, h, z, far, h, z);
  };
  const fwEl = frontWingEls(d, straight ? 0.55 : 1)[0];
  addHorseshoe(fwEl.LE[0] - 0.25 * fwEl.chord, fwEl.LE[1] + 0.02, d.frontWing.span, mode.frontWing.ClA);
  const rwEl = rearWingEls(d, straight ? 0.2 : 1)[0];
  addHorseshoe(rwEl.LE[0] - 0.25 * rwEl.chord, rwEl.LE[1] + 0.05, d.rearWing.span, mode.rearWing.ClA);

  const RC2 = 0.06 * 0.06;
  const vel = (x: number, y: number, z: number, out: [number, number, number]) => {
    let vx = -1;
    let vy = 0;
    let vz = 0;
    for (let i = 0; i < srcs.length; i++) {
      const s = srcs[i];
      const rx = x - s.x;
      const rz = z - s.z;
      const r2 = rx * rx + y * y + rz * rz + s.e2;
      const k = s.q / (4 * Math.PI * r2 * Math.sqrt(r2));
      vx += k * rx;
      vy += k * y;
      vz += k * rz;
    }
    for (let i = 0; i < dips.length; i++) {
      const s = dips[i];
      const rx = x - s.x;
      const ry = y - s.y;
      const rz = z - s.z;
      const r2 = rx * rx + ry * ry + rz * rz + s.e2;
      const r = Math.sqrt(r2);
      // sphere in uniform flow along d = (-1,0,0): v' = -(R^3/(2 r^3)) (3 (d.rhat) rhat - d)
      const dr = -rx / r;
      const c = -s.R3 / (2 * r2 * r);
      vx += c * (3 * dr * (rx / r) + 1);
      vy += c * (3 * dr * (ry / r));
      vz += c * (3 * dr * (rz / r));
    }
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const r1x = x - s.ax, r1y = y - s.ay, r1z = z - s.az;
      const r2x = x - s.bx, r2y = y - s.by, r2z = z - s.bz;
      const cx = r1y * r2z - r1z * r2y;
      const cy = r1z * r2x - r1x * r2z;
      const cz = r1x * r2y - r1y * r2x;
      const c2 = cx * cx + cy * cy + cz * cz;
      const l1 = Math.sqrt(r1x * r1x + r1y * r1y + r1z * r1z) + 1e-9;
      const l2 = Math.sqrt(r2x * r2x + r2y * r2y + r2z * r2z) + 1e-9;
      const dx = s.bx - s.ax, dy = s.by - s.ay, dz = s.bz - s.az;
      const len2 = dx * dx + dy * dy + dz * dz;
      const dot = dx * (r1x / l1 - r2x / l2) + dy * (r1y / l1 - r2y / l2) + dz * (r1z / l1 - r2z / l2);
      const k = (s.g / (4 * Math.PI)) * (dot / (c2 + RC2 * len2));
      vx += k * cx;
      vy += k * cy;
      vz += k * cz;
    }
    out[0] = vx;
    out[1] = vy;
    out[2] = vz;
  };

  const Lb = d.body.length;
  const wl = wheels(d);
  const sq = d.body.squareness;
  const pushOut = (p: [number, number, number]) => {
    // body
    const u = 1 - p[0] / Lb;
    if (u > 0 && u < 1) {
      const idx = Math.min(st.length - 2, Math.max(0, Math.floor(u * (st.length - 1))));
      // find station by u (cosine spaced): linear search
      let j = 0;
      while (j < st.length - 2 && st[j + 1].u < u) j++;
      const a = st[j];
      const b = st[j + 1];
      const t = (u - a.u) / Math.max(1e-6, b.u - a.u);
      const w = a.w + (b.w - a.w) * t;
      const hh = a.halfH + (b.halfH - a.halfH) * t;
      const zc = a.zc + (b.zc - a.zc) * t;
      void idx;
      const ey = Math.abs(p[1]) / w;
      const ez = Math.abs(p[2] - zc) / hh;
      const m = Math.pow(Math.pow(ey, sq) + Math.pow(ez, sq), 1 / sq);
      if (m < 1.04) {
        const f = 1.06 / Math.max(m, 0.05);
        p[1] = p[1] * f;
        p[2] = zc + (p[2] - zc) * f;
        if (Math.abs(p[1]) < 1e-4 && Math.abs(p[2] - zc) < 1e-4) p[2] = zc + hh * 1.06;
      }
    }
    // wheels (cylinder with axis along Y)
    for (const w of wl) {
      const dx = p[0] - w.x;
      const dz = p[2] - w.r;
      if (Math.abs(p[1] - w.y) < w.width / 2 + 0.01) {
        const r = Math.hypot(dx, dz);
        if (r < w.r * 1.03) {
          const f = (w.r * 1.05) / Math.max(r, 0.02);
          p[0] = w.x + dx * f;
          p[2] = w.r + dz * f;
        }
      }
    }
    // floor plank
    const f = 1 - (p[0] - 0.1) / d.floor.length;
    if (f > 0 && f < 1 && Math.abs(p[1]) < d.floor.width / 2) {
      const g = floorGap(d, f);
      if (p[2] > g - 0.01 && p[2] < g + 0.04) p[2] = p[2] > g + 0.015 ? g + 0.045 : g - 0.012;
    }
    if (p[2] < 0.012) p[2] = 0.012;
  };

  // streamlines
  const traces: FlowField["traces"] = [];
  const x0 = frontWingLEX(d) + 1.4;
  const ys: number[] = [];
  for (let i = -9; i <= 9; i++) ys.push(i * 0.12 + (i === 0 ? 0.015 : 0));
  const zs = [0.03, 0.08, 0.16, 0.3, 0.5, 0.72, 0.95, 1.25];
  const STEPS = 170;
  const ds = 0.085;
  const tmp: [number, number, number] = [0, 0, 0];
  const p: [number, number, number] = [0, 0, 0];
  for (const y of ys) {
    for (const z of zs) {
      const pos = new Float32Array(STEPS * 3);
      const sp = new Float32Array(STEPS);
      p[0] = x0;
      p[1] = y;
      p[2] = z;
      let n = 0;
      for (; n < STEPS; n++) {
        vel(p[0], p[1], p[2], tmp);
        const v = Math.hypot(tmp[0], tmp[1], tmp[2]);
        pos[n * 3] = p[0];
        pos[n * 3 + 1] = p[1];
        pos[n * 3 + 2] = p[2];
        sp[n] = v;
        // midpoint step
        const mx = p[0] + (0.5 * ds * tmp[0]) / v;
        const my = p[1] + (0.5 * ds * tmp[1]) / v;
        const mz = p[2] + (0.5 * ds * tmp[2]) / v;
        vel(mx, my, mz, tmp);
        const v2 = Math.hypot(tmp[0], tmp[1], tmp[2]);
        p[0] += (ds * tmp[0]) / v2;
        p[1] += (ds * tmp[1]) / v2;
        p[2] += (ds * tmp[2]) / v2;
        pushOut(p);
        if (p[0] < -3.5) {
          n++;
          break;
        }
      }
      // pad remaining with the last point
      for (let k = n; k < STEPS; k++) {
        pos[k * 3] = pos[(n - 1) * 3];
        pos[k * 3 + 1] = pos[(n - 1) * 3 + 1];
        pos[k * 3 + 2] = pos[(n - 1) * 3 + 2];
        sp[k] = sp[n - 1];
      }
      traces.push({ pos, speed: sp });
    }
  }

  void floorX;
  void frontAxleX;
  return {
    vel,
    push: pushOut,
    traces,
    speedAt: (x, y, z) => {
      vel(x, y, z, tmp);
      return Math.hypot(tmp[0], tmp[1], tmp[2]);
    },
  };
}

/** blue(slow) -> cyan -> green(freestream) -> yellow -> red(fast) */
export function speedColor(v: number, out: [number, number, number]) {
  const t = Math.min(1, Math.max(0, (v - 0.72) / 0.62));
  const stops: [number, number, number][] = [
    [0.1, 0.25, 0.95],
    [0.1, 0.8, 0.95],
    [0.2, 0.9, 0.3],
    [0.98, 0.9, 0.15],
    [0.95, 0.15, 0.1],
  ];
  const f = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(f));
  const k = f - i;
  for (let c = 0; c < 3; c++) out[c] = stops[i][c] * (1 - k) + stops[i + 1][c] * k;
}

/** pressure coefficient colors: blue = suction, green = ambient, red = stagnation */
export function cpColor(cp: number, out: [number, number, number]) {
  const t = Math.min(1, Math.max(0, (cp + 1.0) / 1.6));
  speedColor(0.72 + t * 0.62, out);
}
