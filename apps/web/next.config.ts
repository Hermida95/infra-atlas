import type { NextConfig } from "next";

// Tailwind runs through PostCSS (postcss.config.mjs), not a `turbopack.rules`
// loader: @tailwindcss/turbopack decides when to recompile from the file's
// mtime instead of its contents, so `next dev` could keep serving stale CSS.
const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
