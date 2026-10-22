"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { activeIndex, moveSelection } from "@/lib/palette";
import { domainById, type GraphNode } from "@/lib/graph";
import { search } from "@/lib/search";
import { API_URL, MIN_SEMANTIC_QUERY, mergeHits, semanticSearch, type SemanticHit } from "@/lib/semantic";
import { Mark } from "./brain/Mark";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Enter: the default action for a concept (fly to it on the map, or open its page elsewhere). */
  onPick: (node: GraphNode) => void;
  /** Cmd/Ctrl+Enter: always open the concept page. */
  onOpenPage: (node: GraphNode) => void;
};

type Semantic = { query: string; hits: SemanticHit[]; failed: boolean };
type SemanticState = { hits: SemanticHit[]; status: "off" | "idle" | "loading" | "ok" | "offline" };

/** Delay after the last keystroke before asking the API, so typing a word costs one request. */
const DEBOUNCE_MS = 250;

/**
 * Meaning search for the current query, through the API's GET /search. Results are kept
 * with the query they answer, so a slow response never shows up under a newer query.
 */
function useSemanticSearch(query: string): SemanticState {
  const [result, setResult] = useState<Semantic | null>(null);
  const q = query.trim();
  const wanted = API_URL !== null && q.length >= MIN_SEMANTIC_QUERY;

  useEffect(() => {
    if (!wanted) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      semanticSearch(q, { signal: abort.signal })
        .then((hits) => setResult({ query: q, hits, failed: false }))
        .catch(() => {
          if (!abort.signal.aborted) setResult({ query: q, hits: [], failed: true });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [q, wanted]);

  if (API_URL === null) return { hits: [], status: "off" };
  if (!wanted) return { hits: [], status: result?.failed ? "offline" : "idle" };
  if (result?.query !== q) return { hits: [], status: "loading" };
  return { hits: result.hits, status: result.failed ? "offline" : "ok" };
}

export function CommandPalette({ open, onClose, onPick, onOpenPage }: Props) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const local = useMemo(() => search(query), [query]);
  const semantic = useSemanticSearch(query);
  const hits = useMemo(() => mergeHits(local, semantic.hits), [local, semantic.hits]);
  // Meaning hits arrive after the keystroke and reorder the list: follow the concept, not the row.
  const active = activeIndex(hits, selectedId);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  if (!open) return null;

  const choose = (node: GraphNode, page: boolean) => {
    onClose();
    setQuery("");
    setSelectedId(null);
    if (page) onOpenPage(node);
    else onPick(node);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedId(moveSelection(hits, selectedId, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedId(moveSelection(hits, selectedId, -1));
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
            setSelectedId(null);
          }}
        />
        <ul className="palette-list" id={listId} role="listbox" aria-label="Concepts">
          {hits.map(({ node, via, snippet }, i) => (
            <li
              key={node.id}
              id={`${listId}-${node.id}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "act" : undefined}
              onMouseEnter={() => setSelectedId(node.id)}
              onClick={(e) => choose(node, e.metaKey || e.ctrlKey)}
            >
              <Mark node={node} size={22} />
              <span className="palette-text">
                <b>{node.title}</b>
                <span>{snippet ?? node.summary}</span>
              </span>
              <span className="palette-domain">
                {via === "meaning" && <i className="palette-via">meaning</i>}
                <span className="palette-domain-name">{domainById.get(node.domain)?.name}</span>
              </span>
            </li>
          ))}
          {!hits.length && semantic.status !== "loading" && (
            <li className="palette-empty">No concept matches &ldquo;{query}&rdquo;.</li>
          )}
          {!hits.length && semantic.status === "loading" && <li className="palette-empty">Searching by meaning…</li>}
        </ul>
        <p className="palette-hint">
          <kbd>↑</kbd>
          <kbd>↓</kbd> move · <kbd>↵</kbd> open · <kbd>⌘</kbd>
          <kbd>↵</kbd> concept page · <kbd>Esc</kbd> close
          {semantic.status !== "off" && (
            <span className={`palette-status ${semantic.status}`} aria-live="polite">
              {semantic.status === "offline" ? "meaning search offline" : "meaning search on"}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
