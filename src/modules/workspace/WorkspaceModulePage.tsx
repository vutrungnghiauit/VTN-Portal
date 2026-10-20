import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Archive, Bot, ContactRound, Edit3, Lock, Plus, Search, Send, Sparkles, Trash2, Unlock, X } from "lucide-react";
import type { ModuleDefinition } from "./module-definitions";
import { workspaceService, type WorkspaceRecord } from "./workspace.service";
import { settingsService } from "../settings/settings.service";
import { supabase } from "../../lib/supabase";
import { formatDate, formatDateTime } from "../../lib/date-format";
import { normalizeLecturer } from "../../lib/lecturer-format";
import { groupSemestersByAcademicYear, normalizeSemesterName, semesterIdentity } from "../../lib/semester-groups";
import { studentService } from "../students/student.service";
import SpreadsheetTransferPanel, { type SpreadsheetValue } from "./SpreadsheetTransferPanel";
import { getTeachingPeriodCatalog } from "./TeachingPlanSchedulePage";
import sourceTeachingSchedule from "./teaching-schedule-2023-2027.json";
import { extractGradebookPdf } from "./gradebook-pdf";
import "./workspace.css";

function recordName(record: WorkspaceRecord) {
  return String(record.data.title ?? record.data.listName ?? record.data.classCode ?? record.data.subjectCode
    ?? (record.data.studentCode ? `${record.data.studentCode} - ${record.data.studentName ?? "Sinh viên"}` : "Bản ghi"));
}
const GRADEBOOK_LECTURER = "01011090 - Vũ Trung Nghĩa";

function gradeNameParts(data: Record<string, unknown> | undefined) {
  const studentGivenName = String(data?.studentGivenName ?? "").trim();
  const studentMiddleName = String(data?.studentMiddleName ?? "").trim();
  if (studentGivenName || studentMiddleName) return { studentMiddleName, studentGivenName };
  const words = String(data?.studentName ?? "").trim().split(/\s+/).filter(Boolean);
  return { studentMiddleName: words.slice(0, -1).join(" "), studentGivenName: words[words.length - 1] ?? "" };
}

function calendarDisplayData(data: Record<string, unknown>): Record<string, unknown> {
  const weekPattern = String(data.weekPattern ?? "");
  return {
    ...data,
    ...(data.lecturer !== undefined ? { lecturer: normalizeLecturer(data.lecturer) } : {}),
    ...(data.fromPeriod !== undefined && data.toPeriod !== undefined ? { lessonPattern: `${data.fromPeriod}-${data.toPeriod}` } : {}),
    ...(weekPattern ? { weekNumbers: [...weekPattern].flatMap((char, index) => char === "-" ? [] : [`T${index + 1}`]).join(" ") } : {}),
  };
}

function catalogIdentity(moduleKey: string, data: Record<string, unknown>) {
  const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[–—−]/g, "-").replace(/\s+/g, " ").trim().toLocaleLowerCase("vi-VN");
  return moduleKey === "semesters" ? `${normalize(data.title)}|${normalize(data.academicYear)}` : normalize(data.title);
}

function normalizeAcademicYearRow(row: WorkspaceRecord): WorkspaceRecord {
  const status = String(row.data.status ?? "");
  // Old rows may contain Vietnamese text decoded with the wrong character set.
  // The academic-year status is generated from the teaching plan, so recover
  // this known field to the same canonical label used by the sync action.
  if (/(?:Ã|Ä|Æ|á»|â€|�)/.test(status)) {
    return { ...row, data: { ...row.data, status: "Theo tiến độ đào tạo" } };
  }
  return row;
}

