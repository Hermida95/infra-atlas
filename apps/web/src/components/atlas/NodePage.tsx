import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Mark } from "@/components/brain/Mark";
import { Header } from "@/components/Header";
import { inline, Prose } from "@/components/Prose";
import { type Atlas, examLabel } from "@/lib/atlas";
import { atlasBody, atlasSourceUrl } from "@/lib/content";
import { edgeTextBetween } from "@/lib/graph";
import { VERDICT_LABEL } from "@/lib/lit";
import { doorway } from "@/lib/worlds";

/*
 * One page per node of an atlas: the long explanation the map has no room for. Same shape as a
 * concept page, and prerendered the same way -- `output: "export"` means the build fails if
 * anything request-time ever creeps in.
 *
 * Shared by /aws/<id> and /k8s/<id>. Each route only declares its params and hands over its
 * descriptor, so the 156 AWS pages and the Kubernetes ones are one component.
 */

type Params = Promise<{ id: string }>;

export async function nodeMetadata(atlas: Atlas, params: Params): Promise<Metadata> {
  const node = atlas.world.nodeById.get((await params).id);
  if (!node) return {};
  const title = `${node.title} · ${atlas.name} · Infra Atlas`;
  return { title, description: node.summary, openGraph: { title, description: node.summary } };
}

export function NodePage({ atlas, params }: { atlas: Atlas; params: Params }) {
  return (
    <div className="concept-page">
      <Header current={atlas.id} world={atlas.world} placeholder={atlas.copy.searchPlaceholder}
        one={atlas.copy.one} />
      <main className="concept">
        <Suspense fallback={<div className="concept-skeleton" aria-busy="true" />}>
          <Body atlas={atlas} params={params} />
        </Suspense>
      </main>
    </div>
  );
}

async function Body({ atlas, params }: { atlas: Atlas; params: Params }) {
  const world = atlas.world;
  const node = world.nodeById.get((await params).id);
  if (!node) notFound();
  const area = world.domainById.get(node.domain);
  const body = atlasBody(atlas, node).filter((p) => p !== node.summary);
  const connected = [...(world.neighbours.get(node.id) ?? [])].map((id) => world.nodeById.get(id)!);
  // Every case this node takes part in, and what each one decided about it.
  const appearances = atlas.cases
    .map((study) => ({
      study,
      options: study.options.filter((o) => o.nodes.includes(node.id)),
    }))
    .filter((a) => a.options.length > 0 || a.study.nodes.includes(node.id));
  const deeper = doorway(atlas.id, node.id);

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/">Map</Link>
        <span aria-hidden="true">/</span>
        <Link href={atlas.path}>{atlas.copy.short}</Link>
        <span aria-hidden="true">/</span>
        <span>{area?.name}</span>
      </nav>

      <section className="concept-hero">
        <Mark node={node} size={56} />
        <div>
          <p className="tag">
            {area?.name} · {node.type}
          </p>
          <h1>{node.title}</h1>
          <p className="lede">{inline(node.summary)}</p>
          {node.exam.length > 0 && (
            <p className="exams">
              {node.exam.map((e) => (
                <span key={e} className="exam">
                  {examLabel(atlas, e)}
                </span>
              ))}
            </p>
          )}
          <div className="row">
            <Link className="btn primary" href={`${atlas.path}?focus=${node.id}`}>
              Show on the map
            </Link>
            {node.parts.length > 0 && (
              <Link className="btn gold" href={`${atlas.path}?focus=${node.id}&open=1`}>
                Take it apart
              </Link>
            )}
            {deeper && (
              <Link className="btn" href={deeper.href}>
                {deeper.label}
              </Link>
            )}
          </div>
        </div>
      </section>

      {body.length > 0 && (
        <section className="concept-body">
          {body.map((p) => (
            <Prose key={p} text={p} />
          ))}
        </section>
      )}

      {node.parts.length > 0 && (
        <section>
          <h2>What it is made of</h2>
          {node.lead && <p className="section-lead">{inline(node.lead)}</p>}
          <ol className="parts">
            {node.parts.map((p) => (
              <li key={p.name}>
                <b>{p.name}</b>
                <span>{inline(p.text)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {connected.length > 0 && (
        <section>
          <h2>How it connects</h2>
          <p className="section-lead">
            Each line is an edge on the map. Where there is a sentence, it says what crosses it.
          </p>
          <ul className="related">
            {connected.map((n) => {
              const text = edgeTextBetween(world, node.id, n.id);
              return (
                <li key={n.id}>
                  <Link href={`${atlas.path}/${n.id}`}>
                    <Mark node={n} size={22} />
                    <span>
                      <b>{n.title}</b>
                      <span>{inline(text ?? n.summary)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {appearances.length > 0 && (
        <section>
          <h2>Where it shows up</h2>
          <p className="section-lead">
            The cases this {atlas.copy.noun} is part of, and what each one decided about it.
          </p>
          <ul className="appearances">
            {appearances.map(({ study, options }) => (
              <li key={study.id}>
                <Link href={`${atlas.path}?case=${study.id}`}>{study.title}</Link>
                {options.map((o) => (
                  <span key={o.id} className={`appearance v-${o.verdict}`}>
                    <b>{VERDICT_LABEL[o.verdict]}</b>
                    {o.name}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="concept-foot">
        <a href={atlasSourceUrl(atlas, node)} target="_blank" rel="noreferrer">
          Edit this {atlas.copy.noun} on GitHub
        </a>
      </footer>
    </>
  );
}
