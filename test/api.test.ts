/** API для Mini App: подпись initData, доступ только владельцу, CRUD без сети. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { signInitData, validateInitData } from "../src/api/initData.ts";
import { createApiServer } from "../src/api/server.ts";
import { useMemoryDb } from "../src/db/index.ts";
import { __resetLearnSchema } from "../src/learn/store.ts";
import type { Sender } from "../src/telegram/sender.ts";

const TOKEN = "123456:TEST";
const OWNER = "825581486";

const nullSender: Sender = {
  sendText: async () => ({ messageId: 1 }),
  sendPhoto: async () => ({ messageId: 1 }),
  sendDocument: async () => ({ messageId: 1 }),
  sendVoice: async () => ({ messageId: 1 }),
  typing: async () => {},
  editText: async () => {},
  editButtons: async () => {},
};
const offlineModel = { generate: async () => ({ text: '{"cards":[{"front":"el pan","back":"хлеб"}]}' }) };

function initDataFor(userId: string, ageSec = 10): string {
  return signInitData({ user: JSON.stringify({ id: Number(userId), first_name: "Дима" }), auth_date: String(Math.floor(Date.now() / 1000) - ageSec), query_id: "q" }, TOKEN);
}

describe("initData", () => {
  it("валидная подпись проходит, подделка и просрочка — нет", () => {
    const good = initDataFor(OWNER);
    expect(validateInitData(good, TOKEN)?.user.id).toBe(Number(OWNER));
    expect(validateInitData(good.replace(/hash=\w/, "hash=0"), TOKEN)).toBeNull();
    expect(validateInitData(good, "other:token")).toBeNull();
    expect(validateInitData(initDataFor(OWNER, 90_000), TOKEN)).toBeNull();
  });
});

describe("api", () => {
  let base = "";
  let server: ReturnType<typeof createApiServer>;
  beforeAll(async () => {
    useMemoryDb();
    __resetLearnSchema();
    server = createApiServer({ sender: nullSender, model: offlineModel, botToken: TOKEN, ownerId: () => OWNER });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());
  beforeEach(() => {
    useMemoryDb();
    __resetLearnSchema();
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Json = Record<string, any>;
  const call = (method: string, path: string, body?: unknown, user = OWNER) =>
    fetch(base + path, { method, headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": initDataFor(user) }, body: body ? JSON.stringify(body) : undefined }) as Promise<
      Omit<Response, "json"> & { json(): Promise<Json> }
    >;

  it("без подписи 401, чужой 403, health открыт", async () => {
    expect((await fetch(base + "/health")).status).toBe(200);
    expect((await fetch(base + "/api/me")).status).toBe(401);
    expect((await call("GET", "/api/me", undefined, "999")).status).toBe(403);
    expect((await call("GET", "/api/me")).status).toBe(200);
  });

  it("заметки и задачи: создать, прочитать, изменить, удалить", async () => {
    const n1 = await (await call("POST", "/api/notes", { text: "Купить молоко", tags: ["дом"] })).json();
    expect(n1.id).toBeGreaterThan(0);
    const list = await (await call("GET", "/api/notes?q=молоко")).json();
    expect(list.notes).toHaveLength(1);
    expect((await (await call("PATCH", `/api/notes/${n1.id}`, { text: "Купить молоко и хлеб" })).json()).text).toMatch(/хлеб/);
    expect((await call("DELETE", `/api/notes/${n1.id}`)).status).toBe(200);
    expect((await call("DELETE", `/api/notes/${n1.id}`)).status).toBe(404);

    const t = await (await call("POST", "/api/tasks", { title: "Переезд", due: "2026-10-20", subtasks: ["Коробки", "Грузчики"] })).json();
    expect(t.subtasks).toHaveLength(2);
    const tasks = await (await call("GET", "/api/tasks")).json();
    expect(tasks.tasks.find((x: { id: number }) => x.id === t.task.id).children).toBe(2);
    const done = await (await call("PATCH", `/api/tasks/${t.subtasks[0].id}`, { done: true })).json();
    expect(done.done).toBe(true);
  });

  it("напоминания: создать, отложить, удалить", async () => {
    const r = await (await call("POST", "/api/reminders", { text: "позвонить", at: "2030-01-01T09:00", repeat: "daily" })).json();
    expect(r.repeatHuman).toBe("каждый день");
    const s = await (await call("PATCH", `/api/reminders/${r.id}`, { snoozeMinutes: 10 })).json();
    expect(s.when).toMatch(/сегодня|завтра/);
    expect((await call("DELETE", `/api/reminders/${r.id}`)).status).toBe(200);
  });

  it("обучение: карточки, оценки, генерация, запуск урока", async () => {
    const c = await (await call("POST", "/api/learn/cards", { front: "la mesa", back: "стол" })).json();
    expect(c.created).toBe(true);
    const learn = await (await call("GET", "/api/learn")).json();
    expect(learn.cards.due).toBe(1);
    const rev = await (await call("POST", "/api/learn/review", { results: [{ id: c.id, ok: true }] })).json();
    expect(rev.known).toBe(1);
    expect(rev.due).toBe(0);
    const gen = await (await call("POST", "/api/learn/generate", { topic: "еда", count: 5 })).json();
    expect(gen.added).toBe(1);
    const lesson = await (await call("POST", "/api/learn/lesson", {})).json();
    expect(lesson.started).toBe(true);
    const st = await (await call("POST", "/api/learn/settings", { level: "A2", focus: ["grammar"] })).json();
    expect(st.level).toBe("A2");
    expect(st.focus).toEqual(["grammar"]);
  });
});
