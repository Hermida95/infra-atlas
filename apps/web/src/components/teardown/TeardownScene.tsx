"use client";

/* Imperative Three.js scene mutated every frame inside useFrame (see BrainScene for why). */
/* eslint-disable react-hooks/immutability */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { GraphNode } from "@/lib/graph";
import { markCanvas } from "@/lib/textures";
import { placeParts } from "./layouts";
import { buildShape, type Shape } from "./shapes";

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

type Piece = {
  shape: Shape;
  g: THREE.Group;
  lead: THREE.Line;
  leadMat: THREE.LineBasicMaterial;
  from: THREE.Vector3;
  to: THREE.Vector3;
  el: HTMLDivElement | null;
  txt: string;
  lo: number;
};

function build(node: GraphNode, hasLab: boolean) {
  const group = new THREE.Group();
  const pieces: Piece[] = node.parts.map((p, i) => {
    const shape = buildShape(p.kind, i);
    const g = new THREE.Group();
    g.add(shape.obj);
    const leadMat = new THREE.LineBasicMaterial(additive(0));
    const lead = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), leadMat);
    g.add(lead);
    group.add(g);
    return { shape, g, lead, leadMat, from: new THREE.Vector3(), to: new THREE.Vector3(), el: null, txt: p.name, lo: 0 };
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
  return { root, group, pieces, containers, logo, base, dispose };
}

