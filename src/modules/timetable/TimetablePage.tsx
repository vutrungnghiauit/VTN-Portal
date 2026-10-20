import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarDays, Edit3, FileUp, Plus, RefreshCw, Trash2 } from "lucide-react";
import { workspaceService, type WorkspaceRecord } from "../workspace/workspace.service";
import { settingsService } from "../settings/settings.service";
import { normalizeLecturer } from "../../lib/lecturer-format";
import { groupSemestersByAcademicYear, normalizeSemesterName, semesterIdentity } from "../../lib/semester-groups";
import SpreadsheetTransferPanel, { type SpreadsheetValue } from "../workspace/SpreadsheetTransferPanel";
import type { ModuleField } from "../workspace/module-definitions";
import seedRows from "./semester-schedules.json";
import "./timetable.css";

type TimetableEntry = (typeof seedRows)[number];
type RelatedSpec = { key: string; externalId: string; values: Record<string, string | number | null>; match: (record: WorkspaceRecord) => boolean };
const weekdays: Record<string, string> = { "2": "Thứ 2", "3": "Thứ 3", "4": "Thứ 4", "5": "Thứ 5", "6": "Thứ 6", "7": "Thứ 7", "8": "Chủ nhật" };
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

function toEntry(record: WorkspaceRecord): TimetableEntry | null {
  const data = record.data;
  if (!data.courseCode || !data.classCode || !data.semesterName) return null;
  return {
    id: String(data.sourceId ?? record.external_id ?? record.id), sourceFile: String(data.sourceFile ?? ""),
    academicYear: String(data.academicYear ?? ""), semesterNumber: Number(data.semesterNumber ?? 0), semesterName: String(data.semesterName),
    courseCode: String(data.courseCode), subjectName: String(data.subjectName ?? ""), credits: Number(data.credits ?? 0), classCode: String(data.classCode), mergedClassCode: String(data.mergedClassCode ?? ""), sourceSemesterCode: String(data.sourceSemesterCode ?? ""), sourceWeekdayCode: String(data.sourceWeekdayCode ?? ""), weekday: String(data.weekday ?? ""), periods: String(data.periods ?? ""), scheduleType: String(data.scheduleType ?? ""), periodCount: Number(data.periodCount ?? 0), group: String(data.group ?? ""), classSize: Number(data.classSize ?? 0), startDate: String(data.startDate ?? ""), endDate: String(data.endDate ?? ""), weekNumbers: String(data.weekNumbers ?? "").split(",").filter(Boolean).map(Number), totalPeriods: Number(data.totalPeriods ?? 0), room: String(data.room ?? ""), lecturer: normalizeLecturer(data.lecturer), notes: String(data.notes ?? ""),
  } as TimetableEntry;
}

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

async function syncPeriodCatalog(sourceRows: TimetableEntry[]) {
  const validRows = sourceRows.filter((row) => row.semesterName?.trim());
  if (!validRows.length) throw new Error("Chưa có học kỳ nào trong thời khóa biểu để đồng bộ.");
  const grouped = <T,>(items: T[], keyOf: (item: T) => string) => {
    const result = new Map<string, T[]>();
    for (const item of items) { const key = keyOf(item); result.set(key, [...(result.get(key) ?? []), item]); }
    return result;
  };
  const yearOf = (row: TimetableEntry) => row.academicYear || row.semesterName.match(/\d{4}-\d{4}/)?.[0] || "";
  const byYear = grouped(validRows.filter((row) => yearOf(row)), yearOf);
  const byTerm = grouped(validRows, (row) => row.semesterName);
  const dateBounds = (items: TimetableEntry[]) => ({
    startDate: items.map((item) => item.startDate).filter(Boolean).sort()[0] ?? "",
    endDate: [...items.map((item) => item.endDate).filter(Boolean)].sort().at(-1) ?? "",
  });
  const [yearExisting, semesterExisting, currentSettings] = await Promise.all([
    workspaceService.list("academic-years"), workspaceService.list("semesters"), settingsService.get(),
  ]);
  const yearSpecs: RelatedSpec[] = [...byYear].map(([year, items]) => ({
    key: year, externalId: `timetable-year:${year}`,
    values: { title: year, ...dateBounds(items), status: "Đã đồng bộ từ thời khóa biểu", notes: `Nguồn: ${[...new Set(items.map((item) => item.sourceFile).filter(Boolean))].join(", ") || "Dữ liệu thời khóa biểu"}` },
    match: (record) => record.data.title === year,
  }));
  const termSpecs: RelatedSpec[] = [...byTerm].map(([name, items]) => {
    const weeks = Math.max(0, ...items.flatMap((item) => item.weekNumbers));
    return {
      key: name, externalId: `timetable-semester:${name}`,
      values: { title: name, academicYear: yearOf(items[0]), ...dateBounds(items), weeks, current: currentSettings.current_semester === name ? "Có" : "Không", notes: `Đồng bộ từ thời khóa biểu; tuần tối đa T${weeks}.` },
      match: (record) => record.data.title === name,
    };
  });
  await saveRelated("academic-years", yearExisting, yearSpecs);
  await saveRelated("semesters", semesterExisting, termSpecs);
  window.dispatchEvent(new CustomEvent("vtn-semester-list-updated"));
  return { years: yearSpecs.length, semesters: termSpecs.length };
}

