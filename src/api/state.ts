/** Публичный адрес API (через туннель) — читают кнопка меню и клавиатура с Mini App. */
let publicApiUrl: string | null = null;

export function setPublicApiUrl(url: string | null): void {
  publicApiUrl = url ? url.replace(/\/$/, "") : null;
}

export function getPublicApiUrl(): string | null {
  return process.env.PUBLIC_API_URL?.trim() || publicApiUrl;
}
