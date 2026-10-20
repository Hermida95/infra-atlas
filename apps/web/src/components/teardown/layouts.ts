import type { Layout, PartKind } from "@/lib/graph";
import type { Shape } from "./shapes";

export type Vec3 = [number, number, number];
/** Where a part sits when assembled and when pulled apart, and which way its label points. */
export type Placement = { assembled: Vec3; exploded: Vec3; lead: "right" | "up" };

/** Kubernetes: nodes hold pods, the Service runs underneath, the control plane sits on top. */
const CLUSTER: Partial<Record<PartKind, { assembled: number; exploded: number }>> = {
  node: { assembled: 0, exploded: -70 },
  pod: { assembled: 0, exploded: 70 },
  bus: { assembled: -30, exploded: -180 },
  orbit: { assembled: 36, exploded: 160 },
  core: { assembled: 62, exploded: 260 },
};

/** Cumulative positions along one axis, centred on 0. */
function along(sizes: number[], gap: number): number[] {
  const total = sizes.reduce((a, b) => a + b, 0) + gap * (sizes.length - 1);
  let cursor = -total / 2;
  return sizes.map((s) => {
    const centre = cursor + s / 2;
    cursor += s + gap;
    return centre;
  });
}

/** `labGap` widens the assembled stack in lab mode so dropping layers read clearly. */
export function placeParts(layout: Layout, shapes: Shape[], kinds: (PartKind | null)[], labGap = 0): Placement[] {
  if (layout === "row") {
    const widths = shapes.map((s) => s.w);
    const a = along(widths, 10), e = along(widths, 80);
    return shapes.map((_, i) => ({ assembled: [a[i], 0, 0], exploded: [e[i], 0, 0], lead: "up" }));
  }
  if (layout === "cluster" && kinds.every((k) => k && CLUSTER[k])) {
    return kinds.map((k) => ({ assembled: [0, CLUSTER[k!]!.assembled, 0], exploded: [0, CLUSTER[k!]!.exploded, 0], lead: "right" }));
  }
  const heights = shapes.map((s) => s.h);
  const a = along(heights, 2 + labGap), e = along(heights, 52);
  return shapes.map((_, i) => ({ assembled: [0, a[i], 0], exploded: [i % 2 ? 8 : -8, e[i], 0], lead: "right" }));
}
