"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AWS, awsCaseById, awsCategories, EXAM_LABEL, type ExamFilter, inScope } from "@/lib/aws";
import { type Case, type CaseOption, edgeTextBetween, type GraphNode } from "@/lib/graph";
import { caseLit, optionLit } from "@/lib/lit";
import type { MapStore } from "../brain/BrainScene";
import { Mark } from "../brain/Mark";
import { Header } from "../Header";
import { inline } from "../Prose";
import { Teardown } from "../teardown/Teardown";
import { Cases } from "./Cases";

const BrainScene = dynamic(() => import("../brain/BrainScene"), { ssr: false });

/*
 * The AWS atlas: the same hologram, a different graph. Where the journey map answers "what do I
 * need in order to deploy this", this one answers "what is inside AWS, and which of these
 * services solves the problem in front of me" -- which is why it is a map of real cases rather
 * than a second deployment planner.
 */
export default function AwsAtlas() {
  const store = useRef<MapStore>({ hover: null, selected: null, lit: null, litAt: 0, shiftX: 0 });
  const labels = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [study, setStudy] = useState<Case | null>(null);
  const [option, setOption] = useState<CaseOption | null>(null);
  const [filter, setFilter] = useState<ExamFilter>(null);
  const [teardown, setTeardown] = useState<GraphNode | null>(null);
  const [browsing, setBrowsing] = useState(false);

  const revealMap = useCallback(() => {
    if (!matchMedia("(max-width: 767px)").matches) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }, []);

  /** One place decides what is lit: a chosen option if there is one, otherwise the whole case. */
  const light = useCallback(
    (next: Case | null, nextOption: CaseOption | null) => {
      store.current.lit = nextOption
        ? optionLit(AWS, nextOption)
        : next
          ? caseLit(AWS, next)
          : null;
      store.current.litAt = performance.now();
      store.current.selected = null;
      setSelected(null);
      setStudy(next);
      setOption(nextOption);
      const url = new URL(window.location.href);
      if (next) url.searchParams.set("case", next.id);
      else url.searchParams.delete("case");
      window.history.replaceState(null, "", url);
      if (next) revealMap();
    },
    [revealMap],
  );

  // Deep links: /aws?case=<id> opens a case, /aws?focus=<id> flies to a service and
  // &open=1 takes it apart, so a situation, a service or a teardown is a shareable URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const picked = awsCaseById.get(params.get("case") ?? "");
    const node = AWS.nodeById.get(params.get("focus") ?? "");
    if (!picked && !node) return;
    // Deferred so the state updates do not run synchronously inside the effect.
    queueMicrotask(() => {
      if (picked) light(picked, null);
      if (node) {
        store.current.selected = node;
        setSelected(node);
        if (params.get("open") && node.parts.length) setTeardown(node);
      }
    });
  }, [light]);

  // On desktop the case panel sits on the left, so the hologram is centred in what is left.
  useEffect(() => {
    const mq = matchMedia("(min-width: 768px)");
    const sync = () => (store.current.shiftX = mq.matches ? 210 : 0);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const select = useCallback((node: GraphNode | null) => {
    store.current.selected = node;
    setSelected(node);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".teardown")) return;
      if (browsing) setBrowsing(false);
      else select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select, browsing]);

  const visible = useMemo(() => AWS.graph.nodes.filter((n) => inScope(n, filter)).length, [filter]);

  return (
    <>
      <Header current="aws" world={AWS} onPick={select} />

      <nav className="crumbs atlas-crumbs" aria-label="Breadcrumb">
        <Link href="/">Map</Link>
        <span aria-hidden="true">/</span>
        <span>AWS</span>
      </nav>

      <div
        className="stage"
        aria-label="3D map of the AWS services covered by the Solutions Architect certifications. Drag to rotate, scroll to zoom, click a service for details."
      >
        <BrainScene
          world={AWS}
          store={store}
          labels={labels}
          onSelect={select}
          paused={teardown !== null}
        />
      </div>
      <div className="labels" ref={labels} aria-hidden="true" />

      <Cases
        study={study}
        option={option}
        filter={filter}
        onFilter={setFilter}
        onCase={(next) => light(next, null)}
        onOption={(next) => light(study, next)}
        onSelect={(node) => {
          select(node);
          revealMap();
        }}
      />

      <aside className={`panel detail atlas-detail${selected ? " open" : ""}`} aria-live="polite">
        {selected && (
          <>
            <button className="close" onClick={() => select(null)} aria-label="Close">
              ×
            </button>
            <p className="tag">{AWS.domainById.get(selected.domain)?.name}</p>
            <div className="dhead">
              <Mark node={selected} size={34} />
              <h2>{selected.title}</h2>
            </div>
            {selected.exam.length > 0 && (
              <p className="exams">
                {selected.exam.map((e) => (
                  <span key={e} className="exam">
                    {EXAM_LABEL[e]}
                  </span>
                ))}
              </p>
            )}
            <p>{inline(selected.summary)}</p>
            {selected.parts.length > 0 && (
              <button type="button" className="btn gold" onClick={() => setTeardown(selected)}>
                Take it apart
              </button>
            )}
            <p className="detail-more">
              <Link href={`/aws/${selected.id}`}>Read the whole thing →</Link>
            </p>
            <h4>How it connects</h4>
            <ul className="wires">
              {[...(AWS.neighbours.get(selected.id) ?? [])].map((id) => {
                const node = AWS.nodeById.get(id)!;
                const text = edgeTextBetween(AWS, selected.id, id);
                return (
                  <li key={id}>
                    <button type="button" className="wire" onClick={() => select(node)}>
                      <Mark node={node} size={14} />
                      {node.title}
                    </button>
                    {text && <span>{inline(text)}</span>}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </aside>

      <button type="button" className="btn browse" onClick={() => setBrowsing(true)}>
        Browse the structure
      </button>

      {browsing && (
        <Structure filter={filter} onClose={() => setBrowsing(false)} onSelect={(n) => {
          setBrowsing(false);
          select(n);
        }} />
      )}

      <div className="hud" aria-hidden="true">
        Services <b>{visible}</b>
        <br />
        Links <b>{AWS.graph.links.length}</b>
        {study && (
          <>
            <br />
            Case <span className="gold">{(option ?? study).nodes.length} services</span>
          </>
        )}
        {selected && (
          <>
            <br />
            Focus <b>{selected.title}</b>
          </>
        )}
      </div>

      {teardown && (
        <Teardown
          key={teardown.id}
          node={teardown}
          world={AWS}
          backLabel="Back to AWS"
          onClose={() => setTeardown(null)}
          onSelect={(n) => {
            setTeardown(null);
            select(n);
          }}
        />
      )}

      <div className="hint" aria-hidden="true">Drag to rotate · scroll to zoom · click a service</div>
    </>
  );
}

/** The whole catalogue, by category, for when you want to read rather than be asked a question. */
function Structure({
  filter,
  onClose,
  onSelect,
}: {
  filter: ExamFilter;
  onClose: () => void;
  onSelect: (node: GraphNode) => void;
}) {
  const categories = useMemo(() => awsCategories(filter), [filter]);
  return (
    <section className="structure" aria-label="AWS services by category">
      <button type="button" className="btn td-back" onClick={onClose}>
        Back to AWS
      </button>
      <div className="structure-inner">
        <h2>What is inside AWS</h2>
        <p className="sub">
          Fifteen categories, read from the account outwards. Everything runs inside a VPC, the
          edge sits in front of it, and governance, security and operations wrap the whole thing.
        </p>
        {categories.map(({ domain, nodes }) => (
          <section key={domain.id} className="cat" style={{ "--lit": `hsl(${domain.hue} 78% 66%)` } as React.CSSProperties}>
            <h3>
              <span className="dot" aria-hidden="true" />
              {domain.name}
              <em>{nodes.length}</em>
            </h3>
            <ul>
              {nodes.map((node) => (
                <li key={node.id}>
                  <button type="button" onClick={() => onSelect(node)}>
                    <Mark node={node} size={18} />
                    <span>
                      <b>{node.title}</b>
                      <span>{node.summary}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
