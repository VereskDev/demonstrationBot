/**
 * Урок дня в Telegram: шаги идут отдельными сообщениями (словарь с озвучкой, грамматика,
 * фразы, аудирование голосовым без текста, упражнения с вводом текста и кнопками, тест).
 * Состояние сессии — в SQLite, поэтому урок переживает рестарт бота.
 */
import type { ModelTransport } from "../llm/types.ts";
import { log, errMsg } from "../runtime/log.ts";
import { escapeHtml } from "../telegram/format.ts";
import type { InlineButton, Sender } from "../telegram/sender.ts";
import { accentsOnlyDiff, judgeTranslation, matchesAnswer } from "./answers.ts";
import { addCard, cardStats } from "./cards.ts";
import { buildLesson, pickTopic, planSteps } from "./generator.ts";
import { clearLearnSession, getLearnProgress, getLearnSettings, recordLessonDone, setLearnSession, cacheLesson } from "./store.ts";
import { speakablePart, synthesize } from "./tts.ts";
import type { Exercise, Lesson, LessonSession, Step } from "./types.ts";
import { TOPICS, langFlag } from "./types.ts";

export interface LearnCtx {
  chatId: string;
  sender: Sender;
  model: ModelTransport;
  tz: string;
}

const NEXT: InlineButton[][] = [[{ text: "Дальше ▶", callback_data: "learn:next" }, { text: "✖ Выйти", callback_data: "learn:quit" }]];

function answerButtons(options: string[]): InlineButton[][] {
  const letters = ["A", "B", "C", "D", "E"];
  const rows: InlineButton[][] = [];
  options.forEach((_, i) => rows.push([{ text: `${letters[i]}. ${options[i].slice(0, 40)}`, callback_data: `learn:ans:${i}` }]));
  rows.push([{ text: "✖ Выйти из урока", callback_data: "learn:quit" }]);
  return rows;
}

function progressBar(i: number, total: number): string {
  const n = Math.max(1, total - 1);
  const filled = Math.round((Math.min(i, n) / n) * 10);
  return "▰".repeat(filled) + "▱".repeat(10 - filled);
}

async function speak(ctx: LearnCtx, text: string, lang: string, caption?: string): Promise<void> {
  try {
    void ctx.sender.typing(ctx.chatId, "record_voice");
    const s = await synthesize(text, lang);
    if (s) await ctx.sender.sendVoice(ctx.chatId, s.bytes, { mime: s.mime, caption });
  } catch (e) {
    log.warn("learn", `озвучка: ${errMsg(e)}`);
  }
}

export async function startLesson(ctx: LearnCtx, opts: { topic?: string } = {}): Promise<void> {
  const settings = getLearnSettings(ctx.chatId);
  const progress = getLearnProgress(ctx.chatId);
  const topic = pickTopic(progress, opts.topic);
  await ctx.sender.sendText(ctx.chatId, `Собираю урок по теме «${topic.title}» (${settings.level}, фокус: ${settings.focus.map((f) => ({ grammar: "грамматика", conversation: "разговор", listening: "аудирование" })[f]).join(", ")})…`);
  void ctx.sender.typing(ctx.chatId);
  const recent = progress.history.filter((h) => h.topic === topic.id).slice(-3).map((h) => h.date);
  let lesson: Lesson;
  try {
    lesson = await buildLesson(ctx.model, settings, topic, recent);
  } catch (e) {
    log.warn("learn", `урок не собрался: ${errMsg(e)}`);
    await ctx.sender.sendText(ctx.chatId, `Не получилось собрать урок: ${errMsg(e)}. Попробуй через пару минут.`, { inline: [[{ text: "Повторить", callback_data: "learn:lesson" }, { text: "← Меню", callback_data: "learn:menu" }]] });
    return;
  }
  cacheLesson(ctx.chatId, topic.id, settings.level, lesson);
  const session: LessonSession = {
    kind: "lesson",
    lesson,
    steps: planSteps(lesson, settings.focus),
    i: 0,
    mistakes: [],
    exCorrect: 0,
    exTotal: 0,
    quizCorrect: 0,
    awaitingText: false,
    startedAt: Date.now(),
  };
  setLearnSession(ctx.chatId, session);
  await renderStep(ctx, session);
}

