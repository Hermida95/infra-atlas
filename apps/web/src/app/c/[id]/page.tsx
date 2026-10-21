import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Mark } from "@/components/brain/Mark";
import { Header } from "@/components/Header";
import { conceptBody, evidenceSnippet, evidenceUrl, sourceUrl } from "@/lib/content";
import { domainById, graph, neighbours, nodeById } from "@/lib/graph";
import { STAGE_LABEL } from "@/lib/planner";
import { readableRule } from "@/lib/rule";

// Every concept page is fully static: generateStaticParams prerenders all 53 ids at build time
// and ensureStatic makes Next.js fail the build if anything request-time sneaks in later.
// That is also what makes navigating between concepts instant. Unknown ids hit notFound().
export const ensureStatic = "navigation";

export function generateStaticParams() {
  return graph.nodes.map((n) => ({ id: n.id }));
}

export async function generateMetadata({ params }: PageProps<"/c/[id]">): Promise<Metadata> {
  const node = nodeById.get((await params).id);
  if (!node) return {};
  return {
    title: `${node.title} · Infra Atlas`,
    description: node.summary,
    openGraph: { title: `${node.title} · Infra Atlas`, description: node.summary },
  };
}

// The App Shell (header and page frame) is shared by every concept URL, so it must not read
// `params`. The URL-specific part lives in <Concept>, inside Suspense; with ensureStatic it is
// still prerendered, the boundary only keeps the shared shell independent of the id.
export default function ConceptPage({ params }: PageProps<"/c/[id]">) {
  return (
    <div className="concept-page">
      <Header current="concept" />
      <main className="concept">
        <Suspense fallback={<ConceptSkeleton />}>
          <Concept params={params} />
        </Suspense>
      </main>
    </div>
  );
}

function ConceptSkeleton() {
  return (
    <div className="concept-skeleton" aria-busy="true" aria-label="Loading concept">
      <span />
      <span />
      <span />
    </div>
  );
}

async function Concept({ params }: { params: PageProps<"/c/[id]">["params"] }) {
  const node = nodeById.get((await params).id);
  if (!node) notFound();
  const domain = domainById.get(node.domain);
  const body = conceptBody(node).filter((p) => p !== node.summary);
  const related = [...(neighbours.get(node.id) ?? [])].map((id) => nodeById.get(id)!);

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/">Map</Link>
        <span aria-hidden="true">/</span>
        <span>{domain?.name}</span>
      </nav>

      <section className="concept-hero">
        <Mark node={node} size={56} />
        <div>
          <p className="tag">{domain?.name} · {node.type}</p>
          <h1>{node.title}</h1>
          <p className="lede">{node.summary}</p>
          <div className="row">
            <Link className="btn primary" href={`/?focus=${node.id}`}>
              Show on the map
            </Link>
            {node.parts.length > 0 && (
              <Link className="btn gold" href={`/?t=${node.id}`}>
                Take it apart
              </Link>
            )}
          </div>
        </div>
      </section>

      {body.length > 0 && (
        <section className="concept-body">
          {body.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </section>
      )}

      {node.parts.length > 0 && (
        <section>
          <h2>What it is made of</h2>
          {node.lead && <p className="section-lead">{node.lead}</p>}
          <ol className="parts">
            {node.parts.map((p) => (
              <li key={p.name}>
                <b>{p.name}</b>
                <span>{p.text}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {node.planner && (
        <section>
          <h2>In a deployment route</h2>
          <p className="section-lead">
            Stage <b className="gold">{STAGE_LABEL[node.planner.stage]}</b>. {node.planner.why}
          </p>
          <p className="rule" aria-label={`Included when ${node.planner.when}`}>
            <span className="rule-label">Included when</span>
            {readableRule(node.planner.when).map((t, i) => (
              <span key={i} className={`rule-${t.kind}`}>
                {t.text}
              </span>
            ))}
          </p>
          {node.planner.notes.map((n) => (
            <p key={n.text} className="note">
              {n.text}
            </p>
          ))}
        </section>
      )}

      {node.evidence.length > 0 && (
        <section>
          <h2>Proof in this repo</h2>
          <p className="section-lead">
            This project deploys itself along the journey it teaches. These lines run in CI today,
            and <code>brain validate</code> fails the build if they move or disappear.
          </p>
          <ul className="evidence">
            {node.evidence.map((e) => (
              <li key={`${e.path}:${e.lines[0]}`}>
                <p>{e.text}</p>
                <pre>
                  <code>{evidenceSnippet(e)}</code>
                </pre>
                <a href={evidenceUrl(e)} target="_blank" rel="noreferrer">
                  {e.path}:{e.lines[0]}-{e.lines[1]}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {related.length > 0 && (
        <section>
          <h2>Connected concepts</h2>
          <ul className="related">
            {related.map((n) => (
              <li key={n.id}>
                <Link href={`/c/${n.id}`}>
                  <Mark node={n} size={22} />
                  <span>
                    <b>{n.title}</b>
                    <span>{n.summary}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="concept-foot">
        <a href={sourceUrl(node)} target="_blank" rel="noreferrer">
          Edit this concept on GitHub
        </a>
      </footer>
    </>
  );
}
