import { addReminder, deleteReminder, getReminder, listReminders, updateReminder, type ReminderRow } from "../db/index.ts";
import { describeRepeat, formatDateTime, nextOccurrence, normalizeRepeat, parseLocal } from "../time.ts";
import { argNum, argStr, type ToolContext, type ToolDefinition } from "./types.ts";

function remOut(r: ReminderRow, ctx: ToolContext) {
  return { id: r.id, text: r.text, when: formatDateTime(r.at_utc, ctx.tz, ctx.now), repeat: r.repeat ?? "none", repeatHuman: describeRepeat(r.repeat), active: Boolean(r.active) };
}

function resolveAt(raw: string, ctx: ToolContext): number {
  const at = parseLocal(raw, ctx.tz, ctx.now);
  if (at === null) throw new Error(`время «${raw}» не разобрано: нужен формат YYYY-MM-DDTHH:mm`);
  return at;
}

export function buildReminderTools(): ToolDefinition[] {
  return [
    {
      decl: {
        name: "create_reminder",
        description:
          "Поставить напоминание — бот сам напишет в чат в указанное время. at — локальное время пользователя в формате YYYY-MM-DDTHH:mm (считай от «сейчас» из системного промпта; «через 20 минут» = сейчас + 20 минут). Если момент уже прошёл сегодня, а пользователь не назвал дату — бери завтра. repeat: none | daily | weekdays | weekends | weekly:MO,WE | monthly:15 | yearly:03-08 | every:2h.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "о чём напомнить, коротко, без «напомни»" },
            at: { type: "string", description: "YYYY-MM-DDTHH:mm локальное" },
            repeat: { type: "string", description: "правило повтора или none" },
          },
          required: ["text", "at"],
        },
      },
      handler: async (args, ctx) => {
        const text = argStr(args, "text");
        if (!text) throw new Error("text пустой");
        let at = resolveAt(argStr(args, "at"), ctx);
        const repeat = normalizeRepeat(argStr(args, "repeat"));
        // Повтор с датой в прошлом — сдвигаем на ближайшее будущее срабатывание.
        if (at <= ctx.now && repeat) at = nextOccurrence(at, repeat, ctx.tz, ctx.now) ?? at;
        if (at <= ctx.now - 60_000) throw new Error(`время ${formatDateTime(at, ctx.tz, ctx.now)} уже прошло — уточни у пользователя дату`);
        const r = addReminder(ctx.chatId, text, at, repeat);
        ctx.changed.add("reminders");
        return remOut(r, ctx);
      },
    },
    {
      decl: {
        name: "list_reminders",
        description: "Активные напоминания с временем и правилом повтора.",
        parameters: { type: "object", properties: { include_inactive: { type: "boolean" } } },
      },
      handler: async (args, ctx) => {
        const list = listReminders(ctx.chatId, { includeInactive: Boolean(args.include_inactive), limit: 50 });
        return { count: list.length, reminders: list.map((r) => remOut(r, ctx)) };
      },
    },
    {
      decl: {
        name: "update_reminder",
        description: "Перенести напоминание (at), переименовать (text) или сменить повтор (repeat; none — сделать разовым).",
        parameters: {
          type: "object",
          properties: { id: { type: "integer" }, at: { type: "string" }, text: { type: "string" }, repeat: { type: "string" } },
          required: ["id"],
        },
      },
      handler: async (args, ctx) => {
        const id = argNum(args, "id");
        if (!id) throw new Error("id обязателен");
        const atRaw = argStr(args, "at");
        const r = updateReminder(ctx.chatId, id, {
          text: argStr(args, "text") || undefined,
          atUtc: atRaw ? resolveAt(atRaw, ctx) : undefined,
          repeat: args.repeat === undefined ? undefined : normalizeRepeat(argStr(args, "repeat")),
        });
        if (!r) throw new Error(`напоминание ${id} не найдено`);
        ctx.changed.add("reminders");
        return remOut(r, ctx);
      },
    },
    {
      decl: {
        name: "cancel_reminder",
        description: "Отменить (удалить) напоминание по id.",
        parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
      },
      handler: async (args, ctx) => {
        const id = argNum(args, "id");
        const r = id ? getReminder(ctx.chatId, id) : null;
        if (!r || !deleteReminder(ctx.chatId, r.id)) throw new Error(`напоминание ${id} не найдено`);
        ctx.changed.add("reminders");
        return { cancelled: id, text: r.text };
      },
    },
  ];
}
