/**
 * SQLite (node:sqlite, без нативных зависимостей). Один файл в DATA_DIR. Схема создаётся при
 * старте; миграции — добавочные ALTER в migrate().
 *
 * Поиск: lower() в SQLite не знает кириллицы, поэтому у заметок/задач есть колонка `search` с
 * текстом, приведённым к нижнему регистру в JS; ищем по ней через LIKE.
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { config } from "../config.ts";

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  const file = process.env.ASSISTANT_DB_PATH || path.join(config.dataDir, "assistant.sqlite");
  db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

/** Только для тестов: отдельная база в памяти. */
export function useMemoryDb(): DatabaseSync {
  db = new DatabaseSync(":memory:");
  migrate(db);
  return db;
}

function migrate(d: DatabaseSync): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chats (
      chat_id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT,
      tz TEXT,
      history TEXT NOT NULL DEFAULT '[]',
      pending_mode TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      text TEXT NOT NULL,
      search TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '',
      photo_file_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notes_chat ON notes(chat_id, created_at);
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      search TEXT NOT NULL,
      notes TEXT,
      done INTEGER NOT NULL DEFAULT 0,
      due TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      done_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS tasks_chat ON tasks(chat_id, parent_id, done);
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      text TEXT NOT NULL,
      at_utc INTEGER NOT NULL,
      repeat TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      task_id INTEGER,
      last_fired_at INTEGER,
      fire_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS reminders_due ON reminders(active, at_utc);
    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  // Присланные файлы (pptx, docx, pdf…) живут в заметках по file_id Telegram — пересылаются по просьбе.
  ensureColumns(d, "notes", [
    ["file_id", "TEXT"],
    ["file_name", "TEXT"],
    ["file_mime", "TEXT"],
  ]);
}

