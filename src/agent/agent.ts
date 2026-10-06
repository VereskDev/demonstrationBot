/**
 * Один ход агента: история из БД → системный промпт → цикл инструментов → ответ текстом →
 * файлы из outbox → история обратно в БД. Канал (Telegram или консоль) передаётся как Sender.
 */
import { config } from "../config.ts";
import { chatTz, ensureChat, loadHistory, saveHistory, setPendingMode } from "../db/index.ts";
import { runOrchestrator } from "../llm/loop.ts";
import type { LlmMessage, ModelTransport } from "../llm/types.ts";
import { log, errMsg } from "../runtime/log.ts";
import type { Sender } from "../telegram/sender.ts";
import type { OutboxItem, ToolContext, ToolRegistry } from "../tools/types.ts";
import { buildSystemPrompt } from "./systemPrompt.ts";

export interface AgentDeps {
  model: ModelTransport;
  tools: ToolRegistry;
  sender: Sender;
}

export interface AgentTurnInput {
  chatId: string;
  text: string;
  /** Фото/аудио к сообщению (в историю не сохраняются). */
  inline?: LlmMessage["inline"];
  incomingPhotoFileId?: string;
  ownerName?: string | null;
  pendingMode?: string | null;
}

export interface AgentTurnResult {
  reply: string;
  toolNames: string[];
  ms: number;
}

/** Убрать бинарь из истории, оставив пометку, что он был. */
function stripInline(messages: LlmMessage[]): LlmMessage[] {
  return messages.map((m) => {
    if (!m.inline?.length) return m;
    const kinds = m.inline.map((d) => (d.mimeType.startsWith("image/") ? "фото" : d.mimeType.startsWith("audio/") ? "аудио" : "файл"));
    return { ...m, inline: undefined, text: `[приложено: ${kinds.join(", ")}] ${m.text ?? ""}`.trim() };
  });
}

/** Обрезать историю до лимита, не разрывая пары «вызов → результат» и начиная с реплики пользователя. */
export function trimHistory(history: LlmMessage[], limit: number): LlmMessage[] {
  let h = history.slice(-limit);
  while (h.length && !(h[0].role === "user" && !h[0].toolResults)) h = h.slice(1);
  return h;
}

export async function runAgentTurn(deps: AgentDeps, input: AgentTurnInput): Promise<AgentTurnResult> {
  const t0 = Date.now();
  const chat = ensureChat(input.chatId);
  const tz = chatTz(input.chatId);
  const history = trimHistory(loadHistory<LlmMessage>(input.chatId), config.historyLimit);
  const system = buildSystemPrompt(input.chatId, tz, t0, { ownerName: input.ownerName ?? chat.name, pendingMode: input.pendingMode });
  const outbox: OutboxItem[] = [];
  const toolContext: ToolContext = {
    chatId: input.chatId,
    tz,
    now: t0,
    sender: deps.sender,
    outbox,
    incomingPhotoFileId: input.incomingPhotoFileId,
    changed: new Set(),
  };

  const userMessage: LlmMessage = { role: "user", text: input.text || (input.inline?.length ? "(без текста)" : ""), inline: input.inline };
  const typingTimer = setInterval(() => void deps.sender.typing(input.chatId), 4_000);
  void deps.sender.typing(input.chatId);

  let reply: string;
  let appended: LlmMessage[];
  let toolNames: string[] = [];
  try {
    const result = await runOrchestrator({ system, history, userMessage, model: deps.model, tools: deps.tools, toolContext });
    reply = result.reply;
    appended = result.appended;
    toolNames = result.toolTrace.map((t) => t.name);
  } catch (e) {
    clearInterval(typingTimer);
    log.error("agent", `ход упал: ${errMsg(e)}`);
    const code = Number((e as { statusCode?: number })?.statusCode ?? 0);
    const msg =
      code === 429
        ? "Модель сейчас перегружена (лимит запросов). Подожди минуту и повтори."
        : code === 503
          ? "Сервис модели временно недоступен. Попробуй ещё раз через минуту."
          : "Не получилось обработать — что-то сломалось на моей стороне. Попробуй переформулировать или повторить позже.";
    await deps.sender.sendText(input.chatId, msg);
    return { reply: msg, toolNames, ms: Date.now() - t0 };
  }
  clearInterval(typingTimer);

  if (input.pendingMode) setPendingMode(input.chatId, null);

  // Текст — потом файлы (как в Айман: файл мимо LLM, после реплики).
  if (reply) await deps.sender.sendText(input.chatId, reply);
  for (const item of outbox) {
    try {
      if (item.kind === "photo") {
        const src = item.fileId ?? item.bytes!;
        await deps.sender.sendPhoto(input.chatId, src, item.caption, { fileName: item.fileName });
      } else {
        await deps.sender.sendDocument(input.chatId, item.fileId ?? item.bytes!, item.fileName ?? "file", item.caption, { mime: item.mime });
      }
    } catch (e) {
      log.warn("agent", `не отправил файл: ${errMsg(e)}`);
    }
  }

  saveHistory(input.chatId, trimHistory([...history, ...stripInline(appended)], config.historyLimit * 2));
  log.info("agent", `ход ${Date.now() - t0}мс, инструменты: ${toolNames.join(", ") || "—"}, ответ ${reply.length} зн.`);
  return { reply, toolNames, ms: Date.now() - t0 };
}

/** Записать в историю сообщение, которое бот отправил сам (напоминание сработало). */
export function appendBotEvent(chatId: string, text: string): void {
  const history = loadHistory<LlmMessage>(chatId);
  history.push({ role: "user", text: `[система] ${text}` }, { role: "model", text: "Принято." });
  saveHistory(chatId, trimHistory(history, config.historyLimit * 2));
}
