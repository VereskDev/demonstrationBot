/** Проверка ответов ученика: мягкое сравнение (регистр, пунктуация, ударения), для переводов — судья-модель. */
import { parseModelJson, simplePrompt } from "../llm/gemini.ts";
import type { ModelTransport } from "../llm/types.ts";
import { log, errMsg } from "../runtime/log.ts";

export function normalizeAnswer(s: string, stripAccents = false): string {
  let t = String(s ?? "")
    .toLowerCase()
    .replace(/[¿?¡!.,;:«»"'()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (stripAccents) t = t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ñ/g, "n");
  return t;
}

/** Точное/почти точное совпадение: с ударениями или без. */
export function matchesAnswer(user: string, expected: string[]): boolean {
  const u1 = normalizeAnswer(user);
  const u2 = normalizeAnswer(user, true);
  for (const e of expected) {
    if (!e) continue;
    if (u1 === normalizeAnswer(e)) return true;
    if (u2 === normalizeAnswer(e, true)) return true;
  }
  return false;
}

/** Ответ без ударений, но правильный по сути — считаем верным, но подсказываем. */
export function accentsOnlyDiff(user: string, expected: string[]): boolean {
  const u = normalizeAnswer(user, true);
  return expected.some((e) => normalizeAnswer(e, true) === u && normalizeAnswer(e) !== normalizeAnswer(user));
}

export interface Judgement {
  ok: boolean;
  note?: string;
}

/** Перевод не совпал буквально — спрашиваем быструю модель, эквивалентен ли он. */
export async function judgeTranslation(model: ModelTransport, langName: string, ru: string, expected: string, user: string): Promise<Judgement> {
  try {
    const text = await simplePrompt(
      model,
      `Ученик переводит с русского на ${langName}. Задание: «${ru}». Эталон: «${expected}». Ответ ученика: «${user}».
Считай ответ верным, если смысл передан и грамматика допустима (синонимы, другой порядок слов, опущенное местоимение — ок; пропущенные ударения — ок). Ошибки в спряжении, роде, числе, неверные слова — неверно.
Верни строго JSON: {"ok": true|false, "note": "одна короткая фраза по-русски: что исправить или почему ок"}`,
      { fast: true, json: true, temperature: 0 },
    );
    const j = parseModelJson<{ ok?: unknown; note?: unknown }>(text);
    return { ok: j.ok === true, note: typeof j.note === "string" ? j.note.slice(0, 200) : undefined };
  } catch (e) {
    log.warn("learn", `судья перевода недоступен: ${errMsg(e)}`);
    return { ok: false };
  }
}
