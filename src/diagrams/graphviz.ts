/**
 * Схемы по DOT (Graphviz через @viz-js/viz, WASM — без установки Graphviz) → SVG → PNG (resvg).
 * Модель пишет DOT сама; мы лишь гарантируем шрифт с кириллицей и приятные дефолты.
 */
import { instance, type Viz } from "@viz-js/viz";
import { renderSvgToPng } from "../images/card.ts";

let vizPromise: Promise<Viz> | null = null;
function viz(): Promise<Viz> {
  if (!vizPromise) vizPromise = instance();
  return vizPromise;
}

const DEFAULTS = `graph [fontname="Arial", fontsize=14, bgcolor="white", pad=0.4, nodesep=0.5, ranksep=0.6];
  node [fontname="Arial", fontsize=13, shape=box, style="rounded,filled", fillcolor="#EEF2FF", color="#534AB7", penwidth=1.2, margin="0.25,0.12"];
  edge [fontname="Arial", fontsize=11, color="#5F5E5A", arrowsize=0.8];`;

/** Вставить дефолты сразу после открывающей скобки графа, если автор не задал fontname. */
export function withDefaults(dot: string): string {
  const src = String(dot ?? "").trim();
  if (/fontname/i.test(src)) return src;
  const m = src.match(/^(strict\s+)?(di)?graph\b[^{]*\{/i);
  if (!m) return src;
  const idx = m[0].length;
  return `${src.slice(0, idx)}\n  ${DEFAULTS}\n${src.slice(idx)}`;
}

export interface RenderedDiagram {
  png: Buffer;
  svg: string;
  width: number;
  height: number;
}

export async function renderDot(dot: string): Promise<RenderedDiagram> {
  const v = await viz();
  const svg = v.renderString(withDefaults(dot), { format: "svg" });
  const m = svg.match(/<svg[^>]*\swidth="([\d.]+)(pt|px)?"[^>]*\sheight="([\d.]+)(pt|px)?"/);
  const w = m ? Number(m[1]) * (m[2] === "pt" ? 96 / 72 : 1) : 800;
  const h = m ? Number(m[3]) * (m[4] === "pt" ? 96 / 72 : 1) : 600;
  // Рисуем крупнее исходного размера (ретина), но не шире 2400 px.
  const targetW = Math.max(800, Math.min(2400, Math.round(w * 2)));
  const png = renderSvgToPng(svg, { width: targetW, background: "white" });
  return { png, svg, width: targetW, height: Math.round((h / w) * targetW) };
}

/** Проверка DOT без рендера в PNG: бросает понятную ошибку синтаксиса. */
export async function validateDot(dot: string): Promise<void> {
  const v = await viz();
  v.renderString(withDefaults(dot), { format: "canon" });
}
