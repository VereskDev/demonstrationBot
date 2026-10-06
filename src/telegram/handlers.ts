/**
 * Роутинг входящих: доступ только владельцу, команды и кнопки меню — детерминированно (без
 * модели), callback-кнопки (напоминания/задачи/заметки), всё остальное — агенту. Голосовые
 * расшифровывает быстрая модель Gemini, фото уходит модели как картинка.
 */
import { runAgentTurn, type AgentDeps } from "../agent/agent.ts";
import { config } from "../config.ts";
import {
  clearHistory,
  deactivateReminder,
  deleteNote,
  ensureChat,
  getChat,
  getNote,
  getReminder,
  getSetting,
  getTask,
  rescheduleReminder,
  setChatTz,
  setPendingMode,
  setSetting,
  setTaskDone,
  chatTz,
} from "../db/index.ts";
import { simplePrompt } from "../llm/gemini.ts";
import { addCardManually, applyWebAppResults, handleLearnCallback, handleLearnText, hasActiveLearnSession, learnMenuView, parseCardCommand, type LearnCtx } from "../learn/index.ts";
import { parseWebAppResults } from "../learn/cardsGen.ts";
import { cardStats } from "../learn/cards.ts";
import { applyStartResults, refreshMenuButton } from "../learn/menuButton.ts";
import { clearLearnSession, getLearnSession } from "../learn/store.ts";
import { endTalk } from "../learn/conversation.ts";
import { quitLesson } from "../learn/lesson.ts";
import { log, errMsg } from "../runtime/log.ts";
import { formatDateTime, isValidZone, nextOccurrence, nowIn } from "../time.ts";
import { agendaView, HELP_TEXT, notesView, noteView, remindersView, tasksView } from "../views.ts";
import type { TelegramApi } from "./api.ts";
import { BOT_COMMANDS, BTN, MAIN_KEYBOARD } from "./keyboards.ts";
import { normalizeUpdate, type IncomingCallback, type IncomingMessage } from "./normalize.ts";

export interface HandlerDeps extends AgentDeps {
  tg: TelegramApi;
  /** username бота — для ссылок из Mini App; пусто (тесты) — кнопка меню не трогается. */
  botUsername?: string;
}

const OWNER_KEY = "owner_id";

function ownerId(): string {
  return config.ownerId || getSetting(OWNER_KEY) || "";
}

/** Первый написавший становится владельцем, если OWNER_TELEGRAM_ID не задан. */
function checkAccess(userId: string, name: string): "owner" | "claimed" | "denied" {
  const owner = ownerId();
  if (owner) return owner === userId ? "owner" : "denied";
  setSetting(OWNER_KEY, userId);
  log.info("auth", `владелец бота: ${name || "?"} (id ${userId}) — сохранил в настройках`);
  return "claimed";
}

export async function handleUpdate(deps: HandlerDeps, update: Record<string, unknown>): Promise<void> {
  const inc = normalizeUpdate(update);
  if (inc.kind === "skip") return;
  const access = checkAccess(inc.userId, inc.name);
  if (access === "denied") {
    if (inc.kind === "message") await deps.tg.sendText(inc.chatId, "Это личный бот, он отвечает только своему владельцу.");
    else await deps.tg.answerCallback(inc.callbackId, "Это личный бот.");
    return;
  }
  ensureChat(inc.chatId, inc.userId, inc.name);
  try {
    if (inc.kind === "callback") return await handleCallback(deps, inc);
    if (access === "claimed") {
      await sendWelcome(deps, inc.chatId, inc.name);
      if (/^\/start\s*$/i.test(inc.text)) return;
    }
    await handleMessage(deps, inc);
  } finally {
    // Колода могла измениться — кнопка меню с Mini App получает свежий URL (дёшево: API зовётся только при изменении).
    if (deps.botUsername) void refreshMenuButton(deps.tg, inc.chatId, deps.botUsername);
  }
}

