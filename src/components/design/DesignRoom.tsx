"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Viewport3D, { type ViewName, type WindState } from "./Viewport3D";
import SketchEditor, { type CurveSpec } from "./SketchEditor";
import { defaultDesign, defaultFrontWing, defaultRearWing } from "@/lib/car/defaults";
import { clamp, evalCurve, type Curve } from "@/lib/car/curve";
import { MATERIAL_LIST, type MaterialId } from "@/lib/car/materials";
import { performance as perf } from "@/lib/car/aero";
import { FRONT_WHEEL, REAR_WHEEL, RULES, TRACK_WIDTH } from "@/lib/car/rules";
import { REAR_AXLE_X, frontAxleX } from "@/lib/car/shape";
import type { CarDesign, WingDesign } from "@/lib/car/types";

type PartId = "side" | "plan" | "fw" | "rw" | "floor" | "livery" | "power";

const PARTS: { id: PartId; label: string; sub: string }[] = [
  { id: "side", label: "Body profile", sub: "Side silhouette" },
  { id: "plan", label: "Body plan", sub: "Top-down shape" },
  { id: "fw", label: "Front wing", sub: "Airfoil section" },
  { id: "rw", label: "Rear wing", sub: "Airfoil section" },
  { id: "floor", label: "Floor & diffuser", sub: "Underbody tunnel" },
  { id: "livery", label: "Livery & driver", sub: "Colors, number, helmet" },
  { id: "power", label: "Powertrain", sub: "Engine & plumbing" },
];

const STORE = "apex.design.v1";

function sanitize(d: CarDesign): CarDesign {
  const wb = clamp(d.wheelbase, RULES.wheelbase.min, Math.min(RULES.wheelbase.max, d.body.length - 1.1));
  return { ...d, wheelbase: wb };
}

const fx = (idx: number, x: number, pts: Curve) => {
  if (idx === 0) return 0;
  if (idx === pts.length - 1) return 1;
  return clamp(x, pts[idx - 1].x + 0.015, pts[idx + 1].x - 0.015);
};

