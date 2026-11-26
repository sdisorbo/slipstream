"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { CarDesign } from "@/lib/car/types";
import { defaultDesign } from "@/lib/car/defaults";
import { buildCar, type CarBuild } from "@/lib/car/geometry";
import { performance } from "@/lib/car/aero";
import { ovalTrack, type Track } from "@/lib/sim/track";
import { DT, initState, quantize, step, vehicleParams, type VState } from "@/lib/sim/vehicle";
import { ControlState, Pedal, Wheel } from "./Controls";

const DESIGN_KEY = "apex.design.v1";
const DAMAGE_KEY = "apex.damage.v1";
const SIDE_KEY = "apex.wheelSide";
const TOO_DAMAGED = 70;

const fmt = (t: number | null) => {
  if (t === null) return "–:––.–––";
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(3).padStart(6, "0")}`;
};

interface Hud {
  kph: number;
  cur: number | null;
  last: number | null;
  best: number | null;
  laps: number;
  gLat: number;
  gLon: number;
  fuel: number;
  wear: number;
  damage: number;
  drs: number;
  off: boolean;
  hit: number;
  x: number;
  y: number;
  gear: number;
}
const HUD0: Hud = { kph: 0, cur: null, last: null, best: null, laps: 0, gLat: 0, gLon: 0, fuel: 0, wear: 0, damage: 0, drs: 0, off: false, hit: 0, x: 0, y: 0, gear: 1 };

function trackMeshes(t: Track): THREE.Group {
  const g = new THREE.Group();
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
  const strip = (o0: number, o1: number, z: number, colorOf: (i: number) => THREE.Color) => {
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      const c = colorOf(i);
      pos.push(t.px[k] + nrm[k][0] * o0, t.py[k] + nrm[k][1] * o0, z, t.px[k] + nrm[k][0] * o1, t.py[k] + nrm[k][1] * o1, z);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
  };
  const hw = t.halfWidth;
  const asphalt = new THREE.Color("#2b2b31");
  const asphalt2 = new THREE.Color("#2f2f36");
  g.add(strip(-hw, hw, 0.0, (i) => (Math.floor(i / 4) % 2 ? asphalt : asphalt2)));
  const red = new THREE.Color("#a20623");
  const white = new THREE.Color("#d8d8dc");
  const curb = (i: number) => (Math.floor(i / 1) % 2 ? red : white);
  g.add(strip(hw, hw + 1.4, 0.01, curb));
  g.add(strip(-hw - 1.4, -hw, 0.01, curb));
  const gravel = new THREE.Color("#3a3a40");
  g.add(strip(hw + 1.4, t.wallOffset, 0.005, () => gravel));
  g.add(strip(-t.wallOffset, -hw - 1.4, 0.005, () => gravel));
  // walls
  for (const side of [-1, 1]) {
    const pos: number[] = [];
    const idx: number[] = [];
    const col: number[] = [];
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      const o = side * t.wallOffset;
      const x = t.px[k] + nrm[k][0] * o;
      const y = t.py[k] + nrm[k][1] * o;
      pos.push(x, y, 0, x, y, 1.3);
      const c = Math.floor(i / 6) % 2 ? red : white;
      col.push(c.r, c.g, c.b, c.r * 0.6, c.g * 0.6, c.b * 0.6);
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide })));
  }
  // start / finish
  const lineGeo = new THREE.PlaneGeometry(2.2, hw * 2);
  const line = new THREE.Mesh(lineGeo, new THREE.MeshStandardMaterial({ color: "#ececef", roughness: 0.7 }));
  line.position.set(t.px[0], t.py[0], 0.02);
  g.add(line);
  // gantry
  const post = new THREE.MeshStandardMaterial({ color: "#16161a", roughness: 0.5, metalness: 0.4 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, hw * 2 + 3, 0.8), post);
  bar.position.set(t.px[0], t.py[0], 7);
  g.add(bar);
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 7), post);
    p.position.set(t.px[0], t.py[0] + s * (hw + 1.4), 3.5);
    g.add(p);
  }
  const strip2 = new THREE.Mesh(new THREE.BoxGeometry(1.25, hw * 2 + 3, 0.2), new THREE.MeshBasicMaterial({ color: "#e0284f" }));
  strip2.position.set(t.px[0], t.py[0], 7.5);
  g.add(strip2);
  return g;
}

export default function PracticeRoom({ onBack }: { onBack: () => void }) {
  const mount = useRef<HTMLDivElement>(null);
  const [ctl] = useState(() => new ControlState());
  const track = useMemo(() => ovalTrack(), []);
  const [design, setDesign] = useState<CarDesign | null>(null);
  const [hud, setHud] = useState<Hud>(HUD0);
  const [wheelLeft, setWheelLeft] = useState(true);
  const [camMode, setCamMode] = useState<"chase" | "side" | "high">("chase");
  const [damage0, setDamage0] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const blockedRef = useRef(blocked);
  const camRef = useRef<"chase" | "side" | "high">("chase");
  const resetRef = useRef<() => void>(() => {});
  const repairRef = useRef<() => void>(() => {});

  useEffect(() => {
    let d = defaultDesign();
    try {
      const raw = localStorage.getItem(DESIGN_KEY);
      if (raw) d = { ...d, ...JSON.parse(raw) };
    } catch {}
    setDesign(d);
    const dm = Number(localStorage.getItem(DAMAGE_KEY) ?? 0) || 0;
    setDamage0(dm);
    setBlocked(dm > TOO_DAMAGED);
    setWheelLeft(localStorage.getItem(SIDE_KEY) !== "right");
  }, []);
  useEffect(() => {
    camRef.current = camMode;
    blockedRef.current = blocked;
  }, [camMode, blocked]);

  const perf = useMemo(() => (design ? performance(design, 70, 0, false) : null), [design]);

  useEffect(() => {
    if (!design || !mount.current) return;
    const host = mount.current;
    const params = vehicleParams(design);
    let st: VState = initState(params, track);
    st.damage = damage0;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0b0b0e");
    scene.fog = new THREE.Fog("#0b0b0e", 120, 900);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 3000);
    camera.up.set(0, 0, 1);
    const sun = new THREE.DirectionalLight("#ffffff", 1.6);
    sun.position.set(300, -200, 500);
    scene.add(sun);
    scene.add(new THREE.HemisphereLight("#9aa0b8", "#15151a", 0.5));

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: "#16191a", roughness: 1 }));
    ground.position.z = -0.05;
    scene.add(ground);
    const trackGroup = trackMeshes(track);
    scene.add(trackGroup);

    const builds: CarBuild[] = [buildCar(design, false), buildCar(design, true)];
    const root = new THREE.Group();
    const tilt = new THREE.Group();
    root.add(tilt);
    for (const b of builds) {
      b.group.position.x = -params.cgX;
      tilt.add(b.group);
    }
    builds[1].group.visible = false;
    scene.add(root);


    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    // keyboard
    const kc = ctl;
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["arrowleft", "arrowright", "arrowup", "arrowdown", " "].includes(k)) e.preventDefault();
      if (k === "r" && !e.repeat) resetRef.current();
      if (k === "c" && !e.repeat) setCamMode((m) => (m === "chase" ? "side" : m === "side" ? "high" : "chase"));
      kc.keys.add(k);
    };
    const up = (e: KeyboardEvent) => kc.keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);

    resetRef.current = () => {
      const dm = st.damage;
      const best = st.laps.length ? Math.min(...st.laps) : null;
      st = initState(params, track);
      st.damage = dm;
      if (best !== null) st.laps = [best]; // keep your best across resets
      st.lapStart = null;
    };
    repairRef.current = () => {
      st.damage = 0;
      localStorage.setItem(DAMAGE_KEY, "0");
      setBlocked(false);
      resetRef.current();
    };

    const campos = new THREE.Vector3(st.x - 12, st.y, 4);
    let raf = 0;
    let last = performance_now();
    let acc = 0;
    let frame = 0;
    let lastSave = 0;
    let bestLap: number | null = null;
    let shake = 0;

    function performance_now() {
      return window.performance.now() / 1000;
    }

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance_now();
      const dt = Math.min(0.1, now - last);
      last = now;

      // --- controls ---
      const c = kc;
      const kLeft = c.keys.has("arrowleft") || c.keys.has("a");
      const kRight = c.keys.has("arrowright") || c.keys.has("d");
      const kTarget = (kLeft ? 1 : 0) - (kRight ? 1 : 0);
      const rate = kTarget === 0 ? 6 : 3;
      c.keySteer += Math.max(-rate * dt, Math.min(rate * dt, kTarget - c.keySteer));
      const steer = c.touchSteer ?? c.keySteer;
      const gas = c.touchGas ?? (c.keys.has("arrowup") || c.keys.has("w") ? 1 : 0);
      const brake = c.touchBrake ?? (c.keys.has("arrowdown") || c.keys.has("s") || c.keys.has(" ") ? 1 : 0);
      c.out.steer = steer;
      c.out.gas = gas;
      c.out.brake = brake;

      // --- fixed-step sim ---
      const input = quantize(steer, gas, brake);
      const live = !blockedRef.current;
      acc += dt;
      while (acc >= DT) {
        if (live) step(params, st, input, track);
        acc -= DT;
        if (st.hit > 0) shake = Math.max(shake, Math.min(1, st.hit / 20));
      }
      if (st.laps.length) bestLap = Math.min(...st.laps);

      // --- render ---
      root.position.set(st.x, st.y, 0);
      root.rotation.z = Math.atan2(st.hy, st.hx);
      tilt.rotation.x = Math.max(-0.05, Math.min(0.05, st.ay * 0.0012));
      tilt.rotation.y = Math.max(-0.04, Math.min(0.04, -st.ax * 0.0008));
      const straight = st.drs > 0.5;
      const sideCam = camRef.current === "side";
      builds[0].group.visible = !straight && !sideCam;
      builds[1].group.visible = straight && !sideCam;

      const speedBack = 8.5 + st.u * 0.03;
      let tx: number;
      let ty: number;
      let tz: number;
      if (sideCam) {
        tx = st.x + st.hy * 11 + st.hx * 1.5;
        ty = st.y - st.hx * 11 + st.hy * 1.5;
        tz = 1.5;
      } else if (camRef.current === "chase") {
        tx = st.x - st.hx * speedBack;
        ty = st.y - st.hy * speedBack;
        tz = 2.7 + st.u * 0.005;
      } else {
        tx = st.x - st.hx * 6;
        ty = st.y - st.hy * 6;
        tz = 70;
      }
      const k = 1 - Math.exp(-dt * (sideCam ? 14 : camRef.current === "chase" ? 6 : 4));
      campos.x += (tx - campos.x) * k;
      campos.y += (ty - campos.y) * k;
      campos.z += (tz - campos.z) * k;
      shake *= Math.exp(-dt * 6);
      camera.position.set(campos.x + (Math.random() - 0.5) * shake, campos.y + (Math.random() - 0.5) * shake, campos.z);
      camera.fov = sideCam ? 34 : 62 + Math.min(14, st.u * 0.07);
      camera.updateProjectionMatrix();
      camera.lookAt(st.x + st.hx * (camRef.current === "chase" ? 9 : 0), st.y + st.hy * (camRef.current === "chase" ? 9 : 0), sideCam ? 0.7 : 0.8);
      renderer.render(scene, camera);

      // --- HUD ---
      if (frame++ % 4 === 0) {
        setHud({
          kph: Math.max(0, st.u * 3.6),
          cur: st.lapStart === null ? null : st.t - st.lapStart,
          last: st.laps.length ? st.laps[st.laps.length - 1] : null,
          best: bestLap,
          laps: st.laps.length,
          gLat: st.ay / 9.81,
          gLon: st.ax / 9.81,
          fuel: st.fuel,
          wear: st.wear,
          damage: st.damage,
          drs: st.drs,
          off: st.offTrack,
          hit: shake,
          x: st.x,
          y: st.y,
          gear: Math.max(1, Math.min(8, 1 + Math.floor((st.u * 3.6) / 38))),
        });
      }
      if (now - lastSave > 1) {
        lastSave = now;
        localStorage.setItem(DAMAGE_KEY, String(Math.round(st.damage * 10) / 10));
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      localStorage.setItem(DAMAGE_KEY, String(Math.round(st.damage * 10) / 10));
      builds.forEach((b) => b.dispose());
      pm.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, [design, track, damage0, ctl]);

  const toggleSide = () => {
    setWheelLeft((v) => {
      localStorage.setItem(SIDE_KEY, v ? "right" : "left");
      return !v;
    });
  };

  const bounds = useMemo(() => {
    const xs = track.px;
    const ys = track.py;
    const x0 = Math.min(...xs) - 30;
    const x1 = Math.max(...xs) + 30;
    const y0 = Math.min(...ys) - 30;
    const y1 = Math.max(...ys) + 30;
    const d = track.px.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)} ${(-track.py[i]).toFixed(1)}`).join("") + "Z";
    return { x0, y0: -y1, w: x1 - x0, h: y1 - y0, d };
  }, [track]);

  const dmgCol = hud.damage > TOO_DAMAGED ? "text-redhi" : hud.damage > 35 ? "text-warn" : "text-good";

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-bg text-ink">
      <div ref={mount} className="absolute inset-0" />

      {/* top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
        <div className="pointer-events-auto flex items-center gap-2">
          <button onClick={onBack} className="rounded-md border border-line bg-panel/80 px-3 py-1.5 text-[13px] backdrop-blur hover:border-red">
            ← Design room
          </button>
          <button onClick={() => resetRef.current()} className="rounded-md border border-line bg-panel/80 px-3 py-1.5 text-[13px] backdrop-blur hover:border-red">
            Restart lap <span className="ml-1 text-muted">R</span>
          </button>
          <button onClick={() => setCamMode((m) => (m === "chase" ? "side" : m === "side" ? "high" : "chase"))} className="rounded-md border border-line bg-panel/80 px-3 py-1.5 text-[13px] backdrop-blur hover:border-red">
            Camera: {camMode} <span className="ml-1 text-muted">C</span>
          </button>
          <button onClick={toggleSide} className="rounded-md border border-line bg-panel/80 px-3 py-1.5 text-[13px] backdrop-blur hover:border-red">
            Wheel: {wheelLeft ? "left" : "right"}
          </button>
        </div>

        <div className="rounded-lg border border-line bg-panel/80 p-3 backdrop-blur">
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted">{track.name} · {Math.round(track.length)} m</div>
          <svg viewBox={`${bounds.x0} ${bounds.y0} ${bounds.w} ${bounds.h}`} className="mt-1 h-24 w-44">
            <path d={bounds.d} fill="none" stroke="#3a3a42" strokeWidth="20" strokeLinejoin="round" />
            <path d={bounds.d} fill="none" stroke="#1a1a1e" strokeWidth="12" strokeLinejoin="round" />
            <line x1={track.px[0]} x2={track.px[0]} y1={-track.py[0] - 12} y2={-track.py[0] + 12} stroke="#ececef" strokeWidth="5" />
            <circle cx={hud.x} cy={-hud.y} r="16" fill="#e0284f" stroke="#fff" strokeWidth="4" />
          </svg>
        </div>
      </div>

      {/* timing */}
      <div className="pointer-events-none absolute left-3 top-16 w-56 rounded-lg border border-line bg-panel/80 p-3 font-mono backdrop-blur">
        <div className="text-[10px] uppercase tracking-[0.16em] text-muted">Lap {hud.laps + 1}</div>
        <div className="text-[28px] leading-8">{fmt(hud.cur)}</div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 text-[12px]">
          <span className="text-muted">Last</span>
          <span className="text-right">{fmt(hud.last)}</span>
          <span className="text-muted">Best</span>
          <span className="text-right text-good">{fmt(hud.best)}</span>
        </div>
        <div className="mt-2 text-[11px] text-muted">{hud.cur === null ? "Cross the line to start timing" : hud.off ? "Off track — lap slowed" : "Timing"}</div>
      </div>

      {/* speed + status */}
      <div className="pointer-events-none absolute top-14 left-1/2 w-64 -translate-x-1/2 text-center font-mono">
        <div className="text-[56px] font-semibold leading-none tracking-tight">{Math.round(hud.kph)}</div>
        <div className="text-[11px] uppercase tracking-[0.2em] text-muted">km/h · gear {hud.gear}</div>
        <div className="mt-3 flex justify-center gap-2 text-[11px]">
          <span className={`rounded px-2 py-0.5 ${hud.drs > 0.5 ? "bg-good/20 text-good" : "bg-panel2 text-muted"}`}>{hud.drs > 0.5 ? "STRAIGHT AERO" : "CORNER AERO"}</span>
          <span className="rounded bg-panel2 px-2 py-0.5 text-muted">{hud.gLat >= 0 ? "◀" : "▶"} {Math.abs(hud.gLat).toFixed(1)} g</span>
        </div>
      </div>

      <div className="pointer-events-none absolute right-3 top-44 w-44 rounded-lg border border-line bg-panel/80 p-3 text-[12px] backdrop-blur">
        {[
          ["Fuel", `${hud.fuel.toFixed(1)} kg`, "text-ink"],
          ["Tyres", `${Math.round((1 - hud.wear) * 100)} %`, hud.wear > 0.6 ? "text-warn" : "text-ink"],
          ["Damage", `${Math.round(hud.damage)} %`, dmgCol],
        ].map(([k, v, c]) => (
          <div key={k} className="flex justify-between py-0.5">
            <span className="text-muted">{k}</span>
            <span className={`font-mono ${c}`}>{v}</span>
          </div>
        ))}
        {perf && !perf.legal && <div className="mt-2 text-[11px] text-warn">Car is not race-legal — fine for practice.</div>}
      </div>

      {/* controls */}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between p-4" style={{ flexDirection: wheelLeft ? "row" : "row-reverse" }}>
        <Wheel ctl={ctl} />
        <div className="flex items-end gap-3">
          <Pedal ctl={ctl} kind="brake" height={96} width={58} />
          <Pedal ctl={ctl} kind="gas" height={150} width={74} />
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 text-[11px] text-muted">
        Keys: ← → steer · ↑ gas · ↓ brake · release gas = regenerative braking
      </div>

      {hud.hit > 0.15 && <div className="pointer-events-none absolute inset-0" style={{ boxShadow: `inset 0 0 120px rgba(224,40,79,${Math.min(0.6, hud.hit)})` }} />}

      {blocked && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70">
          <div className="max-w-sm rounded-xl border border-line bg-panel p-6 text-center">
            <div className="text-lg font-semibold">Car too damaged to run</div>
            <p className="mt-2 text-[13px] text-muted">Damage is at {Math.round(damage0)}%. Practice is closed above {TOO_DAMAGED}%. Repairs will cost money and time once the economy exists; for now they are free.</p>
            <button onClick={() => repairRef.current()} className="mt-4 rounded-md bg-red px-4 py-2 text-[13px] font-medium hover:bg-redhi">
              Repair car
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
