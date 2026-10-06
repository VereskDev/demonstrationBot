/**
 * Режим обучения: меню, карточки, статистика, настройки и роутинг callback/текста.
 * Экспортирует две точки входа для handlers.ts: handleLearnCallback и handleLearnText.
 */
import { escapeHtml } from "../telegram/format.ts";
import type { InlineButton } from "../telegram/sender.ts";
import { formatDateTime } from "../time.ts";
import { addCard, cardStats, dueCards, getCard, reviewCard } from "./cards.ts";
import { endTalk, startTalk, talkTopicButtons, talkTurn, STOP_WORDS_RE } from "./conversation.ts";
import { onLessonAnswer, onLessonNext, onLessonSkip, onLessonText, quitLesson, startLesson, topicButtons, type LearnCtx } from "./lesson.ts";
import { clearLearnSession, getLearnProgress, getLearnSession, getLearnSettings, setLearnSession, setLearnSettings, toggleFocus } from "./store.ts";
import { synthesize } from "./tts.ts";
import { ALL_FOCUS, FOCUS_LABEL, LEVELS, TOPICS, type CardsSession, type Focus, type Level } from "./types.ts";

export type { LearnCtx } from "./lesson.ts";
export { startLesson } from "./lesson.ts";
export { startTalk } from "./conversation.ts";

// ───────────────────────── меню / статистика / настройки ─────────────────────────
export function learnMenuView(chatId: string): { text: string; inline: InlineButton[][] } {
  const s = getLearnSettings(chatId);
  const p = getLearnProgress(chatId);
  const c = cardStats(chatId);
  const text =
    `🇪🇸 <b>${escapeHtml(s.langName[0].toUpperCase() + s.langName.slice(1))}</b> · уровень ${s.level}\n` +
    `Фокус: ${s.focus.map((f) => FOCUS_LABEL[f]).join(", ")}\n\n` +
    `🔥 Серия: ${p.streak} ${p.streak === 1 ? "день" : p.streak >= 2 && p.streak <= 4 ? "дня" : "дней"} · уроков: ${p.lessonsTotal}\n` +
    `🃏 Карточек: ${c.total}${c.due ? `, к повторению: <b>${c.due}</b>` : ""}` +
    (p.lastLessonDate ? `\nПоследний урок: ${p.lastLessonDate}` : "\nУроков ещё не было — начни с первого.");
  const inline: InlineButton[][] = [
    [{ text: "📖 Урок дня", callback_data: "learn:lesson" }, { text: c.due ? `🃏 Карточки (${c.due})` : "🃏 Карточки", callback_data: "learn:cards" }],
    [{ text: "🗣 Разговор", callback_data: "learn:talk" }, { text: "📊 Статистика", callback_data: "learn:stats" }],
    [{ text: "⚙️ Уровень и фокус", callback_data: "learn:settings" }],
  ];
  return { text, inline };
}

export function learnStatsView(chatId: string): { text: string; inline: InlineButton[][] } {
  const p = getLearnProgress(chatId);
  const c = cardStats(chatId);
  const topics = TOPICS.map((t) => `• ${t.title}: ${p.topicCounts[t.id] ?? 0}`).join("\n");
  const hist = p.history
    .slice(-7)
    .reverse()
    .map((h) => `• ${h.date} — ${TOPICS.find((t) => t.id === h.topic)?.title ?? h.topic}: ${h.score}/${h.total}`)
    .join("\n");
  const text =
    `📊 <b>Статистика</b>\n\n🔥 Серия: ${p.streak} · уроков всего: ${p.lessonsTotal}\n\n` +
    `<b>Темы</b>\n${topics}\n\n` +
    `<b>Карточки по коробкам</b> (1 — новые, 5 — выучены)\n${c.byBox.map((n, i) => `${i + 1}: ${n}`).join(" · ")}\nВсего ${c.total}, к повторению ${c.due}` +
    (hist ? `\n\n<b>Последние уроки</b>\n${hist}` : "");
  return { text, inline: [[{ text: "← Меню", callback_data: "learn:menu" }]] };
}

