// Deterministic fixed-timestep vehicle model.
// No sin/cos/pow/exp in the stepping path (only + - * / sqrt abs min max), so every client
// gets bit-identical results for the same inputs. That is what the lockstep race relies on.
import type { CarDesign } from "@/lib/car/types";
import { performance } from "@/lib/car/aero";
import { wheels } from "@/lib/car/shape";
import { locate, pointAt, type Track } from "./track";

export const DT = 1 / 240;
const G = 9.81;
const RHO = 1.2;

export interface VehicleParams {
  mass: number; // dry car + driver, kg
  L: number; // wheelbase
  a: number; // CG to front axle
  b: number; // CG to rear axle
  hcg: number;
  Iz: number;
  power: number; // W at the wheels
  regenPower: number;
  CdA: [number, number]; // corner, straight
  ClA: [number, number];
  balF: [number, number];
  rearAxleX: number; // where the CG sits in car-model x, for rendering
  cgX: number;
  tankKg: number;
}

export function vehicleParams(d: CarDesign): VehicleParams {
  const p = performance(d, 70, 0, false);
  const L = d.wheelbase;
  const ws = wheels(d);
  const rearX = Math.min(...ws.map((w) => w.x));
  const wf = 0.44; // static front weight fraction
  return {
    mass: p.mass.total,
    L,
    a: L * (1 - wf),
    b: L * wf,
    hcg: 0.3,
    Iz: p.mass.total * (0.35 * L) * (0.35 * L),
    power: 720e3 * 0.93,
    regenPower: 280e3,
    CdA: [p.corner.CdA, p.straight.CdA],
    ClA: [p.corner.ClA, p.straight.ClA],
    balF: [p.corner.balanceFront, p.straight.balanceFront],
    rearAxleX: rearX,
    cgX: rearX + L * wf,
    tankKg: 45,
  };
}

// Inputs are quantized so they can be logged, uploaded and replayed exactly.
export interface Input {
  steer: number; // -127..127, left positive
  thr: number; // 0..255
  brk: number; // 0..255
}
export const NO_INPUT: Input = { steer: 0, thr: 0, brk: 0 };
export function quantize(steer: number, thr: number, brk: number): Input {
  const q = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : Math.round(v));
  return { steer: q(steer * 127, -127, 127), thr: q(thr * 255, 0, 255), brk: q(brk * 255, 0, 255) };
}

export interface VState {
  t: number;
  x: number;
  y: number;
  hx: number;
  hy: number;
  u: number; // forward speed
  v: number; // lateral speed (left positive)
  r: number; // yaw rate
  steer: number; // normalized wheel position -1..1
  drs: number; // 0 corner aero .. 1 straight aero
  fuel: number;
  wear: number; // 0..1
  damage: number; // 0..100
  ax: number;
  ay: number;
  // track bookkeeping
  seg: number;
  s: number;
  d: number;
  prog: number; // unwrapped distance
  nextLine: number;
  lapStart: number | null;
  laps: number[];
  offTrack: boolean;
  hit: number; // wall impact strength this tick
  lastS: number;
}

export function initState(p: VehicleParams, track: Track, startBehind = 25): VState {
  const s0 = track.length - startBehind;
  const pt = pointAt(track, s0);
  const loc = locate(track, pt.x, pt.y, 0);
  return {
    t: 0, x: pt.x, y: pt.y, hx: pt.tx, hy: pt.ty, u: 0, v: 0, r: 0, steer: 0, drs: 0,
    fuel: p.tankKg * 0.4, wear: 0, damage: 0, ax: 0, ay: 0,
    seg: loc.seg, s: loc.s, d: loc.d, prog: -startBehind, nextLine: 0, lapStart: null, laps: [],
    offTrack: false, hit: 0, lastS: loc.s,
  };
}

const sgn = (v: number) => (v < 0 ? -1 : 1);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function tireLat(alpha: number, mu: number, fz: number, fx: number) {
  const cap = mu * fz;
  const lim = Math.sqrt(Math.max(0, cap * cap - fx * fx));
  const x = alpha / 0.1;
  return -lim * (x / Math.sqrt(1 + x * x));
}

