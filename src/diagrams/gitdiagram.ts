/**
 * Схема архитектуры репозитория GitHub через GitDiagram (gitdiagram.com/owner/repo.md отдаёт
 * описание + Mermaid уже сгенерированных схем) и рендер Mermaid в PNG через kroki.io.
 *
 * GitDiagram генерирует схему только из браузера (их нейросеть, ~минута). Если схемы ещё нет —
 * возвращаем ссылку «открой один раз», а дальше ждём в фоне (poll) и присылаем, как появится.
 */
import { httpRequest, httpBinary } from "../runtime/http.ts";
import { log } from "../runtime/log.ts";

export interface RepoRef {
  owner: string;
  repo: string;
  slug: string;
  githubUrl: string;
  diagramUrl: string;
}

export function parseRepoUrl(input: string): RepoRef | null {
  const s = String(input ?? "").trim();
  let m = s.match(/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i);
  if (!m) m = s.match(/gitdiagram\.com\/([\w.-]+)\/([\w.-]+?)(?:\.md)?(?:[/?#].*)?$/i);
  if (!m) m = s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) return null;
  const owner = m[1];
  const repo = m[2];
  return { owner, repo, slug: `${owner}/${repo}`, githubUrl: `https://github.com/${owner}/${repo}`, diagramUrl: `https://gitdiagram.com/${owner}/${repo}` };
}

export interface GitDiagramResult {
  ok: true;
  mermaid: string;
  explanation: string;
  updated?: string;
}

export interface GitDiagramPending {
  ok: false;
  reason: "not_generated" | "private_or_missing" | "error";
  message: string;
}

export async function fetchGitDiagram(ref: RepoRef): Promise<GitDiagramResult | GitDiagramPending> {
  const res = (await httpRequest({
    method: "GET",
    url: `${ref.diagramUrl}.md`,
    json: false,
    timeout: 60_000,
    returnFullResponse: true,
    ignoreHttpStatusErrors: true,
  })) as { statusCode: number; body: unknown };
  const body = String(res.body ?? "");
  if (res.statusCode === 404 || /has no stored diagram/i.test(body)) {
    return { ok: false, reason: "not_generated", message: "GitDiagram ещё не строил схему этого репозитория" };
  }
  if (res.statusCode >= 400) return { ok: false, reason: "error", message: `GitDiagram ответил ${res.statusCode}` };
  const mm = body.match(/```mermaid\s*\n([\s\S]*?)\n```/);
  if (!mm) return { ok: false, reason: "private_or_missing", message: "в ответе GitDiagram нет схемы (приватный репозиторий?)" };
  const expl = body.match(/<explanation>([\s\S]*?)<\/explanation>/i)?.[1]?.trim() ?? body.split(/## Diagram/i)[0].replace(/^#.*\n/, "").trim();
  const updated = body.match(/last updated ([\d-]+)/i)?.[1];
  return { ok: true, mermaid: mm[1].trim(), explanation: expl.slice(0, 4000), updated };
}

/** Mermaid → PNG через kroki.io (POST текстом). */
export async function renderMermaidPng(mermaid: string): Promise<Buffer> {
  const t0 = Date.now();
  const res = await fetch("https://kroki.io/mermaid/png", { method: "POST", headers: { "Content-Type": "text/plain" }, body: mermaid, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`kroki ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  log.info("diag", `kroki mermaid ${Date.now() - t0}мс ${bytes.length}B`);
  return bytes;
}

/** Mermaid → SVG через kroki (на случай, если PNG не вышел). */
export async function renderMermaidSvg(mermaid: string): Promise<Buffer | null> {
  const bin = await httpBinary("https://kroki.io/mermaid/svg", { method: "POST", headers: { "Content-Type": "text/plain" }, body: mermaid }, 90_000);
  return bin?.bytes ?? null;
}
