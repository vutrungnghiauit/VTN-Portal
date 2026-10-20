import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, MapPin } from "lucide-react";
import { semesterIdentity } from "../../lib/semester-groups";
import { workspaceService, type WorkspaceRecord } from "./workspace.service";
import { progressSchedulesFromRows, type TeachingProgressSourceRow } from "./teaching-plan-progress-data";
import { getTeachingPeriodCatalog } from "./teaching-plan-schedule-data";
import "./teaching-week-calendar.css";

const dayNames = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"];
const shiftNames = ["Sáng", "Chiều", "Tối"];
const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const localDate = (key: string) => {
  const [year, month, day] = key.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return undefined;
  const date = new Date(year, month - 1, day);
  return dayKey(date) === key.slice(0, 10) ? date : undefined;
};
const dateLabel = (date: Date) => date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
const dateNumber = (key: string) => {
  const [year, month, day] = key.slice(0, 10).split("-").map(Number);
  return Date.UTC(year, month - 1, day);
};

function mondayOf(date: Date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

function getTodayKey() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
}

function weekdayIndex(value: unknown) {
  const raw = String(value ?? "").trim();
  const normalized = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("vi-VN");
  if (/chu nhat|\bcn\b|sunday/.test(normalized)) return 6;
  const number = Number(normalized.match(/\d+/)?.[0]);
  if (!Number.isFinite(number)) return -1;
  if (number === 0 || number === 8) return 6;
  if (number === 1 || number === 2) return 0;
  if (number >= 3 && number <= 7) return number - 2;
  return -1;
}

function lessonWeeks(data: Record<string, unknown>) {
  const listedWeeks = [...new Set(String(data.weekNumbers ?? "").match(/\d+/g)?.map(Number).filter((week) => week > 0) ?? [])];
  if (listedWeeks.length) return listedWeeks;
  const pattern = String(data.weekPattern ?? "").trim();
  if (pattern && /[-xX✓]/.test(pattern)) {
    return [...new Set([...pattern].flatMap((mark, index) => mark === "-" || /\s/.test(mark) ? [] : [index + 1]))];
  }
  if (pattern && /^[01]{3,}$/.test(pattern)) {
    return [...new Set([...pattern].flatMap((mark, index) => mark === "1" ? [index + 1] : []))];
  }
  return [...new Set(String(data.weekNumbers ?? "").match(/\d+/g)?.map(Number).filter((week) => week > 0) ?? [])];
}

function semesterKey(name: unknown, academicYear: unknown) {
  const title = String(name ?? "").trim();
  const year = String(academicYear ?? "").trim().replace(/[–—−]/g, "-");
  if (!title) return "";
  return semesterIdentity(/\d{4}\s*[-–—]\s*\d{4}/.test(title) || !year ? title : `${title} ${year}`);
}

function lessonPeriods(data: Record<string, unknown>) {
  const pattern = String(data.lessonPattern ?? data.periods ?? "");
  const pair = pattern.match(/\d+/g)?.map(Number) ?? [];
  const start = Number(data.fromPeriod) || pair[0] || 0;
  const end = Number(data.toPeriod) || pair[1] || start;
  return { start, end };
}

function shiftIndex(period: number) {
  if (period >= 12) return 2;
  if (period >= 7) return 1;
  return 0;
}

