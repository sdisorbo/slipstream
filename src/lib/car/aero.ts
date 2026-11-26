// Approximate, real-feeling aerodynamics + mass. Not CFD: thin-airfoil wings with finite-span/ground/stall
// corrections, a 1-D venturi underfloor with diffuser separation, and a slender-body drag estimate.
import { evalCurve } from "./curve";
import { MATERIALS } from "./materials";
import { FIXED_MASS, RULES } from "./rules";
import type { CarDesign, WingDesign } from "./types";
import {
  bodyStations,
  floorGap,
  floorX,
  frontAxleX,
  frontWingEls,
  rearWingEls,
  REAR_AXLE_X,
  wheels,
  overallLength,
  type WingElement,
} from "./shape";

export const RHO = 1.2;
const RAD = Math.PI / 180;

export interface PartForce {
  id: string;
  name: string;
  CdA: number;
  ClA: number; // positive = downforce
  X: number; // longitudinal center of pressure
}
export interface WingAero {
  Cl: number; // downforce coefficient (on planform)
  Cd: number;
  area: number;
  span: number;
  stalled: boolean;
  CdA: number;
  ClA: number;
}
export interface ModeResult {
  parts: PartForce[];
  CdA: number;
  ClA: number;
  balanceFront: number; // fraction of downforce on the front axle
  frontWing: WingAero;
  rearWing: WingAero;
  floor: { cp: number[]; kw: number; separated: number; minGap: number };
}

function camberZeroLift(w: WingDesign): { aL0: number; camber: number; thick: number } {
  const N = 80;
  let integ = 0;
  let camber = 0;
  let thick = 0;
  const yc = (x: number) => (evalCurve(w.section.upper, x) + evalCurve(w.section.lower, x)) / 2;
  for (let i = 0; i < N; i++) {
    const th = (Math.PI * (i + 0.5)) / N;
    const x = (1 - Math.cos(th)) / 2;
    const dx = 0.002;
    const x1 = Math.min(1, x + dx);
    const x0 = Math.max(0, x - dx);
    const slope = (yc(x1) - yc(x0)) / (x1 - x0);
    integ += slope * (Math.cos(th) - 1) * (Math.PI / N);
  }
  for (let i = 0; i <= 40; i++) {
    const x = i / 40;
    camber = Math.max(camber, Math.abs(yc(x)));
    thick = Math.max(thick, evalCurve(w.section.upper, x) - evalCurve(w.section.lower, x));
  }
  return { aL0: -integ / Math.PI, camber, thick };
}

export function wingAero(w: WingDesign, pitchScale: number, groundHeight: number | null): WingAero {
  const { aL0, camber, thick } = camberZeroLift(w);
  const beta = w.pitch * pitchScale * RAD;
  const ARe = (w.span / w.chord) * (1 + 1.9 * (w.endplate / w.span));
  const a0 = 2 * Math.PI;
  const a = a0 / (1 + a0 / (Math.PI * ARe * 0.9));
  const slot = [1, 1.38, 1.65][w.elements - 1];
  let Cl = a * (beta + aL0) * slot;
  if (groundHeight !== null) Cl *= 1 + 0.55 / (1 + Math.pow((groundHeight / w.chord) * 2.2, 2));
  const Clmax = (1.05 + 5.5 * camber + 1.2 * thick) * (1 + 0.55 * (w.elements - 1)) * 1.1;
  let stalled = false;
  let over = 0;
  if (Cl > Clmax) {
    over = Cl / Clmax - 1;
    Cl = Clmax * Math.max(0.55, 1 - 0.35 * over);
    stalled = true;
  }
  const chordSum = [1, 1.62, 2.0][w.elements - 1];
  const Cd0 = 2 * 0.0055 * (1 + 2 * thick + 60 * Math.pow(thick, 4)) * chordSum;
  const Cdi = (Cl * Cl) / (Math.PI * ARe * 0.85);
  const Cd = Cd0 + Cdi + (stalled ? 0.35 * Math.min(1, over * 3 + 0.3) : 0);
  const area = w.span * w.chord;
  return { Cl, Cd, area, span: w.span, stalled, CdA: Cd * area, ClA: Cl * area };
}

