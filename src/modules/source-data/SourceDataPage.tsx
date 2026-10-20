import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Database, Download, Eye, FileUp, Pencil, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import * as XLSX from "xlsx";
import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { SpreadsheetValue } from "../workspace/SpreadsheetTransferPanel";
import { extractTimetablePdf } from "../timetable/timetable-pdf";
import { workspaceService, type WorkspaceRecord } from "../workspace/workspace.service";
import { moduleDefinitions } from "../workspace/module-definitions";
import { permissionResources, resourcePermissionKeys } from "../accounts/permission-catalog";
import { sourceDataSections, type SourceDataSection } from "./source-data.config";
import { sourceDataService, type SourceDataClassification, type SourceDataRow, type StoredSourceFile, type SourceDataScope } from "./source-data.service";
import { progressRowsFromRecognizedText } from "../workspace/teaching-plan-progress-data";
import QuickFilterHeading from "../workspace/QuickFilterHeading";
import SearchableFilter from "../../components/SearchableFilter";
import { academicYearFromSemester, formatSemesterLabel, groupAcademicPeriods, normalizeAcademicYear, uniqueAcademicYears } from "../../lib/semester-groups";
import "../workspace/workspace.css";
import "./source-data.css";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type AccessMatrix = Record<string, Record<string, boolean>>;
const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u0111\u0110]/g, "d").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLocaleLowerCase("vi-VN");
function sourceFileClassifications(file: StoredSourceFile): SourceDataClassification[] {
  try {
    const saved = JSON.parse(String(file.data.extractedClassifications ?? "null")) as unknown;
    if (Array.isArray(saved) && saved.length) return saved.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const value = item as Record<string, unknown>;
      const categoryKey = String(value.categoryKey ?? "").trim();
      if (!categoryKey) return [];
      const rowCount = Number(value.rowCount);
      return [{ categoryKey, academicYear: String(value.academicYear ?? ""), semesterName: String(value.semesterName ?? ""), rowCount: Number.isFinite(rowCount) ? rowCount : 0 }];
    });
  } catch { /* Older file metadata may not contain detailed classifications. */ }
  let categories: Record<string, number> = {};
  try { categories = JSON.parse(String(file.data.extractedCategories ?? "{}")) as Record<string, number>; } catch { /* Older file metadata may not contain extracted categories. */ }
  return Object.entries(categories).map(([categoryKey, rowCount]) => ({
    categoryKey,
    academicYear: String(file.data.academicYear ?? ""),
    semesterName: String(file.data.semesterName ?? ""),
    rowCount: Number(rowCount) || 0,
  }));
}

function sourceFileModules(file: StoredSourceFile) {
  const modules = new Map<string, { key: string; title: string; count: number }>();
  for (const classification of sourceFileClassifications(file)) {
    const count = Number(classification.rowCount);
    if (!Number.isFinite(count)) continue;
    const section = sourceDataSections.find((item) => item.key === classification.categoryKey);
    const key = section?.moduleKey ?? classification.categoryKey;
    const title = moduleDefinitions.find((module) => module.key === key)?.title ?? section?.title ?? key;
    const current = modules.get(key);
    modules.set(key, { key, title, count: (current?.count ?? 0) + count });
  }
  return [...modules.values()];
}
const semesterFilterIdentity = (value: unknown) => {
  const normalized = normalize(value);
  const number = normalized.match(/(?:hoc ky|hoc ki|hk)\s*(\d+)/)?.[1];
  return number ? `hoc ky ${Number(number)}` : normalized.replace(/\b\d{4}\s+\d{4}\b/g, " ").replace(/\s+/g, " ").trim();
};
const aliases: Record<string, string[]> = {
  title: ["tieu de", "ten", "ten nam hoc", "ten hoc ky", "ten cong viec", "cong viec", "ten tai lieu", "ten khao sat", "ten bieu mau", "tieu de phieu", "chu de", "noi dung", "chu de noi dung"],
  academicYear: ["nam hoc", "nien khoa", "academic year"], semesterName: ["hoc ky", "hoc ky ap dung", "term", "dot"],
  studentCode: ["mssv", "ma sv", "ma so sinh vien", "ma sinh vien"], studentName: ["ho va ten", "ho ten sinh vien", "ten sinh vien"],
  courseCode: ["ma lhp", "ma hoc phan", "ma lop hoc phan", "ma hoc phan lop"], courseName: ["ten hoc phan", "ten mon hoc"],
  subjectName: ["ten mon hoc", "ten hoc phan"], classCode: ["lop du kien", "ma lop"], className: ["lop", "ten lop", "lop hoc phan", "ma lop"],
  startDate: ["ngay bat dau", "tu ngay", "ngay bat dau hoc ky", "start date"], endDate: ["ngay ket thuc", "den ngay"], dueDate: ["han nop", "han", "ngay dien ra", "han ngay dien ra"],
  credits: ["so tc", "so tin chi", "tin chi"], weeks: ["so tuan", "tuan hoc"], lecturer: ["giang vien", "giang vien phu trach", "gv phu trach"],
  rowType: ["loai du lieu", "row type"], examWeeks: ["tuan thi", "exam weeks"], marks: ["ngay nghi ghi chu", "ghi chu cac ngay", "marks"],
  subject: ["mon hoc"], week: ["tuan", "tuan hoc"], date: ["ngay thuc hien", "ngay hoc"],
  weekday: ["thu", "ngay trong tuan"], periods: ["tiet", "tiet hoc"], room: ["phong", "ten phong"],
  periodCount: ["so tiet"], fromPeriod: ["tu tiet"], toPeriod: ["den tiet"],
  classification: ["xep loai"], letterGrade: ["diem chu"], totalScore10: ["diem tong ket he 10", "diem tong ket"],
  category: ["danh muc", "loai ho tro", "loai bieu mau"], url: ["lien ket", "lien ket tep mau", "duong dan", "url"],
  priority: ["muc do uu tien"], status: ["trang thai"], audience: ["doi tuong", "nguoi nhan"],
};

function fieldForHeader(header: unknown, section: SourceDataSection) {
  const value = normalize(header);
  const exact = section.fields.find((field) => normalize(field.key) === value || normalize(field.label) === value);
  if (exact) return exact;
  if (section.key === "semesters" && ["hoc ky", "hoc ki", "ky hoc"].includes(value)) return section.fields.find((field) => field.key === "title");
  if (section.key === "semesters" && ["nam hoc", "nien khoa"].includes(value)) return section.fields.find((field) => field.key === "academicYear");
  if (section.key === "academic-years" && ["nam hoc", "nien khoa", "ten nam hoc"].includes(value)) return section.fields.find((field) => field.key === "title");
  return section.fields.find((field) => (aliases[field.key] ?? []).includes(value));
}

const sectionProfiles: Record<string, { required: string[]; signals: string[]; minSignals: number; needsHint?: boolean }> = {
  "academic-years": { required: ["title"], signals: ["startDate", "endDate"], minSignals: 1 },
  semesters: { required: ["title"], signals: ["academicYear", "startDate", "endDate", "weeks"], minSignals: 1 },
  timetables: { required: ["courseCode", "subjectName", "classCode"], signals: ["weekday", "periods", "periodCount", "room"], minSignals: 0 },
  calendar: { required: ["courseCode", "title"], signals: ["weekday", "fromPeriod", "toPeriod", "lessonPattern", "weekPattern", "weekNumbers", "startDate"], minSignals: 1 },
  "teaching-plans": { required: ["academicYear", "semester"], signals: ["startDate", "weeks", "examWeeks", "week", "date", "title"], minSignals: 2 },
  grades: { required: ["studentCode", "courseCode"], signals: ["midtermScore", "finalExamScore", "totalScore10", "letterGrade", "courseName", "semesterName"], minSignals: 1 },
  tasks: { required: ["title"], signals: ["priority"], minSignals: 1 },
  "student-support": { required: ["title"], signals: ["studentCode", "studentName", "category"], minSignals: 1 },
  documents: { required: ["title"], signals: ["url", "subject"], minSignals: 1 },
  surveys: { required: ["title"], signals: ["audience"], minSignals: 1 },
  announcements: { required: ["title"], signals: ["dueDate", "status"], minSignals: 1, needsHint: true },
  supports: { required: ["title"], signals: ["description", "category"], minSignals: 1 },
  "forms-templates": { required: ["title"], signals: ["url", "category"], minSignals: 1, needsHint: true },
};

