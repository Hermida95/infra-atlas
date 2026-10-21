"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { domainById, type GraphNode } from "@/lib/graph";
import { search } from "@/lib/search";
import { Mark } from "./brain/Mark";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Enter: the default action for a concept (fly to it on the map, or open its page elsewhere). */
  onPick: (node: GraphNode) => void;
  /** Cmd/Ctrl+Enter: always open the concept page. */
  onOpenPage: (node: GraphNode) => void;
};

export function CommandPalette({ open, onClose, onPick, onOpenPage }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const hits = useMemo(() => search(query), [query]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  if (!open) return null;

  const choose = (node: GraphNode, page: boolean) => {
    onClose();
    setQuery("");
    setActive(0);
    if (page) onOpenPage(node);
    else onPick(node);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      choose(hits[active].node, e.metaKey || e.ctrlKey);
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="panel palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search concepts"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKey}
      >
        <input
          ref={input}
          className="palette-input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={hits[active] ? `${listId}-${hits[active].node.id}` : undefined}
          aria-autocomplete="list"
          placeholder="Search Docker, etcd, managed postgres..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
        />
        <ul className="palette-list" id={listId} role="listbox" aria-label="Concepts">
          {hits.map(({ node }, i) => (
            <li
              key={node.id}
              id={`${listId}-${node.id}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "act" : undefined}
              onMouseEnter={() => setActive(i)}
              onClick={(e) => choose(node, e.metaKey || e.ctrlKey)}
            >
              <Mark node={node} size={22} />
              <span className="palette-text">
                <b>{node.title}</b>
                <span>{node.summary}</span>
              </span>
              <span className="palette-domain">{domainById.get(node.domain)?.name}</span>
            </li>
          ))}
          {!hits.length && <li className="palette-empty">No concept matches &ldquo;{query}&rdquo;.</li>}
        </ul>
        <p className="palette-hint">
          <kbd>↑</kbd>
          <kbd>↓</kbd> move · <kbd>↵</kbd> open · <kbd>⌘</kbd>
          <kbd>↵</kbd> concept page · <kbd>Esc</kbd> close
        </p>
      </div>
    </div>
  );
}
