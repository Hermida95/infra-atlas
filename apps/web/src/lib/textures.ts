import * as THREE from "three";
import type { GraphNode } from "@/lib/graph";
import { logoFor, monogramFor } from "@/lib/logos";

export function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.12, "rgba(255,255,255,.95)");
  gr.addColorStop(0.3, "rgba(255,255,255,.16)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** White mark on transparent canvas: the brand logo when we have it, a hex monogram otherwise. */
export function markCanvas(node: GraphNode): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.strokeStyle = "#fff";
  const logo = logoFor(node);
  if (logo) {
    const [w, h] = logo.viewBox;
    const k = 96 / Math.max(w, h);
    g.translate(16 + (96 - w * k) / 2, 16 + (96 - h * k) / 2);
    g.scale(k, k);
    g.fill(new Path2D(logo.path), logo.fillRule);
    return c;
  }
  const txt = monogramFor(node);
  g.lineWidth = 5;
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    g[i ? "lineTo" : "moveTo"](64 + 52 * Math.cos(a), 64 + 52 * Math.sin(a));
  }
  g.closePath();
  g.stroke();
  g.font = `500 ${txt.length > 2 ? 30 : 38}px ui-monospace, monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(txt, 64, 66);
  return c;
}
