import fs from "node:fs";
import path from "node:path";
import type { Atlas } from "@/lib/atlas";
import type { Evidence, GraphNode } from "@/lib/graph";

// Concept bodies live in the MDX files next to their frontmatter. They are read at build time
// (pages are prerendered), so the client bundle never ships the content folder.
const REPO = path.join(process.cwd(), "..", "..");
const CONTENT = path.join(REPO, "content", "nodes");
// An atlas keeps its tree under content/<world id>, which is also its route: content/aws, content/k8s.
const atlasRoot = (atlas: Atlas) => path.join(REPO, "content", atlas.id, "nodes");

/** The MDX body below the frontmatter, split into paragraphs. */
export function conceptBody(node: GraphNode, root: string = CONTENT): string[] {
  const file = path.join(root, node.domain, `${node.id}.mdx`);
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  return body ? body.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()) : [];
}

/** The lines an `evidence` entry points at, read at build time. `brain validate` keeps them real. */
export function evidenceSnippet(evidence: Evidence): string {
  // Evidence points anywhere in the repo, so the path cannot be scoped to one folder. The read
  // happens at build time on a prerendered page; turbopackIgnore keeps the tracer from pulling
  // the whole repository into the server bundle because of it.
  const file = path.join(/* turbopackIgnore: true */ REPO, evidence.path);
  if (!fs.existsSync(file)) return "";
  const [from, to] = evidence.lines;
  const lines = fs.readFileSync(file, "utf8").split("\n").slice(from - 1, to);
  // Drop the indentation the whole fragment shares, so a nested step reads at the left margin.
  const written = lines.filter((l) => l.trim());
  const indent = written.length ? Math.min(...written.map((l) => l.length - l.trimStart().length)) : 0;
  return lines.map((l) => l.slice(indent)).join("\n").trimEnd();
}

/** The same, for a node of an atlas, whose content tree is content/<world id>. */
export const atlasBody = (atlas: Atlas, node: GraphNode) => conceptBody(node, atlasRoot(atlas));

export const REPO_URL = "https://github.com/Hermida95/infra-atlas";
export const sourceUrl = (node: GraphNode) => `${REPO_URL}/blob/main/content/nodes/${node.domain}/${node.id}.mdx`;
export const atlasSourceUrl = (atlas: Atlas, node: GraphNode) =>
  `${REPO_URL}/blob/main/content/${atlas.id}/nodes/${node.domain}/${node.id}.mdx`;
export const evidenceUrl = (e: Evidence) => `${REPO_URL}/blob/main/${e.path}#L${e.lines[0]}-L${e.lines[1]}`;
