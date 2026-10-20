"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { domainById, graph, type GraphNode, neighbours, nodeById } from "@/lib/graph";
import BrainScene, { type MapStore } from "./BrainScene";
import { Mark } from "./Mark";

export default function BrainMap() {
  const store = useRef<MapStore>({ hover: null, selected: null });
  const labels = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [query, setQuery] = useState("");

  const select = useCallback((node: GraphNode | null) => {
    store.current.selected = node;
    setSelected(node);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && select(null);
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
        <BrainScene store={store} labels={labels} onSelect={select} />
      </div>
      <div className="labels" ref={labels} aria-hidden="true" />

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
              <p className="soon">Teardown with {selected.parts.length} parts is being ported from the prototype.</p>
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
        {selected && (
          <>
            <br />
            Focus <b>{selected.title}</b>
          </>
        )}
      </div>
      <div className="hint" aria-hidden="true">Drag to rotate · scroll to zoom · click a node</div>
    </>
  );
}
