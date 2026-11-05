import { buildAtlas } from "@/lib/atlas";
import k8sData from "@/data/k8s.json";
import type { Case } from "@/lib/graph";

/*
 * The Kubernetes atlas: the third graph, built by `brain graph --content content/k8s`. The AWS
 * atlas answers "what is inside AWS"; this one answers "what is inside a cluster, and what
 * actually happens when I apply this" -- which is why it is ordered from the object outwards
 * (a Pod, then the API that stores it, then the control plane that acts on it, then the node
 * that runs it) rather than by exam domain.
 *
 * It is reached from `eks` in the AWS atlas and from `kubernetes` in the journey map, so a
 * reader can go down from the journey to AWS and from AWS to Kubernetes (lib/worlds.ts).
 */
export const K8S_ATLAS = buildAtlas(k8sData, {
  noun: "object",
  one: "an object",
  nouns: "Objects",
  short: "Kubernetes",
  intro:
    "Pick a situation. The objects that could solve it light up on the map, and the ways to " +
    "solve it appear here, with the one to reach for first.",
  stage:
    "3D map of Kubernetes, from the Pod out to the cluster. Drag to rotate, scroll to zoom, " +
    "click an object for details.",
  structureTitle: "What is inside a cluster",
  structureIntro:
    "Fourteen areas, read from the object outwards. Everything is an object in the API, the " +
    "control plane reconciles it, the node runs it, and security and observability wrap it.",
  searchPlaceholder: "Search probes, taints, NetworkPolicy...",
  metaTitle: "Inside Kubernetes · Infra Atlas",
  metaDescription:
    "A 3D map of Kubernetes for the CKAD, CKA and CKS exams: what each object is made of, how " +
    "the control plane turns it into something running, and real cases with the options to " +
    "solve them.",
  ogDescription:
    "Kubernetes as a map, from the Pod out to the cluster, with real cases and the options to " +
    "solve each one.",
  heading: "Inside Kubernetes: a 3D map of the cluster, for the CKAD, CKA and CKS exams",
});

export const K8S = K8S_ATLAS.world;
export const k8sCases: Case[] = K8S_ATLAS.cases;
export const k8sCaseById = K8S_ATLAS.caseById;
