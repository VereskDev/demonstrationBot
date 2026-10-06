/**
 * Тонкий клиент Telegram Bot API поверх runtime/http.ts (по образцу отправок из движка Айман:
 * pipeline.ts telegramSend/sendCards, yandexStt.ts downloadTelegramFile). Текст — HTML; если
 * Telegram не принял разметку (400) — повтор простым текстом, сообщение не теряется.
 */
import { config } from "../config.ts";
import { httpRequest, httpBinary } from "../runtime/http.ts";
import { log, errMsg } from "../runtime/log.ts";
import { splitForChannel, toTelegramHtml, TELEGRAM_CAPTION_LIMIT, TELEGRAM_TEXT_LIMIT, capText } from "./format.ts";
import type { InlineButton, SendOptions, Sender, SentMessage } from "./sender.ts";

type TgResponse<T = unknown> = { ok: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } };

export class TelegramApi implements Sender {
  constructor(private readonly token: string = config.telegramToken) {}

  private url(method: string): string {
    return `https://api.telegram.org/bot${this.token}/${method}`;
  }

  async call<T = unknown>(method: string, body?: Record<string, unknown> | FormData, timeout = 30_000): Promise<TgResponse<T>> {
    const res = (await httpRequest({
      method: "POST",
      url: this.url(method),
      body: body ?? {},
      json: true,
      timeout,
      returnFullResponse: true,
      ignoreHttpStatusErrors: true,
    })) as { statusCode: number; body: TgResponse<T> | string };
    const b = res.body;
    if (b && typeof b === "object") return b as TgResponse<T>;
    return { ok: false, description: `HTTP ${res.statusCode}: ${String(b).slice(0, 200)}`, error_code: res.statusCode };
  }

