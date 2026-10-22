import type { NextConfig } from "next";

// Tailwind runs through PostCSS (postcss.config.mjs), not a `turbopack.rules`
// loader: @tailwindcss/turbopack decides when to recompile from the file's
// mtime instead of its contents, so `next dev` could keep serving stale CSS.
const nextConfig: NextConfig = {
  // Every page is prerendered (generateStaticParams in c/[id]), so the build can emit a plain
  // directory of HTML: that is what CloudFront serves from S3, and what decision 2 calls the
  // static path of phase 1. `next start` is no longer part of the deployment.
  output: "export",
  // Directory layout (c/pipeline/index.html) rather than flat files (c/pipeline.html):
  // S3 has no notion of a default document inside a prefix, so the CloudFront function in
  // front of it only has to append "index.html" to a path that ends in a slash, which is
  // the shape every S3-and-CloudFront example assumes.
  trailingSlash: true,
  // Cache Components (and the Partial Prefetching built on it) describe what a server should
  // compute per request and what it may reuse. An exported site has no server, so the build
  // refuses both -- "PPR cannot be enabled in export mode". The guarantee they were giving
  // here, that nothing request-time creeps into a concept page, is now given by the export
  // itself: anything dynamic fails the build instead of quietly becoming a server render.
};

export default nextConfig;
