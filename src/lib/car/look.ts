import * as THREE from "three";
import type { CarDesign } from "./types";
import { evalCurve } from "./curve";

// Flat-vector illustration look: all decals are painted on canvases and projected onto the car.
const INK = "#2a1b1d";
const PXM = 520; // canvas pixels per metre for the livery map
const Z1 = 1.6; // height covered by the livery map
const STRIP = 16; // extra rows used for the top-surface colour bands

export interface LiveryMap {
  texR: THREE.CanvasTexture; // seen from the car's right (−Y): nose points right
  texL: THREE.CanvasTexture; // seen from the left (+Y): text pre-mirrored so it reads correctly
  x0: number;
  invW: number;
  va: number; // v = z * va + vb
  vb: number;
  vStrip: number;
}

const mk = (c: HTMLCanvasElement) => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
};

export function liveryMap(d: CarDesign): LiveryMap {
  const L = d.body.length;
  const X0 = -0.7;
  const X1 = L + 1.4;
  const W = X1 - X0;
  const w = Math.round(W * PXM);
  const h = Math.round(Z1 * PXM);
  const H = h + STRIP;
  const draw = (mirror: boolean) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = H;
    const g = c.getContext("2d")!;
    const fx = (x: number) => (x - X0) * PXM;
    const fy = (z: number) => h - z * PXM;
    g.fillStyle = d.livery.secondary;
    g.fillRect(0, 0, w, H);

    const poly = (pts: [number, number][], fill: string) => {
      g.fillStyle = fill;
      g.beginPath();
      pts.forEach(([x, z], i) => (i ? g.lineTo(fx(x), fy(z)) : g.moveTo(fx(x), fy(z))));
      g.closePath();
      g.fill();
    };
    const line = (pts: [number, number][], lw: number, col = INK) => {
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.lineJoin = "round";
      g.lineCap = "round";
      g.beginPath();
      pts.forEach(([x, z], i) => (i ? g.lineTo(fx(x), fy(z)) : g.moveTo(fx(x), fy(z))));
      g.stroke();
    };
    // diagonal colour blocking, as on the reference car
    const rearRed = (zRef: number): [number, number][] => {
      const xa = L * (0.4 + (0.66 - 0.4) * (zRef / 1.0));
      return [[X0, Z1 + 0.2], [L * 0.66 + (Z1 - 1) * 0.26, Z1 + 0.2], [xa, zRef], [L * 0.4, 0], [X0, 0]];
    };
    poly(rearRed(1.0), d.livery.primary);
    poly([[L * 0.86, Z1 + 0.2], [X1, Z1 + 0.2], [X1, 0], [L * 0.78, 0]], d.livery.primary);
    poly([[L * 0.5, Z1 + 0.2], [L * 0.66, Z1 + 0.2], [L * 0.4, 0], [L * 0.24, 0]], d.livery.secondary);
    line([[L * 0.66, 1.0], [L * 0.4, 0]], 5);
    line([[L * 0.86, 1.0], [L * 0.78, 0]], 5);
    // belly
    g.fillStyle = "#1c1c20";
    g.fillRect(0, fy(0.075), w, PXM * 0.075);
    line([[X0, 0.075], [X1, 0.075]], 5);

    const upper = (u: number) => evalCurve(d.body.sideUpper, u);
    const lower = (u: number) => evalCurve(d.body.sideLower, u);
    const xu = (u: number) => L * (1 - u);
    const mid = (u: number) => (upper(u) + lower(u)) / 2;

    const text = (s: string, x: number, z: number, size: number, font: string, fill: string, stroke?: string, rot = 0) => {
      g.save();
      g.translate(fx(x), fy(z));
      if (mirror) g.scale(-1, 1);
      g.rotate(rot);
      g.font = font.replace("$", `${size}px`);
      g.textAlign = "center";
      g.textBaseline = "middle";
      if (stroke) {
        g.lineWidth = size * 0.08;
        g.strokeStyle = stroke;
        g.lineJoin = "round";
        g.strokeText(s, 0, 0);
      }
      g.fillStyle = fill;
      g.fillText(s, 0, 0);
      g.restore();
    };

    // retro highlights: a bright stripe riding the top line, a soft shade band above the belly
    {
      const pts: [number, number][] = [];
      for (let i = 0; i <= 60; i++) {
        const u = 0.04 + (0.94 * i) / 60;
        pts.push([xu(u), upper(u) - 0.045]);
      }
      line(pts, 7, "rgba(255,255,255,0.55)");
      g.fillStyle = "rgba(20,10,20,0.16)";
      g.fillRect(0, fy(0.2), w, PXM * 0.125);
      // cockpit coaming + engine cover seams
      line([[xu(0.4), upper(0.4) - 0.03], [xu(0.4), lower(0.4) + 0.1]], 4, "rgba(42,27,29,0.55)");
      line([[xu(0.62), upper(0.62) - 0.03], [xu(0.62), lower(0.62) + 0.1]], 4, "rgba(42,27,29,0.45)");
    }
    // sidepod inlet
    {
      const u = 0.5;
      const x = xu(u);
      const z = mid(u);
      g.fillStyle = "#241a1d";
      g.strokeStyle = INK;
      g.lineWidth = 5;
      g.beginPath();
      g.roundRect(fx(x) - 0.12 * PXM, fy(z + 0.04), 0.24 * PXM, 0.17 * PXM, 14);
      g.fill();
      g.stroke();
      g.fillStyle = "#5a4b4f";
      g.beginPath();
      g.roundRect(fx(x) - 0.1 * PXM, fy(z + 0.02), 0.2 * PXM, 0.13 * PXM, 9);
      g.fill();
    }
    // sponsor lettering
    const name = "Kestrel";
    text(name, xu(0.655), mid(0.655) + 0.02, 0.2 * PXM, "italic 800 $ Georgia, serif", "#ffffff", INK, -0.14);
    // logo
    {
      const x = xu(0.3);
      const z = mid(0.3) - 0.02;
      g.fillStyle = "#f4c20d";
      g.strokeStyle = INK;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(fx(x), fy(z), 0.085 * PXM, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      text("V", x, z - 0.005, 0.11 * PXM, "900 $ Arial Black, Arial, sans-serif", "#c1121f");
    }
    text(String(d.livery.number), xu(0.94), mid(0.94) + 0.1, 0.16 * PXM, "900 $ Impact, Arial Black, sans-serif", "#ffffff", INK);
    text("TREADCO", xu(0.07), lower(0.07) + 0.06, 0.05 * PXM, "900 $ Impact, Arial Black, sans-serif", "#2a1b1d");

    // top-surface strip (no text): same blocking evaluated near the car's top height
    g.fillStyle = d.livery.secondary;
    g.fillRect(0, h, w, STRIP);
    const sy0 = h;
    const sp = (pts: [number, number][], fill: string) => {
      g.fillStyle = fill;
      g.beginPath();
      pts.forEach(([x, z], i) => (i ? g.lineTo(fx(x), sy0 + (z ? STRIP : 0)) : g.moveTo(fx(x), sy0)));
      g.closePath();
      g.fill();
    };
    void sp;
    const xr = L * (0.4 + (0.66 - 0.4) * 0.7);
    g.fillStyle = d.livery.primary;
    g.fillRect(0, sy0, fx(xr), STRIP);
    g.fillRect(fx(L * 0.86), sy0, w, STRIP);
    return c;
  };
  const texR = mk(draw(false));
  const texL = mk(draw(true));
  const Ht = h + STRIP;
  return { texR, texL, x0: X0, invW: 1 / W, va: PXM / Ht, vb: 1 - h / Ht, vStrip: 1 - (h + STRIP / 2) / Ht };
}

