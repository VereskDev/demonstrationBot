import { beforeEach, describe, expect, it } from "vitest";
import { addNote, addReminder, addTask, childCounts, dueReminders, listNotes, listTasks, setTaskDone, tasksDueBetween, useMemoryDb } from "../src/db/index.ts";
import { toTelegramHtml, splitForChannel } from "../src/telegram/format.ts";
import { wrapText } from "../src/images/card.ts";
import { withDefaults } from "../src/diagrams/graphviz.ts";
import { parseRepoUrl } from "../src/diagrams/gitdiagram.ts";

const chat = "c1";

describe("db", () => {
  beforeEach(() => {
    useMemoryDb();
  });
  it("заметки ищутся по кириллице без учёта регистра и ё", () => {
    addNote(chat, "Купить Молоко и хлеб", ["покупки"]);
    addNote(chat, "Идея: подарок маме — ёлка");
    expect(listNotes(chat, { query: "молоко" })).toHaveLength(1);
    expect(listNotes(chat, { query: "елка" })).toHaveLength(1);
    expect(listNotes(chat, { tag: "покупки" })).toHaveLength(1);
    expect(listNotes("other")).toHaveLength(0);
  });
  it("задачи: дерево, прогресс, закрытие родителя закрывает детей", () => {
    const p = addTask(chat, "Переезд", { due: "2026-10-20" });
    const a = addTask(chat, "Коробки", { parentId: p.id });
    addTask(chat, "Грузчики", { parentId: p.id });
    expect(listTasks(chat)).toHaveLength(1);
    expect(listTasks(chat, { parentId: p.id })).toHaveLength(2);
    setTaskDone(chat, a.id, true);
    expect(childCounts(chat, p.id)).toEqual({ total: 2, done: 1 });
    setTaskDone(chat, p.id, true);
    expect(childCounts(chat, p.id)).toEqual({ total: 2, done: 2 });
    expect(listTasks(chat)).toHaveLength(0);
  });
  it("сроки: просроченные и на день", () => {
    addTask(chat, "Старое", { due: "2026-10-01" });
    addTask(chat, "Сегодня", { due: "2026-10-06T15:00" });
    addTask(chat, "Потом", { due: "2026-10-09" });
    const r = tasksDueBetween(chat, "2026-10-06", "2026-10-06");
    expect(r.overdue.map((t) => t.title)).toEqual(["Старое"]);
    expect(r.due.map((t) => t.title)).toEqual(["Сегодня"]);
  });
  it("напоминания: созревшие", () => {
    addReminder(chat, "a", 1000, null);
    addReminder(chat, "b", 999_999_999_999, null);
    expect(dueReminders(2000).map((r) => r.text)).toEqual(["a"]);
  });
});

describe("format", () => {
  it("markdown-лайт → HTML", () => {
    expect(toTelegramHtml("**Жирно** и `код` <b>\n- пункт\n* ещё")).toBe("<b>Жирно</b> и <code>код</code> &lt;b&gt;\n• пункт\n• ещё");
  });
  it("разбивка длинного текста", () => {
    const parts = splitForChannel("a".repeat(5000) + "\n\n" + "b".repeat(100), 4096);
    expect(parts.length).toBe(3);
  });
  it("перенос строк открытки", () => {
    expect(wrapText("С днём рождения, мама!", 12)).toEqual(["С днём", "рождения,", "мама!"]);
  });
  it("DOT получает шрифт", () => {
    expect(withDefaults('digraph { a -> b }')).toMatch(/fontname/);
    expect(withDefaults('digraph { node [fontname="X"]; a -> b }')).not.toMatch(/Arial/);
  });
  it("ссылки на репозиторий", () => {
    expect(parseRepoUrl("https://github.com/fastify/fastify/tree/main/lib")?.slug).toBe("fastify/fastify");
    expect(parseRepoUrl("fastify/fastify")?.diagramUrl).toBe("https://gitdiagram.com/fastify/fastify");
    expect(parseRepoUrl("https://example.com")).toBeNull();
  });
});
