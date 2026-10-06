/**
 * Инструменты модели (из движка Айман, orchestrator/tools/types.ts). Реестр оборачивает
 * исполнение в безопасный результат {ok, data | error}: упавший инструмент не роняет ход,
 * модель получает текст ошибки и продолжает.
 */
import type { Sender } from "../telegram/sender.ts";

/** JSON-схема параметров, совместимая с Gemini functionDeclarations. */
export interface JsonSchema {
  type: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
}

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: JsonSchema;
}

/** Файл, который инструмент приготовил для отправки в чат — канал шлёт его ПОСЛЕ текста ответа. */
export interface OutboxItem {
  kind: "photo" | "document";
  bytes?: Buffer;
  /** Готовый file_id Telegram (пересылка сохранённого фото). */
  fileId?: string;
  fileName?: string;
  caption?: string;
  mime?: string;
}

/** Контекст исполнения инструмента. */
export interface ToolContext {
  chatId: string;
  /** IANA-зона владельца. */
  tz: string;
  /** Текущее время хода, мс. */
  now: number;
  sender: Sender;
  outbox: OutboxItem[];
  /** file_id фото, присланного в этом же сообщении (для заметки с фото). */
  incomingPhotoFileId?: string;
  /** Что инструменты поменяли — чтобы движок понимал, нужен ли пересчёт планировщика и т.п. */
  changed: Set<"notes" | "tasks" | "reminders" | "facts" | "settings">;
}

export type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;

export interface ToolDefinition {
  decl: ToolDeclaration;
  handler: ToolHandler;
}

export interface ToolExecResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export class ToolRegistry {
  private map = new Map<string, ToolDefinition>();

  constructor(defs: ToolDefinition[] = []) {
    for (const d of defs) this.map.set(d.decl.name, d);
  }

  declarations(): ToolDeclaration[] {
    return [...this.map.values()].map((d) => d.decl);
  }

  has(name: string): boolean {
    return this.map.has(name);
  }

  async execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecResult> {
    const def = this.map.get(name);
    if (!def) return { ok: false, error: `unknown tool: ${name}` };
    try {
      const data = await def.handler(args ?? {}, ctx);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}

/** Хелперы разбора аргументов: модель иногда шлёт числа строками и наоборот. */
export function argStr(args: Record<string, unknown>, key: string, fallback = ""): string {
  const v = args[key];
  if (v === undefined || v === null) return fallback;
  return String(v).trim();
}

export function argNum(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function argBool(args: Record<string, unknown>, key: string, fallback = false): boolean {
  const v = args[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v === "boolean") return v;
  return /^(1|true|yes|да)$/i.test(String(v).trim());
}

export function argList(args: Record<string, unknown>, key: string): string[] {
  const v = args[key];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string" && v.trim()) return v.split(/\n|;/).map((s) => s.trim()).filter(Boolean);
  return [];
}
