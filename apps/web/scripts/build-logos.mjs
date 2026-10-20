// Extracts only the Simple Icons paths referenced by graph.json, so the client bundle
// never ships the full icon set.
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

const logos = {};
const missing = [];
for (const node of graph.nodes) {
  if (!node.logo) continue;
  const icon = bySlug.get(node.logo);
  if (icon) logos[node.logo] = { title: icon.title, path: icon.path };
  else missing.push(`${node.id} (${node.logo})`);
}

fs.writeFileSync("src/data/logos.json", JSON.stringify(logos, null, 2) + "\n");
console.log(`logos: ${Object.keys(logos).length} written`);
if (missing.length) console.warn(`logos: no Simple Icons match, monogram fallback for ${missing.join(", ")}`);
