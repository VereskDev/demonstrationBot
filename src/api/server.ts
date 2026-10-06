/**
 * HTTP API для Mini App (node:http, без зависимостей). Все /api/* требуют заголовок
 * X-Telegram-Init-Data с валидной подписью Telegram и user.id владельца. Данные те же, что у
 * бота (одна SQLite в том же процессе); действия «в чате» (урок, разговор) запускают сценарии
 * через того же sender'а, что и кнопки.
 */
import http from "node:http";
import { config } from "../config.ts";
import {
  addNote, addReminder, addTask, chatTz, childCounts, countNotes, deleteNote, deleteReminder, deleteTask, getSetting, getTask, listNotes, listReminders, listTasks,
  rescheduleReminder, setChatTz, setTaskDone, tasksDueBetween, updateNote, updateReminder, updateTask,
} from "../db/index.ts";
import { cardStats, deleteCard, dueCards, listCards, reviewCard, addCard } from "../learn/cards.ts";
import { generateCards } from "../learn/cardsGen.ts";
import { endTalk, startTalk } from "../learn/conversation.ts";
import { quitLesson, startLesson, type LearnCtx } from "../learn/lesson.ts";
import { clearLearnSession, getLearnProgress, getLearnSession, getLearnSettings, setLearnSettings } from "../learn/store.ts";
import { ALL_FOCUS, LEVELS, TOPICS, type Focus, type Level } from "../learn/types.ts";
import type { ModelTransport } from "../llm/types.ts";
import { withChatQueue } from "../runtime/chatQueue.ts";
import { track } from "../runtime/inflight.ts";
import { log, errMsg } from "../runtime/log.ts";
import type { Sender } from "../telegram/sender.ts";
import { describeNow, describeRepeat, formatDate, formatDateTime, isValidZone, localDateStr, nextOccurrence, normalizeRepeat, nowIn, parseLocal } from "../time.ts";
import { validateInitData } from "./initData.ts";