export default function DesignRoom({ onNav }: { onNav?: (to: "practice") => void }) {
  const [design, setDesign] = useState<CarDesign>(() => defaultDesign());
  const [part, setPart] = useState<PartId>("side");
  const [loaded, setLoaded] = useState(false);
  const [wind, setWind] = useState<WindState>({ on: false, straight: false, surface: true });
  const [kph, setKph] = useState(300);
  const [yaw, setYaw] = useState(0);
  const [view, setView] = useState<{ name: ViewName; n: number }>({ name: "iso", n: 0 });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) setDesign(sanitize(JSON.parse(raw) as CarDesign));
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) localStorage.setItem(STORE, JSON.stringify(design));
  }, [design, loaded]);

  const upd = (fn: (d: CarDesign) => void) =>
    setDesign((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return sanitize(next);
    });

  const p = useMemo(() => perf(design, kph / 3.6, yaw, wind.straight), [design, kph, yaw, wind.straight]);
  const cur = wind.straight ? p.straight : p.corner;

  const body = design.body;
  const Lb = body.length;

  // ---------- constraint builders ----------
  const sideUpper: CurveSpec = {
    id: "u",
    label: "Top line",
    color: "#e0284f",
    points: body.sideUpper,
    constrain: (i, x, y, pts) => {
      const xx = fx(i, x, pts);
      return { x: xx, y: clamp(y, evalCurve(body.sideLower, xx) + 0.04, RULES.maxHeight) };
    },
    onChange: (c) => upd((d) => (d.body.sideUpper = c)),
  };
  const sideLower: CurveSpec = {
    id: "l",
    label: "Belly line",
    color: "#7f8aa3",
    points: body.sideLower,
    constrain: (i, x, y, pts) => {
      const xx = fx(i, x, pts);
      return { x: xx, y: clamp(y, 0.07, evalCurve(body.sideUpper, xx) - 0.04) };
    },
    onChange: (c) => upd((d) => (d.body.sideLower = c)),
  };
  const plan: CurveSpec = {
    id: "w",
    label: "Half-width",
    color: "#e0284f",
    points: body.planHalf,
    constrain: (i, x, y, pts) => ({ x: fx(i, x, pts), y: clamp(y, 0.012, RULES.bodyMaxHalfWidth) }),
    onChange: (c) => upd((d) => (d.body.planHalf = c)),
    minPoints: 3,
  };
  const wingSpecs = (key: "frontWing" | "rearWing"): CurveSpec[] => {
    const w = design[key];
    const lim = 0.14;
    return [
      {
        id: "u",
        label: "Upper surface",
        color: "#e0284f",
        points: w.section.upper,
        constrain: (i, x, y, pts) => {
          const xx = fx(i, x, pts);
          return { x: xx, y: clamp(y, evalCurve(w.section.lower, xx) + 0.012, lim) };
        },
        onChange: (c) => upd((d) => (d[key].section.upper = c)),
      },
      {
        id: "l",
        label: "Lower surface",
        color: "#7f8aa3",
        points: w.section.lower,
        constrain: (i, x, y, pts) => {
          const xx = fx(i, x, pts);
          return { x: xx, y: clamp(y, -lim, evalCurve(w.section.upper, xx) - 0.012) };
        },
        onChange: (c) => upd((d) => (d[key].section.lower = c)),
      },
    ];
  };
  const floorSpec: CurveSpec = {
    id: "f",
    label: "Underside",
    color: "#e0284f",
    points: design.floor.under,
    constrain: (i, x, y, pts) => ({ x: fx(i, x, pts), y: clamp(y, 0, 0.22) }),
    onChange: (c) => upd((d) => (d.floor.under = c)),
  };

  // ---------- overlays ----------
  const sideOverlay = ({ sx, sy }: { sx: (x: number) => number; sy: (y: number) => number }) => {
    const ppm = Math.abs(sx(1) - sx(0)) / Lb; // px per meter horizontally
    const ppv = Math.abs(sy(0) - sy(1));
    const wheelsAt = [
      { X: REAR_AXLE_X, r: REAR_WHEEL.dia / 2 },
      { X: frontAxleX(design), r: FRONT_WHEEL.dia / 2 },
    ];
    return (
      <g>
        {wheelsAt.map((w, i) => (
          <ellipse key={i} cx={sx(1 - w.X / Lb)} cy={sy(w.r)} rx={w.r * ppm} ry={w.r * ppv} fill="#26262b" stroke="#3a3a42" opacity={0.85} />
        ))}
        <rect x={sx(1 - 0.01)} y={sy(0.04)} width={0} height={0} />
        <line x1={sx(0)} x2={sx(1)} y1={sy(RULES.maxHeight)} y2={sy(RULES.maxHeight)} stroke="#a20623" strokeDasharray="3 5" opacity={0.7} />
        <text x={sx(0.5)} y={sy(RULES.maxHeight) - 3} fontSize="9" fill="#a20623" textAnchor="middle" className="font-mono">
          max height 1.00 m
        </text>
      </g>
    );
  };
  const planOverlay = ({ sx, sy }: { sx: (x: number) => number; sy: (y: number) => number }) => {
    const ppm = Math.abs(sx(1) - sx(0)) / Lb;
    const ppv = Math.abs(sy(0) - sy(1)) / 1.1;
    const ws = [
      { X: REAR_AXLE_X, r: REAR_WHEEL.dia / 2, w: REAR_WHEEL.width, t: TRACK_WIDTH.rear },
      { X: frontAxleX(design), r: FRONT_WHEEL.dia / 2, w: FRONT_WHEEL.width, t: TRACK_WIDTH.front },
    ];
    return (
      <g>
        {ws.map((w, i) =>
          [1, -1].map((s) => (
            <rect
              key={i + "_" + s}
              x={sx(1 - w.X / Lb) - w.r * ppm}
              y={sy(s * (w.t / 2) + w.w / 2) }
              width={w.r * 2 * ppm}
              height={w.w * ppv}
              rx={3}
              fill="#26262b"
              stroke="#3a3a42"
              opacity={0.85}
            />
          )),
        )}
      </g>
    );
  };

  const chordOverlay = ({ sx, sy }: { sx: (x: number) => number; sy: (y: number) => number }) => (
    <g>
      <line x1={sx(0)} x2={sx(1)} y1={sy(0)} y2={sy(0)} stroke="#3a3a42" strokeDasharray="4 4" />
      <text x={sx(1) + 2} y={sy(0) - 4} fontSize="9" fill="#6d6d76" className="font-mono">
        chord line
      </text>
    </g>
  );

  // ---------- UI pieces ----------
  const wingPanel = (key: "frontWing" | "rearWing") => {
    const w = design[key];
    const lim = key === "frontWing" ? RULES.frontWing : RULES.rearWing;
    const res = key === "frontWing" ? cur.frontWing : cur.rearWing;
    const set = (fn: (w: WingDesign) => void) => upd((d) => fn(d[key]));
    return (
      <>
        <SketchEditor
          curves={wingSpecs(key)}
          yMin={-0.14}
          yMax={0.14}
          xLen={w.chord}
          flipX
          aspect={2.3}
          yTicks={[-0.1, -0.05, 0, 0.05, 0.1]}
          yUnit="× chord"
          fill={{ upper: "u", lower: "l", color: "#e0284f" }}
          overlay={chordOverlay}
          readout={(_, x, y) => `x ${(x * w.chord * 100).toFixed(0)} cm · y ${(y * 100).toFixed(1)}% c`}
        />
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          Drawn as it sits on the car, nose to the right. Bulge the <b className="text-ink">lower</b> surface for more downforce (camber). Thickness adds drag and structure; too much pitch stalls the wing.
        </p>
        <div className={`mt-3 grid grid-cols-3 gap-2 rounded-lg border p-2.5 text-center ${res.stalled ? "border-warn/60 bg-warn/5" : "border-line bg-panel2"}`}>
          <Stat label="C_L" v={res.Cl.toFixed(2)} />
          <Stat label="Downforce" v={`${Math.round(0.5 * 1.2 * (kph / 3.6) ** 2 * res.ClA)} N`} />
          <Stat label={res.stalled ? "STALLED" : "Drag"} v={`${Math.round(0.5 * 1.2 * (kph / 3.6) ** 2 * res.CdA)} N`} warn={res.stalled} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          <Slider label="Span" value={w.span} min={lim.minSpan} max={lim.maxSpan} step={0.01} unit="m" onChange={(v) => set((x) => (x.span = v))} />
          <Slider label="Chord" value={w.chord} min={lim.minChord} max={lim.maxChord} step={0.005} unit="m" onChange={(v) => set((x) => (x.chord = v))} />
          <Slider label="Pitch (flap angle)" value={w.pitch} min={0} max={lim.maxPitch} step={0.5} unit="°" digits={1} onChange={(v) => set((x) => (x.pitch = v))} />
          <Slider label="Height above ground" value={w.height} min={lim.minHeight} max={lim.maxHeight} step={0.005} unit="m" onChange={(v) => set((x) => (x.height = v))} />
          <Slider label="Endplate height" value={w.endplate} min={0.05} max={0.4} step={0.005} unit="m" onChange={(v) => set((x) => (x.endplate = v))} />
          <div>
            <div className="mb-1 text-[12px] text-muted">Elements</div>
            <div className="flex gap-1.5">
              {[1, 2, 3].map((n) => (
                <button key={n} onClick={() => set((x) => (x.elements = n as 1 | 2 | 3))} className={`flex-1 rounded-md border py-1 text-[12px] ${w.elements === n ? "border-red bg-reddim" : "border-line bg-panel2 text-muted"}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4">
          <MaterialPick value={w.material} onChange={(m) => set((x) => (x.material = m))} />
        </div>
        <button className="mt-3 text-[11px] text-muted underline decoration-dotted hover:text-ink" onClick={() => upd((d) => (d[key] = key === "frontWing" ? defaultFrontWing() : defaultRearWing()))}>
          Reset this wing
        </button>
      </>
    );
  };

  const livery = design.livery;
  const colorRow = (label: string, k: keyof CarDesign["livery"]) => (
    <div className="flex items-center justify-between">
      <span className="text-[12px] text-muted">{label}</span>
      <input type="color" value={livery[k] as string} onChange={(e) => upd((d) => ((d.livery[k] as string) = e.target.value))} />
    </div>
  );

  const panel: ReactNode = (() => {
    switch (part) {
      case "side":
        return (
          <>
            <SketchEditor
              curves={[sideUpper, sideLower]}
              yMin={0}
              yMax={1.1}
              xLen={Lb}
              flipX
              aspect={2.3}
              yTicks={[0, 0.25, 0.5, 0.75, 1]}
              yUnit="height m"
              fill={{ upper: "u", lower: "l", color: "#e0284f" }}
              overlay={sideOverlay}
              readout={(_, x, y) => `${((1 - x) * Lb).toFixed(2)} m from tail · ${y.toFixed(2)} m high`}
            />
            <p className="mt-2 text-[12px] leading-relaxed text-muted">Nose is on the right. The tail closes off the airflow: a steep rear taper separates the flow and costs drag. Vertical scale is stretched ×{(Lb / 1.1 / 2.3).toFixed(1)}.</p>
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
              <Slider label="Body length" value={Lb} min={RULES.body.minLength} max={RULES.body.maxLength} step={0.05} unit="m" onChange={(v) => upd((d) => (d.body.length = v))} />
              <Slider label="Wheelbase" value={design.wheelbase} min={RULES.wheelbase.min} max={Math.min(RULES.wheelbase.max, Lb - 1.1)} step={0.02} unit="m" onChange={(v) => upd((d) => (d.wheelbase = v))} />
              <Slider label="Section squareness" value={body.squareness} min={2} max={4} step={0.05} onChange={(v) => upd((d) => (d.body.squareness = v))} />
            </div>
            <div className="mt-4">
              <MaterialPick value={body.material} onChange={(m) => upd((d) => (d.body.material = m))} />
            </div>
          </>
        );
      case "plan":
        return (
          <>
            <SketchEditor
              curves={[plan]}
              yMin={-0.6}
              yMax={0.6}
              xLen={Lb}
              flipX
              mirror
              aspect={2.3}
              yTicks={[-0.4, -0.2, 0, 0.2, 0.4]}
              yUnit="half-width m"
              overlay={planOverlay}
              readout={(_, x, y) => `${((1 - x) * Lb).toFixed(2)} m from tail · ${(y * 2).toFixed(2)} m wide`}
            />
            <p className="mt-2 text-[12px] leading-relaxed text-muted">Draw one side, the other mirrors. The bulge in the middle is your sidepods and cooling. Narrow nose and tail cut drag; wide mid-section makes room for the powertrain.</p>
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
              <Slider label="Section squareness" value={body.squareness} min={2} max={4} step={0.05} onChange={(v) => upd((d) => (d.body.squareness = v))} />
            </div>
          </>
        );
      case "fw":
        return wingPanel("frontWing");
      case "rw":
        return wingPanel("rearWing");
      case "floor": {
        const cp = cur.floor.cp;
        const mn = Math.min(...cp, -0.5);
        return (
          <>
            <SketchEditor
              curves={[floorSpec]}
              yMin={0}
              yMax={0.24}
              xLen={design.floor.length}
              flipX
              aspect={2.8}
              yTicks={[0, 0.05, 0.1, 0.15, 0.2]}
              yUnit="above plank m"
              readout={(_, x, y) => `${((1 - x) * design.floor.length).toFixed(2)} m from rear · gap ${((design.rideHeight + y) * 1000).toFixed(0)} mm`}
            />
            <p className="mt-2 text-[12px] leading-relaxed text-muted">The underside of your floor, nose to the right. Squeeze the throat, then open a diffuser behind it. Air speeds up in the narrow part (suction = downforce). Expand too fast and the flow separates.</p>
            <div className="mt-3 rounded-lg border border-line bg-panel2 p-2.5">
              <div className="mb-1 flex justify-between text-[11px] text-muted">
                <span>Underfloor pressure (C<sub>p</sub>)</span>
                <span className={cur.floor.separated > 0.02 ? "text-warn" : ""}>{cur.floor.separated > 0.02 ? `diffuser separating (${(cur.floor.separated * 100).toFixed(0)}%)` : "attached"}</span>
              </div>
              <svg viewBox="0 0 300 60" className="w-full">
                <line x1="0" x2="300" y1="6" y2="6" stroke="#2a2a30" />
                <polyline fill="rgba(224,40,79,0.18)" stroke="#e0284f" strokeWidth="1.8" points={`300,6 ${cp.map((c, i) => `${300 - (i / (cp.length - 1)) * 300},${6 + (c / mn) * 48}`).join(" ")} 0,6`} />
              </svg>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
              <Slider label="Floor length" value={design.floor.length} min={RULES.floor.minLength} max={RULES.floor.maxLength} step={0.05} unit="m" onChange={(v) => upd((d) => (d.floor.length = v))} />
              <Slider label="Floor width" value={design.floor.width} min={RULES.floor.minWidth} max={RULES.floor.maxWidth} step={0.01} unit="m" onChange={(v) => upd((d) => (d.floor.width = v))} />
              <Slider label="Ride height" value={design.rideHeight * 1000} min={RULES.rideHeight.min * 1000} max={RULES.rideHeight.max * 1000} step={1} unit="mm" digits={0} onChange={(v) => upd((d) => (d.rideHeight = v / 1000))} />
            </div>
            <div className="mt-4">
              <MaterialPick value={design.floor.material} onChange={(m) => upd((d) => (d.floor.material = m))} />
            </div>
          </>
        );
      }
      case "livery":
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
              {colorRow("Body color", "primary")}
              {colorRow("Underside / sidepods", "secondary")}
              {colorRow("Accent stripe", "accent")}
              {colorRow("Helmet", "helmet")}
              {colorRow("Helmet stripe", "helmetStripe")}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <label className="block text-[12px] text-muted">
                Driver name
                <input value={design.driver.name} maxLength={22} onChange={(e) => upd((d) => (d.driver.name = e.target.value))} className="mt-1 w-full rounded-md border border-line bg-panel2 px-2 py-1.5 text-[13px] text-ink outline-none focus:border-red" />
              </label>
              <label className="block text-[12px] text-muted">
                Car name
                <input value={design.name} maxLength={22} onChange={(e) => upd((d) => (d.name = e.target.value))} className="mt-1 w-full rounded-md border border-line bg-panel2 px-2 py-1.5 text-[13px] text-ink outline-none focus:border-red" />
              </label>
              <label className="block text-[12px] text-muted">
                Race number
                <input type="number" min={1} max={99} value={livery.number} onChange={(e) => upd((d) => (d.livery.number = clamp(parseInt(e.target.value || "1"), 1, 99)))} className="mt-1 w-full rounded-md border border-line bg-panel2 px-2 py-1.5 text-[13px] text-ink outline-none focus:border-red" />
              </label>
            </div>
            <p className="text-[12px] text-muted">Sponsors will appear here once ads are in: they pay per race based on how well you finish.</p>
          </div>
        );
      case "power":
        return (
          <div className="rounded-lg border border-dashed border-line p-5 text-[13px] leading-relaxed text-muted">
            <div className="mb-1 font-medium text-ink">Powertrain designer: next up</div>
            You&apos;ll draw the intake and exhaust plumbing and size the engine here. The aero side of the design room comes first. Power is fixed at 720 kW for now.
          </div>
        );
    }
  })();

  return (
    <div className="flex h-screen min-h-[640px] flex-col bg-bg">
      <header className="flex h-12 shrink-0 items-center gap-6 border-b border-line bg-panel px-4">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 32 32" className="h-6 w-6">
            <rect width="32" height="32" rx="7" fill="#0c0c0e" />
            <path d="M6 24 16 7l10 17h-5l-5-9-5 9z" fill="#a20623" />
          </svg>
          <span className="text-[15px] font-semibold tracking-[0.18em]">APEX</span>
        </div>
        <nav className="flex gap-1 text-[13px]">
          <span className="rounded-md bg-reddim px-3 py-1 text-ink">Design room</span>
          <button onClick={() => onNav?.("practice")} className="rounded-md px-3 py-1 text-ink/80 hover:bg-panel2 hover:text-ink">
            Practice
          </button>
          {["Garage", "Race", "Pit crew", "Sponsors"].map((n) => (
            <span key={n} className="cursor-not-allowed rounded-md px-3 py-1 text-muted/60" title="Coming soon">
              {n}
            </span>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-[12px] text-muted">
          <span className="font-mono">{design.name}</span>
          <button onClick={() => confirm("Reset the whole car to the starter design?") && setDesign(defaultDesign())} className="rounded-md border border-line px-2 py-1 hover:border-red hover:text-ink">
            Reset car
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* parts nav */}
        <aside className="shrink-0 overflow-y-auto border-b border-line bg-panel p-2 lg:w-[210px] lg:border-b-0 lg:border-r">
          <div className="px-2 pb-1 pt-1 text-[10px] uppercase tracking-[0.16em] text-muted">Parts</div>
          <div className="flex gap-1 overflow-x-auto lg:flex-col">
            {PARTS.map((pt) => (
              <button key={pt.id} onClick={() => setPart(pt.id)} className={`shrink-0 rounded-md border px-3 py-2 text-left transition ${part === pt.id ? "border-red bg-reddim" : "border-transparent hover:bg-panel2"}`}>
                <div className="text-[13px] font-medium">{pt.label}</div>
                <div className="text-[11px] text-muted">{pt.sub}</div>
              </button>
            ))}
          </div>
          <div className="mt-3 hidden space-y-1.5 border-t border-line px-2 pt-3 lg:block">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted">Regulations</div>
            {p.checks.map((c) => (
              <div key={c.id} className="flex items-start gap-1.5 text-[11px]">
                <span className={`mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full ${c.ok ? "bg-good" : c.id === "stall" ? "bg-warn" : "bg-redhi"}`} />
                <div>
                  <div className={c.ok ? "text-ink" : "text-redhi"}>{c.label}</div>
                  <div className="font-mono text-[10px] text-muted">{c.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* viewport */}
        <section className="flex min-h-[420px] min-w-0 flex-1 flex-col">
          <div className="grid-bg relative min-h-[320px] flex-1">
            <Viewport3D design={design} wind={wind} view={view} />
            <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
              <div className="pointer-events-auto flex overflow-hidden rounded-md border border-line bg-panel/90 text-[12px] backdrop-blur">
                {(["iso", "front", "side", "top", "rear"] as ViewName[]).map((v) => (
                  <button key={v} onClick={() => setView({ name: v, n: view.n + 1 })} className="px-2.5 py-1.5 capitalize text-muted hover:bg-panel2 hover:text-ink">
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div className="absolute right-3 top-3 w-[250px] rounded-lg border border-line bg-panel/90 p-3 text-[12px] backdrop-blur">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium tracking-wide">Wind tunnel</span>
                <button onClick={() => setWind((w) => ({ ...w, on: !w.on }))} className={`relative h-5 w-9 rounded-full transition ${wind.on ? "bg-redhi" : "bg-[#33333a]"}`} aria-label="Toggle wind tunnel">
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${wind.on ? "left-[18px]" : "left-0.5"}`} />
                </button>
              </div>
              <div className="mb-2 flex overflow-hidden rounded-md border border-line">
                {[
                  ["Corner mode", false],
                  ["Straight mode", true],
                ].map(([l, v]) => (
                  <button key={String(l)} onClick={() => setWind((w) => ({ ...w, straight: v as boolean }))} className={`flex-1 py-1 ${wind.straight === v ? "bg-reddim text-ink" : "text-muted hover:bg-panel2"}`}>
                    {l as string}
                  </button>
                ))}
              </div>
              <Slider label="Airspeed" value={kph} min={80} max={360} step={5} unit=" km/h" digits={0} onChange={setKph} />
              <div className="mt-2" />
              <Slider label="Yaw (crosswind)" value={yaw} min={0} max={12} step={0.5} unit="°" digits={1} onChange={setYaw} />
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-muted">
                <input type="checkbox" checked={wind.surface} onChange={(e) => setWind((w) => ({ ...w, surface: e.target.checked }))} className="accent-[#a20623]" />
                Pressure paint on body
              </label>
              {wind.on && (
                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted">
                  <span>slow</span>
                  <span className="h-1.5 flex-1 rounded-full" style={{ background: "linear-gradient(90deg,#1a40f2,#1acef2,#33e64d,#fae626,#f2261a)" }} />
                  <span>fast</span>
                </div>
              )}
            </div>
          </div>

          {/* stat strip */}
          <div className="grid shrink-0 grid-cols-3 gap-px border-t border-line bg-line text-center sm:grid-cols-6">
            <Stat box label="Downforce" v={`${Math.round(p.downforceN).toLocaleString()} N`} sub={`${(p.downforceN / 9.81).toFixed(0)} kg-f`} />
            <Stat box label="Drag" v={`${Math.round(p.dragN).toLocaleString()} N`} sub={`CdA ${cur.CdA.toFixed(2)}`} />
            <Stat box label="Efficiency" v={`${p.ldRatio.toFixed(2)}`} sub="downforce / drag" />
            <Stat box label="Balance" v={`${(cur.balanceFront * 100).toFixed(0)}% front`} sub="aero center" />
            <Stat box label="Top speed" v={`${p.topSpeedKph.toFixed(0)} km/h`} sub={`${p.gripG.toFixed(1)} g @ 200`} />
            <Stat box label="Mass" v={`${p.mass.total.toFixed(0)} kg`} sub={p.mass.ballast > 0.5 ? `+${p.mass.ballast.toFixed(0)} ballast` : `$${Math.round(p.mass.cost / 1000)}k parts`} />
          </div>
        </section>

        {/* editor */}
        <aside className="shrink-0 overflow-y-auto border-t border-line bg-panel p-4 lg:w-[470px] lg:border-l lg:border-t-0">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[15px] font-semibold">{PARTS.find((x) => x.id === part)!.label}</h2>
            <span className="text-[11px] text-muted">{PARTS.find((x) => x.id === part)!.sub}</span>
          </div>
          {panel}

          <div className="mt-6 border-t border-line pt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold">Aero breakdown</h3>
              <span className="font-mono text-[10px] text-muted">{kph} km/h</span>
            </div>
            <table className="w-full text-[12px]">
              <thead className="text-[10px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="pb-1 text-left font-normal">Part</th>
                  <th className="pb-1 text-right font-normal">CdA corner</th>
                  <th className="pb-1 text-right font-normal">CdA straight</th>
                  <th className="pb-1 text-right font-normal">ClA corner</th>
                  <th className="pb-1 text-right font-normal">ClA straight</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {p.corner.parts.map((pt, i) => (
                  <tr key={pt.id} className="border-t border-line/60">
                    <td className="py-1 font-sans text-ink">{pt.name}</td>
                    <td className="text-right">{pt.CdA.toFixed(3)}</td>
                    <td className="text-right">{p.straight.parts[i].CdA.toFixed(3)}</td>
                    <td className="text-right">{pt.ClA.toFixed(3)}</td>
                    <td className="text-right">{p.straight.parts[i].ClA.toFixed(3)}</td>
                  </tr>
                ))}
                <tr className="border-t border-line font-semibold">
                  <td className="py-1 font-sans">Total</td>
                  <td className="text-right">{p.corner.CdA.toFixed(3)}</td>
                  <td className="text-right text-good">{p.straight.CdA.toFixed(3)}</td>
                  <td className="text-right">{p.corner.ClA.toFixed(3)}</td>
                  <td className="text-right text-warn">{p.straight.ClA.toFixed(3)}</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-muted">Straight mode flattens both wings: {(100 * (1 - p.straight.CdA / p.corner.CdA)).toFixed(0)}% less drag for {(100 * (1 - p.straight.ClA / p.corner.ClA)).toFixed(0)}% less downforce.</p>
          </div>

          <div className="mt-5 border-t border-line pt-4">
            <h3 className="mb-2 text-[13px] font-semibold">Weight</h3>
            <div className="space-y-1 font-mono text-[12px]">
              {(
                [
                  ["Body", p.mass.body],
                  ["Front wing", p.mass.frontWing],
                  ["Rear wing", p.mass.rearWing],
                  ["Floor", p.mass.floor],
                  ["Powertrain, driver, running gear", p.mass.fixed],
                  ["Ballast", p.mass.ballast],
                ] as [string, number][]
              ).map(([l, v]) => (
                <div key={l} className="flex items-center gap-2">
                  <span className="w-44 shrink-0 font-sans text-muted">{l}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel2">
                    <span className="block h-full rounded-full bg-red" style={{ width: `${(v / p.mass.total) * 100}%` }} />
                  </span>
                  <span className="w-14 text-right">{v.toFixed(1)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-line pt-1 font-semibold">
                <span className="font-sans">Total (min {RULES.minMass}, max {RULES.maxMass})</span>
                <span>{p.mass.total.toFixed(1)} kg</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, v, sub, box, warn }: { label: string; v: string; sub?: string; box?: boolean; warn?: boolean }) {
  return (
    <div className={box ? "bg-panel px-3 py-2" : ""}>
      <div className={`text-[10px] uppercase tracking-[0.12em] ${warn ? "text-warn" : "text-muted"}`}>{label}</div>
      <div className="font-mono text-[15px] font-semibold">{v}</div>
      {sub && <div className="text-[10px] text-muted">{sub}</div>}
    </div>
  );
}

function Slider({ label, value, min, max, step, unit, digits = 2, onChange }: { label: string; value: number; min: number; max: number; step: number; unit?: string; digits?: number; onChange: (v: number) => void }) {
  return (
  <label className="block">
    <div className="mb-1 flex items-baseline justify-between text-[12px]">
      <span className="text-muted">{label}</span>
      <span className="font-mono text-ink">
        {value.toFixed(digits)}
        {unit && <span className="ml-0.5 text-muted">{unit}</span>}
      </span>
    </div>
    <input type="range" className="w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
  </label>
  );
}

function MaterialPick({ value, onChange }: { value: MaterialId; onChange: (m: MaterialId) => void }) {
  return (
  <div>
    <div className="mb-1.5 text-[12px] text-muted">Material</div>
    <div className="grid grid-cols-3 gap-1.5">
      {MATERIAL_LIST.map((m) => (
        <button
          key={m.id}
          onClick={() => onChange(m.id)}
          title={m.note}
          className={`rounded-md border px-2 py-1.5 text-left text-[11px] leading-tight transition ${value === m.id ? "border-red bg-reddim text-ink" : "border-line bg-panel2 text-muted hover:border-[#444]"}`}
        >
          <div className="font-medium text-ink">{m.name}</div>
          <div className="font-mono text-[10px]">
            {m.density} kg/m³ · ${m.costPerKg}/kg
          </div>
        </button>
      ))}
    </div>
  </div>
  );
}

