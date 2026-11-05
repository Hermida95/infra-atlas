import { describe, expect, it } from "vitest";
import { categories, examLabel, inScope } from "@/lib/atlas";
import { ATLASES } from "@/lib/worlds";

/*
 * The bar every world has to clear. These used to live in lit.test.ts and only ran against the
 * AWS atlas; now they run against every atlas in the registry, so a new world cannot be merged
 * with shallower content than the one before it.
 */

describe("the atlas registry", () => {
  it("has a descriptor per world, with its route taken from the content's own id", () => {
    expect(ATLASES.length).toBeGreaterThan(1);
    for (const atlas of ATLASES) {
      expect(atlas.path, `${atlas.id} route`).toBe(`/${atlas.id}`);
      expect(atlas.name.length, `${atlas.id} name`).toBeGreaterThan(0);
    }
  });

  it("gives every world a distinct id, since the id is the URL", () => {
    const ids = ATLASES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe.each(ATLASES.map((atlas) => [atlas.id, atlas] as const))("%s", (_id, atlas) => {
  it("declares its certifications in its own world.yaml", () => {
    expect(atlas.exams.length).toBeGreaterThan(0);
    for (const exam of atlas.exams) expect(examLabel(atlas, exam.id)).toBe(exam.label);
  });

  it("uses every certification it declares, so no filter chip empties the map", () => {
    const declared = new Set(atlas.exams.map((e) => e.id));
    const tagged = new Set(atlas.world.graph.nodes.flatMap((n) => n.exam));
    expect([...declared].filter((id) => !tagged.has(id))).toEqual([]);
  });

  it("tags no node with a certification its world does not declare", () => {
    const declared = new Set(atlas.exams.map((e) => e.id));
    for (const node of atlas.world.graph.nodes) {
      for (const exam of node.exam) {
        expect(declared.has(exam), `${node.id} declares '${exam}'`).toBe(true);
      }
    }
  });

  it("filters to a non-empty map for each certification", () => {
    for (const exam of atlas.exams) {
      const visible = atlas.world.graph.nodes.filter((n) => inScope(n, exam.id));
      expect(visible.length, `${exam.id} scope`).toBeGreaterThan(0);
    }
  });

  it("gives every case exactly one best option", () => {
    expect(atlas.cases.length).toBeGreaterThanOrEqual(10);
    for (const study of atlas.cases) {
      expect(study.options.filter((o) => o.verdict === "best"), study.id).toHaveLength(1);
    }
  });

  it("keeps the case ids unique and addressable, for /<world>?case=<id>", () => {
    expect(atlas.caseById.size).toBe(atlas.cases.length);
  });

  it("says what goes wrong on every option it tells you to avoid", () => {
    for (const study of atlas.cases) {
      for (const option of study.options.filter((o) => o.verdict === "avoid")) {
        expect(option.watch.length, `${study.id}/${option.id}`).toBeGreaterThan(0);
      }
    }
  });

  it("never lights a node its case did not name, so picking an option only narrows", () => {
    for (const study of atlas.cases) {
      const all = new Set(study.nodes);
      for (const option of study.options) {
        for (const id of option.nodes) {
          expect(all.has(id), `${study.id}/${option.id} lights ${id}`).toBe(true);
        }
      }
    }
  });

  it("explains most of its edges, which is the point of an atlas", () => {
    const explained = atlas.world.graph.links.filter((l) => l.text).length;
    expect(explained / atlas.world.graph.links.length).toBeGreaterThan(0.5);
  });

  it("gives every node a summary and an exam scope, not just a title", () => {
    for (const node of atlas.world.graph.nodes) {
      expect(node.summary.length, `${node.id} has no summary`).toBeGreaterThan(0);
      expect(node.exam.length, `${node.id} declares no exam scope`).toBeGreaterThan(0);
    }
  });

  it("takes the hubs apart, and anything with parts explains what they are for", () => {
    for (const node of atlas.world.graph.nodes) {
      if (node.hub) expect(node.parts.length, `hub ${node.id} has no parts`).toBeGreaterThan(2);
      if (node.parts.length) expect(node.lead, `${node.id} has parts but no lead`).toBeTruthy();
    }
  });

  it("explains at least a third of its nodes part by part", () => {
    const withParts = atlas.world.graph.nodes.filter((n) => n.parts.length).length;
    expect(withParts / atlas.world.graph.nodes.length).toBeGreaterThan(0.33);
  });

  it("puts every node in an area the structure browser shows", () => {
    const shown = categories(atlas).flatMap((c) => c.nodes.length);
    const total = shown.reduce((a, b) => a + b, 0);
    expect(total).toBe(atlas.world.graph.nodes.length);
  });
});
