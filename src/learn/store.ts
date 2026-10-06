/** Настройки, прогресс (streak) и текущая сессия режима обучения — в SQLite. */
import { getDb } from "../db/index.ts";
import { localDateStr, nowIn } from "../time.ts";
import { ensureCardsSchema } from "./cards.ts";
import { ALL_FOCUS, type Focus, type LearnProgress, type LearnSession, type LearnSettings, type Level, LEVELS } from "./types.ts";

let ready = false;
export function ensureLearnSchema(): void {
  if (ready) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS learn_settings (
      chat_id TEXT PRIMARY KEY,
      lang TEXT NOT NULL DEFAULT 'es',
      lang_name TEXT NOT NULL DEFAULT 'испанский',
      level TEXT NOT NULL DEFAULT 'A1',
      focus TEXT NOT NULL DEFAULT 'grammar,conversation,listening'
    );
    CREATE TABLE IF NOT EXISTS learn_progress (
      chat_id TEXT PRIMARY KEY,
      streak INTEGER NOT NULL DEFAULT 0,
      last_lesson_date TEXT,
      lessons_total INTEGER NOT NULL DEFAULT 0,
      topic_counts TEXT NOT NULL DEFAULT '{}',
      history TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS learn_sessions (
      chat_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      state TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS learn_app_decks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      card_ids TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS learn_lessons_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      level TEXT NOT NULL,
      lesson TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  ensureCardsSchema();
  ready = true;
}

/** Только для тестов: после useMemoryDb схему нужно создать заново. */
export function __resetLearnSchema(): void {
  ready = false;
  ensureLearnSchema();
}

export function getLearnSettings(chatId: string): LearnSettings {
  ensureLearnSchema();
  const row = getDb().prepare("SELECT * FROM learn_settings WHERE chat_id = ?").get(chatId) as { lang: string; lang_name: string; level: string; focus: string } | undefined;
  if (!row) return { lang: "es", langName: "испанский", level: "A1", focus: [...ALL_FOCUS] };
  const focus = row.focus.split(",").filter((f): f is Focus => (ALL_FOCUS as string[]).includes(f));
  return { lang: row.lang, langName: row.lang_name, level: (LEVELS as string[]).includes(row.level) ? (row.level as Level) : "A1", focus: focus.length ? focus : [...ALL_FOCUS] };
}

export function setLearnSettings(chatId: string, patch: Partial<LearnSettings>): LearnSettings {
  const cur = getLearnSettings(chatId);
  const next: LearnSettings = { ...cur, ...patch };
  if (!next.focus.length) next.focus = [...ALL_FOCUS];
  getDb()
    .prepare(
      "INSERT INTO learn_settings(chat_id, lang, lang_name, level, focus) VALUES (?, ?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET lang = excluded.lang, lang_name = excluded.lang_name, level = excluded.level, focus = excluded.focus",
    )
    .run(chatId, next.lang, next.langName, next.level, next.focus.join(","));
  return next;
}

export function toggleFocus(chatId: string, f: Focus): LearnSettings {
  const cur = getLearnSettings(chatId);
  const has = cur.focus.includes(f);
  const focus = has ? cur.focus.filter((x) => x !== f) : [...cur.focus, f];
  // Пустой фокус бессмысленен — оставляем хотя бы один.
  return setLearnSettings(chatId, { focus: focus.length ? focus : [f] });
}

export function getLearnProgress(chatId: string): LearnProgress {
  ensureLearnSchema();
  const row = getDb().prepare("SELECT * FROM learn_progress WHERE chat_id = ?").get(chatId) as
    | { streak: number; last_lesson_date: string | null; lessons_total: number; topic_counts: string; history: string }
    | undefined;
  if (!row) return { streak: 0, lastLessonDate: null, lessonsTotal: 0, topicCounts: {}, history: [] };
  return {
    streak: Number(row.streak),
    lastLessonDate: row.last_lesson_date,
    lessonsTotal: Number(row.lessons_total),
    topicCounts: safeJson<Record<string, number>>(row.topic_counts, {}),
    history: safeJson(row.history, []),
  };
}

function safeJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** Урок завершён: streak (дни подряд), счётчик темы, история. Возвращает обновлённый прогресс и флаг «streak вырос». */
export function recordLessonDone(chatId: string, topicId: string, score: number, total: number, tz: string, now = Date.now()): { progress: LearnProgress; streakGrew: boolean } {
  const p = getLearnProgress(chatId);
  const today = localDateStr(now, tz);
  const yesterday = nowIn(tz, now).minus({ days: 1 }).toFormat("yyyy-MM-dd");
  let streak = p.streak;
  let grew = false;
  if (p.lastLessonDate !== today) {
    streak = p.lastLessonDate === yesterday ? p.streak + 1 : 1;
    grew = true;
  }
  const topicCounts = { ...p.topicCounts, [topicId]: (p.topicCounts[topicId] ?? 0) + 1 };
  const history = [...p.history, { date: today, topic: topicId, score, total }].slice(-30);
  getDb()
    .prepare(
      "INSERT INTO learn_progress(chat_id, streak, last_lesson_date, lessons_total, topic_counts, history) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET streak = excluded.streak, last_lesson_date = excluded.last_lesson_date, lessons_total = excluded.lessons_total, topic_counts = excluded.topic_counts, history = excluded.history",
    )
    .run(chatId, streak, today, p.lessonsTotal + 1, JSON.stringify(topicCounts), JSON.stringify(history));
  return { progress: { streak, lastLessonDate: today, lessonsTotal: p.lessonsTotal + 1, topicCounts, history }, streakGrew: grew };
}

export function getLearnSession(chatId: string): LearnSession | null {
  ensureLearnSchema();
  const row = getDb().prepare("SELECT kind, state FROM learn_sessions WHERE chat_id = ?").get(chatId) as { kind: string; state: string } | undefined;
  if (!row) return null;
  const parsed = safeJson<LearnSession | null>(row.state, null);
  return parsed && parsed.kind === row.kind ? parsed : null;
}

export function setLearnSession(chatId: string, session: LearnSession): void {
  ensureLearnSchema();
  getDb()
    .prepare("INSERT INTO learn_sessions(chat_id, kind, state, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET kind = excluded.kind, state = excluded.state, updated_at = excluded.updated_at")
    .run(chatId, session.kind, JSON.stringify(session), Date.now());
}

export function clearLearnSession(chatId: string): void {
  ensureLearnSchema();
  getDb().prepare("DELETE FROM learn_sessions WHERE chat_id = ?").run(chatId);
}

/** Колода, выданная Mini App через кнопку меню: по id потом разбираем результаты из /start-ссылки. */
export function createAppDeck(chatId: string, cardIds: number[]): number {
  ensureLearnSchema();
  const res = getDb().prepare("INSERT INTO learn_app_decks(chat_id, card_ids, created_at) VALUES (?, ?, ?)").run(chatId, JSON.stringify(cardIds), Date.now());
  // Старые колоды не нужны — чистим всё старше недели.
  getDb().prepare("DELETE FROM learn_app_decks WHERE created_at < ?").run(Date.now() - 7 * 86_400_000);
  return Number(res.lastInsertRowid);
}

export function getAppDeck(id: number): { chatId: string; cardIds: number[] } | null {
  ensureLearnSchema();
  const row = getDb().prepare("SELECT chat_id, card_ids FROM learn_app_decks WHERE id = ?").get(id) as { chat_id: string; card_ids: string } | undefined;
  if (!row) return null;
  const ids = safeJson<number[]>(row.card_ids, []);
  return { chatId: row.chat_id, cardIds: ids };
}

export function cacheLesson(chatId: string, topicId: string, level: string, lesson: unknown): void {
  getDb().prepare("INSERT INTO learn_lessons_cache(chat_id, topic_id, level, lesson, created_at) VALUES (?, ?, ?, ?, ?)").run(chatId, topicId, level, JSON.stringify(lesson), Date.now());
}
