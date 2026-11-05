"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { type GraphNode, MAP, type World } from "@/lib/graph";
import { CommandPalette } from "./CommandPalette";

/**
 * Shared top bar with the ⌘K command palette. On the map `onPick` flies to the concept;
 * anywhere else picking a concept opens its page.
 */
export function Header({
  onPick,
  current = "map",
  world = MAP,
}: {
  onPick?: (node: GraphNode) => void;
  current?: "map" | "concept" | "aws";
  /** Which graph ⌘K searches. Defaults to the journey map. */
  world?: World;
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
          <Link href="/aws" aria-current={current === "aws" ? "page" : undefined}>
            Inside AWS
          </Link>
        </nav>
        <button type="button" className="search-trigger" onClick={() => setOpen(true)} aria-keyshortcuts="Meta+K Control+K">
          <span>{world === MAP ? "Find a concept" : "Find a service"}</span>
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
        placeholder={world === MAP ? "Search Docker, etcd, managed postgres..." : "Search NAT gateway, Aurora, failover..."}
      />
    </>
  );
}
