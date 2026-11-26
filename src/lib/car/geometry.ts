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
  overallLength,
  rearWingEls,
  wheels,
  type WingElement,
} from "./shape";
import { liveryMap, plateTexture, wheelTexture, type LiveryMap } from "./look";
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
  const acc = new THREE.Color(d.livery.accent);
  const UNDER = new THREE.Color("#1c1c20");
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
      else if (sn < -0.45) color = UNDER;
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

function roundedShape(pts: [number, number][], rad: number): THREE.Shape {
  const sh = new THREE.Shape();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const l1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const l2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const r1 = Math.min(rad, l1 / 2.2);
    const r2 = Math.min(rad, l2 / 2.2);
    const a1: [number, number] = [p1[0] + ((p0[0] - p1[0]) / l1) * r1, p1[1] + ((p0[1] - p1[1]) / l1) * r1];
    const a2: [number, number] = [p1[0] + ((p2[0] - p1[0]) / l2) * r2, p1[1] + ((p2[1] - p1[1]) / l2) * r2];
    if (i === 0) sh.moveTo(a1[0], a1[1]);
    else sh.lineTo(a1[0], a1[1]);
    sh.quadraticCurveTo(p1[0], p1[1], a2[0], a2[1]);
  }
  sh.closePath();
  return sh;
}

// end plate: a thin extruded slab outlined in the x-z plane, UV-mapped over its bounding box
function plateGeom(pts: [number, number][], rad: number, thick = 0.016): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(roundedShape(pts, rad), { depth: thick, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 8 });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, thick / 2, 0);
  const p = geo.getAttribute("position");
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < p.count; i++) {
    x0 = Math.min(x0, p.getX(i)); x1 = Math.max(x1, p.getX(i));
    z0 = Math.min(z0, p.getZ(i)); z1 = Math.max(z1, p.getZ(i));
  }
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = (p.getX(i) - x0) / (x1 - x0);
    uv[i * 2 + 1] = (p.getZ(i) - z0) / (z1 - z0);
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

function buildWing(d: CarDesign, w: WingDesign, els: WingElement[], matCol: string, accent: string, mount: "front" | "rear"): THREE.Group {
  const g = new THREE.Group();
  const carbon = d.frontWing.material === "carbon" && mount === "front" ? true : d.rearWing.material === "carbon" && mount === "rear";
  const prim = d.livery.primary;
  const sec = d.livery.secondary;
  const elColor = (k: number) => (!carbon ? matCol : mount === "rear" ? (k % 2 === 0 ? prim : sec) : k === 0 ? "#1c1c20" : k % 2 === 1 ? sec : prim);
  const plateMat = new THREE.MeshStandardMaterial({ color: "#ffffff", map: plateTexture(d, mount === "rear"), roughness: 0.4, metalness: 0.2 });
  const flapMat = new THREE.MeshStandardMaterial({ color: "#1c1c20", roughness: 0.6 });
  void accent;
  let minX = Infinity;
  let maxX = -Infinity;
  let sumZ = 0;
  let zLo = Infinity;
  let zHi = -Infinity;
  els.forEach((el, k) => {
    const mat = new THREE.MeshStandardMaterial({ color: elColor(k), roughness: 0.35, metalness: 0.2, side: THREE.DoubleSide });
    g.add(new THREE.Mesh(wingElementGeometry(w, el, new THREE.Color(matCol)), mat));
    // gurney tab on the trailing edge
    const te = airfoilPoint(w, el, 1, "upper");
    const b = (el.pitchDeg * Math.PI) / 180;
    const tab = box(0.008, w.span * 0.98, 0.026, te[0], 0, te[1] + 0.008, flapMat);
    tab.rotation.y = -b * 0.6;
    g.add(tab);
    for (let i = 0; i <= 8; i++) for (const sd of ["upper", "lower"] as const) {
      const p = airfoilPoint(w, el, i / 8, sd);
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      zLo = Math.min(zLo, p[1]);
      zHi = Math.max(zHi, p[1]);
    }
    sumZ += el.LE[1];
  });
  const zMean = sumZ / els.length;

  // end plates: shaped slabs, footplates and fences
  const pts: [number, number][] =
    mount === "rear"
      ? [[maxX + 0.05, zLo - 0.03], [minX - 0.02, zLo - 0.1], [minX - 0.07, zHi + 0.13], [maxX + 0.0, zHi + 0.08]]
      : [[maxX + 0.07, 0.014], [minX - 0.05, 0.012], [minX - 0.06, zHi + 0.1], [maxX + 0.02, zHi + 0.05]];
  for (const sgn of [-1, 1]) {
    const plate = new THREE.Mesh(plateGeom(pts, 0.045), plateMat);
    plate.position.y = sgn * (w.span / 2 + 0.008);
    g.add(plate);
    if (mount === "front") {
      const foot = box(maxX - minX + 0.12, 0.06, 0.008, (minX + maxX) / 2 + 0.01, sgn * (w.span / 2 - 0.03), 0.02, flapMat);
      g.add(foot);
      const fence = box(Math.max(0.1, (maxX - minX) * 0.6), 0.006, 0.085, (minX + maxX) / 2, sgn * (w.span / 2 - 0.2), zLo + 0.05, plateMat);
      g.add(fence);
    }
  }
  // mounts
  const st = bodyStations(d, 48);
  const metal = new THREE.MeshStandardMaterial({ color: "#1b1b1f", roughness: 0.5, metalness: 0.6 });
  if (mount === "rear") {
    const cx = (minX + maxX) / 2;
    const top = evalCurve(d.body.sideUpper, Math.min(1, 1 - cx / d.body.length));
    for (const sgn of [-1, 1]) {
      g.add(rod(new THREE.Vector3(cx, sgn * 0.04, zLo - 0.01), new THREE.Vector3(cx + 0.12, sgn * 0.05, Math.min(top, zMean - 0.12)), 0.018, metal));
    }
    // lower beam wing behind the diffuser
    const beam = box(0.2, w.span * 0.55, 0.014, Math.max(0.04, minX + 0.05), 0, Math.max(0.3, zMean - 0.45), new THREE.MeshStandardMaterial({ color: elColor(1), roughness: 0.4, side: THREE.DoubleSide }));
    beam.rotation.y = -0.14;
    g.add(beam);
    for (const sgn of [-1, 1]) g.add(box(0.24, 0.008, 0.1, Math.max(0.04, minX + 0.05), sgn * w.span * 0.275, Math.max(0.3, zMean - 0.45), plateMat));
  } else {
    const nose = st[0];
    for (const sgn of [-1, 1]) {
      g.add(rod(new THREE.Vector3(maxX - 0.05, sgn * 0.09, zMean + 0.02), new THREE.Vector3(nose.X - 0.05, sgn * 0.03, nose.zc), 0.014, metal));
    }
  }
  return g;
}


