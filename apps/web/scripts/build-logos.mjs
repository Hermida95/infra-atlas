// Builds src/data/logos.json with only the marks referenced by graph.json:
// - `logo: <slug>`     -> Simple Icons path (24x24), so the bundle never ships the full set.
// - `logo: aws:<name>` -> official AWS Architecture Icon in public/icons/aws. The HTML shows the
//                         original file; the 3D map uses its glyph (every <path>, background dropped).
import fs from "node:fs";
import * as si from "simple-icons";

if (!fs.existsSync("src/data/graph.json")) {
  console.error("src/data/graph.json is missing. Run `make content` (uv run brain graph) from the repo root first.");
  process.exit(1);
}
const graph = JSON.parse(fs.readFileSync("src/data/graph.json", "utf8"));
const bySlug = new Map(
  Object.values(si)
    .filter((icon) => icon && typeof icon === "object" && "slug" in icon)
    .map((icon) => [icon.slug, icon]),
);

function awsLogo(name, fallbackTitle) {
  const file = `public/icons/aws/${name}.svg`;
  if (!fs.existsSync(file)) return null;
  const svg = fs.readFileSync(file, "utf8");
  const [, w, h] = svg.match(/viewBox="0 0 (\d+) (\d+)"/) ?? [];
  const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  const named = svg.match(/<title>.*Arch_(.+?)_\d+<\/title>/)?.[1];
  const title = named ? named.replace(/-(?!Ray)/g, " ") : fallbackTitle;
  if (!w || !paths.length) return null;
  return { title, path: paths.join(" "), viewBox: [Number(w), Number(h)], fillRule: "evenodd", src: `/icons/aws/${name}.svg` };
}

const logos = {};
const missing = [];
for (const node of graph.nodes) {
  if (!node.logo || logos[node.logo]) continue;
  let logo = null;
  if (node.logo.startsWith("aws:")) logo = awsLogo(node.logo.slice(4), node.title);
  else {
    const icon = bySlug.get(node.logo);
    if (icon) logo = { title: icon.title, path: icon.path, viewBox: [24, 24], fillRule: "nonzero", src: null };
  }
  if (logo) logos[node.logo] = logo;
  else missing.push(`${node.id} (${node.logo})`);
}

fs.writeFileSync("src/data/logos.json", JSON.stringify(logos, null, 2) + "\n");
console.log(`logos: ${Object.keys(logos).length} written`);
if (missing.length) console.warn(`logos: no match, monogram fallback for ${missing.join(", ")}`);
