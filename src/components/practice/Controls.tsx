"use client";

import { useEffect, useRef } from "react";

// Shared, mutable control state. The sim loop reads it; the widgets write to it through methods.
export class ControlState {
  touchSteer: number | null = null; // -1..1, left positive
  touchGas: number | null = null; // 0..1
  touchBrake: number | null = null;
  keys = new Set<string>();
  keySteer = 0;
  out = { steer: 0, gas: 0, brake: 0 };
  setTouch(kind: "steer" | "gas" | "brake", v: number | null) {
    if (kind === "steer") this.touchSteer = v;
    else if (kind === "gas") this.touchGas = v;
    else this.touchBrake = v;
  }
}

const MAX_DEG = 110;

export function Wheel({ ctl, size = 168 }: { ctl: ControlState; size?: number }) {
  const rot = useRef<SVGGElement>(null);
  const el = useRef<HTMLDivElement>(null);
  const drag = useRef<{ last: number; val: number } | null>(null);
  const pad = Math.round(size * 0.4);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      // keep the drawn wheel in step with whatever is steering
      if (rot.current) rot.current.style.transform = `rotate(${-ctl.out.steer * MAX_DEG}deg)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ctl]);

  const ang = (e: React.PointerEvent) => {
    const r = el.current!.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
  };
  const down = (e: React.PointerEvent) => {
    el.current!.setPointerCapture(e.pointerId);
    drag.current = { last: ang(e), val: ctl.out.steer * MAX_DEG };
    ctl.setTouch("steer", ctl.out.steer);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const a = ang(e);
    let da = a - d.last;
    if (da > 180) da -= 360;
    if (da < -180) da += 360;
    d.last = a;
    d.val = Math.max(-MAX_DEG, Math.min(MAX_DEG, d.val + da));
    ctl.setTouch("steer", -d.val / MAX_DEG); // clockwise = right = negative
  };
  const up = () => {
    drag.current = null;
    ctl.setTouch("steer", null);
  };
  return (
    <div
      ref={el}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      className="touch-none select-none rounded-full"
      // the grabbable area reaches well past the drawn wheel (invisible padding, negative margin keeps the layout the same)
      style={{ width: size + pad * 2, height: size + pad * 2, padding: pad, margin: -pad, cursor: "grab" }}
    >
      <svg viewBox="-100 -100 200 200" width={size} height={size} className="pointer-events-none">
        <circle r="96" fill="rgba(12,12,14,.55)" stroke="#2a2a30" />
        <g ref={rot} style={{ transition: "none" }}>
          <circle r="76" fill="none" stroke="#1d1d22" strokeWidth="16" />
          <circle r="76" fill="none" stroke="#3a3a42" strokeWidth="2" />
          <path d="M-76 0 H-22 M76 0 H22 M0 22 V76" stroke="#26262c" strokeWidth="12" strokeLinecap="round" />
          <rect x="-26" y="-22" width="52" height="30" rx="8" fill="#0f0f12" stroke="#a20623" strokeWidth="2" />
          <circle cx="-12" cy="-7" r="4" fill="#e0284f" />
          <circle cx="0" cy="-7" r="4" fill="#3ecf8e" />
          <circle cx="12" cy="-7" r="4" fill="#f0b429" />
          <path d="M-8 -78 h16" stroke="#e0284f" strokeWidth="6" strokeLinecap="round" />
        </g>
      </svg>
    </div>
  );
}

export function Pedal({
  ctl,
  kind,
  height = 150,
  width = 70,
}: {
  ctl: ControlState;
  kind: "gas" | "brake";
  height?: number;
  width?: number;
}) {
  const fill = useRef<HTMLDivElement>(null);
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (fill.current) fill.current.style.height = `${ctl.out[kind] * 100}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ctl, kind]);

  // a press is always full throttle / full brake, wherever on the pedal you touch
  const set = () => ctl.setTouch(kind, 1);
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        ref={el}
        onPointerDown={(e) => {
          el.current!.setPointerCapture(e.pointerId);
          set();
        }}
        onPointerMove={(e) => {
          if ((kind === "gas" ? ctl.touchGas : ctl.touchBrake) !== null) set();
        }}
        onPointerUp={() => ctl.setTouch(kind, null)}
        onPointerCancel={() => ctl.setTouch(kind, null)}
        className="relative touch-none select-none overflow-hidden rounded-xl border border-white/15 bg-black/50 backdrop-blur"
        style={{ width, height, cursor: "pointer" }}
      >
        <div ref={fill} className="absolute inset-x-0 bottom-0" style={{ background: kind === "gas" ? "linear-gradient(0deg,#a20623,#e0284f)" : "linear-gradient(0deg,#8a6a10,#f0b429)", height: "0%" }} />
        {[0.25, 0.5, 0.75].map((f) => (
          <div key={f} className="absolute inset-x-2 border-t border-white/10" style={{ top: `${f * 100}%` }} />
        ))}
      </div>
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">{kind === "gas" ? "Gas" : "Brake"}</span>
    </div>
  );
}
