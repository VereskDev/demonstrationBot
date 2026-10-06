/**
 * Инструменты агента для режима обучения: естественные фразы («давай урок испанского»,
 * «добавь карточку hola — привет», «поговорим про еду») запускают те же сценарии, что кнопки.
 * Сценарий сам пишет в чат, поэтому ответ модели после него подавляется (suppressReply).
 */
import { startLesson, startTalk, cardsEntry, learnMenuView, addCardManually, generateCardsFlow } from "../learn/index.ts";
import { cardStats } from "../learn/cards.ts";
import { getLearnProgress, getLearnSettings, setLearnSettings } from "../learn/store.ts";
import { LEVELS, TOPICS, type Level } from "../learn/types.ts";
import { argStr, type ToolContext, type ToolDefinition } from "./types.ts";

function learnCtx(ctx: ToolContext) {
  if (!ctx.model) throw new Error("модель недоступна в контексте инструмента");
  return { chatId: ctx.chatId, sender: ctx.sender, model: ctx.model, tz: ctx.tz };
}

export function buildLearnTools(): ToolDefinition[] {
  return [
    {
      decl: {
        name: "learn_start_lesson",
        description:
          "Запустить урок иностранного языка (режим обучения, по умолчанию испанский). topic — одна из тем: greetings (приветствия), daily (распорядок дня), food (еда и ресторан), family (семья), travel (путешествия), weather (погода и досуг); пусто — та, что проходили реже всего. Урок сам идёт в чате пошагово.",
        parameters: { type: "object", properties: { topic: { type: "string" } } },
      },
      handler: async (args, ctx) => {
        await startLesson(learnCtx(ctx), { topic: argStr(args, "topic") || undefined });
        ctx.suppressReply = true;
        return { started: true };
      },
    },
    {
      decl: {
        name: "learn_start_conversation",
        description: "Начать разговорную практику с «носителем» на заданную тему (режим обучения). Дальнейшие сообщения пользователя идут в этот разговор, пока он не скажет «стоп».",
        parameters: { type: "object", properties: { topic: { type: "string", description: "тема по-русски, коротко" } }, required: ["topic"] },
      },
      handler: async (args, ctx) => {
        const topic = argStr(args, "topic") || "свободный разговор";
        await startTalk(learnCtx(ctx), topic);
        ctx.suppressReply = true;
        return { started: true, topic };
      },
    },
    {
      decl: {
        name: "learn_review_cards",
        description: "Запустить повторение карточек (интервальное повторение слов).",
        parameters: { type: "object", properties: {} },
      },
      handler: async (_args, ctx) => {
        await cardsEntry(learnCtx(ctx));
        ctx.suppressReply = true;
        return { started: true };
      },
    },
    {
      decl: {
        name: "learn_generate_cards",
        description: "Сгенерировать карточки (слово → перевод) по теме на изучаемом языке и добавить в колоду: «сгенерируй 20 карточек про еду», «карточки по теме работа».",
        parameters: { type: "object", properties: { topic: { type: "string" }, count: { type: "integer", description: "3–40, по умолчанию 15" } }, required: ["topic"] },
      },
      handler: async (args, ctx) => {
        await generateCardsFlow(learnCtx(ctx), argStr(args, "topic"), Number(args.count) || 15);
        ctx.suppressReply = true;
        return { started: true };
      },
    },
    {
      decl: {
        name: "learn_add_card",
        description: "Добавить карточку слово/фраза → перевод в колоду для повторения.",
        parameters: { type: "object", properties: { front: { type: "string", description: "слово на изучаемом языке" }, back: { type: "string", description: "перевод на русский" } }, required: ["front", "back"] },
      },
      handler: async (args, ctx) => {
        const r = addCardManually(ctx.chatId, argStr(args, "front"), argStr(args, "back"));
        return { added: r.created, duplicate: !r.created, totalCards: r.total };
      },
    },
    {
      decl: {
        name: "learn_status",
        description: "Прогресс обучения: серия дней, уроки, карточки, настройки уровня и фокуса. Также открывает меню обучения в чате.",
        parameters: { type: "object", properties: { show_menu: { type: "boolean", description: "показать меню кнопками (по умолчанию true)" } } },
      },
      handler: async (args, ctx) => {
        const p = getLearnProgress(ctx.chatId);
        const s = getLearnSettings(ctx.chatId);
        const c = cardStats(ctx.chatId);
        if (args.show_menu !== false) {
          const v = learnMenuView(ctx.chatId);
          await ctx.sender.sendText(ctx.chatId, v.text, { html: true, inline: v.inline });
          ctx.suppressReply = true;
        }
        return { streak: p.streak, lessonsTotal: p.lessonsTotal, lastLessonDate: p.lastLessonDate, cards: c, level: s.level, focus: s.focus, language: s.langName, topics: TOPICS };
      },
    },
    {
      decl: {
        name: "learn_set_settings",
        description: "Изменить настройки обучения: уровень (A1|A2|B1) и/или язык (language_code — код для озвучки: es, en, it, fr, de, pt; language_name — название по-русски в именительном падеже: «итальянский»).",
        parameters: {
          type: "object",
          properties: { level: { type: "string", enum: [...LEVELS] }, language_code: { type: "string" }, language_name: { type: "string" } },
        },
      },
      handler: async (args, ctx) => {
        const patch: Partial<ReturnType<typeof getLearnSettings>> = {};
        const level = argStr(args, "level").toUpperCase();
        if ((LEVELS as string[]).includes(level)) patch.level = level as Level;
        const code = argStr(args, "language_code").toLowerCase();
        const name = argStr(args, "language_name").toLowerCase();
        if (code && name) {
          patch.lang = code;
          patch.langName = name;
        }
        const s = setLearnSettings(ctx.chatId, patch);
        ctx.changed.add("settings");
        return { level: s.level, language: s.langName, code: s.lang, focus: s.focus };
      },
    },
  ];
}
