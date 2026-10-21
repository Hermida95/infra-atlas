import { describe, expect, it, vi } from "vitest";
import { nodeById } from "@/lib/graph";
import { search } from "@/lib/search";
import { MIN_SEMANTIC_SCORE, mergeHits, semanticSearch, type SemanticHit } from "@/lib/semantic";

const node = (id: string) => {
  const n = nodeById.get(id);
  if (!n) throw new Error(`no node ${id}`);
  return n;
};

const meaning = (id: string, score: number, kind: "overview" | "part" = "overview", text = ""): SemanticHit => ({
  node: node(id),
  score,
  chunk: { id: `${id}:${kind}`, kind, text },
});

const respond = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

describe("semanticSearch", () => {
  it("calls GET /search with the query and k, and maps ids to graph nodes", async () => {
    const fetcher = respond({
      query: "store secrets",
      model: "local:BAAI/bge-small-en-v1.5",
      hits: [
        { id: "ssm", title: "SSM", score: 0.64, chunk: { id: "ssm:overview", kind: "overview", text: "..." } },
        { id: "not-in-this-build", title: "?", score: 0.62, chunk: { id: "x", kind: "overview", text: "" } },
      ],
    });
    const hits = await semanticSearch("store secrets", { base: "http://api.test", k: 4, fetcher });

    expect(fetcher).toHaveBeenCalledOnce();
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("http://api.test/search");
    expect(url.searchParams.get("q")).toBe("store secrets");
    expect(url.searchParams.get("k")).toBe("4");
    expect(hits.map((h) => h.node.id)).toEqual(["ssm"]);
  });

  it("does nothing without an API URL", async () => {
    const fetcher = respond({ hits: [] });
    expect(await semanticSearch("anything", { base: null, fetcher })).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("throws on an error status so the palette can show it offline", async () => {
    const fetcher = respond({ detail: "Search is unavailable" }, 503);
    await expect(semanticSearch("q", { base: "http://api.test", fetcher })).rejects.toThrow("503");
  });
});

describe("mergeHits", () => {
  it("keeps a typed name first, ahead of meaning hits", () => {
    const merged = mergeHits(search("docker"), [meaning("compose", 0.69), meaning("docker", 0.75)]);
    expect(merged[0]).toMatchObject({ node: { id: "docker" }, via: "keyword" });
    expect(merged.filter((h) => h.node.id === "docker")).toHaveLength(1);
  });

  it("fills in by meaning when no word matches", () => {
    const local = search("store secrets safely");
    expect(local).toEqual([]);
    const merged = mergeHits(local, [meaning("ssm", 0.645), meaning("s3", 0.585)]);
    expect(merged.map((h) => [h.node.id, h.via])).toEqual([
      ["ssm", "meaning"],
      ["s3", "meaning"],
    ]);
  });

  it("drops meaning hits below the noise floor", () => {
    const merged = mergeHits([], [meaning("vectordb", MIN_SEMANTIC_SCORE - 0.01)]);
    expect(merged).toEqual([]);
  });

  it("shows the part a meaning hit matched, without the title prefix", () => {
    const [hit] = mergeHits([], [meaning("docker", 0.7, "part", "Docker: Engine. The daemon.")]);
    expect(hit.snippet).toBe("Engine. The daemon.");
  });

  it("caps the list", () => {
    const many = ["ssm", "s3", "rds", "dynamodb", "ecs", "lambda"].map((id) => meaning(id, 0.7));
    expect(mergeHits([], many, 4)).toHaveLength(4);
  });
});
