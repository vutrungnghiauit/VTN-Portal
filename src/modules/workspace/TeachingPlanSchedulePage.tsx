import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarDays, Database, FileUp, Pencil, Plus, Printer, Trash2, X, Eye } from "lucide-react";
import * as XLSX from "xlsx";
import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { workspaceService, type WorkspaceRecord } from "./workspace.service";
import { sourceDataService, sourceValues } from "../source-data/source-data.service";
import { academicSchedule2025_2026, progressScheduleToRows, progressSchedulesFromRows, type AcademicSchedule, type ProgressMark, type ProgressTerm, type TeachingProgressSourceRow } from "./teaching-plan-progress-data";
import { settingsService } from "../settings/settings.service";
import { supabase } from "../../lib/supabase";
import { SortableTableHeader } from "../../components/SortableTableHeader";
import SearchableFilter from "../../components/SearchableFilter";
import { sortTableRows } from "../../lib/table-sort";
import { formatSemesterLabel } from "../../lib/semester-groups";
import "./teaching-plan-schedule.css";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Monday start dates and marked weeks follow the official NTTU academic progress sheets.
const schedules: AcademicSchedule[] = [
  { year: "2023–2024", terms: [
    { name: "Học kỳ 1", start: "2023-10-09", weeks: 17, examWeeks: [10, 17], marks: [{ date: "2023-11-20", kind: "holiday", label: "Ngày Nhà giáo Việt Nam" }, { date: "2024-01-01", kind: "holiday", label: "Tết Dương lịch" }] },
    { name: "Học kỳ 2", start: "2024-02-05", weeks: 18, examWeeks: [10, 18], marks: [{ date: "2024-04-18", kind: "holiday", label: "Giỗ Tổ Hùng Vương" }, { date: "2024-04-30", kind: "holiday", label: "Ngày Giải phóng miền Nam" }, { date: "2024-05-01", kind: "holiday", label: "Quốc tế Lao động" }] },
    { name: "Học kỳ 3", start: "2024-06-10", weeks: 17, examWeeks: [10, 17], marks: [{ date: "2024-09-02", kind: "holiday", label: "Quốc khánh" }] },
  ] },
  { year: "2024–2025", terms: [
    { name: "Học kỳ 1", start: "2024-10-07", weeks: 18, examWeeks: [16], marks: [{ date: "2024-11-20", kind: "holiday", label: "Ngày Nhà giáo Việt Nam" }, { date: "2025-01-01", kind: "holiday", label: "Tết Dương lịch" }, { date: "2025-01-27", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2025-01-28", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2025-01-29", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2025-01-30", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2025-01-31", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2025-02-01", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2025-02-02", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }] },
    { name: "Học kỳ 2", start: "2025-02-10", weeks: 17, examWeeks: [17], marks: [{ date: "2025-04-07", kind: "holiday", label: "Nghỉ bù" }, { date: "2025-04-30", kind: "holiday", label: "Ngày Giải phóng miền Nam" }, { date: "2025-05-01", kind: "holiday", label: "Quốc tế Lao động" }] },
    { name: "Học kỳ 3", start: "2025-06-09", weeks: 17, examWeeks: [17], marks: [{ date: "2025-09-02", kind: "holiday", label: "Quốc khánh" }] },
  ] },
  academicSchedule2025_2026,
  { year: "2026–2027", terms: [
    { name: "Học kỳ 1", start: "2026-10-05", weeks: 17, examWeeks: [17], marks: [{ date: "2026-11-20", kind: "planned", label: "Nghỉ theo kế hoạch" }, { date: "2027-01-01", kind: "holiday", label: "Tết Dương lịch" }] },
    { name: "Học kỳ 2", start: "2027-02-01", weeks: 18, examWeeks: [18], marks: [{ date: "2027-02-01", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2027-02-02", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2027-02-03", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2027-02-04", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2027-02-05", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2027-02-06", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2027-02-07", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2027-04-16", kind: "holiday", label: "Giỗ Tổ Hùng Vương" }, { date: "2027-04-30", kind: "holiday", label: "Ngày Giải phóng miền Nam" }, { date: "2027-05-01", kind: "holiday", label: "Quốc tế Lao động" }, { date: "2027-06-05", kind: "planned", label: "Kỷ niệm thành lập Trường" }] },
    { name: "Học kỳ 3", start: "2027-06-07", weeks: 17, examWeeks: [17], marks: [{ date: "2027-09-02", kind: "holiday", label: "Quốc khánh" }, { date: "2027-09-03", kind: "planned", label: "Nghỉ theo kế hoạch" }, { date: "2027-09-04", kind: "planned", label: "Nghỉ theo kế hoạch" }, { date: "2027-09-05", kind: "planned", label: "Nghỉ theo kế hoạch" }] },
  ] },
];

const weekdays = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"];
const asDate = (iso: string) => new Date(`${iso}T00:00:00`);
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const formatDate = (date: Date) => date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
const normalizeAcademicYear = (value: unknown) => String(value ?? "").replace(/[–—−]/g, "-");
const vietnamTodayKey = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());

function activeTeachingPeriod(items: AcademicSchedule[], today: string) {
  for (const item of items) {
    for (const term of item.terms) {
      const end = asDate(term.start);
      end.setDate(end.getDate() + term.weeks * 7 - 1);
      if (term.start <= today && dateKey(end) >= today) return { year: item.year, term: term.name };
    }
  }
  return undefined;
}

export function getTeachingPeriodCatalog() {
  return schedules.map((schedule) => {
    const year = schedule.year.replace(/[–—−]/g, "-");
    const terms = schedule.terms.map((term) => {
      const end = asDate(term.start); end.setDate(end.getDate() + term.weeks * 7 - 1);
      return { title: `${term.name} - ${year}`, academicYear: year, startDate: term.start, endDate: dateKey(end), weeks: term.weeks };
    });
    return { year: { title: year, startDate: terms[0].startDate, endDate: terms[terms.length - 1].endDate }, terms };
  });
}

function firstMonday(year: number, month: number) {
  const date = new Date(year, month, 1); date.setDate(1 + ((8 - date.getDay()) % 7)); return dateKey(date);
}

function estimatedSchedule(year: number): AcademicSchedule {
  const nextYear = year + 1;
  return { year: `${year}–${nextYear}`, terms: [
    { name: "Học kỳ 1", start: firstMonday(year, 9), weeks: 17, examWeeks: [], marks: [] },
    { name: "Học kỳ 2", start: firstMonday(nextYear, 1), weeks: 18, examWeeks: [], marks: [] },
    { name: "Học kỳ 3", start: firstMonday(nextYear, 5), weeks: 17, examWeeks: [], marks: [] },
  ] };
}

export async function ensureCurrentAcademicPeriods() {
  const today = dateKey(new Date());
  const known = schedules.map((schedule) => {
    const first = schedule.terms[0]; const last = schedule.terms[schedule.terms.length - 1];
    const end = asDate(last.start); end.setDate(end.getDate() + last.weeks * 7 - 1);
    return { schedule, start: first.start, end: dateKey(end) };
  }).find((period) => period.start <= today && period.end >= today);
  const academicStartYear = new Date().getMonth() >= 9 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const estimate = known ? undefined : estimatedSchedule(academicStartYear);
  const estimateEnd = estimate ? asDate(estimate.terms[2].start) : undefined;
  if (estimateEnd && estimate) estimateEnd.setDate(estimateEnd.getDate() + estimate.terms[2].weeks * 7 - 1);
  const current = known ?? (estimate && estimateEnd && estimate.terms[0].start <= today && dateKey(estimateEnd) >= today
    ? { schedule: estimate, start: estimate.terms[0].start, end: dateKey(estimateEnd) }
    : undefined);
  if (!current) return;

  const [years, semesters] = await Promise.all([workspaceService.list("academic-years"), workspaceService.list("semesters")]);
  const { schedule } = current;
  const endDate = current.end;
  if (!years.some((row) => row.data.title === schedule.year)) {
    await workspaceService.save("academic-years", { title: schedule.year, startDate: current.start, endDate, status: "Đang áp dụng", notes: estimate ? "Năm học tự động khởi tạo theo mốc dự kiến (thứ Hai đầu tiên của tháng 10); cần đối chiếu thông báo chính thức." : "Tự động khởi tạo theo lịch tiến độ đào tạo đã cấu hình." });
  }

  const activeTerm = schedule.terms.find((term) => {
    const end = asDate(term.start); end.setDate(end.getDate() + term.weeks * 7 - 1);
    return term.start <= today && dateKey(end) >= today;
  });
  if (!activeTerm) return;
  const title = `${activeTerm.name} - ${schedule.year}`;
  const termEnd = asDate(activeTerm.start); termEnd.setDate(termEnd.getDate() + activeTerm.weeks * 7 - 1);
  if (!semesters.some((row) => row.data.title === title)) {
    await workspaceService.save("semesters", { title, academicYear: schedule.year, startDate: activeTerm.start, endDate: dateKey(termEnd), weeks: activeTerm.weeks, current: "Có", notes: estimate ? "Học kỳ tự động tạo theo mốc dự kiến; cần cập nhật theo lịch chính thức của trường." : "Tự động khởi tạo khi học kỳ bắt đầu theo lịch tiến độ đào tạo đã cấu hình." });
    window.dispatchEvent(new CustomEvent("vtn-semester-list-updated", { detail: title }));
  }
  const settings = await settingsService.get();
  if (settings.current_semester !== title) {
    if (!supabase) return;
    const { error } = await supabase.rpc("set_current_semester", { p_name: title });
    if (error) throw error;
    window.dispatchEvent(new CustomEvent("vtn-system-settings-updated", { detail: { ...settings, current_semester: title } }));
  }
}

type PlanField = "academicYear" | "semester" | "week" | "date" | "subject" | "className" | "title" | "status" | "notes";
type TeachingPlanImport = Record<PlanField, string> & { semesterName: string };
type PositionedPlanText = { text: string; x: number; y: number; width: number; height: number };

const planFieldAliases: Record<PlanField, string[]> = {
  academicYear: ["academicYear", "academic year", "Năm học", "Niên khóa", "Niên khoá"],
  semester: ["semester", "Học kỳ", "Học kì", "Kỳ học"],
  week: ["week", "Tuần", "Tuần học", "Tuần thứ"],
  date: ["date", "Ngày", "Ngày thực hiện", "Ngày học"],
  subject: ["subject", "Môn học", "Tên môn học", "Học phần"],
  className: ["className", "class name", "Lớp", "Mã lớp", "Lớp học phần"],
  title: ["title", "Tiêu đề", "Chủ đề", "Nội dung", "Nội dung buổi học", "Nội dung giảng dạy", "Kế hoạch"],
  status: ["status", "Trạng thái"],
  notes: ["notes", "Ghi chú"],
};
const planHeaderLookup = new Map(Object.entries(planFieldAliases).flatMap(([field, aliases]) => aliases.map((alias) => [normalizePlanHeader(alias), field as PlanField])));
const requiredPlanFields: PlanField[] = ["academicYear", "semester", "week", "date", "title"];

function normalizePlanHeader(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLocaleLowerCase("vi-VN").replace(/[^a-z0-9]/g, "");
}

function planFieldForHeader(value: unknown) {
  return planHeaderLookup.get(normalizePlanHeader(value));
}

function normalizePlanDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return dateKey(value);
  const text = String(value ?? "").trim();
  const iso = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const local = text.match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/);
  return local ? `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}` : "";
}

