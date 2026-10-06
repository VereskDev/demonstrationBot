/**
 * Планировщик напоминаний: раз в N секунд берёт созревшие (at_utc <= now), шлёт в чат с кнопками
 * «Готово / +10 мин / +1 час / Завтра», повторяющиеся перевзводит на следующее срабатывание.
 * Пропущенные за время простоя бота (ноут спал) — отправляются при старте с пометкой.
 */
import { appendBotEvent } from "../agent/agent.ts";
import { chatTz, deactivateReminder, dueReminders, rescheduleReminder } from "../db/index.ts";
import { log, errMsg } from "../runtime/log.ts";
import type { Sender } from "../telegram/sender.ts";
import { describeRepeat, formatDateTime, nextOccurrence } from "../time.ts";
import { reminderFireButtons } from "../views.ts";

export function startReminderScheduler(sender: Sender, tickMs: number): { stop: () => void; tick: () => Promise<number> } {
  let running: Promise<number> | null = null;
  const tick = (): Promise<number> => {
    // Параллельный вызов (тест, ручной пинок) ждёт идущий проход, а не стартует второй.
    if (running) return running;
    running = runOnce().finally(() => {
      running = null;
    });
    return running;
  };
  const runOnce = async (): Promise<number> => {
    let sent = 0;
    {
      const now = Date.now();
      for (const r of dueReminders(now)) {
        const tz = chatTz(r.chat_id);
        const late = now - r.at_utc;
        const lateNote = late > 10 * 60_000 ? `\n(было запланировано ${formatDateTime(r.at_utc, tz, now)} — бот был выключен)` : "";
        const repeatNote = r.repeat ? `\n🔁 ${describeRepeat(r.repeat)}` : "";
        // Сначала перевзводим/гасим, потом шлём: если отправка упадёт, не будем слать по кругу каждый тик.
        const next = nextOccurrence(r.at_utc, r.repeat, tz, now);
        if (next) rescheduleReminder(r.id, next, { fired: true });
        else deactivateReminder(r.id, { fired: true });
        try {
          await sender.sendText(r.chat_id, `⏰ ${r.text}${repeatNote}${lateNote}`, { inline: reminderFireButtons(r.id) });
          appendBotEvent(r.chat_id, `Напоминание отправлено пользователю: «${r.text}»${next ? `, следующее ${formatDateTime(next, tz, now)}` : ""}.`);
          sent += 1;
        } catch (e) {
          log.warn("sched", `напоминание ${r.id} не отправлено: ${errMsg(e)}`);
        }
      }
    }
    return sent;
  };
  const timer = setInterval(() => void tick().catch((e) => log.error("sched", errMsg(e))), tickMs);
  void tick();
  return { stop: () => clearInterval(timer), tick };
}
