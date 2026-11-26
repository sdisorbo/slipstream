// three.js mesh builders. Everything is authored in the physics frame (X forward, Y lateral, Z up, ground Z=0);
// the viewport rotates the whole group so Z becomes screen-up.
import * as THREE from "three";
import { evalCurve } from "./curve";
import type { CarDesign, WingDesign } from "./types";
import {
  airfoilPoint,
  bodyStations,
  floorGap,
  floorX,
  frontAxleX,
  frontWingEls,
  rearWingEls,
  wheels,
  type WingElement,
} from "./shape";
import { MATERIALS } from "./materials";

const sgnPow = (v: number, e: number) => Math.sign(v) * Math.pow(Math.abs(v), e);

export const RING = 40;

export function buildBodyGeometry(d: CarDesign, N = 72): THREE.BufferGeometry {
  const st = bodyStations(d, N);
  const n = d.body.squareness;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const prim = new THREE.Color(d.livery.primary);
  const sec = new THREE.Color(d.livery.secondary);
  const acc = new THREE.Color(d.livery.accent);
  for (const s of st) {
    for (let j = 0; j < RING; j++) {
      const th = (2 * Math.PI * j) / RING;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const y = s.w * sgnPow(c, 2 / n);
      const z = s.zc + s.halfH * sgnPow(sn, 2 / n);
      pos.push(s.X, y, z);
      let color = prim;
      if (Math.abs(y) < 0.04 && sn > 0.2) color = acc;
      else if (sn < -0.45) color = sec;
      else if (s.u < 0.05) color = acc;
      col.push(color.r, color.g, color.b);
    }
  }
  // quads between stations; stations run nose -> tail (X decreasing)
  for (let i = 0; i < st.length - 1; i++) {
    for (let j = 0; j < RING; j++) {
      const a = i * RING + j;
      const b = i * RING + ((j + 1) % RING);
      const c = (i + 1) * RING + j;
      const e = (i + 1) * RING + ((j + 1) % RING);
      idx.push(a, c, b, b, c, e);
    }
  }
  // end caps
  const capCenter = (i: number) => {
    const s = st[i];
    pos.push(s.X, 0, s.zc);
    col.push(prim.r, prim.g, prim.b);
    return pos.length / 3 - 1;
  };
  const nc = capCenter(0);
  const tc = capCenter(st.length - 1);
  for (let j = 0; j < RING; j++) {
    const j2 = (j + 1) % RING;
    idx.push(nc, j2, j);
    const base = (st.length - 1) * RING;
    idx.push(tc, base + j, base + j2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make sure faces point outward: check a mid-station top vertex normal
  const mid = Math.floor(st.length / 2);
  const topJ = Math.round(RING / 4);
  const vi = mid * RING + topJ;
  const nz = g.getAttribute("normal").getZ(vi);
  if (nz < 0) {
    const ix = g.getIndex()!;
    for (let k = 0; k < ix.count; k += 3) {
      const t = ix.getX(k + 1);
      ix.setX(k + 1, ix.getX(k + 2));
      ix.setX(k + 2, t);
    }
    g.computeVertexNormals();
  }
  g.userData.baseColors = Float32Array.from(col);
  return g;
}

function wingElementGeometry(w: WingDesign, el: WingElement, color: THREE.Color): THREE.BufferGeometry {
  const NS = 30;
  const ring: [number, number][] = [];
  for (let i = 0; i <= NS; i++) {
    const s = (1 - Math.cos((Math.PI * i) / NS)) / 2;
    ring.push(airfoilPoint(w, el, s, "upper"));
  }
  for (let i = NS - 1; i >= 1; i--) {
    const s = (1 - Math.cos((Math.PI * i) / NS)) / 2;
    ring.push(airfoilPoint(w, el, s, "lower"));
  }
  const M = ring.length;
  const h = w.span / 2;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const [x, z] of ring) pos.push(x, -h, z);
  for (const [x, z] of ring) pos.push(x, h, z);
  for (let i = 0; i < M; i++) {
    const i2 = (i + 1) % M;
    idx.push(i, i2, M + i, i2, M + i2, M + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  void color;
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

function buildWing(d: CarDesign, w: WingDesign, els: WingElement[], matCol: string, accent: string, mount: "front" | "rear"): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: matCol, roughness: 0.35, metalness: 0.25, side: THREE.DoubleSide });
  const plateMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4, metalness: 0.2 });
  let minX = Infinity;
  let maxX = -Infinity;
  let sumZ = 0;
  for (const el of els) {
    g.add(new THREE.Mesh(wingElementGeometry(w, el, new THREE.Color(matCol)), mat));
    const b = (el.pitchDeg * Math.PI) / 180;
    minX = Math.min(minX, el.LE[0] - el.chord * Math.cos(b), el.LE[0]);
    maxX = Math.max(maxX, el.LE[0]);
    sumZ += el.LE[1];
  }
  const zMean = sumZ / els.length;
  const ep = Math.max(0.03, w.endplate);
  const zMid = Math.max(0.012 + ep / 2, zMean + (mount === "rear" ? 0.02 : 0.0));
  for (const sgn of [-1, 1]) {
    const plate = box(maxX - minX + 0.04, 0.012, ep, (minX + maxX) / 2, (sgn * w.span) / 2, zMid, plateMat);
    g.add(plate);
  }
  // mounts
  const st = bodyStations(d, 48);
  const metal = new THREE.MeshStandardMaterial({ color: "#1b1b1f", roughness: 0.5, metalness: 0.6 });
  if (mount === "rear") {
    const cx = (minX + maxX) / 2;
    const top = evalCurve(d.body.sideUpper, 1 - cx / d.body.length);
    g.add(rod(new THREE.Vector3(cx, 0, zMean - 0.03), new THREE.Vector3(cx + 0.1, 0, Math.min(top, zMean - 0.1)), 0.022, metal));
  } else {
    const nose = st[0];
    for (const sgn of [-1, 1]) {
      g.add(rod(new THREE.Vector3(maxX - 0.05, sgn * 0.09, zMean + 0.02), new THREE.Vector3(nose.X - 0.05, sgn * 0.03, nose.zc), 0.014, metal));
    }
  }
  return g;
}

