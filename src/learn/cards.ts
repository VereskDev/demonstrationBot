/**
 * Карточки по системе Лейтнера: 5 коробок, интервалы 0/1/3/7/16 дней. «Помню» — коробка +1,
 * «Не помню» — в первую. Слова из ошибок добавляются автоматически (dedupe по слову).
 */
import { getDb, fold } from "../db/index.ts";

export const BOX_INTERVAL_DAYS = [0, 1, 3, 7, 16];
const DAY = 86_400_000;

export interface CardRow {
  id: number;
  chat_id: string;
  front: string;
  back: string;
  box: number;
  due_at: number;
  lapses: number;
  reviews: number;
  source: string | null;
  created_at: number;
}

export function ensureCardsSchema(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS learn_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      front TEXT NOT NULL,
      front_key TEXT NOT NULL,
      back TEXT NOT NULL,
      box INTEGER NOT NULL DEFAULT 1,
      due_at INTEGER NOT NULL,
      lapses INTEGER NOT NULL DEFAULT 0,
      reviews INTEGER NOT NULL DEFAULT 0,
      source TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(chat_id, front_key)
    );
    CREATE INDEX IF NOT EXISTS learn_cards_due ON learn_cards(chat_id, due_at);
  `);
}

export function addCard(chatId: string, front: string, back: string, source = "manual", now = Date.now()): { card: CardRow; created: boolean } {
  const f = front.trim();
  const b = back.trim();
  if (!f || !b) throw new Error("пустая карточка");
  const key = fold(f).replace(/^(el|la|los|las|un|una)\s+/, "");
  const existing = getDb().prepare("SELECT * FROM learn_cards WHERE chat_id = ? AND front_key = ?").get(chatId, key) as CardRow | undefined;
  if (existing) return { card: existing, created: false };
  const res = getDb()
    .prepare("INSERT INTO learn_cards(chat_id, front, front_key, back, box, due_at, source, created_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)")
    .run(chatId, f, key, b, now, source, now);
  return { card: getCard(chatId, Number(res.lastInsertRowid))!, created: true };
}

export function getCard(chatId: string, id: number): CardRow | null {
  return (getDb().prepare("SELECT * FROM learn_cards WHERE chat_id = ? AND id = ?").get(chatId, id) as CardRow | undefined) ?? null;
}

export function dueCards(chatId: string, now = Date.now(), limit = 20): CardRow[] {
  return getDb().prepare("SELECT * FROM learn_cards WHERE chat_id = ? AND due_at <= ? ORDER BY box ASC, due_at ASC LIMIT ?").all(chatId, now, limit) as unknown as CardRow[];
}

export function cardStats(chatId: string, now = Date.now()): { total: number; due: number; byBox: number[] } {
  const total = Number((getDb().prepare("SELECT COUNT(*) AS n FROM learn_cards WHERE chat_id = ?").get(chatId) as { n: number }).n);
  const due = Number((getDb().prepare("SELECT COUNT(*) AS n FROM learn_cards WHERE chat_id = ? AND due_at <= ?").get(chatId, now) as { n: number }).n);
  const rows = getDb().prepare("SELECT box, COUNT(*) AS n FROM learn_cards WHERE chat_id = ? GROUP BY box").all(chatId) as unknown as Array<{ box: number; n: number }>;
  const byBox = [0, 0, 0, 0, 0];
  for (const r of rows) byBox[Math.min(5, Math.max(1, Number(r.box))) - 1] = Number(r.n);
  return { total, due, byBox };
}

/** Оценка карточки. «Не помню» откладывает на 10 минут, чтобы не крутить её по кругу в той же сессии. */
export function reviewCard(chatId: string, id: number, remembered: boolean, now = Date.now()): CardRow | null {
  const c = getCard(chatId, id);
  if (!c) return null;
  const box = remembered ? Math.min(5, c.box + 1) : 1;
  const due = remembered ? now + BOX_INTERVAL_DAYS[box - 1] * DAY : now + 10 * 60_000;
  getDb()
    .prepare("UPDATE learn_cards SET box = ?, due_at = ?, lapses = lapses + ?, reviews = reviews + 1 WHERE id = ?")
    .run(box, due, remembered ? 0 : 1, id);
  return getCard(chatId, id);
}

export function deleteCard(chatId: string, id: number): boolean {
  return Number(getDb().prepare("DELETE FROM learn_cards WHERE chat_id = ? AND id = ?").run(chatId, id).changes) > 0;
}

export function listCards(chatId: string, limit = 30): CardRow[] {
  return getDb().prepare("SELECT * FROM learn_cards WHERE chat_id = ? ORDER BY due_at ASC LIMIT ?").all(chatId, limit) as unknown as CardRow[];
}
