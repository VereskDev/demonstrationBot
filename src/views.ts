/**
 * Детерминированные тексты для кнопок меню (без модели): списки заметок, дерево задач,
 * напоминания, план на день. Те же функции используют инструменты модели для кратких сводок.
 */
import { childCounts, listNotes, listReminders, listTasks, tasksDueBetween, type NoteRow, type ReminderRow, type TaskRow } from "./db/index.ts";
import { describeRepeat, formatDate, formatDateTime, localDateStr, nowIn } from "./time.ts";
import type { InlineButton } from "./telegram/sender.ts";

export const ICON = { note: "📝", task: "✅", todo: "◻️", done: "☑️", reminder: "⏰", today: "📅", draw: "🎨", diagram: "📐", help: "❓", repeat: "🔁", photo: "🖼" };

export function shortText(s: string, max = 60): string {
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
}

// ───────────────────────── заметки ─────────────────────────
export function noteLine(n: NoteRow, tz: string, now: number): string {
  const tags = n.tags ? " " + n.tags.split(",").map((t) => `#${t}`).join(" ") : "";
  return `${n.photo_file_id ? ICON.photo + " " : ""}${shortText(n.text, 70)}${tags} · ${formatDateTime(n.created_at, tz, now)}`;
}

export function notesView(chatId: string, tz: string, opts: { query?: string; offset?: number; limit?: number } = {}): { text: string; inline: InlineButton[][] } {
  const limit = opts.limit ?? 8;
  const offset = opts.offset ?? 0;
  const notes = listNotes(chatId, { query: opts.query, limit: limit + 1, offset });
  const hasMore = notes.length > limit;
  const page = notes.slice(0, limit);
  const now = Date.now();
  if (!page.length) {
    return {
      text: opts.query ? `По запросу «${opts.query}» заметок нет.` : "Заметок пока нет. Напиши что-нибудь вроде «запиши: идея для подарка маме», и я сохраню.",
      inline: [],
    };
  }
  const lines = page.map((n, i) => `${offset + i + 1}. ${noteLine(n, tz, now)}`);
  const header = opts.query ? `Заметки по запросу «${opts.query}»:` : `Последние заметки:`;
  const inline: InlineButton[][] = [];
  // Кнопки «открыть» рядами по 4 номера.
  const openRow: InlineButton[] = page.map((n, i) => ({ text: `${offset + i + 1}`, callback_data: `note:open:${n.id}` }));
  for (let i = 0; i < openRow.length; i += 4) inline.push(openRow.slice(i, i + 4));
  const nav: InlineButton[] = [];
  if (offset > 0) nav.push({ text: "← Новее", callback_data: `note:list:${Math.max(0, offset - limit)}` });
  if (hasMore) nav.push({ text: "Старше →", callback_data: `note:list:${offset + limit}` });
  if (nav.length) inline.push(nav);
  return { text: `${header}\n\n${lines.join("\n")}\n\nНомер под сообщением — открыть заметку целиком.`, inline };
}

export function noteView(n: NoteRow, tz: string): { text: string; inline: InlineButton[][] } {
  const tags = n.tags ? "\n" + n.tags.split(",").map((t) => `#${t}`).join(" ") : "";
  const text = `${ICON.note} Заметка №${n.id} · ${formatDateTime(n.created_at, tz)}\n\n${n.text}${tags}`;
  return { text, inline: [[{ text: "🗑 Удалить", callback_data: `note:del:${n.id}` }, { text: "← К списку", callback_data: "note:list:0" }]] };
}

// ───────────────────────── задачи ─────────────────────────
export function taskLine(t: TaskRow, tz: string, now: number, chatId: string): string {
  const counts = childCounts(chatId, t.id);
  const progress = counts.total ? ` (${counts.done}/${counts.total})` : "";
  const due = t.due ? ` · ${dueLabel(t.due, tz, now)}` : "";
  return `${t.done ? ICON.done : ICON.todo} ${t.title}${progress}${due}`;
}

export function dueLabel(due: string, tz: string, now: number): string {
  const label = formatDate(due, tz, now);
  const today = localDateStr(now, tz);
  const overdue = due.slice(0, 10) < today;
  return overdue ? `⚠️ просрочено (${label})` : `до: ${label}`;
}

