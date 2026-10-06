/**
 * Цикл оркестратора (ядро loop.ts из движка Айман, без продуктовых подпорок): модель →
 * вызовы инструментов → результаты обратно → … → текст ответа. Инструменты одного шага
 * исполняются параллельно. Шаги кончились — последний вызов без инструментов, чтобы модель
 * обязательно написала текст.
 */
import type { ToolContext, ToolRegistry } from "../tools/types.ts";
import type { LlmMessage, ModelTransport, ToolTraceEntry } from "./types.ts";
import { log } from "../runtime/log.ts";

export interface OrchestratorResult {
  reply: string;
  /** Новые сообщения этого хода (user + model/tool), для записи в историю. */
  appended: LlmMessage[];
  toolTrace: ToolTraceEntry[];
  steps: number;
}

export async function runOrchestrator(params: {
  system: string;
  history: LlmMessage[];
  userMessage: LlmMessage;
  model: ModelTransport;
  tools: ToolRegistry;
  toolContext: ToolContext;
  maxSteps?: number;
}): Promise<OrchestratorResult> {
  const { system, model, tools, toolContext } = params;
  const maxSteps = params.maxSteps ?? 6;
  const decls = tools.declarations();
  const appended: LlmMessage[] = [params.userMessage];
  const messages: LlmMessage[] = [...params.history, params.userMessage];
  const trace: ToolTraceEntry[] = [];
  let lastText = "";

  for (let step = 0; step < maxSteps; step++) {
    const t0 = Date.now();
    const turn = await model.generate({ system, messages, tools: decls });
    log.info("orch", `шаг ${step}: ${Date.now() - t0}мс, инструментов ${turn.toolCalls?.length ?? 0}${turn.text ? `, текст ${turn.text.length} зн.` : ""}`);

    if (!turn.toolCalls?.length) {
      const text = String(turn.text ?? "").trim();
      if (text) {
        appended.push({ role: "model", text, textSignature: turn.textSignature });
        return { reply: text, appended, toolTrace: trace, steps: step + 1 };
      }
      // Пустой ответ без инструментов — просим написать текст явно (один раз).
      if (lastText) break;
      messages.push({ role: "user", text: "[система] Ответь пользователю текстом по результатам выше." });
      appended.push(messages[messages.length - 1]);
      continue;
    }

    const modelMsg: LlmMessage = { role: "model", text: turn.text, textSignature: turn.textSignature, toolCalls: turn.toolCalls };
    messages.push(modelMsg);
    appended.push(modelMsg);
    if (turn.text) lastText = turn.text;

    const results = await Promise.all(
      turn.toolCalls.map(async (call) => {
        const t1 = Date.now();
        const res = await tools.execute(call.name, call.args ?? {}, toolContext);
        trace.push({ name: call.name, args: call.args ?? {}, ok: res.ok, error: res.error, ms: Date.now() - t1 });
        log.info("tool", `${call.name}(${JSON.stringify(call.args ?? {}).slice(0, 200)}) → ${res.ok ? "ok" : `ошибка: ${res.error}`} ${Date.now() - t1}мс`);
        return { name: call.name, callId: call.id, result: res.ok ? res.data : { error: res.error } };
      }),
    );
    const toolMsg: LlmMessage = { role: "tool", toolResults: results };
    messages.push(toolMsg);
    appended.push(toolMsg);
  }

  // Шаги кончились: заставляем модель подвести итог текстом.
  const final = await model.generate({ system, messages, tools: decls, noTools: true });
  const text = String(final.text ?? "").trim() || lastText || "Сделано.";
  appended.push({ role: "model", text, textSignature: final.textSignature });
  return { reply: text, appended, toolTrace: trace, steps: maxSteps + 1 };
}