function sourceHint(fileName: string, headers: unknown[]) {
  const fileText = normalize(fileName);
  const headerText = normalize(headers.map(String).join(" "));
  const text = `${fileText} ${headerText}`;
  const hints: Array<[string, string[]]> = [
    ["teaching-plans", ["ke hoach giang day", "tien do dao tao"]],
    ["timetables", ["thoi khoa bieu", "tkb hoc ky"]],
    ["calendar", ["lich giang day"]],
    ["grades", ["so diem", "bang diem"]],
    ["student-support", ["ho tro sinh vien"]],
    ["supports", ["phieu ho tro"]],
    ["documents", ["tai lieu"]],
    ["surveys", ["khao sat"]],
    ["announcements", ["thong bao he thong", "thong bao"]],
    ["forms-templates", ["bieu mau", "mau don", "template"]],
    ["tasks", ["cong viec", "danh sach viec"]],
  ];
  return hints.find(([, phrases]) => phrases.some((phrase) => text.includes(phrase)))?.[0];
}

function scoreSection(section: SourceDataSection, matchedKeys: string[], hint?: string) {
  const profile = sectionProfiles[section.key];
  if (!profile) return -1;
  const keys = new Set(matchedKeys);
  const isProgressSchedule = section.key === "teaching-plans" && keys.has("startDate") && keys.has("weeks");
  const isTeachingPlan = section.key === "teaching-plans" && ["week", "date", "title"].every((key) => keys.has(key));
  const isSemester = section.key === "semesters" && keys.has("title") && ["academicYear", "startDate", "endDate", "weeks"].some((key) => keys.has(key));
  if (section.key === "teaching-plans" ? !isProgressSchedule && !isTeachingPlan : section.key === "semesters" ? !isSemester : profile.required.some((key) => !keys.has(key))) return -1;
  const signalCount = profile.signals.filter((key) => keys.has(key)).length;
  if (signalCount < profile.minSignals || (profile.needsHint && hint !== section.key)) return -1;
  if (section.key === "teaching-plans" && (isProgressSchedule || isTeachingPlan)) return 100 + keys.size + (hint === section.key ? 20 : 0);
  if (section.key === "semesters" && isSemester) return 50 + keys.size + (hint === section.key ? 20 : 0);
  return keys.size + signalCount * 5 + (hint === section.key ? 20 : 0);
}

function chooseSectionFromKeys(keysBySection: Map<string, string[]>, fileName: string, headers: unknown[]) {
  const hint = sourceHint(fileName, headers);
  const ranked = sourceDataSections.map((section) => ({ section, score: scoreSection(section, keysBySection.get(section.key) ?? [], hint) }))
    .filter((item) => item.score >= 0)
    .sort((left, right) => right.score - left.score);
  if (!ranked.length || (ranked.length > 1 && ranked[0].score === ranked[1].score && !hint)) return undefined;
  return ranked[0].section;
}

function chooseSectionFromHeaders(headers: unknown[], fileName: string, preferredSectionKey?: string) {
  if (preferredSectionKey) {
    const preferred = sourceDataSections.find((section) => section.key === preferredSectionKey);
    if (!preferred) return undefined;
    const matchedKeys = [...new Set(headers.map((header) => fieldForHeader(header, preferred)?.key).filter((key): key is string => Boolean(key)))];
    return scoreSection(preferred, matchedKeys, preferred.key) >= 0 ? preferred : undefined;
  }
  const keysBySection = new Map(sourceDataSections.map((section): [string, string[]] => [
    section.key,
    [...new Set(headers.map((header) => fieldForHeader(header, section)?.key).filter((key): key is string => Boolean(key)))],
  ]));
  return chooseSectionFromKeys(keysBySection, fileName, headers);
}

function parseCell(value: unknown, kind?: string): SpreadsheetValue {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return kind === "date" ? value.toISOString().slice(0, 10) : value.toISOString();
  const text = String(value).trim();
  if (!text) return null;
  if (kind === "number") {
    const number = Number(text.replace(/,/g, ""));
    return Number.isFinite(number) ? number : null;
  }
  if (kind === "date") {
    const dmy = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (dmy) return dmy[3] + "-" + dmy[2].padStart(2, "0") + "-" + dmy[1].padStart(2, "0");
    const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
  }
  return text;
}

type PositionedCell = { text: string; x: number; y: number; width: number };
type PositionedHeader = { key: string; x: number };
type OcrWorker = Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>;

function headersFromLine(items: PositionedCell[], section: SourceDataSection): PositionedHeader[] {
  const found = new Map<string, PositionedHeader>();
  for (let start = 0; start < items.length; start += 1) {
    const parts: string[] = [];
    for (let end = start; end < Math.min(items.length, start + 5); end += 1) {
      if (end > start && items[end].x - (items[end - 1].x + items[end - 1].width) > 22) break;
      parts.push(items[end].text);
      const field = fieldForHeader(parts.join(" "), section);
      if (field && !found.has(field.key)) found.set(field.key, { key: field.key, x: items[start].x });
    }
  }
  return [...found.values()].sort((a, b) => a.x - b.x);
}

function parsePositionedTable(items: PositionedCell[], section: SourceDataSection): SourceDataRow[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Array<{ y: number; items: PositionedCell[] }> = [];
  for (const item of sorted) {
    let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 3);
    if (!line) { line = { y: item.y, items: [] }; lines.push(line); }
    line.items.push(item);
  }
  lines.forEach((line) => line.items.sort((a, b) => a.x - b.x));

  const rows: SourceDataRow[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const headers = headersFromLine(lines[lineIndex].items, section);
    if (headers.length < 2) continue;
    let endIndex = lineIndex + 1;
    while (endIndex < lines.length && headersFromLine(lines[endIndex].items, section).length < 2) endIndex += 1;
    for (const line of lines.slice(lineIndex + 1, endIndex)) {
      const row: SourceDataRow = {};
      headers.forEach((header, index) => {
        const lower = index ? (headers[index - 1].x + header.x) / 2 : Number.NEGATIVE_INFINITY;
        const upper = index < headers.length - 1 ? (header.x + headers[index + 1].x) / 2 : Number.POSITIVE_INFINITY;
        const field = section.fields.find((candidate) => candidate.key === header.key);
        const value = line.items.filter((item) => item.x >= lower && item.x < upper).map((item) => item.text).join(" ").trim();
        if (field && value) {
          const parsed = parseCell(value, field.kind);
          if (parsed !== null) row[field.key] = parsed;
        }
      });
      if (Object.keys(row).length) rows.push(row);
    }
    lineIndex = endIndex - 1;
  }
  return rows;
}

function asSourceRows(section: SourceDataSection, rows: SourceDataRow[]): Array<{ section: SourceDataSection; rows: SourceDataRow[] }> {
  return rows.length ? [{ section, rows }] : [];
}

function hasUsablePdfRows(section: SourceDataSection, rows: SourceDataRow[]) {
  return rows.some((row) => {
    if (!section.requiredKeys.every((key) => String(row[key] ?? "").trim())) return false;
    const profile = sectionProfiles[section.key];
    if (profile && profile.signals.filter((key) => String(row[key] ?? "").trim()).length < profile.minSignals) return false;
    if (section.key !== "teaching-plans") return true;
    const rowType = String(row.rowType ?? "").trim().toLocaleLowerCase("vi-VN");
    const semesterSchedule = rowType === "semester-schedule" || (rowType === "" && Boolean(row.startDate) && Boolean(row.weeks) && !row.week && !row.date);
    const weeklyPlan = Boolean(row.week) && Boolean(row.date) && Boolean(row.title);
    return semesterSchedule || weeklyPlan;
  });
}

function chooseSectionFromPositioned(items: PositionedCell[], fileName: string, preferredSectionKey?: string) {
  const candidateSections = preferredSectionKey ? sourceDataSections.filter((section) => section.key === preferredSectionKey) : sourceDataSections;
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Array<{ y: number; items: PositionedCell[] }> = [];
  for (const item of sorted) {
    let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 3);
    if (!line) { line = { y: item.y, items: [] }; lines.push(line); }
    line.items.push(item);
  }
  const headers = lines.flatMap((line) => {
    line.items.sort((a, b) => a.x - b.x);
    const found = candidateSections.flatMap((section) => headersFromLine(line.items, section).map((header) => ({ ...header, section })));
    return found.length ? [{ line, found }] : [];
  });
  const ranked = headers.map(({ line, found }) => {
    if (preferredSectionKey) {
      const preferred = candidateSections[0];
      const matchedKeys = [...new Set(found.filter((header) => header.section.key === preferredSectionKey).map((header) => header.key))];
      return preferred && scoreSection(preferred, matchedKeys, preferred.key) >= 0 ? preferred : undefined;
    }
    const keysBySection = new Map(sourceDataSections.map((section) => [section.key, [...new Set(found.filter((header) => header.section.key === section.key).map((header) => header.key))]]));
    return chooseSectionFromKeys(keysBySection, fileName, line.items.map((item) => item.text));
  }).filter((section): section is SourceDataSection => Boolean(section));
  return ranked[0];
}