  private markup(opts?: SendOptions): Record<string, unknown> | undefined {
    if (!opts) return undefined;
    if (opts.inline) {
      return {
        inline_keyboard: opts.inline.map((row) =>
          row.map((b: InlineButton) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.callback_data ?? "noop" })),
        ),
      };
    }
    if (opts.keyboard) {
      return {
        keyboard: opts.keyboard.map((row) => row.map((b) => (typeof b === "string" ? { text: b } : b.web_app ? { text: b.text, web_app: { url: b.web_app.url } } : { text: b.text }))),
        resize_keyboard: true,
        is_persistent: !opts.oneTime,
        one_time_keyboard: Boolean(opts.oneTime),
      };
    }
    return undefined;
  }

  async sendText(chatId: string, text: string, opts: SendOptions = {}): Promise<SentMessage | null> {
    const chunks = splitForChannel(text, TELEGRAM_TEXT_LIMIT - 200);
    let last: SentMessage | null = null;
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const html = opts.html ? chunks[i] : toTelegramHtml(chunks[i]);
      const base: Record<string, unknown> = {
        chat_id: chatId,
        text: html,
        parse_mode: "HTML",
        disable_web_page_preview: opts.noPreview !== false,
        ...(isLast && this.markup(opts) ? { reply_markup: this.markup(opts) } : {}),
        ...(opts.replyTo && i === 0 ? { reply_parameters: { message_id: opts.replyTo, allow_sending_without_reply: true } } : {}),
      };
      let res = await this.call<{ message_id: number }>("sendMessage", base);
      if (!res.ok && res.error_code === 400 && /parse|entit|tag/i.test(res.description ?? "")) {
        const plain: Record<string, unknown> = { ...base, text: chunks[i] };
        delete plain.parse_mode;
        res = await this.call<{ message_id: number }>("sendMessage", plain);
      }
      if (!res.ok) {
        log.warn("tg", `sendMessage не прошёл: ${res.error_code} ${res.description}`);
        if (res.parameters?.retry_after) await new Promise((r) => setTimeout(r, res.parameters!.retry_after! * 1000));
        continue;
      }
      last = { messageId: res.result!.message_id };
    }
    return last;
  }

  async sendPhoto(chatId: string, photo: Buffer | string, caption = "", opts: SendOptions & { fileName?: string } = {}): Promise<SentMessage | null> {
    const form = new FormData();
    form.append("chat_id", chatId);
    if (caption) {
      form.append("caption", toTelegramHtml(capText(caption, TELEGRAM_CAPTION_LIMIT)));
      form.append("parse_mode", "HTML");
    }
    const markup = this.markup(opts);
    if (markup) form.append("reply_markup", JSON.stringify(markup));
    if (Buffer.isBuffer(photo)) form.append("photo", new Blob([new Uint8Array(photo)], { type: "image/png" }), opts.fileName ?? "image.png");
    else form.append("photo", photo);
    const res = await this.call<{ message_id: number }>("sendPhoto", form, 120_000);
    if (!res.ok) {
      log.warn("tg", `sendPhoto не прошёл: ${res.error_code} ${res.description}`);
      return null;
    }
    return { messageId: res.result!.message_id };
  }

  async sendDocument(chatId: string, doc: Buffer | string, fileName: string, caption = "", opts: SendOptions & { mime?: string } = {}): Promise<SentMessage | null> {
    const form = new FormData();
    form.append("chat_id", chatId);
    if (caption) {
      form.append("caption", toTelegramHtml(capText(caption, TELEGRAM_CAPTION_LIMIT)));
      form.append("parse_mode", "HTML");
    }
    const markup = this.markup(opts);
    if (markup) form.append("reply_markup", JSON.stringify(markup));
    if (Buffer.isBuffer(doc)) form.append("document", new Blob([new Uint8Array(doc)], { type: opts.mime ?? "application/octet-stream" }), fileName);
    else form.append("document", doc);
    const res = await this.call<{ message_id: number }>("sendDocument", form, 120_000);
    if (!res.ok) {
      log.warn("tg", `sendDocument не прошёл: ${res.error_code} ${res.description}`);
      return null;
    }
    return { messageId: res.result!.message_id };
  }

  async sendVoice(chatId: string, audio: Buffer, opts: SendOptions & { mime?: string; caption?: string; fileName?: string } = {}): Promise<SentMessage | null> {
    const mime = opts.mime ?? "audio/mpeg";
    const isVoiceable = /mpeg|mp3|ogg|opus|m4a|mp4/.test(mime);
    const build = (field: string, name: string) => {
      const form = new FormData();
      form.append("chat_id", chatId);
      if (opts.caption) {
        form.append("caption", toTelegramHtml(capText(opts.caption, TELEGRAM_CAPTION_LIMIT)));
        form.append("parse_mode", "HTML");
      }
      const markup = this.markup(opts);
      if (markup) form.append("reply_markup", JSON.stringify(markup));
      form.append(field, new Blob([new Uint8Array(audio)], { type: mime }), name);
      return form;
    };
    const ext = mime.includes("wav") ? "wav" : mime.includes("ogg") ? "ogg" : "mp3";
    const name = opts.fileName ?? `audio.${ext}`;
    const attempts: Array<[string, string]> = isVoiceable ? [["sendVoice", "voice"], ["sendAudio", "audio"], ["sendDocument", "document"]] : [["sendAudio", "audio"], ["sendDocument", "document"]];
    for (const [method, field] of attempts) {
      const res = await this.call<{ message_id: number }>(method, build(field, name), 120_000);
      if (res.ok) return { messageId: res.result!.message_id };
      log.warn("tg", `${method} не прошёл: ${res.error_code} ${res.description}`);
    }
    return null;
  }

  async typing(chatId: string, action: "typing" | "upload_photo" | "upload_document" | "record_voice" | "upload_voice" = "typing"): Promise<void> {
    await this.call("sendChatAction", { chat_id: chatId, action }, 5_000).catch(() => {});
  }

  async editText(chatId: string, messageId: number, text: string, opts: SendOptions = {}): Promise<void> {
    const res = await this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: opts.html ? text : toTelegramHtml(text),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(this.markup(opts) ? { reply_markup: this.markup(opts) } : {}),
    });
    if (!res.ok && !/not modified/i.test(res.description ?? "")) log.warn("tg", `editMessageText: ${res.description}`);
  }

  async editButtons(chatId: string, messageId: number, inline: InlineButton[][] | null): Promise<void> {
    const res = await this.call("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: inline ? this.markup({ inline }) : { inline_keyboard: [] },
    });
    if (!res.ok && !/not modified/i.test(res.description ?? "")) log.warn("tg", `editMessageReplyMarkup: ${res.description}`);
  }

  async answerCallback(callbackId: string, text?: string, alert = false): Promise<void> {
    await this.call("answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text, show_alert: alert } : {}) }, 5_000).catch(() => {});
  }

  async setCommands(commands: Array<{ command: string; description: string }>): Promise<void> {
    const res = await this.call("setMyCommands", { commands });
    if (!res.ok) log.warn("tg", `setMyCommands: ${res.description}`);
  }

  async deleteWebhook(): Promise<void> {
    await this.call("deleteWebhook", { drop_pending_updates: false }).catch(() => {});
  }

  async getMe(): Promise<{ id: number; username?: string; first_name?: string } | null> {
    const res = await this.call<{ id: number; username?: string; first_name?: string }>("getMe");
    return res.ok ? res.result! : null;
  }

  async getUpdates(offset: number, timeoutSec = 50): Promise<Array<Record<string, unknown>>> {
    const res = await this.call<Array<Record<string, unknown>>>(
      "getUpdates",
      { offset, timeout: timeoutSec, allowed_updates: ["message", "callback_query"] },
      (timeoutSec + 15) * 1000,
    );
    if (!res.ok) throw new Error(`getUpdates: ${res.error_code} ${res.description}`);
    return res.result ?? [];
  }

  /** Скачать файл по file_id: getFile → бинарь. */
  async downloadFile(fileId: string): Promise<{ bytes: Buffer; contentType: string; path: string } | null> {
    try {
      const info = await this.call<{ file_path?: string }>("getFile", { file_id: fileId });
      const filePath = info.result?.file_path;
      if (!filePath) return null;
      const bin = await httpBinary(`https://api.telegram.org/file/bot${this.token}/${filePath}`, {}, 60_000);
      if (!bin) return null;
      return { ...bin, path: filePath };
    } catch (e) {
      log.warn("tg", `downloadFile: ${errMsg(e)}`);
      return null;
    }
  }
}