export function learnSettingsView(chatId: string): { text: string; inline: InlineButton[][] } {
  const s = getLearnSettings(chatId);
  const levelRow: InlineButton[] = LEVELS.map((l) => ({ text: `${l === s.level ? "● " : ""}${l}`, callback_data: `learn:level:${l}` }));
  const focusRow: InlineButton[] = ALL_FOCUS.map((f) => ({ text: `${s.focus.includes(f) ? "☑ " : "☐ "}${FOCUS_LABEL[f]}`, callback_data: `learn:focus:${f}` }));
  return {
    text: `⚙️ <b>Настройки обучения</b>\n\nУровень: <b>${s.level}</b> — A1 начальный, A2 базовый, B1 средний.\nФокус урока (можно несколько): грамматика добавляет блок с таблицей, аудирование — задания на слух, разговорная речь — больше фраз.\n\nЯзык: ${escapeHtml(s.langName)}. Сменить — напиши мне, например «учу итальянский».`,
    inline: [levelRow, focusRow, [{ text: "← Меню", callback_data: "learn:menu" }]],
  };
}

// ───────────────────────── карточки ─────────────────────────
export async function startCardsReview(ctx: LearnCtx): Promise<void> {
  const due = dueCards(ctx.chatId, Date.now(), 20);
  if (!due.length) {
    const c = cardStats(ctx.chatId);
    const all = c.total ? "Все карточки повторены вовремя. " : "Карточек пока нет: они появятся из ошибок в уроках, или добавь сам: «карточка: la mesa — стол». ";
    await ctx.sender.sendText(ctx.chatId, `🃏 ${all}${c.total ? `Всего ${c.total}.` : ""}`, { inline: [[{ text: "← Меню", callback_data: "learn:menu" }]] });
    return;
  }
  const session: CardsSession = { kind: "cards", queue: due.map((c) => c.id), i: 0, revealed: false, known: 0, unknown: 0 };
  setLearnSession(ctx.chatId, session);
  await showCard(ctx, session);
}

async function showCard(ctx: LearnCtx, s: CardsSession): Promise<void> {
  const card = getCard(ctx.chatId, s.queue[s.i]);
  if (!card) {
    s.i += 1;
    if (s.i >= s.queue.length) return finishCards(ctx, s);
    return showCard(ctx, s);
  }
  s.revealed = false;
  const sent = await ctx.sender.sendText(ctx.chatId, `🃏 ${s.i + 1}/${s.queue.length} · коробка ${card.box}\n\n<b>${escapeHtml(card.front)}</b>\n\nВспомни перевод, затем открой.`, {
    html: true,
    inline: [[{ text: "👁 Показать перевод", callback_data: "learn:card:reveal" }], [{ text: "✖ Закончить", callback_data: "learn:card:stop" }]],
  });
  s.messageId = sent?.messageId;
  setLearnSession(ctx.chatId, s);
}

async function revealCard(ctx: LearnCtx, s: CardsSession, messageId?: number): Promise<void> {
  const card = getCard(ctx.chatId, s.queue[s.i]);
  if (!card) return showCard(ctx, s);
  s.revealed = true;
  setLearnSession(ctx.chatId, s);
  const settings = getLearnSettings(ctx.chatId);
  const text = `🃏 ${s.i + 1}/${s.queue.length} · коробка ${card.box}\n\n<b>${escapeHtml(card.front)}</b>\n${escapeHtml(card.back)}`;
  const inline: InlineButton[][] = [[{ text: "✅ Помню", callback_data: "learn:card:know" }, { text: "❌ Не помню", callback_data: "learn:card:no" }], [{ text: "✖ Закончить", callback_data: "learn:card:stop" }]];
  const mid = messageId ?? s.messageId;
  if (mid) await ctx.sender.editText(ctx.chatId, mid, text, { html: true, inline });
  else await ctx.sender.sendText(ctx.chatId, text, { html: true, inline });
  try {
    const audio = await synthesize(card.front, settings.lang);
    if (audio) await ctx.sender.sendVoice(ctx.chatId, audio.bytes, { mime: audio.mime });
  } catch {
    /* без звука */
  }
}

