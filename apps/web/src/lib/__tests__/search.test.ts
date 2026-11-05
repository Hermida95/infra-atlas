import { describe, expect, it } from "vitest";
import { AWS } from "@/lib/aws";
import { search } from "@/lib/search";

const ids = (q: string) => search(q).map((h) => h.node.id);

describe("concept search", () => {
  it("puts an exact title first", () => {
    expect(ids("docker")[0]).toBe("docker");
    expect(ids("S3")[0]).toBe("s3");
  });

  it("matches the start of any word in the title", () => {
    expect(ids("gateway")).toContain("apigw");
    expect(ids("compose")[0]).toBe("compose");
  });

  it("matches initials", () => {
    expect(ids("ag")).toContain("apigw");
  });

  it("finds a technology by one of its parts", () => {
    expect(ids("etcd")).toContain("kubernetes");
    expect(ids("guardrails")).toContain("bedrock");
  });

  it("requires every word to match", () => {
    expect(ids("managed postgres")).toContain("rds");
    expect(ids("docker zzzz")).toEqual([]);
  });

  it("ignores case and accents", () => {
    expect(ids("TERRAFORM")[0]).toBe("terraform");
    expect(ids("kubérnetes")[0]).toBe("kubernetes");
  });

  it("suggests hubs for an empty query", () => {
    const hits = search("");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.node.hub)).toBe(true);
  });
});

describe("searching another graph", () => {
  it("ranks the AWS atlas, not the journey map", () => {
    const hits = search("nat gateway", AWS.graph.nodes, 3, AWS);
    expect(hits[0].node.id).toBe("nat-gateway");
  });

  it("matches a service by its AWS category name", () => {
    const hits = search("resilience", AWS.graph.nodes, 20, AWS);
    expect(hits.every((h) => AWS.nodeById.get(h.node.id)!.domain === "resilience")).toBe(true);
    expect(hits.length).toBeGreaterThan(0);
  });
});
