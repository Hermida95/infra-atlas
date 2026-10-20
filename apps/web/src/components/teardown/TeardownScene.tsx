"use client";

/* Imperative Three.js scene mutated every frame inside useFrame (see BrainScene for why). */
/* eslint-disable react-hooks/immutability */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { GraphNode, PartKind } from "@/lib/graph";
import { markCanvas } from "@/lib/textures";

THREE.ColorManagement.enabled = false;

export type LabPart = { vis: number; drop: number | null; flash: number; state: "" | "cached" | "rebuilt" };
export type LabState = { containers: number; parts: LabPart[]; containerDrops: (number | null)[] };

/** Shared, frame-read state. React writes it; the scene reads it every frame. */
export type TeardownStore = {
  /** Index of the part whose section is being read, -1 for none. */
  act: number;
  /** True while the lab section is on screen: the scene switches to lab mode. */
  labOn: boolean;
  lab: LabState | null;
  drag: number;
};

type Props = {
  node: GraphNode;
  store: RefObject<TeardownStore>;
  scroller: RefObject<HTMLElement | null>;
  firstPart: RefObject<HTMLElement | null>;
  labels: RefObject<HTMLDivElement | null>;
};

const CYAN = new THREE.Color(0x7fe3ff);
const BRIGHT = new THREE.Color(0xdcf4ff);
const TAU = Math.PI * 2;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const eOut = (x: number) => 1 - Math.pow(1 - x, 3);

export default function TeardownScene(props: Props) {
  return (
    <Canvas
      camera={{ fov: 36, near: 1, far: 6000, position: [300, 220, 460] }}
      dpr={[1, 2]}
      flat
      linear
      gl={{ antialias: true, alpha: false }}
      onCreated={({ gl }) => gl.setClearColor(0x06111a, 1)}
    >
      <Stage {...props} />
    </Canvas>
  );
}

const additive = (opacity: number) => ({
  color: CYAN.clone(),
  transparent: true,
  opacity,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

function dashed(geo: THREE.BufferGeometry, opacity: number) {
  const l = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineDashedMaterial({ ...additive(opacity), dashSize: 6, gapSize: 5 }));
  l.computeLineDistances();
  return l;
}

/** Per-kind surface detail, so each part reads as what it is. */
function detail(kind: PartKind | null, w: number, h: number, d: number): THREE.Object3D | null {
  const top = h / 2 + 0.6;
  const pts: number[] = [];
  if (kind === "os") {
    for (let i = 1; i < 8; i++) { const x = -w * 0.38 + (w * 0.76 * i) / 8; pts.push(x, top, -d * 0.38, x, top, d * 0.38); }
    for (let j = 1; j < 6; j++) { const z = -d * 0.38 + (d * 0.76 * j) / 6; pts.push(-w * 0.38, top, z, w * 0.38, top, z); }
  }
  if (kind === "code") {
    for (let j = 0; j < 7; j++) {
      const z = -d * 0.32 + (d * 0.64 * j) / 6, ind = (j % 3) * 12, len = w * (0.22 + ((j * 37) % 5) / 12);
      pts.push(-w * 0.36 + ind, top, z, -w * 0.36 + ind + len, top, z);
    }
  }
  if (pts.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial(additive(0.45)));
  }
  if (kind === "pkg") {
    const grp = new THREE.Group();
    const box = new THREE.EdgesGeometry(new THREE.BoxGeometry(13, 11, 13));
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
      const m = new THREE.LineSegments(box, new THREE.LineBasicMaterial(additive(0.55)));
      m.position.set(-w * 0.32 + i * w * 0.16, h / 2 + 5.5, -d * 0.24 + j * d * 0.24);
      grp.add(m);
    }
    return grp;
  }
  if (kind === null) {
    const inset = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w * 0.76, d * 0.76)), new THREE.LineBasicMaterial(additive(0.35)));
    inset.rotation.x = -Math.PI / 2;
    inset.position.y = h / 2 + 0.5;
    return inset;
  }
  return null;
}

const setOpacity = (o: THREE.Object3D, op: number) =>
  o.traverse((c) => {
    const m = (c as THREE.Mesh).material as THREE.Material | undefined;
    if (m) m.opacity = op;
  });