function rowsFromPositioned(items: PositionedCell[], fileName: string, preferredSectionKey?: string) {
  const section = chooseSectionFromPositioned(items, fileName, preferredSectionKey);
  return section ? asSourceRows(section, parsePositionedTable(items, section)) : [];
}

function recognizedProgressRows(text: string, fileName: string) {
  const context = normalize(`${fileName} ${text}`);
  if (!context.includes("tien do dao tao") && !context.includes("ke hoach giang day")) return undefined;
  return progressRowsFromRecognizedText(`${text}\n${fileName}`);
}

async function recognizeCanvasSources(canvas: HTMLCanvasElement, fileName: string, worker: OcrWorker, preferredSectionKey?: string) {
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
  const words = (data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words))).map((word) => ({
    text: word.text.trim(), x: word.bbox.x0, y: -word.bbox.y1, width: word.bbox.x1 - word.bbox.x0,
  })).filter((word) => word.text);
  return { sources: rowsFromPositioned(words, fileName, preferredSectionKey), text: data.text ?? "" };
}

async function readPdfSources(file: File, preferredSectionKey?: string): Promise<Array<{ section: SourceDataSection; rows: SourceDataRow[] }>> {
  if ((!preferredSectionKey || preferredSectionKey === "timetables") && /timetable|thoi.?khoa.?bieu|tkb/i.test(normalize(file.name))) {
    try {
      const timetableRows = await extractTimetablePdf(file) as SourceDataRow[];
      if (timetableRows.some((row) => row.courseCode && row.subjectName && row.classCode)) {
        const timetable = sourceDataSections.find((candidate) => candidate.key === "timetables");
        if (timetable) return asSourceRows(timetable, timetableRows);
      }
    } catch { /* Text extraction and OCR below also handle table PDFs. */ }
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const document = await task.promise;
  try {
    const sources = new Map<string, { section: SourceDataSection; rows: SourceDataRow[] }>();
    const textByPage: string[] = [];
    const pagesNeedingOcr: number[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const positioned = (content.items as Array<{ str?: string; transform?: number[]; width?: number }>).flatMap((item) => {
        const text = String(item.str ?? "").trim();
        if (!text || !item.transform) return [];
        return [{ text, x: item.transform[4], y: item.transform[5], width: item.width ?? text.length * 4 }];
      });
      textByPage.push(positioned.map((item) => item.text).join(" "));
      if (!positioned.length) { pagesNeedingOcr.push(pageNumber); continue; }
      const pageSources = rowsFromPositioned(positioned, file.name, preferredSectionKey);
      const usablePageSources = pageSources.filter((source) => hasUsablePdfRows(source.section, source.rows));
      if (!usablePageSources.length) pagesNeedingOcr.push(pageNumber);
      for (const source of usablePageSources) {
        const current = sources.get(source.section.key);
        sources.set(source.section.key, { section: source.section, rows: [...(current?.rows ?? []), ...source.rows] });
      }
    }
    const allowProgressSchedule = !preferredSectionKey || preferredSectionKey === "teaching-plans";
    const progressRows = allowProgressSchedule ? recognizedProgressRows(textByPage.join("\n"), file.name) : undefined;
    const progressSection = sourceDataSections.find((candidate) => candidate.key === "teaching-plans");
    if (progressRows?.length && progressSection) sources.set(progressSection.key, { section: progressSection, rows: progressRows });

    const pagesToRecognize = progressRows?.length ? [] : sources.size ? pagesNeedingOcr : Array.from({ length: document.numPages }, (_, index) => index + 1);
    if (pagesToRecognize.length) {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker(["vie", "eng"]);
      try {
        const recognizedTexts: string[] = [];
        for (const pageNumber of pagesToRecognize) {
          const page = await document.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 2 });
          const canvas = window.document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Không thể xử lý PDF trong trình duyệt này.");
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          const recognized = await recognizeCanvasSources(canvas, file.name, worker, preferredSectionKey);
          recognizedTexts.push(recognized.text);
          for (const source of recognized.sources) {
            if (progressRows?.length && source.section.key === progressSection?.key) continue;
            const current = sources.get(source.section.key);
            sources.set(source.section.key, { section: source.section, rows: [...(current?.rows ?? []), ...source.rows] });
          }
        }
        const ocrProgressRows = allowProgressSchedule ? recognizedProgressRows(recognizedTexts.join("\n"), file.name) : undefined;
        if (ocrProgressRows?.length && progressSection && !sources.has(progressSection.key)) sources.set(progressSection.key, { section: progressSection, rows: ocrProgressRows });
      } finally {
        await worker.terminate();
      }
    }
    if (!sources.size) throw new Error("Không nhận diện được bảng dữ liệu trong PDF. Kiểm tra hàng tiêu đề hoặc dùng bản PDF rõ nét hơn.");
    return [...sources.values()];
  } finally {
    await task.destroy();
  }
}

async function readImageSources(file: File, preferredSectionKey?: string): Promise<Array<{ section: SourceDataSection; rows: SourceDataRow[] }>> {
  let image: CanvasImageSource;
  let width: number;
  let height: number;
  let releaseImage = () => {};
  try {
    const bitmap = await createImageBitmap(file);
    image = bitmap; width = bitmap.width; height = bitmap.height; releaseImage = () => bitmap.close();
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const element = await new Promise<HTMLImageElement>((resolve, reject) => {
        const candidate = new Image();
        candidate.onload = () => resolve(candidate);
        candidate.onerror = () => reject(new Error("Không giải mã được ảnh."));
        candidate.src = url;
      });
      image = element; width = element.naturalWidth; height = element.naturalHeight;
    } catch {
      URL.revokeObjectURL(url);
      throw new Error("Trình duyệt không đọc được định dạng ảnh này.");
    }
    releaseImage = () => URL.revokeObjectURL(url);
  }
  const scale = Math.min(2, 2600 / width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) { releaseImage(); throw new Error("Không thể xử lý ảnh trong trình duyệt này."); }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  releaseImage();
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(["vie", "eng"]);
  let recognized: Awaited<ReturnType<typeof recognizeCanvasSources>>;
  try { recognized = await recognizeCanvasSources(canvas, file.name, worker, preferredSectionKey); }
  finally { await worker.terminate(); }
  if (recognized.sources.length) return recognized.sources;
  const progressRows = !preferredSectionKey || preferredSectionKey === "teaching-plans" ? recognizedProgressRows(recognized.text, file.name) : undefined;
  const progressSection = sourceDataSections.find((candidate) => candidate.key === "teaching-plans");
  if (progressRows?.length && progressSection) return asSourceRows(progressSection, progressRows);
  throw new Error("Không nhận diện được bảng trong ảnh. Hãy dùng ảnh rõ nét, có hàng tiêu đề và chụp thẳng trang.");
}

function parseSpreadsheetSheet(matrix: unknown[][], section: SourceDataSection, headerIndex: number): SourceDataRow[] {
  const headers = matrix[headerIndex].map((header) => ({ raw: String(header ?? "").trim(), field: fieldForHeader(header, section) }));
  const weekColumns = headers.map(({ raw }, index) => ({ week: Number(normalize(raw).slice(1)), index }))
    .filter((column) => /^t\d+$/.test(normalize(headers[column.index].raw)));
  const parsed: SourceDataRow[] = [];
  for (const cells of matrix.slice(headerIndex + 1)) {
    if (!cells.some((cell) => String(cell ?? "").trim())) continue;
    const row: SourceDataRow = {};
    headers.forEach(({ raw, field }, index) => {
      if (!raw) return;
      const key = field?.key ?? ("raw_" + normalize(raw).replace(/\s+/g, "_"));
      const value = parseCell(cells[index], field?.kind);
      if (value !== null) row[key] = value;
    });
    if (section.fields.some((field) => field.key === "weekNumbers") && weekColumns.length) {
      const weeks = weekColumns.filter(({ index }) => ["x", "1", "true", "yes", "✓"].includes(String(cells[index] ?? "").trim().toLocaleLowerCase("vi-VN")))
        .map(({ week }) => week);
      if (weeks.length) row.weekNumbers = weeks.join(",");
    }
    if (Object.keys(row).length) parsed.push(row);
  }
  return parsed;
}