/** Добавочные колонки поверх старой схемы (ALTER TABLE, если колонки ещё нет). */
function ensureColumns(d: DatabaseSync, table: string, cols: Array<[string, string]>): void {
  const have = new Set((d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name));
  for (const [name, ddl] of cols) if (!have.has(name)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
}

export function fold(s: string): string {
  return String(s ?? "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

// ───────────────────────── settings ─────────────────────────
export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb().prepare("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

// ───────────────────────── chats ─────────────────────────
export interface ChatRow {
  chat_id: string;
  user_id: string | null;
  name: string | null;
  tz: string | null;
  history: string;
  pending_mode: string | null;
  created_at: number;
  updated_at: number;
}

export function getChat(chatId: string): ChatRow | null {
  return (getDb().prepare("SELECT * FROM chats WHERE chat_id = ?").get(chatId) as ChatRow | undefined) ?? null;
}

export function ensureChat(chatId: string, userId?: string, name?: string): ChatRow {
  const existing = getChat(chatId);
  const now = Date.now();
  if (existing) {
    if ((userId && userId !== existing.user_id) || (name && name !== existing.name)) {
      getDb().prepare("UPDATE chats SET user_id = COALESCE(?, user_id), name = COALESCE(?, name), updated_at = ? WHERE chat_id = ?").run(userId ?? null, name ?? null, now, chatId);
    }
    return getChat(chatId)!;
  }
  getDb()
    .prepare("INSERT INTO chats(chat_id, user_id, name, tz, history, created_at, updated_at) VALUES (?, ?, ?, NULL, '[]', ?, ?)")
    .run(chatId, userId ?? null, name ?? null, now, now);
  return getChat(chatId)!;
}

export function chatTz(chatId: string): string {
  return getChat(chatId)?.tz || config.defaultTimezone;
}

export function setChatTz(chatId: string, tz: string): void {
  ensureChat(chatId);
  getDb().prepare("UPDATE chats SET tz = ?, updated_at = ? WHERE chat_id = ?").run(tz, Date.now(), chatId);
}

export function loadHistory<T = unknown>(chatId: string): T[] {
  const row = getChat(chatId);
  if (!row) return [];
  try {
    const arr = JSON.parse(row.history);
    return Array.isArray(arr) ? (arr as T[]) : [];
  } catch {
    return [];
  }
}

export function saveHistory(chatId: string, history: unknown[]): void {
  ensureChat(chatId);
  getDb().prepare("UPDATE chats SET history = ?, updated_at = ? WHERE chat_id = ?").run(JSON.stringify(history), Date.now(), chatId);
}

export function clearHistory(chatId: string): void {
  getDb().prepare("UPDATE chats SET history = '[]', pending_mode = NULL, updated_at = ? WHERE chat_id = ?").run(Date.now(), chatId);
}

export function setPendingMode(chatId: string, mode: string | null): void {
  ensureChat(chatId);
  getDb().prepare("UPDATE chats SET pending_mode = ?, updated_at = ? WHERE chat_id = ?").run(mode, Date.now(), chatId);
}

export function listChats(): ChatRow[] {
  return getDb().prepare("SELECT * FROM chats").all() as unknown as ChatRow[];
}

// ───────────────────────── notes ─────────────────────────
export interface NoteRow {
  id: number;
  chat_id: string;
  text: string;
  tags: string;
  photo_file_id: string | null;
  file_id: string | null;
  file_name: string | null;
  file_mime: string | null;
  created_at: number;
  updated_at: number;
}

export interface NoteAttachment {
  photoFileId?: string;
  fileId?: string;
  fileName?: string;
  fileMime?: string;
}

const NOTE_COLS = "id, chat_id, text, tags, photo_file_id, file_id, file_name, file_mime, created_at, updated_at";

export function addNote(chatId: string, text: string, tags: string[] = [], attachment: NoteAttachment | string = {}): NoteRow {
  const now = Date.now();
  const att: NoteAttachment = typeof attachment === "string" ? { photoFileId: attachment } : attachment;
  const tagStr = tags.map((t) => t.replace(/^#/, "").trim()).filter(Boolean).join(",");
  const res = getDb()
    .prepare("INSERT INTO notes(chat_id, text, search, tags, photo_file_id, file_id, file_name, file_mime, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(chatId, text, fold(`${text} ${tagStr} ${att.fileName ?? ""}`), tagStr, att.photoFileId ?? null, att.fileId ?? null, att.fileName ?? null, att.fileMime ?? null, now, now);
  return getNote(chatId, Number(res.lastInsertRowid))!;
}

export function getNote(chatId: string, id: number): NoteRow | null {
  return (getDb().prepare(`SELECT ${NOTE_COLS} FROM notes WHERE chat_id = ? AND id = ?`).get(chatId, id) as NoteRow | undefined) ?? null;
}

export function listNotes(chatId: string, opts: { query?: string; tag?: string; limit?: number; offset?: number } = {}): NoteRow[] {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const offset = Math.max(opts.offset ?? 0, 0);
  const where: string[] = ["chat_id = ?"];
  const params: unknown[] = [chatId];
  if (opts.query) {
    for (const word of fold(opts.query).split(" ").filter(Boolean)) {
      where.push("search LIKE ?");
      params.push(`%${word}%`);
    }
  }
  if (opts.tag) {
    where.push("(',' || tags || ',') LIKE ?");
    params.push(`%,${opts.tag.replace(/^#/, "")},%`);
  }
  params.push(limit, offset);
  return getDb()
    .prepare(`SELECT ${NOTE_COLS} FROM notes WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...(params as never[])) as unknown as NoteRow[];
}

export function countNotes(chatId: string): number {
  return Number((getDb().prepare("SELECT COUNT(*) AS n FROM notes WHERE chat_id = ?").get(chatId) as { n: number }).n);
}

export function updateNote(chatId: string, id: number, patch: { text?: string; tags?: string[] }): NoteRow | null {
  const cur = getNote(chatId, id);
  if (!cur) return null;
  const text = patch.text ?? cur.text;
  const tags = patch.tags ? patch.tags.map((t) => t.replace(/^#/, "").trim()).filter(Boolean).join(",") : cur.tags;
  getDb().prepare("UPDATE notes SET text = ?, tags = ?, search = ?, updated_at = ? WHERE id = ?").run(text, tags, fold(`${text} ${tags}`), Date.now(), id);
  return getNote(chatId, id);
}

export function deleteNote(chatId: string, id: number): boolean {
  return Number(getDb().prepare("DELETE FROM notes WHERE chat_id = ? AND id = ?").run(chatId, id).changes) > 0;
}

// ───────────────────────── tasks ─────────────────────────
export interface TaskRow {
  id: number;
  chat_id: string;
  parent_id: number | null;
  title: string;
  notes: string | null;
  done: number;
  due: string | null;
  position: number;
  created_at: number;
  done_at: number | null;
}

const TASK_COLS = "id, chat_id, parent_id, title, notes, done, due, position, created_at, done_at";

export function addTask(chatId: string, title: string, opts: { parentId?: number | null; due?: string | null; notes?: string | null } = {}): TaskRow {
  const parentId = opts.parentId ?? null;
  if (parentId !== null && !getTask(chatId, parentId)) throw new Error(`задача ${parentId} не найдена`);
  const pos = Number(
    (getDb().prepare("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM tasks WHERE chat_id = ? AND parent_id IS ?").get(chatId, parentId) as { p: number }).p,
  );
  const res = getDb()
    .prepare("INSERT INTO tasks(chat_id, parent_id, title, search, notes, due, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(chatId, parentId, title, fold(title), opts.notes ?? null, opts.due ?? null, pos, Date.now());
  return getTask(chatId, Number(res.lastInsertRowid))!;
}

export function getTask(chatId: string, id: number): TaskRow | null {
  return (getDb().prepare(`SELECT ${TASK_COLS} FROM tasks WHERE chat_id = ? AND id = ?`).get(chatId, id) as TaskRow | undefined) ?? null;
}

export function listTasks(chatId: string, opts: { parentId?: number | null; includeDone?: boolean; query?: string; all?: boolean } = {}): TaskRow[] {
  const where: string[] = ["chat_id = ?"];
  const params: unknown[] = [chatId];
  if (!opts.all) {
    where.push("parent_id IS ?");
    params.push(opts.parentId ?? null);
  }
  if (!opts.includeDone) where.push("done = 0");
  if (opts.query) {
    for (const word of fold(opts.query).split(" ").filter(Boolean)) {
      where.push("search LIKE ?");
      params.push(`%${word}%`);
    }
  }
  return getDb().prepare(`SELECT ${TASK_COLS} FROM tasks WHERE ${where.join(" AND ")} ORDER BY done ASC, position ASC, id ASC`).all(...(params as never[])) as unknown as TaskRow[];
}

export function childCounts(chatId: string, parentId: number): { total: number; done: number } {
  const row = getDb().prepare("SELECT COUNT(*) AS total, COALESCE(SUM(done), 0) AS done FROM tasks WHERE chat_id = ? AND parent_id = ?").get(chatId, parentId) as { total: number; done: number };
  return { total: Number(row.total), done: Number(row.done) };
}

export function setTaskDone(chatId: string, id: number, done: boolean): TaskRow | null {
  const cur = getTask(chatId, id);
  if (!cur) return null;
  getDb().prepare("UPDATE tasks SET done = ?, done_at = ? WHERE id = ?").run(done ? 1 : 0, done ? Date.now() : null, id);
  if (done) {
    // Закрыли родителя — закрываем и детей.
    getDb().prepare("UPDATE tasks SET done = 1, done_at = COALESCE(done_at, ?) WHERE parent_id = ? AND done = 0").run(Date.now(), id);
  }
  return getTask(chatId, id);
}

export function updateTask(chatId: string, id: number, patch: { title?: string; due?: string | null; parentId?: number | null; notes?: string | null }): TaskRow | null {
  const cur = getTask(chatId, id);
  if (!cur) return null;
  const title = patch.title ?? cur.title;
  const due = patch.due === undefined ? cur.due : patch.due;
  const parentId = patch.parentId === undefined ? cur.parent_id : patch.parentId;
  const notes = patch.notes === undefined ? cur.notes : patch.notes;
  if (parentId === id) throw new Error("задача не может быть своим родителем");
  getDb().prepare("UPDATE tasks SET title = ?, search = ?, due = ?, parent_id = ?, notes = ? WHERE id = ?").run(title, fold(title), due, parentId, notes, id);
  return getTask(chatId, id);
}

export function deleteTask(chatId: string, id: number): boolean {
  return Number(getDb().prepare("DELETE FROM tasks WHERE chat_id = ? AND id = ?").run(chatId, id).changes) > 0;
}

/** Задачи со сроком в диапазоне локальных дат [from, to] (строки YYYY-MM-DD) + просроченные. */
export function tasksDueBetween(chatId: string, fromDate: string, toDate: string): { due: TaskRow[]; overdue: TaskRow[] } {
  const rows = getDb().prepare(`SELECT ${TASK_COLS} FROM tasks WHERE chat_id = ? AND done = 0 AND due IS NOT NULL ORDER BY due ASC`).all(chatId) as unknown as TaskRow[];
  const due: TaskRow[] = [];
  const overdue: TaskRow[] = [];
  for (const r of rows) {
    const d = String(r.due).slice(0, 10);
    if (d < fromDate) overdue.push(r);
    else if (d <= toDate) due.push(r);
  }
  return { due, overdue };
}

// ───────────────────────── reminders ─────────────────────────
export interface ReminderRow {
  id: number;
  chat_id: string;
  text: string;
  at_utc: number;
  repeat: string | null;
  active: number;
  task_id: number | null;
  last_fired_at: number | null;
  fire_count: number;
  created_at: number;
}

export function addReminder(chatId: string, text: string, atUtc: number, repeat: string | null, taskId?: number | null): ReminderRow {
  const res = getDb()
    .prepare("INSERT INTO reminders(chat_id, text, at_utc, repeat, active, task_id, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)")
    .run(chatId, text, atUtc, repeat, taskId ?? null, Date.now());
  return getReminder(chatId, Number(res.lastInsertRowid))!;
}

export function getReminder(chatId: string, id: number): ReminderRow | null {
  return (getDb().prepare("SELECT * FROM reminders WHERE chat_id = ? AND id = ?").get(chatId, id) as ReminderRow | undefined) ?? null;
}

export function listReminders(chatId: string, opts: { includeInactive?: boolean; limit?: number } = {}): ReminderRow[] {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  return getDb()
    .prepare(`SELECT * FROM reminders WHERE chat_id = ? ${opts.includeInactive ? "" : "AND active = 1"} ORDER BY active DESC, at_utc ASC LIMIT ?`)
    .all(chatId, limit) as unknown as ReminderRow[];
}

export function dueReminders(nowUtc: number): ReminderRow[] {
  return getDb().prepare("SELECT * FROM reminders WHERE active = 1 AND at_utc <= ? ORDER BY at_utc ASC LIMIT 50").all(nowUtc) as unknown as ReminderRow[];
}

export function rescheduleReminder(id: number, atUtc: number, opts: { fired?: boolean } = {}): void {
  if (opts.fired) {
    getDb().prepare("UPDATE reminders SET at_utc = ?, active = 1, last_fired_at = ?, fire_count = fire_count + 1 WHERE id = ?").run(atUtc, Date.now(), id);
  } else {
    getDb().prepare("UPDATE reminders SET at_utc = ?, active = 1 WHERE id = ?").run(atUtc, id);
  }
}

export function deactivateReminder(id: number, opts: { fired?: boolean } = {}): void {
  if (opts.fired) getDb().prepare("UPDATE reminders SET active = 0, last_fired_at = ?, fire_count = fire_count + 1 WHERE id = ?").run(Date.now(), id);
  else getDb().prepare("UPDATE reminders SET active = 0 WHERE id = ?").run(id);
}

export function updateReminder(chatId: string, id: number, patch: { text?: string; atUtc?: number; repeat?: string | null }): ReminderRow | null {
  const cur = getReminder(chatId, id);
  if (!cur) return null;
  getDb()
    .prepare("UPDATE reminders SET text = ?, at_utc = ?, repeat = ?, active = 1 WHERE id = ?")
    .run(patch.text ?? cur.text, patch.atUtc ?? cur.at_utc, patch.repeat === undefined ? cur.repeat : patch.repeat, id);
  return getReminder(chatId, id);
}

export function deleteReminder(chatId: string, id: number): boolean {
  return Number(getDb().prepare("DELETE FROM reminders WHERE chat_id = ? AND id = ?").run(chatId, id).changes) > 0;
}

// ───────────────────────── facts ─────────────────────────
export interface FactRow {
  id: number;
  chat_id: string;
  text: string;
  created_at: number;
}

export function addFact(chatId: string, text: string): FactRow {
  const res = getDb().prepare("INSERT INTO facts(chat_id, text, created_at) VALUES (?, ?, ?)").run(chatId, text, Date.now());
  return getDb().prepare("SELECT * FROM facts WHERE id = ?").get(Number(res.lastInsertRowid)) as unknown as FactRow;
}

export function listFacts(chatId: string): FactRow[] {
  return getDb().prepare("SELECT * FROM facts WHERE chat_id = ? ORDER BY id ASC").all(chatId) as unknown as FactRow[];
}

export function deleteFact(chatId: string, id: number): boolean {
  return Number(getDb().prepare("DELETE FROM facts WHERE chat_id = ? AND id = ?").run(chatId, id).changes) > 0;
}