function build(node: GraphNode, hasLab: boolean) {
  const group = new THREE.Group();
  const parts = node.parts.map((p, i) => {
    const thin = p.kind === "meta" || p.kind === "rw";
    const w = 220 - i * 16, d = w * 0.64, h = p.kind === "meta" ? 5 : p.kind === "rw" ? 8 : 14;
    const g = new THREE.Group(), geo = new THREE.BoxGeometry(w, h, d);
    const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial(additive(p.kind === "meta" ? 0 : 0.05)));
    const edge = thin ? dashed(geo, 0.8) : new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial(additive(0.8)));
    const inset = detail(p.kind, w, h, d);
    const lead = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(w / 2, 0, 0), new THREE.Vector3(w / 2 + 90, 0, 0)]),
      new THREE.LineBasicMaterial(additive(0)),
    );
    g.add(fill, edge, lead);
    if (inset) g.add(inset);
    group.add(g);
    return { part: p, g, fill, edge, inset, lead, anchor: new THREE.Vector3(w / 2 + 96, 0, 0), y: 0, lo: 0, el: null as HTMLDivElement | null, txt: "" };
  });

  const containers = hasLab
    ? [0, 1, 2].map(() => {
        const g = new THREE.Group(), geo = new THREE.BoxGeometry(124, 7, 80);
        const plate = dashed(geo, 0.9), fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial(additive(0.06)));
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial(additive(0.5)));
        g.add(plate, fill);
        group.add(g, line);
        return { g, plate, fill, line, x: 0, vis: 0, el: null as HTMLDivElement | null };
      })
    : [];

  const logo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(markCanvas(node)), color: 0xdcf4ff, transparent: true, depthWrite: false }));
  logo.scale.setScalar(50);
  group.add(logo);

  const base = new THREE.Group();
  for (const [r, st, len, sp, op] of [[132, 0, Math.PI * 1.5, 0.002, 0.5], [146, 1, Math.PI * 0.7, -0.003, 0.3], [162, 0, Math.PI * 2, 0, 0.12]]) {
    const m = new THREE.Mesh(new THREE.RingGeometry(r, r + 1.4, 128, 1, st, len), new THREE.MeshBasicMaterial({ ...additive(op), side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.userData.sp = sp;
    base.add(m);
  }
  const root = new THREE.Group();
  root.add(group, base);
  const dispose = () =>
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as (THREE.Material & { map?: THREE.Texture }) | undefined;
      mat?.map?.dispose();
      mat?.dispose();
    });
  return { root, group, parts, containers, logo, base, dispose };
}

