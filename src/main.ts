/**
 * Точка входа: Telegram long polling + планировщик напоминаний + graceful shutdown.
 *   npm start
 */
import { assertConfig, config } from "./config.ts";
import { createApiServer } from "./api/server.ts";
import { setPublicApiUrl } from "./api/state.ts";
import { startTunnel, type TunnelHandle } from "./api/tunnel.ts";
import { getDb, listChats } from "./db/index.ts";
import { refreshMenuButton } from "./learn/menuButton.ts";
import { GeminiModelTransport } from "./llm/gemini.ts";
import { installGracefulShutdown } from "./runtime/inflight.ts";
import { log } from "./runtime/log.ts";
import { startReminderScheduler } from "./scheduler/reminders.ts";
import { TelegramApi } from "./telegram/api.ts";
import { handleUpdate } from "./telegram/handlers.ts";
import { BOT_COMMANDS } from "./telegram/keyboards.ts";
import { startPolling } from "./telegram/polling.ts";
import { buildToolset } from "./tools/registry.ts";

async function main(): Promise<void> {
  assertConfig();
  getDb();
  const tg = new TelegramApi();
  const me = await tg.getMe();
  if (!me) throw new Error("Telegram не отвечает на getMe — проверь TELEGRAM_BOT_TOKEN и сеть");
  await tg.deleteWebhook();
  await tg.setCommands(BOT_COMMANDS);

  const model = new GeminiModelTransport();
  const deps = { tg, sender: tg, model, tools: buildToolset(), botUsername: me.username ?? "" };
  const scheduler = startReminderScheduler(tg, config.schedulerTickMs);
  const polling = startPolling(tg, (u) => handleUpdate(deps, u));

  // API для Mini App + публичный туннель. Кнопка меню получает адрес, как только туннель поднялся.
  const refreshAll = (force: boolean) => {
    if (deps.botUsername) for (const chat of listChats()) void refreshMenuButton(tg, chat.chat_id, deps.botUsername, force);
  };
  let api: ReturnType<typeof createApiServer> | null = null;
  let tunnel: TunnelHandle | null = null;
  if (config.apiPort > 0) {
    api = createApiServer({ sender: tg, model });
    api.listen(config.apiPort, "127.0.0.1", () => log.info("api", `слушаю http://127.0.0.1:${config.apiPort}`));
    if (config.tunnel !== "off" && !process.env.PUBLIC_API_URL) {
      tunnel = startTunnel(`http://127.0.0.1:${config.apiPort}`);
      tunnel.onUrl((url) => {
        setPublicApiUrl(url);
        refreshAll(true);
      });
    }
  }
  refreshAll(true);

  installGracefulShutdown(config.shutdownGraceMs, () => {
    polling.stop();
    scheduler.stop();
    tunnel?.stop();
    api?.close();
  });

  log.info("main", `бот @${me.username} запущен; модель ${config.geminiModel} (+${config.geminiFastModel}), зона по умолчанию ${config.defaultTimezone}, данные ${config.dataDir}`);
  if (!config.ownerId) log.info("main", "OWNER_TELEGRAM_ID не задан — владельцем станет первый, кто напишет боту");
}

main().catch((e) => {
  log.error("main", e instanceof Error ? e.stack || e.message : String(e));
  process.exit(1);
});
