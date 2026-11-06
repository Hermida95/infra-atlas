"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { type GraphNode, MAP, type World } from "@/lib/graph";
import { ATLASES } from "@/lib/worlds";
import { CommandPalette } from "./CommandPalette";

/**
 * Shared top bar with the ⌘K command palette. On the map `onPick` flies to the concept;
 * anywhere else picking a concept opens its page.
 */
export function Header({
  onPick,
  current = "map",
  world = MAP,
  placeholder,
  one = "a concept",
}: {
  onPick?: (node: GraphNode) => void;
  /** "map", "concept", or the id of the atlas being read, which marks its link as current. */
  current?: string;
  /** Which graph ⌘K searches. Defaults to the journey map. */
  world?: World;
  /** What the ⌘K input suggests typing. An atlas passes its own; the journey map has a default. */
  placeholder?: string;
  /** What the search button offers to find: "a concept" on the journey map, "an object" inside Kubernetes. */
  one?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openPage = (node: GraphNode) => router.push(`/c/${node.id}`);
  // Only the journey map's concepts have a page of their own, so on any other graph
  // Cmd+Enter does what Enter does rather than pushing a URL that does not exist.
  const pick = onPick ?? openPage;
  const page = world === MAP ? openPage : pick;

  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand" aria-label="Infra Atlas, back to the map">
          <span className="reactor" aria-hidden="true" />
          Infra Atlas
        </Link>
        <nav aria-label="Main">
          <Link href="/" aria-current={current === "map" ? "page" : undefined}>
            Map
          </Link>
          {ATLASES.map((atlas) => (
            <Link
              key={atlas.id}
              href={atlas.path}
              aria-current={current === atlas.id ? "page" : undefined}
            >
              {atlas.name}
            </Link>
          ))}
        </nav>
        <button type="button" className="search-trigger" onClick={() => setOpen(true)} aria-keyshortcuts="Meta+K Control+K">
          <span>Find {one}</span>
          <kbd>⌘K</kbd>
        </button>
      </header>
      <CommandPalette
        open={open}
        onClose={() => setOpen(false)}
        onPick={pick}
        onOpenPage={page}
        hasPages={world === MAP}
        world={world}
        placeholder={placeholder ?? "Search Docker, etcd, managed postgres..."}
      />
    </>
  );
}
