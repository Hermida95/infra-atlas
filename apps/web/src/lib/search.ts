import { domainById, graph, type GraphNode } from "@/lib/graph";

export type Hit = { node: GraphNode; score: number };

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

/** Initials of the title's words: "API Gateway" -> "ag", "Plan and apply" -> "paa". */
const initials = (s: string) =>
  norm(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("");

/** True when every character of `q` appears in `s` in order ("k8s" in "kubernetes" is not, "kbnt" is). */
function subsequence(q: string, s: string): boolean {
  let i = 0;
  for (const ch of s) if (ch === q[i] && ++i === q.length) return true;
  return false;
}

/** How well one query token matches a node. 0 means no match. */
function tokenScore(token: string, node: GraphNode): number {
  const title = norm(node.title);
  const words = title.split(/[^a-z0-9]+/).filter(Boolean);
  if (title === token || norm(node.id) === token) return 100;
  if (title.startsWith(token)) return 80;
  if (words.some((w) => w.startsWith(token))) return 70;
  if (title.includes(token)) return 60;
  if (token.length >= 2 && initials(node.title).startsWith(token)) return 55;
  if (node.parts.some((p) => norm(p.name).includes(token))) return 35;
  if (norm(domainById.get(node.domain)?.name ?? "").includes(token)) return 30;
  if (norm(node.summary).includes(token)) return 20;
  if (token.length >= 3 && subsequence(token, title)) return 10;
  return 0;
}

/**
 * Ranked concept search for the command palette. Every word of the query has to match
 * something (title, initials, part names, domain or summary); titles weigh the most.
 * An empty query suggests the hub technologies.
 */
export function search(query: string, nodes: GraphNode[] = graph.nodes, limit = 8): Hit[] {
  const tokens = norm(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return nodes.filter((n) => n.hub).slice(0, limit).map((node) => ({ node, score: 0 }));
  }
  const hits: Hit[] = [];
  for (const node of nodes) {
    let score = 0;
    for (const t of tokens) {
      const s = tokenScore(t, node);
      if (!s) {
        score = 0;
        break;
      }
      score += s;
    }
    if (score) hits.push({ node, score: score + (node.hub ? 1 : 0) });
  }
  return hits.sort((a, b) => b.score - a.score || a.node.title.localeCompare(b.node.title)).slice(0, limit);
}
