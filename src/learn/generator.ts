/**
 * Генератор уроков: тема — та, что проходили реже всего; содержимое — от модели (JSON через
 * быструю lite, ~5 с), при любой ошибке — из встроенного банка. Шаги урока собираются по фокусу.
 */
import { parseModelJson, simplePrompt } from "../llm/gemini.ts";
import type { ModelTransport } from "../llm/types.ts";
import { log, errMsg } from "../runtime/log.ts";
import { BANK } from "./bank.ts";
import type { Exercise, Focus, Grammar, LearnProgress, LearnSettings, Lesson, ListeningItem, Phrase, QuizItem, Step, TopicDef, VocabItem } from "./types.ts";
import { TOPICS } from "./types.ts";

export function pickTopic(progress: LearnProgress, preferred?: string): TopicDef {
  if (preferred) {
    const byId = TOPICS.find((t) => t.id === preferred || t.title.toLowerCase().includes(preferred.toLowerCase()));
    if (byId) return byId;
  }
  let best: TopicDef[] = [];
  let min = Infinity;
  for (const t of TOPICS) {
    const n = progress.topicCounts[t.id] ?? 0;
    if (n < min) {
      min = n;
      best = [t];
    } else if (n === min) best.push(t);
  }
  return best[Math.floor(Math.random() * best.length)] ?? TOPICS[0];
}

export function bankLesson(topic: TopicDef, level: LearnSettings["level"]): Lesson {
  const b = BANK[topic.id] ?? BANK.greetings;
  return { ...structuredClone(b), topicId: topic.id, topic: topic.title, level, source: "bank" };
}

function lessonPrompt(s: LearnSettings, topic: TopicDef, recent: string[]): string {
  const focus = s.focus.map((f) => ({ grammar: "грамматика", conversation: "разговорная речь", listening: "аудирование" })[f]).join(", ");
  return `Составь урок языка «${s.langName}» для русскоязычного ученика уровня ${s.level} на тему «${topic.title}». Фокус ученика: ${focus}.${
    recent.length ? ` Недавние уроки по этой теме уже были — выбери другой угол и другую лексику, чем: ${recent.join("; ")}.` : ""
  }
Требования: лексика и фразы уровня ${s.level}, естественный живой язык, русские переводы точные. В аудировании фраза 6–12 слов, вопрос по содержанию на русском, 3 варианта ответа на русском. В упражнениях: 2 fill (предложение с пропуском ___ и ответ одним словом/формой), 1 choose, 1 translate (ru → язык; accept — допустимые альтернативы). Тест: 5 вопросов с 3 вариантами, вопросы по-русски или с пропуском в предложении.
Верни СТРОГО JSON без markdown и комментариев по схеме:
{"title":"короткое название урока по-русски",
"vocab":[{"es":"слово или выражение на изучаемом языке","ru":"перевод","example":"пример предложения","exampleRu":"перевод примера"}] — ровно 8,
"grammar":{"title":"тема по-русски","explanation":"2–4 предложения по-русски","table":[["подпись","форма"],...] — 4–6 строк,"examples":[{"es":"","ru":""}] — 3},
"phrases":[{"es":"","ru":""}] — 6,
"listening":[{"es":"","ru":"перевод фразы","question":"","options":["","",""],"answer":0}] — 2,
"exercises":[{"type":"fill","sentence":"... ___ ...","answer":"","hint":"подсказка (инфинитив/лицо)","ru":"перевод предложения"},{"type":"choose","question":"","options":["","",""],"answer":0},{"type":"translate","ru":"","es":"","accept":[""]},{"type":"fill","sentence":"","answer":"","hint":"","ru":""}],
"quiz":[{"question":"","options":["","",""],"answer":0}] — 5}
Поле "es" всегда означает текст на изучаемом языке (${s.langName}).`;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function idx(v: unknown, n: number): number {
  const i = Number(v);
  return Number.isInteger(i) && i >= 0 && i < n ? i : 0;
}
function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(str).filter(Boolean) : [];
}