function Stage({ node, store, scroller, firstPart, labels }: Props) {
  const { camera, size } = useThree();
  const [scene] = useState(() => build(node, Boolean(node.lab)));
  const st = useRef({ e: 0, labK: 0, rot: 0.6, openAt: 0, reduce: false });

  useEffect(() => {
    st.current.reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    st.current.openAt = performance.now() + 150;
    return () => scene.dispose();
  }, [scene]);

  useEffect(() => {
    const host = labels.current;
    if (!host) return;
    const make = (text: string) => {
      const el = document.createElement("div");
      el.className = "pl";
      el.textContent = text;
      host.appendChild(el);
      return el;
    };
    for (const p of scene.parts) { p.el = make(p.part.name); p.txt = p.part.name; }
    scene.containers.forEach((c, i) => (c.el = make(`Container ${i + 1}, writable`)));
    return () => {
      for (const p of scene.parts) p.el?.remove();
      for (const c of scene.containers) c.el?.remove();
    };
  }, [scene, labels]);

  const tv = useRef(new THREE.Vector3());
  useFrame(() => {
    const s = st.current, now = performance.now(), { act, labOn, lab, drag } = store.current;
    const ea = s.reduce ? 1 : eOut(clamp01((now - s.openAt) / 1000));
    const el = scroller.current, first = firstPart.current;
    const range = first ? Math.max(1, first.offsetTop - size.height * 0.3) : 1;
    const target = el ? clamp01(el.scrollTop / range) : 0;
    s.e += (target - s.e) * (s.reduce ? 1 : 0.1);
    s.labK += ((labOn && lab ? 1 : 0) - s.labK) * (s.reduce ? 1 : 0.08);
    const ee = s.e * s.e * (3 - 2 * s.e), L = s.labK, ex = ee * (1 - L), N = scene.parts.length;

    const still = Math.max(ee, L);
    if (!s.reduce) s.rot += 0.004 * (1 - still);
    const rest = -0.55 + TAU * Math.round((s.rot + 0.55) / TAU);
    s.rot += (rest - s.rot) * 0.08 * still;
    scene.group.rotation.y = s.rot + drag;

    const gap = 16 + 8 * L;
    scene.parts.forEach((p, i) => {
      const lp = lab?.parts[i];
      const c = i - (N - 1) / 2, isAct = act === i && !labOn, dim = act >= 0 && !isAct && ex > 0.5;
      const lv = lab ? (p.part.kind === "rw" ? 0 : (lp?.vis ?? 1)) : 1;
      const vis = 1 + (lv - 1) * L;
      const pending = lp?.drop != null && now < lp.drop;
      const dt = lp?.drop == null ? 1 : clamp01((now - lp.drop) / 650);
      const drop = L * (pending ? 150 : (1 - eOut(dt)) * 150);
      const fl = lp?.flash ? Math.max(0, 1 - (now - lp.flash) / 1100) : 0;
      p.y = c * gap + (c * 66 - c * gap) * ex + c * 240 * (1 - ea) + drop;
      p.g.position.set(ex * (i % 2 ? 8 : -8), p.y, 0);
      p.g.rotation.y = ex * c * 0.06;
      const k = ea * vis * (pending ? 0 : 1);
      (p.edge.material as THREE.LineBasicMaterial).opacity = (dim ? 0.28 : isAct ? 1 : 0.8) * k;
      (p.edge.material as THREE.LineBasicMaterial).color.copy(isAct || fl > 0 ? BRIGHT : CYAN);
      (p.fill.material as THREE.MeshBasicMaterial).opacity = (p.part.kind === "meta" ? 0 : isAct ? 0.17 : 0.05 + fl * 0.25) * k;
      if (p.inset) setOpacity(p.inset, (dim ? 0.1 : 0.4) * k);
      (p.lead.material as THREE.LineBasicMaterial).opacity = Math.max(clamp01((ex - 0.55) / 0.45) * (dim ? 0.3 : 0.85), L * lv * dt * 0.7) * k;
      p.lo = Math.max(clamp01((ex - 0.55) / 0.45), L * lv * dt) * k;
      const txt = p.part.name + (L > 0.5 && lp?.state ? `  ${lp.state}` : "");
      if (p.el && txt !== p.txt) { p.el.textContent = txt; p.txt = txt; }
    });

    const visible = scene.parts.filter((p) => !(lab && L > 0.5 && p.part.kind === "rw"));
    const top = visible.length ? visible[visible.length - 1].y : 0, bottom = scene.parts[0]?.y ?? 0;
    scene.logo.position.set(0, top + 46 + ex * 14, 0);
    scene.logo.material.opacity = ea * (1 - L);

    scene.containers.forEach((ct, k) => {
      const drop = lab?.containerDrops[k] ?? null;
      const on = lab && k < lab.containers && drop != null, ap = on ? eOut(clamp01((now - drop!) / 550)) : 0;
      const tx = (k - (lab ? lab.containers - 1 : 0) / 2) * 150;
      ct.x += (tx - ct.x) * 0.12;
      const y = top + 100 + (1 - ap) * 70;
      ct.g.position.set(ct.x, y, 0);
      (ct.plate.material as THREE.LineDashedMaterial).opacity = ap * L * 0.95;
      (ct.fill.material as THREE.MeshBasicMaterial).opacity = ap * L * 0.07;
      const pa = ct.line.geometry.attributes.position as THREE.BufferAttribute;
      pa.setXYZ(0, ct.x, y - 4, 0);
      pa.setXYZ(1, ct.x * 0.2, top + 8, 0);
      pa.needsUpdate = true;
      (ct.line.material as THREE.LineBasicMaterial).opacity = ap * L * 0.45;
      ct.vis = ap * L;
    });

    scene.base.position.y = bottom - 70;
    if (!s.reduce) for (const m of scene.base.children) m.rotation.z += m.userData.sp;
    const dist = 580 + ex * N * 58 + L * (lab?.containers ? 150 : 60);
    const cy = (top + bottom) / 2 + L * (lab?.containers ? 60 : 0);
    camera.position.set(dist * 0.5, dist * 0.36 + cy, dist * 0.79);
    camera.lookAt(0, cy, 0);

    const v = tv.current;
    const place = (el: HTMLDivElement | null, o: THREE.Object3D, local: THREE.Vector3, op: number) => {
      if (!el) return;
      v.copy(local);
      o.localToWorld(v);
      v.project(camera);
      el.style.opacity = op.toFixed(2);
      el.style.transform = `translate(${(((v.x + 1) / 2) * size.width + 6).toFixed(1)}px,${(((1 - v.y) / 2) * size.height - 9).toFixed(1)}px)`;
    };
    scene.parts.forEach((p, i) => {
      place(p.el, p.g, p.anchor, p.lo * (act >= 0 && act !== i && !labOn ? 0.5 : 1));
      p.el?.classList.toggle("act", act === i && !labOn);
    });
    const plateEdge = new THREE.Vector3(66, 0, 0);
    scene.containers.forEach((ct) => place(ct.el, ct.g, plateEdge, ct.vis));
  });

  return <primitive object={scene.root} />;
}