async function sendWelcome(deps: HandlerDeps, chatId: string, name: string): Promise<void> {
  await deps.tg.setCommands(BOT_COMMANDS);
  await deps.tg.sendText(
    chatId,
    `Привет${name ? `, ${name.split(" ")[0]}` : ""}. Я твой личный помощник: заметки, задачи, напоминания, картинки и схемы. Пиши как есть — текстом или голосом.\n\nЧасовой пояс сейчас ${chatTz(chatId)}; если другой — напиши «я в Москве» или /tz Europe/Moscow.`,
    { keyboard: MAIN_KEYBOARD },
  );
}

async function handleMessage(deps: HandlerDeps, m: IncomingMessage): Promise<void> {
  const chatId = m.chatId;
  const tz = chatTz(chatId);
  const text = m.text;

  // ── результаты из Mini App (тренажёр карточек) ──
  if (m.webAppData) {
    const results = parseWebAppResults(m.webAppData);
    if (!results) {
      await deps.tg.sendText(chatId, "Не понял данные из приложения.", { keyboard: MAIN_KEYBOARD });
      return;
    }
    const r = applyWebAppResults(chatId, results);
    const c = cardStats(chatId);
    await deps.tg.sendText(chatId, `🃏 Записал: помню ${r.known}, не помню ${r.unknown}.${c.due ? ` Ещё к повторению: ${c.due}.` : " На сегодня всё."}`, { keyboard: MAIN_KEYBOARD, inline: undefined });
    return;
  }
  if (text === BTN.back) {
    await deps.tg.sendText(chatId, "Главное меню.", { keyboard: MAIN_KEYBOARD });
    return;
  }

  // ── команды ──
  if (m.isCommand) {
    const [cmdRaw, ...rest] = text.split(/\s+/);
    const cmd = cmdRaw.replace(/@\w+$/, "").toLowerCase();
    const arg = rest.join(" ").trim();
    switch (cmd) {
      case "/start": {
        // Итоги из Mini App, открытого кнопкой меню: /start cr_<колода>_<маски>.
        if (arg.startsWith("cr_")) {
          const r = applyStartResults(chatId, arg);
          if (!r) {
            await deps.tg.sendText(chatId, "Эта колода уже устарела — открой тренажёр заново.", { keyboard: MAIN_KEYBOARD });
            return;
          }
          const c = cardStats(chatId);
          await deps.tg.sendText(chatId, `🃏 Записал: помню ${r.known}, не помню ${r.unknown}.${c.due ? ` Ещё к повторению: ${c.due}.` : " На сегодня всё."}`, { keyboard: MAIN_KEYBOARD });
          return;
        }
        return sendWelcome(deps, chatId, m.name);
      }
      case "/help":
        await deps.tg.sendText(chatId, HELP_TEXT, { keyboard: MAIN_KEYBOARD });
        return;
      case "/today":
        return sendView(deps, chatId, agendaView(chatId, tz));
      case "/notes":
        return sendView(deps, chatId, notesView(chatId, tz, { query: arg || undefined }));
      case "/tasks":
        return sendView(deps, chatId, tasksView(chatId, tz));
      case "/reminders":
        return sendView(deps, chatId, remindersView(chatId, tz));
      case "/new":
        clearHistory(chatId);
        clearLearnSession(chatId);
        await deps.tg.sendText(chatId, "Начинаем с чистого листа. Заметки, задачи и напоминания на месте.");
        return;
      case "/learn":
      case "/es":
        return sendView(deps, chatId, learnMenuView(chatId), true);
      case "/stop": {
        const session = getLearnSession(chatId);
        const lctx = learnCtx(deps, chatId, tz);
        if (session?.kind === "talk") await endTalk(lctx, session);
        else if (session?.kind === "lesson") await quitLesson(lctx, session);
        else {
          clearLearnSession(chatId);
          await deps.tg.sendText(chatId, "Активного урока или разговора нет.");
        }
        return;
      }
      case "/id":
        await deps.tg.sendText(chatId, `Твой Telegram ID: ${m.userId}\nЧат: ${chatId}`);
        return;
      case "/tz":
        if (!arg) {
          await deps.tg.sendText(chatId, `Сейчас ${tz}, время ${nowIn(tz).toFormat("HH:mm")}. Сменить: /tz Europe/Moscow`);
          return;
        }
        if (!isValidZone(arg)) {
          await deps.tg.sendText(chatId, `Не знаю зону «${arg}». Пример: /tz Asia/Almaty`);
          return;
        }
        setChatTz(chatId, arg);
        await deps.tg.sendText(chatId, `Часовой пояс: ${arg}, сейчас ${nowIn(arg).toFormat("HH:mm")}.`);
        return;
      default:
        break; // неизвестную команду отдаём модели как текст
    }
  }

  // ── кнопки меню ──
  switch (text) {
    case BTN.notes:
      return sendView(deps, chatId, notesView(chatId, tz));
    case BTN.tasks:
      return sendView(deps, chatId, tasksView(chatId, tz));
    case BTN.reminders:
      return sendView(deps, chatId, remindersView(chatId, tz));
    case BTN.today:
      return sendView(deps, chatId, agendaView(chatId, tz));
    case BTN.help:
      await deps.tg.sendText(chatId, HELP_TEXT);
      return;
    case BTN.learn:
      return sendView(deps, chatId, learnMenuView(chatId), true);
    case BTN.draw:
      setPendingMode(chatId, "draw");
      await deps.tg.sendText(chatId, "Опиши, что нарисовать: сюжет, стиль, настроение. Для открытки добавь текст надписи — например: «открытка маме, акварель, цветы, надпись: С днём рождения!»");
      return;
    case BTN.diagram:
      setPendingMode(chatId, "diagram");
      await deps.tg.sendText(chatId, "Опиши схему: что из чего состоит и куда идут стрелки. Или пришли ссылку на репозиторий GitHub — покажу его архитектуру.");
      return;
    default:
      break;
  }

  // ── вложения ──
  let userText = text;
  const inline: NonNullable<Parameters<typeof runAgentTurn>[1]["inline"]> = [];
  if (m.voiceFileId) {
    const transcript = await transcribeVoice(deps, m.voiceFileId, m.voiceMime ?? "audio/ogg");
    if (!transcript) {
      await deps.tg.sendText(chatId, "Не разобрал голосовое. Напиши текстом, пожалуйста.");
      return;
    }
    await deps.tg.sendText(chatId, `🎙 <i>${escape(transcript)}</i>`, { html: true });
    userText = [text, transcript].filter(Boolean).join("\n");
  }
  if (m.photoFileId) {
    const file = await deps.tg.downloadFile(m.photoFileId);
    if (file) inline.push({ mimeType: file.contentType.startsWith("image/") ? file.contentType : "image/jpeg", data: file.bytes.toString("base64") });
    if (!userText) userText = "Вот фото.";
  }
  if (m.documentFileId && !m.photoFileId) {
    const mime = m.documentMime ?? "";
    if (mime.startsWith("image/")) {
      const file = await deps.tg.downloadFile(m.documentFileId);
      if (file) inline.push({ mimeType: mime, data: file.bytes.toString("base64") });
    } else if (/^text\/|json|csv|markdown/.test(mime)) {
      const file = await deps.tg.downloadFile(m.documentFileId);
      if (file && file.bytes.length < 200_000) userText = `${userText}\n\n[файл ${m.documentName}]\n${file.bytes.toString("utf8").slice(0, 60_000)}`.trim();
    } else if (mime === "application/pdf") {
      const file = await deps.tg.downloadFile(m.documentFileId);
      if (file && file.bytes.length < 15_000_000) inline.push({ mimeType: "application/pdf", data: file.bytes.toString("base64") });
    } else {
      await deps.tg.sendText(chatId, `Файлы «${mime || "такого типа"}» пока не читаю. Картинки, PDF и текстовые — могу.`);
      return;
    }
    if (!userText) userText = `Файл ${m.documentName ?? ""}`.trim();
  }
  if (!userText && !inline.length) return;

  // Режим обучения: идёт урок/разговор/ввод темы — текст (в т.ч. расшифрованный голос) уходит туда.
  if (userText && hasActiveLearnSession(chatId)) {
    if (await handleLearnText(learnCtx(deps, chatId, tz), userText)) return;
  }
  const card = userText ? parseCardCommand(userText) : null;
  if (card) {
    const r = addCardManually(chatId, card.front, card.back);
    await deps.tg.sendText(chatId, r.created ? `🃏 Карточка добавлена: ${card.front} — ${card.back}. Всего ${r.total}.` : `Такая карточка уже есть (всего ${r.total}).`);
    return;
  }

  const chat = getChat(chatId);
  await runAgentTurn(deps, {
    chatId,
    text: userText,
    inline: inline.length ? inline : undefined,
    incomingPhotoFileId: m.photoFileId,
    ownerName: m.name || chat?.name,
    pendingMode: chat?.pending_mode ?? null,
  });
}

