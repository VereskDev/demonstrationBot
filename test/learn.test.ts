/**
 * Режим обучения без сети: модель-заглушка падает → урок берётся из банка; озвучка выключена
 * (LEARN_TTS=off). Проверяем SRS карточек, проверку ответов, валидацию урока и полный проход.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useMemoryDb } from "../src/db/index.ts";
import { accentsOnlyDiff, matchesAnswer, normalizeAnswer } from "../src/learn/answers.ts";
import { BANK } from "../src/learn/bank.ts";
import { addCard, BOX_INTERVAL_DAYS, cardStats, dueCards, reviewCard } from "../src/learn/cards.ts";
import { bankLesson, planSteps, validateLesson } from "../src/learn/generator.ts";
import { handleLearnCallback, handleLearnText, learnMenuView, parseCardCommand, startLesson, type LearnCtx } from "../src/learn/index.ts";
import { __resetLearnSchema, getLearnProgress, getLearnSession, recordLessonDone } from "../src/learn/store.ts";
import { chunkForTts, speakablePart } from "../src/learn/tts.ts";
import { TOPICS, type LessonSession } from "../src/learn/types.ts";
import type { InlineButton, SendOptions, Sender, SentMessage } from "../src/telegram/sender.ts";

class FakeSender implements Sender {
  out: Array<{ kind: string; text: string; inline?: InlineButton[][] }> = [];
  n = 0;
  async sendText(_c: string, text: string, opts: SendOptions = {}): Promise<SentMessage> {
    this.out.push({ kind: "text", text, inline: opts.inline });
    return { messageId: ++this.n };
  }
  async sendPhoto(): Promise<SentMessage> {
    return { messageId: ++this.n };
  }
  async sendDocument(): Promise<SentMessage> {
    return { messageId: ++this.n };
  }
  async sendVoice(): Promise<SentMessage> {
    this.out.push({ kind: "voice", text: "" });
    return { messageId: ++this.n };
  }
  async typing() {}
  async editText(_c: string, _m: number, text: string, opts: SendOptions = {}) {
    this.out.push({ kind: "edit", text, inline: opts.inline });
  }
  async editButtons() {}
  last(kind = "text") {
    return [...this.out].reverse().find((o) => o.kind === kind)!;
  }
  buttons(): string[] {
    return (this.last().inline ?? []).flat().map((b) => b.callback_data ?? "");
  }
}

const failingModel = {
  generate: async () => {
    throw new Error("offline");
  },
};

const chat = "c1";
const TZ = "Asia/Almaty";

describe("карточки Лейтнера", () => {
  beforeEach(() => {
    useMemoryDb();
    __resetLearnSchema();
  });
  it("интервалы 0/1/3/7/16, «не помню» возвращает в первую коробку", () => {
    expect(BOX_INTERVAL_DAYS).toEqual([0, 1, 3, 7, 16]);
    const now = 1_000_000_000_000;
    const { card, created } = addCard(chat, "la mesa", "стол", "manual", now);
    expect(created).toBe(true);
    expect(dueCards(chat, now).map((c) => c.id)).toEqual([card.id]);
    let c = reviewCard(chat, card.id, true, now)!;
    expect(c.box).toBe(2);
    expect(c.due_at).toBe(now + 86_400_000);
    c = reviewCard(chat, card.id, true, now)!;
    expect(c.box).toBe(3);
    expect(c.due_at).toBe(now + 3 * 86_400_000);
    c = reviewCard(chat, card.id, false, now)!;
    expect(c.box).toBe(1);
    expect(c.lapses).toBe(1);
    expect(dueCards(chat, now)).toHaveLength(0); // отложена на 10 минут
    expect(dueCards(chat, now + 11 * 60_000)).toHaveLength(1);
  });
  it("дубли по слову не плодятся (артикль не считается)", () => {
    addCard(chat, "La mesa", "стол");
    expect(addCard(chat, "mesa", "столик").created).toBe(false);
    expect(cardStats(chat).total).toBe(1);
  });
  it("разбор команды «карточка: …»", () => {
    expect(parseCardCommand("карточка: el pan — хлеб")).toEqual({ front: "el pan", back: "хлеб" });
    expect(parseCardCommand("Карточка: hola - привет")).toEqual({ front: "hola", back: "привет" });
    expect(parseCardCommand("привет")).toBeNull();
  });
});

describe("проверка ответов", () => {
  it("регистр, пунктуация, ударения", () => {
    expect(normalizeAnswer("¿Cómo estás?")).toBe("cómo estás");
    expect(matchesAnswer("Soy", ["soy"])).toBe(true);
    expect(matchesAnswer("como estas", ["¿Cómo estás?"])).toBe(true);
    expect(accentsOnlyDiff("como estas", ["¿Cómo estás?"])).toBe(true);
    expect(accentsOnlyDiff("cómo estás", ["¿Cómo estás?"])).toBe(false);
    expect(matchesAnswer("eres", ["soy"])).toBe(false);
  });
  it("озвучка: нарезка и чистка подсказок", () => {
    expect(chunkForTts("a".repeat(400)).every((c) => c.length <= 180)).toBe(true);
    expect(speakablePart("¡Hola! ¿Qué tal? (подсказка: лучше «tengo hambre»)")).toBe("¡Hola! ¿Qué tal?");
  });
});

describe("банк и генератор", () => {
  it("все 6 тем банка полные", () => {
    for (const t of TOPICS) {
      const b = BANK[t.id];
      expect(b, t.id).toBeTruthy();
      expect(b.vocab.length).toBe(8);
      expect(b.phrases.length).toBe(6);
      expect(b.listening.length).toBe(2);
      expect(b.exercises.length).toBe(4);
      expect(b.quiz.length).toBe(5);
      for (const q of [...b.quiz, ...b.listening]) expect(q.answer).toBeLessThan(q.options.length);
      for (const e of b.exercises) if (e.type === "fill") expect(e.sentence).toContain("___");
    }
  });
  it("validateLesson отбрасывает мусор и чинит индексы", () => {
    expect(validateLesson({ vocab: [] }, TOPICS[0], "A1")).toBeNull();
    const raw = { ...structuredClone(BANK.food), quiz: BANK.food.quiz.map((q) => ({ ...q, answer: 99 })) };
    const l = validateLesson(raw, TOPICS[2], "A2")!;
    expect(l.source).toBe("ai");
    expect(l.quiz[0].answer).toBe(0);
  });
  it("planSteps уважает фокус", () => {
    const l = bankLesson(TOPICS[0], "A1");
    const all = planSteps(l, ["grammar", "conversation", "listening"]);
    expect(all.some((s) => s.kind === "grammar")).toBe(true);
    expect(all.filter((s) => s.kind === "listening")).toHaveLength(2);
    const noG = planSteps(l, ["conversation"]);
    expect(noG.some((s) => s.kind === "grammar" || s.kind === "listening")).toBe(false);
    expect(noG[0].kind).toBe("intro");
    expect(noG.at(-1)?.kind).toBe("finish");
  });
});

describe("урок целиком (банк, без сети)", () => {
  let sender: FakeSender;
  let ctx: LearnCtx;
  beforeEach(() => {
    useMemoryDb();
    __resetLearnSchema();
    sender = new FakeSender();
    ctx = { chatId: chat, sender, model: failingModel, tz: TZ };
  });

  it("проходит все шаги, считает ошибки, пишет прогресс и карточки", async () => {
    await startLesson(ctx, { topic: "greetings" });
    let s = getLearnSession(chat) as LessonSession;
    expect(s.kind).toBe("lesson");
    expect(s.lesson.source).toBe("bank");
    expect(sender.last().text).toMatch(/Знакомство/);
    expect(sender.buttons()).toContain("learn:next");

    const cb = (data: string) => handleLearnCallback(ctx, data, 1);
    await cb("learn:next"); // vocab
    expect(sender.out.some((o) => o.text.includes("Словарь"))).toBe(true);
    await cb("learn:next"); // grammar
    expect(sender.last().text).toMatch(/Грамматика/);
    await cb("learn:next"); // phrases
    expect(sender.out.some((o) => o.text.includes("Разговорные фразы"))).toBe(true);
    await cb("learn:next"); // listening 1
    expect(sender.last().text).toMatch(/Откуда Карлос/);
    await cb("learn:ans:1"); // неверно
    expect(sender.out.some((o) => o.text.includes("Не совсем"))).toBe(true);
    await cb("learn:ans:1"); // listening 2 верно
    expect(sender.out.some((o) => o.text.startsWith("✅ Верно"))).toBe(true);

    // exercise 1 fill: текст
    expect(sender.last().text).toMatch(/Вставь пропущенное/);
    expect(await handleLearnText(ctx, "soy")).toBe(true);
    // exercise 2 choose
    await cb("learn:ans:0");
    // exercise 3 translate: модель-судья недоступна → неверно, но ход идёт дальше
    expect(sender.last().text).toMatch(/Переведи/);
    expect(await handleLearnText(ctx, "Yo soy Ana")).toBe(true);
    // exercise 4 fill: не знаю
    await cb("learn:skip");
    // quiz ×5
    for (let i = 0; i < 5; i++) {
      expect(sender.last().text).toMatch(/Тест/);
      await cb("learn:ans:0");
    }
    expect(getLearnSession(chat)).toBeNull();
    const fin = sender.last();
    expect(fin.text).toMatch(/Урок завершён/);
    expect(fin.text).toMatch(/Серия: <b>1<\/b>/);
    const p = getLearnProgress(chat);
    expect(p.lessonsTotal).toBe(1);
    expect(p.topicCounts.greetings).toBe(1);
    s = s!;
    // ошибки: аудирование 1, перевод, пропуск, вопрос теста №3 (ответ B) → 4 карточки
    expect(cardStats(chat).total).toBe(4);
    expect(fin.text).toMatch(/Тест: 4\/5/);
    expect(learnMenuView(chat).text).toMatch(/уроков: 1/);
  });

  it("стоп-слово прерывает урок и сохраняет ошибки", async () => {
    await startLesson(ctx, { topic: "food" });
    await handleLearnCallback(ctx, "learn:next", 1);
    expect(await handleLearnText(ctx, "стоп")).toBe(true);
    expect(getLearnSession(chat)).toBeNull();
    expect(sender.last().text).toMatch(/Урок прерван/);
  });

  it("серия дней: сегодня, вчера → +1, разрыв → 1", () => {
    const day = 86_400_000;
    const t0 = Date.parse("2026-10-06T10:00:00+05:00");
    let r = recordLessonDone(chat, "food", 5, 9, TZ, t0);
    expect(r.progress.streak).toBe(1);
    r = recordLessonDone(chat, "food", 5, 9, TZ, t0 + 3600_000);
    expect(r.progress.streak).toBe(1);
    expect(r.streakGrew).toBe(false);
    r = recordLessonDone(chat, "daily", 5, 9, TZ, t0 + day);
    expect(r.progress.streak).toBe(2);
    r = recordLessonDone(chat, "daily", 5, 9, TZ, t0 + 4 * day);
    expect(r.progress.streak).toBe(1);
    expect(r.progress.lessonsTotal).toBe(4);
  });
});
