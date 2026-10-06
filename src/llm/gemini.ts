/**
 * ModelTransport поверх Gemini API (generativelanguage, ключ из AI Studio). Перенесён из движка
 * Айман (orchestrator/gemini.ts + vertex.ts): function-calling, эхо thoughtSignature, ретраи на
 * 429/503, хеджирование хвостовой латентности.
 *
 * Отличие от Айман: хедж не дублирует запрос к той же модели, а поднимает ВТОРУЮ модель
 * (быструю lite). Замер 06.10.2026 на бесплатном ключе: 3.5-flash — 1,6 с, когда свободна, и
 * 503/429 «high demand» волнами; 3.5-flash-lite — стабильно ~1 с и корректно зовёт инструменты.
 * Поэтому: стартуем основную; нет ответа за GEMINI_HEDGE_MS или она упала — стартует lite;
 * побеждает первый успешный ответ.
 */
import { config } from "../config.ts";
import { httpRequest, HttpRequestError } from "../runtime/http.ts";
import { log } from "../runtime/log.ts";
import type { GenerateInput, LlmMessage, LlmTurn, ModelTransport } from "./types.ts";

type Part = Record<string, unknown>;

/** До какого момента основная модель считается «лежащей» (после 429/503): запускаем обе сразу. */
let primaryUnhealthyUntil = 0;
const UNHEALTHY_MS = 60_000;
type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Part[] }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  modelVersion?: string;
  error?: { code?: number; message?: string };
};

export class GeminiModelTransport implements ModelTransport {
  constructor(
    private readonly opts: {
      apiKey?: string;
      model?: string;
      fastModel?: string;
      thinking?: string;
      hedgeMs?: number;
    } = {},
  ) {}

  private get apiKey(): string {
    return String(this.opts.apiKey ?? config.geminiApiKey).trim();
  }

  private content(m: LlmMessage): { role: string; parts: Part[] } {
    if (m.role === "tool") {
      const parts: Part[] = (m.toolResults ?? []).map((r) => {
        const fr: Part = { name: r.name, response: { result: r.result } };
        if (r.callId) fr.id = r.callId;
        return { functionResponse: fr };
      });
      if (!parts.length) parts.push({ text: " " });
      return { role: "user", parts };
    }
    const parts: Part[] = [];
    for (const d of m.inline ?? []) parts.push({ inlineData: { mimeType: d.mimeType, data: d.data } });
    if (m.text) {
      const p: Part = { text: m.text };
      if (m.role === "model" && m.textSignature) p.thoughtSignature = m.textSignature;
      parts.push(p);
    }
    for (const c of m.toolCalls ?? []) {
      const fc: Part = { name: c.name, args: c.args };
      if (c.id) fc.id = c.id;
      const part: Part = { functionCall: fc };
      if (c.thoughtSignature) part.thoughtSignature = c.thoughtSignature;
      parts.push(part);
    }
    // Gemini отклоняет content без parts — гарантируем хотя бы один.
    if (!parts.length) parts.push({ text: " " });
    return { role: m.role === "model" ? "model" : "user", parts };
  }

  private body(input: GenerateInput, model: string, isFast: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = { contents: input.messages.map((m) => this.content(m)) };
    if (input.system) body.systemInstruction = { parts: [{ text: input.system }] };
    if (input.tools.length && !input.noTools) body.tools = [{ functionDeclarations: input.tools }];
    const forced = (input.forceTools ?? []).filter(Boolean);
    if (forced.length) body.toolConfig = { functionCallingConfig: { mode: "ANY", allowedFunctionNames: forced } };
    const gen: Record<string, unknown> = {};
    // lite с thinkingLevel отвечала 62 с вместо 1 с (замер 06.10) — ей конфиг «думания» не даём.
    const thinking = String(this.opts.thinking ?? config.geminiThinking).toLowerCase();
    if (!isFast && thinking && thinking !== "none" && /flash|pro/.test(model) && !/lite/.test(model)) {
      gen.thinkingConfig = { thinkingLevel: thinking };
    }
    if (input.json) gen.responseMimeType = "application/json";
    if (typeof input.temperature === "number") gen.temperature = input.temperature;
    if (Object.keys(gen).length) body.generationConfig = gen;
    return body;
  }