function parsePlanMatrix(matrix: unknown[][], strictRows: boolean): TeachingPlanImport[] | undefined {
  const headerIndex = matrix.findIndex((row) => {
    const fields = row.map(planFieldForHeader);
    return requiredPlanFields.every((field) => fields.includes(field));
  });
  if (headerIndex < 0) return undefined;
  const headers = matrix[headerIndex].map(planFieldForHeader);
  const records: TeachingPlanImport[] = [];
  for (const [index, cells] of matrix.slice(headerIndex + 1).entries()) {
    if (!cells.some((cell) => String(cell ?? "").trim())) continue;
    const values = Object.fromEntries((Object.keys(planFieldAliases) as PlanField[]).map((field) => [field, ""])) as Record<PlanField, string>;
    headers.forEach((field, column) => { if (field) values[field] = String(cells[column] ?? "").trim(); });
    const date = normalizePlanDate(values.date);
    const week = Number(values.week.match(/\d+/)?.[0] ?? 0);
    if (!values.academicYear || !values.semester || !values.title || !date || week < 1 || week > 60) {
      if (strictRows) throw new Error(`Dòng ${headerIndex + index + 2}: cần đủ Năm học, Học kỳ, Tuần (1–60), Ngày và Nội dung hợp lệ.`);
      continue;
    }
    records.push({ ...values, week: String(week), date, semesterName: `${values.semester} - ${values.academicYear}`, status: values.status || "Đã lên kế hoạch" });
  }
  if (!records.length && strictRows) throw new Error("Tệp chưa có dòng kế hoạch hợp lệ sau hàng tiêu đề.");
  return records;
}

function groupPositionedPlanLines(items: PositionedPlanText[]) {
  const sorted = [...items].filter((item) => item.text.trim()).sort((a, b) => a.y - b.y || a.x - b.x);
  const averageHeight = sorted.length ? sorted.reduce((total, item) => total + item.height, 0) / sorted.length : 10;
  const lineTolerance = Math.max(4, averageHeight * 0.55);
  const lines: Array<{ y: number; items: PositionedPlanText[] }> = [];
  for (const item of sorted) {
    const current = lines[lines.length - 1];
    if (current && Math.abs(item.y - current.y) <= lineTolerance) {
      current.items.push(item);
      current.y = current.items.reduce((total, lineItem) => total + lineItem.y, 0) / current.items.length;
    } else lines.push({ y: item.y, items: [item] });
  }
  return lines.map((line) => {
    const rowItems = line.items.sort((a, b) => a.x - b.x);
    const gapLimit = Math.max(8, averageHeight * 0.85);
    const cells: Array<{ text: string; x: number; width: number }> = [];
    for (const item of rowItems) {
      const previous = cells[cells.length - 1];
      const itemWidth = item.width || item.text.length * averageHeight * 0.45;
      if (previous && item.x - (previous.x + previous.width) <= gapLimit) {
        previous.text += ` ${item.text}`;
        previous.width = item.x + itemWidth - previous.x;
      } else cells.push({ text: item.text, x: item.x, width: itemWidth });
    }
    return { items: rowItems, cells };
  });
}

