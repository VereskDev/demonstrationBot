/**
 * Открытка = фон от нейросети (без текста) + надпись, наложенная локально через SVG → PNG
 * (resvg, системные шрифты Windows/Linux). Так русский текст всегда ровный, а не «иероглифы»
 * FLUX. Текст переносится по словам под ширину, размер шрифта подбирается под число строк.
 */
import { Resvg } from "@resvg/resvg-js";
import { escapeHtml } from "../telegram/format.ts";

export interface CardTextOptions {
  text: string;
  /** Цвет надписи (hex). */
  color?: string;
  /** Обводка под текст для читаемости на пёстром фоне. */
  strokeColor?: string;
  /** Семейство шрифта; должно быть установлено в системе. */
  font?: string;
  /** Где надпись: center | top | bottom. */
  position?: "center" | "top" | "bottom";
  /** Подпись меньшим шрифтом под основной надписью. */
  subtitle?: string;
}

/** Перенос строки по словам: максимум maxChars символов в строке. */
export function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const para of String(text).split(/\n/)) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let cur = "";
    for (const w of words) {
      if (!cur) cur = w;
      else if ((cur + " " + w).length <= maxChars) cur += " " + w;
      else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

export function composeCardSvg(background: { bytes: Buffer; mime: string }, width: number, height: number, opts: CardTextOptions): string {
  const font = opts.font || "Segoe Script, Comic Sans MS, Arial";
  const color = opts.color || "#3C3489";
  const stroke = opts.strokeColor ?? "rgba(255,255,255,0.85)";
  // Размер шрифта: чем длиннее текст, тем мельче; строка не шире ~80% ширины.
  const total = opts.text.replace(/\s+/g, " ").trim().length;
  const fontSize = Math.max(34, Math.min(Math.round(width / 11), Math.round((width * 0.8) / Math.max(10, Math.sqrt(total) * 2.2))));
  const maxChars = Math.max(10, Math.floor((width * 0.8) / (fontSize * 0.55)));
  const lines = wrapText(opts.text, maxChars);
  const lineH = Math.round(fontSize * 1.25);
  const subSize = Math.round(fontSize * 0.55);
  const subLines = opts.subtitle ? wrapText(opts.subtitle, Math.floor((width * 0.8) / (subSize * 0.55))) : [];
  const blockH = lines.length * lineH + (subLines.length ? subLines.length * Math.round(subSize * 1.3) + Math.round(fontSize * 0.5) : 0);
  let startY: number;
  if (opts.position === "top") startY = Math.round(height * 0.12) + fontSize;
  else if (opts.position === "bottom") startY = height - Math.round(height * 0.1) - blockH + fontSize;
  else startY = Math.round((height - blockH) / 2) + fontSize;

  const textEls = lines
    .map((line, i) => `<text x="${width / 2}" y="${startY + i * lineH}" text-anchor="middle" font-family="${escapeHtml(font)}" font-size="${fontSize}" font-weight="bold" fill="${color}" stroke="${stroke}" stroke-width="${Math.max(2, Math.round(fontSize / 14))}" paint-order="stroke" stroke-linejoin="round">${escapeHtml(line)}</text>`)
    .join("");
  const subStart = startY + lines.length * lineH + Math.round(fontSize * 0.3);
  const subEls = subLines
    .map((line, i) => `<text x="${width / 2}" y="${subStart + i * Math.round(subSize * 1.3)}" text-anchor="middle" font-family="${escapeHtml(font)}" font-size="${subSize}" fill="${color}" stroke="${stroke}" stroke-width="2" paint-order="stroke">${escapeHtml(line)}</text>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}"><image href="data:${background.mime};base64,${background.bytes.toString("base64")}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>${textEls}${subEls}</svg>`;
}

export function renderSvgToPng(svg: string, opts: { width?: number; background?: string } = {}): Buffer {
  const r = new Resvg(svg, {
    ...(opts.width ? { fitTo: { mode: "width", value: opts.width } } : {}),
    font: { loadSystemFonts: true, defaultFontFamily: "Arial" },
    ...(opts.background ? { background: opts.background } : {}),
  });
  return r.render().asPng();
}

export function imageSize(bytes: Buffer): { width: number; height: number } | null {
  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  // JPEG: ищем SOF0/SOF2
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      const len = bytes.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}