export function wheelTexture(front: boolean): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const m = S / 2;
  g.fillStyle = "#1b1416";
  g.beginPath();
  g.arc(m, m, m - 2, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#3b2f31";
  g.lineWidth = 6;
  g.beginPath();
  g.arc(m, m, m - 14, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = "#f4c20d";
  g.lineWidth = 7;
  g.beginPath();
  g.arc(m, m, m * 0.7, 0, Math.PI * 2);
  g.stroke();
  // yellow sidewall lettering, top and bottom arcs
  const word = front ? "TREADCO · EAGLE" : "TREADCO · EAGLE";
  g.fillStyle = "#f4c20d";
  g.font = "900 54px Impact, Arial Black, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const arcText = (s: string, a0: number, dir: 1 | -1, R: number) => {
    const n = s.length;
    const span = 1.9;
    for (let i = 0; i < n; i++) {
      const a = a0 + (dir * (i - (n - 1) / 2) * span) / n;
      g.save();
      g.translate(m + Math.cos(a) * R, m + Math.sin(a) * R);
      g.rotate(a + (dir === 1 ? Math.PI / 2 : -Math.PI / 2));
      g.fillText(s[i], 0, 0);
      g.restore();
    }
  };
  arcText(word, -Math.PI / 2, 1, m * 0.8);
  // rim
  g.fillStyle = "#d8d6d6";
  g.strokeStyle = INK;
  g.lineWidth = 8;
  g.beginPath();
  g.arc(m, m, m * 0.6, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.globalCompositeOperation = "destination-out";
  g.beginPath();
  g.arc(m, m, m * 0.5, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = "source-over";
  g.strokeStyle = "#a5a3aa";
  g.lineCap = "round";
  g.lineWidth = m * 0.11;
  for (let k = 0; k < 5; k++) {
    const a = (k * 72 * Math.PI) / 180 - 0.3;
    g.beginPath();
    g.moveTo(m, m);
    g.lineTo(m + Math.cos(a) * m * 0.5, m + Math.sin(a) * m * 0.5);
    g.stroke();
  }
  g.fillStyle = "#17141a";
  g.strokeStyle = "#8d8b92";
  g.lineWidth = 5;
  g.beginPath();
  g.arc(m, m, m * 0.16, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  return mk(c);
}

// End-plate decal: livery colour with a white plate, number and logo
export function plateTexture(d: CarDesign, rear: boolean): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = rear ? d.livery.primary : d.livery.secondary;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = INK;
  g.lineWidth = 8;
  g.strokeRect(4, 4, w - 8, h - 8);
  if (rear) {
    g.fillStyle = "#f6f3ef";
    g.fillRect(24, 22, 150, 110);
    g.strokeRect(24, 22, 150, 110);
    g.fillStyle = INK;
    g.font = "900 100px Impact, Arial Black, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("K", 99, 80);
    g.fillStyle = "#fff";
    g.font = "900 90px Impact, Arial Black, sans-serif";
    g.fillText(String(d.livery.number), 380, 170);
  } else {
    g.fillStyle = INK;
    g.font = "900 62px Impact, Arial Black, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("TREADCO", w / 2, h / 2);
  }
  return mk(c);
}
