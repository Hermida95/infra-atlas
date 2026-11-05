import { type Case, type CaseOption, type Domain, STAGES, type Verdict, type World } from "@/lib/graph";
import type { Route } from "@/lib/planner";
import { STAGE_COLOR } from "@/lib/stages";

/*
 * What is lit on a hologram, and in which colour. Three maps is all the scene needs, so the
 * same renderer draws a planner route through the journey map and a case through the AWS
 * atlas without knowing which it is looking at.
 *
 *   order   node id -> position in the lit sequence, for the staggered reveal
 *   colors  node id -> the hex colour of the group it belongs to
 *   groups  node id -> group index, so pulses travel from earlier groups to later ones
 */
export type Lit = {
  order: Map<string, number>;
  colors: Map<string, string>;
  groups: Map<string, number>;
};

/** What a case's verdict looks like. The same three colours label the options and light the map. */
export const VERDICT_COLOR: Record<Verdict, string> = {
  best: "#30dd47",
  works: "#3f9dff",
  avoid: "#ff6b4a",
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  best: "Best here",
  works: "Also works",
  avoid: "Looks right, is not",
};

/**
 * A planner route: the stage a node belongs to is its colour and its group, so the heading in
 * the planner panel and the glow out on the map are literally the same value.
 */
export function routeLit(route: Route): Lit {
  const colors = new Map<string, string>();
  for (const [id, index] of route.stageIndex) colors.set(id, STAGE_COLOR[STAGES[index]]);
  return { order: route.order, colors, groups: route.stageIndex };
}

const categoryColor = (domain: Domain | undefined) =>
  `hsl(${domain?.hue ?? 190} 78% 66%)`;

/**
 * An arbitrary set of nodes, ordered and grouped by their category so the reveal sweeps across
 * the map in reading order instead of at random. `color` decides what each one is painted.
 */
function litFor(world: World, ids: readonly string[], color: (id: string) => string): Lit {
  const wanted = new Set(ids.filter((id) => world.nodeById.has(id)));
  const order = new Map<string, number>();
  const colors = new Map<string, string>();
  const groups = new Map<string, number>();
  world.graph.domains.forEach((domain, index) => {
    for (const node of world.graph.nodes) {
      if (node.domain !== domain.id || !wanted.has(node.id)) continue;
      order.set(node.id, order.size);
      groups.set(node.id, index);
      colors.set(node.id, color(node.id));
    }
  });
  return { order, colors, groups };
}

/** Every service a case touches, whichever option you take, painted in its category's colour. */
export function caseLit(world: World, study: Case): Lit {
  return litFor(world, study.nodes, (id) =>
    categoryColor(world.domainById.get(world.nodeById.get(id)!.domain)),
  );
}

/** One option's services only, painted by its verdict, so switching options is a visible diff. */
export function optionLit(world: World, option: CaseOption): Lit {
  const hex = VERDICT_COLOR[option.verdict];
  return litFor(world, option.nodes, () => hex);
}
