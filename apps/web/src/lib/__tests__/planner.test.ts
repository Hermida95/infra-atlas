import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { detect, evaluate, parse, plan } from "@/lib/planner";

type Case = { id: string; requirements: string[]; nodes: string[]; notes: number };
const cases = parseYaml(fs.readFileSync(new URL("../../../../../content/planner-cases.yaml", import.meta.url), "utf8")) as Case[];

describe("rule language", () => {
  const ev = (src: string, ...on: string[]) => evaluate(parse(src), new Set(on));

  it("gives and precedence over or, and not over and", () => {
    expect(ev("a or b and not c", "b", "c")).toBe(false);
    expect(ev("a or b and not c", "a", "c")).toBe(true);
  });

  it("honours parentheses and literals", () => {
    expect(ev("not (a and b)", "a")).toBe(true);
    expect(ev("true")).toBe(true);
    expect(ev("false or a", "a")).toBe(true);
  });

  it.each(["a and", "(a", "and", "a b", "a & b"])("rejects %j", (src) => {
    expect(() => parse(src)).toThrow();
  });
});

describe("free text", () => {
  it("matches whole words only, so 'user' does not imply accounts", () => {
    expect([...detect("A FastAPI app with Postgres, user login and image uploads on a small budget")].sort()).toEqual(
      ["auth", "cheap", "files", "sql"],
    );
    expect(detect("users everywhere").has("auth")).toBe(false);
  });
});

describe("parity with the original prototype", () => {
  it.each(cases.map((c) => [c.id, c] as const))("%s", (_, c) => {
    const route = plan(new Set(c.requirements));
    expect([...route.order.keys()].sort()).toEqual([...c.nodes].sort());
    expect(route.notes).toHaveLength(c.notes);
  });
});
