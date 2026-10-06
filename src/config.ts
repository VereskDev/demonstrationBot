/**
 * Конфиг из .env (без зависимостей). Секреты живут только тут и в process.env — в логи и в
 * ответы модели не попадают.
 */
import fs from "node:fs";
import path from "node:path";

function loadDotenv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotenv(path.resolve(process.cwd(), ".env"));

function str(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === null ? fallback : String(v).trim();
}

function num(name: string, fallback: number): number {
  const raw = str(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  telegramToken: str("TELEGRAM_BOT_TOKEN"),
  ownerId: str("OWNER_TELEGRAM_ID"),
  geminiApiKey: str("GEMINI_API_KEY"),
  geminiModel: str("GEMINI_MODEL", "gemini-3.5-flash"),
  geminiFastModel: str("GEMINI_FAST_MODEL", "gemini-3.5-flash-lite"),
  /** Уровень «думания» основной модели: low | high | none. */
  geminiThinking: str("GEMINI_THINKING_LEVEL", "low"),
  /** Через сколько мс без ответа основной модели запускаем дубль на быстрой. 0 — не хеджировать. */
  geminiHedgeMs: num("GEMINI_HEDGE_MS", 3500),
  cfAccountId: str("CF_ACCOUNT_ID"),
  cfApiToken: str("CF_API_TOKEN"),
  imageModel: str("IMAGE_MODEL", "@cf/black-forest-labs/flux-1-schnell"),
  defaultTimezone: str("DEFAULT_TIMEZONE", "Asia/Almaty"),
  dataDir: path.resolve(process.cwd(), str("DATA_DIR", "./data")),
  /** Сколько сообщений истории держим в контексте модели. */
  historyLimit: num("HISTORY_LIMIT", 40),
  /** Период проверки напоминаний, мс. */
  schedulerTickMs: num("SCHEDULER_TICK_MS", 15_000),
  shutdownGraceMs: num("SHUTDOWN_GRACE_MS", 30_000),
};

export function assertConfig(): void {
  const missing: string[] = [];
  if (!config.telegramToken) missing.push("TELEGRAM_BOT_TOKEN");
  if (!config.geminiApiKey) missing.push("GEMINI_API_KEY");
  if (missing.length) throw new Error(`В .env не заданы: ${missing.join(", ")}`);
  fs.mkdirSync(config.dataDir, { recursive: true });
}
