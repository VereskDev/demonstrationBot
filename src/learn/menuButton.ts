/**
 * Кнопка меню бота (слева от поля ввода, как «Open» у BotFather) открывает Mini App с текущей
 * колодой к повторению. URL кнопки обновляется, когда колода меняется — Telegram хранит кнопку
 * на стороне чата, и бот её просто перезаписывает (setChatMenuButton).
 */
import { config } from "../config.ts";
import { log, errMsg } from "../runtime/log.ts";
import type { TelegramApi } from "../telegram/api.ts";
import { dueCards, reviewCard } from "./cards.ts";
import { encodeDeck, parseStartResults } from "./cardsGen.ts";
import { createAppDeck, getAppDeck, getLearnSettings } from "./store.ts";

const APP_DECK_LIMIT = 20;
const lastSignature = new Map<string, string>();

export async function refreshMenuButton(tg: TelegramApi, chatId: string, botUsername: string, force = false): Promise<void> {
  if (!config.webappUrl || !botUsername) return;
  try {
    const due = dueCards(chatId, Date.now(), APP_DECK_LIMIT);
    const sig = due.map((c) => `${c.id}:${c.box}`).join(",");
    if (!force && lastSignature.get(chatId) === sig) return;
    const s = getLearnSettings(chatId);
    const deckId = due.length ? createAppDeck(chatId, due.map((c) => c.id)) : undefined;
    const url = `${config.webappUrl.replace(/\/?$/, "/")}#d=${encodeDeck(due, s.lang, { deckId, bot: botUsername, menu: true })}`;
    const text = due.length ? `🃏 Карточки (${due.length})` : "🃏 Карточки";
    const res = await tg.call("setChatMenuButton", { chat_id: Number(chatId), menu_button: { type: "web_app", text, web_app: { url } } });
    if (!res.ok) {
      log.warn("menu", `setChatMenuButton: ${res.error_code} ${res.description} (url ${url.length} зн.)`);
      return;
    }
    lastSignature.set(chatId, sig);
    log.info("menu", `кнопка меню обновлена: ${text}, url ${url.length} зн.`);
  } catch (e) {
    log.warn("menu", `кнопка меню: ${errMsg(e)}`);
  }
}

/** /start cr_… из Mini App, открытого кнопкой меню → оценки карточек. */
export function applyStartResults(chatId: string, payload: string): { known: number; unknown: number } | null {
  const parsed = parseStartResults(payload);
  if (!parsed) return null;
  const deck = getAppDeck(parsed.deckId);
  if (!deck || deck.chatId !== chatId) return null;
  let known = 0;
  let unknown = 0;
  deck.cardIds.forEach((id, idx) => {
    if (!parsed.answered[idx]) return;
    const ok = Boolean(parsed.ok[idx]);
    if (!reviewCard(chatId, id, ok)) return;
    if (ok) known += 1;
    else unknown += 1;
  });
  return { known, unknown };
}
