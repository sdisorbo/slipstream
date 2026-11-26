import * as THREE from "three";
import type { Track } from "@/lib/sim/track";

// Arcade-stadium dressing for a track: striped grass, asphalt, kerbs, banner walls, packed grandstands.

const rnd = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

function tex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = true): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const asphaltTex = () =>
  tex(256, 256, (g) => {
    const r = rnd(7);
    g.fillStyle = "#5d5d64";
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      const l = 70 + r() * 50;
      g.fillStyle = `rgba(${l},${l},${l + 6},${0.35 + r() * 0.3})`;
      g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2);
    }
    // rubbered-in racing lines
    for (const v of [70, 96, 160, 186]) {
      g.fillStyle = "rgba(20,20,26,0.18)";
      g.fillRect(0, v, 256, 10 + r() * 8);
    }
  });

const grassTex = () =>
  tex(256, 256, (g) => {
    g.fillStyle = "#3da535";
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = "#47b83d";
    g.fillRect(0, 0, 128, 256);
    const r = rnd(3);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(255,255,255,${r() * 0.05})`;
      g.fillRect(r() * 256, r() * 256, 2, 2);
    }
  });

const crowdTex = () =>
  tex(1024, 256, (g) => {
    const r = rnd(11);
    g.fillStyle = "#3b3b42";
    g.fillRect(0, 0, 1024, 256);
    const pal = ["#d9202b", "#f4f4f6", "#2f6fe0", "#f4c20d", "#2fb45a", "#18181c", "#e87d1e", "#9b4fd1"];
    const rows = 16;
    for (let y = 0; y < rows; y++) {
      const ry = (y / rows) * 256;
      g.fillStyle = y % 2 ? "#4a4a52" : "#44444b";
      g.fillRect(0, ry, 1024, 256 / rows);
      g.fillStyle = "rgba(255,255,255,0.14)";
      g.fillRect(0, ry, 1024, 2);
      for (let x = 0; x < 1024; x += 9) {
        if (r() < 0.12) continue;
        g.fillStyle = pal[Math.floor(r() * pal.length)];
        g.beginPath();
        g.arc(x + 4 + (r() - 0.5) * 2, ry + 8, 3.6, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "rgba(0,0,0,0.25)";
        g.fillRect(x + 1, ry + 11, 7, 4);
      }
    }
    // vertical aisles
    for (let x = 0; x < 1024; x += 128) {
      g.fillStyle = "#2a2a30";
      g.fillRect(x, 0, 6, 256);
    }
  });

const bannerTex = () =>
  tex(1024, 128, (g) => {
    const names = ["KESTREL", "TREADCO", "VOLT", "MERIDIAN", "ORBIT", "NOVA OIL"];
    const cols = ["#d9202b", "#f4f4f6", "#2f6fe0", "#f4c20d", "#18181c", "#2fb45a"];
    const w = 1024 / names.length;
    names.forEach((n, i) => {
      g.fillStyle = cols[i];
      g.fillRect(i * w, 0, w, 128);
      g.fillStyle = cols[i] === "#f4f4f6" || cols[i] === "#f4c20d" ? "#18181c" : "#ffffff";
      g.font = "900 54px Impact, Arial Black, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(n, i * w + w / 2, 68);
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.fillRect(i * w, 0, 4, 128);
    });
  });

const checkerTex = () =>
  tex(256, 128, (g) => {
    const n = 8;
    const s = 256 / n;
    for (let y = 0; y < 4; y++) for (let x = 0; x < n; x++) {
      g.fillStyle = (x + y) % 2 ? "#18181c" : "#f4f4f6";
      g.fillRect(x * s, y * s, s, s);
    }
  }, false);

export function buildStadium(t: Track): THREE.Group {
  const root = new THREE.Group();
  const n = t.n;
  const nrm: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n;
    const b = (i + 1) % n;
    let dx = t.px[b] - t.px[a];
    let dy = t.py[b] - t.py[a];
    const l = Math.hypot(dx, dy);
    dx /= l;
    dy /= l;
    nrm.push([-dy, dx]);
  }
  // a ribbon along the track between two lateral offsets (and heights), UV'd by arc length
  const ribbon = (o0: number, z0: number, o1: number, z1: number, uLen: number, mat: THREE.Material, vS = 1) => {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      const u = t.cum[i] / uLen;
      pos.push(t.px[k] + nrm[k][0] * o0, t.py[k] + nrm[k][1] * o0, z0, t.px[k] + nrm[k][0] * o1, t.py[k] + nrm[k][1] * o1, z1);
      uv.push(u, 0, u, vS);
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat);
  };
  const flat = (color: string) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  const lam = (m: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, ...m });
  const hw = t.halfWidth;

  // grass
  const gt = grassTex();
  gt.repeat.set(6000 / 40, 6000 / 40);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshLambertMaterial({ map: gt }));
  ground.position.z = -0.06;
  root.add(ground);

  // asphalt + lane markings
  const at = asphaltTex();
  at.repeat.set(1, 1);
  root.add(ribbon(-hw, 0, hw, 0, 32, lam({ map: at })));
  const white = flat("#ececf0");
  const yellow = flat("#f2c418");
  const mark = (a: number, b: number, m: THREE.Material) => {
    const r = ribbon(a, 0.015, b, 0.015, 1, m);
    root.add(r);
  };
  mark(-hw + 0.3, -hw + 0.8, white);
  mark(hw - 0.8, hw - 0.3, white);
  mark(hw - 3.4, hw - 2.9, yellow);
  mark(hw - 2.3, hw - 1.8, yellow);

  // aprons + kerbs
  root.add(ribbon(hw, 0.005, hw + 5.5, 0.005, 1, flat("#6e6e75")));
  root.add(ribbon(-hw - 5.5, 0.005, -hw, 0.005, 1, flat("#6e6e75")));
  const kerb = (side: 1 | -1) => {
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const red = new THREE.Color("#d9202b");
    const wh = new THREE.Color("#f4f4f6");
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      const c = i % 2 ? red : wh;
      const o0 = side * hw;
      const o1 = side * (hw + 1.5);
      pos.push(t.px[k] + nrm[k][0] * o0, t.py[k] + nrm[k][1] * o0, 0.02, t.px[k] + nrm[k][0] * o1, t.py[k] + nrm[k][1] * o1, 0.02);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  };
  root.add(kerb(1), kerb(-1));

  // walls: low white inner wall, tall banner outer wall, then the grandstands
  const W = t.wallOffset;
  const bt = bannerTex();
  bt.repeat.set(1, 1);
  root.add(ribbon(W, 0, W, 1.1, 24, flat("#e9e9ee")));
  root.add(ribbon(W, 1.1, W - 0.01, 1.1, 1, flat("#d9202b")));
  const outer = ribbon(-W, 0, -W, 2.6, 80, lam({ map: bt }));
  root.add(outer);
  root.add(ribbon(-W, 2.6, -W - 1.2, 2.6, 1, flat("#f4f4f6")));
  const ct = crowdTex();
  const stand = ribbon(-W - 2, 3, -W - 34, 22, 70, new THREE.MeshBasicMaterial({ map: ct, side: THREE.DoubleSide }), 3);
  root.add(stand);
  root.add(ribbon(-W - 34, 22, -W - 38, 24, 1, flat("#202026")));
  root.add(ribbon(-W - 2, 3, -W - 2, 0, 1, flat("#2a2a30")));
  // infield side: a second low stand of tents/seating so the middle isn't empty
  const stand2 = ribbon(W + 3, 0.2, W + 12, 4.5, 70, new THREE.MeshBasicMaterial({ map: ct, side: THREE.DoubleSide }), 1);
  root.add(stand2);

  // start / finish
  const dx = t.px[1] - t.px[0];
  const dy = t.py[1] - t.py[0];
  const ang = Math.atan2(dy, dx);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(3.6, hw * 2), new THREE.MeshBasicMaterial({ map: checkerTex() }));
  line.position.set(t.px[0], t.py[0], 0.03);
  line.rotation.z = ang;
  root.add(line);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.0, hw * 2 + 6, 0.9), new THREE.MeshLambertMaterial({ color: "#1d1d22" }));
  bar.position.set(t.px[0], t.py[0], 7);
  bar.rotation.z = ang;
  root.add(bar);
  const banner = new THREE.Mesh(new THREE.BoxGeometry(1.05, hw * 2 + 6, 0.4), new THREE.MeshBasicMaterial({ map: checkerTex() }));
  banner.position.set(t.px[0], t.py[0], 7.7);
  banner.rotation.z = ang;
  root.add(banner);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 7), new THREE.MeshLambertMaterial({ color: "#1d1d22" }));
    const ox = -Math.sin(ang) * s * (hw + 2.5);
    const oy = Math.cos(ang) * s * (hw + 2.5);
    post.position.set(t.px[0] + ox, t.py[0] + oy, 3.5);
    post.rotation.z = ang;
    root.add(post);
  }
  return root;
}

// ---- particles: smoke, dust, sparks, fire ----
type Kind = "smoke" | "dark" | "dust" | "spark" | "fire";
interface P {
  s: THREE.Sprite;
  live: boolean;
  age: number;
  life: number;
  v: THREE.Vector3;
  s0: number;
  s1: number;
  op: number;
  drag: number;
}

export class Fx {
  private pool: P[] = [];
  private tex: THREE.Texture;
  constructor(scene: THREE.Scene, count = 140) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.55, "rgba(255,255,255,0.65)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    this.tex = new THREE.CanvasTexture(c);
    for (let i = 0; i < count; i++) {
      const m = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(m);
      s.visible = false;
      scene.add(s);
      this.pool.push({ s, live: false, age: 0, life: 1, v: new THREE.Vector3(), s0: 1, s1: 1, op: 1, drag: 1 });
    }
  }
  emit(kind: Kind, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number) {
    const p = this.pool.find((q) => !q.live);
    if (!p) return;
    p.live = true;
    p.age = 0;
    p.v.set(vx, vy, vz);
    const m = p.s.material as THREE.SpriteMaterial;
    m.blending = kind === "spark" || kind === "fire" ? THREE.AdditiveBlending : THREE.NormalBlending;
    m.color.set(kind === "smoke" ? "#f2f2f4" : kind === "dark" ? "#2b2b30" : kind === "dust" ? "#c9b27d" : kind === "spark" ? "#ffb347" : "#ff7a18");
    p.life = kind === "spark" ? 0.35 + Math.random() * 0.25 : kind === "fire" ? 0.45 : 0.9 + Math.random() * 0.6;
    p.s0 = size * (kind === "spark" ? 0.25 : 0.6);
    p.s1 = size * (kind === "spark" ? 0.1 : kind === "fire" ? 1.1 : 2.4);
    p.op = kind === "spark" || kind === "fire" ? 1 : kind === "dark" ? 0.75 : 0.6;
    p.drag = kind === "spark" ? 0.5 : 2.2;
    p.s.position.set(x, y, z);
    p.s.visible = true;
  }
  update(dt: number) {
    for (const p of this.pool) {
      if (!p.live) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.live = false;
        p.s.visible = false;
        continue;
      }
      const f = p.age / p.life;
      p.v.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.s.position.addScaledVector(p.v, dt);
      const sz = p.s0 + (p.s1 - p.s0) * f;
      p.s.scale.set(sz, sz, 1);
      (p.s.material as THREE.SpriteMaterial).opacity = p.op * (1 - f) * (1 - f);
    }
  }
  dispose() {
    for (const p of this.pool) (p.s.material as THREE.Material).dispose();
    this.tex.dispose();
  }
}
