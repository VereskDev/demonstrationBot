/**
 * Картинки, открытки и схемы. Файлы складываются в ctx.outbox — канал отправит их после текста.
 */
import { fetchGitDiagram, parseRepoUrl, renderMermaidPng, renderMermaidSvg } from "../diagrams/gitdiagram.ts";
import { renderDot } from "../diagrams/graphviz.ts";
import { composeCardSvg, imageSize, renderSvgToPng } from "../images/card.ts";
import { aspectToSize, generateImage } from "../images/generate.ts";
import { log, errMsg } from "../runtime/log.ts";
import type { Sender } from "../telegram/sender.ts";
import { argBool, argStr, type OutboxItem, type ToolDefinition } from "./types.ts";

const NO_TEXT_SUFFIX = ", no text, no letters, no watermark";

export function buildMediaTools(): ToolDefinition[] {
  return [
    {
      decl: {
        name: "generate_image",
        description:
          "Нарисовать картинку по описанию. prompt — подробное описание НА АНГЛИЙСКОМ (переведи и обогати запрос пользователя: сюжет, стиль, свет, детали). Текста на картинке не будет — для надписей используй make_card. Картинка уйдёт пользователю автоматически; в ответе кратко скажи, что нарисовал.",
        parameters: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "English prompt" },
            aspect: { type: "string", description: "1:1 | 4:5 | 5:4 | 3:4 | 4:3 | 16:9 | 9:16", enum: ["1:1", "4:5", "5:4", "3:4", "4:3", "16:9", "9:16"] },
            quality: { type: "boolean", description: "true — качественнее, но медленнее (~20 с)" },
          },
          required: ["prompt"],
        },
      },
      handler: async (args, ctx) => {
        const prompt = argStr(args, "prompt");
        if (!prompt) throw new Error("prompt пустой");
        void ctx.sender.typing(ctx.chatId, "upload_photo");
        const img = await generateImage(prompt, { aspect: argStr(args, "aspect") || undefined, quality: argBool(args, "quality") });
        ctx.outbox.push({ kind: "photo", bytes: img.bytes, mime: img.mime, fileName: `image.${img.mime === "image/png" ? "png" : "jpg"}` });
        return { sent: true, provider: img.provider, model: img.model.split("/").pop(), note: img.provider === "pollinations" ? "резервный сервис, в углу водяной знак" : undefined };
      },
    },
    {
      decl: {
        name: "make_card",
        description:
          "Открытка/постер с надписью: нейросеть рисует фон по background_prompt (English, БЕЗ текста, с пустым местом под надпись), а надпись text (на любом языке) накладывается поверх ровным шрифтом. Для поздравлений, приглашений, мотивационных постеров.",
        parameters: {
          type: "object",
          properties: {
            background_prompt: { type: "string", description: "English: scene, style, colors; leave empty space in the center" },
            text: { type: "string", description: "надпись, можно с переносами строк" },
            subtitle: { type: "string", description: "подпись мельче под надписью (необязательно)" },
            color: { type: "string", description: "hex цвет текста, например #4B1528; подбери контрастный к фону" },
            position: { type: "string", enum: ["center", "top", "bottom"] },
            aspect: { type: "string", enum: ["1:1", "4:5", "5:4", "3:4", "4:3", "16:9", "9:16"] },
            font: { type: "string", description: "семейство шрифта: Segoe Script (рукописный, по умолчанию), Georgia (классика), Arial Black (плакат), Segoe UI" },
          },
          required: ["background_prompt", "text"],
        },
      },
      handler: async (args, ctx) => {
        const bg = argStr(args, "background_prompt");
        const text = argStr(args, "text");
        if (!bg || !text) throw new Error("background_prompt и text обязательны");
        void ctx.sender.typing(ctx.chatId, "upload_photo");
        const img = await generateImage(bg + NO_TEXT_SUFFIX, { aspect: argStr(args, "aspect") || undefined });
        const size = imageSize(img.bytes) ?? aspectToSize(argStr(args, "aspect") || undefined);
        const svg = composeCardSvg(img, size.width, size.height, {
          text,
          subtitle: argStr(args, "subtitle") || undefined,
          color: argStr(args, "color") || undefined,
          position: (argStr(args, "position") as "center" | "top" | "bottom") || "center",
          font: argStr(args, "font") || undefined,
        });
        const png = renderSvgToPng(svg);
        ctx.outbox.push({ kind: "photo", bytes: png, mime: "image/png", fileName: "card.png" });
        return { sent: true, text, provider: img.provider };
      },
    },
    {
      decl: {
        name: "render_diagram",
        description:
          "Начертить схему (блок-схему, архитектуру, процесс, ментальную карту, оргструктуру) из кода Graphviz DOT. Напиши DOT сам: digraph с понятными подписями на языке пользователя, rankdir=LR для процессов слева направо или TB сверху вниз, subgraph cluster_* для группировки, 5–15 узлов. Подписи в двойных кавычках. Схема уйдёт картинкой автоматически.",
        parameters: {
          type: "object",
          properties: {
            dot: { type: "string", description: "полный код Graphviz DOT" },
            caption: { type: "string", description: "подпись к картинке, 1 строка" },
          },
          required: ["dot"],
        },
      },
      handler: async (args, ctx) => {
        const dot = argStr(args, "dot");
        if (!dot) throw new Error("dot пустой");
        void ctx.sender.typing(ctx.chatId, "upload_photo");
        let rendered;
        try {
          rendered = await renderDot(dot);
        } catch (e) {
          throw new Error(`Graphviz не принял DOT: ${errMsg(e).slice(0, 300)}. Исправь синтаксис и вызови снова.`);
        }
        const caption = argStr(args, "caption") || undefined;
        // Широкие/высокие схемы Telegram сожмёт — шлём ещё и файлом, чтобы можно было зумить.
        const big = rendered.width > 1600 || rendered.height > 1600 || rendered.png.length > 1_500_000;
        ctx.outbox.push({ kind: "photo", bytes: rendered.png, mime: "image/png", fileName: "diagram.png", caption });
        if (big) ctx.outbox.push({ kind: "document", bytes: rendered.png, mime: "image/png", fileName: "diagram.png", caption: "Схема файлом — в полном размере" });
        return { sent: true, width: rendered.width, height: rendered.height, alsoAsFile: big };
      },
    },
    {
      decl: {
        name: "repo_diagram",
        description:
          "Схема архитектуры публичного репозитория GitHub (через GitDiagram). Вызывай, когда пользователь прислал ссылку на github.com и хочет понять, как устроен проект. Если схемы ещё нет — пользователю нужно один раз открыть ссылку gitdiagram.com, бот дождётся и пришлёт сам.",
        parameters: { type: "object", properties: { url: { type: "string", description: "ссылка на репозиторий или owner/repo" } }, required: ["url"] },
      },
      handler: async (args, ctx) => {
        const ref = parseRepoUrl(argStr(args, "url"));
        if (!ref) throw new Error("не похоже на ссылку GitHub (нужно github.com/owner/repo)");
        void ctx.sender.typing(ctx.chatId, "upload_document");
        const res = await fetchGitDiagram(ref);
        if (!res.ok) {
          if (res.reason === "not_generated") {
            startRepoDiagramWatch(ctx.sender, ctx.chatId, ref);
            return {
              pending: true,
              instruction: `Схемы ещё нет. Пользователю нужно один раз открыть ${ref.diagramUrl} — GitDiagram построит её за минуту. Я слежу 10 минут и пришлю схему в чат сам, как только она появится. Передай это пользователю коротко, с ссылкой.`,
              link: ref.diagramUrl,
            };
          }
          throw new Error(res.message);
        }
        await pushRepoDiagram(ctx.outbox, ref, res.mermaid, res.updated);
        return { sent: true, repo: ref.slug, updated: res.updated, link: ref.diagramUrl, explanation: res.explanation.slice(0, 1500) };
      },
    },
  ];
}

