import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Archive, Bot, ContactRound, Database, Edit3, Eye, Filter, Lock, Plus, Search, Send, Sparkles, Star, Trash2, Unlock, X } from "lucide-react";
import type { ModuleDefinition } from "./module-definitions";
import { workspaceService, type WorkspaceRecord } from "./workspace.service";
import { settingsService } from "../settings/settings.service";
import { supabase } from "../../lib/supabase";
import { formatDate, formatDateTime } from "../../lib/date-format";
import { normalizeLecturer } from "../../lib/lecturer-format";
import { getSourceDataSection } from "../source-data/source-data.config";
import { sourceDataService, sourceValues } from "../source-data/source-data.service";
import { academicPeriodMatchesYear, academicYearFromSemester, formatSemesterLabel, groupAcademicPeriods, normalizeAcademicYear, normalizeSemesterName, semesterIdentity, semesterLabelIdentity, semesterMatchesSelection, uniqueAcademicYears } from "../../lib/semester-groups";
import { studentService } from "../students/student.service";
import type { Student } from "../students/student.types";
import SpreadsheetTransferPanel, { type SpreadsheetValue } from "./SpreadsheetTransferPanel";
import QuickFilterHeading from "./QuickFilterHeading";
import SearchableFilter from "../../components/SearchableFilter";
import TeachingWeekCalendar from "./TeachingWeekCalendar";
import { getTeachingPeriodCatalog } from "./teaching-plan-schedule-data";
import { extractGradebookPdf } from "./gradebook-pdf";
import { surveyService } from "./survey.service";
import { buildTimetableRows, toTimetableWeekRecords } from "../timetable/timetable-week-data";
import { SortableTableHeader } from "../../components/SortableTableHeader";
import { sortTableRows } from "../../lib/table-sort";
import "./workspace.css";

function recordName(record: WorkspaceRecord) {
  return String(record.data.title ?? record.data.listName ?? record.data.classCode ?? record.data.subjectCode
    ?? (record.data.studentCode ? `${record.data.studentCode} - ${record.data.studentName ?? "Sinh viên"}` : "Bản ghi"));
}
const GRADEBOOK_LECTURER = "01011090 - Vũ Trung Nghĩa";

