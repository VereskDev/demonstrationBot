/** Основная клавиатура и тексты кнопок (по ним роутим без модели). */
export const BTN = {
  notes: "📝 Заметки",
  tasks: "✅ Задачи",
  reminders: "⏰ Напоминания",
  today: "📅 Сегодня",
  draw: "🎨 Нарисовать",
  diagram: "📐 Схема",
  learn: "🗣 Язык",
  help: "❓ Помощь",
  back: "◀️ Назад к меню",
} as const;

export const MAIN_KEYBOARD: string[][] = [
  [BTN.notes, BTN.tasks],
  [BTN.reminders, BTN.today],
  [BTN.draw, BTN.diagram],
  [BTN.learn, BTN.help],
];

export const BOT_COMMANDS = [
  { command: "start", description: "Запуск и клавиатура" },
  { command: "today", description: "План на сегодня" },
  { command: "notes", description: "Последние заметки" },
  { command: "tasks", description: "Задачи" },
  { command: "reminders", description: "Напоминания" },
  { command: "learn", description: "Язык: урок дня, карточки, разговор" },
  { command: "stop", description: "Закончить урок или разговор" },
  { command: "new", description: "Начать диалог заново" },
  { command: "tz", description: "Часовой пояс: /tz Europe/Moscow" },
  { command: "help", description: "Что умею" },
];
