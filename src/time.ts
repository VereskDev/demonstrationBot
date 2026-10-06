/**
 * Время: локальное ↔ UTC по зоне владельца, человекочитаемые даты, расписание повторов.
 *
 * Формат repeat (строка из инструмента модели):
 *   none | daily | weekdays | weekends | weekly:MO,WE | monthly:15 | yearly:03-08 | every:2h | every:3d | every:45m
 */
import { DateTime } from "luxon";

export const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
const RU_WEEKDAYS = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
const RU_WEEKDAYS_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const RU_MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export function isValidZone(tz: string): boolean {
  return DateTime.now().setZone(tz).isValid;
}

export function nowIn(tz: string, nowMs = Date.now()): DateTime {
  return DateTime.fromMillis(nowMs, { zone: tz });
}

/** Строка модели (YYYY-MM-DDTHH:mm, YYYY-MM-DD HH:mm, YYYY-MM-DD, ISO с зоной) → UTC мс. null — не разобрали. */
export function parseLocal(input: string, tz: string, nowMs = Date.now()): number | null {
  const s = String(input ?? "").trim();
  if (!s) return null;
  const direct = Number(s);
  if (Number.isFinite(direct) && s.length >= 12) return direct;
  const normalized = s.replace(" ", "T");
  let dt: DateTime = DateTime.fromISO(normalized, { zone: tz, setZone: true });
  if (!dt.isValid) dt = DateTime.fromFormat(s, "dd.MM.yyyy HH:mm", { zone: tz });
  if (!dt.isValid) dt = DateTime.fromFormat(s, "dd.MM.yyyy", { zone: tz }).set({ hour: 9 });
  if (!dt.isValid) dt = DateTime.fromFormat(s, "HH:mm", { zone: tz });
  if (!dt.isValid) return null;
  // Дата без времени → 9:00 (напоминание «3 ноября» утром, а не в полночь).
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) dt = dt.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  // Только время — ближайшее такое время (сегодня, если ещё впереди, иначе завтра).
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const now = nowIn(tz, nowMs);
    dt = now.set({ hour: dt.hour, minute: dt.minute, second: 0, millisecond: 0 });
    if (dt.toMillis() <= nowMs) dt = dt.plus({ days: 1 });
  }
  return dt.toMillis();
}

export function formatDateTime(ms: number, tz: string, nowMs = Date.now()): string {
  const d = DateTime.fromMillis(ms, { zone: tz });
  const now = nowIn(tz, nowMs);
  const time = d.toFormat("HH:mm");
  const sameDay = d.hasSame(now, "day");
  if (sameDay) return `сегодня в ${time}`;
  if (d.hasSame(now.plus({ days: 1 }), "day")) return `завтра в ${time}`;
  if (d.hasSame(now.minus({ days: 1 }), "day")) return `вчера в ${time}`;
  const wd = RU_WEEKDAYS_SHORT[d.weekday - 1];
  const sameYear = d.year === now.year;
  return `${wd}, ${d.day} ${RU_MONTHS_GEN[d.month - 1]}${sameYear ? "" : ` ${d.year}`} в ${time}`;
}

export function formatDate(isoDate: string, tz: string, nowMs = Date.now()): string {
  const d = DateTime.fromISO(isoDate, { zone: tz });
  if (!d.isValid) return isoDate;
  const now = nowIn(tz, nowMs);
  if (d.hasSame(now, "day")) return "сегодня";
  if (d.hasSame(now.plus({ days: 1 }), "day")) return "завтра";
  if (d.hasSame(now.minus({ days: 1 }), "day")) return "вчера";
  const withTime = /T\d{2}:\d{2}/.test(isoDate) ? ` ${d.toFormat("HH:mm")}` : "";
  return `${RU_WEEKDAYS_SHORT[d.weekday - 1]}, ${d.day} ${RU_MONTHS_GEN[d.month - 1]}${d.year === now.year ? "" : ` ${d.year}`}${withTime}`;
}

/** Шапка «сейчас» для системного промпта. */
export function describeNow(tz: string, nowMs = Date.now()): string {
  const d = nowIn(tz, nowMs);
  return `${d.toFormat("yyyy-MM-dd HH:mm")} (${RU_WEEKDAYS[d.weekday - 1]}, ${d.day} ${RU_MONTHS_GEN[d.month - 1]} ${d.year}), часовой пояс ${tz} (UTC${d.toFormat("Z")})`;
}

