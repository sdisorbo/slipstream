// Pure geometry helpers (no three.js). Physics frame: X forward (nose +X), Y lateral, Z up. Ground is Z = 0.
import { evalCurve } from "./curve";
import type { CarDesign, WingDesign } from "./types";
import { FRONT_WHEEL, REAR_WHEEL, TRACK_WIDTH } from "./rules";

export const REAR_AXLE_X = 0.55;
export const REAR_WING_LE_X = 0.38;

export function gamma(z: number): number {
  // Lanczos approximation
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

/** Area of |y/a|^n + |z/b|^n <= 1 */
export function superArea(a: number, b: number, n: number): number {
  return 4 * a * b * (gamma(1 + 1 / n) ** 2 / gamma(1 + 2 / n));
}

export interface BodyStation {
  u: number;
  X: number;
  zTop: number;
  zBot: number;
  zc: number;
  halfH: number;
  w: number; // half-width
  S: number; // cross-section area
  req: number; // equivalent radius
}

export const bodyX = (d: CarDesign, u: number) => d.body.length * (1 - u);
export const frontAxleX = (d: CarDesign) => REAR_AXLE_X + d.wheelbase;
export const frontWingLEX = (d: CarDesign) => d.body.length + 0.35;

export function bodyStations(d: CarDesign, N = 64): BodyStation[] {
  const out: BodyStation[] = [];
  for (let i = 0; i < N; i++) {
    // cosine spacing: finer at the tips
    const u = 0.5 - 0.5 * Math.cos((Math.PI * i) / (N - 1));
    let zTop = evalCurve(d.body.sideUpper, u);
    const zBot = evalCurve(d.body.sideLower, u);
    if (zTop < zBot + 0.02) zTop = zBot + 0.02;
    const w = Math.max(0.012, evalCurve(d.body.planHalf, u));
    const halfH = (zTop - zBot) / 2;
    const S = superArea(w, halfH, d.body.squareness);
    out.push({ u, X: bodyX(d, u), zTop, zBot, zc: (zTop + zBot) / 2, halfH, w, S, req: Math.sqrt(S / Math.PI) });
  }
  return out;
}

export interface WheelSpec {
  x: number;
  y: number;
  r: number;
  width: number;
  front: boolean;
}
export function wheels(d: CarDesign): WheelSpec[] {
  const Xf = frontAxleX(d);
  return [
    { x: Xf, y: TRACK_WIDTH.front / 2, r: FRONT_WHEEL.dia / 2, width: FRONT_WHEEL.width, front: true },
    { x: Xf, y: -TRACK_WIDTH.front / 2, r: FRONT_WHEEL.dia / 2, width: FRONT_WHEEL.width, front: true },
    { x: REAR_AXLE_X, y: TRACK_WIDTH.rear / 2, r: REAR_WHEEL.dia / 2, width: REAR_WHEEL.width, front: false },
    { x: REAR_AXLE_X, y: -TRACK_WIDTH.rear / 2, r: REAR_WHEEL.dia / 2, width: REAR_WHEEL.width, front: false },
  ];
}

/** Wing element in the X-Z plane. */
export interface WingElement {
  LE: [number, number]; // X, Z
  chord: number;
  pitchDeg: number;
}
export function wingElements(w: WingDesign, LEx: number, LEz: number, pitchScale = 1): WingElement[] {
  const els: WingElement[] = [];
  let LE: [number, number] = [LEx, LEz];
  let chord = w.chord;
  let pitch = w.pitch * pitchScale;
  for (let k = 0; k < w.elements; k++) {
    els.push({ LE, chord, pitchDeg: pitch });
    const b = (pitch * Math.PI) / 180;
    const t: [number, number] = [-Math.cos(b), Math.sin(b)];
    const n: [number, number] = [Math.sin(b), Math.cos(b)];
    const TE: [number, number] = [LE[0] + chord * t[0], LE[1] + chord * t[1]];
    const nc = chord * 0.62;
    LE = [TE[0] - 0.28 * nc * t[0] + 0.07 * nc * n[0] + 0.0, TE[1] - 0.28 * nc * t[1] + 0.07 * nc * n[1]];
    chord = nc;
    pitch = pitch + 14 * pitchScale;
  }
  return els;
}

export function airfoilPoint(w: WingDesign, el: WingElement, s: number, side: "upper" | "lower"): [number, number] {
  const y = evalCurve(side === "upper" ? w.section.upper : w.section.lower, s) * el.chord;
  const b = (el.pitchDeg * Math.PI) / 180;
  const t = [-Math.cos(b), Math.sin(b)];
  const n = [Math.sin(b), Math.cos(b)];
  return [el.LE[0] + s * el.chord * t[0] + y * n[0], el.LE[1] + s * el.chord * t[1] + y * n[1]];
}

export function frontWingEls(d: CarDesign, pitchScale = 1) {
  return wingElements(d.frontWing, frontWingLEX(d), d.frontWing.height, pitchScale);
}
export function rearWingEls(d: CarDesign, pitchScale = 1) {
  return wingElements(d.rearWing, REAR_WING_LE_X, d.rearWing.height, pitchScale);
}

export function floorX(d: CarDesign, f: number) {
  return 0.1 + d.floor.length * (1 - f);
}
export function floorGap(d: CarDesign, f: number) {
  return d.rideHeight + Math.max(0, evalCurve(d.floor.under, f));
}

export function overallLength(d: CarDesign) {
  const rw = rearWingEls(d);
  let minX = 0;
  for (const el of rw) {
    const b = (el.pitchDeg * Math.PI) / 180;
    minX = Math.min(minX, el.LE[0] - el.chord * Math.cos(b));
  }
  return frontWingLEX(d) - Math.min(minX, 0);
}