export async function renderStep(ctx: LearnCtx, s: LessonSession): Promise<void> {
  const step = s.steps[s.i];
  const L = s.lesson;
  const settings = getLearnSettings(ctx.chatId);
  const head = `${progressBar(s.i, s.steps.length)} ${s.i + 1}/${s.steps.length}`;
  s.awaitingText = false;
  switch (step.kind) {
    case "intro": {
      await ctx.sender.sendText(
        ctx.chatId,
        `${langFlag(settings.lang)} <b>${escapeHtml(L.title)}</b>\nТема: ${escapeHtml(L.topic)} · ${escapeHtml(settings.langName)}, уровень ${L.level}${L.source === "bank" ? " · из банка уроков" : ""}\n\nВ уроке: ${L.vocab.length} слов${L.grammar && s.steps.some((x) => x.kind === "grammar") ? ", грамматика" : ""}, ${L.phrases.length} фраз${s.steps.some((x) => x.kind === "listening") ? `, аудирование ×${L.listening.length}` : ""}, упражнения ×${L.exercises.length}, тест ×${L.quiz.length}. Минут на 15.`,
        { html: true, inline: [[{ text: "Начать ▶", callback_data: "learn:next" }, { text: "Другая тема", callback_data: "learn:topics" }]] },
      );
      break;
    }
    case "vocab": {
      const lines = L.vocab.map((v, i) => `${i + 1}. <b>${escapeHtml(v.es)}</b> — ${escapeHtml(v.ru)}${v.example ? `\n    <i>${escapeHtml(v.example)}</i>${v.exampleRu ? ` — ${escapeHtml(v.exampleRu)}` : ""}` : ""}`);
      await ctx.sender.sendText(ctx.chatId, `${head}\n📚 <b>Словарь</b>\n\n${lines.join("\n")}\n\nСлушай озвучку и повторяй вслух.`, { html: true });
      await speak(ctx, L.vocab.map((v) => v.es).join(". ") + ".", settings.lang);
      await ctx.sender.sendText(ctx.chatId, "Готов идти дальше?", { inline: NEXT });
      break;
    }
    case "grammar": {
      const g = L.grammar!;
      const w = Math.max(...(g.table ?? []).map((r) => r[0].length), 4);
      const table = g.table?.length ? `\n<pre>${g.table.map((r) => `${escapeHtml(r[0].padEnd(w))}  ${escapeHtml(r.slice(1).join("  "))}`).join("\n")}</pre>` : "";
      const ex = g.examples?.length ? `\n\n${g.examples.map((e) => `• <i>${escapeHtml(e.es)}</i> — ${escapeHtml(e.ru)}`).join("\n")}` : "";
      await ctx.sender.sendText(ctx.chatId, `${head}\n📐 <b>Грамматика: ${escapeHtml(g.title)}</b>\n\n${escapeHtml(g.explanation)}${table}${ex}`, { html: true, inline: NEXT });
      break;
    }
    case "phrases": {
      const lines = L.phrases.map((p) => `• <b>${escapeHtml(p.es)}</b> — ${escapeHtml(p.ru)}`);
      await ctx.sender.sendText(ctx.chatId, `${head}\n💬 <b>Разговорные фразы</b>\n\n${lines.join("\n")}`, { html: true });
      await speak(ctx, L.phrases.map((p) => p.es).join(" "), settings.lang);
      await ctx.sender.sendText(ctx.chatId, "Повтори каждую вслух за диктором. Дальше?", { inline: NEXT });
      break;
    }
    case "listening": {
      const item = L.listening[step.idx];
      await ctx.sender.sendText(ctx.chatId, `${head}\n🎧 <b>Аудирование ${step.idx + 1}/${L.listening.length}</b>\nПослушай и ответь на вопрос.`, { html: true });
      await speak(ctx, item.es, settings.lang);
      await ctx.sender.sendText(ctx.chatId, item.question, { inline: answerButtons(item.options) });
      break;
    }
    case "exercise": {
      const ex = L.exercises[step.idx];
      const title = `${head}\n✍️ <b>Упражнение ${step.idx + 1}/${L.exercises.length}</b>`;
      if (ex.type === "fill") {
        s.awaitingText = true;
        await ctx.sender.sendText(ctx.chatId, `${title}\nВставь пропущенное слово:\n\n<b>${escapeHtml(ex.sentence)}</b>${ex.ru ? `\n<i>${escapeHtml(ex.ru)}</i>` : ""}${ex.hint ? `\nПодсказка: ${escapeHtml(ex.hint)}` : ""}\n\nНапиши ответ сообщением.`, {
          html: true,
          inline: [[{ text: "Не знаю, покажи ответ", callback_data: "learn:skip" }, { text: "✖ Выйти", callback_data: "learn:quit" }]],
        });
      } else if (ex.type === "choose") {
        await ctx.sender.sendText(ctx.chatId, `${title}\n${escapeHtml(ex.question)}`, { html: true, inline: answerButtons(ex.options) });
      } else {
        s.awaitingText = true;
        await ctx.sender.sendText(ctx.chatId, `${title}\nПереведи на ${escapeHtml(settings.langName)}:\n\n<b>${escapeHtml(ex.ru)}</b>\n\nНапиши перевод сообщением.`, {
          html: true,
          inline: [[{ text: "Не знаю, покажи ответ", callback_data: "learn:skip" }, { text: "✖ Выйти", callback_data: "learn:quit" }]],
        });
      }
      break;
    }
    case "quiz": {
      const q = L.quiz[step.idx];
      await ctx.sender.sendText(ctx.chatId, `${head}\n🧪 <b>Тест ${step.idx + 1}/${L.quiz.length}</b>\n${escapeHtml(q.question)}`, { html: true, inline: answerButtons(q.options) });
      break;
    }
    case "finish": {
      await finishLesson(ctx, s);
      return;
    }
  }
  setLearnSession(ctx.chatId, s);
}