function elementsCenterX(els: WingElement[]): number {
  return els.reduce((s, e) => s + e.LE[0] - e.chord * 0.5, 0) / els.length;
}

export function floorAero(d: CarDesign) {
  const N = 60;
  const hs: number[] = [];
  for (let i = 0; i < N; i++) hs.push(floorGap(d, i / (N - 1)));
  const hin = hs[0];
  const cp: number[] = [0];
  let minGap = Infinity;
  let sepLen = 0;
  const dX = d.floor.length / (N - 1);
  for (let i = 1; i < N; i++) {
    const ideal = 1 - Math.pow(hin / hs[i], 2);
    const idealPrev = 1 - Math.pow(hin / hs[i - 1], 2);
    const dIdeal = ideal - idealPrev;
    // flow runs from f=0 (front) to f=1 (diffuser exit)
    const dh = hs[i] - hs[i - 1];
    const ang = Math.atan2(dh, dX) / RAD;
    let eps = 1;
    if (dIdeal > 0) {
      eps = Math.min(1, Math.max(0.12, 1 - Math.max(0, ang - 9) / 12));
      if (eps < 1) sepLen += dX;
    }
    let c = cp[i - 1] + (dIdeal > 0 ? eps * dIdeal : dIdeal);
    c = Math.max(c, -2.2); // viscous limit
    cp.push(c);
    minGap = Math.min(minGap, hs[i]);
  }
  // a floor skimming the ground chokes the venturi
  const choke = minGap < 0.02 ? Math.max(0.2, minGap / 0.02) : 1;
  const meanGap = hs.reduce((a, b) => a + b, 0) / N;
  const kw = Math.max(0.35, 1 - (5 * meanGap) / Math.max(0.3, d.floor.width)) * choke;
  let integ = 0;
  let xMoment = 0;
  for (let i = 0; i < N; i++) {
    const s = Math.max(0, -cp[i]) * dX;
    integ += s;
    xMoment += s * floorX(d, i / (N - 1));
  }
  const ClA = 0.5 * d.floor.width * kw * integ; // 0.5: real underfloors recover far less than ideal 1-D flow
  const Xcp = integ > 0 ? xMoment / integ : floorX(d, 0.5);
  const separated = sepLen / d.floor.length;
  const area = d.floor.width * d.floor.length;
  const CdA = 2 * 0.0035 * area + 0.04 * Math.max(0, ClA) * (1 + 6 * separated);
  return { cp, kw, ClA, CdA, Xcp, separated, minGap };
}

export function bodyAero(d: CarDesign) {
  const st = bodyStations(d, 64);
  // frontal area: union of cross-sections, rasterized
  const ny = 56;
  const nz = 70;
  const yMax = 0.6;
  const zMax = 1.05;
  const covered = new Uint8Array(ny * nz);
  for (const s of st) {
    for (let j = 0; j < ny; j++) {
      const y = (j / (ny - 1)) * yMax;
      const ey = Math.pow(y / s.w, d.body.squareness);
      if (ey > 1) continue;
      const zr = s.halfH * Math.pow(1 - ey, 1 / d.body.squareness);
      const z0 = s.zc - zr;
      const z1 = s.zc + zr;
      for (let k = 0; k < nz; k++) {
        const z = (k / (nz - 1)) * zMax;
        if (z >= z0 && z <= z1) covered[j * nz + k] = 1;
      }
    }
  }
  let cells = 0;
  for (let i = 0; i < covered.length; i++) cells += covered[i];
  const Af = 2 * cells * (yMax / (ny - 1)) * (zMax / (nz - 1));
  let wet = 0;
  let plan = 0;
  let maxS = 0;
  const per = (s: (typeof st)[0]) => {
    const A = s.w;
    const B = s.halfH;
    const h = ((A - B) * (A - B)) / ((A + B) * (A + B));
    return Math.PI * (A + B) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h))) * (1 + 0.13 * (d.body.squareness - 2));
  };
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i];
    const b = st[i + 1];
    const dX = Math.abs(a.X - b.X);
    wet += ((per(a) + per(b)) / 2) * dX;
    plan += (a.w + b.w) * dX;
    maxS = Math.max(maxS, a.S);
  }
  const L = d.body.length;
  const deq = 2 * Math.sqrt(maxS / Math.PI);
  const lam = L / deq;
  const FF = 1 + 1.5 / Math.pow(lam, 1.5) + 7 / Math.pow(lam, 3);
  const friction = 0.0035 * wet * FF;
  // rear closure: a steep tail lets the flow separate
  let aft = 0;
  for (let i = 0; i < st.length - 1; i++) {
    if (st[i].u < 0.55) continue;
    const dr = st[i].req - st[i + 1].req;
    const dX = Math.abs(st[i].X - st[i + 1].X) || 1e-6;
    aft = Math.max(aft, dr / dX);
  }
  const tail = st[st.length - 1];
  const sep = 0.55 * Math.max(0, aft - 0.2) * Af + 0.35 * tail.S;
  const nose = 0.02 * Af;
  const CdA = friction + sep + nose;
  const ClA = -0.07 * plan; // a little body lift
  const topHeight = Math.max(...st.map((s) => s.zTop));
  return { CdA, ClA, Af, wet, plan, lam, aft, topHeight, maxHalfWidth: Math.max(...st.map((s) => s.w)), stations: st };
}

