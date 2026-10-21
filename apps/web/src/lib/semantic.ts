import { nodeById, type GraphNode } from "@/lib/graph";
import type { Hit } from "@/lib/search";

/**
 * Base URL of the FastAPI app (apps/api), inlined at build time. Without it the palette
 * only runs the local keyword search, so the static site keeps working with no API.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") || null;

/** Shortest query worth sending: one or two letters carry no meaning to embed. */
export const MIN_SEMANTIC_QUERY = 3;
/** A local hit at least this strong matched a title or its initials: the user typed a name. */
const NAME_MATCH = 55;

export type SemanticHit = {
  node: GraphNode;
  score: number;
  chunk: { id: string; kind: "overview" | "part"; text: string };
};

export type PaletteHit = Hit & {
  via: "keyword" | "meaning";
  /** Why a meaning hit matched, when it was one of the teardown parts. */
  snippet?: string;
};

type SearchResponse = {
  hits: { id: string; score: number; chunk: SemanticHit["chunk"] }[];
};

/** GET /search on the API. Hits for concepts this build does not know are dropped. */
export async function semanticSearch(
  query: string,
  { base = API_URL, k = 8, signal, fetcher = fetch }: {
    base?: string | null;
    k?: number;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  } = {},
): Promise<SemanticHit[]> {
  if (!base) return [];
  const url = `${base}/search?${new URLSearchParams({ q: query, k: String(k) })}`;
  const res = await fetcher(url, { signal, headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`/search answered ${res.status}`);
  const body = (await res.json()) as SearchResponse;
  return body.hits.flatMap((h) => {
    const node = nodeById.get(h.id);
    return node ? [{ node, score: h.score, chunk: h.chunk }] : [];
  });
}

/** "Docker: Engine. The daemon that..." -> "Engine. The daemon that..." */
function partSnippet(hit: SemanticHit): string | undefined {
  if (hit.chunk.kind !== "part") return undefined;
  const prefix = `${hit.node.title}: `;
  return hit.chunk.text.startsWith(prefix) ? hit.chunk.text.slice(prefix.length) : hit.chunk.text;
}

/**
 * One ranked list for the palette:
 * 1. local hits that matched a name, so typing "docker" still puts Docker first;
 * 2. meaning hits, closest first (the API already dropped the noise);
 * 3. the remaining, weaker local hits.
 * A concept appears once, at its best position.
 */
export function mergeHits(local: Hit[], semantic: SemanticHit[], limit = 8): PaletteHit[] {
  const out: PaletteHit[] = [];
  const seen = new Set<string>();
  const add = (hit: PaletteHit) => {
    if (seen.has(hit.node.id) || out.length >= limit) return;
    seen.add(hit.node.id);
    out.push(hit);
  };
  for (const h of local) if (h.score >= NAME_MATCH) add({ ...h, via: "keyword" });
  for (const h of semantic) {
    add({ node: h.node, score: h.score, via: "meaning", snippet: partSnippet(h) });
  }
  for (const h of local) add({ ...h, via: "keyword" });
  return out;
}
