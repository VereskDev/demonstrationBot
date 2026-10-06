import { addNote, deleteNote, getNote, listNotes, updateNote } from "../db/index.ts";
import { formatDateTime } from "../time.ts";
import { argList, argNum, argStr, type ToolDefinition } from "./types.ts";

function noteOut(n: { id: number; text: string; tags: string; photo_file_id: string | null; created_at: number }, tz: string) {
  return { id: n.id, text: n.text, tags: n.tags ? n.tags.split(",") : [], hasPhoto: Boolean(n.photo_file_id), created: formatDateTime(n.created_at, tz) };
}

export function buildNoteTools(): ToolDefinition[] {
  return [
    {
      decl: {
        name: "add_note",
        description:
          "Сохранить заметку (мысль, идея, факт, список покупок, что угодно). Если пользователь прислал фото с подписью и просит сохранить — фото прикрепится автоматически. Теги — короткие слова без #.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "текст заметки как есть, без пересказа" },
            tags: { type: "array", items: { type: "string" }, description: "теги, например [\"идеи\", \"работа\"]" },
          },
          required: ["text"],
        },
      },
      handler: async (args, ctx) => {
        const text = argStr(args, "text");
        if (!text) throw new Error("text пустой");
        const n = addNote(ctx.chatId, text, argList(args, "tags"), ctx.incomingPhotoFileId);
        ctx.changed.add("notes");
        return noteOut(n, ctx.tz);
      },
    },
    {
      decl: {
        name: "find_notes",
        description: "Найти заметки по словам или тегу, либо показать последние. Возвращает до limit заметок, новые первыми.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "слова для поиска (по подстроке)" },
            tag: { type: "string", description: "тег без #" },
            limit: { type: "integer", description: "сколько вернуть, по умолчанию 10" },
          },
        },
      },
      handler: async (args, ctx) => {
        const notes = listNotes(ctx.chatId, { query: argStr(args, "query") || undefined, tag: argStr(args, "tag") || undefined, limit: argNum(args, "limit") ?? 10 });
        return { count: notes.length, notes: notes.map((n) => noteOut(n, ctx.tz)) };
      },
    },
    {
      decl: {
        name: "get_note",
        description: "Показать заметку целиком по id (и отправить её фото, если есть).",
        parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
      },
      handler: async (args, ctx) => {
        const id = argNum(args, "id");
        const n = id ? getNote(ctx.chatId, id) : null;
        if (!n) throw new Error(`заметка ${id} не найдена`);
        if (n.photo_file_id) ctx.outbox.push({ kind: "photo", fileId: n.photo_file_id, caption: n.text.slice(0, 900) });
        return noteOut(n, ctx.tz);
      },
    },
    {
      decl: {
        name: "update_note",
        description: "Изменить текст или теги заметки.",
        parameters: {
          type: "object",
          properties: { id: { type: "integer" }, text: { type: "string" }, tags: { type: "array", items: { type: "string" } } },
          required: ["id"],
        },
      },
      handler: async (args, ctx) => {
        const id = argNum(args, "id");
        if (!id) throw new Error("id обязателен");
        const n = updateNote(ctx.chatId, id, { text: argStr(args, "text") || undefined, tags: args.tags !== undefined ? argList(args, "tags") : undefined });
        if (!n) throw new Error(`заметка ${id} не найдена`);
        ctx.changed.add("notes");
        return noteOut(n, ctx.tz);
      },
    },
    {
      decl: {
        name: "delete_note",
        description: "Удалить заметку по id. Удаляй только когда пользователь явно попросил.",
        parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
      },
      handler: async (args, ctx) => {
        const id = argNum(args, "id");
        if (!id || !deleteNote(ctx.chatId, id)) throw new Error(`заметка ${id} не найдена`);
        ctx.changed.add("notes");
        return { deleted: id };
      },
    },
  ];
}
