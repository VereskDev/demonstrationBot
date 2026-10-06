import { addTask, childCounts, deleteTask, getTask, listTasks, setTaskDone, tasksDueBetween, updateTask, type TaskRow } from "../db/index.ts";
import { formatDate, localDateStr, nowIn } from "../time.ts";
import { argBool, argList, argNum, argStr, type ToolContext, type ToolDefinition } from "./types.ts";

function taskOut(t: TaskRow, ctx: ToolContext) {
  const c = childCounts(ctx.chatId, t.id);
  return {
    id: t.id,
    title: t.title,
    done: Boolean(t.done),
    due: t.due,
    dueHuman: t.due ? formatDate(t.due, ctx.tz, ctx.now) : undefined,
    parentId: t.parent_id,
    notes: t.notes ?? undefined,
    subtasks: c.total ? `${c.done}/${c.total}` : undefined,
  };
}

/** Срок из строки модели: YYYY-MM-DD или YYYY-MM-DDTHH:mm; пусто/null → без срока. */
function normalizeDue(raw: string): string | null {
  const s = raw.trim();
  if (!s || /^(none|null|нет)$/i.test(s)) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
  if (!m) throw new Error(`срок «${s}» не в формате YYYY-MM-DD или YYYY-MM-DDTHH:mm`);
  return m[2] ? `${m[1]}T${m[2]}` : m[1];
}

export function buildTaskTools(): ToolDefinition[] {
  return [
    {
      decl: {
        name: "add_task",
        description:
          "Создать задачу. Можно сразу с подзадачами (тогда задача становится проектом) и сроком. Для «разбей X на этапы» — придумай 3–7 конкретных подзадач сам. parent_id — чтобы добавить подзадачу в существующий проект.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "короткое название в инфинитиве: «Купить билеты»" },
            subtasks: { type: "array", items: { type: "string" }, description: "подзадачи по порядку" },
            due: { type: "string", description: "срок YYYY-MM-DD или YYYY-MM-DDTHH:mm (локальное время)" },
            parent_id: { type: "integer", description: "id родительской задачи" },
            notes: { type: "string", description: "детали/контекст" },
          },
          required: ["title"],
        },
      },
      handler: async (args, ctx) => {
        const title = argStr(args, "title");
        if (!title) throw new Error("title пустой");
        const parent = addTask(ctx.chatId, title, { parentId: argNum(args, "parent_id") ?? null, due: normalizeDue(argStr(args, "due")), notes: argStr(args, "notes") || null });
        const subs = argList(args, "subtasks").map((s) => addTask(ctx.chatId, s, { parentId: parent.id }));
        ctx.changed.add("tasks");
        return { task: taskOut(parent, ctx), subtasks: subs.map((s) => ({ id: s.id, title: s.title })) };
      },
    },
    {
      decl: {
        name: "list_tasks",
        description:
          "Список задач. Без параметров — открытые задачи верхнего уровня с прогрессом по подзадачам. parent_id — подзадачи проекта. query — поиск по названию среди всех. include_done — показать и выполненные.",
        parameters: {
          type: "object",
          properties: {
            parent_id: { type: "integer" },
            query: { type: "string" },
            include_done: { type: "boolean" },
          },
        },
      },
      handler: async (args, ctx) => {
        const query = argStr(args, "query") || undefined;
        const parentId = argNum(args, "parent_id");
        const tasks = listTasks(ctx.chatId, { parentId: parentId ?? null, includeDone: argBool(args, "include_done"), query, all: Boolean(query) });
        return { count: tasks.length, tasks: tasks.map((t) => taskOut(t, ctx)) };
      },
    },
    {
      decl: {
        name: "complete_task",
        description: "Отметить задачу выполненной (или снова открытой при done=false). Если пользователь называет задачу словами — сначала найди id через list_tasks.",
        parameters: { type: "object", properties: { id: { type: "integer" }, done: { type: "boolean", description: "по умолчанию true" } }, required: ["id"] },
      },
      handler: async (args, ctx) => {
        const id = argNum(args, "id");
        if (!id) throw new Error("id обязателен");
        const t = setTaskDone(ctx.chatId, id, argBool(args, "done", true));
        if (!t) throw new Error(`задача ${id} не найдена`);
        ctx.changed.add("tasks");
        // Все подзадачи закрыты — подскажем модели, что проект можно закрыть.
        const parent = t.parent_id ? getTask(ctx.chatId, t.parent_id) : null;
        const pc = parent ? childCounts(ctx.chatId, parent.id) : null;
        return { task: taskOut(t, ctx), parentAllDone: pc ? pc.total > 0 && pc.done === pc.total && !parent!.done : undefined, parentId: parent?.id };
      },
    },
    {
      decl: {
        name: "update_task",
        description: "Переименовать, поменять срок (due; пустая строка — убрать срок), перенести в другой проект (parent_id; 0 — наверх) или дописать детали.",
        parameters: {
          type: "object",
          properties: { id: { type: "integer" }, title: { type: "string" }, due: { type: "string" }, parent_id: { type: "integer" }, notes: { type: "string" } },
          required: ["id"],
        },
      },
      handler: async (args, ctx) => {
        const id = argNum(args, "id");
        if (!id) throw new Error("id обязателен");
        const parentRaw = argNum(args, "parent_id");
        const t = updateTask(ctx.chatId, id, {
          title: argStr(args, "title") || undefined,
          due: args.due === undefined ? undefined : normalizeDue(argStr(args, "due")),
          parentId: parentRaw === undefined ? undefined : parentRaw === 0 ? null : parentRaw,
          notes: args.notes === undefined ? undefined : argStr(args, "notes") || null,
        });
        if (!t) throw new Error(`задача ${id} не найдена`);
        ctx.changed.add("tasks");
        return taskOut(t, ctx);
      },
    },
    {
      decl: {
        name: "delete_task",
        description: "Удалить задачу вместе с подзадачами. Только по явной просьбе.",
        parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
      },
      handler: async (args, ctx) => {
        const id = argNum(args, "id");
        if (!id || !deleteTask(ctx.chatId, id)) throw new Error(`задача ${id} не найдена`);
        ctx.changed.add("tasks");
        return { deleted: id };
      },
    },
    {
      decl: {
        name: "get_agenda",
        description: "План на день: задачи со сроком и просроченные на дату (по умолчанию сегодня). Напоминания на день — через list_reminders.",
        parameters: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD, по умолчанию сегодня" }, days: { type: "integer", description: "сколько дней вперёд захватить, по умолчанию 1" } } },
      },
      handler: async (args, ctx) => {
        const from = argStr(args, "date") || localDateStr(ctx.now, ctx.tz);
        const days = Math.max(1, Math.min(31, argNum(args, "days") ?? 1));
        const to = nowIn(ctx.tz, ctx.now).set({ year: Number(from.slice(0, 4)), month: Number(from.slice(5, 7)), day: Number(from.slice(8, 10)) }).plus({ days: days - 1 }).toFormat("yyyy-MM-dd");
        const { due, overdue } = tasksDueBetween(ctx.chatId, from, to);
        return { from, to, due: due.map((t) => taskOut(t, ctx)), overdue: overdue.map((t) => taskOut(t, ctx)) };
      },
    },
  ];
}
