/**
 * Текст из офисных файлов без зависимостей: pptx/docx/xlsx — это zip с XML внутри. Читаем
 * центральный каталог zip, распаковываем нужные части (inflateRaw), собираем текстовые узлы.
 * Хватает, чтобы модель пересказала презентацию или документ; форматирование не нужно.
 */
import zlib from "node:zlib";

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

function readCentralDirectory(buf: Buffer): ZipEntry[] {
  // End of central directory: сигнатура 0x06054b50, ищем с конца (комментарий ≤ 64 КБ).
  const min = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("не zip-архив");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    entries.push({ name, method, compressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(buf: Buffer, e: ZipEntry): Buffer {
  const p = e.localOffset;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error(`битый локальный заголовок: ${e.name}`);
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return Buffer.from(data);
  if (e.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`неподдерживаемое сжатие ${e.method}: ${e.name}`);
}

export function unzipEntries(buf: Buffer, pick: (name: string) => boolean): Array<{ name: string; data: Buffer }> {
  return readCentralDirectory(buf)
    .filter((e) => pick(e.name))
    .map((e) => ({ name: e.name, data: readEntry(buf, e) }));
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Текст из XML: узлы <tag>…</tag> склеиваем, абзацы <paraTag> переводим в строки. */
function textFromXml(xml: string, textTag: string, paraTag: string): string {
  const out: string[] = [];
  for (const para of xml.split(new RegExp(`</${paraTag}>`))) {
    const parts: string[] = [];
    const re = new RegExp(`<${textTag}(?:\\s[^>]*)?>([^<]*)</${textTag}>`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(para))) parts.push(decodeEntities(m[1]));
    const line = parts.join("").replace(/\s+/g, " ").trim();
    if (line) out.push(line);
  }
  return out.join("\n");
}

export interface OfficeText {
  kind: "pptx" | "docx" | "xlsx";
  text: string;
  /** Для pptx — число слайдов, для xlsx — листов. */
  parts: number;
}

export function officeKind(mime: string, fileName = ""): OfficeText["kind"] | null {
  const n = fileName.toLowerCase();
  if (/presentationml|\.pptx$/.test(mime) || n.endsWith(".pptx")) return "pptx";
  if (/wordprocessingml|\.docx$/.test(mime) || n.endsWith(".docx")) return "docx";
  if (/spreadsheetml|\.xlsx$/.test(mime) || n.endsWith(".xlsx")) return "xlsx";
  return null;
}

export function extractOfficeText(buf: Buffer, kind: OfficeText["kind"], maxChars = 60_000): OfficeText {
  if (kind === "pptx") {
    const slides = unzipEntries(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(
      (a, b) => Number(a.name.match(/\d+/)?.[0]) - Number(b.name.match(/\d+/)?.[0]),
    );
    const notes = new Map(
      unzipEntries(buf, (n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)).map((e) => [Number(e.name.match(/\d+/)?.[0]), textFromXml(e.data.toString("utf8"), "a:t", "a:p")]),
    );
    const chunks = slides.map((s, i) => {
      const body = textFromXml(s.data.toString("utf8"), "a:t", "a:p");
      const note = notes.get(Number(s.name.match(/\d+/)?.[0]));
      return `--- Слайд ${i + 1} ---\n${body}${note ? `\n[заметки] ${note}` : ""}`;
    });
    return { kind, parts: slides.length, text: chunks.join("\n\n").slice(0, maxChars) };
  }
  if (kind === "docx") {
    const doc = unzipEntries(buf, (n) => n === "word/document.xml")[0];
    if (!doc) throw new Error("в docx нет word/document.xml");
    return { kind, parts: 1, text: textFromXml(doc.data.toString("utf8"), "w:t", "w:p").slice(0, maxChars) };
  }
  const shared = unzipEntries(buf, (n) => n === "xl/sharedStrings.xml")[0];
  const strings = shared ? textFromXml(shared.data.toString("utf8"), "t", "si").split("\n") : [];
  const sheets = unzipEntries(buf, (n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const lines: string[] = [];
  for (const sh of sheets) {
    lines.push(`--- ${sh.name.replace("xl/worksheets/", "")} ---`);
    const xml = sh.data.toString("utf8");
    for (const row of xml.split("</row>")) {
      const cells: string[] = [];
      const re = /<c\b([^>]*)>(?:<f>[^<]*<\/f>)?(?:<v>([^<]*)<\/v>|<is><t>([^<]*)<\/t><\/is>)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(row))) {
        const isShared = /t="s"/.test(m[1]);
        const v = m[2] ?? m[3] ?? "";
        cells.push(isShared ? (strings[Number(v)] ?? v) : decodeEntities(v));
      }
      if (cells.length) lines.push(cells.join(" | "));
    }
  }
  return { kind, parts: sheets.length, text: lines.join("\n").slice(0, maxChars) };
}
