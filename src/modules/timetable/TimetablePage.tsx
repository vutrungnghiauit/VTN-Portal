import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarDays, ChevronDown, Database, Download, Edit3, Eye, FileUp, Plus, RefreshCw, Trash2 } from "lucide-react";
import { workspaceService, type WorkspaceRecord } from "../workspace/workspace.service";
import { settingsService } from "../settings/settings.service";
import { normalizeLecturer } from "../../lib/lecturer-format";
import { academicPeriodMatchesYear, academicYearFromSemester, formatSemesterLabel, groupAcademicPeriods, normalizeAcademicYear, normalizeSemesterName, semesterLabelIdentity, semesterMatchesSelection, uniqueAcademicYears } from "../../lib/semester-groups";
import SpreadsheetTransferPanel, { type SpreadsheetValue } from "../workspace/SpreadsheetTransferPanel";
import QuickFilterHeading from "../workspace/QuickFilterHeading";
import SearchableFilter from "../../components/SearchableFilter";
import TeachingWeekCalendar from "../workspace/TeachingWeekCalendar";
import type { ModuleField } from "../workspace/module-definitions";
import { extractTimetablePdf } from "./timetable-pdf";
import { sourceDataService, sourceValues, type StoredSourceRow } from "../source-data/source-data.service";
import seedRows from "./semester-schedules.json";
import { buildTimetableRows, toTimetableWeekRecords, type TimetableEntry } from "./timetable-week-data";
import { SortableTableHeader } from "../../components/SortableTableHeader";
import { sortTableRows } from "../../lib/table-sort";
import "./timetable.css";

type RelatedSpec = { key: string; externalId: string; values: Record<string, string | number | null>; match: (record: WorkspaceRecord) => boolean };
const weekdays: Record<string, string> = { "2": "Thứ 2", "3": "Thứ 3", "4": "Thứ 4", "5": "Thứ 5", "6": "Thứ 6", "7": "Thứ 7", "8": "Chủ nhật" };
const notifyTimetableChanged = () => window.dispatchEvent(new Event("vtn-timetable-list-updated"));
const terms = [...new Map(seedRows.map((row) => [normalizeSemesterName(row.semesterName), { name: normalizeSemesterName(row.semesterName), year: row.academicYear, number: row.semesterNumber }])).values()]
  .sort((a, b) => a.year.localeCompare(b.year) || a.number - b.number);
const selectedInitial = () => {
  const stored = localStorage.getItem("vtn-active-semester");
  if (stored === "all") return stored;
  if (stored) return normalizeSemesterName(stored);
  return terms[terms.length - 1]?.name ?? "all";
};
const timetableFields: ModuleField[] = [
  { key: "academicYear", label: "Niên khóa" }, { key: "semesterName", label: "Học kỳ", required: true }, { key: "courseCode", label: "Mã LHP", required: true },
  { key: "subjectName", label: "Tên môn học", required: true }, { key: "credits", label: "Số TC", kind: "number" }, { key: "classCode", label: "Lớp dự kiến", required: true },
  { key: "mergedClassCode", label: "Mã lớp ghép" }, { key: "weekday", label: "Thứ" }, { key: "periods", label: "Tiết" }, { key: "scheduleType", label: "Loại lịch" },
  { key: "periodCount", label: "Số tiết", kind: "number" }, { key: "classSize", label: "Sĩ số", kind: "number" },
  { key: "startDate", label: "Ngày bắt đầu", kind: "date" }, { key: "endDate", label: "Ngày kết thúc", kind: "date" }, { key: "weekNumbers", label: "Tuần học" },
  { key: "totalPeriods", label: "Tổng số tiết", kind: "number" }, { key: "room", label: "Phòng" }, { key: "lecturer", label: "Giảng viên" }, { key: "notes", label: "Ghi chú" },
];

function dateLabel(iso: string) {
  const [year, month, day] = iso.split("-");
  return year && month && day ? `${day}/${month}/${year}` : "—";
}

async function saveRelated(moduleKey: string, existing: WorkspaceRecord[], specs: RelatedSpec[]) {
  const result = new Map<string, WorkspaceRecord>();
  const pending: RelatedSpec[] = [];
  for (const spec of specs) {
    const found = existing.find((record) => record.external_id === spec.externalId || spec.match(record));
    if (found) result.set(spec.key, await workspaceService.save(moduleKey, spec.values, found.id, spec.externalId));
    else pending.push(spec);
  }
  const inserted = await workspaceService.saveMany(moduleKey, pending.map(({ values, externalId }) => ({ values, externalId })));
  const byExternalId = new Map(inserted.map((record) => [record.external_id, record]));
  for (const spec of pending) {
    const record = byExternalId.get(spec.externalId);
    if (record) result.set(spec.key, record);
  }
  return result;
}