function GradebookHistoryPanel({ records }: { records: WorkspaceRecord[] }) {
  const [sortState, setSortState] = useState({ key: "ordinal", direction: "asc" as "asc" | "desc" });
  const courses = records
    .filter((record) => {
      const lecturer = String(record.data.lecturer ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("vi-VN");
      return !lecturer || lecturer.includes("01011090") || lecturer.includes("vu trung nghia");
    });
  const sortedCourses = sortTableRows(courses, sortState, (course, key, index) => key === "ordinal" ? index : course.data[key]);
  function sortBy(key: string) {
    setSortState((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" });
  }

  return <section className="gradebook-history">
    <div className="gradebook-history-heading"><div><h3>Lịch sử theo học</h3><p>Lịch sử theo học với ThS. Vũ Trung Nghĩa</p><span>Giảng viên: {GRADEBOOK_LECTURER}</span></div><span className="gradebook-history-count">Tổng cộng: {courses.length} môn</span></div>
    {courses.length ? <div className="gradebook-history-table-wrap"><table><thead><tr><SortableTableHeader label="STT" sortKey="ordinal" sortState={sortState} onSort={sortBy} /><SortableTableHeader label="Mã lớp học phần" sortKey="courseCode" sortState={sortState} onSort={sortBy} /><SortableTableHeader label="Môn học" sortKey="courseName" sortState={sortState} onSort={sortBy} /><SortableTableHeader label="Lớp" sortKey="className" sortState={sortState} onSort={sortBy} /><SortableTableHeader label="Học kỳ" sortKey="semesterName" sortState={sortState} onSort={sortBy} /><SortableTableHeader label="Năm học" sortKey="academicYear" sortState={sortState} onSort={sortBy} /><SortableTableHeader label="Số tín chỉ" sortKey="credits" sortState={sortState} onSort={sortBy} /><SortableTableHeader label="ĐIỂM TỔNG KẾT HỆ 10" sortKey="totalScore10" sortState={sortState} onSort={sortBy} /><SortableTableHeader label="ĐIỂM CHỮ" sortKey="letterGrade" sortState={sortState} onSort={sortBy} /><SortableTableHeader label="XẾP LOẠI" sortKey="classification" sortState={sortState} onSort={sortBy} /></tr></thead><tbody>{sortedCourses.map((course, index) => <tr key={course.id}>
      <td>{index + 1}</td><td>{course.data.courseCode || "—"}</td><td className="gradebook-history-course-name">{course.data.courseName || "—"}</td><td>{course.data.className || "—"}</td><td>{formatSemesterLabel(course.data.semesterName ?? course.data.semester, course.data.academicYear) || "—"}</td><td>{course.data.academicYear || "—"}</td><td>{course.data.credits ?? "—"}</td><td className="gradebook-history-score">{course.data.totalScore10 ?? "—"}</td><td className="gradebook-history-score">{course.data.letterGrade || "—"}</td><td>{course.data.classification || "—"}</td>
    </tr>)}</tbody></table></div> : <p>Chưa tìm thấy bản ghi trong Sổ điểm cho sinh viên này với giảng viên ThS. Vũ Trung Nghĩa.</p>}
  </section>;
}

function GradebookResultsPanel({ records, fields }: { records: WorkspaceRecord[]; fields: ModuleDefinition["fields"] }) {
  const columns = fields.filter((field) => !field.hidden && field.key !== "title");
  const sortedRecords = [...records].sort((left, right) =>
    String(left.data.courseName ?? "").localeCompare(String(right.data.courseName ?? ""), "vi", { sensitivity: "base", numeric: true })
      || String(left.data.courseCode ?? "").localeCompare(String(right.data.courseCode ?? ""), "vi", { sensitivity: "base", numeric: true })
      || String(left.data.semesterName ?? left.data.semester ?? "").localeCompare(String(right.data.semesterName ?? right.data.semester ?? ""), "vi", { sensitivity: "base", numeric: true }),
  );

  return <section className="gradebook-history gradebook-results-panel">
    <div className="gradebook-history-heading"><div><h3>Bảng kết quả học tập</h3><p>Các học phần được sắp xếp theo tên môn học.</p></div><span className="gradebook-history-count">Tổng cộng: {sortedRecords.length} học phần</span></div>
    {sortedRecords.length ? <div className="gradebook-results-list">{sortedRecords.map((record, index) => <article className="gradebook-result-card" key={record.id}>
      <h4>{String(record.data.courseName ?? "").trim() || String(record.data.courseCode ?? "").trim() || `Học phần ${index + 1}`}</h4>
      <dl>{columns.map((field) => {
        const nameParts = gradeNameParts(record.data);
        const value = field.key === "ordinal" ? index + 1
          : field.key === "studentMiddleName" ? nameParts.studentMiddleName
            : field.key === "studentGivenName" ? nameParts.studentGivenName
              : field.key === "lecturer" ? GRADEBOOK_LECTURER
                : record.data[field.key];
        const text = field.key === "semesterName" ? formatSemesterLabel(record.data.semesterName ?? record.data.semester, record.data.academicYear) : value === undefined || value === null ? "" : String(value);
        return <div key={field.key}><dt>{field.label}</dt><dd>{text.trim() ? field.kind === "date" ? formatDate(text) : field.kind === "datetime-local" ? formatDateTime(text) : text : "—"}</dd></div>;
      })}<div><dt>Cập nhật</dt><dd>{formatDate(record.updated_at)}</dd></div></dl>
    </article>)}</div> : <p>Chưa tìm thấy kết quả học tập của sinh viên trong Sổ điểm.</p>}
  </section>;
}
type WorkspaceFilterSpec = { key: string; label: string; options?: string[] };
type GradeStudentCourseEntry = { studentName: string; className: string; courseCode: string; courseName: string; semesterName: string };
type GradeStudentCourseSummary = { studentCode: string; courses: GradeStudentCourseEntry[] };
const workspaceFilterSpecs: Record<string, WorkspaceFilterSpec[]> = {
  "academic-years": [
    { key: "title", label: "Năm học" },
    { key: "academicPeriod", label: "Thời gian", options: ["Đang diễn ra", "Sắp bắt đầu", "Đã kết thúc", "Chưa xác định"] },
    { key: "startDate", label: "Ngày bắt đầu" },
    { key: "endDate", label: "Ngày kết thúc" },
  ],
  semesters: [
    { key: "academicYear", label: "Năm học" },
    { key: "title", label: "Học kỳ" },
    { key: "startDate", label: "Ngày bắt đầu" },
    { key: "endDate", label: "Ngày kết thúc" },
  ],
  grades: [
    { key: "academicYear", label: "Năm học" },
    { key: "semesterName", label: "Học kỳ" },
    { key: "courseName", label: "Tên học phần" },
    { key: "totalScore10", label: "Điểm tổng kết hệ 10" },
    { key: "classification", label: "Xếp loại" },
    { key: "locked", label: "Trạng thái điểm", options: ["Đã khóa", "Chưa khóa"] },
  ],
  tasks: [
    { key: "status", label: "Trạng thái" },
    { key: "priority", label: "Mức độ ưu tiên" },
    { key: "dueState", label: "Hạn công việc", options: ["Quá hạn", "Hôm nay", "Sắp tới", "Chưa đặt hạn"] },
  ],
  "student-support": [
    { key: "semesterName", label: "Học kỳ" },
    { key: "status", label: "Trạng thái" },
    { key: "category", label: "Loại hỗ trợ" },
    { key: "priority", label: "Mức độ ưu tiên" },
  ],
  documents: [
    { key: "semesterName", label: "Học kỳ" },
    { key: "category", label: "Danh mục" },
    { key: "subject", label: "Môn học" },
  ],
  surveys: [
    { key: "semesterName", label: "Học kỳ" },
    { key: "status", label: "Trạng thái" },
    { key: "audience", label: "Đối tượng" },
    { key: "dueState", label: "Hạn khảo sát", options: ["Quá hạn", "Hôm nay", "Sắp tới", "Chưa đặt hạn"] },
  ],
  announcements: [
    { key: "status", label: "Trạng thái" },
    { key: "audience", label: "Đối tượng" },
    { key: "dueState", label: "Thời hạn", options: ["Quá hạn", "Hôm nay", "Sắp tới", "Chưa đặt hạn"] },
  ],
  "forms-templates": [
    { key: "category", label: "Loại biểu mẫu" },
    { key: "status", label: "Trạng thái" },
  ],
};

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function workspaceFilterValue(row: WorkspaceRecord, key: string) {
  const data = row.data;
  if (key === "academicPeriod") {
    const today = localDateKey(new Date());
    const start = String(data.startDate ?? "").slice(0, 10);
    const end = String(data.endDate ?? "").slice(0, 10);
    if (!start && !end) return "Chưa xác định";
    if (start && today < start) return "Sắp bắt đầu";
    if (end && today > end) return "Đã kết thúc";
    return "Đang diễn ra";
  }
  if (key === "dueState") {
    const dueDate = String(data.dueDate ?? "").slice(0, 10);
    if (!dueDate) return "Chưa đặt hạn";
    const today = localDateKey(new Date());
    return dueDate < today ? "Quá hạn" : dueDate === today ? "Hôm nay" : "Sắp tới";
  }
  if (key === "semesterName") return formatSemesterLabel(data.semesterName ?? data.semester, data.academicYear);
  if (key === "title" && data.academicYear) return formatSemesterLabel(data.title, data.academicYear);
  if (key === "current") {
    const current = String(data.current ?? "").trim().toLocaleLowerCase("vi-VN");
    return ["có", "true", "1", "yes"].includes(current) ? "Học kỳ hiện hành" : "Học kỳ khác";
  }
  if (key === "locked") return String(data.locked ?? "").toLocaleLowerCase("vi-VN") === "true" ? "Đã khóa" : "Chưa khóa";
  return String(data[key] ?? "").trim();
}

function normalizeFilterText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("vi-VN").trim();
}

function gradeNameParts(data: Record<string, unknown> | undefined) {
  const studentGivenName = String(data?.studentGivenName ?? "").trim();
  const studentMiddleName = String(data?.studentMiddleName ?? "").trim();
  if (studentGivenName || studentMiddleName) return { studentMiddleName, studentGivenName };
  const words = String(data?.studentName ?? "").trim().split(/\s+/).filter(Boolean);
  return { studentMiddleName: words.slice(0, -1).join(" "), studentGivenName: words[words.length - 1] ?? "" };
}

function studentProfileSourceValue(student: Student | null, detailKey: string, ...sourceKeys: string[]) {
  if (!student?.notes) return "";
  try {
    const parsed = JSON.parse(student.notes) as { details?: Record<string, string>; sourceData?: Record<string, string> };
    const detail = String(parsed.details?.[detailKey] ?? "").trim();
    if (detail) return detail;
    const wanted = new Set(sourceKeys.map(normalizeFilterText));
    return Object.entries(parsed.sourceData ?? {}).find(([key]) => wanted.has(normalizeFilterText(key)))?.[1] ?? "";
  } catch {
    return "";
  }
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

function renderCalendarWeekdayTag(value: unknown) {
  const raw = String(value ?? "").trim();
  const normalized = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("vi-VN");
  const day = /chu nhat|sunday|^cn$/.test(normalized) ? "8" : raw.match(/\d+/)?.[0] ?? "";
  const label = day === "8" ? "Chủ nhật" : day ? `Thứ ${day}` : raw || "—";
  return <span className={`calendar-weekday-tag calendar-weekday-${day || "other"}`}>{label}</span>;
}

function renderCalendarWeekNumberTags(value: unknown) {
  const values = Array.isArray(value) ? value.flatMap((item) => String(item).match(/\d+/g) ?? []) : String(value ?? "").match(/\d+/g) ?? [];
  const weeks = [...new Set(values.map(Number).filter((week) => week > 0))].sort((left, right) => left - right);
  return weeks.length ? <div className="calendar-week-number-tags">{weeks.map((week) => <span className="calendar-week-number-tag" key={week}>T{week}</span>)}</div> : <span>—</span>;
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

export default function WorkspaceModulePage({ module, role = "", permissions = { create: true, update: true, delete: true, import: true, export: true }, tabPermissions = { calendarList: true, calendarWeek: true, gradeProfile: true, gradeResults: true, gradeHistory: true } }: { module: ModuleDefinition; role?: string; permissions?: { create: boolean; update: boolean; delete: boolean; import: boolean; export: boolean }; tabPermissions?: { calendarList: boolean; calendarWeek: boolean; gradeProfile: boolean; gradeResults: boolean; gradeHistory: boolean } }) {
  const canAnswerSurveys = ["student", "class_president", "class_vice"].includes(role);
  type DocumentAssistantMessage = { role: "user" | "assistant"; content: string; citations?: Array<{ code?: string; title?: string; fileName?: string; url?: string }> };
  const [rows, setRows] = useState<WorkspaceRecord[]>([]);
  const [timetableStoredRows, setTimetableStoredRows] = useState<WorkspaceRecord[]>([]);
  const [search, setSearch] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [edit, setEdit] = useState<WorkspaceRecord | null>(null);
  const [viewRecord, setViewRecord] = useState<WorkspaceRecord | null>(null);
  const [gradeDetail, setGradeDetail] = useState<WorkspaceRecord | null>(null);
  const [gradeStudentProfile, setGradeStudentProfile] = useState<Student | null>(null);
  const [gradeDetailTab, setGradeDetailTab] = useState<"profile" | "results" | "courses">("profile");
  const [gradeStudentCourseSummaries, setGradeStudentCourseSummaries] = useState<GradeStudentCourseSummary[] | null>(null);
  const [gradeDuplicateCheckBusy, setGradeDuplicateCheckBusy] = useState(false);
  const [selectedGradeIds, setSelectedGradeIds] = useState<string[]>([]);
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
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
  const [sharedAcademicPeriods, setSharedAcademicPeriods] = useState<Array<{ academicYear: string; semesterName: string }>>([]);
  const [calendarAcademicYearFilter, setCalendarAcademicYearFilter] = useState("all");
  const [appliedSemester, setAppliedSemester] = useState("");
  const [supportCategoryChoice, setSupportCategoryChoice] = useState("");
  const [currentStudentCode, setCurrentStudentCode] = useState("");
  const [currentStudentName, setCurrentStudentName] = useState("");
  const [taskStatusSavingId, setTaskStatusSavingId] = useState("");
  const [mySurveyRatings, setMySurveyRatings] = useState<Record<string, number>>({});
  const [activeSurvey, setActiveSurvey] = useState<WorkspaceRecord | null>(null);
  const [surveyRating, setSurveyRating] = useState(5);
  const [surveySubmitting, setSurveySubmitting] = useState(false);
  const [classFilter, setClassFilter] = useState("all");
  const [courseFilter, setCourseFilter] = useState("all");
  const [calendarView, setCalendarView] = useState<"list" | "week">("list");
  const [sortState, setSortState] = useState({ key: "ordinal", direction: "asc" as "asc" | "desc" });
  const [pageSize, setPageSize] = useState("10");
  const [page, setPage] = useState(1);
  const gradebookPdfInput = useRef<HTMLInputElement>(null);
  const isCalendar = module.key === "calendar";
  const availableGradeDetailTabs = [
    ...(tabPermissions.gradeProfile ? ["profile" as const] : []),
    ...(tabPermissions.gradeResults ? ["results" as const] : []),
    ...(tabPermissions.gradeHistory ? ["courses" as const] : []),
  ];
  const canViewGradeDetail = availableGradeDetailTabs.length > 0;
  const activeGradeDetailTab = availableGradeDetailTabs.includes(gradeDetailTab) ? gradeDetailTab : availableGradeDetailTabs[0] ?? null;
  const activeCalendarView = tabPermissions.calendarList ? calendarView === "week" && tabPermissions.calendarWeek ? "week" : "list" : tabPermissions.calendarWeek ? "week" : "none";
  const isAcademicYears = module.key === "academic-years";
  const isSemesters = module.key === "semesters";
  const isPaged = !(module.key === "surveys" && canAnswerSurveys);
  const configuredFilterSpecs = workspaceFilterSpecs[module.key] ?? [];
  const filterSpecs = configuredFilterSpecs.some((spec) => spec.key === "semesterName") && !configuredFilterSpecs.some((spec) => spec.key === "academicYear")
    ? [{ key: "academicYear", label: "Năm học" }, ...configuredFilterSpecs]
    : configuredFilterSpecs;

  useEffect(() => { setFilterValues({}); setSearch(""); setPage(1); setGradeDetail(null); setViewRecord(null); setShowForm(false); setEdit(null); setSelectedGradeIds([]); setSelectedRecordIds([]); setGradeStudentCourseSummaries(null); setCalendarView("list"); setActiveSurvey(null); setMySurveyRatings({}); }, [module.key]);

  const load = useCallback(async () => {
    setLoading(true); setError(""); setGradeStudentCourseSummaries(null);
    try {
      const [records, timetableRecords] = await Promise.all([
        workspaceService.list(module.key),
        module.key === "calendar" ? workspaceService.allRecords() : Promise.resolve([]),
      ]);
      setRows(module.key === "academic-years" ? records.map(normalizeAcademicYearRow) : records);
      setTimetableStoredRows(timetableRecords.filter((record) => record.module_key === "timetables"));
      if (module.key === "surveys") {
        try { setMySurveyRatings(await surveyService.myRatings(records.map((record) => record.id))); }
        catch { setMySurveyRatings({}); }
      }
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể tải dữ liệu."); }
    finally { setLoading(false); }
  }, [module.key]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!gradeDetail) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setGradeDetail(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [gradeDetail]);
  useEffect(() => {
    if (!gradeDetail || module.key !== "grades" || activeGradeDetailTab !== "profile") { setGradeStudentProfile(null); return; }
    let active = true;
    setGradeStudentProfile(null);
    const normalize = (value: unknown) => String(value ?? "").normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("vi-VN");
    const studentCode = normalize(gradeDetail.data.studentCode);
    void studentService.list().then((profiles) => {
      if (active) setGradeStudentProfile(profiles.find((profile) => normalize(profile.studentCode) === studentCode) ?? null);
    }).catch(() => { if (active) setGradeStudentProfile(null); });
    return () => { active = false; };
  }, [gradeDetail, module.key, activeGradeDetailTab]);
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
        setTimetableStoredRows(records.filter((record) => record.module_key === "timetables"));
        const rawNames = [...semesters.map((row) => formatSemesterLabel(row.data.title, row.data.academicYear)), ...students.map((student) => student.semesterName), ...records.filter((record) => record.module_key === "calendar" || record.module_key === "timetables").map((record) => formatSemesterLabel(record.data.semesterName ?? record.data.semester ?? record.data.round, record.data.academicYear)), String(settings.current_semester ?? "")];
        const unique = new Map<string, string>();
        for (const rawName of rawNames) { const name = normalizeSemesterName(rawName); if (name && !unique.has(semesterIdentity(name))) unique.set(semesterIdentity(name), name); }
        setSharedSemesterNames([...unique.values()]);
        setSharedAcademicPeriods(semesters.map((row) => ({ academicYear: String(row.data.academicYear ?? ""), semesterName: String(row.data.title ?? "") })).filter((period) => period.semesterName));
      } catch { /* Keep the form usable with the options already loaded. */ }
    };
    void refresh();
    window.addEventListener("vtn-semester-list-updated", refresh);
    window.addEventListener("vtn-semester-options-updated", refresh);
    window.addEventListener("vtn-timetable-list-updated", refresh);
    window.addEventListener("vtn-students-updated", refresh);
    window.addEventListener("vtn-system-settings-updated", refresh);
    return () => { active = false; window.removeEventListener("vtn-semester-list-updated", refresh); window.removeEventListener("vtn-semester-options-updated", refresh); window.removeEventListener("vtn-timetable-list-updated", refresh); window.removeEventListener("vtn-students-updated", refresh); window.removeEventListener("vtn-system-settings-updated", refresh); };
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

  const timetableWeekSourceRecords = useMemo(() => toTimetableWeekRecords(buildTimetableRows(timetableStoredRows)), [timetableStoredRows]);
  const gradebookTimetablePeriods = useMemo(() => {
    const unique = new Map<string, { academicYear: string; semesterName: string }>();
    for (const record of timetableWeekSourceRecords) {
      const rawSemester = String(record.data.semesterName ?? record.data.semester ?? "");
      const academicYear = String(record.data.academicYear ?? "") || academicYearFromSemester(rawSemester);
      const semesterName = formatSemesterLabel(rawSemester, academicYear);
      const identity = semesterIdentity(semesterName);
      if (identity) unique.set(identity, { academicYear, semesterName });
    }
    return [...unique.values()];
  }, [timetableWeekSourceRecords]);
  const moduleAcademicPeriods = useMemo(() => [
    ...sharedAcademicPeriods,
    ...gradebookTimetablePeriods,
    ...rows.map((row) => {
      const semesterName = String(row.data.semesterName ?? row.data.semester ?? row.data.round ?? (module.key === "semesters" ? row.data.title : ""));
      return { academicYear: String(row.data.academicYear ?? "") || academicYearFromSemester(semesterName), semesterName };
    }),
  ].filter((period) => period.semesterName), [sharedAcademicPeriods, gradebookTimetablePeriods, rows, module.key]);
  const matchesFilter = (row: WorkspaceRecord, spec: WorkspaceFilterSpec, selected: string) => {
    if (!selected) return true;
    const value = workspaceFilterValue(row, spec.key);
    if (spec.key === "academicYear") {
      const semesterName = String(row.data.semesterName ?? row.data.semester ?? row.data.round ?? (module.key === "semesters" ? row.data.title : ""));
      return academicPeriodMatchesYear(semesterName, value, selected, moduleAcademicPeriods);
    }
    if (spec.key === "semesterName" || (module.key === "semesters" && spec.key === "title")) {
      return semesterMatchesSelection(value, String(row.data.academicYear ?? ""), selected);
    }
    return normalizeFilterText(value) === normalizeFilterText(selected);
  };
  const filterOptions = useMemo(() => Object.fromEntries(filterSpecs.map((spec) => {
    const candidates = rows.filter((row) => filterSpecs.filter((other) => other.key !== spec.key).every((other) => matchesFilter(row, other, filterValues[other.key] ?? "")));
    const candidateTerms = candidates.map((row) => workspaceFilterValue(row, spec.key === "title" && module.key === "semesters" ? "title" : "semesterName")).filter(Boolean);
    const gradebookPeriodChoices = module.key === "grades" ? (() => {
      const matchingPeriods = new Set(candidates.map((row) => {
        const semesterName = String(row.data.semesterName ?? row.data.semester ?? "");
        const academicYear = String(row.data.academicYear ?? "") || academicYearFromSemester(semesterName);
        return semesterIdentity(formatSemesterLabel(semesterName, academicYear));
      }).filter(Boolean));
      return gradebookTimetablePeriods.filter((period) => matchingPeriods.has(semesterIdentity(period.semesterName)));
    })() : [];
    let options: string[];
    if (spec.key === "academicYear") {
      if (module.key === "grades") {
        options = uniqueAcademicYears(gradebookPeriodChoices.map((period) => period.academicYear));
      } else {
        const candidatePeriods = candidates.map((row) => {
          const semesterName = String(row.data.semesterName ?? row.data.semester ?? row.data.round ?? (module.key === "semesters" ? row.data.title : ""));
          return { academicYear: String(row.data.academicYear ?? "") || academicYearFromSemester(semesterName), semesterName };
        });
        const termKeys = new Set(candidatePeriods.map((period) => semesterLabelIdentity(period.semesterName)).filter(Boolean));
        options = uniqueAcademicYears([...candidatePeriods.map((period) => period.academicYear), ...moduleAcademicPeriods.filter((period) => termKeys.has(semesterLabelIdentity(period.semesterName))).map((period) => period.academicYear)]);
      }
    } else if (module.key === "semesters" && spec.key === "title") {
      const semesterOptions = candidates.map((row) => {
        const title = String(row.data.title ?? "");
        const year = String(row.data.academicYear ?? "") || academicYearFromSemester(title);
        const label = formatSemesterLabel(title, year);
        return [semesterIdentity(label) || label.toLocaleLowerCase("vi-VN"), label] as const;
      }).filter(([, label]) => Boolean(label));
      options = [...new Map<string, string>(semesterOptions).values()]
        .sort((a, b) => a.localeCompare(b, "vi", { numeric: true, sensitivity: "base" }));
    } else if (spec.key === "semesterName") {
      if (module.key === "grades") {
        const yearSelection = filterValues.academicYear ?? "";
        options = [...new Map(gradebookPeriodChoices
          .filter((period) => !yearSelection || normalizeAcademicYear(period.academicYear) === normalizeAcademicYear(yearSelection))
          .map((period) => [semesterIdentity(period.semesterName), period.semesterName])).values()]
          .sort((a, b) => a.localeCompare(b, "vi", { numeric: true, sensitivity: "base" }));
      } else {
        const candidateKeys = new Set(candidateTerms.map(semesterLabelIdentity).filter(Boolean));
        const yearSelection = filterValues.academicYear ?? "";
        const relatedTerms = moduleAcademicPeriods.filter((period) => candidateKeys.has(semesterLabelIdentity(period.semesterName))
          && (!yearSelection || normalizeAcademicYear(period.academicYear) === normalizeAcademicYear(yearSelection))).map((period) => period.semesterName);
        options = [...new Map([...candidateTerms, ...relatedTerms].map((term) => [semesterLabelIdentity(term) || term.toLocaleLowerCase("vi-VN"), term])).values()]
          .sort((a, b) => a.localeCompare(b, "vi", { numeric: true, sensitivity: "base" }));
      }
    } else {
      options = spec.options ?? [...new Set(candidates.map((row) => workspaceFilterValue(row, spec.key)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi", { numeric: true, sensitivity: "base" }));
    }
    return [spec.key, options];
  })), [filterSpecs, filterValues, rows, module.key, moduleAcademicPeriods, gradebookTimetablePeriods]);
  const groupedGradebookSemesterOptions = module.key === "grades"
    ? groupAcademicPeriods((filterOptions.semesterName ?? []).map((semesterName) => ({ academicYear: academicYearFromSemester(semesterName), semesterName })))
    : [];
  const activeFilterCount = Object.values(filterValues).filter(Boolean).length;
  const calendarAcademicPeriods = useMemo(() => [...sharedAcademicPeriods, ...rows.map((row) => {
    const semesterName = String(row.data.semesterName ?? row.data.semester ?? row.data.round ?? "");
    return { academicYear: String(row.data.academicYear ?? "") || academicYearFromSemester(semesterName), semesterName };
  }), ...timetableWeekSourceRecords.map((row) => ({ academicYear: String(row.data.academicYear ?? ""), semesterName: String(row.data.semesterName ?? row.data.semester ?? "") }))].filter((period) => period.semesterName), [sharedAcademicPeriods, rows, timetableWeekSourceRecords]);
  const calendarSemesterGroups = groupAcademicPeriods(calendarAcademicPeriods);
  const visibleCalendarSemesterGroups = calendarAcademicYearFilter === "all" ? calendarSemesterGroups : calendarSemesterGroups.filter((group) => normalizeAcademicYear(group.academicYear) === normalizeAcademicYear(calendarAcademicYearFilter));
  const calendarAcademicYearOptions = uniqueAcademicYears(calendarAcademicPeriods.map((period) => period.academicYear));
  const calendarWeekRecords = useMemo(() => {
    const needle = normalizeFilterText(search);
    return timetableWeekSourceRecords.filter((record) => {
      const rowSemester = normalizeSemesterName(String(record.data.semesterName ?? record.data.semester ?? ""));
      const matchesSemester = semesterFilter === "all" || !rowSemester || semesterMatchesSelection(rowSemester, record.data.academicYear, semesterFilter);
      const matchesYear = calendarAcademicYearFilter === "all" || academicPeriodMatchesYear(rowSemester, record.data.academicYear, calendarAcademicYearFilter, calendarAcademicPeriods);
      const matchesClass = classFilter === "all" || String(record.data.className ?? record.data.classCode ?? "") === classFilter;
      const matchesCourse = courseFilter === "all" || String(record.data.title ?? record.data.subjectName ?? record.data.courseName ?? "") === courseFilter;
      return matchesYear && matchesSemester && matchesClass && matchesCourse && normalizeFilterText(JSON.stringify(record.data)).includes(needle);
    });
  }, [timetableWeekSourceRecords, search, semesterFilter, calendarAcademicYearFilter, calendarAcademicPeriods, classFilter, courseFilter]);
  const visible = useMemo(() => {
    const needle = normalizeFilterText(search);
    const filtered = rows.filter((row) => {
      const rowSemester = normalizeSemesterName(String(row.data.semesterName ?? row.data.semester ?? (module.key === "semesters" ? row.data.title : "")));
      const matchesSemester = semesterFilter === "all" || !rowSemester || semesterMatchesSelection(rowSemester, row.data.academicYear, semesterFilter);
      const matchesYear = isCalendar && calendarAcademicYearFilter !== "all"
        ? academicPeriodMatchesYear(rowSemester, row.data.academicYear, calendarAcademicYearFilter, calendarAcademicPeriods)
        : true;
      const matchesClass = !isCalendar || classFilter === "all" || String(row.data.className ?? "") === classFilter;
      const matchesCourse = !isCalendar || courseFilter === "all" || String(row.data.title ?? "") === courseFilter;
      const matchesModuleFilters = filterSpecs.every((spec) => {
        const selected = filterValues[spec.key];
        if (!selected) return true;
        return matchesFilter(row, spec, selected);
      });
      const searchData = { ...(isCalendar ? calendarDisplayData(row.data) : row.data) }; delete searchData.ordinal; const haystack = normalizeFilterText(JSON.stringify(searchData));
      return matchesYear && matchesSemester && matchesClass && matchesCourse && matchesModuleFilters && haystack.includes(needle);
    });
    let source = filtered;
    if (!isCalendar && (module.key === "semesters" || module.key === "academic-years")) {
      source = [...new Map([...filtered].reverse().map((row) => [catalogIdentity(module.key, row.data), row])).values()];
      if (sortState.key === "ordinal") {
        return source.sort((a, b) => {
          const endA = String(a.data.endDate ?? "");
          const endB = String(b.data.endDate ?? "");
          if (!endA) return endB ? 1 : 0;
          if (!endB) return -1;
          return endB.localeCompare(endA) || recordName(a).localeCompare(recordName(b), "vi");
        });
      }
    }
    const order = new Map(source.map((row, index) => [row.id, index] as const));
    return sortTableRows(source, sortState, (row, key) => key === "ordinal" ? order.get(row.id) : key === "__name" ? recordName(row) : key === "updated_at" ? row.updated_at : (isCalendar ? calendarDisplayData(row.data) : row.data)[key]);
  }, [rows, search, semesterFilter, calendarAcademicYearFilter, calendarAcademicPeriods, module.key, isCalendar, classFilter, courseFilter, sortState, filterSpecs, filterValues]);
  const columns = isCalendar ? module.fields.filter((field) => !field.hidden) : module.key === "grades" ? module.fields.filter((field) => !field.hidden && field.key !== "title") : module.fields.filter((field) => !field.hidden && !["title", "listName", "items", "notes"].includes(field.key)).slice(0, 3);
  const transferFields = [ ...(module.key === "calendar" ? [{ key: "semesterName", label: "Học kỳ áp dụng" }] : []), ...module.fields.filter((field) => module.key !== "grades" || field.key !== "title") ];
  const transferExportFields = [{ key: "systemOrdinal", label: "STT", kind: "number" as const }, ...transferFields.filter((field) => field.key !== "ordinal" && (module.key !== "grades" || !field.hidden))];
  const semesterGroups = groupAcademicPeriods([...sharedSemesterNames.map((semesterName) => ({ semesterName, academicYear: academicYearFromSemester(semesterName) })), ...timetableWeekSourceRecords.map((row) => ({ semesterName: String(row.data.semesterName ?? row.data.semester ?? ""), academicYear: row.data.academicYear })), ...(edit ? [{ semesterName: String(edit.data.semesterName ?? edit.data.semester ?? ""), academicYear: edit.data.academicYear }] : [])]);
  const calendarFacetRecords = isCalendar ? [...rows, ...timetableWeekSourceRecords].filter((row) => {
    const semesterName = String(row.data.semesterName ?? row.data.semester ?? row.data.round ?? "");
    return (calendarAcademicYearFilter === "all" || academicPeriodMatchesYear(semesterName, row.data.academicYear, calendarAcademicYearFilter, calendarAcademicPeriods))
      && (semesterFilter === "all" || !semesterName || semesterMatchesSelection(semesterName, row.data.academicYear, semesterFilter))
      && normalizeFilterText(JSON.stringify(Object.fromEntries(Object.entries(row.data).filter(([key]) => key !== "ordinal")))).includes(normalizeFilterText(search));
  }) : [];
  const classOptions = [...new Set(calendarFacetRecords.filter((row) => courseFilter === "all" || String(row.data.title ?? row.data.subjectName ?? row.data.courseName ?? "") === courseFilter).map((row) => String(row.data.className ?? row.data.classCode ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi"));
  const courseOptions = [...new Set(calendarFacetRecords.filter((row) => classFilter === "all" || String(row.data.className ?? row.data.classCode ?? "") === classFilter).map((row) => String(row.data.title ?? row.data.subjectName ?? row.data.courseName ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi", { numeric: true, sensitivity: "base" }));
  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(visible.length / Number(pageSize)));
  const currentPage = Math.min(page, totalPages);
  const pageRows = pageSize === "all" ? visible : visible.slice((currentPage - 1) * Number(pageSize), currentPage * Number(pageSize));
  const gradeSelectionEnabled = module.key === "grades" && permissions.update;
  const selectedRowIds = module.key === "grades" ? selectedGradeIds : selectedRecordIds;
  const selectedGradeRows = gradeSelectionEnabled ? rows.filter((row) => selectedGradeIds.includes(row.id)) : [];
  const gradeHistoryRows = gradeDetail ? rows.filter((row) => String(row.data.studentCode ?? "").normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("vi-VN") === String(gradeDetail.data.studentCode ?? "").normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("vi-VN")) : [];
  const unlockedSelectedGradeCount = selectedGradeRows.filter((row) => row.data.locked !== "true").length;
  const selectedVisibleRowCount = visible.reduce((count, row) => count + Number(selectedRowIds.includes(row.id)), 0);
  const allVisibleRowsSelected = visible.length > 0 && selectedVisibleRowCount === visible.length;
  const someVisibleRowsSelected = selectedVisibleRowCount > 0 && !allVisibleRowsSelected;
  const hasOrdinalColumn = columns.some((field) => field.key === "ordinal");
  const tableColSpan = columns.length + (module.key === "grades" ? 3 : isCalendar ? 3 : 4) + Number(!hasOrdinalColumn);

  function updateSelectedRows(update: (current: string[]) => string[]) {
    if (module.key === "grades") setSelectedGradeIds(update);
    else setSelectedRecordIds(update);
  }

  function toggleAllVisibleRows(checked: boolean) {
    const visibleIds = new Set(visible.map((row) => row.id));
    updateSelectedRows((current) => checked ? [...new Set([...current, ...visibleIds])] : current.filter((id) => !visibleIds.has(id)));
  }

  function sortBy(key: string) {
    setSortState((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" });
    setPage(1);
  }

  function openGradeDetail(row: WorkspaceRecord) {
    if (!availableGradeDetailTabs.length) return;
    setGradeDetail(row);
    setGradeDetailTab(availableGradeDetailTabs[0]!);
  }

  function openGradeDuplicateDetail(studentCode: string) {
    const normalize = (value: unknown) => String(value ?? "").normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("vi-VN");
    const record = rows.find((row) => normalize(row.data.studentCode) === normalize(studentCode));
    if (record) openGradeDetail(record);
  }

  async function checkDuplicateStudentCodes() {
    const normalize = (value: unknown) => String(value ?? "").normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("vi-VN");
    setGradeDuplicateCheckBusy(true);
    const lecturerRows = rows.filter((row) => {
      const lecturer = normalize(row.data.lecturer).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return !lecturer || lecturer.includes("01011090") || lecturer.includes("vutrungnghia");
    });
    const groups = new Map<string, WorkspaceRecord[]>();
    for (const row of lecturerRows) {
      const studentCode = normalize(row.data.studentCode);
      if (!studentCode) continue;
      const existing = groups.get(studentCode);
      if (existing) existing.push(row);
      else groups.set(studentCode, [row]);
    }
    const studentProfiles = await studentService.list().catch(() => []);
    const profilesByCode = new Map<string, (typeof studentProfiles)[number]>();
    for (const profile of studentProfiles) {
      const code = normalize(profile.studentCode);
      if (code && (!profilesByCode.has(code) || (!profilesByCode.get(code)?.className && profile.className))) profilesByCode.set(code, profile);
    }
    const summaries = [...groups.values()].filter((records) => records.length > 1).map((records): GradeStudentCourseSummary => {
      const firstRecord = records[0];
      const studentProfile = profilesByCode.get(normalize(firstRecord.data.studentCode));
      return {
        studentCode: String(firstRecord.data.studentCode ?? ""),
        courses: records.map((record): GradeStudentCourseEntry => {
          const recordNameParts = gradeNameParts(record.data);
          const profile = profilesByCode.get(normalize(record.data.studentCode));
          return {
            studentName: profile?.fullName || [recordNameParts.studentMiddleName, recordNameParts.studentGivenName].filter(Boolean).join(" ") || String(record.data.studentName ?? ""),
            className: profile?.className || String(record.data.className ?? studentProfile?.className ?? ""),
            courseCode: String(record.data.courseCode ?? "").trim(),
            courseName: String(record.data.courseName ?? "").trim(),
            semesterName: String(record.data.semesterName ?? record.data.semester ?? "").trim(),
          };
        }),
      };
    });
    setGradeStudentCourseSummaries(summaries);
    setGradeDuplicateCheckBusy(false);
  }

  async function importSpreadsheet(imported: Array<Record<string, SpreadsheetValue>>) {
    if (!permissions.create || !permissions.update) throw new Error("Nhập dữ liệu cần quyền thêm và sửa trong phân hệ này.");
    const allRecords = module.key === "grades" ? await workspaceService.list("grades") : await workspaceService.allRecords();
    const existing = allRecords.filter((record) => record.module_key === module.key && !record.deleted_at);
    const getValue = (item: Record<string, SpreadsheetValue>, key: string) => String(item[key] ?? "").trim();
    const identityFields: Record<string, string[]> = { semesters: ["title", "academicYear"], "academic-years": ["title"], grades: ["studentCode", "courseCode", "semesterName"], calendar: ["courseCode", "className", "title", "classSize", "weekday", "fromPeriod", "toPeriod", "room", "weekPattern", "startDate", "semesterName"] };
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

  async function importModuleSourceData() {
    if (!permissions.import) return;
    const section = getSourceDataSection(module.key);
    if (!section) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const sourceRows = await sourceDataService.list(section.key);
      if (!sourceRows.length) throw new Error("Chưa có tệp trong mục dữ liệu nguồn “" + section.title + "”.");
      await importSpreadsheet(sourceRows.map(sourceValues));
      setNotice("Đã lấy " + sourceRows.length + " dòng từ dữ liệu nguồn “" + section.title + "”.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không lấy được dữ liệu nguồn."); }
    finally { setSaving(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (module.key === "grades" && edit?.data.locked === "true") { setError("Điểm đã khóa. Hãy mở khóa trước khi sửa."); return; }
    const formData = new FormData(event.currentTarget);
    const values = Object.fromEntries(module.fields.filter((field) => field.key !== "ordinal").map((field) => [field.key, String(formData.get(field.key) ?? "").trim()]).filter(([, value]) => value !== "")) as Record<string, string>;
    if (edit && editData?.ordinal !== undefined) values.ordinal = String(editData.ordinal);
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

  async function submitSurveyRating(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeSurvey) return;
    setSurveySubmitting(true); setError("");
    try {
      await surveyService.submitRating(activeSurvey.id, surveyRating);
      setMySurveyRatings((current) => ({ ...current, [activeSurvey.id]: surveyRating }));
      setActiveSurvey(null);
      setNotice("Cảm ơn bạn đã thực hiện khảo sát.");
      window.dispatchEvent(new Event("vtn-surveys-updated"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể gửi khảo sát."); }
    finally { setSurveySubmitting(false); }
  }

  function applySemesterFilter(value: string) {
    const normalizedValue = value === "all" ? value : normalizeSemesterName(value);
    setSemesterFilter(normalizedValue);
    setPage(1);
    localStorage.setItem("vtn-active-semester", normalizedValue);
    window.dispatchEvent(new CustomEvent("vtn-semester-filter-changed", { detail: normalizedValue }));
  }

  function applyCalendarYearFilter(value: string) {
    const validTerms = value === "all" ? [] : calendarSemesterGroups.find((group) => normalizeAcademicYear(group.academicYear) === normalizeAcademicYear(value))?.semesters ?? [];
    const selectedSemesterYear = academicYearFromSemester(semesterFilter);
    const nextSemester = semesterFilter !== "all" && value !== "all" && (!validTerms.some((term) => semesterLabelIdentity(term) === semesterLabelIdentity(semesterFilter)) || (selectedSemesterYear && normalizeAcademicYear(selectedSemesterYear) !== normalizeAcademicYear(value))) ? "all" : semesterFilter;
    const candidateRows = timetableWeekSourceRecords.filter((record) => (value === "all" || academicPeriodMatchesYear(record.data.semesterName, record.data.academicYear, value, calendarAcademicPeriods))
      && (nextSemester === "all" || semesterMatchesSelection(record.data.semesterName, record.data.academicYear, nextSemester)));
    setCalendarAcademicYearFilter(value);
    if (nextSemester !== semesterFilter) applySemesterFilter("all");
    if (classFilter !== "all" && !candidateRows.some((record) => String(record.data.className ?? record.data.classCode ?? "") === classFilter)) setClassFilter("all");
    if (courseFilter !== "all" && !candidateRows.some((record) => String(record.data.title ?? record.data.subjectName ?? record.data.courseName ?? "") === courseFilter)) setCourseFilter("all");
    setPage(1);
  }

  function applyCalendarSemesterFilter(value: string) {
    const nextSemester = value === "all" ? value : normalizeSemesterName(value);
    const candidateRows = timetableWeekSourceRecords.filter((record) => (calendarAcademicYearFilter === "all" || academicPeriodMatchesYear(record.data.semesterName, record.data.academicYear, calendarAcademicYearFilter, calendarAcademicPeriods))
      && (nextSemester === "all" || semesterMatchesSelection(record.data.semesterName, record.data.academicYear, nextSemester)));
    if (classFilter !== "all" && !candidateRows.some((record) => String(record.data.className ?? record.data.classCode ?? "") === classFilter)) setClassFilter("all");
    if (courseFilter !== "all" && !candidateRows.some((record) => String(record.data.title ?? record.data.subjectName ?? record.data.courseName ?? "") === courseFilter)) setCourseFilter("all");
    applySemesterFilter(value);
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
          ? { ...(matching[0]?.data ?? {}), ...period, status: "Theo tiến độ đào tạo", notes: "Đồng bộ từ Tiến độ đào tạo." }
          : { ...(matching[0]?.data ?? {}), ...period, current, notes: "Đồng bộ từ Tiến độ đào tạo." };
        if (matching.length) {
          const survivor = [...matching].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
          await workspaceService.save(module.key, values, survivor.id);
          for (const duplicate of matching) if (duplicate.id !== survivor.id) { await workspaceService.moveToTrash(duplicate.id); merged += 1; }
          updated += 1;
        } else { await workspaceService.save(module.key, values); created += 1; }
      }
      setNotice(`Đã đồng bộ ${updated} bản ghi, tạo ${created} mới và gộp ${merged} bản trùng theo Tiến độ đào tạo.`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể đồng bộ theo Tiến độ đào tạo."); }
    finally { setSaving(false); }
  }

  async function importGradebookPdfs(files: FileList | null) {
    if (!files?.length || module.key !== "grades" || !permissions.import || !permissions.create || !permissions.update) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const parsedFiles = await Promise.all(Array.from(files, async (file) => ({ file, rows: await extractGradebookPdf(file) })));
      for (const item of parsedFiles) await sourceDataService.archiveImportedFile(item.file, "grades", item.rows);
      const extracted = parsedFiles.flatMap((item) => item.rows);
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

  async function lockSelectedGrades() {
    if (!gradeSelectionEnabled || !unlockedSelectedGradeCount || saving) return;
    const targets = selectedGradeRows.filter((row) => row.data.locked !== "true");
    const lockedAt = new Date().toISOString();
    let lockedCount = 0;
    setSaving(true); setError(""); setNotice("");
    try {
      for (const row of targets) {
        await workspaceService.save("grades", { ...row.data, locked: "true", lockedAt }, row.id, row.external_id ?? undefined);
        lockedCount += 1;
      }
      setSelectedGradeIds([]);
      setNotice(`Đã khóa điểm cho ${lockedCount} dòng đã chọn.`);
      await load();
    } catch (cause) {
      await load();
      setError(lockedCount ? `Đã khóa ${lockedCount}/${targets.length} dòng. ${cause instanceof Error ? cause.message : "Còn bản ghi chưa cập nhật được."}` : cause instanceof Error ? cause.message : "Không thể khóa các dòng điểm đã chọn.");

    } finally { setSaving(false); }
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
    const body = rows.map((row, index) => { const nameParts = gradeNameParts(row.data); return `<tr><td>${escape(recordName(row))}</td>${exportFields.map((field) => `<td>${escape(field.key === "ordinal" ? index + 1 : field.key === "lecturer" ? GRADEBOOK_LECTURER : field.key === "studentMiddleName" ? nameParts.studentMiddleName : field.key === "studentGivenName" ? nameParts.studentGivenName : row.data[field.key])}</td>`).join("")}</tr>`; }).join("");
    printWindow.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Sổ điểm</title><style>@page{size:A3 landscape;margin:12mm}body{font:11px Arial,sans-serif;color:#172554}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 12px;color:#475569}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:5px 6px;text-align:left}th{background:#edf3ff}tr:nth-child(even){background:#f8fafc}</style></head><body><h1>Sổ điểm</h1><p>${escape(rows.length)} bản ghi · Xuất ${escape(new Date().toLocaleString("vi-VN"))}</p><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></body></html>`);
    printWindow.document.close(); printWindow.focus(); window.setTimeout(() => printWindow.print(), 250);
  }

  async function moveToTrash(row: WorkspaceRecord) {
    if (module.key === "grades" && row.data.locked === "true") { setError("Điểm đã khóa. Hãy mở khóa trước khi xóa."); return; }
    if (!window.confirm(`Chuyển “${recordName(row)}” vào thùng rác?`)) return;
    try { await workspaceService.moveToTrash(row.id); updateSelectedRows((current) => current.filter((id) => id !== row.id)); setNotice("Đã chuyển vào thùng rác."); await load(); }
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
  const visibleFormFields = module.fields.filter((field) => !field.hidden && field.key !== "ordinal" && !(module.key === "grades" && field.key === "title") && !((module.key === "student-support" || module.key === "tasks") && field.key === "status" && !edit));
  const formFields = module.key === "student-support"
    ? ["title", "studentCode", "studentName", ...(edit ? ["status"] : []), "category", "priority", "notes"].flatMap((key) => visibleFormFields.filter((field) => field.key === key))
    : visibleFormFields;
  const gradeDetailName = gradeDetail ? [gradeNameParts(gradeDetail.data).studentMiddleName, gradeNameParts(gradeDetail.data).studentGivenName].filter(Boolean).join(" ") : "";

  return <section className="workspace-page">
    <div className="workspace-title-row"><div><div className="workspace-breadcrumb">{module.group} <span>/</span> {module.title}</div><h1>{module.title}</h1><p>{module.description}</p></div><div className="workspace-title-actions">{module.key === "grades" && permissions.import && permissions.create && permissions.update && <><input ref={gradebookPdfInput} hidden multiple type="file" accept="application/pdf,.pdf" onChange={(event) => void importGradebookPdfs(event.target.files)} /><button type="button" disabled={saving} onClick={() => gradebookPdfInput.current?.click()}>{saving ? "Đang nhập…" : "Nhập bảng điểm PDF"}</button></>}{module.key === "grades" && permissions.export && <button type="button" onClick={exportGradePdf}>Xuất PDF</button>}{(module.key === "semesters" || module.key === "academic-years") && permissions.create && permissions.update && permissions.delete && <button type="button" disabled={saving} onClick={() => void syncTeachingPeriods()}>Đồng bộ tiến độ đào tạo</button>}{getSourceDataSection(module.key) && permissions.import && <button type="button" disabled={saving} onClick={() => void importModuleSourceData()}><Database size={17} /> Lấy dữ liệu nguồn</button>}{module.key === "documents" && <button type="button" onClick={openDocumentAssistant}><Bot size={17} /> Hỏi trợ lý AI</button>}{permissions.create && <button className="workspace-primary" type="button" onClick={() => { setEdit(null); setShowForm(true); setNotice(""); }}><Plus size={17} /> Thêm mới</button>}</div></div>
    {isCalendar && <div className="workspace-notice" role="note">Tuần học giữ nguyên chuỗi ký tự trong tệp. Mỗi vị trí tương ứng một tuần của học kỳ; ký tự 1 đầu tiên là tuần 1 (tuần lịch 23), các ký tự 1 tiếp theo có thể là tuần 11, 21. Lịch có thể thay đổi theo thực tế.</div>}
    {error && <div className="workspace-alert" role="alert">{error}<button type="button" aria-label="Đóng thông báo" onClick={() => setError("")}><X size={16} /></button></div>}
    {notice && <div className="workspace-notice" role="status">{notice}</div>}
    {showForm && <div className="workspace-record-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) { setShowForm(false); setEdit(null); } }}><form key={edit?.id ?? "new"} className="workspace-form workspace-record-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-record-form-title" onSubmit={submit}>
      <div className="workspace-form-head"><h2 id="workspace-record-form-title">{edit ? "Chỉnh sửa" : "Thêm mới"} · {module.title}</h2><button type="button" aria-label="Đóng biểu mẫu" onClick={() => { setShowForm(false); setEdit(null); }}><X size={18} /></button></div>
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
      <div className="workspace-form-actions"><button className="workspace-primary" disabled={saving}>{saving ? "Đang lưu…" : "Lưu"}</button><button type="button" onClick={() => { setShowForm(false); setEdit(null); }}>Hủy</button></div>
    </form></div>}
    { ["semesters", "academic-years", "calendar", "grades"].includes(module.key) && (!isCalendar || tabPermissions.calendarList) && <SpreadsheetTransferPanel title={module.title} fields={transferFields} exportFields={transferExportFields} rows={rows.map((row, index) => ({ ...(module.key === "calendar" ? calendarDisplayData(row.data) : module.key === "grades" ? { ...row.data, ...gradeNameParts(row.data), lecturer: GRADEBOOK_LECTURER } : row.data), systemOrdinal: index + 1 }))} canImport={permissions.import} canExport={permissions.export} onImport={importSpreadsheet} onArchiveFiles={async (files) => { for (const item of files) await sourceDataService.archiveImportedFile(item.file, module.key, item.rows); }} /> }
    {isCalendar && <div className="calendar-filter-panel"><QuickFilterHeading onClear={() => { setSearch(""); setCalendarAcademicYearFilter("all"); applySemesterFilter("all"); setClassFilter("all"); setCourseFilter("all"); setPage(1); }} clearDisabled={calendarAcademicYearFilter === "all" && semesterFilter === "all" && classFilter === "all" && courseFilter === "all" && !search} /><label>Năm học<SearchableFilter value={calendarAcademicYearFilter} allValue="all" allLabel="Tất cả năm học" options={calendarAcademicYearOptions.map((year) => ({ value: year, label: year }))} onChange={applyCalendarYearFilter} /></label><label>Học kỳ<SearchableFilter value={semesterFilter} allValue="all" allLabel="Tất cả học kỳ" options={[...(semesterFilter !== "all" && !visibleCalendarSemesterGroups.some((group) => group.semesters.includes(semesterFilter)) ? [{ value: semesterFilter, label: semesterFilter }] : []), ...visibleCalendarSemesterGroups.flatMap((group) => group.semesters.map((semester) => ({ value: semester, label: semester })))]} onChange={applyCalendarSemesterFilter} /></label><label>Lớp<SearchableFilter value={classFilter} allValue="all" allLabel="Tất cả lớp" options={classOptions.map((className) => ({ value: className, label: className }))} onChange={(value) => { setClassFilter(value); setPage(1); }} /></label><label>Tên môn học<SearchableFilter value={courseFilter} allValue="all" allLabel="Tất cả môn học" options={courseOptions.map((course) => ({ value: course, label: course }))} onChange={(value) => { setCourseFilter(value); setPage(1); }} /></label></div>}
    {filterSpecs.length > 0 && <div className="workspace-filter-panel" aria-label={`Bộ lọc ${module.title}`}>
      <div className={`workspace-filter-heading${isAcademicYears ? " academic-years-filter-heading" : isSemesters ? " semesters-filter-heading" : ""}`}><strong><Filter size={16} /> Bộ lọc</strong><span>{activeFilterCount ? `${activeFilterCount} điều kiện đang áp dụng` : "Lọc nhanh theo thông tin"}</span><button type="button" disabled={!activeFilterCount && !search} onClick={() => { setFilterValues({}); setSearch(""); setPage(1); }}><X size={15} /> Xóa bộ lọc</button></div>
      <div className={`workspace-filter-controls${isAcademicYears ? " academic-years-filter-controls" : isSemesters ? " semesters-filter-controls" : module.key === "grades" ? " gradebook-filter-controls" : ""}`}>
        {filterSpecs.map((spec) => <label key={spec.key}>{spec.label}<SearchableFilter value={filterValues[spec.key] ?? ""} disabled={!filterOptions[spec.key]?.length} allValue="" allLabel="Tất cả" options={module.key === "grades" && spec.key === "semesterName" ? groupedGradebookSemesterOptions.flatMap((group) => group.semesters.map((option) => ({ value: option, label: option }))) : (filterOptions[spec.key] ?? []).map((option) => ({ value: option, label: option }))} onChange={(nextValue) => { setFilterValues((current) => { const next = { ...current, [spec.key]: nextValue }; if (spec.key === "academicYear" && nextValue) { const termValue = next.semesterName || (module.key === "semesters" ? next.title : ""); const periodCatalog = module.key === "grades" ? gradebookTimetablePeriods : moduleAcademicPeriods; if (termValue && !periodCatalog.some((period) => normalizeAcademicYear(period.academicYear) === normalizeAcademicYear(nextValue) && semesterLabelIdentity(period.semesterName) === semesterLabelIdentity(termValue))) { next.semesterName = ""; if (module.key === "semesters") next.title = ""; } } return next; }); setPage(1); }} /></label>)}
      </div>
    </div>}
    {module.key === "grades" && gradeStudentCourseSummaries !== null && <section className="gradebook-duplicate-report" role="status" aria-live="polite"><div><strong>{gradeStudentCourseSummaries.length ? `Tìm thấy ${gradeStudentCourseSummaries.length} mã sinh viên bị trùng` : "Không tìm thấy mã sinh viên bị trùng"}</strong><button type="button" onClick={() => setGradeStudentCourseSummaries(null)}>Đóng</button></div>{gradeStudentCourseSummaries.length > 0 && <ul>{gradeStudentCourseSummaries.map((summary) => <li key={summary.studentCode}><div className="gradebook-duplicate-code"><span>Mã sinh viên:</span>{canViewGradeDetail ? <button type="button" className="gradebook-duplicate-student-link" onClick={() => openGradeDuplicateDetail(summary.studentCode)}>{summary.studentCode}</button> : <strong>{summary.studentCode}</strong>}</div><div className="gradebook-duplicate-course-list"><div className="gradebook-duplicate-course-row gradebook-duplicate-course-heading"><strong>Họ và tên</strong><strong>Lớp sinh hoạt</strong><strong>Mã học phần</strong><strong>Tên học phần</strong><strong>Học kỳ</strong></div>{summary.courses.map((course, index) => <div className="gradebook-duplicate-course-row" key={summary.studentCode + "-" + index}><span>{course.studentName || "—"}</span><span>{course.className || "—"}</span><span>{course.courseCode || "—"}</span><span>{course.courseName || "—"}</span><span>{course.semesterName || "—"}</span></div>)}</div></li>)}</ul>}</section>}<div className="workspace-toolbar"><label><Search size={17} /><input aria-label={`Tìm trong ${module.title}`} placeholder={isCalendar ? "Tìm nhanh mã LHP, tên môn, lớp, phòng…" : `Tìm trong ${module.title.toLowerCase()}…`} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label><span>{loading ? "Đang tải…" : `${isCalendar && activeCalendarView === "week" ? calendarWeekRecords.length : visible.length} bản ghi`}</span>{module.key === "grades" && <button className="gradebook-duplicate-check-button" type="button" onClick={() => void checkDuplicateStudentCodes()} disabled={loading || gradeDuplicateCheckBusy}><Search size={16} />Kiểm tra trùng mã SV</button>}</div>
    {module.key === "surveys" && canAnswerSurveys && <section className="survey-campaign-list" aria-label="Các khảo sát đang có">{visible.map((survey) => <article className="survey-campaign-card" key={survey.id}><div className="survey-campaign-copy"><h2>{recordName(survey)}</h2><p>{String(survey.data.notes ?? "Chia sẻ đánh giá chung của bạn trong khảo sát này.")}</p><small>{survey.data.dueDate ? `Hạn khảo sát: ${formatDate(String(survey.data.dueDate))}` : "Không giới hạn thời gian"}{survey.data.semesterName ? ` · ${formatSemesterLabel(survey.data.semesterName, survey.data.academicYear)}` : ""}</small></div><div className="survey-campaign-action">{mySurveyRatings[survey.id] && <span>Đã thực hiện · {mySurveyRatings[survey.id]}/5</span>}<button type="button" onClick={() => { setActiveSurvey(survey); setSurveyRating(mySurveyRatings[survey.id] ?? 5); }}><Star size={16} />{mySurveyRatings[survey.id] ? "Cập nhật đánh giá" : "Làm khảo sát"}</button></div></article>)}{!loading && !visible.length && <div className="workspace-panel survey-campaign-empty">Chưa có khảo sát nào trong bộ lọc hiện tại.</div>}</section>}
    {isCalendar && (tabPermissions.calendarList || tabPermissions.calendarWeek) && <div className="calendar-view-tabs" role="tablist" aria-label="Cách xem lịch giảng dạy">{tabPermissions.calendarList && <button type="button" role="tab" aria-selected={activeCalendarView === "list"} className={activeCalendarView === "list" ? "active" : ""} onClick={() => setCalendarView("list")}>Danh sách</button>}{tabPermissions.calendarWeek && <button type="button" role="tab" aria-selected={activeCalendarView === "week"} className={activeCalendarView === "week" ? "active" : ""} onClick={() => setCalendarView("week")}>Xem theo tuần</button>}</div>}{isCalendar && activeCalendarView === "none" && <div className="workspace-panel">Bạn chưa được cấp quyền xem các tab lịch giảng dạy.</div>}
    {isCalendar && activeCalendarView === "week" && loading && <p className="workspace-muted">Đang tải lịch giảng dạy…</p>}
    {isCalendar && activeCalendarView === "week" && !loading && !error && <TeachingWeekCalendar records={calendarWeekRecords} />}
    {gradeSelectionEnabled && selectedGradeRows.length > 0 && <div className="workspace-bulk-actions"><span>Đã chọn {selectedGradeRows.length} dòng · {unlockedSelectedGradeCount} dòng chưa khóa</span><button type="button" className="workspace-bulk-lock-button" disabled={saving || !unlockedSelectedGradeCount} onClick={() => void lockSelectedGrades()}><Lock size={16} />Khóa điểm</button><button type="button" className="workspace-bulk-clear-button" disabled={saving} onClick={() => setSelectedGradeIds([])}>Bỏ chọn</button></div>}
    {isPaged && (!isCalendar || activeCalendarView === "list") && <div className="workspace-data-selection"><label><input type="checkbox" aria-label="Chọn tất cả dòng dữ liệu phù hợp" checked={allVisibleRowsSelected} ref={(element) => { if (element) element.indeterminate = someVisibleRowsSelected; }} onChange={(event) => toggleAllVisibleRows(event.target.checked)} /> Chọn tất cả {visible.length.toLocaleString("vi-VN")} dòng dữ liệu phù hợp</label><span>Đã chọn {selectedVisibleRowCount.toLocaleString("vi-VN")} / {visible.length.toLocaleString("vi-VN")} dòng</span><button type="button" disabled={!selectedRowIds.length} onClick={() => updateSelectedRows(() => [])}>Bỏ chọn</button></div>}
    {(!isCalendar || activeCalendarView === "list") && !(module.key === "surveys" && canAnswerSurveys) && <div className="workspace-table-wrap"><table className={module.key === "grades" ? "gradebook-table" : undefined}><thead><tr>{isCalendar ? <><th className="gradebook-select-column"><input type="checkbox" aria-label="Chọn tất cả dòng lịch giảng dạy phù hợp" checked={allVisibleRowsSelected} ref={(element) => { if (element) element.indeterminate = someVisibleRowsSelected; }} onChange={(event) => toggleAllVisibleRows(event.target.checked)} /></th>{columns.map((field) => <SortableTableHeader key={field.key} label={field.label.toLocaleUpperCase("vi-VN")} sortKey={field.key} sortState={sortState} onSort={sortBy} />)}<SortableTableHeader label="CẬP NHẬT" sortKey="updated_at" sortState={sortState} onSort={sortBy} /><th>THAO TÁC</th></> : <><th className="gradebook-select-column"><input type="checkbox" aria-label="Chọn tất cả dòng dữ liệu phù hợp" checked={allVisibleRowsSelected} ref={(element) => { if (element) element.indeterminate = someVisibleRowsSelected; }} onChange={(event) => toggleAllVisibleRows(event.target.checked)} /></th>{!hasOrdinalColumn && <SortableTableHeader label="STT" sortKey="ordinal" sortState={sortState} onSort={sortBy} />}{module.key !== "grades" && <SortableTableHeader label={isAcademicYears ? "NĂM HỌC" : isSemesters ? "HỌC KỲ" : "TÊN / TIÊU ĐỀ"} sortKey="__name" sortState={sortState} onSort={sortBy} />}{columns.map((field) => <SortableTableHeader key={field.key} label={isSemesters && field.key === "academicYear" ? "NĂM HỌC" : field.label.toLocaleUpperCase("vi-VN")} sortKey={field.key} sortState={sortState} onSort={sortBy} />)}<SortableTableHeader label="CẬP NHẬT" sortKey="updated_at" sortState={sortState} onSort={sortBy} /><th>THAO TÁC</th></>}</tr></thead><tbody>
      {loading && <tr><td className="workspace-state" colSpan={tableColSpan}>Đang tải…</td></tr>}
      {!loading && !error && (isPaged ? pageRows : visible).map((row, rowIndex) => { const rowNumber = pageSize === "all" ? rowIndex + 1 : (currentPage - 1) * Number(pageSize) + rowIndex + 1; const locked = module.key === "grades" && row.data.locked === "true"; return <tr key={row.id}><td className="gradebook-select-column"><input type="checkbox" aria-label={`Chọn dòng dữ liệu ${recordName(row)}`} checked={selectedRowIds.includes(row.id)} disabled={saving} onChange={(event) => updateSelectedRows((current) => event.target.checked ? [...new Set([...current, row.id])] : current.filter((id) => id !== row.id))} /></td>{!hasOrdinalColumn && <td>{rowNumber}</td>}{!isCalendar && module.key !== "grades" && <td className="workspace-record-name">{module.key === "semesters" ? formatSemesterLabel(row.data.title, row.data.academicYear) : recordName(row)}{locked && <span className="gradebook-lock-badge">Đã khóa</span>}</td>}{columns.map((field) => { const nameParts = module.key === "grades" ? gradeNameParts(row.data) : null; const value = field.key === "ordinal" ? rowNumber : isCalendar ? calendarDisplayData(row.data)[field.key] : module.key === "grades" && field.key === "lecturer" ? GRADEBOOK_LECTURER : module.key === "grades" && field.key === "studentMiddleName" ? nameParts?.studentMiddleName : module.key === "grades" && field.key === "studentGivenName" ? nameParts?.studentGivenName : field.key === "semesterName" ? formatSemesterLabel(row.data.semesterName ?? row.data.semester, row.data.academicYear) : row.data[field.key]; const leftAligned = module.key === "grades" && ["studentMiddleName", "studentGivenName", "lecturer", "notes"].includes(field.key); return <td className={leftAligned ? "gradebook-left-cell" : undefined} key={field.key}>{module.key === "tasks" && field.key === "status" && permissions.update ? <select className="workspace-inline-status-select" aria-label={`Trạng thái công việc ${recordName(row)}`} value={String(value || "Mới")} disabled={taskStatusSavingId === row.id} onChange={(event) => void changeTaskStatus(row, event.target.value)}>{field.options?.map((option) => <option key={option}>{option}</option>)}</select> : module.key === "grades" && field.key === "studentCode" && canViewGradeDetail ? <button type="button" className="gradebook-student-code" aria-label={`Xem thông tin sinh viên ${String(value ?? "")}`} onClick={() => openGradeDetail(row)}>{String(value ?? "—")}</button> : isCalendar && field.key === "weekday" ? renderCalendarWeekdayTag(value) : isCalendar && field.key === "weekNumbers" ? renderCalendarWeekNumberTags(value) : value !== undefined && value !== null && value !== "" ? field.kind === "date" ? formatDate(String(value)) : field.kind === "datetime-local" ? formatDateTime(String(value)) : String(value) : "—"}</td>; })}<td>{formatDate(row.updated_at)}</td><td><div className="workspace-row-actions">{module.key !== "grades" && <button type="button" title="Xem chi tiết" aria-label={`Xem ${recordName(row)}`} onClick={() => setViewRecord(row)}><Eye size={16} /></button>}{module.key === "grades" && permissions.update && <button type="button" title={locked ? "Mở khóa điểm" : "Khóa điểm"} aria-label={`${locked ? "Mở khóa" : "Khóa"} điểm ${recordName(row)}`} onClick={() => void toggleGradeLock(row)}>{locked ? <Unlock size={16} /> : <Lock size={16} />}</button>}{module.key === "grades" && canViewGradeDetail && <button type="button" title="Xem chi tiết" aria-label={`Xem thông tin sinh viên ${String(row.data.studentCode ?? "")}`} onClick={() => openGradeDetail(row)}><Eye size={16} /></button>}{permissions.update && !locked && <button type="button" title="Chỉnh sửa" aria-label={`Chỉnh sửa ${recordName(row)}`} onClick={() => { setEdit(row); setShowForm(true); }}><Edit3 size={16} /></button>}{permissions.delete && !locked && <button type="button" title="Chuyển vào thùng rác" aria-label={`Chuyển ${recordName(row)} vào thùng rác`} onClick={() => void moveToTrash(row)}><Trash2 size={16} /></button>}</div></td></tr>; })}
      {!loading && !error && !visible.length && <tr><td className="workspace-state" colSpan={tableColSpan}><Archive size={22} /><strong>{search ? "Không tìm thấy kết quả" : "Chưa có dữ liệu"}</strong><span>{search ? "Hãy thử từ khóa khác." : "Thêm bản ghi đầu tiên để bắt đầu."}</span></td></tr>}
      {!loading && error && <tr><td className="workspace-state" colSpan={tableColSpan}>Không thể hiển thị dữ liệu. <button type="button" onClick={() => void load()}>Thử tải lại</button></td></tr>}
    </tbody></table></div>}
    {isPaged && (!isCalendar || activeCalendarView === "list") && <div className="workspace-pagination"><label>Số dòng<select value={pageSize} onChange={(event) => { setPageSize(event.target.value); setPage(1); }}><option value="10">10</option><option value="20">20</option><option value="50">50</option><option value="100">100</option><option value="all">Tất cả</option></select></label><span>{visible.length ? `Hiển thị ${(currentPage - 1) * (pageSize === "all" ? visible.length : Number(pageSize)) + 1}–${pageSize === "all" ? visible.length : Math.min(currentPage * Number(pageSize), visible.length)} / ${visible.length}` : "Không có dòng"}</span><div><button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Trước</button><span>Trang {currentPage} / {totalPages}</span><button type="button" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Sau</button></div></div>}
    {viewRecord && <div className="workspace-record-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewRecord(null); }}><section className="workspace-record-modal workspace-record-view-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-record-view-title"><header className="workspace-form-head"><div><small>{module.title}</small><h2 id="workspace-record-view-title">{recordName(viewRecord)}</h2></div><button type="button" aria-label="Đóng thông tin" onClick={() => setViewRecord(null)}><X size={18} /></button></header><dl className="workspace-record-details">{visibleFormFields.map((field) => { const data = isCalendar ? calendarDisplayData(viewRecord.data) : viewRecord.data; const nameParts = module.key === "grades" ? gradeNameParts(data) : null; const value = module.key === "grades" && field.key === "lecturer" ? GRADEBOOK_LECTURER : module.key === "grades" && field.key === "studentMiddleName" ? nameParts?.studentMiddleName : module.key === "grades" && field.key === "studentGivenName" ? nameParts?.studentGivenName : field.key === "semesterName" ? formatSemesterLabel(data.semesterName ?? data.semester, data.academicYear) : data[field.key]; const text = value === undefined || value === null || value === "" ? "—" : field.kind === "date" ? formatDate(String(value)) : field.kind === "datetime-local" ? formatDateTime(String(value)) : String(value); return <div key={field.key}><dt>{field.label}</dt><dd>{text}</dd></div>; })}<div><dt>Cập nhật</dt><dd>{formatDate(viewRecord.updated_at)}</dd></div></dl><footer className="workspace-form-actions">{permissions.update && <button type="button" className="workspace-primary" onClick={() => { setEdit(viewRecord); setViewRecord(null); setShowForm(true); }}>Chỉnh sửa</button>}<button type="button" onClick={() => setViewRecord(null)}>Đóng</button></footer></section></div>}    {activeSurvey && <div className="survey-response-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !surveySubmitting) setActiveSurvey(null); }}><section className="survey-response-dialog" role="dialog" aria-modal="true" aria-labelledby="survey-response-title"><header><div><small>Đánh giá &amp; khảo sát</small><h2 id="survey-response-title">{recordName(activeSurvey)}</h2></div><button type="button" aria-label="Đóng khảo sát" disabled={surveySubmitting} onClick={() => setActiveSurvey(null)}><X size={19} /></button></header><form onSubmit={(event) => void submitSurveyRating(event)}><p>{String(activeSurvey.data.notes ?? "Hãy đánh giá trải nghiệm giảng dạy của bạn.")}</p><strong className="survey-rating-question">Bạn đánh giá mức độ hài lòng như thế nào?</strong><div className="survey-rating-stars" role="radiogroup" aria-label="Mức đánh giá từ 1 đến 5 sao">{[1, 2, 3, 4, 5].map((rating) => <button type="button" role="radio" aria-checked={surveyRating === rating} aria-label={`${rating} trên 5 sao`} key={rating} onClick={() => setSurveyRating(rating)}><Star size={32} fill={surveyRating >= rating ? "currentColor" : "none"} /></button>)}</div><div className="survey-rating-labels"><span>Chưa hài lòng</span><b>{surveyRating}/5</b><span>Rất hài lòng</span></div><div className="workspace-form-actions"><button className="workspace-primary" disabled={surveySubmitting}>{surveySubmitting ? "Đang gửi…" : "Gửi khảo sát"}</button><button type="button" disabled={surveySubmitting} onClick={() => setActiveSurvey(null)}>Hủy</button></div></form></section></div>}
    {module.key === "documents" && documentAIOpen && <div className="document-ai-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDocumentAIOpen(false); }}><aside className="document-ai-drawer" role="dialog" aria-modal="true" aria-labelledby="document-ai-title"><header><div className="document-ai-title-icon"><Bot size={20} /></div><div><h2 id="document-ai-title">Trợ lý AI học vụ</h2><p>Gemini 2.5 Flash · trích dẫn tài liệu nguồn</p></div><button type="button" aria-label="Đóng trợ lý" onClick={() => setDocumentAIOpen(false)}><X size={18} /></button></header><div className="document-ai-quick-asks"><span><Sparkles size={14} /> Gợi ý nhanh</span>{["Tóm tắt đề cương môn học", "Điều kiện học lại và tích lũy tín chỉ", "Quy định về thời hạn đăng ký học phần"].map((question) => <button key={question} type="button" disabled={documentAIBusy} onClick={() => void askDocumentAssistant(question)}>{question}</button>)}</div><div className="document-ai-messages">{documentAIMessages.map((message, index) => <article className={`document-ai-message ${message.role}`} key={`${message.role}-${index}`}><span>{message.role === "assistant" ? <Bot size={15} /> : "Bạn"}</span><div><p>{message.content}</p>{message.citations?.length ? <div className="document-ai-citations">{message.citations.map((citation, citationIndex) => <a key={`${citation.code ?? citation.fileName ?? citation.url}-${citationIndex}`} href={citation.url || undefined} target={citation.url ? "_blank" : undefined} rel="noreferrer">{citation.code ? `[${citation.code}] ` : ""}{citation.title ?? citation.fileName ?? citation.url ?? "Nguồn"}</a>)}</div> : null}</div></article>)}{documentAIBusy && <p className="document-ai-thinking">Đang đối chiếu tài liệu học vụ…</p>}</div><form className="document-ai-compose" onSubmit={(event) => { event.preventDefault(); void askDocumentAssistant(); }}><textarea value={documentAIQuestion} onChange={(event) => setDocumentAIQuestion(event.target.value)} rows={2} placeholder="Nhập câu hỏi về tài liệu học vụ…" disabled={documentAIBusy} /><button className="workspace-primary" disabled={documentAIBusy || !documentAIQuestion.trim()}><Send size={16} /></button></form><div className="document-ai-contact"><ContactRound size={16} /><span><strong>Liên hệ giảng viên</strong><small>{String(lecturerContact.lecturer_name ?? "Chưa cấu hình")}{lecturerContact.lecturer_email ? ` · ${String(lecturerContact.lecturer_email)}` : ""}</small></span></div><small className="document-ai-source-note">Trợ lý tìm trong nguồn đã nạp tại mục Học vụ AI. Mã [DOC-xx] đối chiếu tên tài liệu được trích dẫn.</small></aside></div>}
    {module.key === "grades" && gradeDetail && <div className="gradebook-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setGradeDetail(null); }}>
      <section className="gradebook-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="gradebook-detail-title">
        <header><div><small>Thông tin sinh viên</small><h2 id="gradebook-detail-title">{String(gradeDetail.data.studentCode ?? "—")} · {gradeDetailName || String(gradeDetail.data.studentName ?? "—")}</h2></div><button type="button" aria-label="Đóng thông tin chi tiết" onClick={() => setGradeDetail(null)}><X size={19} /></button></header>
        <div className="student-detail-tabs gradebook-detail-tabs" role="tablist">
          {tabPermissions.gradeProfile && <button type="button" role="tab" aria-selected={activeGradeDetailTab === "profile"} className={activeGradeDetailTab === "profile" ? "active" : ""} onClick={() => setGradeDetailTab("profile")}>1. Thông tin sinh viên</button>}
          {tabPermissions.gradeResults && <button type="button" role="tab" aria-selected={activeGradeDetailTab === "results"} className={activeGradeDetailTab === "results" ? "active" : ""} onClick={() => setGradeDetailTab("results")}>2. Bảng kết quả học tập</button>}
          {tabPermissions.gradeHistory && <button type="button" role="tab" aria-selected={activeGradeDetailTab === "courses"} className={activeGradeDetailTab === "courses" ? "active" : ""} onClick={() => setGradeDetailTab("courses")}>3. Lịch sử theo học</button>}
        </div>
        {!activeGradeDetailTab ? <p>Bạn chưa được cấp quyền xem các tab thông tin sinh viên.</p> : activeGradeDetailTab === "profile" ? <dl className="gradebook-student-info">{[
          ["Mã sinh viên", String(gradeDetail.data.studentCode ?? "")],
          ["Họ và tên", gradeStudentProfile?.fullName || gradeDetailName || String(gradeDetail.data.studentName ?? "")],
          ["Giới tính", studentProfileSourceValue(gradeStudentProfile, "gender", "gender", "gioi tinh") || String(gradeDetail.data.gender ?? "")],
          ["Ngày sinh", gradeStudentProfile?.dateOfBirth || String(gradeDetail.data.dateOfBirth ?? "")],
          ["Số điện thoại", gradeStudentProfile?.phone || String(gradeDetail.data.phone ?? "")],
          ["Số CCCD", studentProfileSourceValue(gradeStudentProfile, "citizenId", "citizenId", "so cccd", "cccd") || String(gradeDetail.data.citizenId ?? "")],
          ["Email", gradeStudentProfile?.email || String(gradeDetail.data.email ?? "")],
          ["Nơi sinh", studentProfileSourceValue(gradeStudentProfile, "birthplace", "birthplace", "noi sinh") || String(gradeDetail.data.birthplace ?? "")],
          ["Lớp sinh hoạt", gradeStudentProfile?.className || studentProfileSourceValue(gradeStudentProfile, "", "ma lop chu", "lop sinh hoat")],
          ["Ngành", studentProfileSourceValue(gradeStudentProfile, "academicMajor", "sourceFaculty", "academicMajor", "nganh") || gradeStudentProfile?.faculty || String(gradeDetail.data.academicMajor ?? "")],
          ["Bậc đào tạo", studentProfileSourceValue(gradeStudentProfile, "", "sourceEducationLevel", "educationLevel", "bac dao tao") || String(gradeDetail.data.educationLevel ?? "")],
          ["Loại đào tạo", studentProfileSourceValue(gradeStudentProfile, "", "sourceTrainingType", "trainingType", "loai dao tao") || String(gradeDetail.data.trainingType ?? "")],
          ["Trạng thái SV", gradeStudentProfile?.academicStatus || String(gradeDetail.data.academicStatus ?? "")],
        ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ? label === "Ngày sinh" ? formatDate(String(value)) : String(value) : "—"}</dd></div>)}</dl>
          : activeGradeDetailTab === "results" ? <GradebookResultsPanel records={gradeHistoryRows} fields={module.fields} />
            : <GradebookHistoryPanel records={gradeHistoryRows} />}
      </section>
    </div>}
  </section>;
}
