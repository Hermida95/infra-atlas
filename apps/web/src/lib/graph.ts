import data from "@/data/graph.json";

export type PartKind =
  | "os" | "pkg" | "code" | "meta" | "rw"
  | "node" | "pod" | "bus" | "orbit" | "core" | "machine"
  | "cylinder" | "discs" | "sheet" | "plugin" | "modules" | "graph"
  | "trigger" | "jobs" | "chips"
  | "gate" | "lanes" | "split" | "loop"
  | "disc" | "zones" | "vpc" | "services" | "shell" | "ring"
  | "bars" | "bell" | "panel" | "sphere" | "satellites";
export type Layout = "stack" | "row" | "cluster";
export type Part = { name: string; kind: PartKind | null; text: string };
export type Vec3 = [number, number, number];

export const STAGES = ["build", "containerize", "infra", "run", "data", "secure", "ship", "deliver", "observe"] as const;
export type Stage = (typeof STAGES)[number];
export type PlannerNote = { when: string; text: string };
export type PlannerRule = { stage: Stage; when: string; why: string; notes: PlannerNote[] };
export type Requirement = { id: string; label: string; keywords: string[] };
/** Lines of this repo that back the card, checked by `brain validate`. */
export type Evidence = { path: string; lines: [number, number]; text: string };
/**
 * Which certification a node is studied for. Empty means it is not exam material. The ids are
 * a world's own vocabulary, declared in its world.yaml and carried in `Graph.world.exams`
 * (saa and sap inside AWS, ckad, cka and cks inside Kubernetes), so this is a plain string
 * rather than a union: nothing in the renderer knows the names of anyone's exams.
 */
export type Exam = string;
/** One certification a world is studied for. `label` is what a filter chip shows. */
export type ExamTag = { id: string; label: string; name: string | null };
/**
 * What a content tree says it is, from its world.yaml. Null on a tree without one: the journey
 * map predates the manifest and is studied for nothing.
 */
export type WorldInfo = { id: string; name: string; exams: ExamTag[] };

export type GraphNode = {
  id: string;
  title: string;
  type: string;
  domain: string;
  hub: boolean;
  /**
   * Drawn before the reader has asked for anything. `brain graph` picks a few nodes per area on
   * a world too dense to read whole, and marks every node on one that reads fine (lib/tiers.py).
   */
  major: boolean;
  summary: string;
  logo: string | null;
  monogram: string | null;
  level: string;
  access: string;
  exam: Exam[];
  lead: string | null;
  parts: Part[];
  layout: Layout;
  lab: string | null;
  /** Nodes that do the same job: the planner shows the ones it did not pick. */
  alternatives: string[];
  evidence: Evidence[];
  planner: PlannerRule | null;
  position: Vec3;
};

export type Domain = { id: string; name: string; order: number; position: Vec3; hue: number };
/** `text` is the sentence that says what crosses the edge, absent on a plain `related` line. */
export type Link = {
  source: string;
  target: string;
  type: string;
  text?: string;
  /** Drawn in the overview: both ends are major. Every link is primary on an untiered world. */
  primary?: boolean;
};

export type Verdict = "best" | "works" | "avoid";
export type CaseOption = {
  id: string;
  name: string;
  verdict: Verdict;
  /** The services this option lights up on the map. */
  nodes: string[];
  why: string;
  cost: string | null;
  /** What breaks, costs or surprises you later. Always present on an `avoid`. */
  watch: string[];
};
/** A real situation to solve with the services of a graph, and the ways to solve it. */
export type Case = {
  id: string;
  title: string;
  exam: Exam[];
  scenario: string;
  asks: string[];
  nodes: string[];
  options: CaseOption[];
  teaches: string | null;
};

export type Graph = {
  version: number;
  generatedAt: string;
  world: WorldInfo | null;
  domains: Domain[];
  requirements: Requirement[];
  cases: Case[];
  nodes: GraphNode[];
  links: Link[];
};

/*
 * A graph plus the lookups every view of it needs. There are two of these: the journey map
 * (this file's `MAP`) and the AWS atlas (lib/aws.ts). Everything that draws a graph -- the
 * hologram, the teardown, the detail panel -- takes a World rather than reaching for the
 * module-level map, so the same components render either one.
 */
export type World = {
  graph: Graph;
  nodeById: Map<string, GraphNode>;
  domainById: Map<string, Domain>;
  neighbours: Map<string, Set<string>>;
  /** "a|b" with the ids sorted -> the sentence explaining that edge, when it has one. */
  edgeText: Map<string, string>;
  /** The nodes the overview draws. Everything else is one click away (lib/tiers.py). */
  majors: Set<string>;
  /** True when the overview is a real subset, so the map has somewhere to drill into. */
  tiered: boolean;
};

const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function buildWorld(graph: Graph): World {
  const neighbours = new Map<string, Set<string>>(graph.nodes.map((n) => [n.id, new Set<string>()]));
  const edgeText = new Map<string, string>();
  for (const l of graph.links) {
    neighbours.get(l.source)?.add(l.target);
    neighbours.get(l.target)?.add(l.source);
    if (l.text) edgeText.set(edgeKey(l.source, l.target), l.text);
  }
  // A graph.json generated before tiers existed marks nothing: fall back to drawing it whole
  // rather than to an empty map.
  const flagged = graph.nodes.filter((n) => n.major);
  const majors = new Set((flagged.length ? flagged : graph.nodes).map((n) => n.id));
  return {
    graph,
    nodeById: new Map(graph.nodes.map((n) => [n.id, n])),
    domainById: new Map(graph.domains.map((d) => [d.id, d])),
    neighbours,
    edgeText,
    majors,
    tiered: majors.size < graph.nodes.length,
  };
}

/**
 * What the hologram has on screen, and why. `null` is the whole graph, which is what a world
 * small enough to read whole uses. `kind` is not decoration: it decides how the links between
 * the visible nodes are drawn, because a node's own map wants to show how its neighbours relate
 * to each other, while the overview wants the shape of the world and nothing else.
 */
export type MapView = {
  kind: "overview" | "focus" | "case";
  nodes: Set<string>;
  /** Every link between the visible nodes, or only the ones the overview draws. */
  links: "all" | "primary";
};

/** Whether a view draws this link: both ends on screen, and primary if that is all it wants. */
export function linkDrawn(view: MapView | null, link: Link): boolean {
  if (!view) return true;
  return (
    view.nodes.has(link.source) &&
    view.nodes.has(link.target) &&
    (view.links === "all" || link.primary !== false)
  );
}

/** The links a view actually draws. */
export function drawnLinks(world: World, view: MapView | null): Link[] {
  return view ? world.graph.links.filter((l) => linkDrawn(view, l)) : world.graph.links;
}

/** The sentence that explains an edge, or null for a plain `related` line. */
export function edgeTextBetween(world: World, a: string, b: string): string | null {
  return world.edgeText.get(edgeKey(a, b)) ?? null;
}

// graph.json is generated by `uv run brain graph` from /content. Never edit it by hand.
export const graph = data as unknown as Graph;

/** The journey map: localhost to production. The AWS atlas is its own World in lib/aws.ts. */
export const MAP = buildWorld(graph);

export const nodeById = MAP.nodeById;
export const domainById = MAP.domainById;
export const neighbours = MAP.neighbours;
