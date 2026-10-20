"use client";

import { type RefObject, useState } from "react";
import type { LabState, TeardownStore } from "../TeardownScene";

/** Dockerfile instruction -> which part it builds (index in the node's parts) and how full. */
const DOCKERFILE = [
  { line: "FROM python:3.12-slim", part: 0, vis: 1, msg: "FROM pulls the base image: a slim Linux plus Python. You never rebuild these layers yourself." },
  { line: "COPY requirements.txt .", part: 1, vis: 0.4, msg: "Only the dependency list is copied first. This ordering is the trick that makes rebuilds fast. Keep going." },
  { line: "RUN pip install -r requirements.txt", part: 1, vis: 1, msg: "RUN executes and freezes the result as a read-only layer. This is the slow, heavy step." },
  { line: "COPY . .", part: 2, vis: 1, msg: "Your code goes in last, because it is what changes most often." },
  { line: 'CMD ["uvicorn", "main:app"]', part: 3, vis: 1, msg: "Metadata only: how to start the app. The image is complete. Run a container from it." },
];
const MAX_CONTAINERS = 3;

export function freshDockerLab(parts: number): LabState {
  return {
    containers: 0,
    parts: Array.from({ length: parts }, () => ({ vis: 0, drop: null, flash: 0, state: "" as const })),
    containerDrops: Array(MAX_CONTAINERS).fill(null),
  };
}

export function DockerLab({ store, parts }: { store: RefObject<TeardownStore>; parts: number }) {
  const [step, setStep] = useState(0);
  const [containers, setContainers] = useState(0);
  const [version, setVersion] = useState(0);
  const [msg, setMsg] = useState("Press Build next step to run the Dockerfile one instruction at a time.");
  const built = step >= DOCKERFILE.length;
  const lab = () => store.current.lab!;

  const next = () => {
    if (built) return setMsg("The image is already built. Start a container, or change the code to see the cache at work.");
    const s = DOCKERFILE[step], p = lab().parts[s.part], now = performance.now();
    if (p.vis === 0) p.drop = now;
    else p.flash = now;
    p.vis = s.vis;
    setStep(step + 1);
    setMsg(s.msg);
  };

  const run = () => {
    if (!built) return setMsg("Finish building the image first. A container always starts from a complete image.");
    if (containers >= MAX_CONTAINERS)
      return setMsg("Three containers, one image. The image is stored once; each container only adds its own thin writable layer.");
    lab().containerDrops[containers] = performance.now();
    lab().containers = containers + 1;
    setContainers(containers + 1);
    setMsg(
      containers === 0
        ? "A container is the image plus a thin writable layer. Whatever it writes lives only there and is gone when the container is removed."
        : "Another container, same read-only layers underneath. That is why containers start in seconds and barely use extra disk.",
    );
  };

  const rebuild = () => {
    if (!built) return setMsg("Build the full image first, then change the code.");
    const now = performance.now(), l = lab();
    l.parts.forEach((p, i) => {
      if (i < 2) Object.assign(p, { flash: now, state: "cached" });
      else if (i < 4) Object.assign(p, { drop: now + (i - 2) * 280, state: "rebuilt" });
    });
    l.containers = 0;
    l.containerDrops.fill(null);
    setContainers(0);
    setVersion(version + 1);
    setMsg(
      "You changed app.py. The base image and the dependencies come straight from cache. Only COPY . . and what follows are rebuilt, so the slow pip install is skipped. Start new containers from the new image.",
    );
  };

  const reset = () => {
    Object.assign(lab(), freshDockerLab(parts));
    setStep(0);
    setContainers(0);
    setVersion(0);
    setMsg("Press Build next step to run the Dockerfile one instruction at a time.");
  };

  const status = !built
    ? step ? `Building, ${step} of ${DOCKERFILE.length}` : "No image yet"
    : `Image myapp:1.${version}, read-only` + (containers ? `, ${containers} container${containers > 1 ? "s" : ""} running` : "");

  return (
    <>
      <p className="tag">Lab</p>
      <h3>Build it yourself</h3>
      <p>Step through the Dockerfile, start containers from the image, then change the code and watch the cache.</p>
      <ol className="dockerfile" aria-label="Dockerfile">
        {DOCKERFILE.map((d, i) => {
          const cached = version > 0 && i < 3, rebuilt = version > 0 && i >= 3;
          const cls = ["dl", i < step && "done", i === step - 1 && !version && "cur", cached && "cached", rebuilt && "rebuilt"].filter(Boolean).join(" ");
          return (
            <li key={d.line} className={cls}>
              <code>{d.line}</code>
              <span className="st">{cached ? "cached" : rebuilt ? "rebuilt" : ""}</span>
            </li>
          );
        })}
      </ol>
      <div className="labbar">
        <button type="button" className="btn primary sm" onClick={next}>Build next step</button>
        <button type="button" className="btn sm" onClick={run}>docker run</button>
        <button type="button" className="btn sm" onClick={rebuild}>Edit app.py and rebuild</button>
        <button type="button" className="btn sm" onClick={reset}>Reset</button>
      </div>
      <p className="labimg">{status}</p>
      <p className="labmsg" aria-live="polite">{msg}</p>
    </>
  );
}