async function transcribeVoice(deps: HandlerDeps, fileId: string, mime: string): Promise<string | null> {
  const file = await deps.tg.downloadFile(fileId);
  if (!file) return null;
  try {
    const text = await simplePrompt(deps.model, "Расшифруй это голосовое сообщение дословно, на языке говорящего. Верни только текст расшифровки, без комментариев и кавычек.", {
      inline: [{ mimeType: mime.includes("ogg") || mime.includes("opus") ? "audio/ogg" : mime, data: file.bytes.toString("base64") }],
      fast: true,
    });
    return text.replace(/^["«»]+|["«»]+$/g, "").trim() || null;
  } catch (e) {
    log.warn("stt", `расшифровка не удалась: ${errMsg(e)}`);
    return null;
  }
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendView(deps: HandlerDeps, chatId: string, view: { text: string; inline: Array<Array<{ text: string; callback_data?: string }>> }, html = false): Promise<void> {
  await deps.tg.sendText(chatId, view.text, { inline: view.inline.filter((r) => r.length), html });
}

function learnCtx(deps: HandlerDeps, chatId: string, tz: string): LearnCtx {
  return { chatId, sender: deps.tg, model: deps.model, tz };
}

async function editView(deps: HandlerDeps, chatId: string, messageId: number, view: { text: string; inline: Array<Array<{ text: string; callback_data?: string }>> }): Promise<void> {
  await deps.tg.editText(chatId, messageId, view.text, { inline: view.inline.filter((r) => r.length) });
}

// ───────────────────────── callback-кнопки ─────────────────────────
async function handleCallback(deps: HandlerDeps, cb: IncomingCallback): Promise<void> {
  const chatId = cb.chatId;
  const tz = chatTz(chatId);
  const [ns, action, a, b] = cb.data.split(":");
  try {
    if (ns === "learn") {
      const r = await handleLearnCallback(learnCtx(deps, chatId, tz), cb.data, cb.messageId);
      await deps.tg.answerCallback(cb.callbackId, r.toast);
      return;
    }
    if (ns === "rem") {
      const id = Number(a);
      const r = getReminder(chatId, id);
      if (!r) {
        await deps.tg.answerCallback(cb.callbackId, "Напоминания уже нет");
        await deps.tg.editButtons(chatId, cb.messageId, null);
        return;
      }
      if (action === "done") {
        if (!r.repeat) deactivateReminder(r.id);
        await deps.tg.answerCallback(cb.callbackId, "Готово ✅");
        await deps.tg.editText(chatId, cb.messageId, `✅ ${r.text}`);
        return;
      }
      if (action === "snooze") {
        const minutes = Number(b) || 10;
        const at = Date.now() + minutes * 60_000;
        if (r.repeat) {
          // Повторяющееся: следующий цикл уже запланирован — отложенный пинг делаем отдельным разовым.
          const { addReminder } = await import("../db/index.ts");
          addReminder(chatId, r.text, at, null);
        } else rescheduleReminder(r.id, at);
        await deps.tg.answerCallback(cb.callbackId, `Напомню ${formatDateTime(at, tz)}`);
        await deps.tg.editText(chatId, cb.messageId, `⏰ ${r.text}\n↪ отложено: ${formatDateTime(at, tz)}`);
        return;
      }
      if (action === "tomorrow") {
        const base = nowIn(tz, r.at_utc);
        let at = nowIn(tz).plus({ days: 1 }).set({ hour: base.hour, minute: base.minute, second: 0, millisecond: 0 }).toMillis();
        if (at <= Date.now()) at = nowIn(tz).plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 }).toMillis();
        if (r.repeat) {
          const { addReminder } = await import("../db/index.ts");
          addReminder(chatId, r.text, at, null);
        } else rescheduleReminder(r.id, at);
        await deps.tg.answerCallback(cb.callbackId, `Перенёс на завтра`);
        await deps.tg.editText(chatId, cb.messageId, `⏰ ${r.text}\n↪ перенесено: ${formatDateTime(at, tz)}`);
        return;
      }
      if (action === "cancel") {
        deactivateReminder(r.id);
        await deps.tg.answerCallback(cb.callbackId, "Отменено");
        await editView(deps, chatId, cb.messageId, remindersView(chatId, tz));
        return;
      }
    }
    if (ns === "task") {
      if (action === "list") {
        const parentId = Number(a) || null;
        await deps.tg.answerCallback(cb.callbackId);
        await editView(deps, chatId, cb.messageId, tasksView(chatId, tz, parentId, { includeDone: b === "done" || parentId !== null }));
        return;
      }
      if (action === "toggle") {
        const t = getTask(chatId, Number(a));
        if (!t) {
          await deps.tg.answerCallback(cb.callbackId, "Задачи уже нет");
          return;
        }
        setTaskDone(chatId, t.id, !t.done);
        await deps.tg.answerCallback(cb.callbackId, t.done ? "Снова открыта" : "Выполнено ✅");
        const parentId = Number(b) || null;
        await editView(deps, chatId, cb.messageId, tasksView(chatId, tz, parentId, { includeDone: parentId !== null }));
        return;
      }
    }
    if (ns === "note") {
      if (action === "list") {
        await deps.tg.answerCallback(cb.callbackId);
        await editView(deps, chatId, cb.messageId, notesView(chatId, tz, { offset: Number(a) || 0 }));
        return;
      }
      if (action === "open") {
        const n = getNote(chatId, Number(a));
        if (!n) {
          await deps.tg.answerCallback(cb.callbackId, "Заметки уже нет");
          return;
        }
        await deps.tg.answerCallback(cb.callbackId);
        if (n.photo_file_id) await deps.tg.sendPhoto(chatId, n.photo_file_id, noteView(n, tz).text, { inline: noteView(n, tz).inline });
        else await editView(deps, chatId, cb.messageId, noteView(n, tz));
        return;
      }
      if (action === "del") {
        deleteNote(chatId, Number(a));
        await deps.tg.answerCallback(cb.callbackId, "Удалено");
        await editView(deps, chatId, cb.messageId, notesView(chatId, tz));
        return;
      }
    }
    if (ns === "agenda") {
      await deps.tg.answerCallback(cb.callbackId);
      await editView(deps, chatId, cb.messageId, agendaView(chatId, tz, Number(action) || 0));
      return;
    }
    await deps.tg.answerCallback(cb.callbackId);
  } catch (e) {
    log.warn("cb", `${cb.data}: ${errMsg(e)}`);
    await deps.tg.answerCallback(cb.callbackId, "Не получилось, попробуй ещё раз");
  }
}