async function readSpreadsheetSources(file: File, preferredSectionKey?: string): Promise<Array<{ section: SourceDataSection; rows: SourceDataRow[] }>> {
  const workbook = /\.(csv|tsv|txt)$/i.test(file.name) || file.type === "text/csv" || file.type.startsWith("text/")
    ? XLSX.read(await file.text(), { type: "string", raw: false, cellDates: true })
    : XLSX.read(await file.arrayBuffer(), { type: "array", raw: false, cellDates: true });
  const bySection = new Map<string, { section: SourceDataSection; rows: SourceDataRow[] }>();
  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false });
    const headerIndex = matrix.findIndex((row) => row.filter((cell) => String(cell ?? "").trim()).length >= 2 && chooseSectionFromHeaders(row, file.name, preferredSectionKey));
    if (headerIndex < 0) continue;
    const section = chooseSectionFromHeaders(matrix[headerIndex], file.name, preferredSectionKey);
    if (!section) continue;
    const rows = parseSpreadsheetSheet(matrix, section, headerIndex);
    if (!rows.length) continue;
    const existing = bySection.get(section.key);
    bySection.set(section.key, { section, rows: [...(existing?.rows ?? []), ...rows] });
  }
  if (!bySection.size) throw new Error("Không nhận diện được phân hệ từ các cột trong tệp. Hãy kiểm tra hàng tiêu đề và các trường dữ liệu.");
  return [...bySection.values()];
}

