import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { describeRepeat, formatDateTime, nextOccurrence, normalizeRepeat, parseLocal } from "../src/time.ts";

const TZ = "Asia/Almaty";
const now = DateTime.fromISO("2026-10-06T12:00", { zone: TZ }).toMillis();

describe("parseLocal", () => {
  it("разбирает YYYY-MM-DDTHH:mm в зоне владельца", () => {
    const ms = parseLocal("2026-10-07T09:00", TZ, now)!;
    expect(DateTime.fromMillis(ms, { zone: TZ }).toFormat("yyyy-MM-dd HH:mm")).toBe("2026-10-07 09:00");
    expect(DateTime.fromMillis(ms, { zone: "utc" }).toFormat("HH:mm")).toBe("04:00");
  });
  it("дата без времени → 9:00", () => {
    expect(DateTime.fromMillis(parseLocal("2026-11-03", TZ, now)!, { zone: TZ }).toFormat("HH:mm")).toBe("09:00");
  });
  it("только время → ближайшее будущее", () => {
    expect(DateTime.fromMillis(parseLocal("15:30", TZ, now)!, { zone: TZ }).toFormat("yyyy-MM-dd HH:mm")).toBe("2026-10-06 15:30");
    expect(DateTime.fromMillis(parseLocal("08:00", TZ, now)!, { zone: TZ }).toFormat("yyyy-MM-dd HH:mm")).toBe("2026-10-07 08:00");
  });
  it("мусор → null", () => {
    expect(parseLocal("завтра", TZ, now)).toBeNull();
  });
});

describe("formatDateTime", () => {
  it("сегодня/завтра/дата", () => {
    expect(formatDateTime(parseLocal("2026-10-06T18:00", TZ)!, TZ, now)).toBe("сегодня в 18:00");
    expect(formatDateTime(parseLocal("2026-10-07T09:00", TZ)!, TZ, now)).toBe("завтра в 09:00");
    expect(formatDateTime(parseLocal("2026-10-25T10:15", TZ)!, TZ, now)).toBe("вс, 25 октября в 10:15");
  });
});

describe("repeat", () => {
  it("нормализует правила", () => {
    expect(normalizeRepeat("none")).toBeNull();
    expect(normalizeRepeat("Daily")).toBe("daily");
    expect(normalizeRepeat("weekly:mo,we")).toBe("weekly:MO,WE");
    expect(normalizeRepeat("monthly:31")).toBe("monthly:31");
    expect(normalizeRepeat("every:2h")).toBe("every:2h");
    expect(normalizeRepeat("каждый день")).toBe("daily");
    expect(describeRepeat("weekdays")).toBe("по будням");
  });
  it("следующее срабатывание по будням пропускает выходные", () => {
    const fri = DateTime.fromISO("2026-10-09T08:30", { zone: TZ }).toMillis();
    const next = nextOccurrence(fri, "weekdays", TZ, fri)!;
    expect(DateTime.fromMillis(next, { zone: TZ }).toFormat("yyyy-MM-dd HH:mm")).toBe("2026-10-12 08:30");
  });
  it("monthly:31 в коротком месяце даёт последний день", () => {
    const jan = DateTime.fromISO("2027-01-31T10:00", { zone: TZ }).toMillis();
    const next = nextOccurrence(jan, "monthly:31", TZ, jan)!;
    expect(DateTime.fromMillis(next, { zone: TZ }).toFormat("yyyy-MM-dd HH:mm")).toBe("2027-02-28 10:00");
  });
  it("пропущенные повторы перепрыгивает в будущее", () => {
    const old = DateTime.fromISO("2026-09-01T08:00", { zone: TZ }).toMillis();
    const next = nextOccurrence(old, "daily", TZ, now)!;
    expect(DateTime.fromMillis(next, { zone: TZ }).toFormat("yyyy-MM-dd HH:mm")).toBe("2026-10-07 08:00");
  });
  it("weekly:MO,WE", () => {
    const tue = DateTime.fromISO("2026-10-06T19:00", { zone: TZ }).toMillis();
    const next = nextOccurrence(tue, "weekly:MO,WE", TZ, tue)!;
    expect(DateTime.fromMillis(next, { zone: TZ }).toFormat("yyyy-MM-dd HH:mm")).toBe("2026-10-07 19:00");
  });
});