export function tasksView(chatId: string, tz: string, parentId: number | null = null, opts: { includeDone?: boolean } = {}): { text: string; inline: InlineButton[][] } {
  const now = Date.now();
  const tasks = listTasks(chatId, { parentId, includeDone: opts.includeDone ?? parentId !== null });
  const parent = parentId !== null ? listTasks(chatId, { all: true, includeDone: true }).find((t) => t.id === parentId) : null;
  const header = parent ? `${parent.done ? ICON.done : ICON.task} ${parent.title}${parent.due ? ` · ${dueLabel(parent.due, tz, now)}` : ""}${parent.notes ? `\n${parent.notes}` : ""}\n` : "Задачи:";
  if (!tasks.length) {
    const empty = parent ? `${header}\nПодзадач нет.` : "Открытых задач нет. Скажи, например: «добавь задачу купить билеты до пятницы» или «разбей ремонт кухни на этапы».";
    const inline: InlineButton[][] = parent
      ? [[{ text: parent.done ? "↩️ Вернуть" : "✅ Выполнено", callback_data: `task:toggle:${parent.id}:${parent.parent_id ?? 0}` }, { text: "← Назад", callback_data: `task:list:${parent.parent_id ?? 0}` }]]
      : [[{ text: "Показать выполненные", callback_data: "task:list:0:done" }]];
    return { text: empty, inline };
  }
  const lines = tasks.map((t, i) => `${i + 1}. ${taskLine(t, tz, now, chatId)}`);
  const inline: InlineButton[][] = [];
  const row: InlineButton[] = tasks.slice(0, 16).map((t, i) => ({ text: `${t.done ? "☑" : "◻"} ${i + 1}`, callback_data: `task:toggle:${t.id}:${parentId ?? 0}` }));
  for (let i = 0; i < row.length; i += 4) inline.push(row.slice(i, i + 4));
  const withChildren = tasks.filter((t) => childCounts(chatId, t.id).total > 0).slice(0, 8);
  if (withChildren.length) inline.push(withChildren.map((t) => ({ text: `📂 ${shortText(t.title, 14)}`, callback_data: `task:list:${t.id}` })));
  const nav: InlineButton[] = [];
  if (parent) {
    nav.push({ text: parent.done ? "↩️ Вернуть проект" : "✅ Проект выполнен", callback_data: `task:toggle:${parent.id}:${parent.parent_id ?? 0}` });
    nav.push({ text: "← Назад", callback_data: `task:list:${parent.parent_id ?? 0}` });
  } else {
    nav.push({ text: opts.includeDone ? "Скрыть выполненные" : "Показать выполненные", callback_data: opts.includeDone ? "task:list:0" : "task:list:0:done" });
  }
  inline.push(nav);
  const hint = parent ? "Нажми номер — отметить выполненной." : "Номер — отметить выполненной, 📂 — открыть подзадачи.";
  return { text: `${header}\n\n${lines.join("\n")}\n\n${hint}`, inline };
}

// ───────────────────────── напоминания ─────────────────────────
export function reminderLine(r: ReminderRow, tz: string, now: number): string {
  const rep = r.repeat ? ` ${ICON.repeat} ${describeRepeat(r.repeat)}` : "";
  return `${r.active ? ICON.reminder : "💤"} ${r.text} — ${formatDateTime(r.at_utc, tz, now)}${rep}`;
}

export function remindersView(chatId: string, tz: string): { text: string; inline: InlineButton[][] } {
  const now = Date.now();
  const list = listReminders(chatId, { limit: 20 });
  if (!list.length) return { text: "Активных напоминаний нет. Скажи, например: «напомни завтра в 9 позвонить маме» или «каждый будний день в 8:30 витамины».", inline: [] };
  const lines = list.map((r, i) => `${i + 1}. ${reminderLine(r, tz, now)}`);
  const inline: InlineButton[][] = [];
  const row: InlineButton[] = list.slice(0, 16).map((r, i) => ({ text: `✖ ${i + 1}`, callback_data: `rem:cancel:${r.id}` }));
  for (let i = 0; i < row.length; i += 4) inline.push(row.slice(i, i + 4));
  return { text: `Напоминания:\n\n${lines.join("\n")}\n\n✖ с номером — отменить.`, inline };
}