export default function WorkspaceModulePage({ module, role = "", permissions = { create: true, update: true, delete: true, import: true, export: true } }: { module: ModuleDefinition; role?: string; permissions?: { create: boolean; update: boolean; delete: boolean; import: boolean; export: boolean } }) {
  void role;
  type DocumentAssistantMessage = { role: "user" | "assistant"; content: string; citations?: Array<{ code?: string; title?: string; fileName?: string; url?: string }> };
  const [rows, setRows] = useState<WorkspaceRecord[]>([]);
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<WorkspaceRecord | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [documentAIOpen, setDocumentAIOpen] = useState(false);
  const [documentAIQuestion, setDocumentAIQuestion] = useState("");
  const [documentAIBusy, setDocumentAIBusy] = useState(false);
  const [documentAIMessages, setDocumentAIMessages] = useState<DocumentAssistantMessage[]>([{ role: "assistant", content: "Tôi có thể tra cứu các tài liệu học vụ đã được lập chỉ mục. Hãy hỏi về đề cương, tín chỉ hoặc quy chế đào tạo." }]);
  const [lecturerContact, setLecturerContact] = useState<Record<string, unknown>>({});
  const [semesterFilter, setSemesterFilter] = useState(() => localStorage.getItem("vtn-active-semester") || "all");
  const [sharedSemesterNames, setSharedSemesterNames] = useState<string[]>([]);
  const [appliedSemester, setAppliedSemester] = useState("");
  const [supportCategoryChoice, setSupportCategoryChoice] = useState("");
  const [currentStudentCode, setCurrentStudentCode] = useState("");
  const [currentStudentName, setCurrentStudentName] = useState("");
  const [taskStatusSavingId, setTaskStatusSavingId] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [weekdayFilter, setWeekdayFilter] = useState("all");
  const [sortState, setSortState] = useState({ key: "ordinal", direction: "asc" as "asc" | "desc" });
  const [pageSize, setPageSize] = useState("10");
  const [page, setPage] = useState(1);
  const gradebookPdfInput = useRef<HTMLInputElement>(null);
  const isCalendar = module.key === "calendar";
  const isPaged = isCalendar || module.key === "grades";

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const records = await workspaceService.list(module.key);
      setRows(module.key === "academic-years" ? records.map(normalizeAcademicYearRow) : records);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể tải dữ liệu."); }
    finally { setLoading(false); }
  }, [module.key]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (module.key !== "student-support" || !supabase) return;
    let active = true;
    void (async () => {
      try {
        const { data, error } = await supabase!.auth.getUser();
        if (error || !data.user) return;
        const linkedStudent = (await studentService.list()).find((student) => student.authUserId === data.user.id);
        if (active) { setCurrentStudentCode(linkedStudent?.studentCode ?? ""); setCurrentStudentName(linkedStudent?.fullName ?? ""); }
      } catch { if (active) { setCurrentStudentCode(""); setCurrentStudentName(""); } }
    })();
    return () => { active = false; };
  }, [module.key]);
  useEffect(() => { const update = (event: Event) => { const value = (event as CustomEvent<string>).detail || "all"; setSemesterFilter(value === "all" ? value : normalizeSemesterName(value)); if (showForm && !edit) setAppliedSemester(value === "all" ? "" : normalizeSemesterName(value)); }; window.addEventListener("vtn-semester-filter-changed", update); return () => window.removeEventListener("vtn-semester-filter-changed", update); }, [showForm, edit]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const [semesters, students, records, settings] = await Promise.all([workspaceService.list("semesters"), studentService.list(), workspaceService.allRecords(), settingsService.get()]);
        if (!active) return;
        const rawNames = [...semesters.map((row) => String(row.data.title ?? "")), ...students.map((student) => student.semesterName), ...records.filter((record) => record.module_key === "calendar" || record.module_key === "timetables").map((record) => String(record.data.semesterName ?? record.data.semester ?? record.data.round ?? "")), String(settings.current_semester ?? "")];
        const unique = new Map<string, string>();
        for (const rawName of rawNames) { const name = normalizeSemesterName(rawName); if (name && !unique.has(semesterIdentity(name))) unique.set(semesterIdentity(name), name); }
        setSharedSemesterNames([...unique.values()]);
      } catch { /* Keep the form usable with the options already loaded. */ }
    };
    void refresh();
    window.addEventListener("vtn-semester-list-updated", refresh);
    window.addEventListener("vtn-semester-options-updated", refresh);
    window.addEventListener("vtn-students-updated", refresh);
    window.addEventListener("vtn-system-settings-updated", refresh);
    return () => { active = false; window.removeEventListener("vtn-semester-list-updated", refresh); window.removeEventListener("vtn-semester-options-updated", refresh); window.removeEventListener("vtn-students-updated", refresh); window.removeEventListener("vtn-system-settings-updated", refresh); };
  }, []);
  useEffect(() => {
    if (!showForm) return;
    if (module.key === "student-support") {
      const options = module.fields.find((field) => field.key === "category")?.options ?? [];
      const existing = String(edit?.data.category ?? "");
      setSupportCategoryChoice(existing && !options.includes(existing) ? "Khác" : existing || options[0] || "Khác");
    }
    if (!edit) setAppliedSemester(semesterFilter === "all" ? "" : normalizeSemesterName(semesterFilter));
    else setAppliedSemester(normalizeSemesterName(String(edit.data.semesterName ?? edit.data.semester ?? "")));
  }, [showForm, edit, module.key, module.fields, semesterFilter]);

  const visible = useMemo(() => {
    const needle = search.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const filtered = rows.filter((row) => {
      const matchesSemester = semesterFilter === "all" || normalizeSemesterName(String(row.data.semesterName ?? row.data.semester ?? "")) === normalizeSemesterName(semesterFilter);
      const matchesClass = !isCalendar || classFilter === "all" || String(row.data.className ?? "") === classFilter;
      const matchesDay = !isCalendar || weekdayFilter === "all" || String(row.data.weekday ?? "") === weekdayFilter;
      const haystack = JSON.stringify(isCalendar ? calendarDisplayData(row.data) : row.data).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      return matchesSemester && matchesClass && matchesDay && haystack.includes(needle);
    });
    if (isCalendar) {
      const sorted = [...filtered].sort((a, b) => {
        const left = sortState.key === "updated_at" ? a.updated_at : calendarDisplayData(a.data)[sortState.key];
        const right = sortState.key === "updated_at" ? b.updated_at : calendarDisplayData(b.data)[sortState.key];
        const leftNumber = Number(left); const rightNumber = Number(right);
        const comparison = left !== "" && right !== "" && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
          ? leftNumber - rightNumber
          : String(left ?? "").localeCompare(String(right ?? ""), "vi", { numeric: true, sensitivity: "base" });
        return (sortState.direction === "asc" ? comparison : -comparison) || a.id.localeCompare(b.id);
      });
      return sorted;
    }
    if (module.key !== "semesters" && module.key !== "academic-years") return filtered;
    const unique = [...new Map([...filtered].reverse().map((row) => [catalogIdentity(module.key, row.data), row])).values()];
    return unique.sort((a, b) => {
      const endA = String(a.data.endDate ?? "");
      const endB = String(b.data.endDate ?? "");
      if (!endA) return endB ? 1 : 0;
      if (!endB) return -1;
      return endB.localeCompare(endA) || recordName(a).localeCompare(recordName(b), "vi");
    });
  }, [rows, search, semesterFilter, module.key, isCalendar, classFilter, weekdayFilter, sortState]);
  const columns = isCalendar ? module.fields.filter((field) => !field.hidden) : module.key === "grades" ? module.fields.filter((field) => !field.hidden && field.key !== "title") : module.fields.filter((field) => !field.hidden && !["title", "listName", "items", "notes"].includes(field.key)).slice(0, 3);
  const transferFields = [ ...(module.key === "calendar" ? [{ key: "semesterName", label: "Học kỳ áp dụng" }] : []), ...module.fields.filter((field) => module.key !== "grades" || field.key !== "title") ];
  const transferExportFields = module.key === "grades" ? transferFields.filter((field) => !field.hidden) : transferFields;
  const semesterGroups = groupSemestersByAcademicYear([...new Map([...sharedSemesterNames, String(edit?.data.semesterName ?? edit?.data.semester ?? "")].map(normalizeSemesterName).filter(Boolean).map((name) => [semesterIdentity(name), name])).values()]);
  const classOptions = isCalendar ? [...new Set(rows.map((row) => String(row.data.className ?? "")).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi")) : [];
  const weekdayOptions = isCalendar ? [...new Set(rows.map((row) => String(row.data.weekday ?? "")).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi", { numeric: true })) : [];
  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(visible.length / Number(pageSize)));
  const currentPage = Math.min(page, totalPages);
  const pageRows = pageSize === "all" ? visible : visible.slice((currentPage - 1) * Number(pageSize), currentPage * Number(pageSize));

  function sortBy(key: string) {
    setSortState((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" });
    setPage(1);
  }

  async function importSpreadsheet(imported: Array<Record<string, SpreadsheetValue>>) {
    if (!permissions.create || !permissions.update) throw new Error("Nhập dữ liệu cần quyền thêm và sửa trong phân hệ này.");
    const allRecords = module.key === "grades" ? await workspaceService.list("grades") : await workspaceService.allRecords();
    const existing = allRecords.filter((record) => record.module_key === module.key && !record.deleted_at);
    const getValue = (item: Record<string, SpreadsheetValue>, key: string) => String(item[key] ?? "").trim();
    const identityFields: Record<string, string[]> = { semesters: ["title", "academicYear"], "academic-years": ["title"], grades: ["studentCode", "courseCode", "semesterName"], calendar: ["ordinal", "courseCode", "className", "title", "classSize", "weekday", "fromPeriod", "toPeriod", "room", "weekPattern", "startDate", "semesterName"] };
    const identity = (item: Record<string, SpreadsheetValue>) => module.key === "semesters" || module.key === "academic-years"
      ? catalogIdentity(module.key, item)
      : module.key === "calendar"
        ? JSON.stringify(identityFields.calendar.map((key) => getValue(item, key) || (key === "semesterName" ? getValue(item, "semester") : "")))
        : (identityFields[module.key] ?? ["title"]).map((key) => getValue(item, key) || (key === "semesterName" ? getValue(item, "semester") : "")).join("|").toLocaleLowerCase("vi-VN");
    if (module.key === "grades") {
      const locked = existing.find((record) => record.data.locked === "true" && imported.some((item) => identity(record.data as Record<string, SpreadsheetValue>) === identity(item)));
      if (locked) throw new Error(`Điểm của ${String(locked.data.studentCode ?? "sinh viên")} đã khóa; hãy mở khóa trước khi nhập đè.`);
    }
    let added = 0; let updated = 0; const seen = new Set<string>();
    for (const item of imported) {
      const values: Record<string, string | number | null> = {};
      for (const field of transferFields) {
        const value = item[field.key]; if (value === undefined || value === null || value === "") continue;
        values[field.key] = typeof value === "number" ? value : String(value).trim();
      }
      if (module.key === "grades") {
        if (!values.studentGivenName && values.studentName) Object.assign(values, gradeNameParts({ studentName: values.studentName }));
        if (!values.studentGivenName && values.studentMiddleName) Object.assign(values, gradeNameParts({ studentName: values.studentMiddleName }));
        values.studentName = [values.studentMiddleName, values.studentGivenName].filter(Boolean).join(" ");
        if (!values.title) values.title = `${String(values.studentCode ?? "")} - ${String(values.studentName ?? "")}`.trim();
      }
      if (module.key === "grades") values.lecturer = GRADEBOOK_LECTURER;
      if (module.key === "calendar") {
        const from = String(values.fromPeriod ?? "").trim(); const to = String(values.toPeriod ?? "").trim();
        if (from && to) values.lessonPattern = `${from}-${to}`;
        const pattern = String(values.weekPattern ?? "");
        if (pattern) values.weekNumbers = [...pattern].flatMap((char, index) => char === "-" ? [] : [`T${index + 1}`]).join(" ");
      }
      const missing = module.fields.filter((field) => field.required && !String(values[field.key] ?? "").trim());
      if (missing.length) continue;
      const signature = identity(item);
      if (seen.has(signature)) continue; seen.add(signature);
      const found = existing.find((record) => identity(record.data as Record<string, SpreadsheetValue>) === signature);
      if (module.key === "grades" && found?.data.locked === "true") throw new Error(`Điểm của ${String(found.data.studentCode ?? "sinh viên")} đã khóa; hãy mở khóa trước khi nhập đè.`);
      const externalId = `spreadsheet:${module.key}:${encodeURIComponent(signature)}`;
      if (found) {
        await workspaceService.save(module.key, { ...found.data, ...values }, found.id, externalId); updated += 1;
      } else { await workspaceService.save(module.key, values, undefined, externalId); added += 1; }
    }
    if (!added && !updated) throw new Error("Không có dòng hợp lệ. Kiểm tra cột bắt buộc và tiêu đề cột.");
    setNotice(`Đã nhập ${added + updated} dòng (${added} thêm mới, ${updated} cập nhật).`); await load();
  }

  async function importSourceSchedule() {
    setSaving(true); setError(""); setNotice("");
    try { await importSpreadsheet(sourceTeachingSchedule as Array<Record<string, SpreadsheetValue>>); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể nhập lịch từ tệp nguồn."); }
    finally { setSaving(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (module.key === "grades" && edit?.data.locked === "true") { setError("Điểm đã khóa. Hãy mở khóa trước khi sửa."); return; }
    const formData = new FormData(event.currentTarget);
    const values = Object.fromEntries(module.fields.map((field) => [field.key, String(formData.get(field.key) ?? "").trim()]).filter(([, value]) => value !== "")) as Record<string, string>;
    if (module.key === "student-support") {
      if (!currentStudentCode || !currentStudentName) { setError("Tài khoản chưa được liên kết với hồ sơ sinh viên. Vui lòng liên hệ quản trị viên."); return; }
      values.studentCode = currentStudentCode;
      values.studentName = currentStudentName;
      if (!edit) values.status = "Mới";
      if (values.category === "Khác") {
        const customCategory = String(formData.get("categoryCustom") ?? "").trim();
        if (!customCategory) { setError("Vui lòng nhập loại hỗ trợ khác."); return; }
        values.category = customCategory;
      }
    }
    if (module.key === "tasks" && !edit) values.status = "Mới";
    if (module.key === "grades") { values.studentName = [values.studentMiddleName, values.studentGivenName].filter(Boolean).join(" "); values.title = `${values.studentCode ?? ""} - ${values.studentName || "Sinh viên"}`.trim(); values.lecturer = GRADEBOOK_LECTURER; }
    if (module.key === "calendar") {
      if (edit?.data.weekPattern) values.weekPattern = String(edit.data.weekPattern);
      if (values.fromPeriod && values.toPeriod) values.lessonPattern = `${values.fromPeriod}-${values.toPeriod}`;
    }
    const selectedSemester = String(formData.get("semesterName") ?? "").trim();
    if (module.key !== "semesters" && selectedSemester) values.semesterName = selectedSemester;
    if (module.key === "semesters" && values.weeks && (Number(values.weeks) < 1 || Number(values.weeks) > 60)) { setError("Thời lượng học kỳ phải từ 1 đến tối đa 60 tuần."); return; }
    if (module.key === "semesters" || module.key === "academic-years") {
      const identity = catalogIdentity(module.key, values);
      const duplicate = rows.find((row) => row.id !== edit?.id && catalogIdentity(module.key, row.data) === identity);
      if (duplicate) { setError(module.key === "semesters" ? "Học kỳ này đã tồn tại trong niên khóa đã chọn." : "Năm học này đã tồn tại."); return; }
    }
    setSaving(true); setError("");
    try {
      await workspaceService.save(module.key, values, edit?.id);
      if (module.key === "semesters" && values.title) window.dispatchEvent(new CustomEvent("vtn-semester-list-updated", { detail: values.title }));
      if (module.key === "calendar" || module.key === "timetables") window.dispatchEvent(new Event("vtn-semester-options-updated"));
      if (module.key === "semesters") {
        const currentSettings = await settingsService.get();
        const choosingCurrent = String(values.current ?? "").startsWith("C");
        if (choosingCurrent || currentSettings.current_semester === edit?.data.title) {
          const { error: semesterError } = await supabase!.rpc("set_current_semester", { p_name: choosingCurrent ? values.title : "" });
          if (semesterError) throw semesterError;
          window.dispatchEvent(new CustomEvent("vtn-system-settings-updated", { detail: { ...currentSettings, current_semester: choosingCurrent ? values.title : "" } }));
        }
      }
      setShowForm(false); setEdit(null); setNotice(edit ? "Đã cập nhật bản ghi." : "Đã thêm bản ghi."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể lưu dữ liệu."); }
    finally { setSaving(false); }
  }

  function applySemesterFilter(value: string) {
    const normalizedValue = value === "all" ? value : normalizeSemesterName(value);
    setSemesterFilter(normalizedValue);
    setPage(1);
    localStorage.setItem("vtn-active-semester", normalizedValue);
    window.dispatchEvent(new CustomEvent("vtn-semester-filter-changed", { detail: normalizedValue }));
  }

  async function syncTeachingPeriods() {
    if (!((module.key === "semesters" || module.key === "academic-years") && permissions.create && permissions.update && permissions.delete)) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const catalog = getTeachingPeriodCatalog();
      const desired = module.key === "academic-years" ? catalog.map((item) => item.year) : catalog.flatMap((item) => item.terms);
      let created = 0; let updated = 0; let merged = 0;
      for (const period of desired) {
        const identity = catalogIdentity(module.key, module.key === "academic-years" ? period : period);
        const matching = rows.filter((row) => catalogIdentity(module.key, row.data) === identity);
        const current = matching.some((row) => String(row.data.current ?? "").startsWith("C")) ? "Có" : "Không";
        const values = module.key === "academic-years"
          ? { ...(matching[0]?.data ?? {}), ...period, status: "Theo tiến độ đào tạo", notes: "Đồng bộ từ Kế hoạch giảng dạy." }
          : { ...(matching[0]?.data ?? {}), ...period, current, notes: "Đồng bộ từ Kế hoạch giảng dạy." };
        if (matching.length) {
          const survivor = [...matching].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
          await workspaceService.save(module.key, values, survivor.id);
          for (const duplicate of matching) if (duplicate.id !== survivor.id) { await workspaceService.moveToTrash(duplicate.id); merged += 1; }
          updated += 1;
        } else { await workspaceService.save(module.key, values); created += 1; }
      }
      setNotice(`Đã đồng bộ ${updated} bản ghi, tạo ${created} mới và gộp ${merged} bản trùng theo Kế hoạch giảng dạy.`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể đồng bộ theo Kế hoạch giảng dạy."); }
    finally { setSaving(false); }
  }

  async function importGradebookPdfs(files: FileList | null) {
    if (!files?.length || module.key !== "grades" || !permissions.import || !permissions.create || !permissions.update) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const extracted = (await Promise.all(Array.from(files, extractGradebookPdf))).flat();
      await importSpreadsheet(extracted);
      setNotice(`Đã trích xuất và nhập ${extracted.length} dòng từ ${files.length} tệp PDF.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể nhập bảng điểm từ tệp PDF."); }
    finally { setSaving(false); if (gradebookPdfInput.current) gradebookPdfInput.current.value = ""; }
  }

  async function toggleGradeLock(row: WorkspaceRecord) {
    const locked = row.data.locked === "true";
    try {
      await workspaceService.save("grades", { ...row.data, locked: locked ? "false" : "true", lockedAt: locked ? null : new Date().toISOString() }, row.id, row.external_id ?? undefined);
      setNotice(locked ? "Đã mở khóa điểm." : "Đã khóa điểm; bản ghi không thể sửa hoặc xóa cho đến khi mở khóa.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể cập nhật trạng thái khóa điểm."); }
  }

  async function changeTaskStatus(row: WorkspaceRecord, status: string) {
    setTaskStatusSavingId(row.id); setError("");
    try {
      const updated = await workspaceService.save("tasks", { ...row.data, status }, row.id, row.external_id ?? undefined);
      setRows((previous) => previous.map((item) => item.id === row.id ? updated : item));
      setNotice(`Đã cập nhật trạng thái công việc thành “${status}”.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không cập nhật được trạng thái công việc."); }
    finally { setTaskStatusSavingId(""); }
  }

  function exportGradePdf() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) { setError("Trình duyệt đã chặn cửa sổ xuất PDF. Hãy cho phép cửa sổ bật lên rồi thử lại."); return; }
    const escape = (value: unknown) => String(value ?? "—").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
    const exportFields = module.fields.filter((field) => !field.hidden && field.key !== "title");
    const header = ["Sinh viên", ...exportFields.map((field) => field.label)].map((label) => `<th>${escape(label)}</th>`).join("");
    const body = rows.map((row) => { const nameParts = gradeNameParts(row.data); return `<tr><td>${escape(recordName(row))}</td>${exportFields.map((field) => `<td>${escape(field.key === "lecturer" ? GRADEBOOK_LECTURER : field.key === "studentMiddleName" ? nameParts.studentMiddleName : field.key === "studentGivenName" ? nameParts.studentGivenName : row.data[field.key])}</td>`).join("")}</tr>`; }).join("");
    printWindow.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Sổ điểm</title><style>@page{size:A3 landscape;margin:12mm}body{font:11px Arial,sans-serif;color:#172554}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 12px;color:#475569}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:5px 6px;text-align:left}th{background:#edf3ff}tr:nth-child(even){background:#f8fafc}</style></head><body><h1>Sổ điểm</h1><p>${escape(rows.length)} bản ghi · Xuất ${escape(new Date().toLocaleString("vi-VN"))}</p><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></body></html>`);
    printWindow.document.close(); printWindow.focus(); window.setTimeout(() => printWindow.print(), 250);
  }

  async function moveToTrash(row: WorkspaceRecord) {
    if (module.key === "grades" && row.data.locked === "true") { setError("Điểm đã khóa. Hãy mở khóa trước khi xóa."); return; }
    if (!window.confirm(`Chuyển “${recordName(row)}” vào thùng rác?`)) return;
    try { await workspaceService.moveToTrash(row.id); setNotice("Đã chuyển vào thùng rác."); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể chuyển vào thùng rác."); }
  }

  async function askDocumentAssistant(question = documentAIQuestion) {
    const prompt = question.trim(); if (!prompt || documentAIBusy || !supabase) return;
    const previous = documentAIMessages;
    setDocumentAIMessages((items) => [...items, { role: "user", content: prompt }]); setDocumentAIQuestion(""); setDocumentAIBusy(true);
    const { data, error: invokeError } = await supabase.functions.invoke("academic-ai", { body: { action: "chat", question: prompt, webSearch: false, useGemini: true, messages: previous.slice(-8).map(({ role, content }) => ({ role, content })) } });
    setDocumentAIBusy(false);
    if (invokeError || data?.error) { setDocumentAIMessages((items) => [...items, { role: "assistant", content: data?.error ?? invokeError?.message ?? "Không thể kết nối trợ lý AI." }]); return; }
    setDocumentAIMessages((items) => [...items, { role: "assistant", content: String(data?.answer ?? "Chưa có câu trả lời."), citations: (data?.citations ?? []) as DocumentAssistantMessage["citations"] }]);
  }

  function openDocumentAssistant() {
    setDocumentAIOpen(true);
    void settingsService.get().then(setLecturerContact).catch(() => undefined);
  }

  const editData = isCalendar && edit ? calendarDisplayData(edit.data) : edit?.data;
  const editGradeName = module.key === "grades" ? gradeNameParts(editData) : null;
  const visibleFormFields = module.fields.filter((field) => !field.hidden && !(module.key === "grades" && field.key === "title") && !((module.key === "student-support" || module.key === "tasks") && field.key === "status" && !edit));
  const formFields = module.key === "student-support"
    ? ["title", "studentCode", "studentName", ...(edit ? ["status"] : []), "category", "priority", "notes"].flatMap((key) => visibleFormFields.filter((field) => field.key === key))
    : visibleFormFields;

  return <section className="workspace-page">
    <div className="workspace-title-row"><div><div className="workspace-breadcrumb">{module.group} <span>/</span> {module.title}</div><h1>{module.title}</h1><p>{module.description}</p></div><div className="workspace-title-actions">{isCalendar && permissions.import && permissions.create && permissions.update && <button type="button" disabled={saving} onClick={() => void importSourceSchedule()}>{saving ? "Đang nhập…" : "Nhập 9 tệp lịch giảng dạy"}</button>}{module.key === "grades" && permissions.import && permissions.create && permissions.update && <><input ref={gradebookPdfInput} hidden multiple type="file" accept="application/pdf,.pdf" onChange={(event) => void importGradebookPdfs(event.target.files)} /><button type="button" disabled={saving} onClick={() => gradebookPdfInput.current?.click()}>{saving ? "Đang nhập…" : "Nhập bảng điểm PDF"}</button></>}{module.key === "grades" && permissions.export && <button type="button" onClick={exportGradePdf}>Xuất PDF</button>}{(module.key === "semesters" || module.key === "academic-years") && permissions.create && permissions.update && permissions.delete && <button type="button" disabled={saving} onClick={() => void syncTeachingPeriods()}>Đồng bộ kế hoạch giảng dạy</button>}{module.key === "documents" && <button type="button" onClick={openDocumentAssistant}><Bot size={17} /> Hỏi trợ lý AI</button>}{permissions.create && <button className="workspace-primary" type="button" onClick={() => { setEdit(null); setShowForm(true); setNotice(""); }}><Plus size={17} /> Thêm mới</button>}</div></div>
    {isCalendar && <div className="workspace-notice" role="note">Tuần học giữ nguyên chuỗi ký tự trong tệp. Mỗi vị trí tương ứng một tuần của học kỳ; ký tự 1 đầu tiên là tuần 1 (tuần lịch 23), các ký tự 1 tiếp theo có thể là tuần 11, 21. Lịch có thể thay đổi theo thực tế.</div>}
    {error && <div className="workspace-alert" role="alert">{error}<button type="button" aria-label="Đóng thông báo" onClick={() => setError("")}><X size={16} /></button></div>}
    {notice && <div className="workspace-notice" role="status">{notice}</div>}
    {showForm && <form key={edit?.id ?? "new"} className="workspace-form" onSubmit={submit}>
      <div className="workspace-form-head"><h2>{edit ? "Chỉnh sửa" : "Thêm mới"} · {module.title}</h2><button type="button" aria-label="Đóng biểu mẫu" onClick={() => setShowForm(false)}><X size={18} /></button></div>
      <div className="workspace-form-grid">
        {module.key !== "semesters" && module.key !== "grades" && <label>Học kỳ áp dụng<select name="semesterName" value={appliedSemester} onChange={(event) => { setAppliedSemester(event.target.value); if (event.target.value) applySemesterFilter(event.target.value); }}><option value="">Không chọn học kỳ</option>{semesterGroups.map((group) => <optgroup key={group.academicYear} label={group.academicYear === "Khác" ? "Năm học chưa xác định" : `Năm học ${group.academicYear}`}>{group.semesters.map((name) => <option key={name} value={name}>{name}</option>)}</optgroup>)}</select></label>}
        {formFields.map((field) => {
          if (module.key === "student-support" && field.key === "studentCode") return <label key={field.key}>{field.label}<input name={field.key} value={currentStudentCode} readOnly required placeholder="Đang lấy mã sinh viên từ hồ sơ" /></label>;
          if (module.key === "student-support" && field.key === "studentName") return <label key={field.key}>{field.label}<input name={field.key} value={currentStudentName} readOnly required placeholder="Đang lấy họ tên từ hồ sơ" /></label>;
          if (module.key === "student-support" && field.key === "category") return <div className="workspace-support-category-field" key={field.key}><label>{field.label}<select name="category" value={supportCategoryChoice} onChange={(event) => setSupportCategoryChoice(event.target.value)}>{field.options?.map((option) => <option key={option}>{option}</option>)}</select></label>{supportCategoryChoice === "Khác" && <label>Loại hỗ trợ khác<input name="categoryCustom" defaultValue={field.options?.includes(String(editData?.category ?? "")) ? "" : String(editData?.category ?? "")} placeholder="Nhập loại hỗ trợ" required /></label>}</div>;
          if (field.key === "semesterName") return <label key={field.key}>{field.label}<select name={field.key} value={appliedSemester} onChange={(event) => { setAppliedSemester(event.target.value); if (event.target.value) applySemesterFilter(event.target.value); }}><option value="">Không chọn học kỳ</option>{semesterGroups.map((group) => <optgroup key={group.academicYear} label={group.academicYear === "Khác" ? "Năm học chưa xác định" : `Năm học ${group.academicYear}`}>{group.semesters.map((name) => <option key={name} value={name}>{name}</option>)}</optgroup>)}</select></label>;
          return <label key={field.key} className={field.kind === "textarea" ? "workspace-span" : ""}>{field.label}{field.kind === "textarea" ? <textarea name={field.key} rows={3} defaultValue={String(editData?.[field.key] ?? "")} required={field.required} /> : field.kind === "select" ? <select name={field.key} value={module.key === "student-support" && field.key === "category" ? supportCategoryChoice : undefined} defaultValue={module.key === "student-support" && field.key === "category" ? undefined : String(editData?.[field.key] ?? field.options?.[0] ?? "")} required={field.required} onChange={module.key === "student-support" && field.key === "category" ? (event) => setSupportCategoryChoice(event.target.value) : undefined}>{field.options?.map((option) => <option key={option}>{option}</option>)}</select> : <input name={field.key} type={field.kind ?? "text"} step={field.kind === "number" ? "any" : undefined} min={module.key === "semesters" && field.key === "weeks" ? 1 : undefined} max={module.key === "semesters" && field.key === "weeks" ? 60 : undefined} defaultValue={String(module.key === "grades" && field.key === "studentMiddleName" ? editGradeName?.studentMiddleName ?? "" : module.key === "grades" && field.key === "studentGivenName" ? editGradeName?.studentGivenName ?? "" : editData?.[field.key] ?? "")} required={field.required} />}</label>;
        })}
      </div>
      <div className="workspace-form-actions"><button className="workspace-primary" disabled={saving}>{saving ? "Đang lưu…" : "Lưu"}</button><button type="button" onClick={() => setShowForm(false)}>Hủy</button></div>
    </form>}
    { ["semesters", "academic-years", "calendar", "grades"].includes(module.key) && <SpreadsheetTransferPanel title={module.title} fields={transferFields} exportFields={transferExportFields} rows={rows.map((row) => module.key === "calendar" ? calendarDisplayData(row.data) : module.key === "grades" ? { ...row.data, ...gradeNameParts(row.data), lecturer: GRADEBOOK_LECTURER } : row.data)} canImport={permissions.import} canExport={permissions.export} onImport={importSpreadsheet} /> }
    {isCalendar && <div className="calendar-filter-panel"><label>Học kỳ<select value={semesterFilter} onChange={(event) => applySemesterFilter(event.target.value)}><option value="all">Tất cả học kỳ</option>{semesterGroups.map((group) => <optgroup key={group.academicYear} label={group.academicYear === "Khác" ? "Năm học chưa xác định" : `Năm học ${group.academicYear}`}>{group.semesters.map((semester) => <option key={semester} value={semester}>{semester}</option>)}</optgroup>)}</select></label><label>Lớp<select value={classFilter} onChange={(event) => { setClassFilter(event.target.value); setPage(1); }}><option value="all">Tất cả lớp</option>{classOptions.map((className) => <option key={className}>{className}</option>)}</select></label><label>Thứ<select value={weekdayFilter} onChange={(event) => { setWeekdayFilter(event.target.value); setPage(1); }}><option value="all">Tất cả các thứ</option>{weekdayOptions.map((weekday) => <option key={weekday}>{weekday}</option>)}</select></label><button type="button" onClick={() => { setSearch(""); applySemesterFilter("all"); setClassFilter("all"); setWeekdayFilter("all"); setPage(1); }}>Xóa bộ lọc</button></div>}
    <div className="workspace-toolbar"><label><Search size={17} /><input aria-label={`Tìm trong ${module.title}`} placeholder={isCalendar ? "Tìm nhanh mã LHP, tên môn, lớp, phòng…" : `Tìm trong ${module.title.toLowerCase()}…`} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label><span>{loading ? "Đang tải…" : `${visible.length} bản ghi`}</span></div>
    <div className="workspace-table-wrap"><table className={module.key === "grades" ? "gradebook-table" : undefined}><thead><tr>{isCalendar ? <>{columns.map((field) => <th key={field.key} aria-sort={sortState.key === field.key ? (sortState.direction === "asc" ? "ascending" : "descending") : "none"}><button className="calendar-sort-button" type="button" onClick={() => sortBy(field.key)}>{field.label.toLocaleUpperCase("vi-VN")}<span aria-hidden="true">{sortState.key === field.key ? sortState.direction === "asc" ? " ▲" : " ▼" : " ↕"}</span></button></th>)}<th aria-sort={sortState.key === "updated_at" ? (sortState.direction === "asc" ? "ascending" : "descending") : "none"}><button className="calendar-sort-button" type="button" onClick={() => sortBy("updated_at")}>CẬP NHẬT<span aria-hidden="true">{sortState.key === "updated_at" ? sortState.direction === "asc" ? " ▲" : " ▼" : " ↕"}</span></button></th><th>THAO TÁC</th></> : <>{module.key !== "grades" && <th>TÊN / TIÊU ĐỀ</th>}{columns.map((field) => <th key={field.key}>{field.label.toLocaleUpperCase("vi-VN")}</th>)}<th>CẬP NHẬT</th><th>THAO TÁC</th></>}</tr></thead><tbody>
      {loading && <tr><td className="workspace-state" colSpan={columns.length + (isCalendar || module.key === "grades" ? 2 : 3)}>Đang tải…</td></tr>}
      {!loading && !error && (isPaged ? pageRows : visible).map((row) => { const locked = module.key === "grades" && row.data.locked === "true"; return <tr key={row.id}>{!isCalendar && module.key !== "grades" && <td className="workspace-record-name">{recordName(row)}{locked && <span className="gradebook-lock-badge">Đã khóa</span>}</td>}{columns.map((field) => { const nameParts = module.key === "grades" ? gradeNameParts(row.data) : null; const value = isCalendar ? calendarDisplayData(row.data)[field.key] : module.key === "grades" && field.key === "lecturer" ? GRADEBOOK_LECTURER : module.key === "grades" && field.key === "studentMiddleName" ? nameParts?.studentMiddleName : module.key === "grades" && field.key === "studentGivenName" ? nameParts?.studentGivenName : row.data[field.key]; const leftAligned = module.key === "grades" && ["studentMiddleName", "studentGivenName", "lecturer", "notes"].includes(field.key); return <td className={leftAligned ? "gradebook-left-cell" : undefined} key={field.key}>{module.key === "tasks" && field.key === "status" && permissions.update ? <select className="workspace-inline-status-select" aria-label={`Trạng thái công việc ${recordName(row)}`} value={String(value || "Mới")} disabled={taskStatusSavingId === row.id} onChange={(event) => void changeTaskStatus(row, event.target.value)}>{field.options?.map((option) => <option key={option}>{option}</option>)}</select> : value !== undefined && value !== null && value !== "" ? field.kind === "date" ? formatDate(String(value)) : field.kind === "datetime-local" ? formatDateTime(String(value)) : String(value) : "—"}</td>; })}<td>{formatDate(row.updated_at)}</td><td><div className="workspace-row-actions">{module.key === "grades" && permissions.update && <button type="button" title={locked ? "Mở khóa điểm" : "Khóa điểm"} aria-label={`${locked ? "Mở khóa" : "Khóa"} điểm ${recordName(row)}`} onClick={() => void toggleGradeLock(row)}>{locked ? <Unlock size={16} /> : <Lock size={16} />}</button>}{permissions.update && !locked && <button type="button" title="Chỉnh sửa" aria-label={`Chỉnh sửa ${recordName(row)}`} onClick={() => { setEdit(row); setShowForm(true); }}><Edit3 size={16} /></button>}{permissions.delete && !locked && <button type="button" title="Chuyển vào thùng rác" aria-label={`Chuyển ${recordName(row)} vào thùng rác`} onClick={() => void moveToTrash(row)}><Trash2 size={16} /></button>}</div></td></tr>; })}
      {!loading && !error && !visible.length && <tr><td className="workspace-state" colSpan={columns.length + (isCalendar || module.key === "grades" ? 2 : 3)}><Archive size={22} /><strong>{search ? "Không tìm thấy kết quả" : "Chưa có dữ liệu"}</strong><span>{search ? "Hãy thử từ khóa khác." : "Thêm bản ghi đầu tiên để bắt đầu."}</span></td></tr>}
      {!loading && error && <tr><td className="workspace-state" colSpan={columns.length + (isCalendar || module.key === "grades" ? 2 : 3)}>Không thể hiển thị dữ liệu. <button type="button" onClick={() => void load()}>Thử tải lại</button></td></tr>}
    </tbody></table></div>
    {isPaged && <div className="workspace-pagination"><label>Số dòng<select value={pageSize} onChange={(event) => { setPageSize(event.target.value); setPage(1); }}><option value="10">10</option><option value="20">20</option><option value="50">50</option><option value="100">100</option><option value="all">Tất cả</option></select></label><span>{visible.length ? `Hiển thị ${(currentPage - 1) * (pageSize === "all" ? visible.length : Number(pageSize)) + 1}–${pageSize === "all" ? visible.length : Math.min(currentPage * Number(pageSize), visible.length)} / ${visible.length}` : "Không có dòng"}</span><div><button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Trước</button><span>Trang {currentPage} / {totalPages}</span><button type="button" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Sau</button></div></div>}
    {module.key === "documents" && documentAIOpen && <div className="document-ai-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDocumentAIOpen(false); }}><aside className="document-ai-drawer" role="dialog" aria-modal="true" aria-labelledby="document-ai-title"><header><div className="document-ai-title-icon"><Bot size={20} /></div><div><h2 id="document-ai-title">Trợ lý AI học vụ</h2><p>Gemini 2.5 Flash · trích dẫn tài liệu nguồn</p></div><button type="button" aria-label="Đóng trợ lý" onClick={() => setDocumentAIOpen(false)}><X size={18} /></button></header><div className="document-ai-quick-asks"><span><Sparkles size={14} /> Gợi ý nhanh</span>{["Tóm tắt đề cương môn học", "Điều kiện học lại và tích lũy tín chỉ", "Quy định về thời hạn đăng ký học phần"].map((question) => <button key={question} type="button" disabled={documentAIBusy} onClick={() => void askDocumentAssistant(question)}>{question}</button>)}</div><div className="document-ai-messages">{documentAIMessages.map((message, index) => <article className={`document-ai-message ${message.role}`} key={`${message.role}-${index}`}><span>{message.role === "assistant" ? <Bot size={15} /> : "Bạn"}</span><div><p>{message.content}</p>{message.citations?.length ? <div className="document-ai-citations">{message.citations.map((citation, citationIndex) => <a key={`${citation.code ?? citation.fileName ?? citation.url}-${citationIndex}`} href={citation.url || undefined} target={citation.url ? "_blank" : undefined} rel="noreferrer">{citation.code ? `[${citation.code}] ` : ""}{citation.title ?? citation.fileName ?? citation.url ?? "Nguồn"}</a>)}</div> : null}</div></article>)}{documentAIBusy && <p className="document-ai-thinking">Đang đối chiếu tài liệu học vụ…</p>}</div><form className="document-ai-compose" onSubmit={(event) => { event.preventDefault(); void askDocumentAssistant(); }}><textarea value={documentAIQuestion} onChange={(event) => setDocumentAIQuestion(event.target.value)} rows={2} placeholder="Nhập câu hỏi về tài liệu học vụ…" disabled={documentAIBusy} /><button className="workspace-primary" disabled={documentAIBusy || !documentAIQuestion.trim()}><Send size={16} /></button></form><div className="document-ai-contact"><ContactRound size={16} /><span><strong>Liên hệ giảng viên</strong><small>{String(lecturerContact.lecturer_name ?? "Chưa cấu hình")}{lecturerContact.lecturer_email ? ` · ${String(lecturerContact.lecturer_email)}` : ""}</small></span></div><small className="document-ai-source-note">Trợ lý tìm trong nguồn đã nạp tại mục Học vụ AI. Mã [DOC-xx] đối chiếu tên tài liệu được trích dẫn.</small></aside></div>}
  </section>;
}
