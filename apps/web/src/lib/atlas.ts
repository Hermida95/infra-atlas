import {
  buildWorld,
  type Case,
  type ExamTag,
  type Graph,
  type GraphNode,
  type World,
} from "@/lib/graph";

/*
 * An atlas is a world you can walk into: a graph of its own, its own cases, its own
 * certifications, and a page at /<id>. /aws was the first and /k8s is the second, and they are
 * the same component twice -- so what separates them lives here as data instead of in a copied
 * file. Everything a view needs to render an atlas it has never heard of is in this descriptor:
 * the route, the World, the cases, the certification vocabulary, and the words.
 *
 * The id, the name and the exams are not configured here: they are read from the graph's own
 * `world` block, which `brain graph` copies out of content/<id>/world.yaml. That is what makes
 * "this world is studied for CKAD, CKA and CKS" a fact about the content and not about the app.
 */

/** The words that differ between two atlases. Everything else about them is identical. */
export type AtlasCopy = {
  /** What one node of this world is called: a "service" inside AWS, an "object" inside Kubernetes. */
  noun: string;
  /** The same with its article, for prose: "a service", "an object". */
  one: string;
  /** Plural, for the counter in the HUD. */
  nouns: string;
  /** Short name for the breadcrumb and the back buttons. */
  short: string;
  /** The one-line description of the shape of the map, under the case list. */
  intro: string;
  /** Label of the 3D stage, read by a screen reader instead of the canvas. */
  stage: string;
  /** Title and lede of the structure browser. */
  structureTitle: string;
  structureIntro: string;
  /** Placeholder of the ⌘K input: three things worth typing in this world. */
  searchPlaceholder: string;
  /** Page metadata, and the h1 a crawler sees. */
  metaTitle: string;
  metaDescription: string;
  ogDescription: string;
  heading: string;
};

export type Atlas = {
  /** The world id from world.yaml, which is also its route: "aws" -> /aws. */
  id: string;
  /** "/aws". Every deep link in the atlas is built from this, never from a literal. */
  path: string;
  /** Display name from world.yaml: "Inside AWS". */
  name: string;
  world: World;
  cases: Case[];
  caseById: Map<string, Case>;
  /** The certifications this world declares, in the order its manifest lists them. */
  exams: ExamTag[];
  copy: AtlasCopy;
};

/** A world without a manifest cannot be an atlas: it has no id, so it has no route. */
export function buildAtlas(data: unknown, copy: AtlasCopy): Atlas {
  const graph = data as Graph;
  const info = graph.world;
  if (!info) {
    throw new Error(
      "this graph has no `world` block: add a world.yaml to its content directory and re-run `brain graph`",
    );
  }
  const cases = graph.cases;
  return {
    id: info.id,
    path: `/${info.id}`,
    name: info.name,
    world: buildWorld(graph),
    cases,
    caseById: new Map(cases.map((c) => [c.id, c])),
    exams: info.exams,
    copy,
  };
}

/** Which certification the map is filtered to. `null` means every node, exam material or not. */
export type ExamFilter = string | null;

export function inScope(node: GraphNode, filter: ExamFilter): boolean {
  return filter === null || node.exam.includes(filter);
}

/** The short label of a certification, or the id upper-cased if the world forgot to name it. */
export function examLabel(atlas: Atlas, id: string): string {
  return atlas.exams.find((e) => e.id === id)?.label ?? id.toUpperCase();
}

export const examLabels = (atlas: Atlas, ids: readonly string[]) =>
  ids.map((id) => examLabel(atlas, id));

/** Areas in reading order, each with the nodes it holds, for the structure browser. */
export function categories(atlas: Atlas, filter: ExamFilter = null) {
  return atlas.world.graph.domains
    .map((domain) => ({
      domain,
      nodes: atlas.world.graph.nodes.filter((n) => n.domain === domain.id && inScope(n, filter)),
    }))
    .filter((c) => c.nodes.length > 0);
}