function Stage({ node, store, scroller, firstPart, labels }: Props) {
  const { camera, size } = useThree();
  const [scene] = useState(() => build(node, Boolean(node.lab)));
  const st = useRef({ e: 0, labK: 0, rot: 0.6, dist: 900, openAt: 0, reduce: false });
  const kinds = node.parts.map((p) => p.kind);
  const shapes = scene.pieces.map((p) => p.shape);
  // Stacks are seen three-quarters. Rows and clusters turn their x axis perpendicular to the
  // camera's view (atan(0.5 / 0.79) ~ 0.56 rad) so their width reads straight left to right.
  const restAngle = node.layout === "stack" ? -0.55 : 0.56;

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
    node.parts.forEach((p, i) => (scene.pieces[i].el = make(p.name)));
    scene.containers.forEach((c, i) => (c.el = make(`Container ${i + 1}`)));
    return () => {
      for (const p of scene.pieces) p.el?.remove();
      for (const c of scene.containers) c.el?.remove();
    };
  }, [scene, labels, node]);

  const tv = useRef(new THREE.Vector3());
  useFrame(() => {
    const s = st.current, now = performance.now(), { act, labOn, lab, drag } = store.current;
    const ea = s.reduce ? 1 : eOut(clamp01((now - s.openAt) / 1000));
    const el = scroller.current, first = firstPart.current;
    const range = first ? Math.max(1, first.offsetTop - size.height * 0.3) : 1;
    s.e += ((el ? clamp01(el.scrollTop / range) : 0) - s.e) * (s.reduce ? 1 : 0.1);
    s.labK += ((labOn && lab ? 1 : 0) - s.labK) * (s.reduce ? 1 : 0.08);
    const ee = s.e * s.e * (3 - 2 * s.e), L = s.labK, ex = ee * (1 - L), N = scene.pieces.length;

    const still = Math.max(ee, L);
    if (!s.reduce) s.rot += 0.004 * (1 - still);
    const rest = restAngle + TAU * Math.round((s.rot - restAngle) / TAU);
    s.rot += (rest - s.rot) * 0.08 * still;
    scene.group.rotation.y = s.rot + drag;

    const places = placeParts(node.layout, shapes, kinds, 8 * L);
    let minY = Infinity, maxY = -Infinity, radius = 0, topY = -Infinity;
    scene.pieces.forEach((p, i) => {
      const lp = lab?.parts[i];
      const kind = node.parts[i].kind;
      const c = i - (N - 1) / 2, isAct = act === i && !labOn, dim = act >= 0 && !isAct && ex > 0.5;
      const lv = lab ? (kind === "rw" ? 0 : (lp?.vis ?? 1)) : 1;
      const vis = 1 + (lv - 1) * L;
      const pending = lp?.drop != null && now < lp.drop;
      const dt = lp?.drop == null ? 1 : clamp01((now - lp.drop) / 650);
      const drop = L * (pending ? 150 : (1 - eOut(dt)) * 150);
      const fl = lp?.flash ? Math.max(0, 1 - (now - lp.flash) / 1100) : 0;

      // Assemble from scattered pieces on open, then interpolate assembled -> exploded.
      const { assembled: A, exploded: E, lead } = places[i];
      const intro = c * 240 * (1 - ea);
      const x = A[0] + (E[0] - A[0]) * ex + (node.layout === "row" ? intro : 0);
      const y = A[1] + (E[1] - A[1]) * ex + (node.layout === "row" ? 0 : intro) + drop;
      p.g.position.set(x, y, A[2] + (E[2] - A[2]) * ex);
      p.g.rotation.y = node.layout === "stack" ? ex * c * 0.06 : 0;

      const k = ea * vis * (pending ? 0 : 1);
      for (const m of p.shape.mats) {
        const f =
          m.role === "edge" ? (dim ? 0.35 : isAct ? 1.25 : 1) :
          m.role === "fill" ? (isAct ? 3.4 : 1 + fl * 5) :
          dim ? 0.25 : 1;
        m.mat.opacity = Math.min(1, m.base * f) * k;
        if (m.role === "edge" && m.color) m.color.copy(isAct || fl > 0 ? BRIGHT : CYAN);
      }

      const { w, h } = p.shape;
      // Narrow screens get shorter leader lines so the labels still fit.
      const reach = size.width < 500 ? 34 : 90;
      if (lead === "right") { p.from.set(w / 2 + 2, 0, 0); p.to.set(w / 2 + reach, 0, 0); }
      else { p.from.set(0, h / 2 + 2, 0); p.to.set(0, h / 2 + 64, 0); }
      const pos = p.lead.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, p.from.x, p.from.y, p.from.z);
      pos.setXYZ(1, p.to.x, p.to.y, p.to.z);
      pos.needsUpdate = true;
      p.lo = Math.max(clamp01((ex - 0.55) / 0.45), L * lv * dt) * k;
      p.leadMat.opacity = p.lo * (dim ? 0.35 : 0.85);
      const txt = node.parts[i].name + (L > 0.5 && lp?.state ? `  ${lp.state}` : "");
      if (p.el && txt !== p.txt) { p.el.textContent = txt; p.txt = txt; }

      minY = Math.min(minY, y - h / 2);
      maxY = Math.max(maxY, y + h / 2);
      if (!(lab && L > 0.5 && kind === "rw")) topY = Math.max(topY, y + h / 2);
      radius = Math.max(radius, Math.hypot(x, A[2]) + Math.max(w, p.shape.d) / 2);
    });

    // Row labels point up, so the logo floats higher to stay clear of them.
    scene.logo.position.set(0, maxY + (node.layout === "row" ? 110 : 40) + ex * 14, 0);
    scene.logo.material.opacity = ea * (1 - L);

    // Containers line up along the screen's horizontal axis (perpendicular to the camera at the
    // resting angle), each plate turned along that line, so three of them never overlap.
    const across = 0.56 - restAngle, ax = Math.cos(across), az = -Math.sin(across);
    scene.containers.forEach((ct, k) => {
      const dropAt = lab?.containerDrops[k] ?? null;
      const on = lab && k < lab.containers && dropAt != null, ap = on ? eOut(clamp01((now - dropAt!) / 550)) : 0;
      const tx = (k - (lab ? lab.containers - 1 : 0) / 2) * 150;
      ct.x += (tx - ct.x) * 0.12;
      const y = topY + 96 + (1 - ap) * 70;
      ct.g.position.set(ct.x * ax, y, ct.x * az);
      ct.g.rotation.y = across;
      (ct.plate.material as THREE.LineDashedMaterial).opacity = ap * L * 0.95;
      (ct.fill.material as THREE.MeshBasicMaterial).opacity = ap * L * 0.07;
      const pa = ct.line.geometry.attributes.position as THREE.BufferAttribute;
      pa.setXYZ(0, ct.x * ax, y - 4, ct.x * az);
      pa.setXYZ(1, ct.x * ax * 0.2, topY + 4, ct.x * az * 0.2);
      pa.needsUpdate = true;
      (ct.line.material as THREE.LineBasicMaterial).opacity = ap * L * 0.45;
      ct.vis = ap * L;
    });

    scene.base.position.y = minY - 56;
    if (!s.reduce) for (const m of scene.base.children) m.rotation.z += m.userData.sp;

    // Frame whatever is on stage: its vertical span and its widest part.
    const span = Math.max(maxY - minY, 1) / 2 + (lab?.containers ? 70 * L : 0);
    // fov 36: the visible height is ~0.65 x distance, so a half-span needs ~3 x itself (plus room for the high camera angle).
    const want = 200 + Math.max(radius * (node.layout === "row" ? 2.4 : 1.9), span * 3.4);
    s.dist += (want - s.dist) * (s.reduce ? 1 : 0.08);
    const cy = (minY + maxY) / 2 + L * (lab?.containers ? 60 : 0);
    camera.position.set(s.dist * 0.5, s.dist * 0.36 + cy, s.dist * 0.79);
    camera.lookAt(0, cy, 0);
    // Labels hang off the right side of each part: shift the object left to leave them room.
    const pc = camera as THREE.PerspectiveCamera;
    const shift = node.layout === "row" ? 0 : Math.round(size.width * (size.width < 500 ? 0.16 : 0.1));
    if (pc.view?.offsetX !== shift || pc.view?.fullWidth !== size.width) pc.setViewOffset(size.width, size.height, shift, 0, size.width, size.height);

    const v = tv.current;
    const place = (label: HTMLDivElement | null, o: THREE.Object3D, local: THREE.Vector3, op: number, centred: boolean) => {
      if (!label) return;
      v.copy(local);
      o.localToWorld(v);
      v.project(camera);
      const sx = ((v.x + 1) / 2) * size.width, sy = ((1 - v.y) / 2) * size.height;
      label.style.opacity = op.toFixed(2);
      label.style.transform = centred
        ? `translate(${sx.toFixed(1)}px,${(sy - 22).toFixed(1)}px) translateX(-50%)`
        : `translate(${(sx + 6).toFixed(1)}px,${(sy - 9).toFixed(1)}px)`;
    };
    scene.pieces.forEach((p, i) => {
      place(p.el, p.g, p.to, p.lo * (act >= 0 && act !== i && !labOn ? 0.5 : 1), places[i].lead === "up");
      p.el?.classList.toggle("act", act === i && !labOn);
    });
    const plateTop = new THREE.Vector3(0, 6, 0);
    scene.containers.forEach((ct) => place(ct.el, ct.g, plateTop, ct.vis, true));
  });

  return <primitive object={scene.root} />;
}
