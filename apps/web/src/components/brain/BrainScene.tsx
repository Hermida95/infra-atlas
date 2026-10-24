"use client";

/* The scene graph is plain Three.js: it is built once and mutated every frame inside
   useFrame, outside React's render cycle. That is the intended R3F pattern, so the
   React Compiler immutability rule does not apply to this file. */
/* eslint-disable react-hooks/immutability */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { domainById, graph, type GraphNode, neighbours } from "@/lib/graph";
import { hasMark } from "@/lib/logos";
import type { Route } from "@/lib/planner";
import { glowTexture, markCanvas } from "@/lib/textures";
import { STAGE_COLORS } from "@/lib/stages";

export type MapStore = {
  hover: GraphNode | null;
  selected: GraphNode | null;
  /** The planner route currently lit in gold, and when it was lit (for the staggered reveal). */
  route: Route | null;
  routeAt: number;
  /** Desktop layout reserves the left side for the planner panel. */
  shiftX: number;
};

type Props = {
  store: RefObject<MapStore>;
  labels: RefObject<HTMLDivElement | null>;
  onSelect: (node: GraphNode | null) => void;
  /** Stop rendering while another full-screen view covers the map. */
  paused?: boolean;
};

// The hologram is tuned for additive light in plain sRGB, like the prototype:
// no colour management and no tone mapping.
THREE.ColorManagement.enabled = false;

const RAD = 240;
const CYAN = new THREE.Color(0x7fe3ff);
const WHITE = new THREE.Color(1, 1, 1);
const GOLD = new THREE.Color(0xffc46b);
// One THREE.Color per stage, built once: the route is repainted every frame and a route of
// forty nodes would otherwise parse the same nine hex strings sixty times a second.
const STAGE_LIT = STAGE_COLORS.map((hex) => new THREE.Color(hex));

export default function BrainScene({ paused = false, ...props }: Props) {
  return (
    <Canvas
      frameloop={paused ? "never" : "always"}
      camera={{ fov: 48, near: 1, far: 6000, position: [0, 60, 920] }}
      dpr={[1, 2]}
      flat
      linear
      gl={{ antialias: true, alpha: false }}
      onCreated={({ gl }) => gl.setClearColor(0x04070b, 1)}
    >
      <fogExp2 attach="fog" args={[0x04070b, 0.00055]} />
      <World {...props} />
    </Canvas>
  );
}

type Item = {
  node: GraphNode;
  sprite: THREE.Sprite;
  mark: THREE.Sprite | null;
  color: THREE.Color;
  base: number;
  delay: number;
  a: number;
  ta: number;
  el: HTMLDivElement | null;
};

