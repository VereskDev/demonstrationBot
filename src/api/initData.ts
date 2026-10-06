/**
 * Проверка подписи Telegram.WebApp.initData (документация Telegram «Validating data received via
 * the Mini App»): HMAC-SHA256 над отсортированными парами, ключ — HMAC("WebAppData", bot_token).
 * Только так Mini App доказывает, что запрос идёт от владельца, а не от кого угодно из интернета.
 */
import crypto from "node:crypto";

export interface InitDataUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface ValidInitData {
  user: InitDataUser;
  authDate: number;
  raw: URLSearchParams;
}

export function validateInitData(initData: string, botToken: string, maxAgeSec = 86_400, nowSec = Math.floor(Date.now() / 1000)): ValidInitData | null {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  const pairs: string[] = [];
  for (const [k, v] of params.entries()) if (k !== "hash") pairs.push(`${k}=${v}`);
  pairs.sort();
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = crypto.createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || nowSec - authDate > maxAgeSec) return null;
  let user: InitDataUser | null = null;
  try {
    user = JSON.parse(params.get("user") ?? "null") as InitDataUser | null;
  } catch {
    user = null;
  }
  if (!user || typeof user.id !== "number") return null;
  return { user, authDate, raw: params };
}

/** Собрать подписанный initData — для тестов и локальной отладки. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  const pairs: string[] = [];
  for (const [k, v] of params.entries()) pairs.push(`${k}=${v}`);
  pairs.sort();
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  params.set("hash", crypto.createHmac("sha256", secret).update(pairs.join("\n")).digest("hex"));
  return params.toString();
}