async function advance(ctx: LearnCtx, s: LessonSession): Promise<void> {
  s.i = Math.min(s.i + 1, s.steps.length - 1);
  await renderStep(ctx, s);
}

function pairFor(step: Step, L: Lesson): { es: string; ru: string } | null {
  if (step.kind === "listening") {
    const it = L.listening[step.idx];
    return { es: it.es, ru: it.ru ?? it.question };
  }
  if (step.kind === "exercise") {
    const ex = L.exercises[step.idx];
    if (ex.type === "fill") return { es: ex.sentence.replace("___", ex.answer), ru: ex.ru ?? ex.answer };
    if (ex.type === "translate") return { es: ex.es, ru: ex.ru };
    return { es: ex.options[ex.answer], ru: ex.question };
  }
  if (step.kind === "quiz") {
    const q = L.quiz[step.idx];
    return { es: q.options[q.answer], ru: q.question };
  }
  return null;
}

function noteMistake(s: LessonSession, step: Step): void {
  const pair = pairFor(step, s.lesson);
  if (pair && !s.mistakes.some((m) => m.es === pair.es)) s.mistakes.push(pair);
}

/** Нажатие варианта ответа (аудирование, choose, тест). */
export async function onLessonAnswer(ctx: LearnCtx, s: LessonSession, choice: number, messageId?: number): Promise<void> {
  const step = s.steps[s.i];
  const L = s.lesson;
  let correct = -1;
  let options: string[] = [];
  let reveal = "";
  if (step.kind === "listening") {
    const it = L.listening[step.idx];
    correct = it.answer;
    options = it.options;
    reveal = `\n\n🗣 <i>${escapeHtml(it.es)}</i>${it.ru ? `\n${escapeHtml(it.ru)}` : ""}`;
  } else if (step.kind === "exercise" && L.exercises[step.idx].type === "choose") {
    const ex = L.exercises[step.idx] as Extract<Exercise, { type: "choose" }>;
    correct = ex.answer;
    options = ex.options;
  } else if (step.kind === "quiz") {
    const q = L.quiz[step.idx];
    correct = q.answer;
    options = q.options;
  } else return;
  if (messageId) await ctx.sender.editButtons(ctx.chatId, messageId, null).catch(() => {});
  const ok = choice === correct;
  if (step.kind === "quiz") {
    if (ok) s.quizCorrect += 1;
  } else {
    s.exTotal += 1;
    if (ok) s.exCorrect += 1;
  }
  if (!ok) noteMistake(s, step);
  await ctx.sender.sendText(ctx.chatId, `${ok ? "✅ Верно!" : `❌ Не совсем. Правильно: <b>${escapeHtml(options[correct] ?? "")}</b>`}${reveal}`, { html: true });
  await advance(ctx, s);
}

