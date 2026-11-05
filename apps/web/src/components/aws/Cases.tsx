"use client";

import type { Case, CaseOption, GraphNode } from "@/lib/graph";
import { AWS, awsCases, EXAM_LABEL, type ExamFilter } from "@/lib/aws";
import { VERDICT_COLOR, VERDICT_LABEL } from "@/lib/lit";
import { Mark } from "../brain/Mark";
import { inline } from "../Prose";

type Props = {
  study: Case | null;
  option: CaseOption | null;
  filter: ExamFilter;
  onFilter: (filter: ExamFilter) => void;
  onCase: (study: Case | null) => void;
  onOption: (option: CaseOption | null) => void;
  onSelect: (node: GraphNode) => void;
};

/*
 * The left panel of the atlas. Picking a case lights every service it touches, in the colour of
 * its category; picking one option lights that option's services only, in the colour of its
 * verdict. Switching between two options is then a diff you can see on the map rather than two
 * lists to compare by eye.
 */
export function Cases({ study, option, filter, onFilter, onCase, onOption, onSelect }: Props) {
  return (
    <aside className="panel cases" aria-labelledby="cases-title">
      <p className="tag">Inside AWS</p>
      <h1 id="cases-title">{study ? study.title : "Real cases"}</h1>

      {!study && (
        <>
          <p className="sub">
            Pick a situation. The services that could solve it light up on the map, and the ways to
            solve it appear here, with the one to reach for first.
          </p>
          <div className="chips" role="group" aria-label="Certification scope">
            {([null, "saa", "sap"] as const).map((scope) => (
              <button
                key={scope ?? "all"}
                type="button"
                className="chip"
                aria-pressed={filter === scope}
                onClick={() => onFilter(scope)}
              >
                {scope ? EXAM_LABEL[scope] : "Everything"}
              </button>
            ))}
          </div>
          <ul className="case-list">
            {awsCases.map((c) => (
              <li key={c.id}>
                <button type="button" className="case-pick" onClick={() => onCase(c)}>
                  <b>{c.title}</b>
                  <span>{c.scenario}</span>
                  <em>{c.exam.map((e) => EXAM_LABEL[e]).join(" · ")}</em>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {study && (
        <>
          <button type="button" className="btn case-back" onClick={() => onCase(null)}>
            All cases
          </button>
          <p className="scenario">{inline(study.scenario)}</p>
          {study.asks.length > 0 && (
            <ul className="asks">
              {study.asks.map((ask) => (
                <li key={ask}>{ask}</li>
              ))}
            </ul>
          )}

          <h2 className="opt-head">How you could do it</h2>
          <div className="options">
            {study.options.map((o) => (
              <Option
                key={o.id}
                option={o}
                open={option?.id === o.id}
                onToggle={() => onOption(option?.id === o.id ? null : o)}
                onSelect={onSelect}
              />
            ))}
          </div>

          {study.teaches && (
            <p className="teaches">
              <span className="tag">Remember</span>
              {inline(study.teaches)}
            </p>
          )}
        </>
      )}
    </aside>
  );
}

function Option({
  option,
  open,
  onToggle,
  onSelect,
}: {
  option: CaseOption;
  open: boolean;
  onToggle: () => void;
  onSelect: (node: GraphNode) => void;
}) {
  return (
    <section
      className={`option${open ? " open" : ""} v-${option.verdict}`}
      style={{ "--lit": VERDICT_COLOR[option.verdict] } as React.CSSProperties}
    >
      <button type="button" className="option-head" onClick={onToggle} aria-expanded={open}>
        <span className="verdict">
          <span className="dot" aria-hidden="true" />
          {VERDICT_LABEL[option.verdict]}
        </span>
        <b>{option.name}</b>
      </button>
      {open && (
        <div className="option-body">
          <p>{inline(option.why)}</p>
          {option.cost && (
            <p className="cost">
              <span className="field">Cost</span>
              {option.cost}
            </p>
          )}
          {option.watch.length > 0 && (
            <>
              <p className="field">What to watch</p>
              <ul className="watch">
                {option.watch.map((w) => (
                  <li key={w}>{inline(w)}</li>
                ))}
              </ul>
            </>
          )}
          <div className="links">
            {option.nodes.map((id) => {
              const node = AWS.nodeById.get(id);
              if (!node) return null;
              return (
                <button key={id} type="button" className="chip" onClick={() => onSelect(node)}>
                  <Mark node={node} size={13} />
                  {node.title}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
