import { STAGES, type Stage } from "@/lib/graph";

/*
 * One colour per stage of a route.
 *
 * The first version was a smooth warm-to-cool ramp, and smooth was the problem: neighbouring
 * stages sat 12-26 degrees of hue apart, so `ship` and `deliver` read as the same blue twice.
 * These nine are spread around the whole circle instead: the closest neighbours are 35
 * degrees of hue apart and most are nearer 40, against 12 in the ramp. The sequence still
 * travels in one direction, so the route keeps reading as an order rather than a set, but no
 * two consecutive stages are ever a shade of each other.
 *
 * `deliver` is also a touch darker than the teal before it and the lime after it: it sits in
 * the greens, where hue alone separates least, so it leans on brightness as well.
 *
 * All of them are light and saturated enough to sit on the near-black background: a lit node
 * has to look lit, not like a brighter version of a sleeping one.
 */
export const STAGE_COLOR: Record<Stage, string> = {
  build: "#ffd23d", // yellow
  containerize: "#ff6b4a", // red-orange
  infra: "#ff4d9d", // pink
  run: "#d35cff", // purple
  data: "#7b6bff", // violet
  secure: "#3f9dff", // blue
  ship: "#1fd6c1", // teal
  deliver: "#30dd47", // green
  observe: "#a3e635", // lime
};

export const STAGE_COLORS: readonly string[] = STAGES.map((s) => STAGE_COLOR[s]);
