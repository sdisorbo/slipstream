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
  { id: "side", label: "Side shape", sub: "Profile silhouette" },
  { id: "plan", label: "Top shape", sub: "Plan view" },
  { id: "fw", label: "Front wing", sub: "Nose downforce" },
  { id: "rw", label: "Rear wing", sub: "Tail downforce" },
  { id: "floor", label: "Floor", sub: "Underbody suction" },
  { id: "livery", label: "Paint", sub: "Colors and number" },
  { id: "power", label: "Engine", sub: "Coming soon" },
];

const INPUT = "mt-1 w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-[13px] text-ink outline-none transition focus:border-redhi";

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
  const [windOpen, setWindOpen] = useState(true);
  const [view, setView] = useState<{ name: ViewName; n: number }>({ name: "iso", n: 0 });

  useEffect(() => {
    try {
      setWindOpen(window.innerWidth >= 1024);
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
        <Tipbox>
          Nose points right. Bulge the <b className="text-ink">bottom</b> line for extra grip. Tilt it too far and the wing <b className="text-warn">stalls</b>.
        </Tipbox>
        <div className={`mt-3 grid grid-cols-3 gap-2 rounded-lg border p-2.5 text-center ${res.stalled ? "border-warn/60 bg-warn/10" : "border-line bg-panel2"}`}>
          <Stat label="Lift" v={res.Cl.toFixed(2)} />
          <Stat label="Downforce" v={`${Math.round(0.5 * 1.2 * (kph / 3.6) ** 2 * res.ClA)} N`} />
          <Stat label={res.stalled ? "Stalled" : "Drag"} v={`${Math.round(0.5 * 1.2 * (kph / 3.6) ** 2 * res.CdA)} N`} warn={res.stalled} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          <Slider label="Span" value={w.span} min={lim.minSpan} max={lim.maxSpan} step={0.01} unit="m" onChange={(v) => set((x) => (x.span = v))} />
          <Slider label="Chord" value={w.chord} min={lim.minChord} max={lim.maxChord} step={0.005} unit="m" onChange={(v) => set((x) => (x.chord = v))} />
          <Slider label="Tilt" value={w.pitch} min={0} max={lim.maxPitch} step={0.5} unit="°" digits={1} onChange={(v) => set((x) => (x.pitch = v))} />
          <Slider label="Height" value={w.height} min={lim.minHeight} max={lim.maxHeight} step={0.005} unit="m" onChange={(v) => set((x) => (x.height = v))} />
          <Slider label="Side fins" value={w.endplate} min={0.05} max={0.4} step={0.005} unit="m" onChange={(v) => set((x) => (x.endplate = v))} />
          <div>
            <div className="mb-1 text-[12px] text-muted">Flaps</div>
            <div className="flex gap-1.5">
              {[1, 2, 3].map((n) => (
                <button key={n} onClick={() => set((x) => (x.elements = n as 1 | 2 | 3))} className={`flex-1 rounded-lg border py-1.5 text-[13px] font-semibold transition ${w.elements === n ? "border-redhi bg-reddim text-ink" : "border-line bg-panel2 text-muted hover:border-[#3a3a42]"}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4">
          <MaterialPick value={w.material} onChange={(m) => set((x) => (x.material = m))} />
        </div>
        <button className="btn btn-dark mt-4 !text-[12px]" onClick={() => upd((d) => (d[key] = key === "frontWing" ? defaultFrontWing() : defaultRearWing()))}>
          Reset this wing
        </button>
      </>
    );
  };

  const livery = design.livery;
  const colorRow = (label: string, k: keyof CarDesign["livery"]) => (
    <div className="flex items-center justify-between rounded-lg border border-line bg-panel2 px-2.5 py-1.5">
      <span className="text-[13px] text-ink/90">{label}</span>
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
            <Tipbox>Nose points right. Drag the points to reshape the car. A very steep tail separates the airflow and adds drag.</Tipbox>
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
              <Slider label="Body length" value={Lb} min={RULES.body.minLength} max={RULES.body.maxLength} step={0.05} unit="m" onChange={(v) => upd((d) => (d.body.length = v))} />
              <Slider label="Wheelbase" value={design.wheelbase} min={RULES.wheelbase.min} max={Math.min(RULES.wheelbase.max, Lb - 1.1)} step={0.02} unit="m" onChange={(v) => upd((d) => (d.wheelbase = v))} />
              <Slider label="Boxiness" value={body.squareness} min={2} max={4} step={0.05} onChange={(v) => upd((d) => (d.body.squareness = v))} />
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
            <Tipbox>Draw one side and the other copies it. A narrow nose and tail cuts drag. A wide middle leaves room for the powertrain.</Tipbox>
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
              <Slider label="Boxiness" value={body.squareness} min={2} max={4} step={0.05} onChange={(v) => upd((d) => (d.body.squareness = v))} />
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
            <Tipbox>This is the bottom of your car. Narrow it for suction, then open it up behind. Open it too fast and the flow separates.</Tipbox>
            <div className="mt-3 rounded-lg border border-line bg-panel2 p-2.5">
              <div className="mb-1 flex justify-between text-[12px] text-muted">
                <span>Underfloor suction</span>
                <span className={cur.floor.separated > 0.02 ? "font-semibold text-warn" : "font-semibold text-good"}>{cur.floor.separated > 0.02 ? `separating (${(cur.floor.separated * 100).toFixed(0)}%)` : "attached"}</span>
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
              {colorRow("Body", "primary")}
              {colorRow("Sides", "secondary")}
              {colorRow("Stripe", "accent")}
              {colorRow("Helmet", "helmet")}
              {colorRow("Helmet stripe", "helmetStripe")}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <label className="block text-[12px] text-muted">
                Driver name
                <input value={design.driver.name} maxLength={22} onChange={(e) => upd((d) => (d.driver.name = e.target.value))} className={INPUT} />
              </label>
              <label className="block text-[12px] text-muted">
                Car name
                <input value={design.name} maxLength={22} onChange={(e) => upd((d) => (d.name = e.target.value))} className={INPUT} />
              </label>
              <label className="block text-[12px] text-muted">
                Race number
                <input type="number" min={1} max={99} value={livery.number} onChange={(e) => upd((d) => (d.livery.number = clamp(parseInt(e.target.value || "1"), 1, 99)))} className={INPUT} />
              </label>
            </div>
            <Tipbox>Sponsors are coming. They will pay you for finishing high.</Tipbox>
          </div>
        );
      case "power":
        return (
          <div className="rounded-lg border border-dashed border-line p-6 text-[13px] leading-relaxed text-muted">
            <div className="mb-1 text-[15px] font-semibold text-ink">Engine builder is next</div>
            You will design the engine here. For now every car gets the same 720 kW motor.
          </div>
        );
    }
  })();

  const legal = p.legal;
  const act = PARTS.find((x) => x.id === part)!;
  const stats: { label: string; v: string; sub: string }[] = [
    { label: "Downforce", v: `${Math.round(p.downforceN).toLocaleString()} N`, sub: `${(p.downforceN / 9.81).toFixed(0)} kg-f` },
    { label: "Drag", v: `${Math.round(p.dragN).toLocaleString()} N`, sub: `CdA ${cur.CdA.toFixed(2)}` },
    { label: "Efficiency", v: p.ldRatio.toFixed(2), sub: "downforce / drag" },
    { label: "Balance", v: `${(cur.balanceFront * 100).toFixed(0)}% front`, sub: "aero center" },
    { label: "Top speed", v: `${p.topSpeedKph.toFixed(0)} km/h`, sub: `${p.gripG.toFixed(1)} g in corners` },
    { label: "Weight", v: `${p.mass.total.toFixed(0)} kg`, sub: p.mass.ballast > 0.5 ? `+${p.mass.ballast.toFixed(0)} ballast` : `$${Math.round(p.mass.cost / 1000)}k parts` },
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-bg lg:h-screen lg:min-h-[640px]">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-panel px-3 lg:gap-8 lg:px-5">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 32 32" className="h-6 w-6">
            <rect width="32" height="32" rx="7" fill="#a20623" />
            <path d="M6 24 16 7l10 17h-5l-5-9-5 9z" fill="#fff" />
          </svg>
          <span className="text-[16px] font-bold tracking-tight">Apex</span>
        </div>
        <nav className="flex h-full items-stretch gap-5 text-[14px] font-medium">
          <span className="flex items-center border-b-2 border-redhi text-ink">Design</span>
          <button onClick={() => onNav?.("practice")} className="flex items-center border-b-2 border-transparent text-muted transition hover:text-ink">
            Practice
          </button>
          {["Garage", "Race", "Pit crew", "Sponsors"].map((n) => (
            <span key={n} className="hidden cursor-not-allowed items-center text-muted/50 md:flex" title="Coming soon">
              {n}
            </span>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-[13px]">
          <span className="hidden text-muted sm:inline">{design.name}</span>
          <button onClick={() => confirm("Reset the whole car to the starter design?") && setDesign(defaultDesign())} className="btn btn-dark">
            Reset
          </button>
          <button onClick={() => onNav?.("practice")} className="btn">
            Practice
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* parts nav */}
        <aside className="shrink-0 overflow-y-auto border-b border-line bg-panel p-2 lg:w-[220px] lg:border-b-0 lg:border-r">
          <div className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Parts</div>
          <div className="flex gap-1 overflow-x-auto lg:flex-col">
            {PARTS.map((pt) => {
              const on = part === pt.id;
              return (
                <button key={pt.id} onClick={() => setPart(pt.id)} className={`relative shrink-0 rounded-lg px-3 py-2 text-left transition ${on ? "bg-panel2" : "hover:bg-panel2/60"}`}>
                  {on && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-redhi" />}
                  <div className={`text-[13px] font-semibold ${on ? "text-ink" : "text-ink/80"}`}>{pt.label}</div>
                  <div className="text-[11px] font-normal text-muted">{pt.sub}</div>
                </button>
              );
            })}
          </div>
          <div className="mt-3 hidden border-t border-line px-2 pt-3 lg:block">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Regulations</span>
              <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${legal ? "bg-good/15 text-good" : "bg-warn/15 text-warn"}`}>{legal ? "Race legal" : "Not legal"}</span>
            </div>
            <div className="space-y-1.5">
              {p.checks.map((c) => (
                <div key={c.id} className="flex items-start gap-1.5 text-[11px]">
                  <span className={`mt-[4px] h-1.5 w-1.5 shrink-0 rounded-full ${c.ok ? "bg-good" : c.id === "stall" ? "bg-warn" : "bg-redhi"}`} />
                  <div>
                    <div className={c.ok ? "text-ink/90" : "text-redhi"}>{c.label}</div>
                    <div className="font-mono text-[10px] font-normal text-muted">{c.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* viewport */}
        <section className="flex min-w-0 flex-1 flex-col lg:min-h-[420px]">
          <div className="grid-bg relative h-[46dvh] min-h-[260px] lg:h-auto lg:min-h-[320px] lg:flex-1">
            <Viewport3D design={design} wind={wind} view={view} />
            <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
              <div className="pointer-events-auto flex overflow-hidden rounded-lg border border-line bg-panel/90 text-[12px] backdrop-blur">
                {(["iso", "front", "side", "top", "rear"] as ViewName[]).map((v) => (
                  <button key={v} onClick={() => setView({ name: v, n: view.n + 1 })} className={`px-3 py-1.5 font-medium capitalize transition ${view.name === v ? "bg-panel2 text-ink" : "text-muted hover:text-ink"}`}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div className={`absolute right-2 top-2 rounded-xl border border-line bg-panel/90 p-3 text-[12px] backdrop-blur lg:right-3 lg:top-3 ${windOpen ? "w-[230px] lg:w-[250px]" : "w-auto"}`}>
              <div className={`flex items-center justify-between gap-3 ${windOpen ? "mb-2.5" : ""}`}>
                <button onClick={() => setWindOpen((v) => !v)} className="flex items-center gap-1.5 text-[13px] font-semibold" aria-label="Show or hide wind tunnel settings">
                  Wind tunnel <span className="text-muted">{windOpen ? "▾" : "▸"}</span>
                </button>
                <button onClick={() => setWind((w) => ({ ...w, on: !w.on }))} className={`relative h-5 w-9 rounded-full transition-colors ${wind.on ? "bg-good" : "bg-[#33333a]"}`} aria-label="Toggle wind tunnel">
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${wind.on ? "left-[18px]" : "left-0.5"}`} />
                </button>
              </div>
              {windOpen && (
                <div className="pop-in">
                  <div className="mb-3 flex overflow-hidden rounded-lg border border-line">
                    {[
                      ["Corner", false],
                      ["Straight", true],
                    ].map(([l, v]) => (
                      <button key={String(l)} onClick={() => setWind((w) => ({ ...w, straight: v as boolean }))} className={`flex-1 py-1 font-medium transition ${wind.straight === v ? "bg-panel2 text-ink" : "text-muted hover:text-ink"}`}>
                        {l as string}
                      </button>
                    ))}
                  </div>
                  <Slider label="Speed" value={kph} min={80} max={360} step={5} unit=" km/h" digits={0} onChange={setKph} />
                  <div className="mt-3" />
                  <Slider label="Side wind" value={yaw} min={0} max={12} step={0.5} unit="°" digits={1} onChange={setYaw} />
                  <label className="mt-3 flex cursor-pointer items-center gap-2 text-muted">
                    <input type="checkbox" checked={wind.surface} onChange={(e) => setWind((w) => ({ ...w, surface: e.target.checked }))} className="accent-[#e0284f]" />
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
              )}
            </div>
          </div>

          {/* stat strip */}
          <div className="grid shrink-0 grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-3 xl:grid-cols-6">
            {stats.map((m) => (
              <div key={m.label} className="bg-panel px-4 py-3">
                <div className="text-[11px] font-medium text-muted">{m.label}</div>
                <div key={m.v} className="bump font-mono text-[17px] font-semibold">
                  {m.v}
                </div>
                <div className="text-[11px] font-normal text-muted">{m.sub}</div>
              </div>
            ))}
          </div>
        </section>

        {/* editor */}
        <aside className="shrink-0 overflow-y-auto border-t border-line bg-panel p-5 lg:w-[470px] lg:border-l lg:border-t-0">
          <div className="mb-4">
            <h2 className="text-[20px] leading-tight">{act.label}</h2>
            <span className="text-[12px] font-normal text-muted">{act.sub}</span>
          </div>
          <div key={part} className="pop-in">
            {panel}
          </div>

          <details className="group mt-6 rounded-lg border border-line p-3">
            <summary className="flex items-center justify-between text-[13px] font-semibold text-muted transition hover:text-ink">
              <span>Detailed breakdown</span>
              <span className="transition group-open:rotate-180">▾</span>
            </summary>
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[13px]">Aero breakdown</h3>
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

              <h3 className="mb-2 mt-5 text-[13px]">Weight</h3>
              <div className="space-y-1 font-mono text-[12px]">
                {(
                  [
                    ["Body", p.mass.body],
                    ["Front wing", p.mass.frontWing],
                    ["Rear wing", p.mass.rearWing],
                    ["Floor", p.mass.floor],
                    ["Engine, driver, wheels", p.mass.fixed],
                    ["Ballast", p.mass.ballast],
                  ] as [string, number][]
                ).map(([l, v]) => (
                  <div key={l} className="flex items-center gap-2">
                    <span className="w-40 shrink-0 font-sans text-muted">{l}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-panel2">
                      <span className="block h-full rounded-full bg-red" style={{ width: `${Math.round((v / p.mass.total) * 100)}%` }} />
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
          </details>
        </aside>
      </div>
    </div>
  );
}

function Tipbox({ children }: { children: ReactNode }) {
  return <p className="mt-3 rounded-lg border border-line bg-panel2 px-3 py-2 text-[12px] font-normal leading-relaxed text-muted">{children}</p>;
}

function Stat({ label, v, sub, warn }: { label: string; v: string; sub?: string; box?: boolean; warn?: boolean }) {
  return (
    <div>
      <div className={`text-[10px] font-medium uppercase tracking-wider ${warn ? "text-warn" : "text-muted"}`}>{label}</div>
      <div className="font-mono text-[15px] font-semibold">{v}</div>
      {sub && <div className="text-[10px] text-muted">{sub}</div>}
    </div>
  );
}

function Slider({ label, value, min, max, step, unit, digits = 2, onChange }: { label: string; value: number; min: number; max: number; step: number; unit?: string; digits?: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="mb-2 flex items-baseline justify-between text-[12px]">
        <span className="text-muted">{label}</span>
        <span className="font-mono font-semibold text-ink">
          {value.toFixed(digits)}
          {unit && <span className="ml-0.5 font-normal text-muted">{unit}</span>}
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
            className={`rounded-lg border px-2.5 py-2 text-left text-[11px] leading-tight transition ${value === m.id ? "border-redhi bg-reddim text-ink" : "border-line bg-panel2 text-muted hover:border-[#3a3a42]"}`}
          >
            <div className="text-[12px] font-semibold text-ink">{m.name}</div>
            <div className="font-mono text-[10px] font-normal">
              {m.density} kg/m³ · ${m.costPerKg}/kg
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
