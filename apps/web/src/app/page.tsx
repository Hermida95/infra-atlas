import BrainMapClient from "@/components/brain/BrainMapClient";
import { domainById, graph } from "@/lib/graph";

export default function Home() {
  return (
    <main>
      <h1 className="sr-only">Infra Atlas: a 3D map of DevOps, cloud and AI concepts</h1>
      <BrainMapClient />
      {/* Text version of the map for screen readers and search engines. */}
      <ul className="sr-only">
        {graph.nodes.map((n) => (
          <li key={n.id}>
            {n.title} ({domainById.get(n.domain)?.name}): {n.summary}
          </li>
        ))}
      </ul>
    </main>
  );
}
