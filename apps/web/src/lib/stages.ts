import { STAGES, type Stage } from "@/lib/graph";

/*
 * One colour per stage of a route. Nine steps of a single journey, not nine unrelated
 * categories, so the ramp runs warm to cool: your laptop is amber, production watching itself
 * is teal. Lighting a whole route in one colour made a forty-node route read as a blob -- the
 * ramp is what turns it back into an order you can follow without reading a label.
 *
 * Chosen against the near-black background and away from the domain hues (170-230), so a lit
 * node never reads as just a brighter version of an unlit one.
 */
export const STAGE_COLOR: Record<Stage, string> = {
  build: "#ffd166",
  containerize: "#ffab5e",
  infra: "#ff8d6b",
  run: "#f7718f",
  data: "#d977b8",
  secure: "#ab7fd4",
  ship: "#7b8fe0",
  deliver: "#4fa8d8",
  observe: "#3fc7bd",
};

export const STAGE_COLORS: readonly string[] = STAGES.map((s) => STAGE_COLOR[s]);