export function step(p: VehicleParams, st: VState, inp: Input, track: Track): void {
  const dt = DT;
  const steerIn = inp.steer / 127;
  const thr = inp.thr / 255;
  const brk = inp.brk / 255;
  const m = p.mass + st.fuel;
  const W = m * G;
  const u = st.u;
  const au = Math.abs(u);

  // steering: rate limited, speed-sensitive lock
  const maxRate = 14 * dt;
  st.steer += clamp(steerIn - st.steer, -maxRate, maxRate);
  const sv = au / 36;
  const delta = (st.steer * 0.3) / (1 + sv * sv);
  const cd = 1 - (delta * delta) / 2;
  const sd = delta;

  // active aero: wings flatten on straights
  const straight = Math.abs(steerIn) < 0.06 && thr > 0.5 && brk < 0.05 && st.damage < 60 ? 1 : 0;
  st.drs += (straight - st.drs) * Math.min(1, dt / (straight ? 0.25 : 0.1));
  const CdA = p.CdA[0] + (p.CdA[1] - p.CdA[0]) * st.drs;
  let ClA = p.ClA[0] + (p.ClA[1] - p.ClA[0]) * st.drs;
  const bal = p.balF[0] + (p.balF[1] - p.balF[0]) * st.drs;
  ClA *= 1 - 0.004 * st.damage;
  const q = 0.5 * RHO * u * u;
  const Df = q * ClA;
  const Fd = q * CdA;

  // axle loads
  const dFz = (m * st.ax * p.hcg) / p.L;
  const fzF = Math.max(200, (W * p.b) / p.L + Df * bal - dFz);
  const fzR = Math.max(200, (W * p.a) / p.L + Df * (1 - bal) + dFz);

  const surf = st.offTrack ? 0.45 : 1;
  const mulT = (1 - 0.35 * st.wear) * (1 - 0.004 * st.damage) * surf;
  const muF = Math.max(1.2, 1.75 - 2e-5 * fzF) * mulT;
  const muR = Math.max(1.2, 1.75 - 2e-5 * fzR) * mulT * 1.16; // wider rear tyres: built-in understeer margin

  // longitudinal
  const dir = sgn(u);
  let fxR = 0;
  let fxF = 0;
  if (thr > 0) {
    // traction control: the more lateral grip is in use, the less drive the rear axle may ask for
    const used = clamp((Math.abs(st.ay) * m) / (muF * fzF + muR * fzR), 0, 1);
    fxR += thr * Math.min(p.power / Math.max(u, 6), muR * fzR * 0.95 * (1 - 0.85 * used * used));
  }
  if (brk < 0.01) {
    const k = clamp(1 - thr * 8, 0, 1);
    if (au > 0.3) fxR -= dir * k * Math.min(p.regenPower / Math.max(au, 8), 0.5 * W);
  }
  if (brk > 0) {
    const tot = brk * 0.95 * (muF * fzF + muR * fzR);
    fxF -= dir * tot * (muF * fzF) / (muF * fzF + muR * fzR);
    fxR -= dir * tot * (muR * fzR) / (muF * fzF + muR * fzR);
  }
  fxF = clamp(fxF, -muF * fzF, muF * fzF);
  fxR = clamp(fxR, -muR * fzR, muR * fzR);

  // lateral
  const den = Math.max(au, 4);
  const alF = (st.v + p.a * st.r) / den - delta * (u < 0 ? -1 : 1);
  const alR = (st.v - p.b * st.r) / den;
  const fyF = tireLat(alF, muF, fzF, fxF);
  const fyR = tireLat(alR, muR, fzR, fxR);

  const roll = 0.015 * (W + Df) * dir * Math.min(1, au / 2);
  const grass = st.offTrack ? 0.3 * W * dir * Math.min(1, au / 5) : 0;
  const fxBody = fxF * cd - fyF * sd + fxR - Fd * dir - roll - grass;
  const fyBody = fyF * cd + fxF * sd + fyR;
  const du = fxBody / m + st.v * st.r;
  const dv = fyBody / m - u * st.r;
  const dr = (p.a * (fyF * cd + fxF * sd) - p.b * fyR) / p.Iz - st.r * (au < 5 ? 2 : 0.7 * Math.min(1, au / 30));
  st.ax = fxBody / m;
  st.ay = fyBody / m;

  st.u += du * dt;
  st.v += dv * dt;
  st.r += dr * dt;
  if (au < 0.05 && thr === 0) st.u = 0;

  // heading rotation by small-angle series
  const th = st.r * dt;
  const th2 = th * th;
  const c = 1 - th2 / 2 + (th2 * th2) / 24;
  const s = th - (th * th2) / 6;
  let hx = st.hx * c - st.hy * s;
  let hy = st.hx * s + st.hy * c;
  const inv = 1 / Math.sqrt(hx * hx + hy * hy);
  hx *= inv;
  hy *= inv;
  st.hx = hx;
  st.hy = hy;
  st.x += (hx * st.u - hy * st.v) * dt;
  st.y += (hy * st.u + hx * st.v) * dt;
  st.t += dt;

  // consumables
  st.fuel = Math.max(0, st.fuel - thr * 0.02 * dt);
  const ayn = st.ay / 40;
  st.wear = Math.min(1, st.wear + (ayn * ayn + brk * 0.3) * 0.012 * dt);

  // track location, walls, laps
  let loc = locate(track, st.x, st.y, st.seg);
  st.hit = 0;
  if (Math.abs(loc.d) > track.wallOffset) {
    // wall: inward normal is opposite the side we're on
    const side = loc.d > 0 ? 1 : -1;
    const nx = side * loc.ty;
    const ny = -side * loc.tx;
    const over = Math.abs(loc.d) - track.wallOffset;
    st.x += nx * over;
    st.y += ny * over;
    let vx = st.hx * st.u - st.hy * st.v;
    let vy = st.hy * st.u + st.hx * st.v;
    const vn = vx * nx + vy * ny;
    if (vn < 0) {
      const imp = -vn;
      vx += -(1 + 0.15) * vn * nx;
      vy += -(1 + 0.15) * vn * ny;
      vx *= 0.8;
      vy *= 0.8;
      st.u = vx * st.hx + vy * st.hy;
      st.v = -vx * st.hy + vy * st.hx;
      st.r *= 0.5;
      st.hit = imp;
      st.damage = Math.min(100, st.damage + 0.6 * imp * Math.sqrt(imp));
    }
    loc = locate(track, st.x, st.y, st.seg);
  }
  st.offTrack = Math.abs(loc.d) > track.halfWidth;
  let ds = loc.s - st.lastS;
  if (ds < -track.length / 2) ds += track.length;
  else if (ds > track.length / 2) ds -= track.length;
  st.lastS = loc.s;
  st.seg = loc.seg;
  st.s = loc.s;
  st.d = loc.d;
  const before = st.prog;
  st.prog += ds;
  if (st.prog >= st.nextLine && before < st.nextLine) {
    const f = (st.nextLine - before) / (st.prog - before);
    const tc = st.t - dt + dt * f;
    if (st.lapStart !== null) st.laps.push(tc - st.lapStart);
    st.lapStart = tc;
    st.nextLine += track.length;
  }
}
