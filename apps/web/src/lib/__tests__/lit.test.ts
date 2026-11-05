import { describe, expect, it } from "vitest";
import { AWS, awsCaseById, awsCases } from "@/lib/aws";
import { caseLit, optionLit, VERDICT_COLOR } from "@/lib/lit";

const spiky = awsCases[0];

describe("caseLit", () => {
  it("lights every service the case touches", () => {
    const lit = caseLit(AWS, spiky);
    expect([...lit.order.keys()].sort()).toEqual([...spiky.nodes].sort());
  });

  it("paints each one in the colour of its category, and groups by it", () => {
    const lit = caseLit(AWS, spiky);
    const s3 = AWS.nodeById.get("s3")!;
    const storage = AWS.domainById.get(s3.domain)!;
    expect(lit.colors.get("s3")).toBe(`hsl(${storage.hue} 78% 66%)`);
    expect(lit.groups.get("s3")).toBe(AWS.graph.domains.indexOf(storage));
  });

  it("reveals in category order, so the sweep reads left to right", () => {
    const lit = caseLit(AWS, spiky);
    const groups = [...lit.order.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => lit.groups.get(id)!);
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
  });
});

describe("optionLit", () => {
  it("lights that option's services only, in its verdict's colour", () => {
    const best = spiky.options.find((o) => o.verdict === "best")!;
    const lit = optionLit(AWS, best);
    expect([...lit.order.keys()].sort()).toEqual([...best.nodes].sort());
    for (const id of best.nodes) expect(lit.colors.get(id)).toBe(VERDICT_COLOR.best);
  });

  it("is always a subset of its case, so switching options never adds a service", () => {
    for (const study of awsCases) {
      const all = new Set(study.nodes);
      for (const option of study.options) {
        for (const id of option.nodes) {
          expect(all.has(id), `${study.id}/${option.id} lights ${id}, absent from the case`).toBe(true);
        }
      }
    }
  });
});

describe("the AWS atlas content", () => {
  it("gives every case exactly one best option", () => {
    for (const study of awsCases) {
      expect(study.options.filter((o) => o.verdict === "best")).toHaveLength(1);
    }
  });

  it("keeps the case ids unique and addressable, for /aws?case=<id>", () => {
    expect(awsCaseById.size).toBe(awsCases.length);
  });

  it("covers both certifications", () => {
    const exams = new Set(AWS.graph.nodes.flatMap((n) => n.exam));
    expect(exams).toEqual(new Set(["saa", "sap"]));
  });

  it("explains most of its edges, which is the point of the atlas", () => {
    const explained = AWS.graph.links.filter((l) => l.text).length;
    expect(explained / AWS.graph.links.length).toBeGreaterThan(0.5);
  });
});
