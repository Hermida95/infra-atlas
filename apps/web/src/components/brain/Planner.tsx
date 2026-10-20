"use client";

import { useState } from "react";
import { graph, type GraphNode } from "@/lib/graph";
import { detect, plan, type Route, STAGE_LABEL } from "@/lib/planner";
import { Mark } from "./Mark";

type Props = {
  route: Route | null;
  onRoute: (route: Route | null) => void;
  onSelect: (node: GraphNode) => void;
};

export function Planner({ route, onRoute, onSelect }: Props) {
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  const apply = (next: Set<string>) => {
    setSelected(next);
    onRoute(next.size ? plan(next) : null);
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setError("");
    // Chips refine an existing route live; before the first run they only mark choices.
    if (route) apply(next);
    else setSelected(next);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new Set([...selected, ...detect(text)]);
    if (!next.size) {
      setError("Describe your app or pick at least one requirement.");
      return;
    }
    setError("");
    apply(next);
  };

  const clear = () => {
    setText("");
    setError("");
    setSelected(new Set());
    onRoute(null);
  };

  return (
    <aside className="panel planner" aria-labelledby="planner-title">
      <p className="tag">Deployment planner</p>
      <h1 id="planner-title">What are you deploying?</h1>
      <p className="sub">Describe your app. The map lights up the pieces you need and the order to wire them.</p>
      <form onSubmit={submit}>
        <label className="field" htmlFor="planner-text">Your app</label>
        <textarea
          id="planner-text"
          value={text}
          placeholder="A FastAPI app with Postgres, user login and image uploads, on a small budget"
          onChange={(e) => {
            setText(e.target.value);
            setError("");
          }}
          aria-describedby="planner-error"
        />
        <p className="err" id="planner-error" role="alert">{error}</p>
        <div className="chips" role="group" aria-label="Requirements">
          {graph.requirements.map((r) => (
            <button
              key={r.id}
              type="button"
              className="chip"
              aria-pressed={selected.has(r.id)}
              onClick={() => toggle(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="row">
          <button type="submit" className="btn primary">Light up my route</button>
          <button type="button" className="btn" onClick={clear}>Clear</button>
        </div>
      </form>

      {route && (
        <div className="route" aria-live="polite">
          {route.stages.map((s, i) => (
            <div key={s.stage} className="step" style={{ animationDelay: `${i * 70}ms` }}>
              <h3>{STAGE_LABEL[s.stage]}</h3>
              {s.steps.map(({ node, why }) => (
                <button key={node.id} type="button" className="item" onClick={() => onSelect(node)}>
                  <b>
                    <Mark node={node} size={14} />
                    {node.title}
                  </b>
                  <span>{why}</span>
                </button>
              ))}
            </div>
          ))}
          {route.notes.map((n) => (
            <p key={n} className="note">{n}</p>
          ))}
        </div>
      )}
    </aside>
  );
}
