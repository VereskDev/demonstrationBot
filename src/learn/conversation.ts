/**
 * Живой разговор: бот играет носителя языка. Короткие реплики, вопрос в конце, мягкие
 * подсказки по-русски в скобках. История разговора отдельная от основного агента.
 */
import { parseModelJson, simplePrompt } from "../llm/gemini.ts";
import type { LlmMessage } from "../llm/types.ts";
import { log, errMsg } from "../runtime/log.ts";
import { reviewCard } from "./cards.ts";
import { escapeHtml } from "../telegram/format.ts";
import type { InlineButton } from "../telegram/sender.ts";
import type { LearnCtx } from "./lesson.ts";
import { clearLearnSession, getLearnSettings, setLearnSession } from "./store.ts";
import { speakablePart, synthesize } from "./tts.ts";
import type { TalkSession } from "./types.ts";
import { TOPICS } from "./types.ts";

const STOP_BTN: InlineButton[][] = [[{ text: "✖ Закончить разговор", callback_data: "learn:talk:stop" }]];

function talkSystem(langName: string, level: string, topic: string, reviewWords: string[] = []): string {
  const review = reviewWords.length
    ? `\nЦель этого разговора — чтобы ученик САМ употребил слова: ${reviewWords.join(", ")}. Задавай вопросы и строй ситуации так, чтобы эти слова напрашивались в ответе (по 1–2 слова за реплику), сам их не произноси первым без нужды. Когда ученик употребил слово из списка правильно — отметь в конце реплики по-русски в скобках: (✓ слово).`
    : "";
  return `Ты — носитель языка «${langName}» (представься коротким именем, типичным для этого языка; для испанского — Lucía из Мадрида, для английского — Emma из Лондона), дружелюбная собеседница для практики. Ученик — русскоязычный, уровень ${level}. Тема разговора: «${topic}».${review}
Правила:
- Отвечай ТОЛЬКО на изучаемом языке, 1–3 коротких предложения, лексика и грамматика уровня ${level} (на A1 — очень простые фразы, настоящее время).
- В конце каждой реплики задавай один вопрос, чтобы ученик продолжил говорить.
- Если в сообщении ученика есть ошибка — после своей реплики добавь ОДНУ мягкую подсказку по-русски в скобках, например: (подсказка: лучше «tengo hambre», глагол tener). Если ошибок нет — ничего не добавляй.
- Если ученик написал по-русски — ответь на изучаемом языке и в скобках по-русски подскажи, как это сказать: (скажи так: «...»).
- Если ученик просит перевод или объяснение — коротко объясни по-русски в скобках, затем вернись к разговору.
- Не используй markdown, списки и эмодзи. Не начинай каждую реплику с приветствия.`;
}

export async function startTalk(ctx: LearnCtx, topic: string, opts: { reviewCards?: TalkSession["reviewCards"] } = {}): Promise<void> {
  const s = getLearnSettings(ctx.chatId);
  const session: TalkSession = { kind: "talk", topic, messages: [], turns: 0, startedAt: Date.now(), reviewCards: opts.reviewCards?.length ? opts.reviewCards : undefined };
  setLearnSession(ctx.chatId, session);
  const reviewNote = session.reviewCards
    ? `\nПовторяем в деле: ${session.reviewCards.map((c) => `<b>${escapeHtml(c.front)}</b>`).join(", ")}. Старайся употребить их в ответах — что употребишь правильно, отметится как «помню».`
    : "";
  await ctx.sender.sendText(
    ctx.chatId,
    `🗣 <b>Разговор: ${escapeHtml(topic)}</b>\nСобеседница — носитель, отвечает на языке «${escapeHtml(s.langName)}» уровня ${s.level}, подсказки по-русски в скобках. Лучше всего отвечать голосовыми. Выйти — кнопка ниже или слово «стоп».${reviewNote}`,
    { html: true },
  );
  await talkTurn(ctx, session, `(начни разговор на тему «${topic}»: поздоровайся одной фразой и задай простой вопрос)`, true);
}

export async function talkTurn(ctx: LearnCtx, session: TalkSession, userText: string, opener = false): Promise<void> {
  const s = getLearnSettings(ctx.chatId);
  const system = talkSystem(s.langName, s.level, session.topic, session.reviewCards?.map((c) => c.front) ?? []);
  const messages: LlmMessage[] = [...session.messages, { role: "user", text: userText }];
  void ctx.sender.typing(ctx.chatId);
  let reply = "";
  try {
    const turn = await ctx.model.generate({ system, messages, tools: [], noTools: true, temperature: 0.8 });
    reply = String(turn.text ?? "").trim();
  } catch (e) {
    log.warn("learn", `разговор: ${errMsg(e)}`);
    await ctx.sender.sendText(ctx.chatId, "Lucía задумалась — модель не ответила. Повтори реплику через минуту или нажми «Закончить».", { inline: STOP_BTN });
    return;
  }
  if (!reply) reply = "¿Perdona? No te he entendido. ¿Puedes repetir? (подсказка: напиши ещё раз, можно проще)";
  const modelMsg: LlmMessage = { role: "model", text: reply };
  session.messages = [...messages, modelMsg].slice(-30);
  if (!opener) session.turns += 1;
  setLearnSession(ctx.chatId, session);
  const showStop = opener || session.turns % 4 === 0;
  await ctx.sender.sendText(ctx.chatId, reply, showStop ? { inline: STOP_BTN } : undefined);
  const spoken = speakablePart(reply);
  if (spoken) {
    try {
      void ctx.sender.typing(ctx.chatId, "record_voice");
      const audio = await synthesize(spoken, s.lang);
      if (audio) await ctx.sender.sendVoice(ctx.chatId, audio.bytes, { mime: audio.mime });
    } catch (e) {
      log.warn("learn", `озвучка реплики: ${errMsg(e)}`);
    }
  }
}