export default function TimetablePage({ canCreate, canUpdate, canDelete, canImport, canExport = true }: { canCreate: boolean; canUpdate: boolean; canDelete: boolean; canImport: boolean; canExport?: boolean }) {
  const [storedRows, setStoredRows] = useState<WorkspaceRecord[]>([]);
  const [semester, setSemester] = useState(selectedInitial);
  const [search, setSearch] = useState("");
  const [weekFilter, setWeekFilter] = useState("");
  const [dayFilter, setDayFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<TimetableEntry | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [detailEntry, setDetailEntry] = useState<TimetableEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setStoredRows((await workspaceService.allRecords()).filter((record) => record.module_key === "timetables")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được thời khóa biểu đã nhập."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const update = (event: Event) => { const value = (event as CustomEvent<string>).detail || "all"; setSemester(value === "all" ? value : normalizeSemesterName(value)); };
    window.addEventListener("vtn-semester-filter-changed", update);
    return () => window.removeEventListener("vtn-semester-filter-changed", update);
  }, []);

  const rows = useMemo(() => {
    const activeRows = storedRows.filter((record) => !record.deleted_at);
    const saved = new Map(activeRows.map((record) => [record.external_id || String(record.data.sourceId ?? ""), record]));
    const deletedIds = new Set(storedRows.filter((record) => record.deleted_at).map((record) => record.external_id || String(record.data.sourceId ?? "")));
    const merged = seedRows.filter((source) => !deletedIds.has(source.id)).map((source) => {
      const record = saved.get(source.id);
      return record ? toEntry(record) ?? source : source;
    });
    const known = new Set(seedRows.map((row) => row.id));
    for (const record of activeRows) {
      const parsed = toEntry(record);
      if (parsed && !known.has(parsed.id)) merged.push(parsed);
    }
    const needle = search.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    return merged.filter((row) => (semester === "all" || semesterIdentity(row.semesterName) === semesterIdentity(semester)) && (!weekFilter || row.weekNumbers.includes(Number(weekFilter))) && (!dayFilter || row.weekday === dayFilter) && (!needle || JSON.stringify(row).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(needle)))
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || Number(a.weekday) - Number(b.weekday) || a.periods.localeCompare(b.periods));
  }, [storedRows, semester, search, weekFilter, dayFilter]);
  const semesterOptions = [...new Map([...terms, ...rows.map((row) => ({ name: normalizeSemesterName(row.semesterName), year: row.academicYear, number: row.semesterNumber }))].map((term) => [semesterIdentity(term.name), term])).values()]
    .sort((a, b) => a.year.localeCompare(b.year) || a.number - b.number);
  const semesterGroups = groupSemestersByAcademicYear(semesterOptions.map((term) => term.name));

  const classCount = new Set(rows.map((row) => `${row.semesterName}|${row.classCode}|${row.courseCode}`)).size;
  const courseCount = new Set(rows.map((row) => row.courseCode)).size;
  const studentCount = new Map<string, number>();
  rows.forEach((row) => { const key = `${row.semesterName}|${row.classCode}|${row.courseCode}`; studentCount.set(key, Math.max(studentCount.get(key) ?? 0, row.classSize)); });
  const totalStudents = [...studentCount.values()].reduce((sum, value) => sum + value, 0);
  const weekColumns = Array.from({ length: Math.max(16, ...rows.map((row) => Math.max(...row.weekNumbers, 0))) }, (_, index) => index + 1);
  const tableColumnCount = 18 + weekColumns.length;

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
    await workspaceService.saveMany("timetables", pending); setNotice(`Đã nhập/cập nhật ${processed} dòng thời khóa biểu.`); await load();
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
    try { const found = storedRows.find((record) => !record.deleted_at && (record.external_id === id || String(record.data.sourceId ?? "") === editing?.id)); await workspaceService.save("timetables", stored, found?.id, id); setShowForm(false); setEditing(null); setNotice(editing ? "Đã cập nhật dòng thời khóa biểu." : "Đã thêm dòng thời khóa biểu."); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không lưu được dòng thời khóa biểu."); }
  }

  async function syncAllPeriods() {
    if (!canImport) return;
    setImporting(true); setError(""); setNotice("");
    try {
      const activeRows = storedRows.filter((record) => !record.deleted_at);
      const deletedIds = new Set(storedRows.filter((record) => record.deleted_at).map((record) => record.external_id || String(record.data.sourceId ?? "")));
      const saved = new Map(activeRows.map((record) => [record.external_id || String(record.data.sourceId ?? ""), record]));
      const sources: TimetableEntry[] = seedRows.filter((row) => !deletedIds.has(row.id)).map((row) => saved.has(row.id) ? toEntry(saved.get(row.id)!) ?? row : row);
      const known = new Set(sources.map((row) => row.id));
      for (const record of activeRows) {
        const entry = toEntry(record);
        if (entry && !known.has(entry.id)) { sources.push(entry); known.add(entry.id); }
      }
      const synced = await syncPeriodCatalog(sources);
      setNotice(`Đã đồng bộ ${synced.semesters} học kỳ và ${synced.years} năm học từ toàn bộ thời khóa biểu.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể đồng bộ học kỳ và năm học."); }
    finally { setImporting(false); }
  }

  async function deleteTimetable(row: TimetableEntry) {
    if (!canDelete || !window.confirm(`Chuyển lịch ${row.courseCode} · ${row.classCode} vào thùng rác?`)) return;
    try {
      let record = storedRows.find((item) => !item.deleted_at && (item.external_id === row.id || String(item.data.sourceId ?? "") === row.id));
      if (!record) record = await workspaceService.save("timetables", { ...row, weekNumbers: row.weekNumbers.join(","), sourceId: row.id }, undefined, row.id);
      await workspaceService.moveToTrash(record.id); setNotice("Đã chuyển lịch học vào thùng rác."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể chuyển lịch vào thùng rác."); }
  }

  const title = semester === "all" ? "Tất cả học kỳ" : semester;
  return <main className="workspace-page timetable-page">
    <header className="workspace-title-row"><div><p className="workspace-eyebrow">ĐÀO TẠO</p><h1>Thời khóa biểu học kỳ</h1><p>Lịch học theo lớp, học phần, ngày, tiết, phòng và tuần học; dữ liệu được liên kết với danh mục học kỳ, môn học và lớp học phần.</p></div><div className="timetable-header-actions"><button type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} /> Làm mới</button>{canCreate && <button className="workspace-primary" type="button" onClick={() => { setEditing(null); setShowForm(true); setError(""); }}><Plus size={16} /> Thêm lịch học</button>}</div></header>
    {error && <div className="workspace-alert" role="alert">{error}</div>}{notice && <div className="workspace-notice" role="status">{notice}</div>}
    <SpreadsheetTransferPanel title="Thời khóa biểu học kỳ" fields={timetableFields} rows={rows as unknown as Array<Record<string, unknown>>} canImport={canImport} canExport={canExport} onImport={saveImportedSchedules} />
    {showForm && <form className="workspace-form" onSubmit={(event) => void saveTimetableForm(event)}><div className="workspace-form-head"><h2>{editing ? "Sửa lịch học" : "Thêm lịch học"}</h2><button type="button" onClick={() => setShowForm(false)}>Đóng</button></div><div className="workspace-form-grid">{timetableFields.map((field) => <label key={field.key} className={field.key === "notes" ? "workspace-span" : ""}>{field.label}<input name={field.key} type={field.kind ?? "text"} step={field.kind === "number" ? "any" : undefined} required={field.required} defaultValue={field.key === "weekNumbers" ? (editing?.weekNumbers.join(", ") ?? "") : String(editing?.[field.key as keyof TimetableEntry] ?? "")} /></label>)}</div><div className="workspace-form-actions"><button className="workspace-primary">Lưu</button><button type="button" onClick={() => setShowForm(false)}>Hủy</button></div></form>}
    <div className="workspace-panel timetable-toolbar"><label>Học kỳ<select value={semester} onChange={(event) => { const rawValue = event.target.value; const value = rawValue === "all" ? rawValue : normalizeSemesterName(rawValue); setSemester(value); localStorage.setItem("vtn-active-semester", value); window.dispatchEvent(new CustomEvent("vtn-semester-filter-changed", { detail: value })); }}><option value="all">Tất cả học kỳ</option>{semesterGroups.map((group) => <optgroup key={group.academicYear} label={group.academicYear === "Khác" ? "Năm học chưa xác định" : `Năm học ${group.academicYear}`}>{group.semesters.map((name) => <option key={name} value={name}>{name}</option>)}</optgroup>)}</select></label><label>Tuần học<select value={weekFilter} onChange={(event) => setWeekFilter(event.target.value)}><option value="">Tất cả tuần</option>{Array.from({ length: Math.max(0, ...rows.map((row) => Math.max(...row.weekNumbers, 0))) }, (_, index) => index + 1).map((week) => <option key={week} value={String(week)}>Tuần {week}</option>)}</select></label><label>Ngày trong tuần<select value={dayFilter} onChange={(event) => setDayFilter(event.target.value)}><option value="">Tất cả ngày</option>{Object.entries(weekdays).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label><label className="timetable-search">Tìm môn, mã lớp, phòng<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ví dụ: Khởi nghiệp, 23DQT1A, L.511" /></label>{canImport && <div className="timetable-import-actions"><button className="workspace-primary" type="button" disabled={importing || loading || !seedRows.length} onClick={() => void importSchedules(false)}><FileUp size={16} /> {importing ? "Đang đồng bộ…" : semester === "all" ? "Nhập tất cả học kỳ" : "Nhập học kỳ này"}</button><button type="button" disabled={importing || loading} onClick={() => void syncAllPeriods()}><RefreshCw size={15} /> Đồng bộ toàn bộ kỳ/năm</button>{semester !== "all" && <button type="button" disabled={importing || loading} onClick={() => void importSchedules(true)}><FileUp size={15} /> Nhập cả 9 học kỳ</button>}</div>}</div>
    <div className="timetable-summary"><article><span>Học kỳ đang xem</span><strong>{title}</strong></article><article><span>Dòng lịch học</span><strong>{rows.length}</strong></article><article><span>Lớp học phần</span><strong>{classCount}</strong></article><article><span>Môn học phần</span><strong>{courseCount}</strong></article><article><span>Tổng lượt đăng ký</span><strong>{totalStudents}</strong></article></div>
    <div className="workspace-table-wrap timetable-table-wrap"><table><thead><tr><th rowSpan={2}>STT</th><th rowSpan={2}>MÃ LHP</th><th rowSpan={2}>TÊN MÔN HỌC</th><th rowSpan={2}>SỐ TC</th><th rowSpan={2}>LỚP DỰ KIẾN</th><th rowSpan={2}>MÃ LỚP GHÉP</th><th rowSpan={2}>HK</th><th colSpan={5}>LỊCH HỌC</th><th rowSpan={2}>THỜI GIAN HỌC</th><th colSpan={weekColumns.length}>TUẦN HỌC</th><th rowSpan={2}>TỔNG SỐ TIẾT</th><th rowSpan={2}>PHÒNG</th><th rowSpan={2}>GIẢNG VIÊN</th><th rowSpan={2}>GHI CHÚ</th><th rowSpan={2}>THAO T&#193;C</th></tr><tr><th>THỨ</th><th>TIẾT</th><th>LOẠI LỊCH</th><th>SỐ TIẾT</th><th>SĨ SỐ</th>{weekColumns.map((week) => <th key={week}>T{week}</th>)}</tr></thead><tbody>{loading && <tr><td className="workspace-state" colSpan={tableColumnCount}>Đang tải thời khóa biểu…</td></tr>}{!loading && rows.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td><button type="button" className="timetable-course-link" onClick={() => setDetailEntry(row)} aria-label={`Xem chi tiết học phần ${row.courseCode}`}>{row.courseCode}</button></td><td className="timetable-course timetable-subject-cell">{row.subjectName}</td><td>{row.credits}</td><td>{row.classCode}</td><td>{row.mergedClassCode || "—"}</td><td>HK {row.semesterNumber}</td><td>{weekdays[row.weekday] ?? `Thứ ${row.weekday}`}</td><td>{row.periods}</td><td>{row.scheduleType || "LT"}</td><td>{row.periodCount || "—"}</td><td>{row.classSize || "—"}</td><td>{dateLabel(row.startDate)} – {dateLabel(row.endDate)}</td>{weekColumns.map((week) => <td className="timetable-week-cell" key={week}>{row.weekNumbers.includes(week) ? "x" : ""}</td>)}<td className="timetable-total-cell">{row.totalPeriods}</td><td className="timetable-room-cell">{row.room || "—"}</td><td className="timetable-lecturer-cell">{row.lecturer || "—"}</td><td className="timetable-notes-cell">{row.notes || "—"}</td><td><div className="workspace-row-actions">{(canUpdate || canDelete) && <>{canUpdate && <button type="button" title="Edit schedule" onClick={() => { setEditing(row); setShowForm(true); }}><Edit3 size={15} /></button>}{canDelete && <button type="button" title="Move to trash" onClick={() => void deleteTimetable(row)}><Trash2 size={15} /></button>}</>}</div></td></tr>)}{!loading && !rows.length && <tr><td className="workspace-state" colSpan={tableColumnCount}><CalendarDays size={23} /><strong>Không có lịch học phù hợp</strong><span>Chọn học kỳ khác hoặc xóa từ khóa tìm kiếm.</span></td></tr>}</tbody></table></div>
    {detailEntry && <div className="timetable-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailEntry(null); }}><section className="timetable-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="timetable-detail-title"><header className="timetable-detail-header"><div><span>CHI TIẾT HỌC PHẦN</span><h2 id="timetable-detail-title">{detailEntry.courseCode}</h2><p>{detailEntry.subjectName || "Chưa có tên học phần"}</p></div><button type="button" onClick={() => setDetailEntry(null)} aria-label="Đóng chi tiết">Đóng</button></header><dl className="timetable-detail-grid">{[
      ["Năm học", detailEntry.academicYear], ["Học kỳ", detailEntry.semesterName], ["Mã LHP", detailEntry.courseCode], ["Tên môn học", detailEntry.subjectName], ["Số tín chỉ", detailEntry.credits], ["Lớp dự kiến", detailEntry.classCode], ["Mã lớp ghép", detailEntry.mergedClassCode], ["Thứ", weekdays[detailEntry.weekday] ?? `Thứ ${detailEntry.weekday}`]
    ].map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{value === "" ? "" : value}</dd></div>)}<div className="timetable-detail-date-row"><div><dt>Ngày bắt đầu</dt><dd>{dateLabel(detailEntry.startDate) || ""}</dd></div><div><dt>Ngày kết thúc</dt><dd>{dateLabel(detailEntry.endDate) || ""}</dd></div></div><div className="timetable-detail-schedule-row"><div><dt>Tiết</dt><dd>{detailEntry.periods || ""}</dd></div><div><dt>Loại lịch</dt><dd>{detailEntry.scheduleType || "LT"}</dd></div></div><div className="timetable-detail-number-row"><div><dt>Số tiết</dt><dd>{detailEntry.periodCount || ""}</dd></div><div><dt>Tổng số tiết</dt><dd>{detailEntry.totalPeriods || ""}</dd></div></div><div className="timetable-detail-pair-row"><div><dt>Sĩ số</dt><dd>{detailEntry.classSize || ""}</dd></div></div><div className="timetable-detail-pair-row"><div><dt>Phòng</dt><dd>{detailEntry.room || ""}</dd></div><div><dt>Giảng viên</dt><dd>{detailEntry.lecturer || ""}</dd></div></div><div className="timetable-detail-notes"><dt>Ghi chú</dt><dd title={detailEntry.notes}>{detailEntry.notes || ""}</dd></div><div className="timetable-detail-weeks"><dt>Tuần học</dt><dd>{detailEntry.weekNumbers.length ? <div className="timetable-week-tags">{[...new Set(detailEntry.weekNumbers)].sort((a, b) => a - b).map((week) => <span key={week}>T{week}</span>)}</div> : ""}</dd></div></dl></section></div>}    {canImport && <p className="workspace-muted timetable-source-note">Dữ liệu đã chuẩn hóa từ 9 tệp thời khóa biểu đính kèm. Khi nhập, hệ thống tạo hoặc cập nhật niên khóa, học kỳ, môn học, học phần và lớp học phần; mã nguồn giúp nhập lại mà không nhân đôi dữ liệu. Tên lớp và học kỳ dùng chung để tra cứu với hồ sơ sinh viên, điểm danh và sổ điểm.</p>}
  </main>;
}

