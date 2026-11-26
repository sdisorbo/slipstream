"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { CarDesign } from "@/lib/car/types";
import { defaultDesign } from "@/lib/car/defaults";
import { buildCar, type CarBuild } from "@/lib/car/geometry";
import { performance } from "@/lib/car/aero";
import { ovalTrack } from "@/lib/sim/track";
import { DT, initState, quantize, step, vehicleParams, type VState } from "@/lib/sim/vehicle";
import { ControlState, Pedal, Wheel } from "./Controls";
import { Fx, buildStadium } from "./stadium";

const DESIGN_KEY = "apex.design.v1";
const DAMAGE_KEY = "apex.damage.v1";
const SIDE_KEY = "apex.wheelSide";
const TOO_DAMAGED = 70;

type Cam = "bird" | "follow" | "chase";
const CAMS: Cam[] = ["bird", "follow", "chase"];
const CAM_LABEL: Record<Cam, string> = { bird: "Bird's eye", follow: "Rotating", chase: "Chase" };
const CAR_SCALE = 1.5; // slight cartoon exaggeration over true scale (1.0)

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
const HUD0: Hud = { kph: 0, cur: null, last: null, best: null, laps: 0, gLat: 0, fuel: 0, wear: 0, damage: 0, drs: 0, off: false, hit: 0, x: 0, y: 0, gear: 1 };

function useViewport() {
  const [vp, setVp] = useState({ w: 1280, h: 720 });
  useEffect(() => {
    const f = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    f();
    window.addEventListener("resize", f);
    window.addEventListener("orientationchange", f);
    return () => {
      window.removeEventListener("resize", f);
      window.removeEventListener("orientationchange", f);
    };
  }, []);
  return vp;
}

const metal = "border border-white/10 bg-[linear-gradient(180deg,#34343a_0%,#1b1b1f_55%,#111114_100%)] shadow-[0_2px_8px_rgba(0,0,0,.55)]";