export async function endTalk(ctx: LearnCtx, session: TalkSession, messageId?: number): Promise<void> {
  if (messageId) await ctx.sender.editButtons(ctx.chatId, messageId, null).catch(() => {});
  clearLearnSession(ctx.chatId);
  const mins = Math.max(1, Math.round((Date.now() - session.startedAt) / 60_000));
  let summary = "";
  let reviewed = "";
  const transcript = session.messages.map((m) => `${m.role === "user" ? "Ученик" : "Собеседница"}: ${m.text ?? ""}`).join("\n");
  if (session.reviewCards?.length && session.turns >= 1) {
    // Какие слова из колоды ученик употребил правильно — те и «помню».
    try {
      const s = getLearnSettings(ctx.chatId);
      const text = await simplePrompt(
        ctx.model,
        `Язык: ${s.langName}. Слова для повторения: ${session.reviewCards.map((c) => c.front).join(", ")}.\nСтенограмма:\n${transcript}\n\nКакие из слов ученик (не собеседница!) употребил сам и правильно по смыслу и форме? Верни строго JSON: {"used":["слово", ...]}`,
        { fast: true, json: true, temperature: 0 },
      );
      const used = new Set((parseModelJson<{ used?: unknown }>(text).used as unknown[] | undefined)?.map((w) => String(w).toLowerCase().trim()) ?? []);
      const ok: string[] = [];
      for (const c of session.reviewCards) {
        if (used.has(c.front.toLowerCase()) || [...used].some((u) => u.includes(c.front.toLowerCase()) || c.front.toLowerCase().includes(u))) {
          reviewCard(ctx.chatId, c.id, true);
          ok.push(c.front);
        }
      }
      reviewed = ok.length ? `\n\n✅ Закрепил в разговоре: ${ok.join(", ")}${ok.length < session.reviewCards.length ? `\nОстались на повтор: ${session.reviewCards.filter((c) => !ok.includes(c.front)).map((c) => c.front).join(", ")}` : ""}` : `\n\nСлова из колоды в разговоре не прозвучали — они остались на повтор.`;
    } catch (e) {
      log.warn("learn", `разбор повторения: ${errMsg(e)}`);
    }
  }
  if (session.turns >= 2) {
    try {
      void ctx.sender.typing(ctx.chatId);
      const s = getLearnSettings(ctx.chatId);
      const turn = await ctx.model.generate({
        system: `Ты преподаватель языка «${s.langName}». По стенограмме разговора дай ученику (уровень ${s.level}) короткий разбор по-русски: 2–4 пункта — что было хорошо, какие ошибки повторялись, 3 полезных слова или фразы из разговора с переводом. Без markdown-заголовков, списки через «•», до 700 знаков.`,
        messages: [{ role: "user", text: transcript }],
        tools: [],
        noTools: true,
        fast: true,
      });
      summary = String(turn.text ?? "").trim();
    } catch {
      /* разбор не критичен */
    }
  }
  await ctx.sender.sendText(ctx.chatId, `Разговор окончен: ${session.turns} ${session.turns === 1 ? "реплика" : session.turns < 5 ? "реплики" : "реплик"}, ${mins} мин.${reviewed}${summary ? `\n\n${summary}` : ""}`, {
    inline: [[{ text: "🗣 Меню обучения", callback_data: "learn:menu" }]],
  });
}

export function talkTopicButtons(): InlineButton[][] {
  const rows: InlineButton[][] = [];
  for (let i = 0; i < TOPICS.length; i += 2) rows.push(TOPICS.slice(i, i + 2).map((t) => ({ text: t.title, callback_data: `learn:talk:${t.id}` })));
  rows.push([{ text: "✏️ Своя тема", callback_data: "learn:talk:custom" }, { text: "← Меню", callback_data: "learn:menu" }]);
  return rows;
}

// Без \b: в JS граница слова ASCII-only и после кириллицы не срабатывает.
export const STOP_WORDS_RE = /^(?:стоп|stop|закончить|хватит|выход|выйти|конец|basta|terminar|\/stop)(?=[\s.!?,;:]|$)/i;
