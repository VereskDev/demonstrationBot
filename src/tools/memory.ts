import { addFact, deleteFact, listFacts, setChatTz } from "../db/index.ts";
import { isValidZone } from "../time.ts";
import { argNum, argStr, type ToolDefinition } from "./types.ts";

export function buildMemoryTools(): ToolDefinition[] {
  return [
    {
      decl: {
        name: "remember_fact",
        description:
          "Запомнить факт о пользователе надолго (имя, как обращаться, города, близкие, привычки, предпочтения по стилю ответов). Факты попадают в контекст каждого разговора. Не дублируй уже известное.",
        parameters: { type: "object", properties: { text: { type: "string", description: "короткий факт: «Зовут Дима», «Любит краткие ответы»" } }, required: ["text"] },
      },
      handler: async (args, ctx) => {
        const text = argStr(args, "text");
        if (!text) throw new Error("text пустой");
        const f = addFact(ctx.chatId, text);
        ctx.changed.add("facts");
        return { id: f.id, text: f.text };
      },
    },
    {
      decl: {
        name: "forget_fact",
        description: "Удалить факт о пользователе по id (список фактов — в системном промпте).",
        parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
      },
      handler: async (args, ctx) => {
        const id = argNum(args, "id");
        if (!id || !deleteFact(ctx.chatId, id)) throw new Error(`факт ${id} не найден`);
        ctx.changed.add("facts");
        return { deleted: id, remaining: listFacts(ctx.chatId).length };
      },
    },
    {
      decl: {
        name: "set_timezone",
        description: "Сменить часовой пояс пользователя (IANA: Asia/Almaty, Europe/Moscow, Europe/Berlin…). Вызывай, когда пользователь говорит, где он или что время сбито.",
        parameters: { type: "object", properties: { tz: { type: "string" } }, required: ["tz"] },
      },
      handler: async (args, ctx) => {
        const tz = argStr(args, "tz");
        if (!isValidZone(tz)) throw new Error(`неизвестная зона «${tz}»`);
        setChatTz(ctx.chatId, tz);
        ctx.tz = tz;
        ctx.changed.add("settings");
        return { tz };
      },
    },
  ];
}
