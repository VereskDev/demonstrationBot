/**
 * Генерация картинок. Основной путь — Cloudflare Workers AI (FLUX; бесплатно 10 000 нейронов в
 * сутки, ≈2000 картинок на flux-1-schnell). Запасной — Pollinations (без ключа, с водяным знаком).
 * Надписи на картинках не просим у нейросети (FLUX не пишет по-русски) — их накладывает card.ts.
 */
import { config } from "../config.ts";
import { httpRequest, httpBinary } from "../runtime/http.ts";
import { log, errMsg } from "../runtime/log.ts";

export type Aspect = "1:1" | "4:5" | "5:4" | "3:4" | "4:3" | "16:9" | "9:16";

export function aspectToSize(aspect: string | undefined): { width: number; height: number; aspect: Aspect } {
  switch (String(aspect ?? "").trim()) {
    case "4:5":
      return { width: 896, height: 1120, aspect: "4:5" };
    case "5:4":
      return { width: 1120, height: 896, aspect: "5:4" };
    case "3:4":
      return { width: 864, height: 1152, aspect: "3:4" };
    case "4:3":
      return { width: 1152, height: 864, aspect: "4:3" };
    case "16:9":
      return { width: 1280, height: 720, aspect: "16:9" };
    case "9:16":
      return { width: 720, height: 1280, aspect: "9:16" };
    default:
      return { width: 1024, height: 1024, aspect: "1:1" };
  }
}

export interface GeneratedImage {
  bytes: Buffer;
  mime: string;
  provider: "cloudflare" | "pollinations";
  model: string;
}

async function cloudflare(prompt: string, width: number, height: number, model = config.imageModel): Promise<GeneratedImage> {
  if (!config.cfAccountId || !config.cfApiToken) throw new Error("Cloudflare не настроен (CF_ACCOUNT_ID / CF_API_TOKEN)");
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.cfAccountId}/ai/run/${model}`;
  const headers = { Authorization: `Bearer ${config.cfApiToken}` };
  const t0 = Date.now();
  let res: unknown;
  if (/flux-1-schnell/.test(model)) {
    // schnell принимает JSON и отдаёт {result:{image:<base64>}}; размеры не задаются (1024²), steps ≤ 8.
    res = await httpRequest({ method: "POST", url, headers: { ...headers, "Content-Type": "application/json" }, body: { prompt, steps: 6 }, json: true, timeout: 120_000 });
  } else {
    const form = new FormData();
    form.append("prompt", prompt);
    form.append("width", String(width));
    form.append("height", String(height));
    res = await httpRequest({ method: "POST", url, headers, body: form, json: true, timeout: 180_000 });
  }
  const r = res as { success?: boolean; result?: { image?: string }; errors?: Array<{ message?: string }> };
  const b64 = r?.result?.image;
  if (!b64) throw new Error(`Cloudflare: нет картинки в ответе (${r?.errors?.map((e) => e.message).join("; ") || "пусто"})`);
  const bytes = Buffer.from(b64, "base64");
  log.info("img", `cloudflare ${model.split("/").pop()} ${Date.now() - t0}мс ${bytes.length}B`);
  // schnell отдаёт JPEG, flux-2 — PNG; определяем по сигнатуре.
  const mime = bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : "image/jpeg";
  return { bytes, mime, provider: "cloudflare", model };
}

async function pollinations(prompt: string, width: number, height: number): Promise<GeneratedImage> {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true&seed=${Math.floor(Math.random() * 1e9)}`;
  const t0 = Date.now();
  const bin = await httpBinary(url, {}, 120_000);
  if (!bin || !bin.contentType.startsWith("image/")) throw new Error("Pollinations не ответил картинкой");
  log.info("img", `pollinations ${Date.now() - t0}мс ${bin.bytes.length}B`);
  return { bytes: bin.bytes, mime: bin.contentType, provider: "pollinations", model: "flux" };
}

/** Картинка по английскому промпту. Cloudflare → Pollinations. */
export async function generateImage(prompt: string, opts: { aspect?: string; quality?: boolean } = {}): Promise<GeneratedImage> {
  const { width, height } = aspectToSize(opts.aspect);
  const errors: string[] = [];
  const cfModel = opts.quality ? "@cf/black-forest-labs/flux-2-klein-4b" : config.imageModel;
  if (config.cfAccountId && config.cfApiToken) {
    try {
      // schnell всегда 1024² — для другого соотношения сторон идём на flux-2-klein, он принимает размеры.
      const model = /flux-1-schnell/.test(cfModel) && (width !== 1024 || height !== 1024) ? "@cf/black-forest-labs/flux-2-klein-4b" : cfModel;
      return await cloudflare(prompt, width, height, model);
    } catch (e) {
      errors.push(`cloudflare: ${errMsg(e)}`);
      log.warn("img", errors[errors.length - 1]);
    }
  }
  try {
    return await pollinations(prompt, width, height);
  } catch (e) {
    errors.push(`pollinations: ${errMsg(e)}`);
  }
  throw new Error(`Картинка не сгенерировалась. ${errors.join(" | ")}`);
}