function buildScene() {
  const glow = glowTexture();
  const root = new THREE.Group();
  const brain = new THREE.Group();
  root.add(brain);

  const items: Item[] = graph.nodes.map((node) => {
    const pos = new THREE.Vector3(...node.position);
    const color = new THREE.Color().setHSL((domainById.get(node.domain)?.hue ?? 190) / 360, 0.75, 0.68);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glow, color: color.clone(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    sprite.position.copy(pos);
    brain.add(sprite);
    let mark: THREE.Sprite | null = null;
    if (hasMark(node)) {
      mark = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(markCanvas(node)), transparent: true, depthWrite: false, opacity: 0 }),
      );
      mark.position.copy(pos);
      brain.add(mark);
    }
    const base = node.hub ? 52 : 26;
    return { node, sprite, mark, color, base, delay: ((pos.x + RAD * 1.4) / (RAD * 2.8)) * 0.6, a: 0, ta: 0.9, el: null };
  });
  const byId = new Map(items.map((i) => [i.node.id, i]));

  const links = graph.links
    .map((l) => ({ s: byId.get(l.source)!, t: byId.get(l.target)!, cur: [0, 0, 0], tgt: [0, 0, 0] }))
    .filter((l) => l.s && l.t);
  const lPos = new Float32Array(links.length * 6);
  const lCol = new Float32Array(links.length * 6);
  links.forEach((l, i) => lPos.set([...l.s.node.position, ...l.t.node.position], i * 6));
  const lGeo = new THREE.BufferGeometry();
  lGeo.setAttribute("position", new THREE.BufferAttribute(lPos, 3));
  lGeo.setAttribute("color", new THREE.BufferAttribute(lCol, 3));
  brain.add(
    new THREE.LineSegments(
      lGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    ),
  );

  // Gold pulses that travel along lit links, from earlier route stages to later ones.
  const pPos = new Float32Array(links.length * 3);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  pGeo.setDrawRange(0, 0);
  brain.add(
    new THREE.Points(
      pGeo,
      new THREE.PointsMaterial({ size: 16, map: glow, color: GOLD, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    ),
  );

  // Brain-shaped particle shell. Seeded so every visitor sees the same brain.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const dust = new Float32Array(1600 * 3);
  for (let i = 0; i < 1600; i++) {
    const u = rand() * 2 - 1, th = rand() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const x = s * Math.cos(th), y = u, z = s * Math.sin(th);
    const r = (0.82 + rand() * 0.18) * (1 + 0.06 * Math.sin(x * 9) * Math.cos(z * 7) + 0.04 * Math.sin(y * 13));
    dust.set([x * r * RAD * 1.45, y * r * RAD * 0.95, z * r * RAD], i * 3);
  }
  const dGeo = new THREE.BufferGeometry();
  dGeo.setAttribute("position", new THREE.BufferAttribute(dust, 3));
  brain.add(
    new THREE.Points(
      dGeo,
      new THREE.PointsMaterial({ size: 2.8, color: CYAN, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }),
    ),
  );

  // Holo projector base.
  const base = new THREE.Group();
  base.position.y = -RAD * 1.02;
  root.add(base);
  const arcs: [THREE.Object3D, number, boolean][] = [];
  for (const [r, st, len, sp, op] of [
    [300, 0, Math.PI * 1.4, 0.0016, 0.55],
    [318, 1.2, Math.PI * 0.6, -0.0024, 0.35],
    [340, 2.4, Math.PI * 1.1, 0.001, 0.25],
    [262, 0.6, Math.PI * 0.35, -0.004, 0.6],
    [380, 0, Math.PI * 2, 0, 0.1],
  ]) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(r, r + 1.6, 128, 1, st, len),
      new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    m.rotation.x = -Math.PI / 2;
    base.add(m);
    arcs.push([m, sp, false]);
  }
  const ticks: number[] = [];
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2, r2 = i % 10 === 0 ? 370 : 360;
    ticks.push(Math.cos(a) * 352, 0, Math.sin(a) * 352, Math.cos(a) * r2, 0, Math.sin(a) * r2);
  }
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute("position", new THREE.Float32BufferAttribute(ticks, 3));
  const tickRing = new THREE.LineSegments(
    tGeo,
    new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending }),
  );
  base.add(tickRing);
  arcs.push([tickRing, 0.0008, true]);

  // Soft teal bloom behind the brain. The canvas is opaque, so additive light composes
  // against this backdrop exactly like the prototype did.
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glow, color: 0x0d3346, transparent: true, opacity: 0.9, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }),
  );
  halo.position.set(0, 0, -900);
  halo.scale.setScalar(4200);
  halo.renderOrder = -1;
  root.add(halo);

  const dispose = () =>
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material & { map?: THREE.Texture };
      mat?.map?.dispose();
      mat?.dispose?.();
    });

  return { root, brain, items, links, lGeo, lCol, pGeo, pPos, arcs, dispose };
}