function parsePositionedPlanPage(items: PositionedPlanText[]): TeachingPlanImport[] {
  const lines = groupPositionedPlanLines(items);
  const headerIndex = lines.findIndex(({ cells }) => requiredPlanFields.every((field) => cells.some((cell) => planFieldForHeader(cell.text) === field)));
  if (headerIndex < 0) return [];
  const headerCells = lines[headerIndex].cells.map((cell) => ({ ...cell, field: planFieldForHeader(cell.text) }));
  const centers = headerCells.map((cell) => cell.x + cell.width / 2);
  const matrix: unknown[][] = [headerCells.map((cell) => cell.text)];
  for (const line of lines.slice(headerIndex + 1)) {
    if (requiredPlanFields.every((field) => line.cells.some((cell) => planFieldForHeader(cell.text) === field))) continue;
    const cells = headerCells.map(() => "");
    for (const item of line.items) {
      const center = item.x + (item.width || item.text.length * 5) / 2;
      let column = centers.length - 1;
      for (let index = 0; index < centers.length - 1; index += 1) {
        if (center < (centers[index] + centers[index + 1]) / 2) { column = index; break; }
      }
      cells[column] = `${cells[column]} ${item.text}`.trim();
    }
    matrix.push(cells);
  }
  return parsePlanMatrix(matrix, false) ?? [];
}

async function readPlanImage(file: File): Promise<TeachingPlanImport[]> {
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
      image = element; width = element.naturalWidth; height = element.naturalHeight; releaseImage = () => URL.revokeObjectURL(url);
    } catch (cause) { URL.revokeObjectURL(url); throw cause; }
  }
  const scale = Math.min(2, 2600 / width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) { releaseImage(); throw new Error("Không thể xử lý ảnh trong trình duyệt này."); }
  context.drawImage(image, 0, 0, canvas.width, canvas.height); releaseImage();
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(["vie", "eng"]);
  try {
    const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const words = (data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words))).map((word) => ({ text: word.text.trim(), x: word.bbox.x0, y: word.bbox.y0, width: word.bbox.x1 - word.bbox.x0, height: word.bbox.y1 - word.bbox.y0 })).filter((word) => word.text);
    return parsePositionedPlanPage(words);
  } finally { await worker.terminate(); }
}

async function readPlanPdf(file: File): Promise<TeachingPlanImport[]> {
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const document = await task.promise;
  try {
    const pages: Array<{ page: Awaited<ReturnType<typeof document.getPage>>; words: PositionedPlanText[] }> = [];
    const textRecords: TeachingPlanImport[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const words = content.items.flatMap((item) => {
        if (!("str" in item) || !("transform" in item)) return [];
        const text = String(item.str ?? "").trim();
        return text ? [{ text, x: item.transform[4], y: -item.transform[5], width: item.width ?? text.length * 5, height: Math.abs(item.transform[3]) || 10 }] : [];
      });
      textRecords.push(...parsePositionedPlanPage(words));
      pages.push({ page, words });
    }
    if (textRecords.length) return textRecords;
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker(["vie", "eng"]);
    const ocrRecords: TeachingPlanImport[] = [];
    try {
      for (const { page } of pages) {
        const viewport = page.getViewport({ scale: 2 });
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Không thể xử lý PDF trong trình duyệt này.");
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
        const words = (data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words))).map((word) => ({ text: word.text.trim(), x: word.bbox.x0, y: word.bbox.y0, width: word.bbox.x1 - word.bbox.x0, height: word.bbox.y1 - word.bbox.y0 })).filter((word) => word.text);
        ocrRecords.push(...parsePositionedPlanPage(words));
      }
    } finally { await worker.terminate(); }
    if (!ocrRecords.length) throw new Error("Không tìm thấy bảng có đủ cột Năm học, Học kỳ, Tuần, Ngày và Nội dung trong PDF.");
    return ocrRecords;
  } finally { await task.destroy(); }
}

async function readPlanFile(file: File): Promise<TeachingPlanImport[]> {
  const name = file.name.toLocaleLowerCase("vi-VN");
  if (name.endsWith(".pdf") || file.type === "application/pdf") return readPlanPdf(file);
  if (file.type.startsWith("image/") || /\.(apng|avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i.test(name)) {
    const records = await readPlanImage(file);
    if (!records.length) throw new Error("Không nhận diện được bảng kế hoạch trong ảnh. Ảnh cần rõ hàng tiêu đề Năm học, Học kỳ, Tuần, Ngày và Nội dung.");
    return records;
  }
  if (!/\.(xls|xlsx|csv)$/i.test(name)) throw new Error("Chỉ hỗ trợ tệp .xls, .xlsx, .csv, .pdf hoặc định dạng ảnh.");
  const workbook = /\.csv$/i.test(name)
    ? XLSX.read(await file.text(), { type: "string", raw: false, cellDates: true, dateNF: "dd/mm/yyyy" })
    : XLSX.read(await file.arrayBuffer(), { type: "array", raw: false, cellDates: true, dateNF: "dd/mm/yyyy" });
  const records: TeachingPlanImport[] = [];
  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false, dateNF: "dd/mm/yyyy" });
    const parsed = parsePlanMatrix(matrix, true);
    if (parsed) records.push(...parsed);
  }
  if (!records.length) throw new Error("Không tìm thấy bảng kế hoạch có đủ cột Năm học, Học kỳ, Tuần, Ngày và Nội dung.");
  return records;
}

function stableSourcePlanId(record: Record<string, string | number | null>) {
  const key = [record.academicYear, record.semester, record.week, record.date, record.subject, record.className, record.title].join("|");
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  return `source-teaching-plan-${(hash >>> 0).toString(16)}`;
}

type ScheduleDraft = { start: string; weeks: string; examWeeks: string; marks: ProgressMark[] };

function mergeAcademicSchedules(...groups: AcademicSchedule[][]): AcademicSchedule[] {
  const merged = new Map<string, AcademicSchedule>();
  for (const group of groups) {
    for (const schedule of group) {
      const key = normalizeAcademicYear(schedule.year);
      const current = merged.get(key);
      const terms = new Map((current?.terms ?? []).map((term) => [term.name, term]));
      schedule.terms.forEach((term) => terms.set(term.name, term));
      merged.set(key, { year: schedule.year, terms: [...terms.values()].sort((a, b) => a.start.localeCompare(b.start)) });
    }
  }
  return [...merged.values()].sort((a, b) => Number(a.year.match(/\d{4}/)?.[0] ?? 0) - Number(b.year.match(/\d{4}/)?.[0] ?? 0));
}

