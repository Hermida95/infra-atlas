import type { Metadata } from "next";
import { type Atlas as AtlasWorld, examLabel } from "@/lib/atlas";
import Atlas from "./Atlas";

/** The page metadata of an atlas, from its own copy. Each route re-exports this. */
export function atlasMetadata(atlas: AtlasWorld): Metadata {
  const { metaTitle, metaDescription, ogDescription } = atlas.copy;
  return {
    title: metaTitle,
    description: metaDescription,
    openGraph: { title: metaTitle, description: ogDescription },
  };
}

/**
 * One atlas page: the hologram, and a text version of the same graph underneath it for screen
 * readers and crawlers. Shared by /aws and /k8s, which are nine lines each because of it.
 */
export function AtlasPage({ atlas }: { atlas: AtlasWorld }) {
  const { graph } = atlas.world;
  return (
    <main>
      <h1 className="sr-only">{atlas.copy.heading}</h1>
      {/* Switching worlds has to build a new scene and drop the old selection. */}
      <Atlas key={atlas.id} atlas={atlas} />
      {/* Text version of the atlas, for screen readers and search engines. */}
      <div className="sr-only">
        {graph.domains.map((domain) => (
          <section key={domain.id}>
            <h2>{domain.name}</h2>
            <ul>
              {graph.nodes
                .filter((n) => n.domain === domain.id)
                .map((n) => (
                  <li key={n.id}>
                    {n.title}
                    {n.exam.length > 0 &&
                      ` (${n.exam.map((e) => examLabel(atlas, e)).join(", ")})`}
                    : {n.summary}
                  </li>
                ))}
            </ul>
          </section>
        ))}
        <h2>Cases</h2>
        <ul>
          {atlas.cases.map((c) => (
            <li key={c.id}>
              <h3>{c.title}</h3>
              <p>{c.scenario}</p>
              <ul>
                {c.options.map((o) => (
                  <li key={o.id}>
                    {o.name} — {o.verdict}: {o.why}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
