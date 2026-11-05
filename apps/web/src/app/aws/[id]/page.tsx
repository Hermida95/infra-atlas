import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Mark } from "@/components/brain/Mark";
import { Header } from "@/components/Header";
import { inline, Prose } from "@/components/Prose";
import { AWS, awsCases, EXAM_LABEL } from "@/lib/aws";
import { awsBody, awsSourceUrl } from "@/lib/content";
import { edgeTextBetween } from "@/lib/graph";
import { VERDICT_LABEL } from "@/lib/lit";

/*
 * One page per AWS service: the long explanation the map has no room for. Same shape as a
 * concept page, and prerendered the same way -- `output: "export"` means the build fails if
 * anything request-time ever creeps in.
 */

export function generateStaticParams() {
  return AWS.graph.nodes.map((n) => ({ id: n.id }));
}

export async function generateMetadata({ params }: PageProps<"/aws/[id]">): Promise<Metadata> {
  const node = AWS.nodeById.get((await params).id);
  if (!node) return {};
  const title = `${node.title} · Inside AWS · Infra Atlas`;
  return { title, description: node.summary, openGraph: { title, description: node.summary } };
}

export default function AwsServicePage({ params }: PageProps<"/aws/[id]">) {
  return (
    <div className="concept-page">
      <Header current="aws" world={AWS} />
      <main className="concept">
        <Suspense fallback={<div className="concept-skeleton" aria-busy="true" />}>
          <Service params={params} />
        </Suspense>
      </main>
    </div>
  );
}

async function Service({ params }: { params: PageProps<"/aws/[id]">["params"] }) {
  const node = AWS.nodeById.get((await params).id);
  if (!node) notFound();
  const category = AWS.domainById.get(node.domain);
  const body = awsBody(node).filter((p) => p !== node.summary);
  const connected = [...(AWS.neighbours.get(node.id) ?? [])].map((id) => AWS.nodeById.get(id)!);
  // Every case this service takes part in, and what each one decided about it.
  const appearances = awsCases
    .map((study) => ({
      study,
      options: study.options.filter((o) => o.nodes.includes(node.id)),
    }))
    .filter((a) => a.options.length > 0 || a.study.nodes.includes(node.id));

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/">Map</Link>
        <span aria-hidden="true">/</span>
        <Link href="/aws">AWS</Link>
        <span aria-hidden="true">/</span>
        <span>{category?.name}</span>
      </nav>

      <section className="concept-hero">
        <Mark node={node} size={56} />
        <div>
          <p className="tag">
            {category?.name} · {node.type}
          </p>
          <h1>{node.title}</h1>
          <p className="lede">{inline(node.summary)}</p>
          {node.exam.length > 0 && (
            <p className="exams">
              {node.exam.map((e) => (
                <span key={e} className="exam">
                  {EXAM_LABEL[e]}
                </span>
              ))}
            </p>
          )}
          <div className="row">
            <Link className="btn primary" href={`/aws?focus=${node.id}`}>
              Show on the map
            </Link>
            {node.parts.length > 0 && (
              <Link className="btn gold" href={`/aws?focus=${node.id}&open=1`}>
                Take it apart
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
              const text = edgeTextBetween(AWS, node.id, n.id);
              return (
                <li key={n.id}>
                  <Link href={`/aws/${n.id}`}>
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
            The cases this service is part of, and what each one decided about it.
          </p>
          <ul className="appearances">
            {appearances.map(({ study, options }) => (
              <li key={study.id}>
                <Link href={`/aws?case=${study.id}`}>{study.title}</Link>
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
        <a href={awsSourceUrl(node)} target="_blank" rel="noreferrer">
          Edit this service on GitHub
        </a>
      </footer>
    </>
  );
}