function TeachingTermCalendar({ term, plans, todayKey, onEditPlan, canEditPlan, onOpenTerm, modal = false }: {
  term: ProgressTerm;
  plans: WorkspaceRecord[];
  todayKey: string;
  onEditPlan: (plan: WorkspaceRecord) => void;
  canEditPlan: boolean;
  onOpenTerm?: () => void;
  modal?: boolean;
}) {
  const start = asDate(term.start);
  return <div className={`teaching-calendar-scroll${modal ? " teaching-calendar-modal-scroll" : ""}`}><table><thead><tr><th>Tuần</th>{weekdays.map((day) => <th key={day}>{day}</th>)}</tr></thead><tbody>{Array.from({ length: term.weeks }, (_, weekIndex) => {
    const week = weekIndex + 1; const isExam = term.examWeeks.includes(week);
    return <tr key={week} className={isExam ? "exam-week" : ""}><th><span>{String(week).padStart(2, "0")}</span>{isExam && <small>Thi</small>}</th>{weekdays.map((_, day) => {
      const date = new Date(start); date.setDate(start.getDate() + weekIndex * 7 + day);
      const key = dateKey(date);
      const mark = term.marks.find((item) => item.date === key);
      const isToday = key === todayKey;
      const dayPlans = plans.filter((plan) => plan.data.date === key);
      const openOnMark = mark && onOpenTerm ? onOpenTerm : undefined;
      const cellLabel = mark?.label ?? (isExam ? "Tuần thi học kỳ" : `${weekdays[day]}, ${formatDate(date)}`);
      return <td key={day} className={[isToday ? "today" : "", mark?.kind ?? ""].filter(Boolean).join(" ")} title={`${isToday ? "Hôm nay · " : ""}${cellLabel}`} onClick={openOnMark} onKeyDown={openOnMark ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openOnMark(); } } : undefined} role={openOnMark ? "button" : undefined} tabIndex={openOnMark ? 0 : undefined} aria-label={openOnMark ? `${isToday ? "Hôm nay, " : ""}${formatDate(date)}: ${mark?.label}; mở tiến độ học kỳ` : undefined}><span>{formatDate(date)}</span>{mark && <small>{mark.label}</small>}{dayPlans.map((plan) => canEditPlan ? <button type="button" className="teaching-plan-event" key={plan.id} title="Chỉnh sửa kế hoạch" onClick={(event) => { event.stopPropagation(); onEditPlan(plan); }}>{String(plan.data.title ?? "Kế hoạch")}</button> : <span className="teaching-plan-event" key={plan.id}>{String(plan.data.title ?? "Kế hoạch")}</span>)}</td>;
    })}</tr>;
  })}</tbody></table></div>;
}

