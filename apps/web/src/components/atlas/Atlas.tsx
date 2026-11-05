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
import type { MapStore, MapView } from "../brain/BrainScene";
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
  const store = useRef<MapStore>({
    hover: null, selected: null, lit: null, litAt: 0, shiftX: 0, view: null, hidden: null,
  });
  const labels = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [study, setStudy] = useState<Case | null>(null);
  const [option, setOption] = useState<CaseOption | null>(null);
  const [filter, setFilter] = useState<ExamFilter>(null);
  const [teardown, setTeardown] = useState<GraphNode | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [showAll, setShowAll] = useState(false);

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


  /*
   * How much of the graph is drawn, from general to specific. An atlas of 156 services with 385
   * links between them is unreadable all at once -- the lines cross everything and the logos sit
   * on top of each other -- so the map opens on the few nodes per area that carry its shape and
   * the links between those, and the rest arrives when the reader asks for it.
   *
   *   nothing chosen   the overview: major nodes, primary links
   *   a node chosen    that node and everyone it touches, with all their links -- its own brain
   *   a case chosen    the services the case touches, which the case already decided
   *
   * Nothing is lost: the detail panel lists every connection at every level, "Show everything"
   * turns the filter off, and a world that reads well whole is never narrowed at all.
   */
  const view = useMemo<MapView | null>(() => {
    if (showAll || !world.tiered) return null;
    if (study) return { nodes: new Set((option ?? study).nodes), links: "all" };
    if (selected) {
      const near = world.neighbours.get(selected.id) ?? new Set<string>();
      return { nodes: new Set([selected.id, ...near]), links: "all" };
    }
    return { nodes: world.majors, links: "primary" };
  }, [showAll, world, study, option, selected]);

  // Per visible node, how many of its links this view is not drawing. The map shows it next to
  // the node, so a logo says how much more is inside it before you click.
  const hidden = useMemo(() => {
    if (!view) return null;
    const counts = new Map<string, number>();
    for (const id of view.nodes) counts.set(id, 0);
    for (const link of world.graph.links) {
      const shown =
        view.nodes.has(link.source) &&
        view.nodes.has(link.target) &&
        (view.links === "all" || link.primary !== false);
      if (shown) continue;
      for (const end of [link.source, link.target]) {
        if (counts.has(end)) counts.set(end, counts.get(end)! + 1);
      }
    }
    return counts;
  }, [view, world]);

  useEffect(() => {
    store.current.view = view;
    store.current.hidden = hidden;
  }, [view, hidden]);

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

      <div className="levels">
        {world.tiered && (
          <button
            type="button"
            className={`btn${showAll ? " on" : ""}`}
            aria-pressed={showAll}
            onClick={() => setShowAll((on) => !on)}
            title={
              showAll
                ? "Back to the few per area that carry the shape of the map"
                : "Draw every node and every link at once"
            }
          >
            {showAll ? "Show the overview" : "Show everything"}
          </button>
        )}
        <button type="button" className="btn" onClick={() => setBrowsing(true)}>
          Browse the structure
        </button>
      </div>

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
        {atlas.copy.nouns} <b>{view ? `${view.nodes.size} of ${visible}` : visible}</b>
        <br />
        Links <b>{world.graph.links.length}</b>
        {view && !study && !selected && (
          <>
            <br />
            Overview <span className="gold">{world.majors.size} of {world.graph.nodes.length}</span>
          </>
        )}
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
        {selected && !study
          ? `${selected.title} and everything it touches · close it to go back`
          : view
            ? `The shape of it first · click ${atlas.copy.one} to open its own map`
            : `Drag to rotate · scroll to zoom · click ${atlas.copy.one}`}
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