/** Текстовый ответ на fill/translate. */
export async function onLessonText(ctx: LearnCtx, s: LessonSession, text: string): Promise<void> {
  const step = s.steps[s.i];
  if (step.kind !== "exercise" || !s.awaitingText) {
    await ctx.sender.sendText(ctx.chatId, "Сейчас жду нажатие кнопки под вопросом. Или нажми «Выйти», чтобы прервать урок.");
    return;
  }
  const ex = s.lesson.exercises[step.idx];
  const settings = getLearnSettings(ctx.chatId);
  s.exTotal += 1;
  let ok = false;
  let feedback = "";
  if (ex.type === "fill") {
    ok = matchesAnswer(text, [ex.answer]);
    const accents = ok && accentsOnlyDiff(text, [ex.answer]);
    feedback = ok
      ? `✅ Верно${accents ? ` (точнее — <b>${escapeHtml(ex.answer)}</b>, с ударением)` : ""}!\n<i>${escapeHtml(ex.sentence.replace("___", ex.answer))}</i>`
      : `❌ Правильно: <b>${escapeHtml(ex.answer)}</b>\n<i>${escapeHtml(ex.sentence.replace("___", ex.answer))}</i>${ex.ru ? ` — ${escapeHtml(ex.ru)}` : ""}`;
  } else if (ex.type === "translate") {
    const expected = [ex.es, ...(ex.accept ?? [])];
    ok = matchesAnswer(text, expected);
    let note = "";
    if (!ok) {
      void ctx.sender.typing(ctx.chatId);
      const j = await judgeTranslation(ctx.model, settings.langName, ex.ru, ex.es, text);
      ok = j.ok;
      note = j.note ?? "";
    }
    feedback = ok
      ? `✅ Принято!${note ? ` <i>${escapeHtml(note)}</i>` : ""}\nЭталон: <b>${escapeHtml(ex.es)}</b>`
      : `❌ Эталон: <b>${escapeHtml(ex.es)}</b>${note ? `\n<i>${escapeHtml(note)}</i>` : ""}`;
  } else return;
  if (ok) s.exCorrect += 1;
  else noteMistake(s, step);
  await ctx.sender.sendText(ctx.chatId, feedback, { html: true });
  if (ex.type === "translate" || ex.type === "fill") await speak(ctx, ex.type === "fill" ? ex.sentence.replace("___", ex.answer) : ex.es, settings.lang);
  await advance(ctx, s);
}

/** «Не знаю» на текстовом упражнении. */
export async function onLessonSkip(ctx: LearnCtx, s: LessonSession, messageId?: number): Promise<void> {
  const step = s.steps[s.i];
  if (step.kind !== "exercise") return advance(ctx, s);
  const ex = s.lesson.exercises[step.idx];
  if (messageId) await ctx.sender.editButtons(ctx.chatId, messageId, null).catch(() => {});
  s.exTotal += 1;
  noteMistake(s, step);
  const answer = ex.type === "fill" ? ex.sentence.replace("___", ex.answer) : ex.type === "translate" ? ex.es : ex.options[ex.answer];
  await ctx.sender.sendText(ctx.chatId, `Ответ: <b>${escapeHtml(answer)}</b>. Добавил в карточки, повторим позже.`, { html: true });
  await advance(ctx, s);
}

