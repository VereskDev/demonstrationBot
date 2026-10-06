# assistant-bot

Личный помощник в Telegram: заметки, задачи с подзадачами, напоминания (разовые и повторяющиеся), картинки и открытки, схемы по описанию и по репозиторию GitHub. Движок (транспорт Gemini с хеджированием, реестр инструментов, цикл «модель → инструменты → ответ», очередь на чат, graceful shutdown) перенесён из бота Айман.

## Запуск

```bash
npm install
cp .env.example .env   # заполнить токены
npm start              # long polling, вебхук не нужен
```

Первый, кто напишет боту, становится владельцем (если `OWNER_TELEGRAM_ID` пуст). Остальным бот отвечает отказом.

- `npm run dev` — то же с автоперезапуском при правках.
- `npm run chat -- "напомни завтра в 9 позвонить маме"` — ход агента в консоли без Telegram (своя база `data/chat-cli.sqlite`, файлы в `data/out`).
- `npm test`, `npm run typecheck`.

## Ключи (.env)

| Переменная | Что это |
|---|---|
| `TELEGRAM_BOT_TOKEN` | токен от @BotFather |
| `GEMINI_API_KEY` | ключ Google AI Studio; `GEMINI_MODEL` (3.5-flash) и `GEMINI_FAST_MODEL` (3.5-flash-lite) |
| `CF_ACCOUNT_ID`, `CF_API_TOKEN` | Cloudflare Workers AI (FLUX) — картинки; без них работает запасной Pollinations с водяным знаком |
| `DEFAULT_TIMEZONE` | зона до того, как владелец скажет свою (`/tz Europe/Moscow`) |

## Как устроено

```
src/
  main.ts               старт: Telegram polling + планировщик + graceful shutdown
  config.ts             .env
  llm/gemini.ts         ModelTransport: function-calling, эхо thoughtSignature, ретраи, хедж между моделями
  llm/loop.ts           цикл инструментов
  tools/                notes, tasks, reminders, memory (факты, часовой пояс), media (картинки/открытки/схемы)
  agent/                системный промпт и один ход агента (история ↔ SQLite, outbox файлов)
  telegram/             Bot API, long polling, нормализация апдейтов, кнопки, роутинг
  scheduler/            напоминания: проверка каждые 15 с, повторы, «Готово / +10 мин / +1 час / Завтра»
  images/, diagrams/    Cloudflare FLUX + Pollinations; наложение текста (resvg); Graphviz (viz.js); GitDiagram + kroki
  db/                   node:sqlite, схема и запросы
  views.ts              детерминированные экраны кнопок меню
```

Модель: основная `gemini-3.5-flash` (thinking low). Если она не ответила за 5 с или вернула 429/503, параллельно стартует `gemini-3.5-flash-lite`, побеждает первый ответ. После сбоя основной минуту обе стартуют сразу.

Схемы репозиториев берутся с gitdiagram.com только уже сгенерированные; для нового репо бот даёт ссылку «открой один раз» и сам присылает схему, когда она появится (ждёт до 10 минут).