export function wheelAero(d: CarDesign) {
  const w = wheels(d);
  const A = w.reduce((s, x) => s + 2 * x.r * x.width, 0);
  return { CdA: 0.4 * A, ClA: -0.1 * A, A };
}

export function evalMode(d: CarDesign, straight: boolean): ModeResult {
  const fw = wingAero(d.frontWing, straight ? 0.55 : 1, d.frontWing.height);
  const rw = wingAero(d.rearWing, straight ? 0.2 : 1, null);
  const fl = floorAero(d);
  const bd = bodyAero(d);
  const wh = wheelAero(d);
  const misc = 0.17; // halo, helmet, suspension, radiators
  const parts: PartForce[] = [
    { id: "fw", name: "Front wing", CdA: fw.CdA, ClA: fw.ClA, X: elementsCenterX(frontWingEls(d)) },
    { id: "rw", name: "Rear wing", CdA: rw.CdA, ClA: rw.ClA, X: elementsCenterX(rearWingEls(d)) },
    { id: "body", name: "Body", CdA: bd.CdA + misc, ClA: bd.ClA, X: d.body.length * 0.5 },
    { id: "floor", name: "Floor & diffuser", CdA: fl.CdA, ClA: fl.ClA, X: fl.Xcp },
    { id: "wheels", name: "Wheels", CdA: wh.CdA, ClA: wh.ClA, X: (REAR_AXLE_X + frontAxleX(d)) / 2 },
  ];
  const CdA = parts.reduce((s, p) => s + p.CdA, 0);
  const ClA = parts.reduce((s, p) => s + p.ClA, 0);
  const wb = frontAxleX(d) - REAR_AXLE_X;
  const mom = parts.reduce((s, p) => s + p.ClA * (p.X - REAR_AXLE_X), 0);
  const balanceFront = ClA > 0.05 ? Math.min(1, Math.max(0, mom / (ClA * wb))) : 0.5;
  return { parts, CdA, ClA, balanceFront, frontWing: fw, rearWing: rw, floor: { cp: fl.cp, kw: fl.kw, separated: fl.separated, minGap: fl.minGap } };
}

// ---------------- mass ----------------
export interface MassBreakdown {
  body: number;
  frontWing: number;
  rearWing: number;
  floor: number;
  fixed: number;
  ballast: number;
  total: number;
  raw: number;
  cost: number;
}

function wingMass(w: WingDesign) {
  const m = MATERIALS[w.material];
  const chordSum = [1, 1.62, 2.0][w.elements - 1];
  const shell = 2.1 * w.chord * chordSum * w.span;
  const ep = 2 * w.endplate * w.chord * chordSum * 0.9;
  const kg = (shell * 0.0022 + ep * 0.003) * m.thicknessMul * m.density * 1.15;
  return { kg, cost: kg * m.costPerKg + w.elements * 4000 };
}