export function reminderFireButtons(id: number): InlineButton[][] {
  return [
    [
      { text: "✅ Готово", callback_data: `rem:done:${id}` },
      { text: "+10 мин", callback_data: `rem:snooze:${id}:10` },
      { text: "+1 час", callback_data: `rem:snooze:${id}:60` },
    ],
    [{ text: "📅 Завтра", callback_data: `rem:tomorrow:${id}` }],
  ];
}

// ───────────────────────── сегодня ─────────────────────────
export function agendaView(chatId: string, tz: string, dayOffset = 0): { text: string; inline: InlineButton[][] } {
  const now = Date.now();
  const day = nowIn(tz, now).plus({ days: dayOffset }).startOf("day");
  const dayStr = day.toFormat("yyyy-MM-dd");
  const { due, overdue } = tasksDueBetween(chatId, dayStr, dayStr);
  const dayStart = day.toMillis();
  const dayEnd = day.plus({ days: 1 }).toMillis();
  const rems = listReminders(chatId, { limit: 100 }).filter((r) => r.at_utc >= dayStart && r.at_utc < dayEnd);
  const title = dayOffset === 0 ? "Сегодня" : dayOffset === 1 ? "Завтра" : formatDate(dayStr, tz, now);
  const parts: string[] = [`${ICON.today} ${title}, ${day.toFormat("d")} ${["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"][day.month - 1]}`];
  if (rems.length) parts.push(`\nНапоминания:\n${rems.map((r) => `${ICON.reminder} ${nowIn(tz, r.at_utc).toFormat("HH:mm")} — ${r.text}${r.repeat ? ` ${ICON.repeat}` : ""}`).join("\n")}`);
  if (due.length) parts.push(`\nЗадачи со сроком:\n${due.map((t) => `${ICON.todo} ${t.title}${/T\d{2}:\d{2}/.test(t.due ?? "") ? ` (${t.due!.slice(11, 16)})` : ""}`).join("\n")}`);
  if (dayOffset === 0 && overdue.length) parts.push(`\nПросрочено:\n${overdue.map((t) => `⚠️ ${t.title} — ${formatDate(t.due!, tz, now)}`).join("\n")}`);
  if (!rems.length && !due.length && !(dayOffset === 0 && overdue.length)) parts.push("\nНичего не запланировано. Свободный день.");
  const inline: InlineButton[][] = [[]];
  if (dayOffset > -1) inline[0].push({ text: "← Пред.", callback_data: `agenda:${dayOffset - 1}` });
  if (dayOffset !== 0) inline[0].push({ text: "Сегодня", callback_data: "agenda:0" });
  inline[0].push({ text: "След. →", callback_data: `agenda:${dayOffset + 1}` });
  return { text: parts.join("\n"), inline };
}

export const HELP_TEXT = `Я личный помощник. Пиши обычным языком, голосом или кидай фото.

${ICON.note} Заметки: «запиши: …», «найди заметку про …», «покажи заметки с тегом #идеи». Фото с подписью тоже сохраню.
${ICON.task} Задачи: «добавь задачу …», «разбей переезд на этапы», «что по проекту ремонт?», «сделал билеты».
${ICON.reminder} Напоминания: «напомни завтра в 9 …», «каждый будний день в 8:30 …», «каждое 25-е число …». Когда придёт — кнопки «Готово / +10 мин / +1 час / Завтра».
${ICON.today} Сегодня: сроки и напоминания на день.
${ICON.draw} Нарисовать: «нарисуй кота-космонавта», «открытка маме с днём рождения, акварель».
${ICON.diagram} Схема: «схема: как работает оплата на сайте», «нарисуй схему нашего пайплайна». Ссылка на репозиторий GitHub — схема его архитектуры.
🇪🇸 Испанский: урок дня на 15 минут (словарь с озвучкой, грамматика, фразы, аудирование, упражнения, тест), карточки с интервальным повторением, живой разговор с «носителем». «Давай урок», «поговорим про еду», «карточка: la mesa — стол».

Команды: /today — план дня, /new — начать диалог заново (память заметок и задач не трогается), /tz Europe/Moscow — часовой пояс, /id — мой Telegram ID.`;
