/**
 * Telegram update → плоское входящее сообщение (порт stages/telegramNormalize.ts из Айман,
 * без продуктовых deep-link'ов). Только личные чаты.
 */
export interface IncomingMessage {
  kind: "message";
  chatId: string;
  userId: string;
  messageId: number;
  name: string;
  username: string;
  text: string;
  voiceFileId?: string;
  voiceMime?: string;
  photoFileId?: string;
  documentFileId?: string;
  documentMime?: string;
  documentName?: string;
  /** Данные из Mini App (Telegram.WebApp.sendData). */
  webAppData?: string;
  isCommand: boolean;
  date: number;
}

export interface IncomingCallback {
  kind: "callback";
  callbackId: string;
  chatId: string;
  userId: string;
  messageId: number;
  data: string;
  name: string;
}

export type Incoming = IncomingMessage | IncomingCallback | { kind: "skip"; reason: string };

type Json = Record<string, unknown>;

export function normalizeUpdate(update: Json): Incoming {
  const cq = update.callback_query as Json | undefined;
  if (cq) {
    const msg = (cq.message ?? {}) as Json;
    const chat = (msg.chat ?? {}) as Json;
    const from = (cq.from ?? {}) as Json;
    return {
      kind: "callback",
      callbackId: String(cq.id ?? ""),
      chatId: String(chat.id ?? from.id ?? ""),
      userId: String(from.id ?? ""),
      messageId: Number(msg.message_id ?? 0),
      data: String(cq.data ?? ""),
      name: [from.first_name, from.last_name].filter(Boolean).join(" "),
    };
  }
  const msg = (update.message ?? update.edited_message) as Json | undefined;
  if (!msg || !msg.chat) return { kind: "skip", reason: "no_message" };
  const chat = msg.chat as Json;
  if (String(chat.type ?? "") !== "private") return { kind: "skip", reason: "not_private" };
  const from = (msg.from ?? {}) as Json;
  const text = String(msg.text ?? msg.caption ?? "").trim();
  const voice = (msg.voice ?? msg.audio) as Json | undefined;
  const photos = Array.isArray(msg.photo) ? (msg.photo as Json[]) : [];
  const doc = msg.document as Json | undefined;
  const photoFileId = photos.length ? String(photos[photos.length - 1]?.file_id ?? "") : "";
  const webApp = msg.web_app_data as Json | undefined;
  const webAppData = webApp && typeof webApp.data === "string" ? webApp.data : undefined;
  if (!text && !voice && !photoFileId && !doc && !webAppData) return { kind: "skip", reason: "no_content" };
  return {
    kind: "message",
    chatId: String(chat.id),
    userId: String(from.id ?? ""),
    messageId: Number(msg.message_id ?? 0),
    name: [from.first_name, from.last_name].filter(Boolean).join(" ").trim(),
    username: String(from.username ?? ""),
    text,
    voiceFileId: voice ? String(voice.file_id ?? "") : undefined,
    voiceMime: voice ? String(voice.mime_type ?? "audio/ogg") : undefined,
    photoFileId: photoFileId || undefined,
    documentFileId: doc ? String(doc.file_id ?? "") : undefined,
    documentMime: doc ? String(doc.mime_type ?? "") : undefined,
    documentName: doc ? String(doc.file_name ?? "") : undefined,
    webAppData,
    isCommand: /^\/\w+/.test(text),
    date: Number(msg.date ?? 0) * 1000 || Date.now(),
  };
}