async function gradeCard(ctx: LearnCtx, s: CardsSession, remembered: boolean, messageId?: number): Promise<void> {
  const id = s.queue[s.i];
  const updated = reviewCard(ctx.chatId, id, remembered);
  if (remembered) s.known += 1;
  else s.unknown += 1;
  const mid = messageId ?? s.messageId;
  if (mid && updated) {
    await ctx.sender
      .editText(ctx.chatId, mid, `${remembered ? "✅" : "❌"} <b>${escapeHtml(updated.front)}</b> — ${escapeHtml(updated.back)}\n${remembered ? `коробка ${updated.box}, следующий повтор ${formatDateTime(updated.due_at, ctx.tz)}` : "вернулась в коробку 1"}`, { html: true })
      .catch(() => {});
  }
  s.i += 1;
  if (s.i >= s.queue.length) return finishCards(ctx, s);
  await showCard(ctx, s);
}

async function finishCards(ctx: LearnCtx, s: CardsSession): Promise<void> {
  clearLearnSession(ctx.chatId);
  const c = cardStats(ctx.chatId);
  await ctx.sender.sendText(ctx.chatId, `Повторение закончено: помню ${s.known}, не помню ${s.unknown}.${c.due ? ` Ещё к повторению: ${c.due}.` : " На сегодня всё."}`, {
    inline: [[...(c.due ? [{ text: "Ещё", callback_data: "learn:cards" }] : []), { text: "← Меню", callback_data: "learn:menu" }]],
  });
}

// ───────────────────────── роутинг ─────────────────────────
export interface LearnCallbackResult {
  handled: boolean;
  /** Текст для answerCallbackQuery. */
  toast?: string;
}

export async function handleLearnCallback(ctx: LearnCtx, data: string, messageId: number): Promise<LearnCallbackResult> {
  if (!data.startsWith("learn:")) return { handled: false };
  const parts = data.split(":");
  const action = parts[1];
  const arg = parts.slice(2).join(":");
  const session = getLearnSession(ctx.chatId);
  const view = async (v: { text: string; inline: InlineButton[][] }) => {
    await ctx.sender.editText(ctx.chatId, messageId, v.text, { html: true, inline: v.inline }).catch(async () => {
      await ctx.sender.sendText(ctx.chatId, v.text, { html: true, inline: v.inline });
    });
  };
  switch (action) {
    case "menu":
      await view(learnMenuView(ctx.chatId));
      return { handled: true };
    case "stats":
      await view(learnStatsView(ctx.chatId));
      return { handled: true };
    case "settings":
      await view(learnSettingsView(ctx.chatId));
      return { handled: true };
    case "level":
      if ((LEVELS as string[]).includes(arg)) setLearnSettings(ctx.chatId, { level: arg as Level });
      await view(learnSettingsView(ctx.chatId));
      return { handled: true, toast: `Уровень ${arg}` };
    case "focus":
      if ((ALL_FOCUS as string[]).includes(arg)) toggleFocus(ctx.chatId, arg as Focus);
      await view(learnSettingsView(ctx.chatId));
      return { handled: true };
    case "topics":
      await view({ text: "Выбери тему урока:", inline: topicButtons() });
      return { handled: true };
    case "lesson":
      if (session?.kind === "lesson" && !arg) {
        await ctx.sender.sendText(ctx.chatId, "Урок уже идёт — продолжай с текущего шага или нажми «Выйти» под вопросом.");
        return { handled: true };
      }
      if (session?.kind === "lesson") clearLearnSession(ctx.chatId);
      await ctx.sender.editButtons(ctx.chatId, messageId, null).catch(() => {});
      await startLesson(ctx, { topic: arg || undefined });
      return { handled: true };
    case "next":
      if (session?.kind !== "lesson") return { handled: true, toast: "Урок уже закончен" };
      await onLessonNext(ctx, session, messageId);
      return { handled: true };
    case "ans":
      if (session?.kind !== "lesson") return { handled: true, toast: "Урок уже закончен" };
      await onLessonAnswer(ctx, session, Number(arg), messageId);
      return { handled: true };
    case "skip":
      if (session?.kind !== "lesson") return { handled: true, toast: "Урок уже закончен" };
      await onLessonSkip(ctx, session, messageId);
      return { handled: true };
    case "quit":
      if (session?.kind === "lesson") await quitLesson(ctx, session, messageId);
      else {
        clearLearnSession(ctx.chatId);
        await view(learnMenuView(ctx.chatId));
      }
      return { handled: true };
    case "cards":
      if (session?.kind === "lesson") return { handled: true, toast: "Сначала закончи урок" };
      await startCardsReview(ctx);
      return { handled: true };
    case "card": {
      if (session?.kind !== "cards") return { handled: true, toast: "Повторение уже закончено" };
      if (arg === "reveal") await revealCard(ctx, session, messageId);
      else if (arg === "know") await gradeCard(ctx, session, true, messageId);
      else if (arg === "no") await gradeCard(ctx, session, false, messageId);
      else if (arg === "stop") {
        clearLearnSession(ctx.chatId);
        await ctx.sender.editButtons(ctx.chatId, messageId, null).catch(() => {});
        await ctx.sender.sendText(ctx.chatId, `Повторение остановлено: помню ${session.known}, не помню ${session.unknown}.`, { inline: [[{ text: "← Меню", callback_data: "learn:menu" }]] });
      }
      return { handled: true };
    }
    case "talk": {
      if (arg === "stop") {
        if (session?.kind === "talk") await endTalk(ctx, session, messageId);
        else return { handled: true, toast: "Разговор уже закончен" };
        return { handled: true };
      }
      if (session?.kind === "lesson") return { handled: true, toast: "Сначала закончи урок" };
      if (!arg) {
        await view({ text: "О чём поговорим? Выбери тему или задай свою.", inline: talkTopicButtons() });
        return { handled: true };
      }
      if (arg === "custom") {
        setLearnSession(ctx.chatId, { kind: "topic_prompt" });
        await ctx.sender.editButtons(ctx.chatId, messageId, null).catch(() => {});
        await ctx.sender.sendText(ctx.chatId, "Напиши тему одним сообщением — например «заказ кофе», «мой город», «планы на выходные».");
        return { handled: true };
      }
      const topic = TOPICS.find((t) => t.id === arg)?.title ?? arg;
      await ctx.sender.editButtons(ctx.chatId, messageId, null).catch(() => {});
      await startTalk(ctx, topic);
      return { handled: true };
    }
    default:
      return { handled: true };
  }
}