async function syncPeriodCatalog(yearSourceRows: StoredSourceRow[], semesterSourceRows: StoredSourceRow[]) {
  const years = new Map<string, StoredSourceRow>();
  for (const row of yearSourceRows) {
    const data = sourceValues(row); const title = String(data.title ?? data.academicYear ?? "").trim();
    if (title) years.set(title, row);
  }
  const semesters = new Map<string, StoredSourceRow>();
  for (const row of semesterSourceRows) {
    const data = sourceValues(row); const title = String(data.title ?? data.semesterName ?? "").trim();
    const academicYear = String(data.academicYear ?? "").trim();
    if (title && academicYear) semesters.set(`${title}|${academicYear}`, row);
  }
  if (!years.size || !semesters.size) throw new Error("Dữ liệu nguồn Năm học và Học kỳ - năm học chưa có dòng hợp lệ.");
  const [yearExisting, semesterExisting] = await Promise.all([workspaceService.list("academic-years"), workspaceService.list("semesters")]);
  const yearSpecs: RelatedSpec[] = [...years].map(([title, record]) => {
    const data = sourceValues(record);
    return {
      key: title, externalId: `source-data:academic-year:${encodeURIComponent(title)}`,
      values: {
        title, startDate: String(data.startDate ?? ""), endDate: String(data.endDate ?? ""),
        status: String(data.status ?? "Đã đồng bộ từ Dữ liệu nguồn"),
        notes: String(data.notes ?? `Nguồn: ${String(record.data._sourceFile ?? "Dữ liệu nguồn")}`),
      },
      match: (item) => item.data.title === title,
    };
  });
  const semesterSpecs: RelatedSpec[] = [...semesters].map(([identity, record]) => {
    const data = sourceValues(record); const [title, academicYear] = identity.split("|");
    return {
      key: identity, externalId: `source-data:semester:${encodeURIComponent(identity)}`,
      values: {
        title, academicYear, startDate: String(data.startDate ?? ""), endDate: String(data.endDate ?? ""),
        weeks: Number(data.weeks ?? 0), current: String(data.current ?? "Không"),
        notes: String(data.notes ?? `Nguồn: ${String(record.data._sourceFile ?? "Dữ liệu nguồn")}`),
      },
      match: (item) => item.data.title === title && item.data.academicYear === academicYear,
    };
  });
  await saveRelated("academic-years", yearExisting, yearSpecs);
  await saveRelated("semesters", semesterExisting, semesterSpecs);
  window.dispatchEvent(new CustomEvent("vtn-semester-list-updated"));
  return { years: yearSpecs.length, semesters: semesterSpecs.length };
}