// ---- flat illustration look: two-band toon shading, decals projected from the side, black ink outline ----
let toonGrad: THREE.DataTexture | null = null;
function gradient() {
  if (!toonGrad) {
    toonGrad = new THREE.DataTexture(new Uint8Array([225, 225, 225, 255, 255, 255, 255, 255]), 2, 1, THREE.RGBAFormat);
    toonGrad.minFilter = THREE.NearestFilter;
    toonGrad.magFilter = THREE.NearestFilter;
    toonGrad.needsUpdate = true;
  }
  return toonGrad;
}
const inkMat = (w: number) => {
  const m = new THREE.MeshBasicMaterial({ color: "#2a1b1d", side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>\n transformed += normalize(normal) * ${w.toFixed(4)};`);
  };
  return m;
};

export function toonify(root: THREE.Object3D, body: THREE.Mesh, lm: LiveryMap, liv: { value: number }) {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  const inkThin = inkMat(0.012);
  const inkBody = inkMat(0.02);
  for (const m of meshes) {
    const old = m.material as THREE.MeshStandardMaterial;
    if (!old.isMeshStandardMaterial) continue;
    const toon = new THREE.MeshToonMaterial({ color: old.color, map: old.map, vertexColors: old.vertexColors, side: old.side, gradientMap: gradient() });
    if (m === body) {
      toon.onBeforeCompile = (sh) => {
        sh.uniforms.uTexR = { value: lm.texR };
        sh.uniforms.uTexL = { value: lm.texL };
        sh.uniforms.uMap = { value: new THREE.Vector4(lm.x0, lm.invW, lm.va, lm.vb) };
        sh.uniforms.uStrip = { value: lm.vStrip };
        sh.uniforms.uLiv = liv;
        sh.vertexShader = sh.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjN;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObjPos = position;\nvObjN = normal;");
        sh.fragmentShader = sh.fragmentShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjN;\nuniform sampler2D uTexR;\nuniform sampler2D uTexL;\nuniform vec4 uMap;\nuniform float uStrip;\nuniform float uLiv;")
          .replace(
            "#include <color_fragment>",
            `#include <color_fragment>
            {
              float u = (vObjPos.x - uMap.x) * uMap.y;
              float v = vObjPos.z * uMap.z + uMap.w;
              vec3 sideC = vObjPos.y < 0.0 ? texture2D(uTexR, vec2(u, v)).rgb : texture2D(uTexL, vec2(u, v)).rgb;
              vec3 topC = texture2D(uTexR, vec2(u, uStrip)).rgb;
              vec3 c = mix(topC, sideC, smoothstep(0.3, 0.6, abs(normalize(vObjN).y)));
              c *= 0.86 + 0.14 * smoothstep(0.08, 0.55, vObjPos.z);
              if (vObjN.z < -0.5) c = vec3(0.012, 0.012, 0.015);
              diffuseColor.rgb = mix(diffuseColor.rgb, c, uLiv);
            }`,
          );
      };
    }
    m.material = toon;
    old.dispose();
    if (!m.geometry.getAttribute("normal")) continue;
    const o = new THREE.Mesh(m.geometry, m === body ? inkBody : inkThin);
    o.position.copy(m.position);
    o.quaternion.copy(m.quaternion);
    o.scale.copy(m.scale);
    m.parent?.add(o);
  }
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
  const metal = new THREE.MeshStandardMaterial({ color: "#1b1b1f", roughness: 0.5, metalness: 0.6 });
  const st = bodyStations(d, 64);
  const bodyAt = (X: number) => {
    let best = st[0];
    for (const s of st) if (Math.abs(s.X - X) < Math.abs(best.X - X)) best = s;
    return best;
  };
  const wheelTexFront = wheelTexture(true);
  const wheelTexRear = wheelTexture(false);
  const brakeMat = new THREE.MeshStandardMaterial({ color: "#7a787e", roughness: 0.5, metalness: 0.7 });
  const lipMat = new THREE.MeshStandardMaterial({ color: "#cfcdd2", roughness: 0.3, metalness: 0.8 });
  const caliperMat = new THREE.MeshStandardMaterial({ color: d.livery.primary, roughness: 0.5 });
  for (const w of wheels(d)) {
    const g = new THREE.Group();
    const hw = w.width / 2;
    // grooved slick: rounded shoulders, a bulging sidewall and four circumferential grooves
    const prof: THREE.Vector2[] = [];
    const half: [number, number][] = [
      [0.6, 0.78], [0.68, 0.9], [0.86, 0.985], [0.95, 0.95], [0.985, 0.86], [1, 0.72],
    ];
    for (const [rf, yf] of [...half].map(([rf, yf]) => [rf, -yf] as [number, number])) prof.push(new THREE.Vector2(w.r * rf, hw * yf));
    for (const c of [-0.62, -0.22, 0.22, 0.62]) {
      const gw = 0.045;
      prof.push(new THREE.Vector2(w.r, hw * (c - gw - 0.015)), new THREE.Vector2(w.r - 0.011, hw * (c - gw)), new THREE.Vector2(w.r - 0.011, hw * (c + gw)), new THREE.Vector2(w.r, hw * (c + gw + 0.015)));
    }
    for (const [rf, yf] of [...half].reverse()) prof.push(new THREE.Vector2(w.r * rf, hw * yf));
    const tire = new THREE.Mesh(new THREE.LatheGeometry(prof, 56), new THREE.MeshStandardMaterial({ color: "#0c0c0e", roughness: 0.85, side: THREE.DoubleSide }));
    g.add(tire);
    const face = new THREE.MeshStandardMaterial({ map: w.front ? wheelTexFront : wheelTexRear, roughness: 0.8, transparent: true, alphaTest: 0.35 });
    for (const sg of [-1, 1]) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(w.r * 0.9, 56), face);
      disc.rotation.x = sg > 0 ? -Math.PI / 2 : Math.PI / 2;
      disc.rotation.z = sg > 0 ? Math.PI : 0;
      disc.position.y = sg * hw * 0.99;
      g.add(disc);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(w.r * 0.6, 0.011, 8, 56), lipMat);
      lip.rotation.x = Math.PI / 2;
      lip.position.y = sg * hw * 0.99;
      g.add(lip);
      // brake disc + caliper seen through the spokes
      const bd = new THREE.Mesh(new THREE.CylinderGeometry(w.r * 0.46, w.r * 0.46, 0.022, 40), brakeMat);
      bd.position.y = sg * hw * 0.5;
      g.add(bd);
      const cal = box(0.1, 0.05, 0.09, w.front ? 0.0 : 0.0, sg * hw * 0.5, w.r * 0.36, caliperMat);
      g.add(cal);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(w.r * 0.15, w.r * 0.15, w.width * 1.02, 16), new THREE.MeshStandardMaterial({ color: "#2a2b30", roughness: 0.5, metalness: 0.7 }));
    g.add(hub);
    g.position.set(w.x, w.y, w.r);
    group.add(g);
    const b = bodyAt(w.x);
    const sg = Math.sign(w.y);
    const inner = new THREE.Vector3(w.x, w.y - sg * w.width * 0.5, w.r);
    group.add(rod(inner, new THREE.Vector3(w.x + 0.12, sg * b.w * 0.8, b.zc + 0.05), 0.012, metal));
    group.add(rod(inner, new THREE.Vector3(w.x - 0.14, sg * b.w * 0.8, b.zc - 0.02), 0.012, metal));
  }
  void frontAxleX;

  // ---- retro details: airbox intake, exhausts, tail light, mirrors, blob shadow ----
  {
    const dark = new THREE.MeshStandardMaterial({ color: "#17121a", roughness: 0.9 });
    const L = d.body.length;
    const up = (u: number) => evalCurve(d.body.sideUpper, u);
    const lo = (u: number) => evalCurve(d.body.sideLower, u);
    const hw = (u: number) => Math.max(0.02, evalCurve(d.body.planHalf, u));
    // airbox intake on the front of the engine cover
    const ai = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), dark);
    ai.scale.set(0.05, 0.12, 0.11);
    ai.position.set(L * (1 - 0.545), 0, up(0.56) - 0.07);
    group.add(ai);
    // twin exhausts poking out of the tail
    for (const sg of [-1, 1]) {
      const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.2, 14), new THREE.MeshStandardMaterial({ color: "#2b2b30", roughness: 0.4, metalness: 0.7 }));
      ex.rotation.z = Math.PI / 2;
      ex.position.set(-0.04, sg * 0.075, (up(0.99) + lo(0.99)) / 2 + 0.02);
      group.add(ex);
    }
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: "#ff3030" }));
    tl.position.set(0.0, 0, (up(0.99) + lo(0.99)) / 2 + 0.12);
    group.add(tl);
    // mirrors
    for (const sg of [-1, 1]) {
      const uM = 0.34;
      const x = L * (1 - uM);
      const y = sg * (hw(uM) + 0.1);
      const z = up(uM) + 0.1;
      const stalk = rod(new THREE.Vector3(x, sg * hw(uM) * 0.9, z - 0.06), new THREE.Vector3(x, y, z), 0.012, metal);
      group.add(stalk);
      const mir = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.06), new THREE.MeshStandardMaterial({ color: d.livery.primary, roughness: 0.4 }));
      mir.position.set(x, y + sg * 0.005, z);
      group.add(mir);
    }
    // cartoon drop shadow
    const sc = document.createElement("canvas");
    sc.width = sc.height = 128;
    const sg2 = sc.getContext("2d")!;
    const grad = sg2.createRadialGradient(64, 64, 6, 64, 64, 62);
    grad.addColorStop(0, "rgba(0,0,0,0.55)");
    grad.addColorStop(0.7, "rgba(0,0,0,0.3)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    sg2.fillStyle = grad;
    sg2.fillRect(0, 0, 128, 128);
    const stex = new THREE.CanvasTexture(sc);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(overallLength(d) + 1.4, 2.5), new THREE.MeshBasicMaterial({ map: stex, transparent: true, depthWrite: false, toneMapped: false }));
    shadow.position.set(overallLength(d) / 2 - 0.2, 0, 0.012);
    shadow.renderOrder = -1;
    shadow.userData.noInk = true;
    group.add(shadow);
  }

  // driver: cockpit opening, helmet + halo
  {
    const uc = 0.46;
    const cock = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshStandardMaterial({ color: "#16101a", roughness: 0.9 }));
    cock.scale.set(0.42, 0.2, 0.09);
    cock.position.set(d.body.length * (1 - uc) + 0.02, 0, evalCurve(d.body.sideUpper, uc) + 0.0);
    group.add(cock);
  }
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

  const lm = liveryMap(d);
  const liv = { value: 1 };
  body.userData.liv = liv;
  toonify(group, body, lm, liv);
  return {
    group,
    body,
    bodyGeom,
    dispose: () => {
      lm.texR.dispose();
      lm.texL.dispose();
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        ((mat as THREE.MeshStandardMaterial | undefined)?.map)?.dispose?.();
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
    },
  };
}
