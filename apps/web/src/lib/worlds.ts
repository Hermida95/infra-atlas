import type { Atlas } from "@/lib/atlas";
import { AWS_ATLAS } from "@/lib/aws";
import { K8S_ATLAS } from "@/lib/k8s";

/*
 * Every world the site renders, and the doors between them. The journey map is the ground
 * floor; an atlas is a world you can walk into from a node of another one.
 */

/** The atlases, in the order the top bar lists them. */
export const ATLASES: Atlas[] = [AWS_ATLAS, K8S_ATLAS];

export const atlasById = new Map(ATLASES.map((a) => [a.id, a]));

/** The id of the journey map, which is a World but not an atlas: no cases, no route of its own. */
export const JOURNEY = "journey";

export type Doorway = { href: string; label: string };

/*
 * Nodes that are a way into another world, keyed by the world you are reading. A node named
 * here grows a button on the map's detail panel and on its page: `aws` and `kubernetes` in the
 * journey map, `eks` in the AWS atlas. That is the whole descent -- the journey map says "what
 * do I need to deploy this", AWS says "which service does it", Kubernetes says "what happens
 * inside the cluster when I apply it" -- and each step down is one click from the node that
 * raised the question.
 */
const DOORWAYS: Record<string, Record<string, Doorway>> = {
  [JOURNEY]: {
    aws: { href: AWS_ATLAS.path, label: "Go inside AWS →" },
    kubernetes: { href: K8S_ATLAS.path, label: "Go inside Kubernetes →" },
  },
  aws: {
    // EKS is a managed control plane and nothing above the API server: everything the cluster
    // itself does is the other atlas, so this is where the two maps meet.
    eks: { href: K8S_ATLAS.path, label: "Go inside Kubernetes →" },
  },
};

/** The world behind this node, or null when the node is not a door. */
export function doorway(from: string, nodeId: string): Doorway | null {
  return DOORWAYS[from]?.[nodeId] ?? null;
}
