// Writes public/sitemap.xml from graph.json, the same list the App Router's sitemap.ts used to
// return. It is a script and not a route because of `output: "export"`: a metadata route has to
// declare `dynamic = "force-static"` to be exported, and Cache Components rejects that option.
// A file in public/ is the identical output with no route involved.
import fs from "node:fs";

if (!fs.existsSync("src/data/graph.json")) {
  console.error("src/data/graph.json is missing. Run `make content` (uv run brain graph) from the repo root first.");
  process.exit(1);
}
const graph = JSON.parse(fs.readFileSync("src/data/graph.json", "utf8"));

// Absolute URLs need the public origin; set NEXT_PUBLIC_SITE_URL once the site is deployed.
const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const escape = (value) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const urls = [
  { loc: `${site}/`, priority: "1.0" },
  ...graph.nodes.map((node) => ({ loc: `${site}/c/${node.id}/`, priority: node.hub ? "0.8" : "0.5" })),
];

const body = urls
  .map(({ loc, priority }) => `  <url>\n    <loc>${escape(loc)}</loc>\n    <priority>${priority}</priority>\n  </url>`)
  .join("\n");

fs.writeFileSync(
  "public/sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`,
);
console.log(`sitemap: ${urls.length} urls`);