/** Текст пользователя во время урока/разговора/ввода темы. true — сообщение обработано режимом обучения. */
export async function handleLearnText(ctx: LearnCtx, text: string): Promise<boolean> {
  const session = getLearnSession(ctx.chatId);
  if (!session) return false;
  const t = text.trim();
  if (session.kind === "topic_prompt") {
    if (!t || STOP_WORDS_RE.test(t)) {
      clearLearnSession(ctx.chatId);
      await ctx.sender.sendText(ctx.chatId, "Ок, без разговора.", { inline: [[{ text: "← Меню", callback_data: "learn:menu" }]] });
      return true;
    }
    await startTalk(ctx, t.slice(0, 80));
    return true;
  }
  if (session.kind === "talk") {
    if (STOP_WORDS_RE.test(t)) {
      await endTalk(ctx, session);
      return true;
    }
    await talkTurn(ctx, session, t);
    return true;
  }
  if (session.kind === "lesson") {
    if (STOP_WORDS_RE.test(t)) {
      await quitLesson(ctx, session);
      return true;
    }
    await onLessonText(ctx, session, t);
    return true;
  }
  if (session.kind === "cards") {
    // Текст во время карточек — не мешаем: просто напомним про кнопки.
    await ctx.sender.sendText(ctx.chatId, "Идёт повторение карточек — нажимай кнопки под карточкой. Остановить — «Закончить».");
    return true;
  }
  return false;
}

/** «карточка: hola — привет» — ручное добавление текстом. */
export function parseCardCommand(text: string): { front: string; back: string } | null {
  const m = text.match(/^(?:карточка|карточку|card)\s*[:：]\s*(.+?)\s+[—–-]\s+(.+)$/i);
  if (!m) return null;
  return { front: m[1].trim(), back: m[2].trim() };
}

export function addCardManually(chatId: string, front: string, back: string): { created: boolean; total: number } {
  const r = addCard(chatId, front, back, "manual");
  return { created: r.created, total: cardStats(chatId).total };
}

export function hasActiveLearnSession(chatId: string): boolean {
  return getLearnSession(chatId) !== null;
}
