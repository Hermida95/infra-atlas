import type { MetadataRoute } from "next";
import { graph } from "@/lib/graph";

// Absolute URLs need the public origin; set NEXT_PUBLIC_SITE_URL once the site is deployed.
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE}/`, priority: 1 },
    ...graph.nodes.map((n) => ({ url: `${SITE}/c/${n.id}`, priority: n.hub ? 0.8 : 0.5 })),
  ];
}
