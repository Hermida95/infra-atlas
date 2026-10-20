import * as THREE from "three";
import type { PartKind } from "@/lib/graph";

/*
 * One holographic 3D primitive per part kind. Every shape is drawn with three roles of
 * material so the scene can light, dim and fade any part the same way:
 *   edge   - the bright outline (brightens when the part is being read)
 *   fill   - a faint additive body
 *   detail - inner lines that say what the part is (packages, code, pods, vents...)
 */
export type Role = "edge" | "fill" | "detail";
export type ShapeMaterial = { mat: THREE.Material & { opacity: number }; base: number; role: Role; color?: THREE.Color };
export type Shape = { obj: THREE.Group; w: number; h: number; d: number; mats: ShapeMaterial[] };

const CYAN = new THREE.Color(0x7fe3ff);

class Builder {
  obj = new THREE.Group();
  mats: ShapeMaterial[] = [];

  private material<M extends THREE.Material & { opacity: number }>(mat: M, base: number, role: Role) {
    this.mats.push({ mat, base, role, color: "color" in mat ? (mat.color as THREE.Color) : undefined });
    return mat;
  }
  private additive(op: number) {
    return { color: CYAN.clone(), transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending };
  }

  edges(geo: THREE.BufferGeometry, at: [number, number, number] = [0, 0, 0], opts: { role?: Role; base?: number; dashed?: boolean; threshold?: number } = {}) {
    const role = opts.role ?? "edge", base = opts.base ?? (role === "edge" ? 0.8 : 0.45);
    const eg = new THREE.EdgesGeometry(geo, opts.threshold ?? 1);
    const mat = opts.dashed
      ? this.material(new THREE.LineDashedMaterial({ ...this.additive(base), dashSize: 6, gapSize: 5 }), base, role)
      : this.material(new THREE.LineBasicMaterial(this.additive(base)), base, role);
    const l = new THREE.LineSegments(eg, mat);
    if (opts.dashed) l.computeLineDistances();
    l.position.set(...at);
    this.obj.add(l);
    return l;
  }
  fill(geo: THREE.BufferGeometry, at: [number, number, number] = [0, 0, 0], base = 0.05) {
    const m = new THREE.Mesh(geo, this.material(new THREE.MeshBasicMaterial({ ...this.additive(base), side: THREE.DoubleSide }), base, "fill"));
    m.position.set(...at);
    this.obj.add(m);
    return m;
  }
  solid(geo: THREE.BufferGeometry, at: [number, number, number] = [0, 0, 0], opts: { base?: number; dashed?: boolean; fill?: number; threshold?: number } = {}) {
    if (opts.fill !== 0) this.fill(geo, at, opts.fill ?? 0.05);
    return this.edges(geo, at, { base: opts.base, dashed: opts.dashed, threshold: opts.threshold });
  }
  lines(pts: number[], role: Role = "detail", base = 0.45) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const l = new THREE.LineSegments(g, this.material(new THREE.LineBasicMaterial(this.additive(base)), base, role));
    this.obj.add(l);
    return l;
  }
  circle(r: number, y = 0, role: Role = "edge", base = 0.8, segments = 96) {
    const pts: number[] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2, b = ((i + 1) / segments) * Math.PI * 2;
      pts.push(Math.cos(a) * r, y, Math.sin(a) * r, Math.cos(b) * r, y, Math.sin(b) * r);
    }
    return this.lines(pts, role, base);
  }
  done(w: number, h: number, d: number): Shape {
    return { obj: this.obj, w, h, d, mats: this.mats };
  }
}

/** Short horizontal strokes on a top face: code, logs, config. */
function strokes(b: Builder, w: number, d: number, y: number, n = 7) {
  const pts: number[] = [];
  for (let j = 0; j < n; j++) {
    const z = -d * 0.32 + (d * 0.64 * j) / (n - 1), ind = (j % 3) * 12, len = w * (0.22 + ((j * 37) % 5) / 12);
    pts.push(-w * 0.36 + ind, y, z, -w * 0.36 + ind + len, y, z);
  }
  b.lines(pts);
}

