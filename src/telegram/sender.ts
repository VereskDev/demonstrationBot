/**
 * Что умеет «канал» с точки зрения движка. Реализации: настоящий Telegram (api.ts) и консоль
 * (scripts/chat.ts) — агент и инструменты от конкретного канала не зависят.
 */
export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

/** Кнопка обычной клавиатуры: текст или кнопка, открывающая Mini App. */
export type KeyboardButton = string | { text: string; web_app?: { url: string } };

export interface SendOptions {
  /** Inline-кнопки под сообщением (ряды). */
  inline?: InlineButton[][];
  /** Обычная клавиатура (ряды). */
  keyboard?: KeyboardButton[][];
  /** Спрятать клавиатуру после первого нажатия. */
  oneTime?: boolean;
  /** Отдать HTML как есть (без форматирования markdown-лайт). */
  html?: boolean;
  /** Не показывать превью ссылок. */
  noPreview?: boolean;
  replyTo?: number;
}

export interface SentMessage {
  messageId: number;
}

export interface Sender {
  sendText(chatId: string, text: string, opts?: SendOptions): Promise<SentMessage | null>;
  sendPhoto(chatId: string, photo: Buffer | string, caption?: string, opts?: SendOptions & { fileName?: string }): Promise<SentMessage | null>;
  sendDocument(chatId: string, doc: Buffer | string, fileName: string, caption?: string, opts?: SendOptions & { mime?: string }): Promise<SentMessage | null>;
  /** Голосовое (MP3/OGG) — пузырь с плеером; другие форматы уйдут аудиофайлом. */
  sendVoice(chatId: string, audio: Buffer, opts?: SendOptions & { mime?: string; caption?: string; fileName?: string }): Promise<SentMessage | null>;
  typing(chatId: string, action?: "typing" | "upload_photo" | "upload_document" | "record_voice" | "upload_voice"): Promise<void>;
  editText(chatId: string, messageId: number, text: string, opts?: SendOptions): Promise<void>;
  editButtons(chatId: string, messageId: number, inline: InlineButton[][] | null): Promise<void>;
}