function Bar({ label, v, col }: { label: string; v: number; col: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-3 text-[9px] font-bold text-white/60">{label}</span>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-black/60 sm:w-20">
        <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%`, background: col }} />
      </span>
    </div>
  );
}

function IconBtn({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className={`${metal} flex h-9 w-9 items-center justify-center rounded-full text-[17px] active:scale-95`}>
      {icon}
    </button>
  );
}

export default function PracticeRoom({ onBack }: { onBack: () => void }) {
  const mount = useRef<HTMLDivElement>(null);
  const [ctl] = useState(() => new ControlState());
  const track = useMemo(() => ovalTrack(), []);
  const vp = useViewport();
  const [design, setDesign] = useState<CarDesign | null>(null);
  const [hud, setHud] = useState<Hud>(HUD0);
  const [wheelLeft, setWheelLeft] = useState(true);
  const [cam, setCam] = useState<Cam>("bird");
  const [damage0, setDamage0] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const portrait = vp.h > vp.w && vp.w < 900;
  const pausedRef = useRef(false);
  const camRef = useRef<Cam>("bird");
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
    camRef.current = cam;
    pausedRef.current = blocked || portrait;
  }, [cam, blocked, portrait]);

  const perf = useMemo(() => (design ? performance(design, 70, 0, false) : null), [design]);
  const restart = () => resetRef.current();
  const nextCam = () => setCam((c) => CAMS[(CAMS.indexOf(c) + 1) % CAMS.length]);

  useEffect(() => {
    if (!design || !mount.current) return;
    const host = mount.current;
    const params = vehicleParams(design);
    let st: VState = initState(params, track);
    st.damage = damage0;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#a9bfd4");
    const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 3000);
    camera.up.set(0, 0, 1);
    const sun = new THREE.DirectionalLight("#fff6e8", 2.2);
    sun.position.set(260, -180, 420);
    scene.add(sun);
    scene.add(new THREE.HemisphereLight("#ffffff", "#7a9a68", 1.35));
    scene.add(buildStadium(track));
    const fx = new Fx(scene);

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

    const kc = ctl;
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["arrowleft", "arrowright", "arrowup", "arrowdown", " "].includes(k)) e.preventDefault();
      if (k === "r" && !e.repeat) resetRef.current();
      if (k === "c" && !e.repeat) setCam((c) => CAMS[(CAMS.indexOf(c) + 1) % CAMS.length]);
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
      if (best !== null) st.laps = [best];
      st.lapStart = null;
    };
    repairRef.current = () => {
      st.damage = 0;
      localStorage.setItem(DAMAGE_KEY, "0");
      setBlocked(false);
      resetRef.current();
    };

    const tgt = new THREE.Vector3(st.x, st.y, 0);
    const dir = new THREE.Vector2(st.hx, st.hy);
    const cpos = new THREE.Vector3(st.x, st.y - 24, 62);
    let raf = 0;
    let last = window.performance.now() / 1000;
    let acc = 0;
    let frame = 0;
    let lastSave = 0;
    let bestLap: number | null = null;
    let shake = 0;
    let scale = CAR_SCALE;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = window.performance.now() / 1000;
      const dt = Math.min(0.1, now - last);
      last = now;

      // controls
      const c = kc;
      const kLeft = c.keys.has("arrowleft") || c.keys.has("a");
      const kRight = c.keys.has("arrowright") || c.keys.has("d");
      const kTarget = (kLeft ? 1 : 0) - (kRight ? 1 : 0);
      const rate = kTarget === 0 ? 6 : 2.2;
      c.keySteer += Math.max(-rate * dt, Math.min(rate * dt, kTarget - c.keySteer));
      const steerRaw = c.touchSteer ?? c.keySteer;
      const steer = Math.sign(steerRaw) * Math.pow(Math.abs(steerRaw), 1.6); // gentler around the centre
      const gas = c.touchGas ?? (c.keys.has("arrowup") || c.keys.has("w") ? 1 : 0);
      const brake = c.touchBrake ?? (c.keys.has("arrowdown") || c.keys.has("s") || c.keys.has(" ") ? 1 : 0);
      c.out.steer = steerRaw;
      c.out.gas = gas;
      c.out.brake = brake;

      // fixed-step sim
      const input = quantize(steer, gas, brake);
      const live = !pausedRef.current;
      acc += dt;
      let hitNow = 0;
      while (acc >= DT) {
        if (live) step(params, st, input, track);
        acc -= DT;
        if (st.hit > 0) hitNow = Math.max(hitNow, st.hit);
      }
      if (st.laps.length) bestLap = Math.min(...st.laps);
      const mode = camRef.current;
      const overhead = mode !== "chase";

      // effects
      const hx = st.hx;
      const hy = st.hy;
      const px = -hy;
      const py = hx;
      if (live) {
        if (hitNow > 0) {
          shake = Math.max(shake, Math.min(1.5, hitNow / 15));
          for (let i = 0; i < 12; i++) {
            const a = Math.random() * 6.28;
            fx.emit("spark", st.x + hx * 2, st.y + hy * 2, 1.2, Math.cos(a) * 30, Math.sin(a) * 30, 6 + Math.random() * 8, 1.4);
          }
          for (let i = 0; i < 4; i++) fx.emit("dark", st.x, st.y, 1.5, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, 3, 5);
        }
        const slip = Math.abs(st.v);
        if (st.u > 10 && slip > 3.5 && frame % 2 === 0) {
          for (const s of [-1, 1]) {
            const rx = st.x - hx * params.b + px * s * 0.8 * scale * 0.5;
            const ry = st.y - hy * params.b + py * s * 0.8 * scale * 0.5;
            fx.emit("smoke", rx, ry, 0.5, -hx * 2 + (Math.random() - 0.5) * 2, -hy * 2 + (Math.random() - 0.5) * 2, 1, 2.4 + Math.min(3, slip * 0.2));
          }
        }
        if (brake > 0.8 && st.u > 25 && frame % 3 === 0) {
          fx.emit("smoke", st.x - hx * params.b, st.y - hy * params.b, 0.5, -hx * 2, -hy * 2, 1, 2.2);
        }
        if (st.offTrack && st.u > 6 && frame % 2 === 0) {
          fx.emit("dust", st.x - hx * params.b, st.y - hy * params.b, 0.6, -hx * 3 + (Math.random() - 0.5) * 4, -hy * 3 + (Math.random() - 0.5) * 4, 1.5, 3.2);
        }
        if (st.damage > 55 && frame % 3 === 0) {
          fx.emit("dark", st.x + hx * params.a * 0.4, st.y + hy * params.a * 0.4, 1.8, -hx * st.u * 0.15, -hy * st.u * 0.15, 2.5, 3);
        }
        if (st.damage > 80 && frame % 2 === 0) {
          fx.emit("fire", st.x + hx * params.a * 0.5 + (Math.random() - 0.5), st.y + hy * params.a * 0.5 + (Math.random() - 0.5), 1.6, 0, 0, 3, 3.2);
        }
      }
      fx.update(dt);

      // car
      scale += ((overhead ? CAR_SCALE : 1) - scale) * Math.min(1, dt * 6);
      root.position.set(st.x, st.y, 0);
      root.rotation.z = Math.atan2(hy, hx);
      root.scale.setScalar(scale);
      tilt.rotation.x = Math.max(-0.05, Math.min(0.05, st.ay * 0.0012));
      tilt.rotation.y = Math.max(-0.04, Math.min(0.04, -st.ax * 0.0008));
      const straight = st.drs > 0.5;
      builds[0].group.visible = !straight;
      builds[1].group.visible = straight;

      // camera
      const k = 1 - Math.exp(-dt * 7);
      shake *= Math.exp(-dt * 6);
      if (overhead) {
        const look = 0.45;
        tgt.x += (st.x + (hx * st.u + -hy * st.v) * look - tgt.x) * k;
        tgt.y += (st.y + (hy * st.u + hx * st.v) * look - tgt.y) * k;
        dir.x += (hx - dir.x) * Math.min(1, dt * 3);
        dir.y += (hy - dir.y) * Math.min(1, dt * 3);
        const dl = Math.hypot(dir.x, dir.y) || 1;
        const H = 56 + st.u * 0.16;
        const off = 26;
        const bx = mode === "follow" ? -dir.x / dl : 0;
        const by = mode === "follow" ? -dir.y / dl : -1;
        camera.position.set(tgt.x + bx * off + (Math.random() - 0.5) * shake, tgt.y + by * off + (Math.random() - 0.5) * shake, H);
        camera.fov = 40;
        camera.lookAt(tgt.x, tgt.y, 0);
      } else {
        const back = 9 + st.u * 0.03;
        cpos.x += (st.x - hx * back - cpos.x) * k;
        cpos.y += (st.y - hy * back - cpos.y) * k;
        cpos.z += (3 + st.u * 0.005 - cpos.z) * k;
        camera.position.set(cpos.x + (Math.random() - 0.5) * shake * 0.3, cpos.y, cpos.z);
        camera.fov = 62 + Math.min(14, st.u * 0.07);
        camera.lookAt(st.x + hx * 9, st.y + hy * 9, 0.8);
      }
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);

      if (frame++ % 4 === 0) {
        setHud({
          kph: Math.max(0, st.u * 3.6),
          cur: st.lapStart === null ? null : st.t - st.lapStart,
          last: st.laps.length ? st.laps[st.laps.length - 1] : null,
          best: bestLap,
          laps: st.laps.length,
          gLat: st.ay / 9.81,
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
      fx.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, [design, track, damage0, ctl]);

  const toggleSide = () =>
    setWheelLeft((v) => {
      localStorage.setItem(SIDE_KEY, v ? "right" : "left");
      return !v;
    });

  const goFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen?.();
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape");
    } catch {}
  };

  const bounds = useMemo(() => {
    const x0 = Math.min(...track.px) - 30;
    const x1 = Math.max(...track.px) + 30;
    const y0 = Math.min(...track.py) - 30;
    const y1 = Math.max(...track.py) + 30;
    const d = track.px.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)} ${(-track.py[i]).toFixed(1)}`).join("") + "Z";
    return { x0, y0: -y1, w: x1 - x0, h: y1 - y0, d };
  }, [track]);

  const compact = vp.h < 520;
  const wheelSize = Math.round(Math.max(104, Math.min(200, vp.h * 0.36)));
  const gasH = Math.round(Math.max(96, Math.min(170, vp.h * 0.34)));
  const brkH = Math.round(gasH * 0.66);
  const dmgCol = hud.damage > TOO_DAMAGED ? "text-redhi" : hud.damage > 35 ? "text-warn" : "text-good";
  const driver = design?.driver.name ?? "Driver";
  const num = design?.livery.number ?? 7;
  const prim = design?.livery.primary ?? "#d9202b";

  return (
    <div className="fixed inset-0 touch-none select-none overflow-hidden bg-bg text-ink" onContextMenu={(e) => e.preventDefault()}>
      <div ref={mount} className="absolute inset-0" />

      {/* leaderboard strip */}
      <div className="pointer-events-none absolute left-1/2 top-1.5 w-[min(560px,56vw)] -translate-x-1/2 text-center">
        <div className={`${metal} rounded-lg px-1.5 py-1`}>
          <div className="flex items-center justify-center gap-1.5">
            <div className="flex items-center gap-2 rounded-md bg-gradient-to-b from-[#ffd24a] to-[#e89a10] px-2 py-0.5 text-[12px] font-extrabold text-black shadow-inner sm:text-[14px]">
              <span className="flex h-5 min-w-6 items-center justify-center rounded-[4px] px-1 text-[12px] text-white" style={{ background: prim }}>
                {num}
              </span>
              <span className="truncate">{driver}</span>
            </div>
            <div className="rounded-md bg-black/40 px-2 py-0.5 font-mono text-[12px] sm:text-[14px]">{fmt(hud.cur)}</div>
            <div className="hidden rounded-md bg-black/40 px-2 py-0.5 font-mono text-[11px] text-good sm:block">BEST {fmt(hud.best)}</div>
          </div>
          <div className="mt-0.5 text-[11px] font-semibold tracking-wide text-white/90 sm:text-[13px]">
            {track.name} · Lap {hud.laps + 1}
            {hud.cur === null ? " · cross the line to start timing" : hud.off ? " · off track!" : ""}
          </div>
        </div>
      </div>

      {/* menu buttons */}
      <div className="absolute left-2 top-1.5 flex flex-col gap-1.5" style={{ paddingLeft: "env(safe-area-inset-left)" }}>
        <IconBtn icon="‹" label="Back to design room" onClick={onBack} />
        <IconBtn icon="↻" label="Restart" onClick={restart} />
        <IconBtn icon="◎" label={`Camera: ${CAM_LABEL[cam]}`} onClick={nextCam} />
        <IconBtn icon={wheelLeft ? "◐" : "◑"} label="Swap wheel side" onClick={toggleSide} />
      </div>

      {/* minimap + condition bars */}
      <div className="pointer-events-none absolute right-2 top-1.5 flex flex-col items-end gap-1.5" style={{ paddingRight: "env(safe-area-inset-right)" }}>
        <div className={`${metal} rounded-xl p-1.5`}>
          <svg viewBox={`${bounds.x0} ${bounds.y0} ${bounds.w} ${bounds.h}`} className={compact ? "h-14 w-28" : "h-20 w-40"}>
            <path d={bounds.d} fill="#3c9a34" stroke="#f2c418" strokeWidth="34" strokeLinejoin="round" />
            <path d={bounds.d} fill="none" stroke="#cfcfd6" strokeWidth="24" strokeLinejoin="round" />
            <rect x={track.px[0] - 4} y={-track.py[0] - 18} width="8" height="36" fill="#fff" stroke="#111" strokeWidth="2" />
            <circle cx={hud.x} cy={-hud.y} r="20" fill="#2f8bff" stroke="#fff" strokeWidth="6" />
          </svg>
        </div>
        <div className={`${metal} space-y-0.5 rounded-lg px-2 py-1`}>
          <Bar label="F" v={hud.fuel / 18} col="#4fd1ff" />
          <Bar label="T" v={1 - hud.wear} col={hud.wear > 0.6 ? "#f0b429" : "#3ecf8e"} />
          <Bar label="D" v={1 - hud.damage / 100} col={hud.damage > 70 ? "#e0284f" : hud.damage > 35 ? "#f0b429" : "#3ecf8e"} />
        </div>
      </div>

      {/* speed */}
      <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 text-center font-mono" style={{ textShadow: "0 2px 6px rgba(0,0,0,.7)" }}>
        <div className="text-[34px] font-extrabold leading-none tracking-tight sm:text-[48px]">{Math.round(hud.kph)}</div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-white/80">km/h · gear {hud.gear}</div>
        <div className="mt-1 flex justify-center gap-1.5 text-[10px]">
          <span className={`rounded px-1.5 py-0.5 font-sans font-bold ${hud.drs > 0.5 ? "bg-good/30 text-good" : "bg-black/50 text-white/70"}`}>{hud.drs > 0.5 ? "STRAIGHT AERO" : "CORNER AERO"}</span>
          <span className="rounded bg-black/50 px-1.5 py-0.5 text-white/80">{Math.abs(hud.gLat).toFixed(1)} g</span>
          <span className={`rounded bg-black/50 px-1.5 py-0.5 ${dmgCol}`}>{Math.round(hud.damage)}% dmg</span>
        </div>
        {perf && !perf.legal && <div className="mt-1 text-[10px] text-warn">Not race-legal — fine for practice</div>}
      </div>

      {/* controls */}
      <div
        className="absolute inset-x-0 bottom-0 flex items-end justify-between px-3 pb-2"
        style={{ flexDirection: wheelLeft ? "row" : "row-reverse", paddingBottom: "max(8px, env(safe-area-inset-bottom))", paddingLeft: "max(12px, env(safe-area-inset-left))", paddingRight: "max(12px, env(safe-area-inset-right))" }}
      >
        <Wheel ctl={ctl} size={wheelSize} />
        <div className="flex items-end gap-2">
          <Pedal ctl={ctl} kind="brake" height={brkH} width={Math.round(wheelSize * 0.36)} />
          <Pedal ctl={ctl} kind="gas" height={gasH} width={Math.round(wheelSize * 0.46)} />
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-1 left-1/2 hidden -translate-x-1/2 text-[10px] text-white/60 lg:block" style={{ transform: "translate(-50%,-110px)" }}>
        ← → steer · ↑ gas · ↓ brake · release gas = regenerative braking · C camera · R restart
      </div>

      {hud.hit > 0.15 && <div className="pointer-events-none absolute inset-0" style={{ boxShadow: `inset 0 0 120px rgba(224,40,79,${Math.min(0.6, hud.hit * 0.5)})` }} />}

      {blocked && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-4">
          <div className="max-w-sm rounded-xl border border-line bg-panel p-5 text-center">
            <div className="text-lg font-semibold">Car too damaged to run</div>
            <p className="mt-2 text-[13px] text-muted">Damage is at {Math.round(damage0)}%. Practice is closed above {TOO_DAMAGED}%. Repairs will cost money and time once the economy exists; for now they are free.</p>
            <button onClick={() => repairRef.current()} className="mt-4 rounded-md bg-red px-4 py-2 text-[13px] font-medium hover:bg-redhi">
              Repair car
            </button>
          </div>
        </div>
      )}

      {portrait && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-bg/95 p-6 text-center">
          <svg viewBox="0 0 64 64" className="h-20 w-20 animate-[spin_3s_ease-in-out_infinite]" style={{ animationTimingFunction: "ease-in-out" }}>
            <rect x="20" y="8" width="24" height="48" rx="5" fill="none" stroke="#e0284f" strokeWidth="3" />
            <circle cx="32" cy="50" r="2" fill="#e0284f" />
          </svg>
          <div className="text-lg font-semibold">Turn your phone sideways</div>
          <p className="max-w-xs text-[13px] text-muted">Practice and races play in landscape: the wheel sits under your left thumb and the pedals under your right.</p>
          <button onClick={goFullscreen} className="rounded-md bg-red px-4 py-2 text-[13px] font-medium">
            Go full screen &amp; lock landscape
          </button>
          <button onClick={onBack} className="text-[12px] text-muted underline">
            Back to design room
          </button>
        </div>
      )}
    </div>
  );
}
