import { describe, expect, it } from "vitest";
import { nodeById } from "@/lib/graph";
import { activeIndex, moveSelection } from "@/lib/palette";
import type { Hit } from "@/lib/search";
import { mergeHits, type SemanticHit } from "@/lib/semantic";

const node = (id: string) => {
  const n = nodeById.get(id);
  if (!n) throw new Error(`no node ${id}`);
  return n;
};
const weak = (id: string): Hit => ({ node: node(id), score: 30 });
const meaning = (id: string, score: number): SemanticHit => ({
  node: node(id),
  score,
  chunk: { id: `${id}:overview`, kind: "overview", text: "" },
});
const ids = (rows: { node: { id: string } }[]) => rows.map((r) => r.node.id);

describe("palette selection", () => {
  const local = [weak("docker"), weak("compose"), weak("ssm")];

  it("opens the concept that was selected when meaning results reorder the list", () => {
    const before = mergeHits(local, []);
    expect(ids(before)).toEqual(["docker", "compose", "ssm"]);

    // The user presses ↓ once: compose.
    const selectedId = moveSelection(before, null, 1);
    expect(selectedId).toBe("compose");

    // ~250 ms later the API answers and puts compose in third place.
    const after = mergeHits(local, [meaning("ssm", 0.8), meaning("docker", 0.7), meaning("compose", 0.65)]);
    expect(ids(after)).toEqual(["ssm", "docker", "compose"]);

    // A positional index would now point at docker. Enter must open compose.
    expect(after[activeIndex(after, selectedId)].node.id).toBe("compose");
  });

  it("falls back to the first row with no selection or when the concept left the list", () => {
    const rows = mergeHits(local, []);
    expect(activeIndex(rows, null)).toBe(0);
    expect(activeIndex(rows, "not-in-the-list")).toBe(0);
  });

  it("clamps at both ends and returns null for an empty list", () => {
    const rows = mergeHits(local, []);
    expect(moveSelection(rows, "ssm", 1)).toBe("ssm");
    expect(moveSelection(rows, "docker", -1)).toBe("docker");
    expect(moveSelection([], null, 1)).toBeNull();
  });
});
