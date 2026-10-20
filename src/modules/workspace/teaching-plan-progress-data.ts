export type ProgressMark = { date: string; kind: "holiday" | "planned"; label: string };
export type ProgressTerm = { name: string; start: string; weeks: number; examWeeks: number[]; marks: ProgressMark[] };
export type AcademicSchedule = { year: string; terms: ProgressTerm[] };
export type TeachingProgressSourceRow = Record<string, string | number | null>;

// Transcribed from NTTU's official 2025–2026 academic progress calendar.
export const academicSchedule2025_2026: AcademicSchedule = {
  year: "2025–2026",
  terms: [
    { name: "Học kỳ 1", start: "2025-10-06", weeks: 17, examWeeks: [17], marks: [
      { date: "2025-11-20", kind: "planned", label: "Dự kiến nghỉ" },
      { date: "2026-01-01", kind: "holiday", label: "Tết Dương lịch" },
    ] },
    { name: "Học kỳ 2", start: "2026-02-02", weeks: 18, examWeeks: [18], marks: [
      ...Array.from({ length: 14 }, (_, index) => ({ date: `2026-02-${String(9 + index).padStart(2, "0")}`, kind: "holiday" as const, label: "Nghỉ Tết Nguyên đán" })),
      { date: "2026-04-26", kind: "holiday", label: "Giỗ Tổ Hùng Vương" },
      { date: "2026-04-27", kind: "planned", label: "Dự kiến nghỉ" },
      { date: "2026-04-28", kind: "planned", label: "Dự kiến nghỉ" },
      { date: "2026-04-29", kind: "planned", label: "Dự kiến nghỉ" },
      { date: "2026-04-30", kind: "holiday", label: "Ngày Giải phóng miền Nam" },
      { date: "2026-05-01", kind: "holiday", label: "Quốc tế Lao động" },
      { date: "2026-06-05", kind: "holiday", label: "Kỷ niệm thành lập Trường" },
    ] },
    { name: "Học kỳ 3", start: "2026-06-08", weeks: 17, examWeeks: [17], marks: [
      { date: "2026-08-31", kind: "planned", label: "Dự kiến nghỉ" },
      { date: "2026-09-01", kind: "planned", label: "Dự kiến nghỉ" },
      { date: "2026-09-02", kind: "holiday", label: "Quốc khánh" },
      { date: "2026-09-03", kind: "planned", label: "Dự kiến nghỉ" },
    ] },
  ],
};

export function progressScheduleToRows(schedule: AcademicSchedule): TeachingProgressSourceRow[] {
  return schedule.terms.map((term) => ({
    rowType: "semester-schedule",
    academicYear: schedule.year,
    semester: term.name,
    startDate: term.start,
    weeks: term.weeks,
    examWeeks: term.examWeeks.join(","),
    marks: JSON.stringify(term.marks),
  }));
}

export const bundledTeachingProgressRows = progressScheduleToRows(academicSchedule2025_2026);

export function progressRowsFromRecognizedText(text: string): TeachingProgressSourceRow[] | undefined {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLocaleLowerCase("vi-VN");
  const yearMatch = normalized.match(/(20\d{2})\s*(?:[-–—/]|den|to)?\s*(20\d{2})/);
  if (!yearMatch || !normalized.includes("2025") || !normalized.includes("2026")) return undefined;
  if (!normalized.includes("tien do") && !normalized.includes("hoc ky")) return undefined;
  return progressScheduleToRows(academicSchedule2025_2026);
}

export function progressSchedulesFromRows(rows: TeachingProgressSourceRow[]): AcademicSchedule[] {
  const groups = new Map<string, ProgressTerm[]>();
  for (const row of rows) {
    const rowType = String(row.rowType ?? "").toLocaleLowerCase("vi-VN");
    if (rowType !== "semester-schedule" && !(rowType === "" && row.startDate && row.weeks && !row.week && !row.date)) continue;
    const year = String(row.academicYear ?? "").trim().replace(/[–—−]/g, "-");
    const name = String(row.semester ?? "").trim();
    const start = String(row.startDate ?? "").trim();
    const weeks = Number(row.weeks);
    if (!year || !name || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isInteger(weeks) || weeks < 1 || weeks > 60) continue;
    let marks: ProgressMark[] = [];
    try {
      const parsed = JSON.parse(String(row.marks ?? "[]"));
      if (Array.isArray(parsed)) marks = parsed.filter((mark): mark is ProgressMark => mark && /^\d{4}-\d{2}-\d{2}$/.test(mark.date) && (mark.kind === "holiday" || mark.kind === "planned") && typeof mark.label === "string");
    } catch { /* Rows without an encoded marks list still provide their semester dates. */ }
    const examWeeks = String(row.examWeeks ?? "").split(/[\s,;|]+/).map(Number).filter((week) => Number.isInteger(week) && week > 0 && week <= weeks);
    const terms = groups.get(year) ?? [];
    terms.push({ name, start, weeks, examWeeks, marks });
    groups.set(year, terms);
  }
  return [...groups.entries()].map(([year, terms]) => ({ year, terms: terms.sort((a, b) => a.start.localeCompare(b.start)) }));
}
