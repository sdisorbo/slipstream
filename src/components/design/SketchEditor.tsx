"use client";

import { useRef, useState, type ReactNode } from "react";
import { evalCurve, sortCurve, type Curve } from "@/lib/car/curve";

export interface CurveSpec {
  id: string;
  label: string;
  color: string;
  points: Curve;
  /** return the adjusted point. index lets the caller pin end points. */
  constrain: (index: number, x: number, y: number, pts: Curve) => { x: number; y: number };
  onChange: (c: Curve) => void;
  minPoints?: number;
}

export interface Mapper {
  sx: (x: number) => number;
  sy: (y: number) => number;
}

export default function SketchEditor({
  curves,
  yMin,
  yMax,
  xLen,
  xUnit = "m",
  yUnit = "m",
  flipX = false,
  mirror = false,
  aspect = 2.4,
  yTicks,
  overlay,
  fill,
  readout,
}: {
  curves: CurveSpec[];
  yMin: number;
  yMax: number;
  xLen: number; // real length represented by x in [0,1]
  xUnit?: string;
  yUnit?: string;
  flipX?: boolean;
  mirror?: boolean; // draw a mirrored ghost of every curve below the axis (plan view)
  aspect?: number;
  yTicks: number[];
  overlay?: (m: Mapper) => ReactNode;
  fill?: { upper: string; lower: string; color: string } | null; // fill between two curves (airfoils / side view)
  readout?: (curveId: string, x: number, y: number) => string;
}) {
  const W = 640;
  const H = Math.round(W / aspect);
  const pad = { l: 44, r: 16, t: 14, b: 26 };
  const pw = W - pad.l - pad.r;
  const ph = H - pad.t - pad.b;
  const sx = (x: number) => pad.l + (flipX ? 1 - x : x) * pw;
  const sy = (y: number) => pad.t + (1 - (y - yMin) / (yMax - yMin)) * ph;
  const ix = (px: number) => {
    const t = (px - pad.l) / pw;
    return flipX ? 1 - t : t;
  };
  const iy = (py: number) => yMin + (1 - (py - pad.t) / ph) * (yMax - yMin);

  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ cid: string; i: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const lastTap = useRef<{ id: string; t: number; x: number; y: number } | null>(null);

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return { px: ((e.clientX - r.left) / r.width) * W, py: ((e.clientY - r.top) / r.height) * H };
  };

  const pathOf = (c: Curve, mir = false) => {
    const n = 120;
    let dstr = "";
    for (let i = 0; i <= n; i++) {
      const x = i / n;
      const y = evalCurve(c, x);
      dstr += `${i ? "L" : "M"}${sx(x).toFixed(1)},${sy(mir ? -y : y).toFixed(1)}`;
    }
    return dstr;
  };

  const specById = (id: string) => curves.find((c) => c.id === id)!;

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const sp = specById(drag.cid);
    const { px, py } = toLocal(e);
    let x = Math.min(1, Math.max(0, ix(px)));
    let y = iy(py);
    const c = sp.constrain(drag.i, x, y, sp.points);
    x = c.x;
    y = c.y;
    const next = sp.points.map((p, k) => (k === drag.i ? { x, y } : p));
    sp.onChange(next);
    if (readout) setHover(readout(sp.id, x, y));
  };

  const addPoint = (e: { clientX: number; clientY: number }) => {
    const { px, py } = toLocal(e);
    const x = ix(px);
    const y = iy(py);
    if (x <= 0.01 || x >= 0.99) return;
    // nearest curve at this x
    let best: CurveSpec | null = null;
    let bd = Infinity;
    for (const sp of curves) {
      const dy = Math.abs(evalCurve(sp.points, x) - y);
      if (dy < bd) {
        bd = dy;
        best = sp;
      }
    }
    if (!best) return;
    const yy = evalCurve(best.points, x);
    const pts = sortCurve([...best.points, { x, y: yy }]);
    best.onChange(pts);
  };

  const removePoint = (cid: string, i: number) => {
    const sp = specById(cid);
    const min = sp.minPoints ?? 3;
    if (sp.points.length <= min || i === 0 || i === sp.points.length - 1) return;
    sp.onChange(sp.points.filter((_, k) => k !== i));
  };

  const fillPath = () => {
    if (!fill) return null;
    const u = curves.find((c) => c.id === fill.upper);
    const l = curves.find((c) => c.id === fill.lower);
    if (!u || !l) return null;
    const n = 120;
    let dstr = "";
    for (let i = 0; i <= n; i++) dstr += `${i ? "L" : "M"}${sx(i / n).toFixed(1)},${sy(evalCurve(u.points, i / n)).toFixed(1)}`;
    for (let i = n; i >= 0; i--) dstr += `L${sx(i / n).toFixed(1)},${sy(evalCurve(l.points, i / n)).toFixed(1)}`;
    return dstr + "Z";
  };

  const xTicks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="select-none">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none rounded-lg border border-line bg-[#0c0c0e]"
        onPointerMove={onMove}
        onPointerUp={() => setDrag(null)}
        onPointerLeave={() => setDrag(null)}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse") return;
          const now = e.timeStamp;
          const t = lastTap.current;
          if (t && t.id === "svg" && now - t.t < 340 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 28) {
            lastTap.current = null;
            addPoint(e);
          } else lastTap.current = { id: "svg", t: now, x: e.clientX, y: e.clientY };
        }}
        onDoubleClick={addPoint}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* grid */}
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} stroke={t === 0 ? "#3a3a42" : "#1b1b20"} strokeWidth={t === 0 ? 1.4 : 1} />
            <text x={pad.l - 6} y={sy(t) + 3.5} textAnchor="end" fontSize="10" fill="#6d6d76" className="font-mono">
              {Math.abs(t) < 0.01 ? t.toFixed(2) : t.toFixed(2)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={t}>
            <line x1={sx(t)} x2={sx(t)} y1={pad.t} y2={H - pad.b} stroke="#17171b" />
            <text x={sx(t)} y={H - 8} textAnchor="middle" fontSize="10" fill="#6d6d76" className="font-mono">
              {(t * xLen).toFixed(xLen < 2 ? 2 : 1)}
              {xUnit}
            </text>
          </g>
        ))}
        <text x={6} y={pad.t + 4} fontSize="9" fill="#55555d" className="font-mono">
          {yUnit}
        </text>
        {overlay?.({ sx, sy })}
        {fill && <path d={fillPath() ?? ""} fill={fill.color} opacity={0.22} />}
        {mirror &&
          curves.map((c) => <path key={c.id + "m"} d={pathOf(c.points, true)} fill="none" stroke={c.color} strokeWidth={1.4} opacity={0.35} strokeDasharray="4 4" />)}
        {mirror && curves[0] && (
          <path
            d={pathOf(curves[0].points) + "L" + sx(flipX ? 0 : 1) + "," + sy(0) + "L" + sx(flipX ? 1 : 0) + "," + sy(0) + "Z"}
            fill={curves[0].color}
            opacity={0.12}
          />
        )}
        {curves.map((c) => (
          <path key={c.id} d={pathOf(c.points)} fill="none" stroke={c.color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {curves.map((c) =>
          c.points.map((p, i) => (
            <g
              key={c.id + i}
              className="cursor-grab"
              onPointerDown={(e) => {
                e.stopPropagation();
                (e.target as Element).setPointerCapture?.(e.pointerId);
                if (e.pointerType !== "mouse") {
                  const now = e.timeStamp;
                  const t = lastTap.current;
                  if (t && t.id === c.id + i && now - t.t < 340) {
                    lastTap.current = null;
                    removePoint(c.id, i);
                    return;
                  }
                  lastTap.current = { id: c.id + i, t: now, x: e.clientX, y: e.clientY };
                }
                setDrag({ cid: c.id, i });
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                removePoint(c.id, i);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                removePoint(c.id, i);
              }}
            >
              <circle cx={sx(p.x)} cy={sy(p.y)} r={16} fill="transparent" />
              <circle cx={sx(p.x)} cy={sy(p.y)} r={drag?.cid === c.id && drag.i === i ? 7.5 : 6} fill="#0c0c0e" stroke={c.color} strokeWidth={2.2} />
            </g>
          )),
        )}
        {drag && hover && (
          <text x={W - pad.r - 4} y={pad.t + 12} textAnchor="end" fontSize="11" fill="#e8e8ea" className="font-mono">
            {hover}
          </text>
        )}
      </svg>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <span>Drag points to reshape</span>
        <span>Double-click or double-tap a line to add a point</span>
        <span>Double-click or double-tap a point to remove it</span>
        {curves.length > 1 && (
          <span className="flex gap-3">
            {curves.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1">
                <i className="inline-block h-0.5 w-3" style={{ background: c.color }} /> {c.label}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
