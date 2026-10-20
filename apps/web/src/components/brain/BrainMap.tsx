"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { domainById, graph, type GraphNode, neighbours, nodeById } from "@/lib/graph";
import BrainScene, { type MapStore } from "./BrainScene";
import { Mark } from "./Mark";
import { Planner } from "./Planner";
import { Teardown } from "../teardown/Teardown";
import type { Route } from "@/lib/planner";

export default function BrainMap() {
  const store = useRef<MapStore>({ hover: null, selected: null, route: null, routeAt: 0, shiftX: 0 });
  const labels = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [query, setQuery] = useState("");
  const [route, setRoute] = useState<Route | null>(null);
  const [teardown, setTeardownState] = useState<GraphNode | null>(null);

  // Deep links: /?t=<concept id> opens that teardown, so a technology can be shared directly.
  const setTeardown = useCallback((node: GraphNode | null) => {
    setTeardownState(node);
    const url = new URL(window.location.href);
    if (node) url.searchParams.set("t", node.id);
    else url.searchParams.delete("t");
    window.history.replaceState(null, "", url);
  }, []);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("t");
    const node = id ? nodeById.get(id) : undefined;
    if (node?.parts.length) {
      store.current.selected = node;
      // Deferred so the state update does not run synchronously inside the effect.
      queueMicrotask(() => {
        setSelected(node);
        setTeardownState(node);
      });
    }
  }, []);

  // On desktop the planner sits on the left, so the hologram is centred in the remaining space.
  useEffect(() => {
    const mq = matchMedia("(min-width: 768px)");
    const sync = () => (store.current.shiftX = mq.matches ? 200 : 0);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const showRoute = useCallback((next: Route | null) => {
    store.current.route = next;
    store.current.routeAt = performance.now();
    store.current.selected = null;
    setSelected(null);
    setRoute(next);
  }, []);

  const select = useCallback((node: GraphNode | null) => {
    store.current.selected = node;
    setSelected(node);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector(".teardown") && select(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim().toLowerCase();
    if (!q) return;
    const hit =
      graph.nodes.find((n) => n.title.toLowerCase() === q) ?? graph.nodes.find((n) => n.title.toLowerCase().includes(q));
    if (hit) select(hit);
  };

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="reactor" aria-hidden="true" />
          Infra Atlas
        </div>
        <nav aria-label="Main">
          <Link href="/" aria-current="page">Map</Link>
        </nav>
        <form className="search" role="search" onSubmit={search}>
          <input
            type="search"
            placeholder="Find a concept"
            aria-label="Find a concept"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
      </header>

      <div className="stage" aria-label="3D knowledge map of DevOps and AWS concepts. Drag to rotate, scroll to zoom, click a node for details.">
        <BrainScene store={store} labels={labels} onSelect={select} paused={teardown !== null} />
      </div>
      <div className="labels" ref={labels} aria-hidden="true" />

      <Planner route={route} onRoute={showRoute} onSelect={select} />

      <aside className={`panel detail${selected ? " open" : ""}`} aria-live="polite">
        {selected && (
          <>
            <button className="close" onClick={() => select(null)} aria-label="Close">×</button>
            <p className="tag">{domainById.get(selected.domain)?.name}</p>
            <div className="dhead">
              <Mark node={selected} size={34} />
              <h2>{selected.title}</h2>
            </div>
            <p>{selected.summary}</p>
            {selected.parts.length > 0 && (
              <button type="button" className="btn gold" onClick={() => setTeardown(selected)}>
                Take it apart
              </button>
            )}
            <h4>Connected to</h4>
            <div className="links">
              {[...(neighbours.get(selected.id) ?? [])].map((id) => {
                const n = nodeById.get(id)!;
                return (
                  <button key={id} className="chip" onClick={() => select(n)}>
                    {n.title}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </aside>

      <div className="hud" aria-hidden="true">
        Concepts <b>{graph.nodes.length}</b>
        <br />
        Links <b>{graph.links.length}</b>
        {route && (
          <>
            <br />
            Route <span className="gold">{route.order.size} components</span>
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
          onClose={() => setTeardown(null)}
          onSelect={(n) => {
            setTeardown(null);
            select(n);
          }}
        />
      )}

      <div className="hint" aria-hidden="true">Drag to rotate · scroll to zoom · click a node</div>
    </>
  );
}