export async function onLessonNext(ctx: LearnCtx, s: LessonSession, messageId?: number): Promise<void> {
  const step = s.steps[s.i];
  // «Дальше» допустимо только на информационных шагах; на вопросах ждём ответ.
  if (step.kind === "listening" || step.kind === "quiz" || (step.kind === "exercise" && !s.awaitingText)) {
    await ctx.sender.sendText(ctx.chatId, "Сначала выбери ответ 🙂");
    return;
  }
  if (step.kind === "exercise") {
    await ctx.sender.sendText(ctx.chatId, "Напиши ответ сообщением или нажми «Не знаю».");
    return;
  }
  if (messageId) await ctx.sender.editButtons(ctx.chatId, messageId, null).catch(() => {});
  await advance(ctx, s);
}

export async function quitLesson(ctx: LearnCtx, s: LessonSession, messageId?: number): Promise<void> {
  if (messageId) await ctx.sender.editButtons(ctx.chatId, messageId, null).catch(() => {});
  let added = 0;
  for (const m of s.mistakes) if (addCard(ctx.chatId, m.es, m.ru, "lesson").created) added += 1;
  clearLearnSession(ctx.chatId);
  await ctx.sender.sendText(ctx.chatId, `Урок прерван на шаге ${s.i + 1}/${s.steps.length}.${added ? ` Ошибки (${added}) сохранил в карточки.` : ""}`, {
    inline: [[{ text: "🗣 Меню обучения", callback_data: "learn:menu" }]],
  });
}

async function finishLesson(ctx: LearnCtx, s: LessonSession): Promise<void> {
  let added = 0;
  for (const m of s.mistakes) if (addCard(ctx.chatId, m.es, m.ru, "lesson").created) added += 1;
  const total = s.exTotal + s.lesson.quiz.length;
  const score = s.exCorrect + s.quizCorrect;
  const { progress, streakGrew } = recordLessonDone(ctx.chatId, s.lesson.topicId, score, total, ctx.tz);
  clearLearnSession(ctx.chatId);
  const pct = total ? Math.round((score / total) * 100) : 0;
  const mood = pct >= 90 ? "Отлично! 🔥" : pct >= 70 ? "Хорошо! 👍" : pct >= 50 ? "Неплохо, есть над чем поработать." : "Сложная тема — карточки помогут закрепить.";
  const stats = cardStats(ctx.chatId);
  const mins = Math.max(1, Math.round((Date.now() - s.startedAt) / 60_000));
  const text =
    `🏁 <b>Урок завершён</b> — ${mood}\n\n` +
    `Тест: ${s.quizCorrect}/${s.lesson.quiz.length} · упражнения: ${s.exCorrect}/${s.exTotal} · ${mins} мин\n` +
    `${streakGrew ? "🔥" : "📅"} Серия: <b>${progress.streak}</b> ${progress.streak === 1 ? "день" : progress.streak < 5 ? "дня" : "дней"} подряд · уроков всего: ${progress.lessonsTotal}\n` +
    (added ? `🃏 В карточки добавлено: ${added}` : "🃏 Новых карточек нет — ошибок не было") +
    (stats.due ? `\nК повторению сейчас: ${stats.due}` : "");
  const inline: InlineButton[][] = [];
  if (stats.due) inline.push([{ text: `🃏 Повторить карточки (${stats.due})`, callback_data: "learn:cards" }]);
  inline.push([{ text: "🗣 Поговорить на эту тему", callback_data: `learn:talk:${s.lesson.topicId}` }, { text: "Меню", callback_data: "learn:menu" }]);
  await ctx.sender.sendText(ctx.chatId, text, { html: true, inline });
}

export function topicButtons(): InlineButton[][] {
  const rows: InlineButton[][] = [];
  for (let i = 0; i < TOPICS.length; i += 2) rows.push(TOPICS.slice(i, i + 2).map((t) => ({ text: t.title, callback_data: `learn:lesson:${t.id}` })));
  rows.push([{ text: "← Меню", callback_data: "learn:menu" }]);
  return rows;
}

export { speak as speakForLearn, speakablePart };
