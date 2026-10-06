/** Текст из pptx/docx без зависимостей: собираем zip вручную (метод store) и читаем обратно. */
import { describe, expect, it } from "vitest";
import zlib from "node:zlib";
import { extractOfficeText, officeKind, unzipEntries } from "../src/files/office.ts";

/** Минимальный zip: локальные заголовки + центральный каталог + EOCD. deflate=true — метод 8. */
function makeZip(files: Array<{ name: string; data: string }>, deflate = false): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const raw = Buffer.from(f.data, "utf8");
    const data = deflate ? zlib.deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(deflate ? 8 : 0, 10);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, name]));
    parts.push(local, name, data);
    offset += local.length + name.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}

describe("office", () => {
  it("определяет тип по mime и имени", () => {
    expect(officeKind("application/vnd.openxmlformats-officedocument.presentationml.presentation", "x.pptx")).toBe("pptx");
    expect(officeKind("application/octet-stream", "Отчёт.docx")).toBe("docx");
    expect(officeKind("application/pdf", "a.pdf")).toBeNull();
  });
  it("pptx: слайды по порядку, заметки, сущности", () => {
    const zip = makeZip(
      [
        { name: "ppt/slides/slide2.xml", data: '<p:sld><a:p><a:r><a:t>Второй</a:t></a:r><a:r><a:t> слайд &amp; точка</a:t></a:r></a:p></p:sld>' },
        { name: "ppt/slides/slide1.xml", data: '<p:sld><a:p><a:t>Заголовок</a:t></a:p><a:p><a:t>Пункт один</a:t></a:p></p:sld>' },
        { name: "ppt/notesSlides/notesSlide1.xml", data: "<p:notes><a:p><a:t>Сказать привет</a:t></a:p></p:notes>" },
        { name: "ppt/slideLayouts/slideLayout1.xml", data: "<p:sldLayout><a:t>мусор</a:t></p:sldLayout>" },
      ],
      true,
    );
    const t = extractOfficeText(zip, "pptx");
    expect(t.parts).toBe(2);
    expect(t.text).toBe("--- Слайд 1 ---\nЗаголовок\nПункт один\n[заметки] Сказать привет\n\n--- Слайд 2 ---\nВторой слайд & точка");
  });
  it("docx: абзацы", () => {
    const zip = makeZip([{ name: "word/document.xml", data: '<w:document><w:p><w:r><w:t xml:space="preserve">Привет, </w:t></w:r><w:r><w:t>мир</w:t></w:r></w:p><w:p><w:t>Вторая строка</w:t></w:p></w:document>' }]);
    expect(extractOfficeText(zip, "docx").text).toBe("Привет, мир\nВторая строка");
  });
  it("xlsx: общие строки и числа", () => {
    const zip = makeZip([
      { name: "xl/sharedStrings.xml", data: "<sst><si><t>Товар</t></si><si><t>Цена</t></si></sst>" },
      { name: "xl/worksheets/sheet1.xml", data: '<worksheet><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row><c t="inlineStr"><is><t>Хлеб</t></is></c><c><v>45</v></c></row></worksheet>' },
    ]);
    expect(extractOfficeText(zip, "xlsx").text).toBe("--- sheet1.xml ---\nТовар | Цена\nХлеб | 45");
  });
  it("не zip → понятная ошибка", () => {
    expect(() => unzipEntries(Buffer.from("not a zip at all"), () => true)).toThrow(/не zip/);
  });
});