function World({ store, labels, onSelect }: Omit<Props, "paused">) {
  const { camera, gl, size } = useThree();
  const [scene] = useState(buildScene);
  const view = useRef({
    rotY: -0.35, rotX: 0.12, tRotY: -0.35, tRotX: 0.12, dist: 920, tDist: 760, focusY: 0, tFocusY: 0,
    idleAt: 0, dragging: false, lastSel: null as GraphNode | null, t0: 0, boot: 0, reduce: false,
  });

  useEffect(() => () => scene.dispose(), [scene]);

  useEffect(() => {
    const v = view.current;
    v.reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    v.t0 = performance.now();
    v.boot = v.reduce ? 1 : 0;
  }, []);

  useEffect(() => {
    const host = labels.current;
    if (!host) return;
    for (const it of scene.items) {
      const el = document.createElement("div");
      el.className = "lb" + (it.node.hub ? " hub" : "");
      el.textContent = it.node.title;
      host.appendChild(el);
      it.el = el;
    }
    return () => {
      for (const it of scene.items) it.el?.remove();
    };
  }, [scene, labels]);

  useEffect(() => {
    const el = gl.domElement;
    const v = view.current;
    const tmp = new THREE.Vector3();
    let moved = 0, lastX = 0, lastY = 0;
    const pick = (x: number, y: number) => {
      let best: GraphNode | null = null, bd = Infinity;
      for (const it of scene.items) {
        it.sprite.getWorldPosition(tmp).project(camera);
        if (tmp.z > 1) continue;
        const sx = ((tmp.x + 1) / 2) * size.width, sy = ((1 - tmp.y) / 2) * size.height;
        const dd = (sx - x) ** 2 + (sy - y) ** 2, r = Math.max(16, it.base * 0.45);
        if (dd < r * r && dd < bd) { bd = dd; best = it.node; }
      }
      return best;
    };
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const down = (e: PointerEvent) => {
      v.dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (v.dragging) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        v.tRotY += dx * 0.006;
        v.tRotX = Math.max(-0.9, Math.min(0.9, v.tRotX + dy * 0.004));
        lastX = e.clientX; lastY = e.clientY; v.idleAt = performance.now();
      } else {
        store.current.hover = pick(...local(e));
        el.style.cursor = store.current.hover ? "pointer" : "grab";
      }
    };
    const up = (e: PointerEvent) => {
      v.dragging = false;
      if (moved < 5) onSelect(pick(...local(e)));
    };
    const leave = () => { store.current.hover = null; };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      v.tDist = Math.max(320, Math.min(1500, v.tDist * (1 + e.deltaY * 0.0012)));
      v.idleAt = performance.now();
    };
    el.style.cursor = "grab";
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("wheel", wheel);
    };
  }, [gl, camera, size, scene, store, onSelect]);

  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, delta) => {
    const v = view.current;
    const now = performance.now();
    const dt = Math.min(50, delta * 1000);
    const { hover, selected, route, routeAt, shiftX } = store.current;
    const lit = (id: string) => route?.order.has(id) ?? false;
    // Which colour a lit node takes: its stage. GOLD stays as the fallback for a node in the
    // route whose stage index is somehow missing -- better one wrong hue than a black sprite.
    const litColor = (id: string) => STAGE_LIT[route?.stageIndex.get(id) ?? -1] ?? GOLD;

    if (selected !== v.lastSel) {
      v.lastSel = selected;
      if (selected) {
        const [x, y, z] = selected.position;
        let target = -Math.atan2(x, z);
        while (target - v.tRotY > Math.PI) target -= Math.PI * 2;
        while (target - v.tRotY < -Math.PI) target += Math.PI * 2;
        Object.assign(v, { tRotY: target, tRotX: 0, tDist: 430, tFocusY: y * 0.7 });
      } else {
        Object.assign(v, { tDist: 760, tFocusY: 0, tRotX: 0.12, idleAt: now });
      }
    }

    if (!v.reduce && v.boot < 1) v.boot = Math.min(1, (now - v.t0) / 1600);
    const ease = 1 - Math.pow(1 - v.boot, 3);
    if (!v.reduce && !v.dragging && !selected && now - v.idleAt > 2500) v.tRotY += (0.0011 * dt) / 16;
    const k = v.reduce ? 1 : 0.08;
    v.rotY += (v.tRotY - v.rotY) * k;
    v.rotX += (v.tRotX - v.rotX) * k;
    v.dist += (v.tDist - v.dist) * k;
    v.focusY += (v.tFocusY - v.focusY) * k;
    scene.brain.rotation.set(v.rotX, v.rotY, 0);
    // Tuned for landscape screens: on a tall phone the brain is wider than the view, so back off
    // until its width fits (aspect 0.46 on a 375x812 phone -> about 2.4x further).
    const fit = Math.min(2.6, Math.max(1, 1.1 / (size.width / size.height)));
    camera.position.set(0, v.focusY + 60, v.dist * fit);
    camera.lookAt(0, v.focusY, 0);
    const pc = camera as THREE.PerspectiveCamera;
    if (pc.view?.offsetX !== -shiftX || pc.view?.fullWidth !== size.width) {
      pc.setViewOffset(size.width, size.height, -shiftX, 0, size.width, size.height);
    }
    if (!v.reduce) {
      for (const [m, sp, isTick] of scene.arcs) {
        if (isTick) m.rotation.y += (sp * dt) / 16;
        else m.rotation.z += (sp * dt) / 16;
      }
    }

    const focus = hover ?? selected;
    const near = focus ? neighbours.get(focus.id)! : null;
    const zoomK = 0.5 + 0.5 * Math.min(1, v.dist / 760);
    for (const it of scene.items) {
      const gold = lit(it.node.id);
      if (route) {
        const revealed = v.reduce || now - routeAt > route.order.get(it.node.id)! * 55;
        it.ta = gold ? (revealed ? 1 : 0.15) : 0.1;
      } else it.ta = focus ? (it.node === focus || near!.has(it.node.id) ? 1 : 0.15) : 0.85;
      it.a += (it.ta - it.a) * (v.reduce ? 1 : 0.12);
      const appear = v.reduce ? 1 : Math.max(0, Math.min(1, (ease - it.delay) / 0.4));
      const sel = it.node === selected ? 1.3 : 1;
      const pulse = gold && !v.reduce ? 1 + 0.12 * Math.sin(now / 260 + it.delay * 40) : 1;
      it.sprite.scale.setScalar(it.base * appear * sel * zoomK * (gold ? 1.1 : 1) * pulse);
      it.sprite.material.color.copy(gold ? litColor(it.node.id) : it.color);
      it.sprite.material.opacity = it.a * appear * (it.mark ? 0.5 : 1);
      if (it.mark) {
        it.mark.scale.setScalar((it.node.hub ? 36 : 17) * appear * (sel > 1 ? 1.25 : 1) * (0.6 + 0.4 * Math.min(1, v.dist / 760)));
        it.mark.material.color.copy(gold ? litColor(it.node.id) : CYAN).lerp(WHITE, gold ? 0.2 : 0.55);
        it.mark.material.opacity = Math.min(1, it.a * 1.1) * appear;
      }
    }
    scene.links.forEach((l, i) => {
      if (route) {
        const both = lit(l.s.node.id) && lit(l.t.node.id);
        const kk = both ? (Math.min(l.s.ta, l.t.ta) > 0.5 ? 1.1 : 0.1) : 0.04;
        l.tgt = both ? [kk, 0.77 * kk, 0.42 * kk] : [0.5 * kk, 0.89 * kk, kk];
      } else {
        const on = focus && (l.s.node === focus || l.t.node === focus);
        const kk = focus ? (on ? 1.2 : 0.08) : 0.42;
        l.tgt = [0.5 * kk, 0.89 * kk, kk];
      }
      const appear = v.reduce ? 1 : Math.max(0, Math.min(1, (ease - Math.max(l.s.delay, l.t.delay)) / 0.4));
      for (let j = 0; j < 3; j++) {
        l.cur[j] += (l.tgt[j] - l.cur[j]) * (v.reduce ? 1 : 0.1);
        scene.lCol[i * 6 + j] = scene.lCol[i * 6 + 3 + j] = l.cur[j] * appear;
      }
    });
    scene.lGeo.attributes.color.needsUpdate = true;

    let pulses = 0;
    if (route && !v.reduce && now - routeAt > route.order.size * 55) {
      scene.links.forEach((l, i) => {
        const a = route.stageIndex.get(l.s.node.id), b = route.stageIndex.get(l.t.node.id);
        if (a === undefined || b === undefined) return;
        const [from, to] = a <= b ? [l.s.node.position, l.t.node.position] : [l.t.node.position, l.s.node.position];
        const p = (now / 1500 + i * 0.37) % 1;
        for (let j = 0; j < 3; j++) scene.pPos[pulses * 3 + j] = from[j] + (to[j] - from[j]) * p;
        pulses++;
      });
    }
    scene.pGeo.setDrawRange(0, pulses);
    scene.pGeo.attributes.position.needsUpdate = true;

    for (const it of scene.items) {
      const el = it.el;
      if (!el) continue;
      const gold = lit(it.node.id);
      const show = v.boot > 0.9 && (it.node.hub || it.node === focus || near?.has(it.node.id) || (gold && it.a > 0.5) || v.dist < 480);
      if (!show) { el.style.opacity = "0"; continue; }
      it.sprite.getWorldPosition(tmp);
      const z = tmp.z;
      tmp.project(camera);
      if (tmp.z > 1) { el.style.opacity = "0"; continue; }
      const sx = ((tmp.x + 1) / 2) * size.width, sy = ((1 - tmp.y) / 2) * size.height;
      const depth = Math.max(0.55, Math.min(1, (z + RAD) / (RAD * 2)));
      el.style.transform = `translate(${(sx + it.base * 0.32 + (it.mark ? 10 : 0)).toFixed(1)}px,${(sy - 7).toFixed(1)}px)`;
      el.style.opacity = (Math.min(1, it.a * 1.2) * depth).toFixed(2);
      el.classList.toggle("on", gold);
      // The label is HTML, not WebGL: it takes the same colour through a custom property so
      // the key in the planner panel and the map always agree.
      if (gold) el.style.setProperty("--lit", `#${litColor(it.node.id).getHexString()}`);
      else el.style.removeProperty("--lit");
    }
  });

  return <primitive object={scene.root} />;
}
