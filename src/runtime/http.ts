/**
 * fetch-обёртка (перенесена из движка Айман, runtime/http.ts). Один интерфейс для Telegram,
 * Gemini, Cloudflare и прочих HTTP: JSON туда-обратно, multipart для файлов, таймаут,
 * понятная ошибка со статусом.
 */
export interface HttpRequestOptions {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  /** Тело: объект (сериализуется JSON), строка или FormData. */
  body?: unknown;
  qs?: Record<string, string | number | boolean | undefined>;
  /** true → тело кодируется/парсится как JSON (по умолчанию ответ всё равно пробуем разобрать как JSON). */
  json?: boolean;
  /** Таймаут в мс. */
  timeout?: number;
  /** true → вернуть { statusCode, headers, body } вместо тела. */
  returnFullResponse?: boolean;
  /** true → не бросать исключение на не-2xx. */
  ignoreHttpStatusErrors?: boolean;
}

export interface FullHttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

export class HttpRequestError extends Error {
  statusCode: number;
  body: unknown;
  constructor(message: string, statusCode: number, body: unknown) {
    super(message);
    this.name = "HttpRequestError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

function buildUrl(url: string, qs?: HttpRequestOptions["qs"]): string {
  if (!qs) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(qs)) {
    if (v === undefined) continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

export async function httpRequest(opts: HttpRequestOptions): Promise<unknown> {
  const method = (opts.method ?? "GET").toUpperCase();
  const url = buildUrl(opts.url, opts.qs);
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };

  let bodyInit: RequestInit["body"];
  if (opts.body !== undefined && method !== "GET" && method !== "HEAD") {
    if (typeof FormData !== "undefined" && opts.body instanceof FormData) {
      // multipart: boundary ставит сам fetch, Content-Type не трогаем.
      bodyInit = opts.body;
    } else if (opts.json || typeof opts.body === "object") {
      if (!headers["Content-Type"] && !headers["content-type"]) headers["Content-Type"] = "application/json";
      bodyInit = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
    } else {
      bodyInit = String(opts.body);
    }
  }

  const controller = new AbortController();
  const timeoutMs = opts.timeout ?? 60_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: bodyInit, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : String(err);
    throw new HttpRequestError(`request failed: ${message}`, 0, null);
  }
  clearTimeout(timer);

  const rawText = await res.text();
  let parsed: unknown = rawText;
  if (opts.json !== false) {
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      parsed = rawText;
    }
  }

  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  if (!res.ok && !opts.ignoreHttpStatusErrors) {
    const preview = typeof parsed === "string" ? parsed.slice(0, 500) : JSON.stringify(parsed).slice(0, 500);
    throw new HttpRequestError(`HTTP ${res.status} for ${method} ${url.replace(/\/bot[^/]+\//, "/bot<token>/")}: ${preview}`, res.status, parsed);
  }

  if (opts.returnFullResponse) return { statusCode: res.status, headers: responseHeaders, body: parsed } satisfies FullHttpResponse;
  return parsed;
}

export type HttpRequestFn = typeof httpRequest;

/** Скачать бинарь (файлы Telegram, картинки). null — не вышло. */
export async function httpBinary(url: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<{ bytes: Buffer; contentType: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return { bytes, contentType: res.headers.get("content-type") ?? "application/octet-stream" };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