export default function TimetablePage({ canCreate, canUpdate, canDelete, canImport, canExport = true, canSyncPeriods = false, canViewList = true, canViewWeek = true }: { canCreate: boolean; canUpdate: boolean; canDelete: boolean; canImport: boolean; canExport?: boolean; canSyncPeriods?: boolean; canViewList?: boolean; canViewWeek?: boolean }) {
  const [storedRows, setStoredRows] = useState<WorkspaceRecord[]>([]);
  const [semester, setSemester] = useState(selectedInitial);
  const [academicYearFilter, setAcademicYearFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [expectedClassFilter, setExpectedClassFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<TimetableEntry | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [detailEntry, setDetailEntry] = useState<TimetableEntry | null>(null);
  const [view, setView] = useState<"list" | "week">("list");
  const [tablePageSize, setTablePageSize] = useState<"10" | "20" | "50" | "100" | "all">("10");
  const [tablePage, setTablePage] = useState(1);
  const [tableSort, setTableSort] = useState({ key: "ordinal", direction: "asc" as "asc" | "desc" });
  const [selectedTimetableIds, setSelectedTimetableIds] = useState<Set<string>>(() => new Set());
  const activeView = canViewList ? view === "week" && canViewWeek ? "week" : "list" : canViewWeek ? "week" : "none";

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setStoredRows((await workspaceService.allRecords()).filter((record) => record.module_key === "timetables")); setSelectedTimetableIds(new Set()); setTablePage(1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được thời khóa biểu đã nhập."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const update = (event: Event) => { const value = (event as CustomEvent<string>).detail || "all"; setSemester(value === "all" ? value : normalizeSemesterName(value)); setTablePage(1); setSelectedTimetableIds(new Set()); };
    window.addEventListener("vtn-semester-filter-changed", update);
    return () => window.removeEventListener("vtn-semester-filter-changed", update);
  }, []);

  const allRows = useMemo(() => buildTimetableRows(storedRows), [storedRows]);
  const academicPeriods = useMemo(() => [...terms.map((term) => ({ academicYear: term.year, semesterName: term.name })), ...allRows.map((row) => ({ academicYear: row.academicYear, semesterName: row.semesterName }))], [allRows]);
  const semesterGroups = groupAcademicPeriods(academicPeriods);
  const visibleSemesterGroups = academicYearFilter === "all" ? semesterGroups : semesterGroups.filter((group) => normalizeAcademicYear(group.academicYear) === normalizeAcademicYear(academicYearFilter));
  const academicYearOptions = uniqueAcademicYears(academicPeriods.map((period) => period.academicYear));
  const rows = useMemo(() => {
    const needle = search.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    return allRows.filter((row) => (academicYearFilter === "all" || academicPeriodMatchesYear(row.semesterName, row.academicYear, academicYearFilter, academicPeriods)) && (semester === "all" || semesterMatchesSelection(row.semesterName, row.academicYear, semester)) && (!subjectFilter || row.subjectName === subjectFilter) && (!expectedClassFilter || row.classCode === expectedClassFilter) && (!needle || JSON.stringify(row).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(needle)));
  }, [allRows, semester, academicYearFilter, academicPeriods, search, subjectFilter, expectedClassFilter]);
  const sortedRows = useMemo(() => sortTableRows(rows, tableSort, (row, key, index) => {
    if (key === "ordinal") return index;
    if (key === "__semester") return row.semesterNumber;
    if (key === "__time") return `${row.startDate} ${row.endDate}`;
    if (key.startsWith("week:")) return row.weekNumbers.includes(Number(key.slice(5)));
    return (row as unknown as Record<string, unknown>)[key];
  }), [rows, tableSort]);
  function sortTimetableBy(key: string) {
    setTableSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" });
    setTablePage(1);
  }
  const tablePageCount = tablePageSize === "all" ? 1 : Math.max(1, Math.ceil(rows.length / Number(tablePageSize)));
  const safeTablePage = Math.min(tablePage, tablePageCount);
  const tablePageStart = tablePageSize === "all" ? 0 : (safeTablePage - 1) * Number(tablePageSize);
  const visibleTableRows = tablePageSize === "all" ? sortedRows : sortedRows.slice(tablePageStart, tablePageStart + Number(tablePageSize));
  const selectedVisibleTimetableCount = rows.reduce((count, row) => count + Number(selectedTimetableIds.has(row.id)), 0);
  const allVisibleTimetablesSelected = rows.length > 0 && selectedVisibleTimetableCount === rows.length;
  const weekViewRecords = useMemo(() => toTimetableWeekRecords(rows), [rows]);
  const periodFilteredRows = allRows.filter((row) => (academicYearFilter === "all" || academicPeriodMatchesYear(row.semesterName, row.academicYear, academicYearFilter, academicPeriods)) && (semester === "all" || semesterMatchesSelection(row.semesterName, row.academicYear, semester)));
  const subjectOptions = [...new Set(periodFilteredRows.filter((row) => !expectedClassFilter || row.classCode === expectedClassFilter).map((row) => row.subjectName.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi", { numeric: true, sensitivity: "base" }));
  const expectedClassOptions = [...new Set(periodFilteredRows.filter((row) => !subjectFilter || row.subjectName === subjectFilter).map((row) => row.classCode.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi", { numeric: true, sensitivity: "base" }));

  const classCount = new Set(rows.map((row) => `${row.semesterName}|${row.classCode}|${row.courseCode}`)).size;
  const courseCount = new Set(rows.map((row) => row.courseCode)).size;
  const studentCount = new Map<string, number>();
  rows.forEach((row) => { const key = `${row.semesterName}|${row.classCode}|${row.courseCode}`; studentCount.set(key, Math.max(studentCount.get(key) ?? 0, row.classSize)); });
  const totalStudents = [...studentCount.values()].reduce((sum, value) => sum + value, 0);
  const weekColumns = Array.from({ length: Math.max(16, ...rows.map((row) => Math.max(...row.weekNumbers, 0))) }, (_, index) => index + 1);
  const tableColumnCount = 19 + weekColumns.length;

  function chooseAcademicYear(value: string) {
    const validTerms = value === "all" ? [] : semesterGroups.find((group) => normalizeAcademicYear(group.academicYear) === normalizeAcademicYear(value))?.semesters ?? [];
    const selectedSemesterYear = academicYearFromSemester(semester);
    const nextSemester = semester !== "all" && value !== "all" && (!validTerms.some((term) => semesterLabelIdentity(term) === semesterLabelIdentity(semester)) || (selectedSemesterYear && normalizeAcademicYear(selectedSemesterYear) !== normalizeAcademicYear(value))) ? "all" : semester;
    const nextRows = allRows.filter((row) => (value === "all" || academicPeriodMatchesYear(row.semesterName, row.academicYear, value, academicPeriods)) && (nextSemester === "all" || semesterMatchesSelection(row.semesterName, row.academicYear, nextSemester)));
    setAcademicYearFilter(value);
    if (nextSemester !== semester) {
      setSemester("all"); localStorage.setItem("vtn-active-semester", "all"); window.dispatchEvent(new CustomEvent("vtn-semester-filter-changed", { detail: "all" }));
    }
    if (subjectFilter && !nextRows.some((row) => row.subjectName === subjectFilter)) setSubjectFilter("");
    if (expectedClassFilter && !nextRows.some((row) => row.classCode === expectedClassFilter)) setExpectedClassFilter("");
    setTablePage(1); setSelectedTimetableIds(new Set());
  }

  async function importSchedules(importAll: boolean) {
    if (!canImport) return;
    const batch = seedRows.filter((row) => importAll || semester === "all" || row.semesterName === semester);
    if (!batch.length) { setError("Không có dữ liệu thời khóa biểu trong học kỳ đã chọn."); return; }
    setImporting(true); setError(""); setNotice("");
    try {
      const moduleKeys = ["academic-years", "semesters"];
      const existingLists = await Promise.all(moduleKeys.map((key) => workspaceService.list(key)));
      const [yearExisting, semesterExisting] = existingLists;
      const grouped = <T,>(items: T[], keyOf: (item: T) => string) => {
        const result = new Map<string, T[]>();
        for (const item of items) { const key = keyOf(item); result.set(key, [...(result.get(key) ?? []), item]); }
        return result;
      };
      const byYear = grouped(batch, (row) => row.academicYear);
      const byTerm = grouped(batch, (row) => row.semesterName);
      const dateBounds = (items: TimetableEntry[]) => ({ startDate: items.map((item) => item.startDate).filter(Boolean).sort()[0] ?? "", endDate: [...items.map((item) => item.endDate).filter(Boolean)].sort().at(-1) ?? "" });
      const yearSpecs: RelatedSpec[] = [...byYear].map(([year, items]) => {
        const bounds = dateBounds(items); const key = year; const externalId = `timetable-year:${year}`;
        return { key, externalId, values: { title: year, ...bounds, status: "Đã nhập từ thời khóa biểu", notes: `Dữ liệu nguồn: ${[...new Set(items.map((item) => item.sourceFile))].join(", ")}` }, match: (record) => record.data.title === year };
      });
      const yearRecords = await saveRelated("academic-years", yearExisting, yearSpecs);
      const currentSettings = await settingsService.get();
      const termSpecs: RelatedSpec[] = [...byTerm].map(([name, items]) => {
        const bounds = dateBounds(items); const weeks = Math.max(0, ...items.flatMap((item) => item.weekNumbers)); const key = name; const externalId = `timetable-semester:${name}`;
        return { key, externalId, values: { title: name, academicYear: items[0].academicYear, ...bounds, weeks, current: currentSettings.current_semester === name ? "Có" : "Không", notes: `Nhập từ tệp thời khóa biểu; tuần tối đa T${weeks}.` }, match: (record) => record.data.title === name };
      });
      const termRecords = await saveRelated("semesters", semesterExisting, termSpecs);
      const timetableRows = batch.map((row) => {
        const data: Record<string, string | number | null> = { ...row, weekNumbers: row.weekNumbers.join(","), sourceId: row.id, semesterId: termRecords.get(row.semesterName)?.id ?? "", academicYearId: yearRecords.get(row.academicYear)?.id ?? "" };
        return { values: data, externalId: row.id };
      });
      await workspaceService.saveMany("timetables", timetableRows);
      setNotice("\u0110\u00e3 \u0111\u1ed3ng b\u1ed9 th\u1eddi kh\u00f3a bi\u1ec3u v\u1edbi danh m\u1ee5c h\u1ecdc k\u1ef3 v\u00e0 n\u0103m h\u1ecdc.");
      await load();
      notifyTimetableChanged();
      window.dispatchEvent(new CustomEvent("vtn-semester-list-updated"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể nhập và liên kết dữ liệu thời khóa biểu."); }
    finally { setImporting(false); }
  }

  async function saveImportedSchedules(imported: Array<Record<string, SpreadsheetValue>>) {
    if (!canImport) throw new Error("Bạn chưa được cấp quyền nhập thời khóa biểu.");
    const valid = imported.filter((item) => item.courseCode && item.subjectName && item.classCode && item.semesterName);
    if (!valid.length) throw new Error("Cần có Mã LHP, Tên môn học, Lớp dự kiến và Học kỳ.");
    const existing = storedRows;
    const pending: Array<{ values: Record<string, string | number | null>; externalId: string }> = [];
    const seen = new Set<string>(); let processed = 0;
    for (const item of valid) {
      const semesterName = String(item.semesterName); const match = semesterName.match(/(?:HK|Học kỳ)\s*(\d+)/i);
      const weekNumbers = String(item.weekNumbers ?? "").split(/[;,\s]+/).map(Number).filter((week) => week > 0);
      const row = {
        id: "", sourceFile: "Import bảng tính", academicYear: String(item.academicYear ?? semesterName.match(/\d{4}-\d{4}/)?.[0] ?? ""),
        semesterNumber: Number(item.semesterNumber ?? match?.[1] ?? 0), semesterName, courseCode: String(item.courseCode), subjectName: String(item.subjectName),
        credits: Number(item.credits ?? 0), classCode: String(item.classCode), mergedClassCode: String(item.mergedClassCode ?? ""), sourceSemesterCode: "", sourceWeekdayCode: "",
        weekday: String(item.weekday ?? "").match(/\d+/)?.[0] ?? String(item.weekday ?? ""), periods: String(item.periods ?? ""), scheduleType: String(item.scheduleType ?? ""),
        periodCount: Number(item.periodCount ?? 0), group: String(item.group ?? ""), classSize: Number(item.classSize ?? 0), startDate: String(item.startDate ?? ""), endDate: String(item.endDate ?? ""),
        weekNumbers, totalPeriods: Number(item.totalPeriods ?? 0), room: String(item.room ?? ""), lecturer: normalizeLecturer(item.lecturer), notes: String(item.notes ?? ""),
      } as TimetableEntry;
      const naturalKey = `${row.semesterName}|${row.courseCode}|${row.classCode}|${row.weekday}|${row.periods}`;
      if (seen.has(naturalKey)) continue; seen.add(naturalKey); processed += 1;
      const seedMatch = seedRows.find((seed) => seed.semesterName === row.semesterName && seed.courseCode === row.courseCode && seed.classCode === row.classCode && seed.weekday === row.weekday && seed.periods === row.periods);
      const externalId = seedMatch?.id ?? `spreadsheet-timetable:${encodeURIComponent(naturalKey)}`;
      const found = existing.find((record) => record.external_id === externalId || (String(record.data.semesterName ?? "") === row.semesterName && String(record.data.courseCode ?? "") === row.courseCode && String(record.data.classCode ?? "") === row.classCode && String(record.data.weekday ?? "") === row.weekday && String(record.data.periods ?? "") === row.periods));
      const values: Record<string, string | number | null> = { ...row, id: externalId, sourceId: externalId, weekNumbers: weekNumbers.join(",") };
      if (found) { if (found.deleted_at) await workspaceService.restore(found.id); await workspaceService.save("timetables", values, found.id, externalId); }
      else pending.push({ values, externalId });
    }
    await workspaceService.saveMany("timetables", pending); setNotice(`Đã nhập/cập nhật ${processed} dòng thời khóa biểu.`); await load(); notifyTimetableChanged();
  }

  async function saveTimetableForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (editing ? !canUpdate : !canCreate) return;
    const form = new FormData(event.currentTarget); const values: Record<string, string | number | null> = {};
    for (const field of timetableFields) { const value = String(form.get(field.key) ?? "").trim(); if (!value) continue; values[field.key] = field.kind === "number" ? Number(value) : value; }
    if (!values.courseCode || !values.subjectName || !values.classCode || !values.semesterName) { setError("Mã LHP, môn học, lớp và học kỳ là bắt buộc."); return; }
    const rawWeeks = String(values.weekNumbers ?? "").split(/[;,\s]+/).map(Number).filter((week) => week > 0);
    const semesterName = String(values.semesterName); const termNumber = Number(semesterName.match(/(?:HK|Học kỳ)\s*(\d+)/i)?.[1] ?? 0);
    const id = editing?.id || `manual-timetable:${encodeURIComponent(`${semesterName}|${values.courseCode}|${values.classCode}|${values.weekday ?? ""}|${values.periods ?? ""}`)}`;
    const stored = { ...values, semesterNumber: termNumber, id, sourceId: id, weekNumbers: rawWeeks.join(",") };
    try { const found = storedRows.find((record) => !record.deleted_at && (record.external_id === id || String(record.data.sourceId ?? "") === editing?.id)); await workspaceService.save("timetables", stored, found?.id, id); setShowForm(false); setEditing(null); setNotice(editing ? "Đã cập nhật dòng thời khóa biểu." : "Đã thêm dòng thời khóa biểu."); await load(); notifyTimetableChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không lưu được dòng thời khóa biểu."); }
  }

  async function importSourceTimetable() {
    if (!canImport) return;
    setImporting(true); setError(""); setNotice("");
    try {
      const sourceRows = await sourceDataService.list("timetables");
      if (!sourceRows.length) throw new Error("Chưa có dữ liệu trong mục Thời khóa biểu học kỳ của Dữ liệu nguồn.");
      await saveImportedSchedules(sourceRows.map(sourceValues));
      setNotice("Đã lấy " + sourceRows.length + " dòng từ dữ liệu nguồn Thời khóa biểu học kỳ.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không lấy được dữ liệu thời khóa biểu từ nguồn."); }
    finally { setImporting(false); }
  }

  async function syncAllPeriods() {
    if (!canSyncPeriods) return;
    setImporting(true); setError(""); setNotice("");
    try {
      const [yearSources, semesterSources] = await Promise.all([sourceDataService.list("academic-years"), sourceDataService.list("semesters")]);
      if (!yearSources.length || !semesterSources.length) throw new Error("Để đồng bộ, hãy nhập dữ liệu nguồn ở cả mục Năm học và Học kỳ - năm học.");
      const synced = await syncPeriodCatalog(yearSources, semesterSources);
      setNotice(`Đã đồng bộ ${synced.semesters} học kỳ và ${synced.years} năm học từ Dữ liệu nguồn.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể đồng bộ học kỳ và năm học từ dữ liệu nguồn."); }
    finally { setImporting(false); }
  }

  async function deleteTimetable(row: TimetableEntry) {
    if (!canDelete || !window.confirm(`Chuyển lịch ${row.courseCode} · ${row.classCode} vào thùng rác?`)) return;
    try {
      let record = storedRows.find((item) => !item.deleted_at && (item.external_id === row.id || String(item.data.sourceId ?? "") === row.id));
      if (!record) record = await workspaceService.save("timetables", { ...row, weekNumbers: row.weekNumbers.join(","), sourceId: row.id }, undefined, row.id);
      await workspaceService.moveToTrash(record.id); setSelectedTimetableIds((previous) => { const next = new Set(previous); next.delete(row.id); return next; }); setTablePage(1); setNotice("Đã chuyển lịch học vào thùng rác."); await load(); notifyTimetableChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể chuyển lịch vào thùng rác."); }
  }

  const title = semester === "all" ? "Tất cả học kỳ" : semester;
  function exportTimetablePdf() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) { setError("Trình duyệt đã chặn cửa sổ xuất PDF. Hãy cho phép cửa sổ bật lên rồi thử lại."); return; }
    const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);
    const cellValue = (row: TimetableEntry, key: string) => {
      if (key === "weekday") return weekdays[row.weekday] ?? `Thứ ${row.weekday}`;
      if (key === "weekNumbers") return row.weekNumbers.join(", ");
      if (key === "startDate" || key === "endDate") return row[key] ? dateLabel(row[key]) : "";
      return (row as unknown as Record<string, unknown>)[key] ?? "";
    };
    const headers = ["<th>STT</th>", ...timetableFields.map((field) => `<th>${escapeHtml(field.label)}</th>`)].join("");
    const body = rows.map((row, index) => `<tr><td>${index + 1}</td>${timetableFields.map((field) => `<td>${escapeHtml(cellValue(row, field.key))}</td>`).join("")}</tr>`).join("");
    printWindow.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Thời khóa biểu học kỳ</title><style>@page{size:A3 landscape;margin:8mm}body{font:7px Arial,sans-serif;color:#172554}h1{font-size:16px;margin:0 0 4px}p{margin:0 0 9px;color:#475569}table{border-collapse:collapse;width:100%;table-layout:auto}thead{display:table-header-group}tr{break-inside:avoid}th,td{border:1px solid #cbd5e1;padding:3px 4px;text-align:left;white-space:nowrap}th{background:#edf3ff;font-size:7px}td{max-width:100px;overflow:hidden;text-overflow:clip}tr:nth-child(even){background:#f8fafc}</style></head><body><h1>Thời khóa biểu học kỳ</h1><p>${escapeHtml(title)} · ${rows.length} dòng lịch học</p><table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table></body></html>`);
    printWindow.document.close(); printWindow.focus(); window.setTimeout(() => printWindow.print(), 250);
  }
  return <main className="workspace-page timetable-page">
    <header className="workspace-title-row"><div><p className="workspace-eyebrow">ĐÀO TẠO</p><h1>Thời khóa biểu học kỳ</h1><p>Lịch học theo lớp, học phần, ngày, tiết, phòng và tuần học; dữ liệu được liên kết với danh mục học kỳ, môn học và lớp học phần.</p></div><div className="workspace-title-actions"><button type="button" disabled={!canImport || importing || loading} onClick={() => void importSourceTimetable()}><Database size={17} />{importing ? "Đang lấy dữ liệu..." : "Lấy dữ liệu nguồn"}</button></div></header>
    {error && <div className="workspace-alert" role="alert">{error}</div>}{notice && <div className="workspace-notice" role="status">{notice}</div>}
    <SpreadsheetTransferPanel title="Thời khóa biểu học kỳ" description="Nhập và xuất thời khóa biểu bằng Excel, CSV hoặc PDF." fields={timetableFields} exportFields={[{ key: "systemOrdinal", label: "STT", kind: "number" }, ...timetableFields]} rows={rows.map((row, index) => ({ ...row, systemOrdinal: index + 1 })) as unknown as Array<Record<string, unknown>>} canImport={canImport} canExport={canExport} onImport={saveImportedSchedules} onPdfImport={extractTimetablePdf} onArchiveFiles={async (files) => { for (const item of files) await sourceDataService.archiveImportedFile(item.file, "timetables", item.rows); }} customActionsOnly fiveColumnActions extraActions={(context) => <>
      <button className="workspace-primary" type="button" disabled={!canCreate || context.busy || importing} onClick={() => { setEditing(null); setShowForm(true); setError(""); }}><Plus size={15} /> Thêm lịch học</button>
      <button type="button" disabled={!canImport || context.busy || importing || loading} onClick={context.openFilePicker}><FileUp size={15} /> Nhập</button><details className="spreadsheet-transfer-menu"><summary aria-label="Thêm tùy chọn nhập"><ChevronDown size={15} /></summary><div role="menu"><button type="button" disabled={!canImport || context.busy || importing || loading || !seedRows.length} onClick={() => void importSchedules(true)}>Nhập tất cả học kỳ</button>{semester !== "all" && <button type="button" disabled={!canImport || context.busy || importing || loading || !seedRows.length} onClick={() => void importSchedules(false)}>Nhập học kỳ này</button>}<button type="button" disabled={!canImport || context.busy || importing || loading} onClick={context.togglePaste}>Dán dữ liệu từ bảng tính</button></div></details>
      <details className="spreadsheet-transfer-menu spreadsheet-transfer-export-menu"><summary><Download size={15} /> Xuất <ChevronDown size={15} /></summary><div role="menu"><button type="button" disabled={!canExport || !rows.length} onClick={() => context.exportFile("xls")}>Xuất Excel (.xls)</button><button type="button" disabled={!canExport || !rows.length} onClick={() => context.exportFile("csv")}>Xuất CSV (.csv)</button><button type="button" disabled={!canExport || !rows.length} onClick={exportTimetablePdf}>Xuất PDF (.pdf)</button><button type="button" disabled={!canExport || !rows.length} onClick={() => void context.copyRows()}>Sao chép bảng</button></div></details>
      <button type="button" disabled={!canSyncPeriods || importing || loading} onClick={() => void syncAllPeriods()}><RefreshCw size={15} /> Đồng bộ toàn bộ học kỳ/năm</button>
    </>} />
    {showForm && <div className="workspace-record-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setShowForm(false); setEditing(null); } }}><form className="workspace-form workspace-record-modal" role="dialog" aria-modal="true" aria-labelledby="timetable-form-title" onSubmit={(event) => void saveTimetableForm(event)}><div className="workspace-form-head"><h2 id="timetable-form-title">{editing ? "Sửa lịch học" : "Thêm lịch học"}</h2><button type="button" onClick={() => { setShowForm(false); setEditing(null); }}>Đóng</button></div><div className="workspace-form-grid">{timetableFields.map((field) => <label key={field.key} className={field.key === "notes" ? "workspace-span" : ""}>{field.label}<input name={field.key} type={field.kind ?? "text"} step={field.kind === "number" ? "any" : undefined} required={field.required} defaultValue={field.key === "weekNumbers" ? (editing?.weekNumbers.join(", ") ?? "") : String(editing?.[field.key as keyof TimetableEntry] ?? "")} /></label>)}</div><div className="workspace-form-actions"><button className="workspace-primary">Lưu</button><button type="button" onClick={() => { setShowForm(false); setEditing(null); }}>Hủy</button></div></form></div>}
     <div className="workspace-panel timetable-toolbar"><QuickFilterHeading onClear={() => { setSearch(""); setSubjectFilter(""); setExpectedClassFilter(""); setAcademicYearFilter("all"); setSemester("all"); setTablePage(1); setSelectedTimetableIds(new Set()); localStorage.setItem("vtn-active-semester", "all"); window.dispatchEvent(new CustomEvent("vtn-semester-filter-changed", { detail: "all" })); }} clearDisabled={semester === "all" && academicYearFilter === "all" && !search && !subjectFilter && !expectedClassFilter} /><label>Năm học<SearchableFilter value={academicYearFilter} allValue="all" allLabel="Tất cả năm học" options={academicYearOptions.map((year) => ({ value: year, label: year }))} onChange={chooseAcademicYear} /></label><label>Học kỳ<SearchableFilter value={semester} allValue="all" allLabel="Tất cả học kỳ" options={[...(semester !== "all" && !visibleSemesterGroups.some((group) => group.semesters.includes(semester)) ? [{ value: semester, label: semester }] : []), ...visibleSemesterGroups.flatMap((group) => group.semesters.map((name) => ({ value: name, label: name })))]} onChange={(rawValue) => { const value = rawValue === "all" ? rawValue : normalizeSemesterName(rawValue); setSemester(value); setTablePage(1); setSelectedTimetableIds(new Set()); localStorage.setItem("vtn-active-semester", value); window.dispatchEvent(new CustomEvent("vtn-semester-filter-changed", { detail: value })); }} /></label><label>Tên môn học<SearchableFilter value={subjectFilter} allValue="" allLabel="Tất cả môn học" options={subjectOptions.map((subject) => ({ value: subject, label: subject }))} onChange={(value) => { setSubjectFilter(value); setTablePage(1); setSelectedTimetableIds(new Set()); }} /></label><label>Lớp dự kiến<SearchableFilter value={expectedClassFilter} allValue="" allLabel="Tất cả lớp" options={expectedClassOptions.map((classCode) => ({ value: classCode, label: classCode }))} onChange={(value) => { setExpectedClassFilter(value); setTablePage(1); setSelectedTimetableIds(new Set()); }} /></label><label className="timetable-search">Tìm môn, mã lớp, phòng<input value={search} onChange={(event) => { setSearch(event.target.value); setTablePage(1); setSelectedTimetableIds(new Set()); }} placeholder="Ví dụ: Khởi nghiệp, 23DQT1A, L.511" /></label></div>
    {(canViewList || canViewWeek) && <div className="timetable-view-tabs" role="tablist" aria-label="Cách xem thời khóa biểu">{canViewList && <button type="button" role="tab" aria-selected={activeView === "list"} className={activeView === "list" ? "active" : ""} onClick={() => setView("list")}>Danh sách</button>}{canViewWeek && <button type="button" role="tab" aria-selected={activeView === "week"} className={activeView === "week" ? "active" : ""} onClick={() => setView("week")}>Xem theo tuần</button>}</div>}
    {activeView === "none" && <div className="workspace-panel">Bạn chưa được cấp quyền xem các tab của thời khóa biểu.</div>}
    {activeView === "week" && loading && <p className="workspace-muted">Đang tải thời khóa biểu…</p>}
    {activeView === "week" && !loading && !error && <TeachingWeekCalendar records={weekViewRecords} />}
    {activeView === "list" && <>
    <div className="timetable-summary"><article><span>Học kỳ đang xem</span><strong>{title}</strong></article><article><span>Dòng lịch học</span><strong>{rows.length}</strong></article><article><span>Lớp học phần</span><strong>{classCount}</strong></article><article><span>Môn học phần</span><strong>{courseCount}</strong></article><article><span>Tổng lượt đăng ký</span><strong>{totalStudents}</strong></article></div>
    <div className="workspace-data-selection"><label><input type="checkbox" aria-label="Chọn tất cả dòng thời khóa biểu phù hợp" checked={allVisibleTimetablesSelected} ref={(element) => { if (element) element.indeterminate = selectedVisibleTimetableCount > 0 && !allVisibleTimetablesSelected; }} onChange={(event) => setSelectedTimetableIds((previous) => { const next = new Set(previous); rows.forEach((row) => event.target.checked ? next.add(row.id) : next.delete(row.id)); return next; })} /> Chọn tất cả {rows.length.toLocaleString("vi-VN")} dòng phù hợp</label><span>Đã chọn {selectedVisibleTimetableCount.toLocaleString("vi-VN")} / {rows.length.toLocaleString("vi-VN")} dòng</span><button type="button" disabled={!selectedTimetableIds.size} onClick={() => setSelectedTimetableIds(new Set())}>Bỏ chọn</button></div><div className="workspace-table-wrap timetable-table-wrap"><table><thead><tr><th rowSpan={2} className="gradebook-select-column"><input type="checkbox" aria-label="Chọn tất cả dòng thời khóa biểu phù hợp" checked={allVisibleTimetablesSelected} ref={(element) => { if (element) element.indeterminate = selectedVisibleTimetableCount > 0 && !allVisibleTimetablesSelected; }} onChange={(event) => setSelectedTimetableIds((previous) => { const next = new Set(previous); rows.forEach((row) => event.target.checked ? next.add(row.id) : next.delete(row.id)); return next; })} /></th><SortableTableHeader label="STT" sortKey="ordinal" sortState={tableSort} onSort={sortTimetableBy} rowSpan={2} /><SortableTableHeader label="MÃ LHP" sortKey="courseCode" sortState={tableSort} onSort={sortTimetableBy} rowSpan={2} /><SortableTableHeader label="TÊN MÔN HỌC" sortKey="subjectName" sortState={tableSort} onSort={sortTimetableBy} rowSpan={2} /><SortableTableHeader label="SỐ TC" sortKey="credits" sortState={tableSort} onSort={sortTimetableBy} rowSpan={2} /><SortableTableHeader label="Lớp dự kiến" sortKey="classCode" sortState={tableSort} onSort={sortTimetableBy} rowSpan={2} /><SortableTableHeader label="MÃ LỚP GHÉP" sortKey="mergedClassCode" sortState={tableSort} onSort={sortTimetableBy} rowSpan={2} /><SortableTableHeader label="HK" sortKey="__semester" sortState={tableSort} onSort={sortTimetableBy} rowSpan={2} /><th colSpan={5}>LỊCH HỌC</th><SortableTableHeader label="THỜI GIAN HỌC" sortKey="__time" sortState={tableSort} onSort={sortTimetableBy} rowSpan={2} /><th colSpan={weekColumns.length}>TUẦN HỌC</th><SortableTableHeader label="TỔNG SỐ TIẾT" sortKey="totalPeriods" sortState={tableSort} onSort={sortTimetableBy} rowSpan={2} /><SortableTableHeader label="PHÒNG" sortKey="room" sortState={tableSort} onSort={sortTimetableBy} rowSpan={2} /><SortableTableHeader label="GIẢNG VIÊN" sortKey="lecturer" sortState={tableSort} onSort={sortTimetableBy} rowSpan={2} /><SortableTableHeader label="GHI CHÚ" sortKey="notes" sortState={tableSort} onSort={sortTimetableBy} rowSpan={2} /><th rowSpan={2}>THAO T&#193;C</th></tr><tr><SortableTableHeader label="THỨ" sortKey="weekday" sortState={tableSort} onSort={sortTimetableBy} /><SortableTableHeader label="TIẾT" sortKey="periods" sortState={tableSort} onSort={sortTimetableBy} /><SortableTableHeader label="LOẠI LỊCH" sortKey="scheduleType" sortState={tableSort} onSort={sortTimetableBy} /><SortableTableHeader label="SỐ TIẾT" sortKey="periodCount" sortState={tableSort} onSort={sortTimetableBy} /><SortableTableHeader label="SĨ SỐ" sortKey="classSize" sortState={tableSort} onSort={sortTimetableBy} />{weekColumns.map((week) => <SortableTableHeader key={week} label={`T${week}`} sortKey={`week:${week}`} sortState={tableSort} onSort={sortTimetableBy} />)}</tr></thead><tbody>{loading && <tr><td className="workspace-state" colSpan={tableColumnCount}>Đang tải thời khóa biểu…</td></tr>}{!loading && visibleTableRows.map((row, index) => <tr key={row.id}><td className="gradebook-select-column"><input type="checkbox" aria-label={`Chọn lịch ${row.courseCode} · ${row.classCode} · ${row.semesterName}`} checked={selectedTimetableIds.has(row.id)} onChange={(event) => setSelectedTimetableIds((previous) => { const next = new Set(previous); if (event.target.checked) next.add(row.id); else next.delete(row.id); return next; })} /></td><td>{tablePageStart + index + 1}</td><td><button type="button" className="timetable-course-link" onClick={() => setDetailEntry(row)} aria-label={`Xem chi tiết học phần ${row.courseCode}`}>{row.courseCode}</button></td><td className="timetable-course timetable-subject-cell">{row.subjectName}</td><td>{row.credits}</td><td>{row.classCode}</td><td>{row.mergedClassCode || "—"}</td><td>{formatSemesterLabel(row.semesterName, row.academicYear)}</td><td>{weekdays[row.weekday] ?? `Thứ ${row.weekday}`}</td><td>{row.periods}</td><td>{row.scheduleType || "LT"}</td><td>{row.periodCount || "—"}</td><td>{row.classSize || "—"}</td><td>{dateLabel(row.startDate)} – {dateLabel(row.endDate)}</td>{weekColumns.map((week) => <td className="timetable-week-cell" key={week}>{row.weekNumbers.includes(week) ? "x" : ""}</td>)}<td className="timetable-total-cell">{row.totalPeriods}</td><td className="timetable-room-cell">{row.room || "—"}</td><td className="timetable-lecturer-cell">{row.lecturer || "—"}</td><td className="timetable-notes-cell">{row.notes || "—"}</td><td><div className="workspace-row-actions"><button type="button" title="Xem thời khóa biểu" aria-label={`Xem thời khóa biểu ${row.courseCode} · ${row.classCode}`} onClick={() => setDetailEntry(row)}><Eye size={15} /></button>{(canUpdate || canDelete) && <>{canUpdate && <button type="button" title="Edit schedule" onClick={() => { setEditing(row); setShowForm(true); }}><Edit3 size={15} /></button>}{canDelete && <button type="button" title="Move to trash" onClick={() => void deleteTimetable(row)}><Trash2 size={15} /></button>}</>}</div></td></tr>)}{!loading && !rows.length && <tr><td className="workspace-state" colSpan={tableColumnCount}><CalendarDays size={23} /><strong>Không có lịch học phù hợp</strong><span>Chọn học kỳ khác hoặc xóa từ khóa tìm kiếm.</span></td></tr>}</tbody></table></div><div className="workspace-pagination"><label>Số dòng<select aria-label="Số dòng thời khóa biểu mỗi trang" value={tablePageSize} onChange={(event) => { setTablePageSize(event.target.value as "10" | "20" | "50" | "100" | "all"); setTablePage(1); }}><option value="10">10 dòng</option><option value="20">20 dòng</option><option value="50">50 dòng</option><option value="100">100 dòng</option><option value="all">Tất cả</option></select></label><span>{rows.length ? `Đang hiển thị ${tablePageStart + 1}–${Math.min(tablePageStart + visibleTableRows.length, rows.length)} / ${rows.length.toLocaleString("vi-VN")} dòng` : "Đang hiển thị 0–0 / 0 dòng"}</span><div><button type="button" disabled={safeTablePage <= 1} onClick={() => setTablePage((page) => Math.max(1, page - 1))}>Trước</button><span>Trang {safeTablePage} / {tablePageCount}</span><button type="button" disabled={safeTablePage >= tablePageCount} onClick={() => setTablePage((page) => Math.min(tablePageCount, page + 1))}>Sau</button></div></div>
    </>}
    {detailEntry && <div className="timetable-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailEntry(null); }}><section className="timetable-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="timetable-detail-title"><header className="timetable-detail-header"><div><span>CHI TIẾT HỌC PHẦN</span><h2 id="timetable-detail-title">{detailEntry.courseCode}</h2><p>{detailEntry.subjectName || "Chưa có tên học phần"}</p></div><button type="button" onClick={() => setDetailEntry(null)} aria-label="Đóng chi tiết">Đóng</button></header><dl className="timetable-detail-grid">{[
      ["Năm học", detailEntry.academicYear], ["Học kỳ", formatSemesterLabel(detailEntry.semesterName, detailEntry.academicYear)], ["Mã LHP", detailEntry.courseCode], ["Tên môn học", detailEntry.subjectName], ["Số tín chỉ", detailEntry.credits], ["Lớp dự kiến", detailEntry.classCode], ["Mã lớp ghép", detailEntry.mergedClassCode], ["Thứ", weekdays[detailEntry.weekday] ?? `Thứ ${detailEntry.weekday}`]
    ].map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{value === "" ? "" : value}</dd></div>)}<div className="timetable-detail-date-row"><div><dt>Ngày bắt đầu</dt><dd>{dateLabel(detailEntry.startDate) || ""}</dd></div><div><dt>Ngày kết thúc</dt><dd>{dateLabel(detailEntry.endDate) || ""}</dd></div></div><div className="timetable-detail-schedule-row"><div><dt>Tiết</dt><dd>{detailEntry.periods || ""}</dd></div><div><dt>Loại lịch</dt><dd>{detailEntry.scheduleType || "LT"}</dd></div></div><div className="timetable-detail-number-row"><div><dt>Số tiết</dt><dd>{detailEntry.periodCount || ""}</dd></div><div><dt>Tổng số tiết</dt><dd>{detailEntry.totalPeriods || ""}</dd></div></div><div className="timetable-detail-pair-row"><div><dt>Sĩ số</dt><dd>{detailEntry.classSize || ""}</dd></div></div><div className="timetable-detail-pair-row"><div><dt>Phòng</dt><dd>{detailEntry.room || ""}</dd></div><div><dt>Giảng viên</dt><dd>{detailEntry.lecturer || ""}</dd></div></div><div className="timetable-detail-notes"><dt>Ghi chú</dt><dd title={detailEntry.notes}>{detailEntry.notes || ""}</dd></div><div className="timetable-detail-weeks"><dt>Tuần học</dt><dd>{detailEntry.weekNumbers.length ? <div className="timetable-week-tags">{[...new Set(detailEntry.weekNumbers)].sort((a, b) => a - b).map((week) => <span key={week}>T{week}</span>)}</div> : ""}</dd></div></dl></section></div>}    {canImport && <p className="workspace-muted timetable-source-note">Dữ liệu đã chuẩn hóa từ 9 tệp thời khóa biểu đính kèm. Khi nhập, hệ thống tạo hoặc cập nhật niên khóa, học kỳ, môn học, học phần và lớp học phần; mã nguồn giúp nhập lại mà không nhân đôi dữ liệu. Tên lớp và học kỳ dùng chung để tra cứu với hồ sơ sinh viên, điểm danh và sổ điểm.</p>}
  </main>;
}

