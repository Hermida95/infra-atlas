import type { GraphNode } from "@/lib/graph";
import { logoFor, monogramFor } from "@/lib/logos";

/** Brand logo from Simple Icons, or a hex monogram when the technology has none. */
export function Mark({ node, size = 32 }: { node: GraphNode; size?: number }) {
  const logo = logoFor(node);
  if (logo) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={logo.title} className="mark">
        <path d={logo.path} fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="mark">
      <polygon points="12,1.5 21.1,6.75 21.1,17.25 12,22.5 2.9,17.25 2.9,6.75" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <text x="12" y="13" textAnchor="middle" dominantBaseline="middle" fontSize="6.5" fontFamily="var(--font-geist-mono)" fill="currentColor">
        {monogramFor(node)}
      </text>
    </svg>
  );
}
