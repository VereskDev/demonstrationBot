/**
 * Кнопки, команды, доступ и планировщик — без Telegram и без модели: фейковый TelegramApi
 * собирает исходящие, модель-заглушка падает, если её вдруг позвали.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { addReminder, addTask, getReminder, getTask, listNotes, useMemoryDb } from "../src/db/index.ts";
import { handleUpdate } from "../src/telegram/handlers.ts";
import { BTN } from "../src/telegram/keyboards.ts";
import type { TelegramApi } from "../src/telegram/api.ts";
import type { InlineButton, SendOptions } from "../src/telegram/sender.ts";
import { buildToolset } from "../src/tools/registry.ts";
import { startReminderScheduler } from "../src/scheduler/reminders.ts";

class FakeTg {
  sent: Array<{ kind: string; chatId: string; text: string; inline?: InlineButton[][]; keyboard?: string[][] }> = [];
  edits: Array<{ messageId: number; text: string; inline?: InlineButton[][] }> = [];
  answers: string[] = [];
  commandsSet = 0;
  async sendText(chatId: string, text: string, opts: SendOptions = {}) {
    this.sent.push({ kind: "text", chatId, text, inline: opts.inline, keyboard: opts.keyboard });
    return { messageId: this.sent.length };
  }
  async sendPhoto(chatId: string, _p: unknown, caption = "") {
    this.sent.push({ kind: "photo", chatId, text: caption });
    return { messageId: this.sent.length };
  }
  async sendDocument(chatId: string, _d: unknown, _n: string, caption = "") {
    this.sent.push({ kind: "doc", chatId, text: caption });
    return { messageId: this.sent.length };
  }
  async typing() {}
  async editText(_c: string, messageId: number, text: string, opts: SendOptions = {}) {
    this.edits.push({ messageId, text, inline: opts.inline });
  }
  async editButtons() {}
  async answerCallback(_id: string, text?: string) {
    this.answers.push(text ?? "");
  }
  async setCommands() {
    this.commandsSet += 1;
  }
  async downloadFile() {
    return null;
  }
}

const neverModel = {
  generate: async () => {
    throw new Error("модель не должна вызываться для кнопок");
  },
};

function msg(text: string, userId = "100", chatId = userId) {
  return { update_id: 1, message: { message_id: 5, date: 1_700_000_000, chat: { id: Number(chatId), type: "private" }, from: { id: Number(userId), first_name: "Дима" }, text } };
}
function cb(data: string, userId = "100") {
  return { update_id: 2, callback_query: { id: "cbq", data, from: { id: Number(userId), first_name: "Дима" }, message: { message_id: 7, chat: { id: Number(userId), type: "private" } } } };
}

describe("handlers", () => {
  let tg: FakeTg;
  let deps: Parameters<typeof handleUpdate>[0];
  beforeEach(() => {
    useMemoryDb();
    tg = new FakeTg();
    deps = { tg: tg as unknown as TelegramApi, sender: tg as unknown as TelegramApi, model: neverModel, tools: buildToolset() };
  });

  it("первый написавший становится владельцем, второй получает отказ", async () => {
    await handleUpdate(deps, msg("/start"));
    expect(tg.sent[0].text).toMatch(/Привет, Дима/);
    expect(tg.sent[0].keyboard?.flat()).toContain(BTN.notes);
    expect(tg.commandsSet).toBe(1);
    await handleUpdate(deps, msg("привет", "200"));
    expect(tg.sent.at(-1)?.text).toMatch(/личный бот/);
    expect(tg.sent.at(-1)?.chatId).toBe("200");
  });

  it("кнопка «Задачи» показывает дерево и переключает галочки", async () => {
    await handleUpdate(deps, msg("/start"));
    const p = addTask("100", "Переезд");
    const a = addTask("100", "Коробки", { parentId: p.id });
    await handleUpdate(deps, msg(BTN.tasks));
    const view = tg.sent.at(-1)!;
    expect(view.text).toMatch(/Переезд \(0\/1\)/);
    expect(view.inline?.flat().some((b) => b.callback_data === `task:list:${p.id}`)).toBe(true);
    await handleUpdate(deps, cb(`task:list:${p.id}`));
    expect(tg.edits.at(-1)?.text).toMatch(/Коробки/);
    await handleUpdate(deps, cb(`task:toggle:${a.id}:${p.id}`));
    expect(getTask("100", a.id)?.done).toBe(1);
    expect(tg.answers.at(-1)).toMatch(/Выполнено/);
    expect(tg.edits.at(-1)?.text).toMatch(/☑️ Коробки/);
  });

  it("пустые разделы объясняют, что делать", async () => {
    await handleUpdate(deps, msg("/start"));
    await handleUpdate(deps, msg(BTN.notes));
    expect(tg.sent.at(-1)?.text).toMatch(/Заметок пока нет/);
    await handleUpdate(deps, msg(BTN.reminders));
    expect(tg.sent.at(-1)?.text).toMatch(/напоминаний нет/);
    await handleUpdate(deps, msg(BTN.today));
    expect(tg.sent.at(-1)?.text).toMatch(/Сегодня/);
    expect(listNotes("100")).toHaveLength(0);
  });

  it("напоминание: планировщик шлёт с кнопками, +10 мин переносит, Готово гасит", async () => {
    await handleUpdate(deps, msg("/start"));
    const r = addReminder("100", "позвонить маме", Date.now() - 1000, null);
    const sched = startReminderScheduler(tg as unknown as TelegramApi, 60_000);
    const sent = await sched.tick();
    sched.stop();
    expect(sent).toBe(1);
    const fired = tg.sent.at(-1)!;
    expect(fired.text).toMatch(/⏰ позвонить маме/);
    expect(fired.inline?.flat().map((b) => b.text)).toEqual(["✅ Готово", "+10 мин", "+1 час", "📅 Завтра"]);
    expect(getReminder("100", r.id)?.active).toBe(0);
    await handleUpdate(deps, cb(`rem:snooze:${r.id}:10`));
    const again = getReminder("100", r.id)!;
    expect(again.active).toBe(1);
    expect(again.at_utc).toBeGreaterThan(Date.now() + 9 * 60_000);
    await handleUpdate(deps, cb(`rem:done:${r.id}`));
    expect(getReminder("100", r.id)?.active).toBe(0);
    expect(tg.edits.at(-1)?.text).toMatch(/^✅ позвонить маме/);
  });

  it("повторяющееся напоминание перевзводится, а не гаснет", async () => {
    await handleUpdate(deps, msg("/start"));
    const r = addReminder("100", "витамины", Date.now() - 1000, "daily");
    const sched = startReminderScheduler(tg as unknown as TelegramApi, 60_000);
    await sched.tick();
    sched.stop();
    const row = getReminder("100", r.id)!;
    expect(row.active).toBe(1);
    expect(row.at_utc).toBeGreaterThan(Date.now());
    expect(row.fire_count).toBe(1);
    expect(tg.sent.at(-1)?.text).toMatch(/🔁 каждый день/);
  });

  it("/tz меняет зону, /id показывает id", async () => {
    await handleUpdate(deps, msg("/start"));
    await handleUpdate(deps, msg("/tz Europe/Moscow"));
    expect(tg.sent.at(-1)?.text).toMatch(/Europe\/Moscow/);
    await handleUpdate(deps, msg("/tz Nowhere/City"));
    expect(tg.sent.at(-1)?.text).toMatch(/Не знаю зону/);
    await handleUpdate(deps, msg("/id"));
    expect(tg.sent.at(-1)?.text).toMatch(/100/);
  });
});