export interface CarBuild {
  group: THREE.Group;
  body: THREE.Mesh;
  bodyGeom: THREE.BufferGeometry;
  dispose: () => void;
}

export function buildCar(d: CarDesign, straight: boolean): CarBuild {
  const group = new THREE.Group();
  const bodyGeom = buildBodyGeometry(d);
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.2 });
  const body = new THREE.Mesh(bodyGeom, bodyMat);
  group.add(body);

  const wingCol = (id: keyof typeof MATERIALS) => (id === "carbon" ? "#16161a" : id === "titanium" ? "#8c8f96" : id === "steel" ? "#6e7078" : id === "aluminum" ? "#b9bcc4" : id === "magnesium" ? "#a6a8ae" : "#d9d6cf");
  group.add(buildWing(d, d.frontWing, frontWingEls(d, straight ? 0.55 : 1), wingCol(d.frontWing.material), d.livery.primary, "front"));
  group.add(buildWing(d, d.rearWing, rearWingEls(d, straight ? 0.2 : 1), wingCol(d.rearWing.material), d.livery.primary, "rear"));

  // floor plank with the profile you drew as its underside
  {
    const N = 40;
    const pos: number[] = [];
    const idx: number[] = [];
    const hw = d.floor.width / 2;
    for (let i = 0; i < N; i++) {
      const f = i / (N - 1);
      const x = floorX(d, f);
      const zb = floorGap(d, f);
      const zt = zb + 0.02;
      pos.push(x, -hw, zb, x, hw, zb, x, hw, zt, x, -hw, zt);
    }
    for (let i = 0; i < N - 1; i++) {
      for (let k = 0; k < 4; k++) {
        const a = i * 4 + k;
        const b = i * 4 + ((k + 1) % 4);
        const c = (i + 1) * 4 + k;
        const e = (i + 1) * 4 + ((k + 1) % 4);
        idx.push(a, b, c, b, e, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: "#101013", roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide })));
  }

  // wheels
  const tireMat = new THREE.MeshStandardMaterial({ color: "#0c0c0e", roughness: 0.85 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: "#e7c21a", roughness: 0.6 });
  const rimMat = new THREE.MeshStandardMaterial({ color: "#9a9ca3", roughness: 0.3, metalness: 0.8 });
  const metal = new THREE.MeshStandardMaterial({ color: "#1b1b1f", roughness: 0.5, metalness: 0.6 });
  const st = bodyStations(d, 64);
  const bodyAt = (X: number) => {
    let best = st[0];
    for (const s of st) if (Math.abs(s.X - X) < Math.abs(best.X - X)) best = s;
    return best;
  };
  for (const w of wheels(d)) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(w.r, w.r, w.width, 36), tireMat));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(w.r * 0.86, w.r * 0.86, w.width + 0.004, 36), stripeMat));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(w.r * 0.74, w.r * 0.74, w.width + 0.008, 36), rimMat));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(w.r * 0.16, w.r * 0.16, w.width + 0.012, 12), new THREE.MeshStandardMaterial({ color: "#2a2b30", roughness: 0.5, metalness: 0.7 })));
    g.position.set(w.x, w.y, w.r);
    group.add(g);
    const b = bodyAt(w.x);
    const sg = Math.sign(w.y);
    const inner = new THREE.Vector3(w.x, w.y - sg * w.width * 0.5, w.r);
    group.add(rod(inner, new THREE.Vector3(w.x + 0.12, sg * b.w * 0.8, b.zc + 0.05), 0.012, metal));
    group.add(rod(inner, new THREE.Vector3(w.x - 0.14, sg * b.w * 0.8, b.zc - 0.02), 0.012, metal));
  }
  void frontAxleX;

  // driver: helmet + halo
  {
    const u = 0.46;
    const X = d.body.length * (1 - u);
    const z = evalCurve(d.body.sideUpper, u);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 16), new THREE.MeshStandardMaterial({ color: d.livery.helmet, roughness: 0.25, metalness: 0.3 }));
    helmet.position.set(X, 0, z + 0.07);
    helmet.scale.set(1.15, 0.95, 1);
    group.add(helmet);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.035, 0.26), new THREE.MeshStandardMaterial({ color: d.livery.helmetStripe, roughness: 0.4 }));
    stripe.position.copy(helmet.position);
    group.add(stripe);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.095, 16, 10, 0, Math.PI), new THREE.MeshStandardMaterial({ color: "#0b0b10", roughness: 0.1, metalness: 0.7 }));
    visor.rotation.set(0, Math.PI / 2, 0);
    visor.position.set(X + 0.06, 0, z + 0.075);
    visor.scale.set(0.6, 0.8, 1.1);
    group.add(visor);
    const haloPts = [
      new THREE.Vector3(X + 0.32, 0, z + 0.04),
      new THREE.Vector3(X + 0.2, 0.06, z + 0.2),
      new THREE.Vector3(X, 0.2, z + 0.26),
      new THREE.Vector3(X - 0.2, 0.15, z + 0.2),
      new THREE.Vector3(X - 0.3, 0.1, z + 0.08),
    ];
    const half = new THREE.CatmullRomCurve3(haloPts);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(half, 24, 0.016, 8), metal);
    group.add(tube);
    const mirror = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(haloPts.map((p) => new THREE.Vector3(p.x, -p.y, p.z))), 24, 0.016, 8), metal);
    group.add(mirror);
  }

  return {
    group,
    body,
    bodyGeom,
    dispose: () => {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
    },
  };
}