export default function TeachingPlanSchedulePage({ canImportSourceData = false, canImportSchedule = false, canCreateSchedule = false, canUpdateSchedule = false, canDeleteSchedule = false, canExportSchedule = false }: { canImportSourceData?: boolean; canImportSchedule?: boolean; canCreateSchedule?: boolean; canUpdateSchedule?: boolean; canDeleteSchedule?: boolean; canExportSchedule?: boolean }) {
  const defaultYear = schedules.find((item) => item.year === "2025–2026")?.year ?? schedules[0].year;
  const initialToday = vietnamTodayKey();
  const initialPeriod = activeTeachingPeriod(schedules, initialToday);
  const [todayKey, setTodayKey] = useState(initialToday);
  const [year, setYear] = useState(initialPeriod?.year ?? defaultYear);
  const [semesterFilter, setSemesterFilter] = useState("all");
  const [sourceSchedules, setSourceSchedules] = useState<AcademicSchedule[]>([]);
  const [scheduleOverrides, setScheduleOverrides] = useState<AcademicSchedule[]>([]);
  const [activeScheduleYear, setActiveScheduleYear] = useState<string | null>(null);
  const [activeTermName, setActiveTermName] = useState<string | null>(null);
  const [scheduleEditMode, setScheduleEditMode] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft | null>(null);
  const [scheduleEditError, setScheduleEditError] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [plans, setPlans] = useState<WorkspaceRecord[]>([]);
  const [planPageSize, setPlanPageSize] = useState<"10" | "20" | "50" | "100" | "all">("10");
  const [planPage, setPlanPage] = useState(1);
  const [planSort, setPlanSort] = useState({ key: "ordinal", direction: "asc" as "asc" | "desc" });
  const [selectedPlanIds, setSelectedPlanIds] = useState<Set<string>>(() => new Set());
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [plansError, setPlansError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WorkspaceRecord | null>(null);
  const [viewingPlan, setViewingPlan] = useState<WorkspaceRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [importing, setImporting] = useState(false);
  const availableSchedules = useMemo(() => {
    const merged = mergeAcademicSchedules(schedules, sourceSchedules, scheduleOverrides);
    const month = Number(todayKey.slice(5, 7));
    const calendarYear = Number(todayKey.slice(0, 4));
    const generatedYear = estimatedSchedule(month >= 10 ? calendarYear : calendarYear - 1);
    return merged.some((item) => normalizeAcademicYear(item.year) === normalizeAcademicYear(generatedYear.year))
      ? merged
      : mergeAcademicSchedules(merged, [generatedYear]);
  }, [sourceSchedules, scheduleOverrides, todayKey]);
  const currentPeriod = useMemo(() => activeTeachingPeriod(availableSchedules, todayKey), [availableSchedules, todayKey]);
  const schedule = useMemo(() => availableSchedules.find((item) => item.year.replace(/[–—−]/g, "-") === year.replace(/[–—−]/g, "-")) ?? availableSchedules[0], [availableSchedules, year]);
  const visibleTerms = schedule.terms.filter((term) => semesterFilter === "all" || term.name === semesterFilter);
  const filteredPlans = plans.filter((plan) => normalizeAcademicYear(plan.data.academicYear) === normalizeAcademicYear(year)
    && (semesterFilter === "all" || String(plan.data.semester ?? "") === semesterFilter));
  const sortedPlans = sortTableRows(filteredPlans, planSort, (plan, key, index) => key === "ordinal" ? index : key === "period" ? plan.data.date : key === "semester" ? plan.data.semester : key === "subject" ? [plan.data.subject, plan.data.className].filter(Boolean).join(" · ") : key === "title" ? plan.data.title : key === "status" ? plan.data.status : undefined);
  function sortPlansBy(key: string) {
    setPlanSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" });
    setPlanPage(1);
  }
  const planPageCount = planPageSize === "all" ? 1 : Math.max(1, Math.ceil(filteredPlans.length / Number(planPageSize)));
  const safePlanPage = Math.min(planPage, planPageCount);
  const planPageStart = planPageSize === "all" ? 0 : (safePlanPage - 1) * Number(planPageSize);
  const visiblePlans = planPageSize === "all" ? sortedPlans : sortedPlans.slice(planPageStart, planPageStart + Number(planPageSize));
  const selectedVisiblePlanCount = filteredPlans.reduce((count, plan) => count + Number(selectedPlanIds.has(plan.id)), 0);
  const allVisiblePlansSelected = filteredPlans.length > 0 && selectedVisiblePlanCount === filteredPlans.length;
  const modalSchedule = activeScheduleYear ? availableSchedules.find((item) => normalizeAcademicYear(item.year) === normalizeAcademicYear(activeScheduleYear)) : undefined;
  const modalTerm = modalSchedule?.terms.find((term) => term.name === activeTermName);

  useEffect(() => {
    const refreshToday = () => setTodayKey(vietnamTodayKey());
    const interval = window.setInterval(refreshToday, 60_000);
    window.addEventListener("focus", refreshToday);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", refreshToday); };
  }, []);

  useEffect(() => {
    if (!currentPeriod) return;
    setYear(currentPeriod.year);
    setSemesterFilter("all");
  }, [currentPeriod?.year]);

  useEffect(() => {
    let mounted = true;
    void workspaceService.list("teaching-plan-schedules").then((records) => {
      if (!mounted) return;
      setScheduleOverrides(progressSchedulesFromRows(records.map((record) => record.data as TeachingProgressSourceRow)));
    }).catch((cause) => console.warn("Không thể tải mốc thời gian học kỳ đã lưu.", cause));
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!activeScheduleYear || !activeTermName) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeScheduleModal();
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [activeScheduleYear, activeTermName, scheduleEditMode, scheduleDraft]);

  function openScheduleModal(term: ProgressTerm, academicYear = schedule.year) {
    setActiveScheduleYear(academicYear);
    setActiveTermName(term.name);
    setScheduleEditMode(false);
    setScheduleDraft(null);
    setScheduleEditError("");
  }

  function chooseYear(nextYear: string) {
    setYear(nextYear);
    setSemesterFilter("all");
    setPlanPage(1);
    setSelectedPlanIds(new Set());
  }

  function chooseSemester(nextSemester: string) {
    setSemesterFilter(nextSemester);
    setPlanPage(1);
    setSelectedPlanIds(new Set());
    if (nextSemester !== "all") {
      const term = schedule.terms.find((item) => item.name === nextSemester);
      if (term) openScheduleModal(term, schedule.year);
    }
  }

  function closeScheduleModal() {
    if (scheduleEditMode && !window.confirm("Đóng popup và bỏ các thay đổi chưa lưu?")) return;
    setActiveScheduleYear(null);
    setActiveTermName(null);
    setScheduleEditMode(false);
    setScheduleDraft(null);
    setScheduleEditError("");
  }

  function beginScheduleEdit() {
    if (!canUpdateSchedule || !modalTerm) return;
    setScheduleDraft({ start: modalTerm.start, weeks: String(modalTerm.weeks), examWeeks: modalTerm.examWeeks.join(", "), marks: modalTerm.marks.map((mark) => ({ ...mark })) });
    setScheduleEditMode(true);
    setScheduleEditError("");
  }

  async function saveScheduleEdit() {
    if (!canUpdateSchedule || !modalSchedule || !modalTerm || !scheduleDraft) return;
    const weeks = Number(scheduleDraft.weeks);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduleDraft.start) || dateKey(asDate(scheduleDraft.start)) !== scheduleDraft.start) {
      setScheduleEditError("Ngày bắt đầu không hợp lệ."); return;
    }
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 60) {
      setScheduleEditError("Số tuần phải từ 1 đến 60."); return;
    }
    const examWeekInputs = scheduleDraft.examWeeks.trim() ? scheduleDraft.examWeeks.split(/[\s,;|]+/).filter(Boolean).map(Number) : [];
    if (examWeekInputs.some((week) => !Number.isInteger(week) || week < 1 || week > weeks)) { setScheduleEditError(`Tuần thi phải là số từ 1 đến ${weeks}.`); return; }
    const examWeeks = [...new Set(examWeekInputs)].sort((a, b) => a - b);
    const termEnd = asDate(scheduleDraft.start); termEnd.setDate(termEnd.getDate() + weeks * 7 - 1);
    const invalidMark = scheduleDraft.marks.some((mark) => !/^\d{4}-\d{2}-\d{2}$/.test(mark.date) || dateKey(asDate(mark.date)) !== mark.date || mark.date < scheduleDraft.start || mark.date > dateKey(termEnd) || !mark.label.trim());
    if (invalidMark) { setScheduleEditError("Mỗi mốc cần có ngày nằm trong thời gian học kỳ và nội dung."); return; }
    const updatedTerm: ProgressTerm = { ...modalTerm, start: scheduleDraft.start, weeks, examWeeks, marks: scheduleDraft.marks.map((mark) => ({ ...mark, label: mark.label.trim() })) };
    const updatedSchedule: AcademicSchedule = { year: modalSchedule.year, terms: [updatedTerm] };
    setSavingSchedule(true); setScheduleEditError("");
    try {
      const row = progressScheduleToRows(updatedSchedule)[0];
      await workspaceService.saveMany("teaching-plan-schedules", [{ externalId: `teaching-plan-schedule:${normalizeAcademicYear(modalSchedule.year)}:${modalTerm.name}`, values: row }]);
      setScheduleOverrides((current) => mergeAcademicSchedules(current, [updatedSchedule]));
      setScheduleEditMode(false);
      setScheduleDraft(null);
      setNotice(`Đã lưu mốc thời gian ${modalTerm.name} · ${modalSchedule.year}.`);
    } catch (cause) {
      setScheduleEditError(cause instanceof Error ? cause.message : "Không thể lưu mốc thời gian học kỳ.");
    } finally { setSavingSchedule(false); }
  }

  async function loadPlans() {
    setLoadingPlans(true); setPlansError("");
    try { setPlans(await workspaceService.list("teaching-plans")); }
    catch (cause) { setPlansError(cause instanceof Error ? cause.message : "Không thể tải kế hoạch đã tạo."); }
    finally { setLoadingPlans(false); }
  }
  useEffect(() => { void loadPlans(); }, []);

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (editing ? !canUpdateSchedule : !canCreateSchedule) return; const form = new FormData(event.currentTarget);
    const academicYear = String(form.get("academicYear") ?? "").trim(); const semester = String(form.get("semester") ?? "").trim();
    const data: Record<string, string> = { academicYear, semester, semesterName: `${semester} - ${academicYear}`, week: String(form.get("week") ?? "").trim(), date: String(form.get("date") ?? "").trim(), subject: String(form.get("subject") ?? "").trim(), className: String(form.get("className") ?? "").trim(), title: String(form.get("title") ?? "").trim(), status: String(form.get("status") ?? "Đã lên kế hoạch").trim(), notes: String(form.get("notes") ?? "").trim() };
    if (!data.title || !data.date || !data.week || !data.academicYear || !data.semester) { setPlansError("Vui lòng điền tiêu đề, năm học, học kỳ, tuần và ngày thực hiện."); return; }
    setSaving(true); setPlansError("");
    try { await workspaceService.save("teaching-plans", data, editing?.id); setFormOpen(false); setEditing(null); setNotice(editing ? "Đã cập nhật kế hoạch." : "Đã tạo kế hoạch giảng dạy."); await loadPlans(); }
    catch (cause) { setPlansError(cause instanceof Error ? cause.message : "Không thể lưu kế hoạch."); }
    finally { setSaving(false); }
  }

  async function importPlans(file: File) {
    if (!canImportSchedule) return;
    setImporting(true); setPlansError(""); setNotice("");
    try {
      const records = await readPlanFile(file);
      await sourceDataService.archiveImportedFile(file, "teaching-plans", records);
      for (const record of records) await workspaceService.save("teaching-plans", record);
      setNotice(`Đã nhập ${records.length} kế hoạch từ ${file.name}.`); await loadPlans();
    } catch (cause) { setPlansError(cause instanceof Error ? cause.message : "Không thể nhập tệp kế hoạch."); }
    finally { setImporting(false); }
  }

  async function importSourceData() {
    if (!canImportSourceData) return;
    setImporting(true); setPlansError(""); setNotice("");
    try {
      const sourceRows = await sourceDataService.list("teaching-plans");
      if (!sourceRows.length) throw new Error("Chưa có tệp trong mục dữ liệu nguồn “Tiến độ đào tạo”.");
      const values = sourceRows.map((row) => sourceValues(row) as TeachingProgressSourceRow);
      const importedSchedules = progressSchedulesFromRows(values);
      const planRows = values.filter((row) => String(row.rowType ?? "").toLocaleLowerCase("vi-VN") !== "semester-schedule"
        && [row.academicYear, row.semester, row.week, row.date, row.title].every((value) => String(value ?? "").trim()));
      if (!importedSchedules.length && !planRows.length) throw new Error("Dữ liệu nguồn không có tiến độ học kỳ hợp lệ hoặc kế hoạch có đủ Năm học, Học kỳ, Tuần, Ngày và Nội dung.");
      if (importedSchedules.length) {
        setSourceSchedules(importedSchedules);
        setYear(importedSchedules.at(-1)?.year ?? year);
      }
      if (planRows.length) {
        await workspaceService.saveMany("teaching-plans", planRows.map((row) => {
          const values = Object.fromEntries(Object.entries(row).filter(([key]) => key !== "rowType")) as Record<string, string | number | null>;
          return { externalId: stableSourcePlanId(values), values };
        }));
        await loadPlans();
      }
      const importedCount = importedSchedules.reduce((total, item) => total + item.terms.length, 0) + planRows.length;
      setNotice(`Đã lấy ${importedCount} dòng dữ liệu nguồn${importedSchedules.length ? ` và cập nhật tiến độ ${importedSchedules.at(-1)?.year}` : ""}.`);
    } catch (cause) { setPlansError(cause instanceof Error ? cause.message : "Không lấy được dữ liệu nguồn."); }
    finally { setImporting(false); }
  }

  function editPlan(record: WorkspaceRecord) {
    if (!canUpdateSchedule) return;
    setYear(String(record.data.academicYear ?? year));
    setSemesterFilter(String(record.data.semester ?? "").trim() || "all");
    setPlanPage(1);
    setEditing(record);
    setFormOpen(true);
    setPlansError("");
    setNotice("");
  }

  async function trashPlan(record: WorkspaceRecord) {
    if (!canDeleteSchedule) return;
    if (!window.confirm(`Chuyển kế hoạch “${record.data.title ?? ""}” vào thùng rác?`)) return;
    try { await workspaceService.moveToTrash(record.id); setSelectedPlanIds((previous) => { const next = new Set(previous); next.delete(record.id); return next; }); setPlanPage(1); setNotice("Đã chuyển kế hoạch vào thùng rác."); await loadPlans(); }
    catch (cause) { setPlansError(cause instanceof Error ? cause.message : "Không thể chuyển kế hoạch vào thùng rác."); }
  }

  const draftWeeks = Number(scheduleDraft?.weeks);
  const draftTerm: ProgressTerm | undefined = modalTerm && scheduleEditMode && scheduleDraft
    ? { ...modalTerm, start: /^\d{4}-\d{2}-\d{2}$/.test(scheduleDraft.start) ? scheduleDraft.start : modalTerm.start, weeks: Number.isInteger(draftWeeks) && draftWeeks >= 1 && draftWeeks <= 60 ? draftWeeks : modalTerm.weeks, examWeeks: scheduleDraft.examWeeks.split(/[\s,;|]+/).map(Number).filter((week) => Number.isInteger(week) && week >= 1 && week <= (Number.isInteger(draftWeeks) && draftWeeks >= 1 ? draftWeeks : modalTerm.weeks)), marks: scheduleDraft.marks }
    : modalTerm;
  const modalTermEnd = (term: ProgressTerm) => { const end = asDate(term.start); end.setDate(end.getDate() + term.weeks * 7 - 1); return end; };

  return <main className="workspace-page teaching-schedule-page">
    <header className="workspace-title-row"><div><div className="workspace-breadcrumb">Đào tạo <span>/</span> Tiến độ đào tạo</div><h1>Tiến độ đào tạo</h1><p>Lịch tiến độ đào tạo NTTU theo tuần, học kỳ và năm học.</p></div><div className="teaching-schedule-actions">{canImportSourceData && <button type="button" disabled={importing} onClick={() => void importSourceData()}><Database size={16} />{importing ? "Đang lấy…" : "Lấy dữ liệu nguồn"}</button>}{canImportSchedule && <label className="teaching-upload-button" title="Hỗ trợ .xls, .csv, .pdf và các định dạng ảnh"><FileUp size={16} />{importing ? "Đang nhập…" : "Nhập kế hoạch"}<input type="file" accept=".xls,.xlsx,.csv,.pdf,image/*" disabled={importing} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importPlans(file); event.currentTarget.value = ""; }} /></label>}{canExportSchedule && <button type="button" onClick={() => window.print()}><Printer size={16} /> In lịch</button>}</div></header>
    {plansError && <div className="workspace-alert" role="alert">{plansError}<button type="button" aria-label="Đóng thông báo" onClick={() => setPlansError("")}><X size={15} /></button></div>}{notice && <div className="workspace-notice" role="status">{notice}</div>}
    <section className="teaching-schedule-toolbar"><div className="teaching-schedule-heading"><span><CalendarDays size={18} /></span><div><strong>Tiến độ đào tạo</strong><small>Tham chiếu lịch năm học chính thức</small></div></div><div className="teaching-period-controls"><label>Năm học<SearchableFilter value={year} allValue="" allLabel="Tìm năm học" clearOnEmpty={false} options={availableSchedules.map((item) => ({ value: item.year, label: item.year }))} onChange={chooseYear} /></label><label>Học kỳ<SearchableFilter value={semesterFilter} allValue="all" allLabel="Tất cả học kỳ" options={[{ value: "all", label: "Tất cả học kỳ" }, ...schedule.terms.map((term) => ({ value: term.name, label: formatSemesterLabel(term.name, schedule.year) + (currentPeriod?.year === schedule.year && currentPeriod.term === term.name ? " · Hiện hành" : "") }))]} onChange={chooseSemester} /></label><span className="teaching-current-date"><CalendarDays size={15} /><span>Hôm nay</span><strong>{formatDate(asDate(todayKey))}</strong>{currentPeriod && <small>{formatSemesterLabel(currentPeriod.term, currentPeriod.year)}</small>}</span></div></section>
    <div className="teaching-schedule-legend"><span><i className="exam" /> Thi học kỳ</span><span><i className="holiday" /> Nghỉ lễ / Tết / nghỉ bù</span><span><i className="planned" /> Nghỉ theo kế hoạch</span></div>
    <div className={`teaching-term-grid${semesterFilter !== "all" ? " is-term-selected" : ""}`}>{visibleTerms.map((term) => {
      const start = asDate(term.start);
      const end = new Date(start); end.setDate(start.getDate() + term.weeks * 7 - 1);
      const isCurrentTerm = currentPeriod?.year === schedule.year && currentPeriod.term === term.name;
      return <article className={`teaching-term-card${isCurrentTerm ? " is-current" : ""}`} key={term.name}>
        <header><button type="button" className="teaching-term-open" onClick={() => openScheduleModal(term)} aria-label={`Xem tiến độ ${term.name}`}><span>{formatSemesterLabel(term.name, schedule.year)}{isCurrentTerm && <em>Hiện hành</em>}</span><strong>{formatDate(start)} – {formatDate(end)}</strong><small><Eye size={14} /> Xem tiến độ</small></button><b>{term.weeks} tuần</b></header>
        <TeachingTermCalendar term={term} plans={plans} todayKey={todayKey} onEditPlan={editPlan} canEditPlan={canUpdateSchedule} onOpenTerm={() => openScheduleModal(term)} modal={semesterFilter !== "all"} />
      </article>;
    })}</div>
    {modalSchedule && modalTerm && draftTerm && <div className="teaching-schedule-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeScheduleModal(); }}>
      <section className="teaching-schedule-modal" role="dialog" aria-modal="true" aria-labelledby="teaching-schedule-modal-title">
        <header className="teaching-schedule-modal-header"><div><small>{modalSchedule.year} · Tiến độ đào tạo</small><h2 id="teaching-schedule-modal-title">{formatSemesterLabel(modalTerm.name, modalSchedule.year)}</h2><strong>{formatDate(asDate(draftTerm.start))} – {formatDate(modalTermEnd(draftTerm))} · {draftTerm.weeks} tuần</strong></div><button type="button" className="teaching-schedule-modal-close" aria-label="Đóng popup" onClick={closeScheduleModal}><X size={21} /></button></header>
        <div className="teaching-schedule-modal-body">
          {scheduleEditMode && scheduleDraft && <section className="teaching-schedule-editor" aria-label="Chỉnh sửa mốc thời gian học kỳ"><div className="teaching-schedule-editor-head"><div><h3>Chỉnh sửa mốc thời gian</h3><p>Các thay đổi chỉ áp dụng cho học kỳ đang mở.</p></div><button type="button" className="teaching-schedule-add-mark" onClick={() => setScheduleDraft((current) => current ? { ...current, marks: [...current.marks, { date: current.start || modalTerm.start, kind: "planned", label: "" }] } : current)}><Plus size={15} />Thêm mốc</button></div>
            <div className="teaching-schedule-editor-fields"><label>Ngày bắt đầu<input type="date" value={scheduleDraft.start} onChange={(event) => setScheduleDraft((current) => current ? { ...current, start: event.target.value } : current)} /></label><label>Số tuần<input type="number" min="1" max="60" value={scheduleDraft.weeks} onChange={(event) => setScheduleDraft((current) => current ? { ...current, weeks: event.target.value } : current)} /></label><label>Tuần thi<input type="text" placeholder="Ví dụ: 16, 17" value={scheduleDraft.examWeeks} onChange={(event) => setScheduleDraft((current) => current ? { ...current, examWeeks: event.target.value } : current)} /></label></div>
            <div className="teaching-schedule-mark-list">{scheduleDraft.marks.map((mark, index) => <div className="teaching-schedule-mark-row" key={`${index}-${mark.date}`}><label>Ngày<input type="date" value={mark.date} onChange={(event) => setScheduleDraft((current) => current ? { ...current, marks: current.marks.map((item, itemIndex) => itemIndex === index ? { ...item, date: event.target.value } : item) } : current)} /></label><label>Loại<select value={mark.kind} onChange={(event) => setScheduleDraft((current) => current ? { ...current, marks: current.marks.map((item, itemIndex) => itemIndex === index ? { ...item, kind: event.target.value as ProgressMark["kind"] } : item) } : current)}><option value="holiday">Nghỉ lễ / nghỉ bù</option><option value="planned">Nghỉ theo kế hoạch</option></select></label><label className="teaching-schedule-mark-label">Nội dung<input value={mark.label} onChange={(event) => setScheduleDraft((current) => current ? { ...current, marks: current.marks.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) } : current)} /></label><button type="button" aria-label={`Xóa mốc ${mark.label || index + 1}`} title="Xóa mốc" onClick={() => setScheduleDraft((current) => current ? { ...current, marks: current.marks.filter((_, itemIndex) => itemIndex !== index) } : current)}><Trash2 size={16} /></button></div>)}</div>
            {scheduleEditError && <p className="teaching-schedule-edit-error" role="alert">{scheduleEditError}</p>}
          </section>}
          {!scheduleEditMode && scheduleEditError && <p className="teaching-schedule-edit-error" role="alert">{scheduleEditError}</p>}
          <div className="teaching-schedule-legend teaching-schedule-modal-legend"><span><i className="exam" /> Thi học kỳ</span><span><i className="holiday" /> Nghỉ lễ / Tết / nghỉ bù</span><span><i className="planned" /> Nghỉ theo kế hoạch</span></div>
          <TeachingTermCalendar term={draftTerm} plans={plans} todayKey={todayKey} onEditPlan={editPlan} canEditPlan={canUpdateSchedule} modal />
        </div>
        <footer className="teaching-schedule-modal-footer">{scheduleEditMode ? <><button type="button" onClick={() => { setScheduleEditMode(false); setScheduleDraft(null); setScheduleEditError(""); }}>Hủy chỉnh sửa</button><button type="button" className="teaching-schedule-save" disabled={savingSchedule} onClick={() => void saveScheduleEdit()}>{savingSchedule ? "Đang lưu…" : "Lưu mốc thời gian"}</button></> : <><button type="button" onClick={closeScheduleModal}>Đóng</button>{canUpdateSchedule && <button type="button" className="teaching-schedule-save" onClick={beginScheduleEdit}><Pencil size={15} />Chỉnh sửa mốc thời gian</button>}</>}</footer>
      </section>
    </div>}
    <section className="teaching-plans-list"><div className="teaching-plans-list-head"><div><h2>Kế hoạch đã tạo · {year}</h2><p>Các nội dung cá nhân được lưu cùng năm học tương ứng.</p></div><div className="teaching-plans-list-tools"><span>{loadingPlans ? "Đang tải…" : `${filteredPlans.length} kế hoạch`}</span>{canCreateSchedule && <button type="button" className="teaching-plan-create-button" onClick={() => { setEditing(null); setFormOpen(true); setPlansError(""); }}><Plus size={16} />Tạo kế hoạch</button>}</div></div>{formOpen && <div className="workspace-record-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) { setFormOpen(false); setEditing(null); } }}><form className="workspace-form teaching-plan-form workspace-record-modal" role="dialog" aria-modal="true" aria-labelledby="teaching-plan-form-title" onSubmit={savePlan}><div className="workspace-form-head"><h2 id="teaching-plan-form-title">{editing ? "Sửa kế hoạch giảng dạy" : "Tạo kế hoạch giảng dạy"}</h2><button type="button" aria-label="Đóng biểu mẫu" onClick={() => { setFormOpen(false); setEditing(null); }}><X size={18} /></button></div><div className="workspace-form-grid"><label>Năm học<select name="academicYear" value={String(editing?.data.academicYear ?? year)} onChange={(event) => chooseYear(event.target.value)}>{availableSchedules.map((item) => <option key={item.year}>{item.year}</option>)}</select></label><label>Học kỳ<select name="semester" defaultValue={String(editing?.data.semester ?? (semesterFilter === "all" ? schedule.terms[0].name : semesterFilter))}>{schedule.terms.map((term) => <option key={term.name} value={term.name}>{formatSemesterLabel(term.name, year)}</option>)}</select></label><label>Tuần<input name="week" type="number" min="1" max="60" defaultValue={String(editing?.data.week ?? 1)} required /></label><label>Ngày thực hiện<input name="date" type="date" defaultValue={String(editing?.data.date ?? "")} required /></label><label>Môn học<input name="subject" defaultValue={String(editing?.data.subject ?? "")} /></label><label>Lớp học phần<input name="className" defaultValue={String(editing?.data.className ?? "")} /></label><label className="workspace-span">Chủ đề / nội dung<input name="title" defaultValue={String(editing?.data.title ?? "")} required /></label><label>Trạng thái<select name="status" defaultValue={String(editing?.data.status ?? "Đã lên kế hoạch")}><option>Đã lên kế hoạch</option><option>Đang thực hiện</option><option>Hoàn thành</option><option>Tạm hoãn</option></select></label><label className="workspace-span">Ghi chú<textarea name="notes" rows={3} defaultValue={String(editing?.data.notes ?? "")} /></label></div><div className="workspace-form-actions"><button className="workspace-primary" disabled={saving}>{saving ? "Đang lưu…" : "Lưu kế hoạch"}</button><button type="button" onClick={() => { setFormOpen(false); setEditing(null); }}>Hủy</button></div></form></div>}<div className="workspace-data-selection"><label><input type="checkbox" aria-label="Chọn tất cả kế hoạch phù hợp" checked={allVisiblePlansSelected} ref={(element) => { if (element) element.indeterminate = selectedVisiblePlanCount > 0 && !allVisiblePlansSelected; }} onChange={(event) => setSelectedPlanIds((previous) => { const next = new Set(previous); filteredPlans.forEach((plan) => event.target.checked ? next.add(plan.id) : next.delete(plan.id)); return next; })} /> Chọn tất cả {filteredPlans.length.toLocaleString("vi-VN")} dòng kế hoạch</label><span>Đã chọn {selectedVisiblePlanCount.toLocaleString("vi-VN")} / {filteredPlans.length.toLocaleString("vi-VN")} dòng</span><button type="button" disabled={!selectedPlanIds.size} onClick={() => setSelectedPlanIds(new Set())}>Bỏ chọn</button></div><div className="workspace-table-wrap"><table><thead><tr><th className="gradebook-select-column"><input type="checkbox" aria-label="Chọn tất cả kế hoạch phù hợp" checked={allVisiblePlansSelected} ref={(element) => { if (element) element.indeterminate = selectedVisiblePlanCount > 0 && !allVisiblePlansSelected; }} onChange={(event) => setSelectedPlanIds((previous) => { const next = new Set(previous); filteredPlans.forEach((plan) => event.target.checked ? next.add(plan.id) : next.delete(plan.id)); return next; })} /></th><SortableTableHeader label="STT" sortKey="ordinal" sortState={planSort} onSort={sortPlansBy} /><SortableTableHeader label="NGÀY / TUẦN" sortKey="period" sortState={planSort} onSort={sortPlansBy} /><SortableTableHeader label="HỌC KỲ" sortKey="semester" sortState={planSort} onSort={sortPlansBy} /><SortableTableHeader label="MÔN / LỚP" sortKey="subject" sortState={planSort} onSort={sortPlansBy} /><SortableTableHeader label="NỘI DUNG" sortKey="title" sortState={planSort} onSort={sortPlansBy} /><SortableTableHeader label="TRẠNG THÁI" sortKey="status" sortState={planSort} onSort={sortPlansBy} /><th>THAO TÁC</th></tr></thead><tbody>{visiblePlans.map((plan, index) => <tr key={plan.id}><td className="gradebook-select-column"><input type="checkbox" aria-label={`Chọn kế hoạch ${String(plan.data.title ?? "")}`} checked={selectedPlanIds.has(plan.id)} onChange={(event) => setSelectedPlanIds((previous) => { const next = new Set(previous); if (event.target.checked) next.add(plan.id); else next.delete(plan.id); return next; })} /></td><td>{planPageStart + index + 1}</td><td>{plan.data.date ? formatDate(asDate(String(plan.data.date))) : "—"} · Tuần {String(plan.data.week ?? "—")}</td><td>{formatSemesterLabel(plan.data.semester, plan.data.academicYear) || "—"}</td><td>{[plan.data.subject, plan.data.className].filter(Boolean).join(" · ") || "—"}</td><td className="workspace-record-name">{String(plan.data.title ?? "—")}</td><td>{String(plan.data.status ?? "—")}</td><td><div className="workspace-row-actions"><button type="button" title="Xem kế hoạch" aria-label={`Xem kế hoạch ${String(plan.data.title ?? "")}`} onClick={() => setViewingPlan(plan)}><Eye size={15} /></button>{canUpdateSchedule && <button className="teaching-plan-edit-button" type="button" title="Sửa kế hoạch" aria-label={`Sửa ${plan.data.title ?? "kế hoạch"}`} onClick={() => editPlan(plan)}><Pencil size={15} />Sửa kế hoạch</button>}{canDeleteSchedule && <button type="button" title="Xóa kế hoạch" aria-label={`Xóa ${plan.data.title ?? "kế hoạch"}`} onClick={() => void trashPlan(plan)}><Trash2 size={16} /></button>}</div></td></tr>)}{!loadingPlans && !filteredPlans.length && <tr><td colSpan={8} className="workspace-state">Không có kế hoạch trong bộ lọc hiện tại.</td></tr>}{loadingPlans && <tr><td colSpan={8} className="workspace-state">Đang tải kế hoạch…</td></tr>}</tbody></table></div><div className="workspace-pagination"><label>Số dòng<select aria-label="Số dòng kế hoạch mỗi trang" value={planPageSize} onChange={(event) => { setPlanPageSize(event.target.value as "10" | "20" | "50" | "100" | "all"); setPlanPage(1); }}><option value="10">10 dòng</option><option value="20">20 dòng</option><option value="50">50 dòng</option><option value="100">100 dòng</option><option value="all">Tất cả</option></select></label><span>{filteredPlans.length ? `Đang hiển thị ${planPageStart + 1}–${Math.min(planPageStart + visiblePlans.length, filteredPlans.length)} / ${filteredPlans.length.toLocaleString("vi-VN")} dòng` : "Đang hiển thị 0–0 / 0 dòng"}</span><div><button type="button" disabled={safePlanPage <= 1} onClick={() => setPlanPage((page) => Math.max(1, page - 1))}>Trước</button><span>Trang {safePlanPage} / {planPageCount}</span><button type="button" disabled={safePlanPage >= planPageCount} onClick={() => setPlanPage((page) => Math.min(planPageCount, page + 1))}>Sau</button></div></div></section>
    {viewingPlan && <div className="workspace-record-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewingPlan(null); }}><section className="workspace-record-modal workspace-record-view-dialog" role="dialog" aria-modal="true" aria-labelledby="teaching-plan-view-title"><header className="workspace-form-head"><div><small>KẾ HOẠCH GIẢNG DẠY</small><h2 id="teaching-plan-view-title">{String(viewingPlan.data.title ?? "Kế hoạch")}</h2></div><button type="button" aria-label="Đóng thông tin kế hoạch" onClick={() => setViewingPlan(null)}><X size={18} /></button></header><dl className="workspace-record-details">{[["Năm học", viewingPlan.data.academicYear], ["Học kỳ", formatSemesterLabel(viewingPlan.data.semester, viewingPlan.data.academicYear)], ["Tuần", viewingPlan.data.week], ["Ngày thực hiện", viewingPlan.data.date ? formatDate(asDate(String(viewingPlan.data.date))) : ""], ["Môn học", viewingPlan.data.subject], ["Lớp học phần", viewingPlan.data.className], ["Trạng thái", viewingPlan.data.status], ["Ghi chú", viewingPlan.data.notes]].map(([label, value]) => <div key={String(label)}><dt>{String(label)}</dt><dd>{String(value ?? "").trim() || "—"}</dd></div>)}</dl><footer className="workspace-form-actions">{canUpdateSchedule && <button type="button" className="workspace-primary" onClick={() => { const plan = viewingPlan; setViewingPlan(null); editPlan(plan); }}>Chỉnh sửa</button>}<button type="button" onClick={() => setViewingPlan(null)}>Đóng</button></footer></section></div>}    <p className="teaching-schedule-note">Ngày nghỉ và tuần thi được tô màu theo lịch đính kèm. Đơn vị đào tạo có thể bố trí lịch thi riêng sau khi kết thúc thời gian học phần; lịch nghỉ theo kế hoạch có thể được cập nhật bằng thông báo chính thức.</p>
  </main>;
}