function scheduleType(data: Record<string, unknown>) {
  const type = String(data.scheduleType ?? data.lessonType ?? data.type ?? data.notes ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("vi-VN");
  if (/tam ngung|huy lich/.test(type)) return "cancelled";
  if (/thi hoc|lich thi|exam/.test(type)) return "exam";
  if (/truc tuyen|online/.test(type)) return "online";
  if (/thuc hanh|thuc tap|lab/.test(type)) return "practice";
  return "theory";
}

export type SemesterDate = { identity: string; startDate: string; weeks: number };
export type LessonEvent = { id: string; record: WorkspaceRecord; type: string; shift: number; startPeriod: number; endPeriod: number };

function catalogSemesterDates(): SemesterDate[] {
  return getTeachingPeriodCatalog().flatMap(({ terms }) => terms.map((term) => ({
    identity: semesterKey(term.title, term.academicYear),
    startDate: term.startDate,
    weeks: term.weeks,
  })));
}

export function buildSemesterDateCatalog(semesterRows: WorkspaceRecord[], progressRows: WorkspaceRecord[]): SemesterDate[] {
  const periods = new Map<string, SemesterDate>(catalogSemesterDates().map((period) => [period.identity, period]));
  const addPeriod = (name: unknown, academicYear: unknown, startDate: unknown, weeks: unknown) => {
    const identity = semesterKey(name, academicYear);
    const start = String(startDate ?? "").slice(0, 10);
    const weekCount = Number(weeks);
    if (!identity || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isInteger(weekCount) || weekCount < 1 || weekCount > 60) return;
    periods.set(identity, { identity, startDate: start, weeks: weekCount });
  };
  for (const row of semesterRows) addPeriod(row.data.title, row.data.academicYear, row.data.startDate, row.data.weeks);
  const progressSchedules = progressSchedulesFromRows(progressRows.map((row) => row.data as TeachingProgressSourceRow));
  for (const schedule of progressSchedules) {
    for (const term of schedule.terms) addPeriod(term.name, schedule.year, term.start, term.weeks);
  }
  return [...periods.values()];
}

export function getTeachingEventsOnDate(records: WorkspaceRecord[], date: Date, semesterDates: SemesterDate[]): LessonEvent[] {
  const key = dayKey(date);
  const day = (date.getDay() + 6) % 7;
  const semesterStart = new Map(semesterDates.map((item) => [item.identity, item]));
  const result: LessonEvent[] = [];
  for (const record of records) {
    if (weekdayIndex(record.data.weekday) !== day) continue;
    const lessonStart = String(record.data.startDate ?? "").slice(0, 10);
    const lessonEnd = String(record.data.endDate ?? "").slice(0, 10);
    const termName = String(record.data.semesterName ?? record.data.semester ?? "");
    const period = semesterStart.get(semesterKey(termName, record.data.academicYear));
    const lessonPeriod = lessonPeriods(record.data);
    const weeks = lessonWeeks(record.data);
    const baseDate = localDate(period?.startDate ?? "") ?? localDate(lessonStart);
    if (lessonStart && key < lessonStart) continue;
    if (lessonEnd && key > lessonEnd) continue;
    if (baseDate) {
      const baseMonday = mondayOf(baseDate);
      const weekNo = Math.floor((dateNumber(key) - dateNumber(dayKey(baseMonday))) / (7 * 86_400_000)) + 1;
      if (weekNo < 1 || (period && weekNo > period.weeks)) continue;
      if (weeks.length && !weeks.includes(weekNo)) continue;
    }
    result.push({
      id: `${record.id}-${key}`,
      record,
      type: scheduleType(record.data),
      shift: shiftIndex(lessonPeriod.start),
      startPeriod: lessonPeriod.start,
      endPeriod: lessonPeriod.end,
    });
  }
  return result.sort((left, right) => left.startPeriod - right.startPeriod || String(left.record.data.title ?? "").localeCompare(String(right.record.data.title ?? ""), "vi"));
}

export default function TeachingWeekCalendar({ records }: { records: WorkspaceRecord[] }) {
  const todayKey = getTodayKey();
  const [weekDate, setWeekDate] = useState(() => {
    const saved = localStorage.getItem("vtn-teaching-week-date") ?? "";
    return localDate(saved) ? saved.slice(0, 10) : todayKey;
  });
  const [semesterDates, setSemesterDates] = useState<SemesterDate[]>(catalogSemesterDates);

  useEffect(() => {
    const syncDate = (event: Event) => {
      const value = (event as CustomEvent<string>).detail;
      if (localDate(value)) setWeekDate(value.slice(0, 10));
    };
    const syncStorage = (event: StorageEvent) => {
      if (event.key === "vtn-teaching-week-date" && localDate(event.newValue ?? "")) setWeekDate((event.newValue ?? "").slice(0, 10));
    };
    window.addEventListener("vtn-teaching-week-date-changed", syncDate);
    window.addEventListener("storage", syncStorage);
    return () => {
      window.removeEventListener("vtn-teaching-week-date-changed", syncDate);
      window.removeEventListener("storage", syncStorage);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([workspaceService.list("semesters"), workspaceService.list("teaching-plan-schedules")]).then(([semesterRows, progressRows]) => {
      if (!active) return;
      setSemesterDates(buildSemesterDateCatalog(semesterRows, progressRows));
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const monday = mondayOf(localDate(weekDate) ?? localDate(todayKey) ?? new Date());
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return date;
  });
  const endOfWeek = days[6];
  const events = useMemo(() => {
    const dates = new Map<string, LessonEvent[]>();
    for (const date of days) dates.set(dayKey(date), getTeachingEventsOnDate(records, date, semesterDates));
    return dates;
  }, [records, days, semesterDates]);
  const weekEventCount = [...events.values()].reduce((count, dayEvents) => count + dayEvents.length, 0);

  function moveWeek(offset: number) {
    const next = new Date(monday);
    next.setDate(next.getDate() + offset * 7);
    chooseWeek(dayKey(next));
  }

  function chooseWeek(value: string) {
    const date = localDate(value);
    if (!date) return;
    const key = dayKey(date);
    setWeekDate(key);
    localStorage.setItem("vtn-teaching-week-date", key);
    window.dispatchEvent(new CustomEvent("vtn-teaching-week-date-changed", { detail: key }));
  }

  function goToCurrentWeek() { chooseWeek(todayKey); }

  return <section className="teaching-week-view" aria-label="Lịch học theo tuần">
    <header className="teaching-week-toolbar">
      <h2><CalendarDays size={21} />Tuần {dateLabel(monday)} - {dateLabel(endOfWeek)}</h2>
      <div className="teaching-week-controls">
        <label className="teaching-week-date"><span className="sr-only">Chọn ngày trong tuần</span><input type="date" value={weekDate} onChange={(event) => chooseWeek(event.target.value || todayKey)} /><CalendarDays size={16} /></label>
        <button type="button" className="teaching-week-current" onClick={goToCurrentWeek}><CalendarDays size={15} />Hiện tại</button>
        <button type="button" onClick={() => moveWeek(-1)}><ChevronLeft size={16} />Trở về</button>
        <button type="button" onClick={() => moveWeek(1)}>Tiếp<ChevronRight size={16} /></button>
      </div>
    </header>
    <div className="teaching-week-scroll"><table className="teaching-week-grid"><thead><tr><th>Ca học</th>{days.map((date, index) => <th className={dayKey(date) === todayKey ? "today" : ""} key={dayKey(date)}>{dayNames[index]}<span>{dateLabel(date)}</span></th>)}</tr></thead><tbody>{shiftNames.map((shift, shiftIndex) => <tr key={shift}><th>{shift}</th>{days.map((date) => {
      const key = dayKey(date);
      const dayEvents = (events.get(key) ?? []).filter((event) => event.shift === shiftIndex);
      return <td className={key === todayKey ? "today" : ""} key={key}><div className="teaching-week-cell-events">{dayEvents.map((event) => {
        const data = event.record.data;
        const courseName = String(data.title ?? data.subjectName ?? data.courseName ?? "Môn học");
        const courseCode = String(data.courseCode ?? "").trim();
        const className = String(data.className ?? data.classCode ?? "").trim();
        const room = String(data.room ?? "").trim();
        const scheduleTypeLabel = String(data.scheduleType ?? "").trim();
        return <article className={`teaching-week-event ${event.type}`} key={event.id} title={`${courseName} · ${courseCode} · ${className}`}>
          <strong>{courseName}{scheduleTypeLabel && <span> ({scheduleTypeLabel})</span>}</strong>
          <small>{[courseCode, className].filter(Boolean).join(" - ") || "Chưa có mã học phần / lớp"}</small>
          <span><Clock3 size={13} />Tiết {event.startPeriod || "—"}{event.endPeriod && event.endPeriod !== event.startPeriod ? ` - ${event.endPeriod}` : ""}</span>
          <span><MapPin size={13} />Phòng: {room || "Chưa cập nhật"}</span>
          {data.lecturer && <small>GV: {String(data.lecturer)}</small>}
        </article>;
      })}</div></td>;
    })}</tr>)}</tbody></table></div>
    <footer className="teaching-week-legend"><span><i className="theory" />Lịch dạy lý thuyết</span><span><i className="practice" />Lịch dạy thực hành</span><span><i className="online" />Lịch trực tuyến</span><span><i className="exam" />Lịch coi thi</span><span><i className="cancelled" />Lịch tạm ngưng</span></footer>
    {!weekEventCount && <p className="teaching-week-empty">{records.length ? "Không có lịch học phù hợp trong tuần này." : "Chưa có dữ liệu lịch học phù hợp với bộ lọc."}</p>}
  </section>;
}
