/**
 * Точка входа: Telegram long polling + планировщик напоминаний + graceful shutdown.
 *   npm start
 */
import { assertConfig, config } from "./config.ts";
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

  const deps = { tg, sender: tg, model: new GeminiModelTransport(), tools: buildToolset(), botUsername: me.username ?? "" };
  const scheduler = startReminderScheduler(tg, config.schedulerTickMs);
  const polling = startPolling(tg, (u) => handleUpdate(deps, u));
  // Кнопка меню с Mini App — актуальная колода для каждого известного чата (владельца).
  if (deps.botUsername) for (const chat of listChats()) void refreshMenuButton(tg, chat.chat_id, deps.botUsername, true);

  installGracefulShutdown(config.shutdownGraceMs, () => {
    polling.stop();
    scheduler.stop();
  });

  log.info("main", `бот @${me.username} запущен; модель ${config.geminiModel} (+${config.geminiFastModel}), зона по умолчанию ${config.defaultTimezone}, данные ${config.dataDir}`);
  if (!config.ownerId) log.info("main", "OWNER_TELEGRAM_ID не задан — владельцем станет первый, кто напишет боту");
}

main().catch((e) => {
  log.error("main", e instanceof Error ? e.stack || e.message : String(e));
  process.exit(1);
});