/** `index` lets stacked slabs taper upwards, like the original Docker teardown. */
export function buildShape(kind: PartKind | null, index: number): Shape {
  const b = new Builder();
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

  switch (kind) {
    // ---- Layered slabs (Docker) ----
    case null:
    case "os":
    case "pkg":
    case "code":
    case "meta":
    case "rw": {
      const w = 220 - index * 16, d = w * 0.64, h = kind === "meta" ? 5 : kind === "rw" ? 8 : 14;
      const thin = kind === "meta" || kind === "rw";
      b.solid(box(w, h, d), [0, 0, 0], { dashed: thin, fill: kind === "meta" ? 0 : 0.05 });
      const top = h / 2 + 0.6;
      if (kind === "os") {
        const pts: number[] = [];
        for (let i = 1; i < 8; i++) { const x = -w * 0.38 + (w * 0.76 * i) / 8; pts.push(x, top, -d * 0.38, x, top, d * 0.38); }
        for (let j = 1; j < 6; j++) { const z = -d * 0.38 + (d * 0.76 * j) / 6; pts.push(-w * 0.38, top, z, w * 0.38, top, z); }
        b.lines(pts);
      } else if (kind === "code") strokes(b, w, d, top);
      else if (kind === "pkg") {
        const cube = box(13, 11, 13);
        for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) b.edges(cube, [-w * 0.32 + i * w * 0.16, h / 2 + 5.5, -d * 0.24 + j * d * 0.24], { role: "detail", base: 0.55 });
      } else if (kind === null) b.edges(new THREE.PlaneGeometry(w * 0.76, d * 0.76).rotateX(-Math.PI / 2).translate(0, h / 2 + 0.5, 0), [0, 0, 0], { role: "detail", base: 0.35 });
      return b.done(w, h, d);
    }

    // ---- Kubernetes ----
    case "node": {
      // Three worker machines side by side, each with a kubelet strip at the base.
      for (const x of [-140, 0, 140]) {
        b.solid(box(116, 46, 84), [x, 0, 0]);
        b.lines([x - 50, -16, 36, x + 50, -16, 36, x - 50, -16, -36, x + 50, -16, -36], "detail", 0.35);
      }
      return b.done(400, 46, 84);
    }
    case "pod": {
      // Two pods per node: capsules that sit inside the node boxes when assembled.
      const cap = new THREE.CapsuleGeometry(10, 14, 4, 10);
      for (const x of [-140, 0, 140]) for (const dx of [-24, 24]) b.edges(cap, [x + dx, 0, 0], { threshold: 25, base: 0.85 });
      return b.done(400, 34, 20);
    }
    case "bus": {
      // The Service: one stable bar under all nodes with a tap to every pod.
      b.solid(box(420, 5, 12));
      const taps: number[] = [];
      for (const x of [-164, -116, -24, 24, 116, 164]) taps.push(x, 2.5, 0, x, 26, 0);
      b.lines(taps, "detail", 0.5);
      return b.done(420, 30, 12);
    }
    case "orbit": {
      // Controllers: a reconciliation loop circling the cluster, with three controllers on it.
      b.circle(190, 0, "edge", 0.7);
      const oct = new THREE.OctahedronGeometry(9);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.4;
        b.solid(oct, [Math.cos(a) * 190, 0, Math.sin(a) * 190], { fill: 0.08 });
      }
      return b.done(380, 18, 380);
    }
    case "core": {
      // Control plane: hexagonal API server around a dashed etcd cylinder.
      b.solid(new THREE.CylinderGeometry(56, 56, 26, 6));
      b.edges(new THREE.CylinderGeometry(18, 18, 34, 24), [0, 0, 0], { role: "detail", dashed: true, base: 0.6, threshold: 30 });
      return b.done(112, 34, 112);
    }

    // ---- Compute ----
    case "machine": {
      // A server / VM / runner: box, vent lines and a status strip.
      b.solid(box(110, 64, 80));
      const v: number[] = [];
      for (let i = 0; i < 6; i++) v.push(-40, -18 + i * 7, 40.5, 20, -18 + i * 7, 40.5);
      v.push(30, 22, 40.5, 46, 22, 40.5);
      b.lines(v, "detail", 0.45);
      return b.done(110, 64, 80);
    }

    // ---- Data and files ----
    case "cylinder": {
      // Database / state / runtime: a cylinder with storage rings.
      b.solid(new THREE.CylinderGeometry(46, 46, 62, 40), [0, 0, 0], { threshold: 30 });
      b.circle(46.5, -10, "detail", 0.4);
      b.circle(46.5, 10, "detail", 0.4);
      return b.done(92, 62, 92);
    }
    case "discs": {
      // Knowledge base / vector store: thin stacked disks of chunks.
      for (const y of [-12, 0, 12]) b.solid(new THREE.CylinderGeometry(60, 60, 4, 48), [0, y, 0], { threshold: 30, fill: 0.04 });
      return b.done(120, 28, 120);
    }
    case "sheet": {
      // A file: config, workflow YAML.
      b.solid(box(150, 3, 104));
      strokes(b, 150, 104, 2.2);
      return b.done(150, 3, 104);
    }
    case "plugin": {
      // Providers: plugin blocks with connector teeth.
      for (const x of [-70, 0, 70]) {
        b.solid(box(54, 22, 54), [x, 0, 0]);
        for (const dz of [-12, 12]) b.edges(box(8, 8, 8), [x, 15, dz], { role: "detail", base: 0.55 });
      }
      return b.done(194, 30, 54);
    }
    case "modules": {
      // Modules: a box that contains smaller boxes.
      b.solid(box(170, 34, 110), [0, 0, 0], { dashed: true });
      for (const x of [-40, 40]) b.edges(box(64, 20, 70), [x, 0, 0], { role: "detail", base: 0.6 });
      return b.done(170, 34, 110);
    }
    case "graph": {
      // Dependency graph: nodes and directed edges in a plane.
      const pts: [number, number][] = [[-70, -30], [-70, 30], [0, 0], [70, -34], [70, 34]];
      const oct = new THREE.OctahedronGeometry(8);
      for (const [x, z] of pts) b.solid(oct, [x, 0, z], { fill: 0.08 });
      const e: number[] = [];
      for (const [a, c] of [[0, 2], [1, 2], [2, 3], [2, 4]]) e.push(pts[a][0], 0, pts[a][1], pts[c][0], 0, pts[c][1]);
      b.lines(e, "detail", 0.55);
      return b.done(156, 16, 84);
    }

    // ---- Pipelines ----
    case "trigger": {
      // An event: a spark with an arrow pointing into the pipeline.
      b.solid(new THREE.OctahedronGeometry(18), [0, 0, 0], { fill: 0.08 });
      b.lines([26, 0, 0, 62, 0, 0, 62, 0, 0, 52, 0, 8, 62, 0, 0, 52, 0, -8], "detail", 0.6);
      return b.done(90, 36, 36);
    }
    case "jobs": {
      // Jobs: parallel lanes.
      for (const z of [-36, 0, 36]) b.solid(box(120, 16, 24), [0, 0, z]);
      return b.done(120, 16, 96);
    }
    case "chips": {
      // Steps: a row of small chips run in order.
      for (let i = 0; i < 5; i++) b.solid(box(26, 10, 26), [-64 + i * 32, 0, 0]);
      return b.done(154, 10, 26);
    }

    // ---- Cloud and network ----
    case "disc": {
      // Region: a wide flat platform.
      b.solid(new THREE.CylinderGeometry(150, 150, 6, 72), [0, 0, 0], { threshold: 30, fill: 0.04 });
      return b.done(300, 6, 300);
    }
    case "zones": {
      // Availability zones: three separate pads.
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
        b.solid(new THREE.CylinderGeometry(48, 48, 5, 48), [Math.cos(a) * 78, 0, Math.sin(a) * 78], { threshold: 30, fill: 0.05 });
      }
      return b.done(252, 5, 252);
    }
    case "vpc": {
      // VPC: a dashed boundary spanning the zones.
      b.solid(box(250, 40, 250), [0, 0, 0], { dashed: true, fill: 0.02 });
      return b.done(250, 40, 250);
    }
    case "services": {
      // Services: a grid of building blocks.
      const cube = box(26, 26, 26);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) b.solid(cube, [i * 52, 0, j * 52]);
      return b.done(130, 26, 130);
    }
    case "shell": {
      // IAM / guardrails: a wireframe dome around everything.
      // A hemisphere of radius 150, centred so its declared height matches what is drawn.
      b.edges(new THREE.SphereGeometry(150, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), [0, -75, 0], { threshold: 1, base: 0.35 });
      return b.done(300, 150, 300);
    }
    case "ring": {
      // A boundary or an interface: role, port, runtime API.
      b.circle(70, 0, "edge", 0.85);
      b.circle(58, 0, "detail", 0.35);
      const pin = box(10, 10, 10);
      for (let i = 0; i < 4; i++) b.edges(pin, [Math.cos((i * Math.PI) / 2) * 70, 0, Math.sin((i * Math.PI) / 2) * 70], { role: "detail", base: 0.6 });
      return b.done(150, 10, 150);
    }

    // ---- Observability and AI ----
    case "bars": {
      // Metrics: a bar chart.
      const hs = [24, 40, 30, 56, 44];
      hs.forEach((h, i) => b.solid(box(18, h, 18), [-56 + i * 28, h / 2 - 28, 0]));
      return b.done(140, 56, 18);
    }
    case "bell": {
      // Alarms: a bell with a ring.
      b.solid(new THREE.ConeGeometry(30, 44, 20, 1, true), [0, 4, 0], { threshold: 30 });
      b.circle(30, -18, "detail", 0.6, 40);
      return b.done(60, 52, 60);
    }
    case "panel": {
      // Dashboards: a grid of tiles on a tilted board.
      const grp = new Builder();
      for (const [x, z] of [[-34, -22], [34, -22], [-34, 22], [34, 22]]) grp.solid(box(60, 2, 38), [x, 0, z]);
      grp.obj.rotation.x = -0.5;
      b.obj.add(grp.obj);
      b.mats.push(...grp.mats);
      return b.done(140, 50, 90);
    }
    case "sphere": {
      // A foundation model: a faceted core.
      b.solid(new THREE.IcosahedronGeometry(52, 1), [0, 0, 0], { fill: 0.06 });
      return b.done(104, 104, 104);
    }
    case "satellites": {
      // Agents: small bodies that go out and call tools.
      b.circle(110, 0, "detail", 0.3);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.9;
        b.solid(new THREE.IcosahedronGeometry(12, 0), [Math.cos(a) * 110, 0, Math.sin(a) * 110], { fill: 0.08 });
      }
      return b.done(244, 24, 244);
    }
  }
}