export function massOf(d: CarDesign): MassBreakdown {
  const bd = bodyAero(d);
  const bm = MATERIALS[d.body.material];
  const bodyKg = bd.wet * 0.0032 * bm.thicknessMul * bm.density * 1.8;
  const fw = wingMass(d.frontWing);
  const rw = wingMass(d.rearWing);
  const fm = MATERIALS[d.floor.material];
  const floorKg = d.floor.length * d.floor.width * 0.006 * fm.thicknessMul * fm.density * 1.5;
  const raw = bodyKg + fw.kg + rw.kg + floorKg + FIXED_MASS;
  const ballast = Math.max(0, RULES.minMass - raw);
  const cost = bodyKg * bm.costPerKg + fw.cost + rw.cost + floorKg * fm.costPerKg;
  return { body: bodyKg, frontWing: fw.kg, rearWing: rw.kg, floor: floorKg, fixed: FIXED_MASS, ballast, raw, total: raw + ballast, cost };
}

// ---------------- headline performance ----------------
export interface Performance {
  corner: ModeResult;
  straight: ModeResult;
  mass: MassBreakdown;
  speed: number;
  dragN: number;
  downforceN: number;
  ldRatio: number;
  topSpeedKph: number;
  gripG: number; // lateral g at 200 km/h
  checks: { id: string; label: string; ok: boolean; detail: string }[];
  legal: boolean;
}

export function performance(d: CarDesign, speed: number, yawDeg: number, straightMode: boolean): Performance {
  const corner = evalMode(d, false);
  const straight = evalMode(d, true);
  const mass = massOf(d);
  const cur = straightMode ? straight : corner;
  const q = 0.5 * RHO * speed * speed;
  const yaw = yawDeg * RAD;
  const dragN = q * cur.CdA * (1 + 2.2 * Math.sin(yaw) ** 2);
  const downforceN = q * cur.ClA * (1 - 1.6 * Math.sin(yaw) ** 2);
  // top speed in straight mode: 720 kW engine, 93% driveline
  const P = 720e3 * 0.93;
  let lo = 20;
  let hi = 160;
  for (let i = 0; i < 40; i++) {
    const v = (lo + hi) / 2;
    const qq = 0.5 * RHO * v * v;
    const need = qq * straight.CdA * v + 0.02 * (mass.total * 9.81 + qq * straight.ClA) * v;
    if (need > P) hi = v;
    else lo = v;
  }
  const topSpeedKph = ((lo + hi) / 2) * 3.6;
  const v200 = 200 / 3.6;
  const q200 = 0.5 * RHO * v200 * v200;
  const gripG = (1.6 * (mass.total * 9.81 + q200 * corner.ClA)) / (mass.total * 9.81);

  const bd = bodyAero(d);
  const ol = overallLength(d);
  const width = Math.max(d.frontWing.span, 2 * bd.maxHalfWidth);
  const checks = [
    { id: "len", label: "Overall length", ok: ol <= RULES.maxLength, detail: `${ol.toFixed(2)} / ${RULES.maxLength.toFixed(2)} m` },
    { id: "wid", label: "Overall width", ok: width <= RULES.maxWidth, detail: `${width.toFixed(2)} / ${RULES.maxWidth.toFixed(2)} m` },
    { id: "hgt", label: "Height", ok: bd.topHeight <= RULES.maxHeight, detail: `${bd.topHeight.toFixed(2)} / ${RULES.maxHeight.toFixed(2)} m` },
    { id: "min", label: "Minimum mass", ok: true, detail: mass.ballast > 0.5 ? `${mass.ballast.toFixed(0)} kg ballast added` : "no ballast needed" },
    { id: "max", label: "Maximum mass", ok: mass.total <= RULES.maxMass, detail: `${mass.total.toFixed(0)} / ${RULES.maxMass} kg` },
    {
      id: "stall",
      label: "Wings attached",
      ok: !corner.frontWing.stalled && !corner.rearWing.stalled,
      detail: corner.frontWing.stalled ? "front wing stalled" : corner.rearWing.stalled ? "rear wing stalled" : "no stall",
    },
  ];
  const legal = checks.every((c) => c.ok || c.id === "stall");
  return { corner, straight, mass, speed, dragN, downforceN, ldRatio: cur.CdA > 0 ? cur.ClA / cur.CdA : 0, topSpeedKph, gripG, checks, legal };
}
