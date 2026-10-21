import fs from "node:fs";
import path from "node:path";
import type { GraphNode } from "@/lib/graph";

// Concept bodies live in the MDX files next to their frontmatter. They are read at build time
// (pages are prerendered), so the client bundle never ships the content folder.
const CONTENT = path.join(process.cwd(), "..", "..", "content", "nodes");

/** The MDX body below the frontmatter, split into paragraphs. */
export function conceptBody(node: GraphNode): string[] {
  const file = path.join(CONTENT, node.domain, `${node.id}.mdx`);
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  return body ? body.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()) : [];
}

export const REPO_URL = "https://github.com/Hermida95/infra-atlas";
export const sourceUrl = (node: GraphNode) => `${REPO_URL}/blob/main/content/nodes/${node.domain}/${node.id}.mdx`;
