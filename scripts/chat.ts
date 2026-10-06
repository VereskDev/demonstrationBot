/**
 * Консольный чат с агентом без Telegram — для проверки движка. Файлы складываются в data/out.
 *   npm run chat              — интерактивно
 *   npm run chat -- "текст"   — один ход и выход (можно несколько аргументов — несколько ходов)
 * База — отдельная (data/chat-cli.sqlite), чтобы не мешать настоящей.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { runAgentTurn } from "../src/agent/agent.ts";
import { config } from "../src/config.ts";
import { ensureChat } from "../src/db/index.ts";
import { GeminiModelTransport } from "../src/llm/gemini.ts";
import type { InlineButton, SendOptions, Sender, SentMessage } from "../src/telegram/sender.ts";
import { buildToolset } from "../src/tools/registry.ts";
import { startReminderScheduler } from "../src/scheduler/reminders.ts";

process.env.ASSISTANT_DB_PATH ??= path.join(config.dataDir, "chat-cli.sqlite");
fs.mkdirSync(path.join(config.dataDir, "out"), { recursive: true });

class ConsoleSender implements Sender {
  private n = 0;
  async sendText(_chatId: string, text: string, opts?: SendOptions): Promise<SentMessage | null> {
    console.log(`\n🤖 ${text}`);
    if (opts?.inline?.length) console.log(`   кнопки: ${opts.inline.map((r: InlineButton[]) => r.map((b) => `[${b.text}]`).join(" ")).join(" | ")}`);
    return { messageId: ++this.n };
  }
  async sendPhoto(_chatId: string, photo: Buffer | string, caption?: string, opts?: { fileName?: string }): Promise<SentMessage | null> {
    const file = path.join(config.dataDir, "out", `${Date.now()}-${opts?.fileName ?? "photo.png"}`);
    if (Buffer.isBuffer(photo)) fs.writeFileSync(file, photo);
    console.log(`\n🖼 фото → ${Buffer.isBuffer(photo) ? file : photo}${caption ? `\n   ${caption}` : ""}`);
    return { messageId: ++this.n };
  }
  async sendDocument(_chatId: string, doc: Buffer | string, fileName: string, caption?: string): Promise<SentMessage | null> {
    const file = path.join(config.dataDir, "out", `${Date.now()}-${fileName}`);
    if (Buffer.isBuffer(doc)) fs.writeFileSync(file, doc);
    console.log(`\n📎 файл → ${Buffer.isBuffer(doc) ? file : doc}${caption ? `\n   ${caption}` : ""}`);
    return { messageId: ++this.n };
  }
  async typing(): Promise<void> {}
  async editText(_c: string, _m: number, text: string): Promise<void> {
    console.log(`\n✏️ ${text}`);
  }
  async editButtons(): Promise<void> {}
}

const chatId = "cli";
ensureChat(chatId, "cli", "Дима");
const sender = new ConsoleSender();
const deps = { model: new GeminiModelTransport(), tools: buildToolset(), sender };
const scheduler = startReminderScheduler(sender, 5_000);

async function turn(text: string): Promise<void> {
  const t0 = Date.now();
  const r = await runAgentTurn(deps, { chatId, text, ownerName: "Дима" });
  console.log(`   (${r.ms}мс, инструменты: ${r.toolNames.join(", ") || "—"})`);
  void t0;
}

const args = process.argv.slice(2).filter((a) => a !== "--");
if (args.length) {
  for (const a of args) {
    console.log(`\n👤 ${a}`);
    await turn(a);
  }
  scheduler.stop();
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log("Чат с помощником (Ctrl+C — выход). База: " + process.env.ASSISTANT_DB_PATH);
const ask = (): void => {
  rl.question("\n👤 ", async (line) => {
    const text = line.trim();
    if (text) await turn(text).catch((e) => console.error("ошибка:", e));
    ask();
  });
};
ask();