export interface ApiDeps {
  sender: Sender;
  model: ModelTransport;
  botToken?: string;
  /** Переопределение владельца (тесты). */
  ownerId?: () => string;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Ctx = { chatId: string; tz: string; now: number; query: URLSearchParams; body: Record<string, unknown>; params: string[] };
type Handler = (ctx: Ctx) => Promise<unknown> | unknown;
type Route = { method: string; re: RegExp; h: Handler };

function s(v: unknown): string {
  return v === undefined || v === null ? "" : String(v).trim();
}
function n(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const x = Number(v);
  return Number.isFinite(x) ? x : undefined;
}
function list(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : typeof v === "string" ? v.split(/[,\n;]/).map((x) => x.trim()).filter(Boolean) : [];
}

export function createApiServer(deps: ApiDeps): http.Server {
  const ownerId = deps.ownerId ?? (() => config.ownerId || getSetting("owner_id") || "");
  const routes: Route[] = [];
  const add = (method: string, path: string, h: Handler) => routes.push({ method, re: new RegExp("^" + path.replace(/:\w+/g, "([^/]+)") + "/?$"), h });

  const learnCtx = (c: Ctx): LearnCtx => ({ chatId: c.chatId, sender: deps.sender, model: deps.model, tz: c.tz });
  const inChat = (chatId: string, fn: () => Promise<void>) => void track(withChatQueue(chatId, () => fn().catch((e) => log.warn("api", `сценарий в чате: ${errMsg(e)}`))));

  // ── профиль ──
  add("GET", "/api/me", (c) => {
    const p = getLearnProgress(c.chatId);
    const cs = cardStats(c.chatId);
    return {
      chatId: c.chatId,
      tz: c.tz,
      now: describeNow(c.tz, c.now),
      counts: { notes: countNotes(c.chatId), tasksOpen: listTasks(c.chatId, { all: true }).length, reminders: listReminders(c.chatId).length, cardsDue: cs.due, cards: cs.total },
      learn: { ...getLearnSettings(c.chatId), streak: p.streak, lessonsTotal: p.lessonsTotal, lastLessonDate: p.lastLessonDate, session: getLearnSession(c.chatId)?.kind ?? null },
    };
  });
  add("POST", "/api/tz", (c) => {
    const tz = s(c.body.tz);
    if (!isValidZone(tz)) throw new HttpError(400, "неизвестная зона");
    setChatTz(c.chatId, tz);
    return { tz };
  });

  // ── сегодня ──
  add("GET", "/api/agenda", (c) => {
    const offset = n(c.query.get("offset")) ?? 0;
    const day = nowIn(c.tz, c.now).plus({ days: offset }).startOf("day");
    const dayStr = day.toFormat("yyyy-MM-dd");
    const { due, overdue } = tasksDueBetween(c.chatId, dayStr, dayStr);
    const start = day.toMillis();
    const end = day.plus({ days: 1 }).toMillis();
    const rems = listReminders(c.chatId, { limit: 200 }).filter((r) => r.at_utc >= start && r.at_utc < end);
    return {
      date: dayStr,
      title: offset === 0 ? "Сегодня" : offset === 1 ? "Завтра" : offset === -1 ? "Вчера" : formatDate(dayStr, c.tz, c.now),
      reminders: rems.map((r) => ({ id: r.id, text: r.text, time: nowIn(c.tz, r.at_utc).toFormat("HH:mm"), repeat: describeRepeat(r.repeat) })),
      due: due.map((t) => ({ id: t.id, title: t.title, due: t.due, dueHuman: formatDate(t.due!, c.tz, c.now) })),
      overdue: offset === 0 ? overdue.map((t) => ({ id: t.id, title: t.title, due: t.due, dueHuman: formatDate(t.due!, c.tz, c.now) })) : [],
    };
  });

  // ── заметки ──
  const noteOut = (c: Ctx) => (x: ReturnType<typeof listNotes>[number]) => ({ id: x.id, text: x.text, tags: x.tags ? x.tags.split(",") : [], hasPhoto: Boolean(x.photo_file_id), created: formatDateTime(x.created_at, c.tz, c.now), createdAt: x.created_at });
  add("GET", "/api/notes", (c) => {
    const notes = listNotes(c.chatId, { query: c.query.get("q") || undefined, tag: c.query.get("tag") || undefined, limit: n(c.query.get("limit")) ?? 30, offset: n(c.query.get("offset")) ?? 0 });
    return { notes: notes.map(noteOut(c)), total: countNotes(c.chatId) };
  });
  add("POST", "/api/notes", (c) => {
    const text = s(c.body.text);
    if (!text) throw new HttpError(400, "text пустой");
    return noteOut(c)(addNote(c.chatId, text, list(c.body.tags)));
  });
  add("PATCH", "/api/notes/:id", (c) => {
    const note = updateNote(c.chatId, Number(c.params[0]), { text: s(c.body.text) || undefined, tags: c.body.tags !== undefined ? list(c.body.tags) : undefined });
    if (!note) throw new HttpError(404, "заметка не найдена");
    return noteOut(c)(note);
  });
  add("DELETE", "/api/notes/:id", (c) => {
    if (!deleteNote(c.chatId, Number(c.params[0]))) throw new HttpError(404, "заметка не найдена");
    return { ok: true };
  });

  // ── задачи ──
  const taskOut = (c: Ctx) => (t: ReturnType<typeof listTasks>[number]) => {
    const cc = childCounts(c.chatId, t.id);
    return { id: t.id, title: t.title, done: Boolean(t.done), due: t.due, dueHuman: t.due ? formatDate(t.due, c.tz, c.now) : null, overdue: Boolean(t.due && !t.done && t.due.slice(0, 10) < localDateStr(c.now, c.tz)), parentId: t.parent_id, notes: t.notes, children: cc.total, childrenDone: cc.done };
  };
  add("GET", "/api/tasks", (c) => ({ tasks: listTasks(c.chatId, { all: true, includeDone: c.query.get("done") === "1" }).map(taskOut(c)) }));
  add("POST", "/api/tasks", (c) => {
    const title = s(c.body.title);
    if (!title) throw new HttpError(400, "title пустой");
    const due = s(c.body.due) || null;
    const parent = addTask(c.chatId, title, { parentId: n(c.body.parentId) ?? null, due, notes: s(c.body.notes) || null });
    const subs = list(c.body.subtasks).map((x) => addTask(c.chatId, x, { parentId: parent.id }));
    return { task: taskOut(c)(parent), subtasks: subs.map(taskOut(c)) };
  });
  add("PATCH", "/api/tasks/:id", (c) => {
    const id = Number(c.params[0]);
    if (c.body.done !== undefined) setTaskDone(c.chatId, id, Boolean(c.body.done));
    const patch: Parameters<typeof updateTask>[2] = {};
    if (c.body.title !== undefined) patch.title = s(c.body.title) || undefined;
    if (c.body.due !== undefined) patch.due = s(c.body.due) || null;
    if (c.body.parentId !== undefined) patch.parentId = n(c.body.parentId) ?? null;
    if (c.body.notes !== undefined) patch.notes = s(c.body.notes) || null;
    const t = Object.keys(patch).length ? updateTask(c.chatId, id, patch) : getTask(c.chatId, id);
    if (!t) throw new HttpError(404, "задача не найдена");
    return taskOut(c)(t);
  });
  add("DELETE", "/api/tasks/:id", (c) => {
    if (!deleteTask(c.chatId, Number(c.params[0]))) throw new HttpError(404, "задача не найдена");
    return { ok: true };
  });

  // ── напоминания ──
  const remOut = (c: Ctx) => (r: ReturnType<typeof listReminders>[number]) => ({ id: r.id, text: r.text, when: formatDateTime(r.at_utc, c.tz, c.now), atLocal: nowIn(c.tz, r.at_utc).toFormat("yyyy-MM-dd'T'HH:mm"), repeat: r.repeat ?? "", repeatHuman: describeRepeat(r.repeat), active: Boolean(r.active) });
  add("GET", "/api/reminders", (c) => ({ reminders: listReminders(c.chatId, { limit: 100 }).map(remOut(c)) }));
  add("POST", "/api/reminders", (c) => {
    const text = s(c.body.text);
    if (!text) throw new HttpError(400, "text пустой");
    let at = parseLocal(s(c.body.at), c.tz, c.now);
    if (at === null) throw new HttpError(400, "время не разобрано");
    const repeat = normalizeRepeat(s(c.body.repeat));
    if (at <= c.now && repeat) at = nextOccurrence(at, repeat, c.tz, c.now) ?? at;
    if (at <= c.now - 60_000) throw new HttpError(400, "время уже прошло");
    return remOut(c)(addReminder(c.chatId, text, at, repeat));
  });
  add("PATCH", "/api/reminders/:id", (c) => {
    const id = Number(c.params[0]);
    const snooze = n(c.body.snoozeMinutes);
    if (snooze) {
      rescheduleReminder(id, c.now + snooze * 60_000);
    } else if (c.body.tomorrow) {
      const cur = listReminders(c.chatId, { includeInactive: true, limit: 500 }).find((r) => r.id === id);
      if (!cur) throw new HttpError(404, "напоминание не найдено");
      const base = nowIn(c.tz, cur.at_utc);
      rescheduleReminder(id, nowIn(c.tz, c.now).plus({ days: 1 }).set({ hour: base.hour, minute: base.minute, second: 0, millisecond: 0 }).toMillis());
    } else {
      const atRaw = s(c.body.at);
      const r = updateReminder(c.chatId, id, { text: s(c.body.text) || undefined, atUtc: atRaw ? (parseLocal(atRaw, c.tz, c.now) ?? undefined) : undefined, repeat: c.body.repeat === undefined ? undefined : normalizeRepeat(s(c.body.repeat)) });
      if (!r) throw new HttpError(404, "напоминание не найдено");
    }
    const r = listReminders(c.chatId, { includeInactive: true, limit: 500 }).find((x) => x.id === id);
    if (!r) throw new HttpError(404, "напоминание не найдено");
    return remOut(c)(r);
  });
  add("DELETE", "/api/reminders/:id", (c) => {
    if (!deleteReminder(c.chatId, Number(c.params[0]))) throw new HttpError(404, "напоминание не найдено");
    return { ok: true };
  });

  // ── обучение ──
  add("GET", "/api/learn", (c) => {
    const p = getLearnProgress(c.chatId);
    const cs = cardStats(c.chatId);
    const settings = getLearnSettings(c.chatId);
    return {
      settings,
      levels: LEVELS,
      focusAll: ALL_FOCUS,
      topics: TOPICS,
      progress: { streak: p.streak, lessonsTotal: p.lessonsTotal, lastLessonDate: p.lastLessonDate, topicCounts: p.topicCounts, history: p.history.slice(-10).reverse() },
      cards: { ...cs, due: cs.due, dueList: dueCards(c.chatId, c.now, 30).map((x) => ({ id: x.id, front: x.front, back: x.back, box: x.box })) },
      session: getLearnSession(c.chatId)?.kind ?? null,
    };
  });
  add("GET", "/api/learn/cards", (c) => ({ cards: listCards(c.chatId, 300).map((x) => ({ id: x.id, front: x.front, back: x.back, box: x.box, due: formatDateTime(x.due_at, c.tz, c.now), dueAt: x.due_at })) }));
  add("POST", "/api/learn/cards", (c) => {
    const r = addCard(c.chatId, s(c.body.front), s(c.body.back), "app");
    return { id: r.card.id, created: r.created, total: cardStats(c.chatId).total };
  });
  add("DELETE", "/api/learn/cards/:id", (c) => {
    if (!deleteCard(c.chatId, Number(c.params[0]))) throw new HttpError(404, "карточка не найдена");
    return { ok: true };
  });
  add("POST", "/api/learn/review", (c) => {
    const results = Array.isArray(c.body.results) ? (c.body.results as Array<{ id?: unknown; ok?: unknown }>) : [];
    let known = 0;
    let unknown = 0;
    for (const r of results) {
      const id = n(r.id);
      if (!id || !reviewCard(c.chatId, id, r.ok === true, c.now)) continue;
      if (r.ok === true) known += 1;
      else unknown += 1;
    }
    return { known, unknown, ...cardStats(c.chatId, c.now) };
  });
  add("POST", "/api/learn/generate", async (c) => {
    const topic = s(c.body.topic);
    if (!topic) throw new HttpError(400, "topic пустой");
    const r = await generateCards(deps.model, c.chatId, getLearnSettings(c.chatId), topic, n(c.body.count) ?? 15);
    return { ...r, stats: cardStats(c.chatId, c.now) };
  });
  add("POST", "/api/learn/settings", (c) => {
    const patch: Partial<ReturnType<typeof getLearnSettings>> = {};
    const level = s(c.body.level).toUpperCase();
    if ((LEVELS as string[]).includes(level)) patch.level = level as Level;
    if (Array.isArray(c.body.focus)) patch.focus = (c.body.focus as unknown[]).map(String).filter((f): f is Focus => (ALL_FOCUS as string[]).includes(f));
    const lang = s(c.body.lang).toLowerCase();
    const langName = s(c.body.langName).toLowerCase();
    if (lang && langName) {
      patch.lang = lang;
      patch.langName = langName;
    }
    return setLearnSettings(c.chatId, patch);
  });
  add("POST", "/api/learn/lesson", (c) => {
    const session = getLearnSession(c.chatId);
    if (session?.kind === "lesson") return { started: false, reason: "урок уже идёт в чате" };
    if (session) clearLearnSession(c.chatId);
    const topic = s(c.body.topic) || undefined;
    inChat(c.chatId, () => startLesson(learnCtx(c), { topic }));
    return { started: true };
  });
  add("POST", "/api/learn/talk", (c) => {
    const session = getLearnSession(c.chatId);
    if (session?.kind === "lesson") return { started: false, reason: "сначала закончи урок" };
    if (session) clearLearnSession(c.chatId);
    const topic = s(c.body.topic) || "свободный разговор";
    const review = c.body.review === true ? dueCards(c.chatId, c.now, 6).map((x) => ({ id: x.id, front: x.front, back: x.back })) : undefined;
    inChat(c.chatId, () => startTalk(learnCtx(c), topic, { reviewCards: review }));
    return { started: true };
  });
  add("POST", "/api/learn/stop", (c) => {
    const session = getLearnSession(c.chatId);
    if (session?.kind === "talk") inChat(c.chatId, () => endTalk(learnCtx(c), session));
    else if (session?.kind === "lesson") inChat(c.chatId, () => quitLesson(learnCtx(c), session));
    else clearLearnSession(c.chatId);
    return { stopped: session?.kind ?? null };
  });

  return http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url ?? "/", "http://localhost");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Telegram-Init-Data");
    res.setHeader("Access-Control-Max-Age", "86400");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    if (url.pathname === "/health") return send(200, { ok: true, service: "assistant-bot-api" });
    try {
      const initData = String(req.headers["x-telegram-init-data"] ?? "");
      const valid = validateInitData(initData, deps.botToken ?? config.telegramToken);
      if (!valid) throw new HttpError(401, "нет подписи Telegram или она устарела — открой приложение заново из Telegram");
      const owner = ownerId();
      if (!owner || String(valid.user.id) !== owner) throw new HttpError(403, "это личный бот");
      const route = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
      if (!route) throw new HttpError(404, "нет такого метода");
      let body: Record<string, unknown> = {};
      if (req.method === "POST" || req.method === "PATCH") {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const ch of req) {
          size += (ch as Buffer).length;
          if (size > 1_000_000) throw new HttpError(413, "слишком большое тело");
          chunks.push(ch as Buffer);
        }
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        if (raw) {
          try {
            body = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            throw new HttpError(400, "тело не JSON");
          }
        }
      }
      const chatId = owner;
      const ctx: Ctx = { chatId, tz: chatTz(chatId), now: Date.now(), query: url.searchParams, body, params: (url.pathname.match(route.re) ?? []).slice(1).map(decodeURIComponent) };
      const out = await route.h(ctx);
      send(200, out ?? { ok: true });
      log.info("api", `${req.method} ${url.pathname} 200 ${Date.now() - started}мс`);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status >= 500) log.error("api", `${req.method} ${url.pathname}: ${errMsg(e)}`);
      else if (status !== 401) log.warn("api", `${req.method} ${url.pathname} ${status}: ${errMsg(e)}`);
      send(status, { error: errMsg(e) });
    }
  });
}
