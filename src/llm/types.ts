/**
 * Контракт слоя модели (из движка Айман, orchestrator/types.ts). Модель спрятана за
 * ModelTransport: цикл инструментов (loop.ts) и сами инструменты от вендора не зависят.
 */
import type { ToolDeclaration } from "../tools/types.ts";

export interface LlmToolCall {
  /** id вызова (Gemini API присылает `call_...`), эхом возвращается в functionResponse. */
  id?: string;
  name: string;
  args: Record<string, unknown>;
  /**
   * Thinking-модели Gemini 3.x подписывают functionCall «мыслью» (thoughtSignature) и требуют
   * получить её обратно в той же части на следующем шаге — иначе 400. Моделям без thinking
   * поле не нужно, тогда undefined.
   */
  thoughtSignature?: string;
}

/** Бинарная вставка в сообщение пользователя (фото, голосовое). В историю не сохраняется. */
export interface InlineData {
  mimeType: string;
  /** base64 */
  data: string;
}

/** Один ход модели: текст и/или запросы на вызов инструментов. */
export interface LlmTurn {
  text?: string;
  /** Подпись «мысли» текстовой части — эхом в историю. */
  textSignature?: string;
  toolCalls?: LlmToolCall[];
}

/** Сообщение диалога. role "tool" несёт результаты вызовов инструментов. */
export interface LlmMessage {
  role: "user" | "model" | "tool";
  text?: string;
  textSignature?: string;
  inline?: InlineData[];
  toolCalls?: LlmToolCall[];
  toolResults?: Array<{ name: string; callId?: string; result: unknown }>;
}

export interface GenerateInput {
  system: string;
  messages: LlmMessage[];
  tools: ToolDeclaration[];
  /** Вспомогательный ход (разбор голосового, описание фото): сразу быстрая модель, без «думания». */
  fast?: boolean;
  /** Обязать вызвать инструмент из списка (mode ANY). */
  forceTools?: string[];
  /** Запретить инструменты на этом шаге: модель обязана ответить текстом. */
  noTools?: boolean;
}

export interface ModelTransport {
  generate(input: GenerateInput): Promise<LlmTurn>;
}

export interface ToolTraceEntry {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  error?: string;
  ms: number;
}