async function pushRepoDiagram(outbox: OutboxItem[], ref: { slug: string; diagramUrl: string; repo: string }, mermaid: string, updated?: string): Promise<void> {
  const caption = `Архитектура ${ref.slug}${updated ? ` (GitDiagram, ${updated})` : ""}\nИнтерактивно: ${ref.diagramUrl}`;
  try {
    const png = await renderMermaidPng(mermaid);
    outbox.push({ kind: "document", bytes: png, mime: "image/png", fileName: `${ref.repo}-architecture.png`, caption });
  } catch (e) {
    log.warn("diag", `kroki png: ${errMsg(e)}`);
    const svg = await renderMermaidSvg(mermaid);
    if (svg) outbox.push({ kind: "document", bytes: svg, mime: "image/svg+xml", fileName: `${ref.repo}-architecture.svg`, caption });
    else outbox.push({ kind: "document", bytes: Buffer.from(mermaid, "utf8"), mime: "text/plain", fileName: `${ref.repo}-architecture.mmd`, caption: `${caption}\nРендер не удался — исходник Mermaid` });
  }
}

const watching = new Set<string>();

/** Фоновая проверка: схема появилась на GitDiagram → отправить в чат. До 10 минут, раз в 20 с. */
export function startRepoDiagramWatch(sender: Sender, chatId: string, ref: ReturnType<typeof parseRepoUrl> & object): void {
  const key = `${chatId}:${ref.slug}`;
  if (watching.has(key)) return;
  watching.add(key);
  const started = Date.now();
  const tick = async (): Promise<void> => {
    try {
      const res = await fetchGitDiagram(ref);
      if (res.ok) {
        watching.delete(key);
        const outbox: OutboxItem[] = [];
        await pushRepoDiagram(outbox, ref, res.mermaid, res.updated);
        for (const item of outbox) {
          if (item.kind === "document") await sender.sendDocument(chatId, item.bytes!, item.fileName ?? "diagram.png", item.caption, { mime: item.mime });
        }
        return;
      }
    } catch (e) {
      log.warn("diag", `watch ${ref.slug}: ${errMsg(e)}`);
    }
    if (Date.now() - started > 10 * 60_000) {
      watching.delete(key);
      await sender.sendText(chatId, `Схема ${ref.slug} на GitDiagram так и не появилась за 10 минут. Открой ${ref.diagramUrl}, дождись генерации и пришли ссылку ещё раз.`);
      return;
    }
    setTimeout(() => void tick(), 20_000).unref();
  };
  setTimeout(() => void tick(), 20_000).unref();
}