/** Привести сырой JSON модели к Lesson; null — структура негодная (тогда банк). */
export function validateLesson(raw: unknown, topic: TopicDef, level: LearnSettings["level"]): Lesson | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const vocab: VocabItem[] = (Array.isArray(o.vocab) ? o.vocab : [])
    .map((x) => {
      const v = (x ?? {}) as Record<string, unknown>;
      return { es: str(v.es), ru: str(v.ru), example: str(v.example) || undefined, exampleRu: str(v.exampleRu) || undefined };
    })
    .filter((v) => v.es && v.ru)
    .slice(0, 10);
  const phrases: Phrase[] = (Array.isArray(o.phrases) ? o.phrases : [])
    .map((x) => {
      const p = (x ?? {}) as Record<string, unknown>;
      return { es: str(p.es), ru: str(p.ru) };
    })
    .filter((p) => p.es && p.ru)
    .slice(0, 8);
  const listening: ListeningItem[] = (Array.isArray(o.listening) ? o.listening : [])
    .map((x) => {
      const l = (x ?? {}) as Record<string, unknown>;
      const options = strList(l.options);
      return { es: str(l.es), ru: str(l.ru) || undefined, question: str(l.question), options, answer: idx(l.answer, options.length) };
    })
    .filter((l) => l.es && l.question && l.options.length >= 2)
    .slice(0, 3);
  const exercises: Exercise[] = [];
  for (const x of Array.isArray(o.exercises) ? o.exercises : []) {
    const e = (x ?? {}) as Record<string, unknown>;
    const type = str(e.type);
    if (type === "fill" && str(e.sentence).includes("___") && str(e.answer)) {
      exercises.push({ type: "fill", sentence: str(e.sentence), answer: str(e.answer), hint: str(e.hint) || undefined, ru: str(e.ru) || undefined });
    } else if (type === "choose" && str(e.question) && strList(e.options).length >= 2) {
      const options = strList(e.options);
      exercises.push({ type: "choose", question: str(e.question), options, answer: idx(e.answer, options.length) });
    } else if (type === "translate" && str(e.ru) && str(e.es)) {
      exercises.push({ type: "translate", ru: str(e.ru), es: str(e.es), accept: strList(e.accept) });
    }
  }
  const quiz: QuizItem[] = (Array.isArray(o.quiz) ? o.quiz : [])
    .map((x) => {
      const q = (x ?? {}) as Record<string, unknown>;
      const options = strList(q.options);
      return { question: str(q.question), options, answer: idx(q.answer, options.length) };
    })
    .filter((q) => q.question && q.options.length >= 2)
    .slice(0, 6);
  let grammar: Grammar | undefined;
  if (o.grammar && typeof o.grammar === "object") {
    const g = o.grammar as Record<string, unknown>;
    const table = Array.isArray(g.table) ? g.table.map((row) => (Array.isArray(row) ? row.map(str) : [])).filter((r) => r.length >= 2) : [];
    const examples = (Array.isArray(g.examples) ? g.examples : [])
      .map((x) => {
        const p = (x ?? {}) as Record<string, unknown>;
        return { es: str(p.es), ru: str(p.ru) };
      })
      .filter((p) => p.es && p.ru);
    if (str(g.title) && str(g.explanation)) grammar = { title: str(g.title), explanation: str(g.explanation), table: table.length ? table : undefined, examples: examples.length ? examples : undefined };
  }
  if (vocab.length < 5 || phrases.length < 3 || exercises.length < 2 || quiz.length < 3) return null;
  return { topicId: topic.id, topic: topic.title, title: str(o.title) || topic.title, level, vocab, grammar, phrases, listening, exercises: exercises.slice(0, 5), quiz, source: "ai" };
}

export async function buildLesson(model: ModelTransport, settings: LearnSettings, topic: TopicDef, recentTitles: string[] = []): Promise<Lesson> {
  try {
    const t0 = Date.now();
    const text = await simplePrompt(model, lessonPrompt(settings, topic, recentTitles), { fast: true, json: true, temperature: 0.9 });
    const lesson = validateLesson(parseModelJson(text), topic, settings.level);
    if (lesson) {
      log.info("learn", `урок «${lesson.title}» сгенерирован за ${Date.now() - t0}мс (${lesson.vocab.length} слов, ${lesson.exercises.length} упр., ${lesson.quiz.length} вопр.)`);
      return lesson;
    }
    log.warn("learn", "модель вернула неполный урок — беру банк");
  } catch (e) {
    log.warn("learn", `генерация урока не удалась: ${errMsg(e)} — беру банк`);
  }
  return bankLesson(topic, settings.level);
}

/** Шаги урока по фокусу: грамматика и аудирование включаются, если выбраны; остальное всегда. */
export function planSteps(lesson: Lesson, focus: Focus[]): Step[] {
  const steps: Step[] = [{ kind: "intro" }, { kind: "vocab" }];
  if (focus.includes("grammar") && lesson.grammar) steps.push({ kind: "grammar" });
  steps.push({ kind: "phrases" });
  if (focus.includes("listening")) lesson.listening.forEach((_, idx) => steps.push({ kind: "listening", idx }));
  lesson.exercises.forEach((_, idx) => steps.push({ kind: "exercise", idx }));
  lesson.quiz.forEach((_, idx) => steps.push({ kind: "quiz", idx }));
  steps.push({ kind: "finish" });
  return steps;
}
