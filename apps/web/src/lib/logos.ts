import logos from "@/data/logos.json";
import type { GraphNode } from "@/lib/graph";

export type Logo = {
  title: string;
  path: string;
  viewBox: [number, number];
  fillRule: CanvasFillRule;
  /** Original file to show untouched in HTML (official AWS icons). */
  src: string | null;
};
const LOGOS = logos as unknown as Record<string, Logo>;

export function logoFor(node: GraphNode): Logo | null {
  return node.logo ? (LOGOS[node.logo] ?? null) : null;
}

export function monogramFor(node: GraphNode): string {
  if (node.monogram) return node.monogram;
  const words = node.title.split(" ");
  // Short acronyms read best as they are (IAM, EC2, S3); long single words get two letters.
  if (words[0].length <= 3) return words[0].toUpperCase();
  if (words.length === 1) return words[0][0].toUpperCase() + words[0][1].toLowerCase();
  return node.title
    .replace(/[^A-Za-z0-9 ]/g, "")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

/** Nodes worth a mark on the map: technologies with a brand (logo or monogram fallback) and hubs. */
export function hasMark(node: GraphNode): boolean {
  return Boolean(node.logo || node.monogram || node.hub);
}