  private async post(model: string, body: Record<string, unknown>): Promise<GeminiResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    return (await httpRequest({
      method: "POST",
      url,
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body,
      json: true,
      timeout: 90_000,
    })) as GeminiResponse;
  }

  private parse(res: GeminiResponse, model: string, dt: number): LlmTurn {
    const u = res.usageMetadata;
    if (u) log.info("llm", `${model} ${dt}ms prompt=${u.promptTokenCount ?? 0} thoughts=${u.thoughtsTokenCount ?? 0} out=${u.candidatesTokenCount ?? 0}`);
    const parts = res.candidates?.[0]?.content?.parts ?? [];
    const turn: LlmTurn = {};
    const texts: string[] = [];
    const calls: NonNullable<LlmTurn["toolCalls"]> = [];
    for (const p of parts) {
      if (p.thought === true) continue;
      if (typeof p.text === "string") {
        texts.push(p.text);
        if (typeof p.thoughtSignature === "string") turn.textSignature = p.thoughtSignature;
      }
      const fc = p.functionCall as { name?: string; args?: Record<string, unknown>; id?: string } | undefined;
      if (fc) {
        calls.push({
          name: String(fc.name ?? ""),
          args: (fc.args ?? {}) as Record<string, unknown>,
          id: typeof fc.id === "string" ? fc.id : undefined,
          thoughtSignature: typeof p.thoughtSignature === "string" ? p.thoughtSignature : undefined,
        });
      }
    }
    if (texts.length) turn.text = texts.join("\n").trim();
    if (calls.length) turn.toolCalls = calls;
    return turn;
  }

  async generate(input: GenerateInput): Promise<LlmTurn> {
    if (!this.apiKey) throw new Error("GEMINI_API_KEY missing");
    const primary = String(this.opts.model ?? config.geminiModel);
    const fast = String(this.opts.fastModel ?? config.geminiFastModel);
    const chain = input.fast ? [fast] : primary === fast ? [primary] : [primary, fast];
    const hedgeMs = this.opts.hedgeMs ?? config.geminiHedgeMs;

    let lastErr: unknown;
    for (let round = 0; round < 3; round++) {
      try {
        // Основная модель только что отвечала 429/503 — не ждём её снова, стартуем обе сразу.
        const degraded = chain.length > 1 && Date.now() < primaryUnhealthyUntil;
        return await this.hedgedChain(input, chain, degraded ? 0 : hedgeMs);
      } catch (e) {
        lastErr = e;
        const code = Number((e as { statusCode?: number })?.statusCode ?? 0);
        if (code === 429 || code === 503 || code === 0) {
          const delay = (code === 429 ? 2500 : 1200) * (round + 1) * (0.7 + Math.random() * 0.6);
          log.warn("llm", `все модели ответили ${code || "сетевой ошибкой"} — пауза ${Math.round(delay)}мс, повтор ${round + 1}`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  }

  /**
   * Запускаем модели цепочки по очереди: следующая стартует, когда предыдущая не ответила за
   * hedgeMs ИЛИ упала. Первый успешный ответ — наш. Все упали — бросаем последнюю ошибку.
   */
  private async hedgedChain(input: GenerateInput, chain: string[], hedgeMs: number): Promise<LlmTurn> {
    type Settled = { i: number; ok: true; turn: LlmTurn } | { i: number; ok: false; err: unknown };
    const live = new Map<number, Promise<Settled>>();
    let next = 0;
    const started = Date.now();
    const launch = () => {
      const i = next++;
      const model = chain[i];
      const t0 = Date.now();
      live.set(
        i,
        this.post(model, this.body(input, model, i > 0 || input.fast === true)).then(
          (res): Settled => {
            if (res.error) return { i, ok: false, err: new HttpRequestError(res.error.message ?? "gemini error", res.error.code ?? 500, res) };
            return { i, ok: true, turn: this.parse(res, model, Date.now() - t0) };
          },
          (err): Settled => ({ i, ok: false, err }),
        ),
      );
    };
    launch();
    let lastErr: unknown;
    for (;;) {
      const TIMEOUT = Symbol("hedge");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const race: Array<Promise<Settled | typeof TIMEOUT>> = [...live.values()];
      if (next < chain.length && hedgeMs > 0) {
        race.push(new Promise<typeof TIMEOUT>((resolve) => (timer = setTimeout(() => resolve(TIMEOUT), hedgeMs))));
      }
      if (!race.length) throw lastErr ?? new Error("нет моделей");
      const settled = await Promise.race(race);
      if (timer) clearTimeout(timer);
      if (settled === TIMEOUT) {
        if (hedgeMs > 0) log.info("llm", `${chain[0]} молчит >${hedgeMs}мс — параллельно запускаю ${chain[next]}`);
        launch();
        continue;
      }
      live.delete(settled.i);
      if (settled.ok) {
        if (settled.i === 0) primaryUnhealthyUntil = 0;
        if (next > 1) log.info("llm", `выиграла ${chain[settled.i]} за ${Date.now() - started}мс (запущено ${next})`);
        return settled.turn;
      }
      lastErr = settled.err;
      const code = Number((settled.err as { statusCode?: number })?.statusCode ?? 0);
      if (settled.i === 0 && (code === 429 || code === 503)) primaryUnhealthyUntil = Date.now() + UNHEALTHY_MS;
      log.warn("llm", `${chain[settled.i]} упала: ${code} ${String((settled.err as Error)?.message ?? settled.err).slice(0, 100)}`);
      // И на 400 пробуем следующую модель: у неё другой generationConfig (lite без thinking),
      // а пользователю ответ нужнее, чем точная причина. Все упали — наружу уйдёт последняя ошибка.
      if (next < chain.length) {
        launch();
        continue;
      }
      if (!live.size) throw lastErr;
    }
  }
}

/** Простой вызов без инструментов (расшифровка голосового, описание фото, генерация JSON). */
export async function simplePrompt(
  model: ModelTransport,
  prompt: string,
  opts: { inline?: LlmMessage["inline"]; system?: string; fast?: boolean; json?: boolean; temperature?: number } = {},
): Promise<string> {
  const turn = await model.generate({
    system: opts.system ?? "",
    messages: [{ role: "user", text: prompt, inline: opts.inline }],
    tools: [],
    fast: opts.fast ?? true,
    noTools: true,
    json: opts.json,
    temperature: opts.temperature,
  });
  return String(turn.text ?? "").trim();
}

/** JSON от модели: срезаем ```-обёртку, если модель всё же её поставила. */
export function parseModelJson<T = unknown>(text: string): T {
  const t = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? t.slice(start, end + 1) : t) as T;
}
