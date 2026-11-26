"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { CarDesign } from "@/lib/car/types";
import { buildCar, type CarBuild } from "@/lib/car/geometry";
import { buildFlow, cpColor, speedColor, type FlowField } from "@/lib/car/flow";
import { evalMode } from "@/lib/car/aero";
import { bodyStations, frontWingLEX } from "@/lib/car/shape";

export type ViewName = "iso" | "front" | "side" | "top" | "rear";
export interface WindState {
  on: boolean;
  straight: boolean;
  surface: boolean; // pressure paint on the body
}

const VIEWS: Record<ViewName, [number, number, number]> = {
  iso: [6.2, 3.0, 6.2],
  front: [7.5, 1.1, 0],
  rear: [-7.5, 1.4, 0],
  side: [0, 1.3, 11.5],
  top: [0.01, 9, 0.01],
};

export default function Viewport3D({
  design,
  wind,
  view,
}: {
  design: CarDesign;
  wind: WindState;
  view: { name: ViewName; n: number };
}) {
  const mount = useRef<HTMLDivElement>(null);
  const S = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    holder: THREE.Group;
    car: CarBuild | null;
    flowObjs: THREE.Object3D[];
    particles: { pts: THREE.Points; pos: Float32Array; traces: FlowField["traces"]; phase: Float32Array } | null;
    raf: number;
  } | null>(null);

  // one-time scene
  useEffect(() => {
    const el = mount.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    const scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0.4, 0);
    controls.maxPolarAngle = Math.PI * 0.499;
    controls.minDistance = 2;
    controls.maxDistance = 20;
    camera.position.set(...VIEWS.iso);

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 8, 5);
    scene.add(key);
    scene.add(new THREE.HemisphereLight(0x8890a8, 0x1a0a0e, 0.6));

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(14, 64),
      new THREE.MeshStandardMaterial({ color: "#0e0e11", roughness: 0.9, metalness: 0.1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.002;
    scene.add(floor);
    const grid = new THREE.GridHelper(28, 56, 0x3a3a42, 0x1e1e24);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    scene.add(grid);

    const holder = new THREE.Group();
    holder.rotation.x = -Math.PI / 2; // physics Z (up) -> screen up
    scene.add(holder);

    const st = { renderer, scene, camera, controls, holder, car: null as CarBuild | null, flowObjs: [] as THREE.Object3D[], particles: null as null | { pts: THREE.Points; pos: Float32Array; traces: FlowField["traces"]; phase: Float32Array }, raf: 0 };
    S.current = st;

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = w + "px";
      renderer.domElement.style.height = h + "px";
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      controls.update();
      const p = st.particles;
      if (p) {
        const steps = p.traces[0]?.pos.length / 3 || 1;
        for (let i = 0; i < p.traces.length; i++) {
          for (let k = 0; k < 3; k++) {
            const slot = i * 3 + k;
            p.phase[slot] = (p.phase[slot] + dt * 38) % steps;
            const f = Math.floor(p.phase[slot]);
            const tr = p.traces[i].pos;
            p.pos[slot * 3] = tr[f * 3];
            p.pos[slot * 3 + 1] = tr[f * 3 + 1];
            p.pos[slot * 3 + 2] = tr[f * 3 + 2];
          }
        }
        (p.pts.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      }
      renderer.render(scene, camera);
      st.raf = requestAnimationFrame(tick);
    };
    st.raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(st.raf);
      ro.disconnect();
      controls.dispose();
      st.car?.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      S.current = null;
    };
  }, []);

  // car rebuild
  useEffect(() => {
    const s = S.current;
    if (!s) return;
    if (s.car) {
      s.holder.remove(s.car.group);
      s.car.dispose();
    }
    const car = buildCar(design, wind.straight);
    s.car = car;
    s.holder.add(car.group);
    const cx = (frontWingLEX(design) - 0.2) / 2;
    s.holder.position.x = -cx;
  }, [design, wind.straight]);

  // flow (debounced)
  useEffect(() => {
    const s = S.current;
    if (!s) return;
    const clear = () => {
      for (const o of s.flowObjs) {
        s.car?.group.remove(o);
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material)?.dispose();
      }
      s.flowObjs = [];
      s.particles = null;
      // restore livery colors
      if (s.car) (s.car.body.userData.liv as { value: number }).value = 1;
      const g = s.car?.bodyGeom;
      if (g) {
        (g.getAttribute("color") as THREE.BufferAttribute).set(g.userData.baseColors as Float32Array);
        (g.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
      }
    };
    clear();
    if (!wind.on) return;
    const timer = setTimeout(() => {
      if (!S.current || !s.car) return;
      const mode = evalMode(design, wind.straight);
      const flow = buildFlow(design, mode, wind.straight);
      const segPos: number[] = [];
      const segCol: number[] = [];
      const c: [number, number, number] = [0, 0, 0];
      for (const tr of flow.traces) {
        const n = tr.pos.length / 3;
        for (let i = 0; i < n - 1; i++) {
          if (Math.abs(tr.pos[i * 3] - tr.pos[(i + 1) * 3]) + Math.abs(tr.pos[i * 3 + 1] - tr.pos[(i + 1) * 3 + 1]) < 1e-5) break;
          segPos.push(tr.pos[i * 3], tr.pos[i * 3 + 1], tr.pos[i * 3 + 2], tr.pos[(i + 1) * 3], tr.pos[(i + 1) * 3 + 1], tr.pos[(i + 1) * 3 + 2]);
          speedColor(tr.speed[i], c);
          segCol.push(c[0], c[1], c[2]);
          speedColor(tr.speed[i + 1], c);
          segCol.push(c[0], c[1], c[2]);
        }
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.Float32BufferAttribute(segPos, 3));
      lg.setAttribute("color", new THREE.Float32BufferAttribute(segCol, 3));
      const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, toneMapped: false }));
      s.car.group.add(lines);
      s.flowObjs.push(lines);

      const count = flow.traces.length * 3;
      const ppos = new Float32Array(count * 3);
      const pg = new THREE.BufferGeometry();
      pg.setAttribute("position", new THREE.BufferAttribute(ppos, 3));
      const pts = new THREE.Points(pg, new THREE.PointsMaterial({ toneMapped: false, color: 0xffffff, size: 0.035, transparent: true, opacity: 0.85, depthWrite: false }));
      pts.frustumCulled = false;
      s.car.group.add(pts);
      s.flowObjs.push(pts);
      const phase = new Float32Array(count);
      for (let i = 0; i < count; i++) phase[i] = ((i % 3) / 3) * (flow.traces[0].pos.length / 3) + Math.random() * 10;
      s.particles = { pts, pos: ppos, traces: flow.traces, phase };

      if (wind.surface) {
        (s.car.body.userData.liv as { value: number }).value = 0;
        (s.car.body.material as THREE.MeshStandardMaterial).toneMapped = false;
        (s.car.body.material as THREE.MeshStandardMaterial).needsUpdate = true;
        const g = s.car.bodyGeom;
        const posA = g.getAttribute("position");
        const nrm = g.getAttribute("normal");
        const colA = g.getAttribute("color") as THREE.BufferAttribute;
        for (let i = 0; i < posA.count; i++) {
          const v = flow.speedAt(posA.getX(i) + nrm.getX(i) * 0.03, posA.getY(i) + nrm.getY(i) * 0.03, posA.getZ(i) + nrm.getZ(i) * 0.03);
          cpColor(1 - v * v, c);
          colA.setXYZ(i, c[0], c[1], c[2]);
        }
        colA.needsUpdate = true;
      }
    }, 140);
    return () => clearTimeout(timer);
  }, [design, wind.on, wind.straight, wind.surface]);

  // camera presets
  useEffect(() => {
    const s = S.current;
    if (!s) return;
    const v = VIEWS[view.name];
    s.camera.position.set(v[0], v[1], v[2]);
    s.controls.target.set(0, 0.4, 0);
    s.controls.update();
  }, [view]);

  void bodyStations;
  return <div ref={mount} className="absolute inset-0 touch-none" />;
}
