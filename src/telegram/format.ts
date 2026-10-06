/**
 * Текст модели → HTML Telegram. Модель просим писать простым текстом; тут лишь экранируем HTML,
 * переводим **жирный**, `код` и маркеры списков, чтобы в чате было опрятно. Разбивка длинных
 * ответов — splitForChannel из движка Айман (orchestratorChannel.ts).
 */
export const TELEGRAM_TEXT_LIMIT = 4096;
export const TELEGRAM_CAPTION_LIMIT = 1024;

export function escapeHtml(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function toTelegramHtml(text: string): string {
  let t = escapeHtml(String(text ?? "").replace(/\r\n/g, "\n").trim());
  // заголовки markdown → жирная строка
  t = t.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");
  // **жирный**, __жирный__
  t = t.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/__(.+?)__/g, "<b>$1</b>");
  // `код`
  t = t.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  // *курсив* (одиночные звёздочки вокруг слова/фразы без переносов)
  t = t.replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s.,!?;:)]|$)/g, "$1<i>$2</i>");
  // маркеры списков
  t = t.replace(/^[ \t]*[-*•]\s+/gm, "• ");
  // убираем лишние пустые строки
  t = t.replace(/\n{3,}/g, "\n\n");
  return t;
}

export function splitForChannel(text: string, max: number = TELEGRAM_TEXT_LIMIT): string[] {
  const t = String(text ?? "").trim();
  if (!t) return [];
  if (t.length <= max) return [t];
  const parts: string[] = [];
  let buf = "";
  const flush = () => {
    if (buf.trim()) parts.push(buf.trim());
    buf = "";
  };
  for (const para of t.split(/\n{2,}/)) {
    const block = para.trim();
    if (!block) continue;
    if (block.length > max) {
      flush();
      let sent = "";
      for (const piece of block.split(/(?<=[.!?…])\s+/)) {
        if ((sent + " " + piece).trim().length > max) {
          if (sent.trim()) parts.push(sent.trim());
          sent = piece;
        } else {
          sent = (sent ? sent + " " : "") + piece;
        }
      }
      if (sent.trim()) parts.push(sent.trim());
      continue;
    }
    if ((buf ? buf.length + 2 : 0) + block.length > max) flush();
    buf = buf ? `${buf}\n\n${block}` : block;
  }
  flush();
  const hard: string[] = [];
  for (const part of parts) {
    if (part.length <= max) {
      hard.push(part);
      continue;
    }
    for (let i = 0; i < part.length; i += max) hard.push(part.slice(i, i + max));
  }
  return hard.filter(Boolean);
}

export function capText(text: string, max: number): string {
  const t = String(text ?? "");
  if (t.length <= max) return t;
  const head = t.slice(0, max - 1);
  const cut = Math.max(head.lastIndexOf("."), head.lastIndexOf("!"), head.lastIndexOf("?"), head.lastIndexOf("\n"));
  return (cut > max * 0.5 ? head.slice(0, cut + 1) : head.trimEnd() + "…").trimEnd();
}
