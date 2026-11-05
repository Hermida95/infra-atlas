import { buildAtlas } from "@/lib/atlas";
import awsData from "@/data/aws.json";
import type { Case } from "@/lib/graph";

/*
 * The AWS atlas: a second graph, built by `brain graph --content content/aws`, with its own
 * categories, its own layout and its own cases. It is deliberately not merged into the journey
 * map -- that map answers "what do I need to deploy this", and this one answers "what is inside
 * AWS, and which of these services solves the problem in front of me".
 *
 * Everything below the descriptor is words. The behaviour is in lib/atlas.ts and the components
 * under components/atlas, shared with every other world.
 */
export const AWS_ATLAS = buildAtlas(awsData, {
  noun: "service",
  one: "a service",
  nouns: "Services",
  short: "AWS",
  intro:
    "Pick a situation. The services that could solve it light up on the map, and the ways to " +
    "solve it appear here, with the one to reach for first.",
  stage:
    "3D map of the AWS services covered by the Solutions Architect certifications. Drag to " +
    "rotate, scroll to zoom, click a service for details.",
  structureTitle: "What is inside AWS",
  structureIntro:
    "Fifteen categories, read from the account outwards. Everything runs inside a VPC, the " +
    "edge sits in front of it, and governance, security and operations wrap the whole thing.",
  searchPlaceholder: "Search NAT gateway, Aurora, failover...",
  metaTitle: "Inside AWS · Infra Atlas",
  metaDescription:
    "A 3D map of the AWS services the Solutions Architect Associate and Professional exams " +
    "cover, how each one connects to the next, and real cases with the options to solve them.",
  ogDescription:
    "Every AWS service of the SAA-C03 and SAP-C02 scope as a map, with real cases and the " +
    "options to solve each one.",
  heading: "Inside AWS: a 3D map of the services the SAA-C03 and SAP-C02 exams cover",
});

export const AWS = AWS_ATLAS.world;
export const awsCases: Case[] = AWS_ATLAS.cases;
export const awsCaseById = AWS_ATLAS.caseById;
