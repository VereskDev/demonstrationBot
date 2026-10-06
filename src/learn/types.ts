/** Режим изучения языка (перенос «¡Habla!»): типы урока, сессий и настроек. */
import type { LlmMessage } from "../llm/types.ts";

export type Focus = "grammar" | "conversation" | "listening";
export const ALL_FOCUS: Focus[] = ["grammar", "conversation", "listening"];
export const FOCUS_LABEL: Record<Focus, string> = { grammar: "грамматика", conversation: "разговорная речь", listening: "аудирование" };
export type Level = "A1" | "A2" | "B1";
export const LEVELS: Level[] = ["A1", "A2", "B1"];

const FLAGS: Record<string, string> = { es: "🇪🇸", en: "🇬🇧", it: "🇮🇹", fr: "🇫🇷", de: "🇩🇪", pt: "🇵🇹", tr: "🇹🇷", kk: "🇰🇿", zh: "🇨🇳", ja: "🇯🇵", ko: "🇰🇷" };
export function langFlag(code: string): string {
  return FLAGS[String(code).toLowerCase()] ?? "🗣";
}

export interface TopicDef {
  id: string;
  title: string;
}
export const TOPICS: TopicDef[] = [
  { id: "greetings", title: "Приветствия и знакомство" },
  { id: "daily", title: "Распорядок дня" },
  { id: "food", title: "Еда и ресторан" },
  { id: "family", title: "Семья" },
  { id: "travel", title: "Путешествия" },
  { id: "weather", title: "Погода и досуг" },
];

export interface VocabItem {
  es: string;
  ru: string;
  example?: string;
  exampleRu?: string;
}
export interface Grammar {
  title: string;
  explanation: string;
  table?: string[][];
  examples?: Array<{ es: string; ru: string }>;
}
export interface Phrase {
  es: string;
  ru: string;
}
export interface ListeningItem {
  es: string;
  ru?: string;
  question: string;
  options: string[];
  answer: number;
}
export type Exercise =
  | { type: "fill"; sentence: string; answer: string; hint?: string; ru?: string }
  | { type: "choose"; question: string; options: string[]; answer: number }
  | { type: "translate"; ru: string; es: string; accept?: string[] };
export interface QuizItem {
  question: string;
  options: string[];
  answer: number;
}

export interface Lesson {
  topicId: string;
  topic: string;
  title: string;
  level: Level;
  vocab: VocabItem[];
  grammar?: Grammar;
  phrases: Phrase[];
  listening: ListeningItem[];
  exercises: Exercise[];
  quiz: QuizItem[];
  source: "ai" | "bank";
}

export type Step =
  | { kind: "intro" }
  | { kind: "vocab" }
  | { kind: "grammar" }
  | { kind: "phrases" }
  | { kind: "listening"; idx: number }
  | { kind: "exercise"; idx: number }
  | { kind: "quiz"; idx: number }
  | { kind: "finish" };

export interface LessonSession {
  kind: "lesson";
  lesson: Lesson;
  steps: Step[];
  i: number;
  /** Ошибки → в карточки (пары слово/перевод). */
  mistakes: Array<{ es: string; ru: string }>;
  exCorrect: number;
  exTotal: number;
  quizCorrect: number;
  awaitingText: boolean;
  startedAt: number;
}

export interface CardsSession {
  kind: "cards";
  queue: number[];
  i: number;
  revealed: boolean;
  known: number;
  unknown: number;
  messageId?: number;
}

export interface TalkSession {
  kind: "talk";
  topic: string;
  messages: LlmMessage[];
  turns: number;
  startedAt: number;
  /** Повторение карточек в разговоре: какие слова собеседница должна «вытащить» из ученика. */
  reviewCards?: Array<{ id: number; front: string; back: string }>;
}

export interface TopicPromptSession {
  kind: "topic_prompt";
}

/** Ждём тему для генерации карточек. */
export interface GenPromptSession {
  kind: "gen_prompt";
}

export type LearnSession = LessonSession | CardsSession | TalkSession | TopicPromptSession | GenPromptSession;

export interface LearnSettings {
  lang: string;
  langName: string;
  level: Level;
  focus: Focus[];
}

export interface LearnProgress {
  streak: number;
  lastLessonDate: string | null;
  lessonsTotal: number;
  topicCounts: Record<string, number>;
  history: Array<{ date: string; topic: string; score: number; total: number }>;
}
