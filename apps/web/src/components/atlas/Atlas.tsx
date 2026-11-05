"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Atlas as AtlasWorld,
  categories,
  type ExamFilter,
  examLabel,
  inScope,
} from "@/lib/atlas";
import { type Case, type CaseOption, edgeTextBetween, type GraphNode } from "@/lib/graph";
import { caseLit, optionLit } from "@/lib/lit";
import { doorway } from "@/lib/worlds";
import type { MapStore } from "../brain/BrainScene";
import { Mark } from "../brain/Mark";
import { Header } from "../Header";
import { inline } from "../Prose";
import { Teardown } from "../teardown/Teardown";
import { Cases } from "./Cases";

const BrainScene = dynamic(() => import("../brain/BrainScene"), { ssr: false });

/*
 * An atlas: the same hologram, a different graph. Where the journey map answers "what do I need
 * in order to deploy this", an atlas answers "what is inside this thing, and which of these
 * pieces solves the problem in front of me" -- which is why it is a map of real cases rather
 * than a second deployment planner.
 *
 * Nothing here knows whether it is drawing AWS or Kubernetes. The route, the graph, the
 * certifications and the words all arrive in the `atlas` descriptor (lib/atlas.ts), so a third
 * world is a content directory and a descriptor, not a copy of this file.
 */
export default function Atlas({ atlas }: { atlas: AtlasWorld }) {
  const world = atlas.world;
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
        ? optionLit(world, nextOption)
        : next
          ? caseLit(world, next)
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
    [revealMap, world],
  );

  // Deep links: /<world>?case=<id> opens a case, ?focus=<id> flies to a node and
  // &open=1 takes it apart, so a situation, an object or a teardown is a shareable URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const picked = atlas.caseById.get(params.get("case") ?? "");
    const node = world.nodeById.get(params.get("focus") ?? "");
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
  }, [light, atlas, world]);

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

  const visible = useMemo(
    () => world.graph.nodes.filter((n) => inScope(n, filter)).length,
    [filter, world],
  );
  const back = `Back to ${atlas.copy.short}`;
  const deeper = selected ? doorway(atlas.id, selected.id) : null;

  return (
    <>
      <Header current={atlas.id} world={world} onPick={select} placeholder={atlas.copy.searchPlaceholder}
        one={atlas.copy.one} />

      <nav className="crumbs atlas-crumbs" aria-label="Breadcrumb">
        <Link href="/">Map</Link>
        <span aria-hidden="true">/</span>
        <span>{atlas.copy.short}</span>
      </nav>

      <div className="stage" aria-label={atlas.copy.stage}>
        {/* The scene captures its graph once, so switching worlds has to build a new one. */}
        <BrainScene
          key={atlas.id}
          world={world}
          store={store}
          labels={labels}
          onSelect={select}
          paused={teardown !== null}
        />
      </div>
      <div className="labels" ref={labels} aria-hidden="true" />

      <Cases
        atlas={atlas}
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
            <p className="tag">{world.domainById.get(selected.domain)?.name}</p>
            <div className="dhead">
              <Mark node={selected} size={34} />
              <h2>{selected.title}</h2>
            </div>
            {selected.exam.length > 0 && (
              <p className="exams">
                {selected.exam.map((e) => (
                  <span key={e} className="exam">
                    {examLabel(atlas, e)}
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
            {/* A node with a world of its own behind it: EKS is where this atlas ends. */}
            {deeper && (
              <Link className="btn primary enter-aws" href={deeper.href}>
                {deeper.label}
              </Link>
            )}
            <p className="detail-more">
              <Link href={`${atlas.path}/${selected.id}`}>Read the whole thing →</Link>
            </p>
            <h4>How it connects</h4>
            <ul className="wires">
              {[...(world.neighbours.get(selected.id) ?? [])].map((id) => {
                const node = world.nodeById.get(id)!;
                const text = edgeTextBetween(world, selected.id, id);
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
        <Structure
          atlas={atlas}
          filter={filter}
          onClose={() => setBrowsing(false)}
          onSelect={(n) => {
            setBrowsing(false);
            select(n);
          }}
        />
      )}

      <div className="hud" aria-hidden="true">
        {atlas.copy.nouns} <b>{visible}</b>
        <br />
        Links <b>{world.graph.links.length}</b>
        {study && (
          <>
            <br />
            Case{" "}
            <span className="gold">
              {(option ?? study).nodes.length} {atlas.copy.noun}s
            </span>
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
          world={world}
          backLabel={back}
          onClose={() => setTeardown(null)}
          onSelect={(n) => {
            setTeardown(null);
            select(n);
          }}
        />
      )}

      <div className="hint" aria-hidden="true">
        Drag to rotate · scroll to zoom · click {atlas.copy.one}
      </div>
    </>
  );
}

/** The whole catalogue, by area, for when you want to read rather than be asked a question. */
function Structure({
  atlas,
  filter,
  onClose,
  onSelect,
}: {
  atlas: AtlasWorld;
  filter: ExamFilter;
  onClose: () => void;
  onSelect: (node: GraphNode) => void;
}) {
  const areas = useMemo(() => categories(atlas, filter), [atlas, filter]);
  return (
    <section className="structure" aria-label={`${atlas.copy.short} ${atlas.copy.noun}s by area`}>
      <button type="button" className="btn td-back" onClick={onClose}>
        Back to {atlas.copy.short}
      </button>
      <div className="structure-inner">
        <h2>{atlas.copy.structureTitle}</h2>
        <p className="sub">{atlas.copy.structureIntro}</p>
        {areas.map(({ domain, nodes }) => (
          <section
            key={domain.id}
            className="cat"
            style={{ "--lit": `hsl(${domain.hue} 78% 66%)` } as React.CSSProperties}
          >
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
