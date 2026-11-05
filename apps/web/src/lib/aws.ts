import awsData from "@/data/aws.json";
import { buildWorld, type Case, type Graph, type GraphNode } from "@/lib/graph";

/*
 * The AWS atlas: a second graph, built by `brain graph --content content/aws`, with its own
 * categories, its own layout and its own cases. It is deliberately not merged into the journey
 * map -- that map answers "what do I need to deploy this", and this one answers "what is inside
 * AWS, and which of these services solves the problem in front of me".
 */
export const AWS = buildWorld(awsData as unknown as Graph);

export const awsCases: Case[] = AWS.graph.cases;
export const awsCaseById = new Map(awsCases.map((c) => [c.id, c]));

/** Exam scope filter. `null` means every node, whether it is exam material or not. */
export type ExamFilter = "saa" | "sap" | null;

export function inScope(node: GraphNode, filter: ExamFilter): boolean {
  return filter === null || node.exam.includes(filter);
}

export const EXAM_LABEL = { saa: "SAA-C03", sap: "SAP-C02" } as const;

/** Categories in reading order, each with the nodes it holds, for the structure browser. */
export function awsCategories(filter: ExamFilter = null) {
  return AWS.graph.domains
    .map((domain) => ({
      domain,
      nodes: AWS.graph.nodes.filter((n) => n.domain === domain.id && inScope(n, filter)),
    }))
    .filter((c) => c.nodes.length > 0);
}
