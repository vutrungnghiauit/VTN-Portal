import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type ParsedTimetablePdfRow = Record<string, string | number | null>;
type PdfTextItem = { str: string; transform: number[]; width?: number };
type PositionedText = { text: string; x: number; y: number; width: number };
type HeaderField = { key: string; x: number };

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").replace(/[–—−]/g, "-").replace(/\s+/g, " ").trim().toLocaleLowerCase("vi-VN");
const headerAliases: Record<string, string[]> = {
  academicYear: ["nien khoa", "nam hoc"], semesterName: ["hoc ky", "hk", "dot"], courseCode: ["ma lhp", "ma lop hoc phan", "ma hoc phan"],
  subjectName: ["ten mon hoc", "ten hoc phan"], credits: ["so tc", "so tin chi", "tin chi"], classCode: ["lop du kien", "ma lop"],
  mergedClassCode: ["ma lop ghep"], weekday: ["thu"], periods: ["tiet"], scheduleType: ["loai lich"], periodCount: ["so tiet"],
  classSize: ["si so"], startDate: ["ngay bat dau"], endDate: ["ngay ket thuc"], weekNumbers: ["tuan hoc"], totalPeriods: ["tong so tiet"],
  room: ["phong"], lecturer: ["giang vien"], notes: ["ghi chu"],
};

function fieldForHeader(value: string) {
  const text = normalize(value).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const matches = Object.entries(headerAliases).flatMap(([key, aliases]) => aliases.map((alias) => ({ key, alias: normalize(alias) })).filter(({ alias }) => text === alias || text.startsWith(`${alias} `)));
  return matches.sort((a, b) => Number(b.alias === text) - Number(a.alias === text) || b.alias.length - a.alias.length)[0]?.key ?? "";
}

function groupLines(items: PositionedText[]) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Array<{ y: number; items: PositionedText[] }> = [];
  for (const item of sorted) {
    let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 2.5);
    if (!line) { line = { y: item.y, items: [] }; lines.push(line); }
    line.items.push(item);
  }
  return lines.map((line) => ({ ...line, items: line.items.sort((a, b) => a.x - b.x) }));
}

function mapHeaders(items: PositionedText[]): HeaderField[] {
  const found = new Map<string, HeaderField>();
  for (let index = 0; index < items.length; index += 1) {
    let combined = "";
    for (let next = index; next < Math.min(items.length, index + 3); next += 1) {
      if (next > index && items[next].x - (items[next - 1].x + items[next - 1].width) > 18) break;
      combined = `${combined} ${items[next].text}`.trim();
      const key = fieldForHeader(combined);
      if (key && !found.has(key)) found.set(key, { key, x: items[index].x });
    }
  }
  return [...found.values()].sort((a, b) => a.x - b.x);
}

function getCell(line: PositionedText[], headers: HeaderField[], key: string) {
  const index = headers.findIndex((header) => header.key === key);
  if (index < 0) return "";
  const header = headers[index];
  const lower = index ? (headers[index - 1].x + header.x) / 2 : Number.NEGATIVE_INFINITY;
  const upper = index < headers.length - 1 ? (header.x + headers[index + 1].x) / 2 : Number.POSITIVE_INFINITY;
  return line.filter((item) => item.x >= lower && item.x < upper).map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
}

function normalizedDate(value: string) {
  const match = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : value;
}

export async function extractTimetablePdf(file: File): Promise<ParsedTimetablePdfRow[]> {
  if (!file.name.toLocaleLowerCase().endsWith(".pdf") && file.type !== "application/pdf") throw new Error("Hãy chọn tệp PDF.");
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const document = await task.promise;
  try {
    const parsed: ParsedTimetablePdfRow[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = (content.items as unknown as PdfTextItem[]).flatMap((item) => {
        const text = item.str?.trim();
        if (!text || !item.transform) return [];
        return [{ text, x: item.transform[4], y: item.transform[5], width: item.width ?? text.length * 4 }];
      });
      const lines = groupLines(items);
      const headerIndex = lines.findIndex((line) => {
        const keys = new Set(mapHeaders(line.items).map((header) => header.key));
        return ["semesterName", "courseCode", "subjectName", "classCode"].every((key) => keys.has(key));
      });
      if (headerIndex < 0) continue;
      const headerLine = lines[headerIndex];
      const headers = mapHeaders(headerLine.items);
      for (const line of lines.slice(headerIndex + 1)) {
        const values: ParsedTimetablePdfRow = {};
        for (const header of headers) {
          const value = getCell(line.items, headers, header.key);
          if (value) values[header.key] = value;
        }
        const courseCode = String(values.courseCode ?? "");
        const subjectName = String(values.subjectName ?? "");
        const classCode = String(values.classCode ?? "");
        const semesterName = String(values.semesterName ?? "");
        if (!courseCode || !subjectName || !classCode || !semesterName) continue;
        if (/^(mã|ma)\b/i.test(courseCode) || /^(tên|ten)\b/i.test(subjectName)) continue;
        if (values.startDate) values.startDate = normalizedDate(String(values.startDate));
        if (values.endDate) values.endDate = normalizedDate(String(values.endDate));
        if (values.weekNumbers) values.weekNumbers = String(values.weekNumbers).match(/\d+/g)?.join(",") ?? "";
        parsed.push(values);
      }
    }
    if (!parsed.length) throw new Error("Không tìm thấy bảng thời khóa biểu có các cột Học kỳ, Mã LHP, Tên môn học và Lớp dự kiến. PDF cần có lớp văn bản, không phải bản scan.");
    const unique = new Map<string, ParsedTimetablePdfRow>();
    for (const row of parsed) unique.set([row.semesterName, row.courseCode, row.classCode, row.weekday, row.periods].join("|"), row);
    return [...unique.values()];
  } finally {
    await task.destroy();
  }
}