async function readSourceFileAuto(file: File, preferredSectionKey?: string): Promise<Array<{ section: SourceDataSection; rows: SourceDataRow[] }>> {
  const signature = new TextDecoder().decode(await file.slice(0, 8).arrayBuffer());
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf" || signature.startsWith("%PDF-")) return readPdfSources(file, preferredSectionKey);
  if (file.type.startsWith("image/") || /\.(apng|avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i.test(file.name)) return readImageSources(file, preferredSectionKey);
  return readSpreadsheetSources(file, preferredSectionKey);
}

export default function SourceDataPage({ permissions, superAdmin = false }: { permissions: AccessMatrix; superAdmin?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<StoredSourceFile | null>(null);
  const previewRequestRef = useRef(0);
  const [sourceFiles, setSourceFiles] = useState<StoredSourceFile[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [editingFiles, setEditingFiles] = useState<StoredSourceFile[]>([]);
  const [editClassification, setEditClassification] = useState({ moduleKey: "", academicYear: "", semesterName: "" });
  const [previewFile, setPreviewFile] = useState<StoredSourceFile | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [semesterRecords, setSemesterRecords] = useState<WorkspaceRecord[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploadClassification, setUploadClassification] = useState({ moduleKey: "", academicYear: "", semesterName: "" });
  const [sourceFilters, setSourceFilters] = useState({ academicYear: "", semesterName: "", moduleKey: "", fileName: "", search: "" });
  const [searchDraft, setSearchDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canRead = (moduleKey: string) => {
    if (superAdmin) return true;
    const resource = permissionResources.find((item) => item.kind === "module" && item.key === moduleKey);
    const permissionKeys = resource ? resourcePermissionKeys(resource, "read") : [moduleKey];
    return permissionKeys.some((key) => permissions[key]?.read === true);
  };
  const canManage = (section: SourceDataSection) => superAdmin || (
    canRead("source-data") && permissions["source-data"]?.create === true && permissions["source-data"]?.update === true
    && canRead(section.moduleKey) && permissions[section.moduleKey]?.create === true && permissions[section.moduleKey]?.update === true
  );
  const canUpload = superAdmin || (canRead("source-data") && permissions["source-data"]?.create === true && permissions["source-data"]?.update === true);
  const canDeleteFiles = superAdmin || permissions["source-data"]?.delete === true;
  const visibleSections = useMemo(() => sourceDataSections.filter((section) => canRead(section.moduleKey)), [permissions, superAdmin]);
  const manageableSections = useMemo(() => sourceDataSections.filter(canManage), [permissions, superAdmin]);
  const isUploader = (file: StoredSourceFile) => String(file.data.uploadedById ?? String(file.data.storagePath ?? "").split("/")[0]) === currentUserId;
  const canReplaceFile = (file: StoredSourceFile) => {
    const categories = sourceFileClassifications(file).map((classification) => classification.categoryKey);
    const canManageCategory = categories.length ? categories.some((key) => manageableSections.some((section) => section.key === key)) : manageableSections.length > 0;
    return canUpload && canManageCategory && (canDeleteFiles || isUploader(file));
  };
  const canDeleteFile = (file: StoredSourceFile) => canDeleteFiles || (canUpload && isUploader(file));
  const selectedUploadSection = manageableSections.find((section) => section.key === uploadClassification.moduleKey);
  const selectedEditSection = manageableSections.find((section) => section.key === editClassification.moduleKey);
  const intakeSemesterOptions = semesterRecords
    .filter((record) => normalizeAcademicYear(String(record.data.academicYear ?? "")) === normalizeAcademicYear(uploadClassification.academicYear))
    .map((record) => {
      const title = String(record.data.title ?? "").trim();
      const year = String(record.data.academicYear ?? "").trim();
      return { title: formatSemesterLabel(title, year), value: /\d{4}\D+\d{4}/.test(title) ? title : `${title} - ${year}` };
    })
    .filter((option, index, options) => Boolean(option.title) && options.findIndex((candidate) => candidate.value === option.value) === index);
  const intakeClassificationReady = Boolean(selectedUploadSection && uploadClassification.academicYear);
  const filterOptions = {
    academicYear: uniqueAcademicYears(semesterRecords.map((record) => String(record.data.academicYear ?? ""))),
    semesterName: [...new Set(semesterRecords.map((record) => String(record.data.title ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi", { numeric: true, sensitivity: "base" })),
    module: [...new Map(sourceFiles.flatMap((file) => sourceFileModules(file)).map((module) => [module.key, module.title] as const)).entries()]
      .map(([key, title]) => ({ key, title })).sort((a, b) => a.title.localeCompare(b.title, "vi", { sensitivity: "base" })),
    fileName: [...new Set(sourceFiles.map((file) => String(file.data.fileName ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi", { sensitivity: "base" })),
  };
  const sourceSemesterGroups = groupAcademicPeriods(semesterRecords.map((record) => ({ academicYear: record.data.academicYear, semesterName: record.data.title })));
  const sourceSemesterOptions = sourceFilters.academicYear
    ? sourceSemesterGroups.find((group) => normalizeAcademicYear(group.academicYear) === normalizeAcademicYear(sourceFilters.academicYear))?.semesters ?? []
    : sourceSemesterGroups.flatMap((group) => group.semesters);
  const filteredSourceFiles = sourceFiles.filter((file) => {
    const rowYear = String(file.data.academicYear ?? "").trim();
    const rowSemester = String(file.data.semesterName ?? "").trim();
    const rowFile = String(file.data.fileName ?? "").trim();
    const uploader = String(file.data.modifiedBy || file.data.uploadedBy || "");
    const classifications = sourceFileClassifications(file);
    const modules = sourceFileModules(file);
    const moduleNames = modules.map((module) => module.title).join(" ");
    const needle = normalize(sourceFilters.search);
    const classificationValues = classifications.map((classification) => `${classification.academicYear} ${classification.semesterName}`).join(" ");
    const searchable = normalize(`${rowYear} ${rowSemester} ${rowFile} ${uploader} ${moduleNames} ${classificationValues}`);
    return (!sourceFilters.academicYear || normalizeAcademicYear(rowYear) === normalizeAcademicYear(sourceFilters.academicYear) || classifications.some((item) => normalizeAcademicYear(item.academicYear) === normalizeAcademicYear(sourceFilters.academicYear)))
      && (!sourceFilters.semesterName || semesterFilterIdentity(rowSemester) === semesterFilterIdentity(sourceFilters.semesterName) || classifications.some((item) => normalize(item.semesterName) === normalize("Tất cả học kỳ") || semesterFilterIdentity(item.semesterName) === semesterFilterIdentity(sourceFilters.semesterName)))
      && (!sourceFilters.moduleKey || modules.some((module) => module.key === sourceFilters.moduleKey))
      && (!sourceFilters.fileName || rowFile === sourceFilters.fileName)
      && (!needle || searchable.includes(needle));
  });
  const hasActiveSourceFilters = Object.values(sourceFilters).some(Boolean) || Boolean(searchDraft);
  const visibleFileIds = filteredSourceFiles.map((file) => file.id);
  const selectedFiles = sourceFiles.filter((file) => selectedFileIds.includes(file.id));
  const selectedEditableFiles = selectedFiles.filter(canReplaceFile);
  const editSemesterOptions = semesterRecords
    .filter((record) => normalizeAcademicYear(String(record.data.academicYear ?? "")) === normalizeAcademicYear(editClassification.academicYear))
    .map((record) => {
      const title = String(record.data.title ?? "").trim();
      const year = String(record.data.academicYear ?? "").trim();
      return { title: formatSemesterLabel(title, year), value: /\d{4}\D+\d{4}/.test(title) ? title : `${title} - ${year}` };
    })
    .filter((option, index, options) => Boolean(option.title) && options.findIndex((candidate) => candidate.value === option.value) === index);
  const selectedDeletableFiles = selectedFiles.filter(canDeleteFile);
  const allVisibleFilesSelected = visibleFileIds.length > 0 && visibleFileIds.every((id) => selectedFileIds.includes(id));

  async function load() {
    setLoading(true); setError("");
    try {
      const [nextFiles, userId, nextSemesterRecords] = await Promise.all([
        sourceDataService.listFiles(),
        sourceDataService.currentUserId(),
        workspaceService.list("semesters").catch(() => [] as WorkspaceRecord[]),
      ]);
      setSourceFiles(nextFiles); setCurrentUserId(userId); setSemesterRecords(nextSemesterRecords);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được dữ liệu nguồn."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    void load();
    const refresh = () => { void load(); };
    window.addEventListener("vtn-source-data-updated", refresh);
    window.addEventListener("vtn-semester-list-updated", refresh);
    return () => { window.removeEventListener("vtn-source-data-updated", refresh); window.removeEventListener("vtn-semester-list-updated", refresh); };
  }, []);
  useEffect(() => {
    const existingIds = new Set(sourceFiles.map((file) => file.id));
    setSelectedFileIds((current) => current.filter((id) => existingIds.has(id)));
  }, [sourceFiles]);
  function addContext(section: SourceDataSection, source: SourceDataRow, scope: SourceDataScope): SourceDataRow {
    const row = { ...source };
    const shortSemester = scope.semesterName.split(" - ")[0];
    if (section.key === "academic-years" && scope.academicYear && !String(row.title ?? "").trim()) row.title = scope.academicYear;
    if (section.key === "semesters") {
      if (shortSemester && !String(row.title ?? "").trim()) row.title = shortSemester;
      if (scope.academicYear && !String(row.academicYear ?? "").trim()) row.academicYear = scope.academicYear;
    }
    if (section.key === "teaching-plans") {
      if (scope.academicYear && !String(row.academicYear ?? "").trim()) row.academicYear = scope.academicYear;
      if (shortSemester && !String(row.semester ?? "").trim()) row.semester = shortSemester;
    }
    if (scope.academicYear && section.fields.some((field) => field.key === "academicYear") && !String(row.academicYear ?? "").trim()) row.academicYear = scope.academicYear;
    if (scope.semesterName && section.fields.some((field) => field.key === "semesterName") && !String(row.semesterName ?? "").trim()) row.semesterName = scope.semesterName;
    return row;
  }

  function validRows(section: SourceDataSection, values: SourceDataRow[]) {
    return values.filter((row) => {
      const rowType = String(row.rowType ?? "").toLocaleLowerCase("vi-VN");
      const scheduleRow = section.key === "teaching-plans" && (rowType === "semester-schedule" || (rowType === "" && Boolean(row.startDate) && Boolean(row.weeks) && !row.week && !row.date));
      const planRow = section.key === "teaching-plans" && !scheduleRow;
      const required = scheduleRow ? ["academicYear", "semester", "startDate", "weeks"] : planRow ? ["academicYear", "semester", "week", "date", "title"] : section.requiredKeys;
      return required.every((key) => String(row[key] ?? "").trim());
    });
  }

  function beginReplaceSourceFile(file: StoredSourceFile) {
    const classification = sourceFileClassifications(file).find((item) => manageableSections.some((section) => section.key === item.categoryKey)) ?? sourceFileClassifications(file)[0];
    const section = sourceDataSections.find((item) => item.key === classification?.categoryKey);
    const existingSemester = String(file.data.semesterName || classification?.semesterName || "");
    setUploadClassification({
      moduleKey: section && manageableSections.some((item) => item.key === section.key) ? section.key : "",
      academicYear: normalizeAcademicYear(String(file.data.academicYear || classification?.academicYear || "")),
      semesterName: normalize(existingSemester) === normalize("Tất cả học kỳ") ? "" : existingSemester,
    });
    replaceTargetRef.current = file;
    replaceInputRef.current?.click();
  }

  function beginEditSourceFiles(filesToEdit: StoredSourceFile[]) {
    const editable = filesToEdit.filter(canReplaceFile);
    if (!editable.length) return;
    const values = editable.map((file) => {
      const classification = sourceFileClassifications(file).find((item) => manageableSections.some((section) => section.key === item.categoryKey)) ?? sourceFileClassifications(file)[0];
      const existingSemester = String(file.data.semesterName || classification?.semesterName || "");
      return {
        moduleKey: manageableSections.some((section) => section.key === classification?.categoryKey) ? String(classification?.categoryKey ?? "") : "",
        academicYear: normalizeAcademicYear(String(file.data.academicYear || classification?.academicYear || "")),
        semesterName: normalize(existingSemester) === normalize("Tất cả học kỳ") ? "" : existingSemester,
      };
    });
    const commonValue = (key: "moduleKey" | "academicYear" | "semesterName") => values.every((value) => value[key] === values[0][key]) ? values[0][key] : "";
    setEditClassification({
      moduleKey: commonValue("moduleKey"),
      academicYear: commonValue("academicYear"),
      semesterName: commonValue("semesterName"),
    });
    setEditingFiles(editable);
    setError(""); setNotice("");
  }

  async function saveFileClassification() {
    if (!editingFiles.length || !selectedEditSection || !editClassification.academicYear) return;
    const editable = editingFiles.filter(canReplaceFile);
    if (!editable.length) return;
    setBusy(true); setError(""); setNotice("");
    let updated = 0;
    const failed: string[] = [];
    const failedFiles: StoredSourceFile[] = [];
    const scope = {
      academicYear: editClassification.academicYear,
      semesterName: selectedEditSection.key === "academic-years" ? "" : editClassification.semesterName,
    };
    try {
      for (const file of editable) {
        const rowCount = sourceFileClassifications(file).reduce((total, item) => total + Math.max(0, item.rowCount), 0);
        try {
          await sourceDataService.updateFileClassification(file, selectedEditSection.key, scope, rowCount);
          updated += 1;
        } catch {
          failed.push(String(file.data.fileName ?? "Tệp nguồn"));
          failedFiles.push(file);
        }
      }
      await load();
      if (updated) setNotice(`Đã cập nhật phân loại cho ${updated} tệp nguồn.`);
      if (failed.length) setError(`Không cập nhật được ${failed.length} tệp: ${failed.join(", ")}.`);
      setEditingFiles(failedFiles);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không cập nhật được phân loại tệp nguồn.");
    } finally { setBusy(false); }
  }

  async function importFiles(fileBatch: File[] = files, replaceTarget?: StoredSourceFile) {
    if (!fileBatch.length || !canUpload || !selectedUploadSection || !intakeClassificationReady) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const selectedScope: SourceDataScope = { academicYear: uploadClassification.academicYear, semesterName: uploadClassification.semesterName };
      const permitted = new Set(manageableSections.map((item) => item.key));
      const staged = new Map<string, { section: SourceDataSection; scope: SourceDataScope; rows: SourceDataRow[]; fileNames: Set<string> }>();
      const perFile: Array<{ file: File; counts: Record<string, number>; scope: SourceDataScope; classifications: SourceDataClassification[] }> = [];
      const filesWithoutExtractedRows: string[] = [];
      for (const file of fileBatch) {
        let parsedSources: Array<{ section: SourceDataSection; rows: SourceDataRow[] }> = [];
        try { parsedSources = await readSourceFileAuto(file, selectedUploadSection.key); }
        catch { /* Keep the original file even when this format cannot be parsed into tables. */ }
        const counts: Record<string, number> = {};
        for (const parsed of parsedSources) {
          if (parsed.section.key !== selectedUploadSection.key || !permitted.has(parsed.section.key)) continue;
          const valid = validRows(parsed.section, parsed.rows.map((row) => addContext(parsed.section, row, selectedScope)));
          if (!valid.length) continue;
          counts[parsed.section.key] = (counts[parsed.section.key] ?? 0) + valid.length;
          const groups = new Map<string, { scope: SourceDataScope; rows: SourceDataRow[] }>();
          for (const row of valid) {
            const explicitTerm = row.semesterName ?? row.semester ?? (parsed.section.key === "semesters" ? row.title : undefined);
            const rowTerm = String(explicitTerm ?? "").trim().replace(/[–—−]/g, "-");
            const explicitYear = row.academicYear ?? (parsed.section.key === "academic-years" ? row.title : undefined);
            const embeddedYear = rowTerm.match(/(\d{4}\D+\d{4})/)?.[1];
            const rowYear = String(explicitYear ?? embeddedYear ?? selectedScope.academicYear).trim();
            const resolvedTerm = parsed.section.key === "academic-years" ? "" : !rowTerm ? selectedScope.semesterName : rowTerm.includes(" - ") || !rowYear ? rowTerm : `${rowTerm} - ${rowYear}`;
            const scope = { academicYear: rowYear, semesterName: resolvedTerm };
            const key = `${parsed.section.key}::${scope.academicYear}::${scope.semesterName}`;
            const group = groups.get(key) ?? { scope, rows: [] };
            group.rows.push(row); groups.set(key, group);
          }
          for (const [key, group] of groups) {
            const current = staged.get(key) ?? { section: parsed.section, scope: group.scope, rows: [], fileNames: new Set<string>() };
            current.rows.push(...group.rows); current.fileNames.add(file.name); staged.set(key, current);
          }
        }
        if (!Object.keys(counts).length) filesWithoutExtractedRows.push(file.name);
        perFile.push({ file, counts, classifications: [{ categoryKey: selectedUploadSection.key, academicYear: selectedScope.academicYear, semesterName: selectedUploadSection.key === "academic-years" ? "" : selectedScope.semesterName || "Tất cả học kỳ", rowCount: counts[selectedUploadSection.key] ?? 0 }], scope: selectedScope });
      }

      for (const { file, counts, scope, classifications } of perFile) {
        if (replaceTarget) await sourceDataService.replaceOriginalFile(replaceTarget, file, scope, counts, classifications);
        else await sourceDataService.saveOriginalFile(file, scope, counts, classifications);
      }
      for (const item of staged.values()) await sourceDataService.replace(item.section.key, [...item.fileNames], item.rows, item.scope);
      await load();
      const totalRows = [...staged.values()].reduce((total, item) => total + item.rows.length, 0);
      const categoryNames = [...new Set([...staged.values()].map((item) => item.section.title))].join(", ");
      const extractionSummary = totalRows
        ? `trích xuất ${totalRows} dòng vào ${categoryNames}`
        : "chưa trích xuất được dữ liệu bảng";
      const unparsedSummary = filesWithoutExtractedRows.length
        ? ` Tệp đã lưu nhưng chưa trích xuất được dữ liệu bảng: ${filesWithoutExtractedRows.join(", ")}.`
        : "";
      setNotice(replaceTarget
        ? `Đã thay tệp ${String(replaceTarget.data.fileName ?? "nguồn")} bằng ${fileBatch[0].name}; ${extractionSummary}.${unparsedSummary}`
        : `Đã lưu ${fileBatch.length} tệp gốc; ${extractionSummary}.${unparsedSummary}`);
      for (const key of new Set([...staged.values()].map((item) => item.section.key))) window.dispatchEvent(new CustomEvent("vtn-source-data-updated", { detail: key }));
      setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
    } catch (cause) {
      if (replaceTarget) await load();
      setError(cause instanceof Error ? cause.message : "Không nhập được dữ liệu nguồn.");
    }
    finally { setBusy(false); }
  }

  async function downloadSourceFile(file: StoredSourceFile) {
    try {
      const fileName = String(file.data.fileName ?? "source-file");
      const url = await sourceDataService.fileDownloadUrl(String(file.data.storagePath ?? ""), fileName);
      const anchor = window.document.createElement("a");
      anchor.href = url; anchor.rel = "noopener noreferrer";
      anchor.download = fileName;
      anchor.click();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được tệp nguồn."); }
  }

  async function previewSourceFile(file: StoredSourceFile) {
    const requestId = ++previewRequestRef.current;
    setPreviewFile(file); setPreviewUrl(""); setPreviewLoading(true); setError("");
    try {
      const url = await sourceDataService.filePreviewUrl(String(file.data.storagePath ?? ""));
      if (requestId === previewRequestRef.current) setPreviewUrl(url);
    } catch (cause) {
      if (requestId === previewRequestRef.current) setError(cause instanceof Error ? cause.message : "Không xem được tệp nguồn.");
    } finally {
      if (requestId === previewRequestRef.current) setPreviewLoading(false);
    }
  }

  function closePreview() {
    previewRequestRef.current += 1;
    setPreviewFile(null); setPreviewUrl(""); setPreviewLoading(false);
  }

  function toggleFileSelection(fileId: string) {
    setSelectedFileIds((current) => current.includes(fileId) ? current.filter((id) => id !== fileId) : [...current, fileId]);
  }

  function toggleVisibleFileSelection() {
    setSelectedFileIds((current) => allVisibleFilesSelected
      ? current.filter((id) => !visibleFileIds.includes(id))
      : [...new Set([...current, ...visibleFileIds])]);
  }

  async function downloadSelectedSourceFiles() {
    if (!selectedFiles.length) return;
    setBusy(true); setError(""); setNotice("");
    try {
      for (const [index, file] of selectedFiles.entries()) {
        const fileName = String(file.data.fileName ?? "source-file");
        const url = await sourceDataService.fileDownloadUrl(String(file.data.storagePath ?? ""), fileName);
        const anchor = window.document.createElement("a");
        anchor.href = url; anchor.rel = "noopener noreferrer"; anchor.download = fileName; anchor.click();
        if (index < selectedFiles.length - 1) await new Promise((resolve) => window.setTimeout(resolve, 180));
      }
      setNotice(`Đã bắt đầu tải xuống ${selectedFiles.length} tệp đã chọn.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được các tệp đã chọn."); }
    finally { setBusy(false); }
  }

  async function deleteSelectedSourceFiles() {
    const deletable = selectedDeletableFiles;
    if (!deletable.length || !window.confirm(`Chuyển ${deletable.length} tệp nguồn đã chọn vào thùng rác?`)) return;
    setBusy(true); setError(""); setNotice("");
    let deleted = 0;
    const failed: string[] = [];
    try {
      for (const file of deletable) {
        try { await sourceDataService.deleteOriginalFile(file); deleted += 1; }
        catch { failed.push(String(file.data.fileName ?? "Tệp nguồn")); }
      }
      setSelectedFileIds((current) => current.filter((id) => !deletable.some((file) => file.id === id)));
      await load();
      if (deleted) setNotice(`Đã chuyển ${deleted} tệp nguồn vào thùng rác.`);
      if (failed.length) setError(`Không xóa được ${failed.length} tệp: ${failed.join(", ")}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không xóa được các tệp đã chọn."); }
    finally { setBusy(false); }
  }

  async function deleteSourceFile(file: StoredSourceFile) {
    if (!canDeleteFile(file) || !window.confirm(`Chuyển tài liệu nguồn “${String(file.data.fileName ?? "Tệp nguồn")}” vào thùng rác?`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await sourceDataService.deleteOriginalFile(file);
      await load();
      setNotice(`Đã chuyển tài liệu ${String(file.data.fileName ?? "nguồn")} vào thùng rác.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không xóa được tệp nguồn."); }
    finally { setBusy(false); }
  }

  if (!visibleSections.length) return <section className="workspace-page"><div className="workspace-panel"><h1>Dữ liệu nguồn</h1><p>Tài khoản chưa có quyền đọc dữ liệu nguồn của phân hệ nào.</p></div></section>;

  return <section className="workspace-page source-data-page">
    <header className="workspace-title-row"><div><div className="workspace-breadcrumb">Quản trị <span>/</span> Dữ liệu nguồn</div><h1><Database size={26} /> Dữ liệu nguồn</h1><p>Tải tệp nguồn lên để hệ thống tự nhận diện các trường dữ liệu và phân phối đến từng nguồn tương ứng.</p></div></header>
    {error && <div className="workspace-alert" role="alert">{error}</div>}{notice && <div className="workspace-notice" role="status">{notice}</div>}
    <section className="workspace-panel source-data-intake">
      <div className="source-data-section-heading"><div><h2><Upload size={18} /> Nhập dữ liệu nguồn</h2><p>Tải lên một hoặc nhiều tệp. Hệ thống tự nhận diện dữ liệu theo tên các cột.</p></div>{loading && <RefreshCw size={17} className="source-data-spinner" aria-label="Đang tải" />}</div>
      <div className="source-data-intake-classification">
        <label>Module sử dụng<select value={uploadClassification.moduleKey} disabled={!manageableSections.length || busy} onChange={(event) => setUploadClassification((current) => ({ ...current, moduleKey: event.target.value, semesterName: "" }))}><option value="">Chọn module</option>{manageableSections.map((section) => {
          const moduleTitle = moduleDefinitions.find((module) => module.key === section.moduleKey)?.title ?? section.title;
          return <option key={section.key} value={section.key}>{moduleTitle}</option>;
        })}</select></label>
        <label>Năm học<select value={uploadClassification.academicYear} disabled={(!filterOptions.academicYear.length && !uploadClassification.academicYear) || busy} onChange={(event) => setUploadClassification((current) => ({ ...current, academicYear: event.target.value, semesterName: "" }))}><option value="">Chọn năm học</option>{uploadClassification.academicYear && !filterOptions.academicYear.some((year) => normalizeAcademicYear(year) === normalizeAcademicYear(uploadClassification.academicYear)) && <option value={uploadClassification.academicYear}>{normalizeAcademicYear(uploadClassification.academicYear)}</option>}{filterOptions.academicYear.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
        <label>Học kỳ<select value={uploadClassification.semesterName} disabled={!selectedUploadSection || selectedUploadSection.key === "academic-years" || !uploadClassification.academicYear || busy} onChange={(event) => setUploadClassification((current) => ({ ...current, semesterName: event.target.value }))}>{!selectedUploadSection ? <option value="">Chọn module trước</option> : selectedUploadSection.key === "academic-years" ? <option value="">Không áp dụng</option> : <><option value="">Tất cả học kỳ</option>{intakeSemesterOptions.map((semester) => <option key={semester.value} value={semester.value}>{semester.title}</option>)}</>}</select></label>
      </div>
      <p className="source-data-classification-hint">Phân loại này áp dụng cho toàn bộ tệp trong lần tải lên. Chọn module, năm học và một học kỳ cụ thể hoặc để “Tất cả học kỳ”.</p>
      <div className="source-data-intake-grid">
        <div className="source-data-file-picker">
          <input ref={inputRef} hidden type="file" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
          <input ref={replaceInputRef} hidden type="file" onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            const target = replaceTargetRef.current;
            event.currentTarget.value = "";
            replaceTargetRef.current = null;
            if (file && target) void importFiles([file], target);
          }} />
          <button type="button" disabled={!canUpload || busy || !intakeClassificationReady} onClick={() => inputRef.current?.click()}><FileUp size={16} /> Chọn tệp</button>
          <span title={files.map((file) => file.name).join(", ")}>{files.length ? files.map((file) => file.name).join(", ") : canUpload ? "Chưa chọn tệp" : "Tài khoản không có quyền nhập dữ liệu nguồn"}</span>
        </div>
        <button className="workspace-primary source-data-import-button" type="button" disabled={!files.length || busy || !canUpload || !intakeClassificationReady} onClick={() => void importFiles()}>{busy ? "Đang trích xuất và lưu…" : "Tải lên và trích xuất"}</button>
      </div>
      <p className="source-data-hint">Có thể tải lên tệp ở mọi định dạng. Hệ thống tự trích xuất bảng từ Excel/CSV, PDF và hình ảnh; các tệp khác vẫn được lưu như tài liệu nguồn. PDF/hình ảnh được nhận diện bằng OCR tiếng Việt/Anh; lần đầu dùng OCR có thể cần kết nối mạng.</p>
    </section>
    <section className="workspace-panel source-data-file-library">
      <div className="source-data-file-history-heading"><strong><CalendarDays size={16} /> Tệp nguồn đã lưu</strong><span>{filteredSourceFiles.length === sourceFiles.length ? `${sourceFiles.length} tệp` : `${filteredSourceFiles.length} / ${sourceFiles.length} tệp`}</span></div>
      <div className="workspace-filter-panel source-data-filter-panel" aria-label="Bộ lọc tệp nguồn">
        <QuickFilterHeading subtitle="Lọc nhanh theo module, năm học, học kỳ, tệp nguồn" onClear={() => { setSourceFilters({ academicYear: "", semesterName: "", moduleKey: "", fileName: "", search: "" }); setSearchDraft(""); }} clearDisabled={!hasActiveSourceFilters} />
        <div className="workspace-filter-controls source-data-filter-controls">
          <label>Năm học<SearchableFilter value={sourceFilters.academicYear} disabled={!filterOptions.academicYear.length} allValue="" allLabel="Tất cả năm học" options={filterOptions.academicYear.map((year) => ({ value: year, label: year }))} onChange={(nextYear) => { const matchingTerms = sourceSemesterGroups.find((group) => normalizeAcademicYear(group.academicYear) === normalizeAcademicYear(nextYear))?.semesters ?? []; setSourceFilters((current) => ({ ...current, academicYear: nextYear, semesterName: current.semesterName && nextYear && (!matchingTerms.some((term) => semesterFilterIdentity(term) === semesterFilterIdentity(current.semesterName)) || (academicYearFromSemester(current.semesterName) && normalizeAcademicYear(academicYearFromSemester(current.semesterName)) !== normalizeAcademicYear(nextYear))) ? "" : current.semesterName })); }} /></label>
          <label>Học kỳ<SearchableFilter value={sourceFilters.semesterName} disabled={!sourceSemesterOptions.length} allValue="" allLabel="Tất cả học kỳ" options={sourceSemesterOptions.map((semester) => ({ value: semester, label: semester }))} onChange={(value) => setSourceFilters((current) => ({ ...current, semesterName: value }))} /></label>
          <label>Module sử dụng<SearchableFilter value={sourceFilters.moduleKey} disabled={!filterOptions.module.length} allValue="" allLabel="Tất cả module" options={filterOptions.module.map((module) => ({ value: module.key, label: module.title }))} onChange={(value) => setSourceFilters((current) => ({ ...current, moduleKey: value }))} /></label>
          <label>Tệp nguồn<SearchableFilter value={sourceFilters.fileName} allValue="" allLabel="Tất cả tệp" options={filterOptions.fileName.map((fileName) => ({ value: fileName, label: fileName }))} onChange={(value) => setSourceFilters((current) => ({ ...current, fileName: value }))} /></label>
          <form className="source-data-filter-search-row" onSubmit={(event) => { event.preventDefault(); setSourceFilters((current) => ({ ...current, search: searchDraft })); }}>
            <label className="source-data-filter-search">Tìm nhanh<div><Search size={16} aria-hidden="true" /><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Tìm tệp nguồn, người tải lên…" /></div></label>
            <button type="submit"><Search size={16} /> Tìm</button>
          </form>
        </div>
      </div>
      {(filteredSourceFiles.length > 0 || selectedFileIds.length > 0) && <div className="source-data-file-bulk-actions">
        <label><input type="checkbox" checked={allVisibleFilesSelected} disabled={busy || !visibleFileIds.length} onChange={toggleVisibleFileSelection} /> Chọn tất cả ({filteredSourceFiles.length})</label>
        <span>{selectedFileIds.length} tệp đã chọn</span>
        <button type="button" disabled={!selectedEditableFiles.length || busy} onClick={() => beginEditSourceFiles(selectedEditableFiles)}><Pencil size={15} /> Sửa</button>
        <button type="button" disabled={!selectedFiles.length || busy} onClick={() => void downloadSelectedSourceFiles()}><Download size={15} /> Tải về</button>
        <button className="source-data-bulk-delete" type="button" disabled={!selectedDeletableFiles.length || busy} onClick={() => void deleteSelectedSourceFiles()}><Trash2 size={15} /> Xóa{selectedDeletableFiles.length ? ` (${selectedDeletableFiles.length})` : ""}</button>
        <button type="button" disabled={!selectedFileIds.length || busy} onClick={() => setSelectedFileIds([])}>Bỏ chọn</button>
      </div>}
      {filteredSourceFiles.length ? <div className="source-data-file-list">{filteredSourceFiles.map((storedFile) => {
        const classifications = sourceFileClassifications(storedFile);
        const fileName = String(storedFile.data.fileName ?? "Tệp nguồn");
        const uploader = String(storedFile.data.modifiedBy || storedFile.data.uploadedBy || "");
        const modifiedAt = storedFile.data.modifiedAt ? new Date(String(storedFile.data.modifiedAt)).toLocaleString("vi-VN") : "";
        return <div className="source-data-file-row" key={storedFile.id}>
          <label className="source-data-file-select" aria-label={`Chọn tệp ${fileName}`}><input type="checkbox" checked={selectedFileIds.includes(storedFile.id)} disabled={busy} onChange={() => toggleFileSelection(storedFile.id)} /></label>
          <div><strong>{fileName}</strong><b>Phân loại dữ liệu trích xuất</b><div className="source-data-file-classifications">{classifications.length ? classifications.map((classification, index) => {
            const section = sourceDataSections.find((item) => item.key === classification.categoryKey);
            const moduleKey = section?.moduleKey ?? classification.categoryKey;
            const moduleTitle = moduleDefinitions.find((module) => module.key === moduleKey)?.title ?? section?.title ?? moduleKey;
            const semesterName = moduleKey === "academic-years" ? "Không áp dụng" : formatSemesterLabel(classification.semesterName, classification.academicYear);
            return <span key={`${classification.categoryKey}-${classification.academicYear}-${classification.semesterName}-${index}`}><b>Module:</b> {moduleTitle} <b>· Học kỳ:</b> {semesterName || "Chưa xác định"} <b>· Năm học:</b> {classification.academicYear || "Chưa xác định"} <b>· Số dòng:</b> {classification.rowCount}</span>;
          }) : <span>Chưa trích xuất vào module nào.</span>}</div><span>{uploader ? `Tải lên/cập nhật bởi ${uploader}` : ""}{modifiedAt ? ` · ${modifiedAt}` : ""}</span></div>
          <div className="source-data-file-actions">
            <button type="button" title="Xem trước tài liệu" aria-label={`Xem trước tài liệu ${fileName}`} disabled={busy} onClick={() => void previewSourceFile(storedFile)}><Eye size={16} /></button>
            {canReplaceFile(storedFile) && <button type="button" title="Sửa phân loại tệp" aria-label={`Sửa phân loại tệp ${fileName}`} disabled={busy} onClick={() => beginEditSourceFiles([storedFile])}><Pencil size={16} /></button>}
            <button type="button" title="Tải tài liệu gốc" aria-label={`Tải tài liệu ${fileName}`} disabled={busy} onClick={() => void downloadSourceFile(storedFile)}><Download size={16} /></button>
            {canReplaceFile(storedFile) && <button type="button" title="Thay tài liệu bằng tệp khác" aria-label={`Thay tài liệu ${fileName}`} disabled={busy} onClick={() => beginReplaceSourceFile(storedFile)}><FileUp size={16} /></button>}
            {canDeleteFile(storedFile) && <button className="source-data-delete-file" type="button" title="Xóa tài liệu" aria-label={`Xóa tài liệu ${fileName}`} disabled={busy} onClick={() => void deleteSourceFile(storedFile)}><Trash2 size={16} /></button>}
          </div>
        </div>;
      })}</div> : <p className="source-data-empty-files">{sourceFiles.length ? "Không tìm thấy tệp phù hợp với bộ lọc." : "Chưa có tệp nguồn được lưu."}</p>}
    </section>
    {previewFile && <div className="source-data-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closePreview(); }}>
      <section className="source-data-preview-dialog" role="dialog" aria-modal="true" aria-label={`Xem trước ${String(previewFile.data.fileName ?? "tệp nguồn")}`}>
        <header><strong><Eye size={17} /> {String(previewFile.data.fileName ?? "Tệp nguồn")}</strong><button type="button" aria-label="Đóng xem trước" onClick={closePreview}><X size={18} /></button></header>
        <div className="source-data-preview-content">
          {previewLoading ? <p>Đang tải bản xem trước…</p> : previewUrl ? (() => {
            const contentType = String(previewFile.data.contentType ?? "").toLowerCase();
            if (contentType.startsWith("image/")) return <img src={previewUrl} alt={String(previewFile.data.fileName ?? "Tệp nguồn")} />;
            if (contentType === "application/pdf" || contentType.startsWith("text/") || contentType === "application/json") return <iframe src={previewUrl} title={`Xem trước ${String(previewFile.data.fileName ?? "tệp nguồn")}`} />;
            return <div className="source-data-preview-unsupported"><p>Trình duyệt không hỗ trợ xem trước định dạng này.</p><button type="button" onClick={() => void downloadSourceFile(previewFile)}><Download size={15} /> Tải tệp về</button></div>;
          })() : <p>Không tải được bản xem trước.</p>}
        </div>
        <footer><button type="button" onClick={() => void downloadSourceFile(previewFile)}><Download size={15} /> Tải về</button><button type="button" onClick={closePreview}>Đóng</button></footer>
      </section>
    </div>}
    {editingFiles.length > 0 && <div className="source-data-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setEditingFiles([]); }}>
      <section className="source-data-edit-dialog" role="dialog" aria-modal="true" aria-label="Sửa phân loại tệp nguồn">
        <header><strong><Pencil size={17} /> Sửa phân loại {editingFiles.length === 1 ? "tệp nguồn" : `${editingFiles.length} tệp nguồn`}</strong><button type="button" aria-label="Đóng sửa phân loại" disabled={busy} onClick={() => setEditingFiles([])}><X size={18} /></button></header>
        <div className="source-data-edit-content">
          {editingFiles.length === 1 && <p className="source-data-edit-filename">{String(editingFiles[0].data.fileName ?? "Tệp nguồn")}</p>}
          <div className="source-data-intake-classification">
            <label>Module sử dụng<select value={editClassification.moduleKey} disabled={busy} onChange={(event) => setEditClassification((current) => ({ ...current, moduleKey: event.target.value, semesterName: "" }))}><option value="">Chọn module</option>{manageableSections.map((section) => <option key={section.key} value={section.key}>{section.title}</option>)}</select></label>
            <label>Năm học<select value={editClassification.academicYear} disabled={busy} onChange={(event) => setEditClassification((current) => ({ ...current, academicYear: event.target.value, semesterName: "" }))}><option value="">Chọn năm học</option>{uniqueAcademicYears([...filterOptions.academicYear, editClassification.academicYear]).map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
            <label>Học kỳ<select value={selectedEditSection?.key === "academic-years" ? "" : editClassification.semesterName} disabled={busy || !selectedEditSection || selectedEditSection.key === "academic-years" || !editClassification.academicYear} onChange={(event) => setEditClassification((current) => ({ ...current, semesterName: event.target.value }))}>{selectedEditSection?.key === "academic-years" ? <option value="">Không áp dụng</option> : <><option value="">Tất cả học kỳ</option>{editClassification.semesterName && !editSemesterOptions.some((option) => option.value === editClassification.semesterName) && <option value={editClassification.semesterName}>{formatSemesterLabel(editClassification.semesterName, editClassification.academicYear)}</option>}{editSemesterOptions.map((semester) => <option key={semester.value} value={semester.value}>{semester.title}</option>)}</>}</select></label>
          </div>
          <p className="source-data-edit-hint">Thay đổi này cập nhật phân loại của tệp đã lưu; hệ thống không trích xuất lại dữ liệu.</p>
        </div>
        <footer><button type="button" disabled={busy || !selectedEditSection || !editClassification.academicYear} onClick={() => void saveFileClassification()}>{busy ? "Đang lưu…" : "Lưu thay đổi"}</button><button type="button" disabled={busy} onClick={() => setEditingFiles([])}>Hủy</button></footer>
      </section>
    </div>}
  </section>;
}
