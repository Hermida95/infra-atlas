"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { edgeTextBetween, type GraphNode, MAP, type World } from "@/lib/graph";
import { Mark } from "../brain/Mark";
import { DockerLab, freshDockerLab } from "./labs/DockerLab";
import type { TeardownStore } from "./TeardownScene";

const TeardownScene = dynamic(() => import("./TeardownScene"), { ssr: false });

/** Interactive labs, keyed by the `lab` id declared in a node's frontmatter. */
const LABS = { "docker-layers": DockerLab } as const;

type Props = {
  node: GraphNode;
  onClose: () => void;
  onSelect: (node: GraphNode) => void;
  /** Which graph the node belongs to. Defaults to the journey map. */
  world?: World;
  /** Label of the button that leaves the teardown, when it is not the journey map. */
  backLabel?: string;
};

export function Teardown({ node, onClose, onSelect, world = MAP, backLabel = "Back to map" }: Props) {
  const Lab = node.lab ? LABS[node.lab as keyof typeof LABS] : undefined;
  const store = useRef<TeardownStore>({
    act: -1,
    labOn: false,
    lab: Lab ? freshDockerLab(node.parts.length) : null,
    drag: 0,
  });
  const scroller = useRef<HTMLElement>(null);
  const firstPart = useRef<HTMLElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);

  // Which section is in the middle of the viewport drives the highlighted part and lab mode.
  useEffect(() => {
    const root = scroller.current, col = column.current;
    if (!root || !col) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const id = (en.target as HTMLElement).dataset.part ?? "";
          store.current.labOn = id === "lab";
          store.current.act = id === "lab" || id === "" ? -1 : Number(id);
          col.querySelectorAll(".td-sec").forEach((s) => s.classList.toggle("act", s === en.target && (id === "lab" || Number(id) >= 0)));
        }
      },
      { root, rootMargin: "-45% 0px -45% 0px" },
    );
    col.querySelectorAll(".td-sec").forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [node]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Drag the stage to turn the object.
  const dragX = useRef<number | null>(null);

  return (
    <section className="teardown" ref={scroller} aria-label={`${node.title} taken apart`}>
      <button type="button" className="btn td-back" onClick={onClose}>{backLabel}</button>
      <div className="td-grid">
        <div
          className="td-stage"
          onPointerDown={(e) => {
            dragX.current = e.clientX;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (dragX.current === null) return;
            store.current.drag += (e.clientX - dragX.current) * 0.008;
            dragX.current = e.clientX;
          }}
          onPointerUp={() => (dragX.current = null)}
        >
          <TeardownScene node={node} store={store} scroller={scroller} firstPart={firstPart} labels={labels} />
          <div className="td-labels" ref={labels} aria-hidden="true" />
        </div>
        <div className="td-col" ref={column}>
          <section className="td-sec intro" data-part="">
            <Mark node={node} size={64} />
            <p className="tag">{world.domainById.get(node.domain)?.name}</p>
            <h2>{node.title}</h2>
            <p>{node.lead ?? node.summary}</p>
            <p className="td-hint">Scroll to take it apart</p>
          </section>
          {node.parts.map((p, i) => (
            <section key={p.name} className="td-sec" data-part={i} ref={i === 0 ? firstPart : undefined}>
              <h3>{p.name}</h3>
              <p>{p.text}</p>
            </section>
          ))}
          {Lab && (
            <section className="td-sec lab" data-part="lab">
              <Lab store={store} parts={node.parts.length} />
            </section>
          )}
          <section className="td-sec outro" data-part="">
            <h3>Connected concepts</h3>
            <ul className="td-links">
              {[...(world.neighbours.get(node.id) ?? [])].map((id) => {
                const n = world.nodeById.get(id)!;
                const text = edgeTextBetween(world, node.id, id);
                return (
                  <li key={id}>
                    <button type="button" className="chip" onClick={() => onSelect(n)}>
                      {n.title}
                    </button>
                    {text && <span>{text}</span>}
                  </li>
                );
              })}
            </ul>
            <div className="row">
              <button type="button" className="btn" onClick={onClose}>{backLabel}</button>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
