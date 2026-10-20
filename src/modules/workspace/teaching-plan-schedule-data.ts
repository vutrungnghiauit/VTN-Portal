import { academicSchedule2025_2026, type AcademicSchedule } from "./teaching-plan-progress-data";

// Lightweight schedule data is shared by the header, filters, and the teaching plan page.
export const schedules: AcademicSchedule[] = [
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

const asDate = (iso: string) => new Date(`${iso}T00:00:00`);
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function activeTeachingPeriod(items: AcademicSchedule[], today: string) {
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

export function estimatedSchedule(year: number): AcademicSchedule {
  const nextYear = year + 1;
  return { year: `${year}–${nextYear}`, terms: [
    { name: "Học kỳ 1", start: firstMonday(year, 9), weeks: 17, examWeeks: [], marks: [] },
    { name: "Học kỳ 2", start: firstMonday(nextYear, 1), weeks: 18, examWeeks: [], marks: [] },
    { name: "Học kỳ 3", start: firstMonday(nextYear, 5), weeks: 17, examWeeks: [], marks: [] },
  ] };
}
