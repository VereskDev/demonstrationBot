/**
 * Генерация карточек моделью: «20 карточек про еду» → пары слово/перевод уровня ученика,
 * без дублей с уже имеющимися. Для Mini App колода кодируется в URL (base64url JSON).
 */
import { parseModelJson, simplePrompt } from "../llm/gemini.ts";
import type { ModelTransport } from "../llm/types.ts";
import { log, errMsg } from "../runtime/log.ts";
import { addCard, listCards, type CardRow } from "./cards.ts";
import type { LearnSettings } from "./types.ts";

export interface GeneratedCards {
  added: number;
  duplicates: number;
  sample: Array<{ front: string; back: string }>;
}

export async function generateCards(model: ModelTransport, chatId: string, settings: LearnSettings, topic: string, count = 15): Promise<GeneratedCards> {
  const n = Math.max(3, Math.min(40, Math.round(count) || 15));
  const existing = listCards(chatId, 300)
    .map((c) => c.front)
    .slice(0, 150);
  const prompt = `Составь ${n} учебных карточек по языку «${settings.langName}» для русскоязычного ученика уровня ${settings.level} на тему «${topic}».
Каждая карточка — слово или короткое выражение (с артиклем, если он есть в языке) и точный русский перевод. Лексика частотная и полезная, без дублей, без слов из списка: ${existing.length ? existing.join(", ") : "(пусто)"}.
Верни СТРОГО JSON без markdown: {"cards":[{"front":"слово на изучаемом языке","back":"перевод"}]}`;
  const text = await simplePrompt(model, prompt, { fast: true, json: true, temperature: 0.7 });
  const raw = parseModelJson<{ cards?: unknown }>(text);
  const list = Array.isArray(raw.cards) ? raw.cards : [];
  let added = 0;
  let duplicates = 0;
  const sample: Array<{ front: string; back: string }> = [];
  for (const item of list) {
    const c = (item ?? {}) as Record<string, unknown>;
    const front = typeof c.front === "string" ? c.front.trim() : "";
    const back = typeof c.back === "string" ? c.back.trim() : "";
    if (!front || !back || front.length > 60 || back.length > 80) continue;
    try {
      const r = addCard(chatId, front, back, `gen:${topic.slice(0, 40)}`);
      if (r.created) {
        added += 1;
        if (sample.length < 5) sample.push({ front, back });
      } else duplicates += 1;
    } catch (e) {
      log.warn("learn", `карточка не добавлена: ${errMsg(e)}`);
    }
  }
  log.info("learn", `сгенерировано карточек: ${added} (дублей ${duplicates}) по теме «${topic}»`);
  return { added, duplicates, sample };
}

/**
 * Колода для Mini App → base64url. Короткие ключи, чтобы влезть в URL кнопки.
 * d — id колоды, u — username бота, m — режим «кнопка меню» (результаты вернутся /start-ссылкой).
 */
export function encodeDeck(cards: CardRow[], lang: string, extra: { deckId?: number; bot?: string; menu?: boolean } = {}): string {
  const payload: Record<string, unknown> = { v: 1, lang, cards: cards.map((c) => ({ i: c.id, f: c.front, b: c.back, x: c.box })) };
  if (extra.deckId) payload.d = extra.deckId;
  if (extra.bot) payload.u = extra.bot;
  if (extra.menu) payload.m = 1;
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/**
 * Результаты из /start-ссылки: `cr_<deckId base36>_<answered mask>_<ok mask>`, маски — base64url
 * битов по порядку карточек колоды. Укладывается в лимит payload (64 символа) даже для 40 карточек.
 */
export function parseStartResults(payload: string): { deckId: number; answered: boolean[]; ok: boolean[] } | null {
  const m = String(payload ?? "").match(/^cr_([0-9a-z]+)_([A-Za-z0-9_-]*)_([A-Za-z0-9_-]*)$/);
  if (!m) return null;
  const deckId = parseInt(m[1], 36);
  if (!Number.isInteger(deckId) || deckId <= 0) return null;
  const bits = (b64: string): boolean[] => {
    if (!b64) return [];
    const buf = Buffer.from(b64, "base64url");
    const out: boolean[] = [];
    for (let i = 0; i < buf.length * 8; i++) out.push(Boolean((buf[i >> 3] >> (i & 7)) & 1));
    return out;
  };
  return { deckId, answered: bits(m[2]), ok: bits(m[3]) };
}

export function decodeDeck(b64: string): { lang: string; cards: Array<{ i: number; f: string; b: string; x: number }> } | null {
  try {
    const o = JSON.parse(Buffer.from(b64, "base64url").toString("utf8")) as { lang?: string; cards?: unknown };
    if (!Array.isArray(o.cards)) return null;
    return { lang: String(o.lang ?? "es"), cards: o.cards as Array<{ i: number; f: string; b: string; x: number }> };
  } catch {
    return null;
  }
}

/** Результаты из Mini App: {type:"cards", results:[{i, ok}]}. */
export function parseWebAppResults(raw: string): Array<{ id: number; ok: boolean }> | null {
  try {
    const o = JSON.parse(raw) as { type?: string; results?: Array<{ i?: unknown; ok?: unknown }> };
    if (o.type !== "cards" || !Array.isArray(o.results)) return null;
    return o.results.map((r) => ({ id: Number(r.i), ok: r.ok === true })).filter((r) => Number.isInteger(r.id) && r.id > 0);
  } catch {
    return null;
  }
}
