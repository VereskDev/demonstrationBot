/**
 * Long polling getUpdates. Каждое обновление — в очередь своего чата (withChatQueue) и под
 * счётчик живых ходов (track), чтобы остановка дождалась ответов.
 */
import { withChatQueue } from "../runtime/chatQueue.ts";
import { isDraining, track } from "../runtime/inflight.ts";
import { log, errMsg } from "../runtime/log.ts";
import type { TelegramApi } from "./api.ts";

export function startPolling(tg: TelegramApi, onUpdate: (u: Record<string, unknown>) => Promise<void>): { stop: () => void } {
  let stopped = false;
  let offset = 0;
  const loop = async (): Promise<void> => {
    let failures = 0;
    while (!stopped && !isDraining()) {
      try {
        const updates = await tg.getUpdates(offset, 50);
        failures = 0;
        for (const u of updates) {
          const id = Number(u.update_id ?? 0);
          if (id >= offset) offset = id + 1;
          const chatId = String(
            ((u.message ?? u.edited_message) as { chat?: { id?: unknown } } | undefined)?.chat?.id ??
              ((u.callback_query as { message?: { chat?: { id?: unknown } } } | undefined)?.message?.chat?.id ?? "x"),
          );
          void track(
            withChatQueue(chatId, () =>
              onUpdate(u).catch((e) => {
                log.error("poll", `обработка update ${id} упала: ${errMsg(e)}`);
              }),
            ),
          );
        }
      } catch (e) {
        failures += 1;
        const msg = errMsg(e);
        if (/409/.test(msg)) {
          log.warn("poll", "409: кто-то ещё читает getUpdates (второй процесс или вебхук) — снимаю вебхук и жду 5 с");
          await tg.deleteWebhook();
        } else log.warn("poll", `getUpdates: ${msg}`);
        await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * failures)));
      }
    }
  };
  void loop();
  return { stop: () => (stopped = true) };
}
