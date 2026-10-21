import { graph } from "@/lib/graph";

export type RuleToken = { kind: "word" | "requirement" | "paren"; text: string };

const LABEL = new Map(graph.requirements.map((r) => [r.id, r.label]));

/** A planner `when` rule as readable tokens: `not k8s and cheap` -> not · Kubernetes · and · Small budget. */
export function readableRule(when: string): RuleToken[] {
  return (when.match(/\(|\)|[a-z0-9]+/g) ?? []).map((t) => {
    if (t === "(" || t === ")") return { kind: "paren", text: t };
    if (t === "true") return { kind: "word", text: "always" };
    if (LABEL.has(t)) return { kind: "requirement", text: LABEL.get(t)! };
    return { kind: "word", text: t };
  });
}