export function normalizeRepeat(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!s || s === "none" || s === "once" || s === "нет" || s === "null") return null;
  if (/^(daily|everyday|ежедневно|каждыйдень)$/.test(s)) return "daily";
  if (/^(weekdays|будни|побудням)$/.test(s)) return "weekdays";
  if (/^(weekends|выходные)$/.test(s)) return "weekends";
  if (/^weekly$/.test(s)) return "weekly";
  if (/^monthly$/.test(s)) return "monthly";
  if (/^yearly$/.test(s)) return "yearly";
  let m = s.match(/^weekly:([a-z,]+)$/);
  if (m) {
    const days = m[1].toUpperCase().split(",").filter((d) => (WEEKDAY_CODES as readonly string[]).includes(d));
    return days.length ? `weekly:${days.join(",")}` : "weekly";
  }
  m = s.match(/^monthly:(\d{1,2})$/);
  if (m) return `monthly:${Math.min(31, Math.max(1, Number(m[1])))}`;
  m = s.match(/^yearly:(\d{2})-(\d{2})$/);
  if (m) return `yearly:${m[1]}-${m[2]}`;
  m = s.match(/^every:(\d+)([mhd])$/);
  if (m) return `every:${m[1]}${m[2]}`;
  m = s.match(/^every(\d+)(min|minutes|m|h|hours|d|days)$/);
  if (m) return `every:${m[1]}${m[2][0]}`;
  return null;
}

export function describeRepeat(repeat: string | null): string {
  if (!repeat) return "";
  if (repeat === "daily") return "каждый день";
  if (repeat === "weekdays") return "по будням";
  if (repeat === "weekends") return "по выходным";
  if (repeat === "weekly") return "раз в неделю";
  if (repeat === "monthly") return "раз в месяц";
  if (repeat === "yearly") return "раз в год";
  let m = repeat.match(/^weekly:(.+)$/);
  if (m) return `по ${m[1].split(",").map((c) => RU_WEEKDAYS_SHORT[WEEKDAY_CODES.indexOf(c as (typeof WEEKDAY_CODES)[number])] ?? c.toLowerCase()).join(", ")}`;
  m = repeat.match(/^monthly:(\d+)$/);
  if (m) return `каждое ${m[1]}-е число`;
  m = repeat.match(/^yearly:(\d{2})-(\d{2})$/);
  if (m) return `каждый год ${Number(m[2])} ${RU_MONTHS_GEN[Number(m[1]) - 1] ?? m[1]}`;
  m = repeat.match(/^every:(\d+)([mhd])$/);
  if (m) return `каждые ${m[1]} ${m[2] === "m" ? "мин" : m[2] === "h" ? "ч" : "дн"}`;
  return repeat;
}

/** Следующее срабатывание ПОСЛЕ afterMs по правилу repeat, в локальном времени зоны. null — разовое. */
export function nextOccurrence(prevMs: number, repeat: string | null, tz: string, afterMs = Date.now()): number | null {
  if (!repeat) return null;
  const prev = DateTime.fromMillis(prevMs, { zone: tz });
  const after = Math.max(afterMs, prevMs);
  const step = (fn: (d: DateTime) => DateTime): number => {
    let d: DateTime = prev;
    for (let i = 0; i < 1000; i++) {
      d = fn(d);
      if (d.toMillis() > after) return d.toMillis();
    }
    return d.toMillis();
  };
  let m = repeat.match(/^every:(\d+)([mhd])$/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2] === "m" ? "minutes" : m[2] === "h" ? "hours" : "days";
    return step((d) => d.plus({ [unit]: n }));
  }
  if (repeat === "daily") return step((d) => d.plus({ days: 1 }));
  if (repeat === "weekdays") return step((d) => (d.weekday >= 5 ? d.plus({ days: 8 - d.weekday }) : d.plus({ days: 1 })));
  if (repeat === "weekends") return step((d) => (d.weekday === 6 ? d.plus({ days: 1 }) : d.plus({ days: (6 - d.weekday + 7) % 7 || 7 })));
  if (repeat === "weekly") return step((d) => d.plus({ weeks: 1 }));
  m = repeat.match(/^weekly:(.+)$/);
  if (m) {
    const days: number[] = m[1].split(",").map((c) => WEEKDAY_CODES.indexOf(c as (typeof WEEKDAY_CODES)[number]) + 1).filter((n) => n >= 1);
    if (!days.length) return step((d) => d.plus({ weeks: 1 }));
    return step((d) => {
      for (let i = 1; i <= 7; i++) {
        const cand = d.plus({ days: i });
        if (days.includes(Number(cand.weekday))) return cand;
      }
      return d.plus({ weeks: 1 });
    });
  }
  if (repeat === "monthly") return step((d) => d.plus({ months: 1 }));
  m = repeat.match(/^monthly:(\d+)$/);
  if (m) {
    const day = Number(m[1]);
    return step((d) => {
      const n = d.plus({ months: 1 }).startOf("month");
      return n.set({ day: Math.min(day, n.daysInMonth ?? 28), hour: prev.hour, minute: prev.minute, second: 0, millisecond: 0 });
    });
  }
  if (repeat === "yearly") return step((d) => d.plus({ years: 1 }));
  m = repeat.match(/^yearly:(\d{2})-(\d{2})$/);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    return step((d) => {
      const n = d.plus({ years: 1 }).set({ month, day: 1 });
      return n.set({ day: Math.min(day, n.daysInMonth ?? 28), hour: prev.hour, minute: prev.minute, second: 0, millisecond: 0 });
    });
  }
  return null;
}

export function localDateStr(ms: number, tz: string): string {
  return DateTime.fromMillis(ms, { zone: tz }).toFormat("yyyy-MM-dd");
}
