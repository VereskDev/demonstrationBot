/**
 * Озвучка для уроков. Основной путь — Google Translate TTS (MP3, без ключа; Telegram принимает
 * MP3 как голосовое). Запасной — Gemini TTS (WAV; уйдёт как аудиофайл). Ничего не вышло — null,
 * урок идёт без звука.
 */
import crypto from "node:crypto";
import { config } from "../config.ts";
import { httpBinary, httpRequest } from "../runtime/http.ts";
import { log, errMsg } from "../runtime/log.ts";

export interface Speech {
  bytes: Buffer;
  mime: "audio/mpeg" | "audio/wav";
}

const cache = new Map<string, Speech>();
const CACHE_MAX = 300;

function remember(key: string, s: Speech): Speech {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, s);
  return s;
}

/** Нарезка под лимит gtts (~200 символов на запрос) по предложениям и запятым. */
export function chunkForTts(text: string, max = 180): string[] {
  const clean = String(text).replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];
  const out: string[] = [];
  let buf = "";
  for (const piece of clean.split(/(?<=[.!?¡¿…;])\s+|(?<=,)\s+/)) {
    if (!piece) continue;
    if ((buf + " " + piece).trim().length > max) {
      if (buf) out.push(buf.trim());
      buf = piece;
      while (buf.length > max) {
        out.push(buf.slice(0, max));
        buf = buf.slice(max);
      }
    } else buf = (buf ? buf + " " : "") + piece;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

async function googleTts(text: string, lang: string): Promise<Buffer | null> {
  const parts: Buffer[] = [];
  for (const chunk of chunkForTts(text)) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(lang)}&client=tw-ob&q=${encodeURIComponent(chunk)}`;
    const bin = await httpBinary(url, { headers: { "User-Agent": "Mozilla/5.0" } }, 20_000);
    if (!bin || !bin.contentType.startsWith("audio/")) return null;
    parts.push(bin.bytes);
  }
  return parts.length ? Buffer.concat(parts) : null;
}

async function geminiTts(text: string): Promise<Buffer | null> {
  if (!config.geminiApiKey) return null;
  const res = (await httpRequest({
    method: "POST",
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-lite-tts:generateContent",
    headers: { "Content-Type": "application/json", "x-goog-api-key": config.geminiApiKey },
    body: {
      contents: [{ parts: [{ text }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } } },
    },
    json: true,
    timeout: 60_000,
    ignoreHttpStatusErrors: true,
  })) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }> };
  const d = res?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!d?.data || !/wav/i.test(d.mimeType ?? "")) return null;
  return Buffer.from(d.data, "base64");
}

export async function synthesize(text: string, lang = "es"): Promise<Speech | null> {
  const clean = String(text).trim();
  if (!clean || process.env.LEARN_TTS === "off") return null;
  const key = crypto.createHash("sha1").update(`${lang}|${clean}`).digest("hex");
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const mp3 = await googleTts(clean, lang);
    if (mp3) return remember(key, { bytes: mp3, mime: "audio/mpeg" });
  } catch (e) {
    log.warn("tts", `google tts: ${errMsg(e)}`);
  }
  try {
    const wav = await geminiTts(clean);
    if (wav) return remember(key, { bytes: wav, mime: "audio/wav" });
  } catch (e) {
    log.warn("tts", `gemini tts: ${errMsg(e)}`);
  }
  return null;
}

/** Текст реплики для озвучки: без русских подсказок в скобках и без markdown. */
export function speakablePart(text: string): string {
  return String(text)
    .replace(/\([^)]*[А-Яа-яЁё][^)]*\)/g, " ")
    .replace(/\[[^\]]*[А-Яа-яЁё][^\]]*\]/g, " ")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
