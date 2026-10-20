import { graph, type GraphNode, type Requirement, type Stage, STAGES } from "@/lib/graph";

/*
 * Deployment planner. Each node declares in its frontmatter when it belongs in a route:
 * a boolean expression over requirement ids (`not k8s and cheap and not scale`).
 * Same grammar as packages/brain/src/brain/planner.py:
 *   expr := and ("or" and)* ; and := not ("and" not)* ; not := "not" not | atom
 *   atom := "true" | "false" | IDENT | "(" expr ")"
 */
export type Expr =
  | { op: "lit"; value: boolean }
  | { op: "id"; name: string }
  | { op: "not"; arg: Expr }
  | { op: "and" | "or"; left: Expr; right: Expr };

const KEYWORDS = new Set(["and", "or", "not", "true", "false"]);

export function parse(src: string): Expr {
  const tokens = src.match(/\(|\)|[a-z0-9]+|\S/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const take = (t?: string) => {
    const tok = tokens[i++];
    if (tok === undefined || (t && tok !== t)) throw new Error(`Bad planner rule "${src}": expected ${t ?? "a term"}`);
    return tok;
  };
  const atom = (): Expr => {
    const tok = take();
    if (tok === "(") {
      const e = or();
      take(")");
      return e;
    }
    if (tok === "true" || tok === "false") return { op: "lit", value: tok === "true" };
    if (!/^[a-z0-9]+$/.test(tok) || KEYWORDS.has(tok)) throw new Error(`Bad planner rule "${src}": unexpected "${tok}"`);
    return { op: "id", name: tok };
  };
  const not = (): Expr => (peek() === "not" ? (take(), { op: "not", arg: not() }) : atom());
  const and = (): Expr => {
    let left = not();
    while (peek() === "and") left = (take(), { op: "and", left, right: not() });
    return left;
  };
  const or = (): Expr => {
    let left = and();
    while (peek() === "or") left = (take(), { op: "or", left, right: and() });
    return left;
  };
  const e = or();
  if (i !== tokens.length) throw new Error(`Bad planner rule "${src}": unexpected "${tokens[i]}"`);
  return e;
}

export function evaluate(e: Expr, selected: ReadonlySet<string>): boolean {
  switch (e.op) {
    case "lit":
      return e.value;
    case "id":
      return selected.has(e.name);
    case "not":
      return !evaluate(e.arg, selected);
    case "and":
      return evaluate(e.left, selected) && evaluate(e.right, selected);
    case "or":
      return evaluate(e.left, selected) || evaluate(e.right, selected);
  }
}

/** Requirement ids mentioned in free text, by whole-word keyword match. */
export function detect(text: string, requirements: Requirement[] = graph.requirements): Set<string> {
  const t = ` ${text.toLowerCase()} `;
  const found = new Set<string>();
  for (const r of requirements) {
    const hit = r.keywords.some((k) =>
      new RegExp(`(^|[^a-z0-9])${k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")}([^a-z0-9]|$)`).test(t),
    );
    if (hit) found.add(r.id);
  }
  return found;
}

export const STAGE_LABEL: Record<Stage, string> = {
  build: "Build locally",
  containerize: "Containerize",
  infra: "Define infrastructure",
  run: "Run and expose",
  data: "Store and process",
  secure: "Secure",
  ship: "Ship",
  observe: "Observe",
};

export type RouteStep = { node: GraphNode; why: string };
export type Route = {
  stages: { stage: Stage; steps: RouteStep[] }[];
  notes: string[];
  /** Node id -> position in the route, for staggered reveal. */
  order: Map<string, number>;
  /** Node id -> stage index, so pulses flow from local to cloud. */
  stageIndex: Map<string, number>;
};

const compiled = new Map<string, Expr>();
const rule = (src: string) => {
  let e = compiled.get(src);
  if (!e) compiled.set(src, (e = parse(src)));
  return e;
};

export function plan(selected: ReadonlySet<string>, nodes: GraphNode[] = graph.nodes): Route {
  const byStage = new Map<Stage, RouteStep[]>(STAGES.map((s) => [s, []]));
  const notes: string[] = [];
  for (const node of nodes) {
    const p = node.planner;
    if (!p || !evaluate(rule(p.when), selected)) continue;
    byStage.get(p.stage)!.push({ node, why: p.why });
    for (const n of p.notes) if (evaluate(rule(n.when), selected)) notes.push(n.text);
  }
  const stages = STAGES.map((stage) => ({ stage, steps: byStage.get(stage)! })).filter((s) => s.steps.length);
  const order = new Map<string, number>();
  const stageIndex = new Map<string, number>();
  for (const s of stages) for (const step of s.steps) {
    order.set(step.node.id, order.size);
    stageIndex.set(step.node.id, STAGES.indexOf(s.stage));
  }
  return { stages, notes, order, stageIndex };
}
