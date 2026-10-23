import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Archive, Copy, Database, Edit2, Eye, FileUp, KeyRound, Plus, Search, Trash2, X } from "lucide-react";
import * as XLSX from "xlsx";
import StudentForm from "../components/StudentForm";
import { isSupabaseConfigured, supabase } from "../../../lib/supabase";
import { SortableTableHeader } from "../../../components/SortableTableHeader";
import { sortTableRows } from "../../../lib/table-sort";
import { studentService } from "../student.service";
import type { Student, StudentInput } from "../student.types";
import "../students.css";
import { formatDate } from "../../../lib/date-format";
import { academicPeriodMatchesYear, academicYearFromSemester, formatSemesterLabel, groupAcademicPeriods, normalizeAcademicYear, normalizeSemesterName, semesterIdentity, semesterLabelIdentity, semesterMatchesSelection, uniqueAcademicYears } from "../../../lib/semester-groups";
import { signInWithIdentifier } from "../../../lib/auth-login";
import SpreadsheetTransferPanel, { type SpreadsheetValue } from "../../workspace/SpreadsheetTransferPanel";
import QuickFilterHeading from "../../workspace/QuickFilterHeading";
import SearchableFilter from "../../../components/SearchableFilter";
import { moduleByKey, type ModuleField } from "../../workspace/module-definitions";
import { workspaceService, type WorkspaceRecord } from "../../workspace/workspace.service";
import { sourceDataService } from "../../source-data/source-data.service";

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase().trim();
}

function importedRosterData(notes: string) {
  try {
    const parsed = JSON.parse(notes) as { source?: string; details?: Record<string, string>; sourceData?: Record<string, string> };
    if (!['imported-class-rosters', 'manual-student-entry'].includes(parsed.source ?? '')) return { details: {}, sourceData: {} };
    return { details: parsed.details ?? {}, sourceData: parsed.sourceData ?? {} };
  } catch { return { details: {}, sourceData: {} }; }
}
function normalizeStudentCode(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("vi-VN");
}
function rosterField(student: Student, detailKey: string, ...sourceKeys: string[]) {
  const { details, sourceData } = importedRosterData(student.notes);
  const wanted = new Set(sourceKeys.map(normalizeSearch));
  const sourceValue = Object.entries(sourceData).find(([key]) => wanted.has(normalizeSearch(key)))?.[1] ?? "";
  return details[detailKey] || sourceValue || "";
}
function studentNameParts(student: Student) {
  const hoDem = rosterField(student, "", "ho dem", "họ đệm");
  const ten = rosterField(student, "", "ten", "tên");
  if (hoDem || ten) return { hoDem, ten };
  const words = student.fullName.trim().split(/\s+/).filter(Boolean);
  return { hoDem: words.slice(0, -1).join(" "), ten: words.at(-1) ?? "" };
}

const gradeResultFields = moduleByKey.grades.fields.filter((field) => !field.hidden && field.key !== "title");

function StudentGradeResultsPanel({ records, loading, error }: { records: WorkspaceRecord[]; loading: boolean; error: string }) {
  const sortedRecords = [...records].sort((left, right) =>
    String(left.data.courseName ?? "").localeCompare(String(right.data.courseName ?? ""), "vi", { sensitivity: "base", numeric: true })
      || String(left.data.courseCode ?? "").localeCompare(String(right.data.courseCode ?? ""), "vi", { sensitivity: "base", numeric: true })
      || String(left.data.semesterName ?? left.data.semester ?? "").localeCompare(String(right.data.semesterName ?? right.data.semester ?? ""), "vi", { sensitivity: "base", numeric: true }),
  );

  return <section className="student-course-history student-grade-results">
    <div className="student-history-heading"><div><h3>Bảng kết quả học tập</h3><p>Các học phần được sắp xếp theo tên môn học.</p></div><span className="student-history-count">Tổng cộng: {sortedRecords.length} học phần</span></div>
    {loading ? <p>Đang tải kết quả học tập…</p> : error ? <p role="alert" className="students-error">{error}</p> : sortedRecords.length ? <div className="student-grade-results-list">{sortedRecords.map((record, index) => <article className="student-grade-result-card" key={record.id}>
      <h4>{String(record.data.courseName ?? "").trim() || String(record.data.courseCode ?? "").trim() || `Học phần ${index + 1}`}</h4>
      <dl>{gradeResultFields.map((field) => {
        const middle = String(record.data.studentMiddleName ?? "").trim();
        const given = String(record.data.studentGivenName ?? "").trim();
        const words = String(record.data.studentName ?? "").trim().split(/\s+/).filter(Boolean);
        const value = field.key === "ordinal" ? index + 1
          : field.key === "studentMiddleName" ? middle || words.slice(0, -1).join(" ")
            : field.key === "studentGivenName" ? given || words.at(-1) || ""
              : field.key === "lecturer" ? DEFAULT_LECTURER
                : record.data[field.key];
        const text = value === undefined || value === null ? "" : String(value);
        return <div key={field.key}><dt>{field.label}</dt><dd>{text.trim() ? field.kind === "date" ? formatDate(text) : text : "—"}</dd></div>;
      })}<div><dt>Cập nhật</dt><dd>{formatDate(record.updated_at)}</dd></div></dl>
    </article>)}</div> : <p>Chưa tìm thấy kết quả học tập của sinh viên trong Sổ điểm.</p>}
  </section>;
}
const studentTransferFields: ModuleField[] = [
  { key: "studentCode", label: "Mã sinh viên", required: true }, { key: "fullName", label: "Họ và tên", required: true },
  { key: "dateOfBirth", label: "Ngày sinh", kind: "date" }, { key: "className", label: "Lớp sinh hoạt" }, { key: "faculty", label: "Khoa / ngành" },
  { key: "semesterName", label: "Học kỳ" }, { key: "academicStatus", label: "Trạng thái học vụ" }, { key: "email", label: "Email", kind: "email" },
  { key: "phone", label: "Số điện thoại" }, { key: "notes", label: "Ghi chú" },
  { key: "lecturer", label: "Giảng viên" },
];

const DEFAULT_LECTURER = "01011090 - Vũ Trung Nghĩa";
type StudentSortKey = "sequence" | "studentCode" | "hoDem" | "ten" | "gender" | "dateOfBirth" | "phone" | "citizenId" | "email" | "birthplace" | "academicStatus" | "registrationStatus" | "tuitionStatus" | "className" | "registrationDate" | "courseClassCode" | "courseClassName" | "courseCode" | "courseName" | "term" | "academicYear" | "lecturer";
const studentSortHeaders: Array<{ key: Exclude<StudentSortKey, "sequence">; label: string }> = [
  { key: "studentCode", label: "Mã SV" }, { key: "hoDem", label: "Họ đệm" }, { key: "ten", label: "Tên" },
  { key: "gender", label: "Giới tính" }, { key: "dateOfBirth", label: "Ngày sinh" }, { key: "phone", label: "Điện thoại" },
  { key: "citizenId", label: "Số CCCD" }, { key: "email", label: "Email" }, { key: "birthplace", label: "Nơi sinh" },
  { key: "academicStatus", label: "Trạng thái SV" }, { key: "registrationStatus", label: "Trạng thái đăng ký LHP" },
  { key: "tuitionStatus", label: "Học phí" }, { key: "className", label: "Lớp sinh hoạt" }, { key: "registrationDate", label: "Ngày đăng ký" },
  { key: "courseClassCode", label: "Mã LHP" }, { key: "courseClassName", label: "Tên LHP" }, { key: "courseCode", label: "Mã môn học" },
  { key: "courseName", label: "Tên học phần" }, { key: "term", label: "Đợt" }, { key: "academicYear", label: "Năm học" },
  { key: "lecturer", label: "Giảng viên" },
];

function studentSortValue(student: Student, key: Exclude<StudentSortKey, "sequence">) {
  switch (key) {
    case "studentCode": return student.studentCode;
    case "hoDem": return studentNameParts(student).hoDem;
    case "ten": return studentNameParts(student).ten;
    case "gender": return rosterField(student, "gender");
    case "dateOfBirth": return student.dateOfBirth;
    case "phone": return student.phone;
    case "citizenId": return rosterField(student, "citizenId", "so cccd", "cccd");
    case "email": return student.email;
    case "birthplace": return rosterField(student, "birthplace", "noi sinh");
    case "academicStatus": return student.academicStatus;
    case "registrationStatus": return rosterField(student, "registrationStatus", "trang thai dang ky lhp");
    case "tuitionStatus": return rosterField(student, "tuitionStatus", "hoc phi");
    case "className": return rosterField(student, "", "ma lop chu", "lop sinh hoat") || student.className;
    case "registrationDate": return rosterField(student, "registrationDate", "ngay dang ky");
    case "courseClassCode": return rosterField(student, "", "courseClassCode", "ma lhp");
    case "courseClassName": return rosterField(student, "", "courseClassName", "ten lhp");
    case "courseCode": return rosterField(student, "", "courseCode", "subjectCode", "ma mon hoc");
    case "courseName": return rosterField(student, "", "courseName", "subjectName", "ten hoc phan");
    case "term": return rosterField(student, "", "sourceTerm", "dot", "semester") || student.semesterName;
    case "academicYear": return rosterField(student, "", "sourceAcademicYear", "academicYear", "nam hoc");
    case "lecturer": return DEFAULT_LECTURER;
  }
  return "";
}

type StudentCourseRecord = Record<string, string | number | null>;
const studentCourseColumns = [
  { key: "ordinal", label: "STT" }, { key: "courseCode", label: "Mã lớp học phần" }, { key: "courseName", label: "Môn học" },
  { key: "className", label: "Lớp" }, { key: "semesterName", label: "Học kỳ" }, { key: "academicYear", label: "Năm học" },
  { key: "credits", label: "Số tín chỉ" }, { key: "totalScore10", label: "ĐIỂM TỔNG KẾT HỆ 10" }, { key: "letterGrade", label: "ĐIỂM CHỮ" }, { key: "classification", label: "XẾP LOẠI" },
];

function StudentCourseHistoryTable({ courses }: { courses: StudentCourseRecord[] }) {
  const [sortState, setSortState] = useState({ key: "ordinal", direction: "asc" as "asc" | "desc" });
  const sortedCourses = sortTableRows(courses, sortState, (course, key, index) => key === "ordinal" ? index : course[key]);
  function sortBy(key: string) {
    setSortState((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" });
  }
  return <div className="student-course-table-wrap"><table><thead><tr>{studentCourseColumns.map((column) => <SortableTableHeader key={column.key} label={column.label} sortKey={column.key} sortState={sortState} onSort={sortBy} />)}</tr></thead><tbody>{sortedCourses.map((course, index) => <tr key={`${course.courseCode ?? ""}-${course.semesterName ?? ""}-${course.academicYear ?? ""}-${course.className ?? ""}-${index}`}><td>{index + 1}</td><td>{course.courseCode || "—"}</td><td className="student-history-course-name">{course.courseName || "—"}</td><td>{course.className || "—"}</td><td>{formatSemesterLabel(course.semesterName, course.academicYear) || "—"}</td><td>{course.academicYear || "—"}</td><td>{course.credits ?? "—"}</td><td className="student-history-score">{course.totalScore10 ?? "—"}</td><td className="student-history-score">{course.letterGrade || "—"}</td><td>{course.classification || "—"}</td></tr>)}</tbody></table></div>;
}

export default function StudentListPage({ canResetPasswords = false, canImport = false, canImportSourceData = false, canExport = false, canCreate = true, canUpdate = true, canDelete = true, tabPermissions = { profile: true, results: true, history: true } }: { canResetPasswords?: boolean; canImport?: boolean; canImportSourceData?: boolean; canExport?: boolean; canCreate?: boolean; canUpdate?: boolean; canDelete?: boolean; tabPermissions?: { profile: boolean; results: boolean; history: boolean } }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState<"10" | "20" | "50" | "100" | "all">("10");
  const [sortState, setSortState] = useState<{ key: StudentSortKey; direction: "asc" | "desc" }>({ key: "sequence", direction: "asc" });
  const [currentPage, setCurrentPage] = useState(1);
  const [editingStudent, setEditingStudent] = useState<Student>();
  const [selectedStudent, setSelectedStudent] = useState<Student>();
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(() => new Set());
  const [duplicateStudentCodes, setDuplicateStudentCodes] = useState<Array<{ code: string; students: Student[] }> | null>(null);
  const [studentDetailTab, setStudentDetailTab] = useState<"profile" | "results" | "courses">("profile");
  const visibleStudentDetailTabs = [
    ...(tabPermissions.profile ? ["profile" as const] : []),
    ...(tabPermissions.results ? ["results" as const] : []),
    ...(tabPermissions.history ? ["courses" as const] : []),
  ];
  const activeStudentDetailTab = visibleStudentDetailTabs.includes(studentDetailTab) ? studentDetailTab : visibleStudentDetailTabs[0] ?? null;
  function openStudentDetail(student: Student) {
    if (!visibleStudentDetailTabs.length) return;
    setSelectedStudent(student);
    setStudentDetailTab(visibleStudentDetailTabs[0]);
  }
  const [studentGradeRecords, setStudentGradeRecords] = useState<WorkspaceRecord[]>([]);
  const [lecturerCourses, setLecturerCourses] = useState<Array<Record<string, string | number | null>>>([]);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [coursesError, setCoursesError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [resetStudent, setResetStudent] = useState<Student>();
  const [customResetPassword, setCustomResetPassword] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetResult, setResetResult] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [semesterFilter, setSemesterFilter] = useState(() => { const saved = localStorage.getItem("vtn-active-semester") || "all"; return saved === "all" ? saved : normalizeSemesterName(saved); });
  const [genderFilter, setGenderFilter] = useState("all");
  const [academicStatusFilter, setAcademicStatusFilter] = useState("all");
  const [registrationStatusFilter, setRegistrationStatusFilter] = useState("all");
  const [academicYearFilter, setAcademicYearFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [majorFilter, setMajorFilter] = useState("all");
  const [courseNameFilter, setCourseNameFilter] = useState("all");
  const [courseClassNameFilter, setCourseClassNameFilter] = useState("all");
  const rosterInputRef = useRef<HTMLInputElement>(null);
  const [rosterImportBusy, setRosterImportBusy] = useState(false);
  const [sourceDataImportBusy, setSourceDataImportBusy] = useState(false);

  const loadStudents = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setStudents(await studentService.list());
    } catch (loadError) {
      const loadMessage = loadError instanceof Error ? loadError.message : "Không thể tải danh sách sinh viên.";
      setError(loadMessage);
      setNeedsLogin(loadMessage.includes("Phiên đăng nhập"));
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError("");
    try { await signInWithIdentifier(identifier, password); }
    catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Tên đăng nhập/MSSV hoặc mật khẩu không chính xác.");
      setBusy(false);
      return;
    }
    setNeedsLogin(false);
    setPassword("");
    await loadStudents();
    setBusy(false);
  }

  useEffect(() => { void loadStudents(); }, [loadStudents]);
  useEffect(() => {
    if (selectedStudent && activeStudentDetailTab !== studentDetailTab) setStudentDetailTab(activeStudentDetailTab ?? "profile");
  }, [selectedStudent, activeStudentDetailTab, studentDetailTab]);
  useEffect(() => { const update = (event: Event) => { const value = (event as CustomEvent<string>).detail || "all"; setSemesterFilter(value === "all" ? value : normalizeSemesterName(value)); }; window.addEventListener("vtn-semester-filter-changed", update); return () => window.removeEventListener("vtn-semester-filter-changed", update); }, []);
  useEffect(() => {
    if (!selectedStudent || !["results", "courses"].includes(activeStudentDetailTab ?? "")) {
      setStudentGradeRecords([]); setLecturerCourses([]); setCoursesLoading(false); setCoursesError("");
      return;
    }
    let active = true;
    setCoursesLoading(true);
    setCoursesError("");
    setStudentGradeRecords([]);
    setLecturerCourses([]);
    const studentCode = normalizeStudentCode(selectedStudent.studentCode);
    void workspaceService.list("grades").then((gradeRecords) => {
      if (!active) return;
      const studentRecords = gradeRecords.filter((record) => normalizeStudentCode(record.data.studentCode) === studentCode);
      setStudentGradeRecords(studentRecords);
      const rows = studentRecords.filter((record) => {
          const lecturer = normalizeSearch(String(record.data.lecturer ?? ""));
          return !lecturer || lecturer.includes("01011090") || lecturer.includes("vu trung nghia");
        })
        .map((record) => record.data);
      setLecturerCourses(rows);
    }).catch((loadError) => {
      if (active) setCoursesError(loadError instanceof Error ? loadError.message : "Không tải được học phần.");
    }).finally(() => { if (active) setCoursesLoading(false); });
    return () => { active = false; };
  }, [selectedStudent, activeStudentDetailTab]);

  async function handleSave(input: StudentInput) {
    setBusy(true);
    try {
      await studentService.save(input, editingStudent?.id);
      setShowForm(false);
      setEditingStudent(undefined);
      setMessage(editingStudent ? "Đã cập nhật hồ sơ sinh viên." : "Đã thêm sinh viên mới.");
      await loadStudents();
    } finally {
      setBusy(false);
    }
  }

  async function importStudents(items: Array<Record<string, SpreadsheetValue>>) {
    const existing = await studentService.list(); let added = 0; let updated = 0; const seen = new Set<string>();
    for (const item of items) {
      const studentCode = String(item.studentCode ?? "").trim(); const fullName = String(item.fullName ?? "").trim();
      if (!studentCode || !fullName) continue;
      const uniqueCode = studentCode.toLocaleLowerCase("vi-VN"); if (seen.has(uniqueCode)) continue; seen.add(uniqueCode);
      const found = existing.find((student) => student.studentCode.toLocaleLowerCase("vi-VN") === studentCode.toLocaleLowerCase("vi-VN"));
      const input: StudentInput = {
        studentCode, fullName, dateOfBirth: String(item.dateOfBirth ?? ""), className: String(item.className ?? ""), faculty: String(item.faculty ?? ""),
        semesterName: String(item.semesterName ?? ""), academicStatus: String(item.academicStatus ?? "Đang học"), email: String(item.email ?? ""), phone: String(item.phone ?? ""), notes: String(item.notes ?? ""),
      };
      await studentService.save(input, found?.id); if (found) updated += 1; else added += 1;
    }
    if (!added && !updated) throw new Error("Không có hồ sơ hợp lệ. Cần có Mã sinh viên và Họ và tên.");
    setMessage(`Đã nhập ${added + updated} hồ sơ (${added} thêm mới, ${updated} cập nhật).`); await loadStudents();
  }

  async function importClassRosters(files: FileList | File[] | null, archiveFiles = true) {
    if (!files?.length) return;
    setRosterImportBusy(true); setError(""); setMessage("");
    try {
      const records: Array<{ input: StudentInput; details: Record<string, string>; sourceData: Record<string, string>; registrationKey: string; fileName: string }> = [];
      let rosterFiles = 0;
      const clean = (value: unknown) => String(value ?? "").trim();
      const toDate = (value: unknown) => {
        const raw = clean(value); const match = raw.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
        if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
        if (/^\d+(\.\d+)?$/.test(raw)) { const d = XLSX.SSF.parse_date_code(Number(raw)); if (d?.y) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`; }
        return "";
      };
      for (const file of Array.from(files)) {
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
        for (const sheetName of workbook.SheetNames) {
          const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false });
          const headerIndex = matrix.findIndex((row) => {
            const normalized = row.map((cell) => normalizeSearch(clean(cell)).replace(/\s+/g, ""));
            const hasStudentCode = normalized.some((cell) => ["masv", "mssv", "masinhvien", "studentcode"].includes(cell));
            const hasStudentName = normalized.some((cell) => ["hodem", "ten", "hovaten", "hoten", "fullname", "studentname"].includes(cell));
            return hasStudentCode && hasStudentName;
          });
          if (headerIndex < 0) continue;
          const sourceHeaders = matrix[headerIndex].map(clean);
          const headers = sourceHeaders.map(normalizeSearch);
          const indexOf = (...names: string[]) => headers.findIndex((header) => names.includes(header));
          const value = (row: unknown[], ...names: string[]) => { const index = indexOf(...names); return index < 0 ? "" : clean(row[index]); };
          const meta = (rowIndex: number, prefix: string) => (matrix[rowIndex] ?? []).map(clean).find((cell) => normalizeSearch(cell).startsWith(prefix))?.split(":").slice(1).join(":").trim() ?? "";
          const classMeta = meta(4, "lop hoc"); const courseMeta = meta(5, "mon hoc phan"); const semester = meta(4, "dot") || value(matrix[headerIndex], "semestername", "semester", "term", "dot");
          const [courseCode = "", ...courseNameParts] = courseMeta.split(" - "); const [courseClassCode = "", ...classNameParts] = classMeta.split(" - ");
          const faculty = meta(6, "nganh") || value(matrix[headerIndex], "faculty", "khoa"); const major = meta(7, "chuyen nganh") || value(matrix[headerIndex], "major", "chuyen nganh", "nganh"); rosterFiles++;
          for (let offset = 0; offset < matrix.length - headerIndex - 1; offset++) {
            const row = matrix[headerIndex + 1 + offset];
            const studentCode = value(row, "ma sv", "mssv", "ma sinh vien", "studentcode", "student code"); const fullName = [value(row, "ho dem", "studentmiddlename"), value(row, "ten", "studentgivenname")].filter(Boolean).join(" ") || value(row, "ho va ten", "ho ten", "fullname", "full name", "studentname", "student name");
            if (!studentCode || !fullName) continue;
            const email = value(row, "email", "student email"); const schoolEmail = value(row, "mail truong", "email truong", "school email");
            const phone = value(row, "dien thoai", "so dien thoai", "phone", "student phone"); const studentStatus = value(row, "trang thai sv", "trang thai hoc tap", "trang thai hoc vu", "academic status");
            const details = { gender: value(row, "gioi tinh"), citizenId: value(row, "so cccd", "cccd"), birthplace: value(row, "noi sinh"), schoolEmail, registrationStatus: value(row, "trang thai dang ky lhp"), tuitionStatus: value(row, "hoc phi"), registrationDate: toDate(value(row, "ngay dang ky")) || value(row, "ngay dang ky"), registrationSource: value(row, "nguon dang ky"), registeredBy: value(row, "ho ten nguoi dang ky"), academicMajor: faculty, major };
            const sourceData = Object.fromEntries(sourceHeaders.map((header, column) => [header || `Column ${column + 1}`, clean(row[column])]));
            const registrationKey = `${semester}::${file.name}::${sheetName}::${headerIndex + 2 + offset}`;
            records.push({
              input: { studentCode, fullName, dateOfBirth: toDate(value(row, "ngay sinh", "dateofbirth", "date of birth", "dob")), className: value(row, "ma lop chu", "lop sinh hoat", "class name", "classname", "class") || classNameParts.join(" - "), faculty: faculty || major, semesterName: semester, academicStatus: studentStatus || "Đang học", email: email || schoolEmail, phone, notes: "" },
              details: { ...details, academicMajor: faculty, major, educationLevel: meta(6, "bac dao tao"), trainingType: meta(7, "loai dao tao") },
              sourceData: { ...sourceData, sourceClass: classMeta, sourceTerm: semester, sourceCourse: courseMeta, sourceAcademicYear: meta(5, "nam hoc"), sourceFaculty: faculty, sourceEducationLevel: meta(6, "bac dao tao"), sourceMajor: major, sourceTrainingType: meta(7, "loai dao tao"), semester, academicYear: semester.replace(/^HK\s*\d+\s*/i, "").replace(/^NH\s*/i, ""), courseCode, courseName: courseNameParts.join(" - "), courseClassCode, courseClassName: classNameParts.join(" - "), faculty, major },
              registrationKey, fileName: file.name,
            });
          }
        }
      }
      if (!records.length) throw new Error("Không tìm thấy dòng sinh viên. Chọn danh sách lớp học phần có các cột Mã SV, Họ đệm và Tên.");
      if (archiveFiles) {
        for (const file of Array.from(files)) {
          const sourceRows = records.filter((record) => record.fileName === file.name).map((record) => record.sourceData);
          await sourceDataService.archiveImportedFile(file, "student-records", sourceRows);
        }
      }
      const payload = records.map(({ input, details, sourceData, registrationKey }) => ({ ...input, dateOfBirth: input.dateOfBirth || null, sourceRegistrationKey: registrationKey, notes: JSON.stringify({ source: "imported-class-rosters", details, sourceData }) }));
      const batchSize = 500; let inserted = 0; let updated = 0;
      for (let offset = 0; offset < payload.length; offset += batchSize) {
        const batch = payload.slice(offset, offset + batchSize);
        const { data, error: importError } = await supabase!.rpc("import_student_roster", { p_students: batch });
        if (importError) throw importError;
        const result = data as { inserted?: number; updated?: number } | null;
        inserted += result?.inserted ?? 0; updated += result?.updated ?? 0;
        const completed = Math.min(offset + batch.length, payload.length);
        setMessage(`Đang nhập ${completed.toLocaleString("vi-VN")}/${payload.length.toLocaleString("vi-VN")} dòng…`);
      }
      localStorage.setItem("vtn-active-semester", "all");
      window.dispatchEvent(new CustomEvent("vtn-semester-filter-changed", { detail: "all" }));
      setMessage(`Đã nhập ${records.length.toLocaleString("vi-VN")} bản ghi đăng ký riêng từ ${rosterFiles} tệp (không gộp MSSV; ${inserted.toLocaleString("vi-VN")} thêm mới, ${updated.toLocaleString("vi-VN")} cập nhật khi nhập lại). Các tệp tổng hợp học kỳ không có danh sách được bỏ qua.`);
      await loadStudents();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể nhập danh sách lớp học phần."); }
    finally { setRosterImportBusy(false); if (rosterInputRef.current) rosterInputRef.current.value = ""; }
  }

  async function importStudentSourceData() {
    if (!canImport || !canImportSourceData || !isSupabaseConfigured || sourceDataImportBusy) return;
    setSourceDataImportBusy(true);
    setError("");
    setMessage("");
    try {
      const sourceRows = await sourceDataService.list("student-records");
      if (sourceRows.length) {
        const importedRows = sourceRows.map((record) => {
          const row = Object.fromEntries(Object.entries(record.data).filter(([key]) => !key.startsWith("_source")));
          const read = (...keys: string[]) => {
            const wanted = new Set(keys.map((key) => normalizeSearch(key).replace(/\s+/g, "")));
            return Object.entries(row).find(([key, value]) => wanted.has(normalizeSearch(key).replace(/\s+/g, "")) && String(value ?? "").trim())?.[1]?.toString().trim() ?? "";
          };
          const dateValue = read("dateOfBirth", "ngay sinh", "dob");
          const dateParts = dateValue.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
          const dateOfBirth = dateParts
            ? `${dateParts[3]}-${dateParts[2].padStart(2, "0")}-${dateParts[1].padStart(2, "0")}`
            : /^\d+(\.\d+)?$/.test(dateValue) && Number(dateValue) > 1000
              ? (() => { const date = XLSX.SSF.parse_date_code(Number(dateValue)); return date?.y ? `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}` : dateValue; })()
              : dateValue;
          const fullName = read("fullName", "ho va ten", "ho ten", "studentName") || [read("ho dem", "middleName"), read("ten", "givenName")].filter(Boolean).join(" ");
          const notes = read("notes", "ghi chu") || JSON.stringify({ source: "source-data", sourceData: row });
          return {
            studentCode: read("studentCode", "ma sinh vien", "ma sv", "mssv"), fullName, dateOfBirth,
            className: read("className", "lop sinh hoat", "ma lop chu", "lop"), faculty: read("faculty", "khoa", "nganh", "academicMajor"),
            semesterName: read("semesterName", "semester", "sourceTerm", "term", "dot"), academicStatus: read("academicStatus", "trang thai hoc vu", "trang thai sv", "trang thai hoc tap") || "Đang học",
            email: read("email", "mail truong", "email truong"), phone: read("phone", "dien thoai", "so dien thoai"), notes,
          };
        });
        await importStudents(importedRows);
        return;
      }

      const storedFiles = await sourceDataService.listFiles();
      const rosterFiles = storedFiles.filter((file) => {
        if (file.deleted_at) return false;
        try {
          const classifications = JSON.parse(String(file.data.extractedClassifications ?? "[]")) as Array<{ categoryKey?: string }>;
          return classifications.some((item) => item.categoryKey === "student-records");
        } catch { return false; }
      });
      if (!rosterFiles.length) throw new Error("Chưa có dữ liệu sinh viên trong Dữ liệu nguồn. Hãy nhập tệp danh sách lớp học phần trước.");
      const files: File[] = [];
      for (const storedFile of rosterFiles) {
        const fileName = String(storedFile.data.fileName ?? "").trim();
        const storagePath = String(storedFile.data.storagePath ?? "").trim();
        if (!fileName || !storagePath) continue;
        const blob = await sourceDataService.downloadOriginalFile(storagePath);
        files.push(new File([blob], fileName, { type: String(storedFile.data.contentType ?? blob.type ?? "application/octet-stream") }));
      }
      if (!files.length) throw new Error("Không tìm thấy tệp danh sách sinh viên có thể nhập.");
      await importClassRosters(files, false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể lấy dữ liệu sinh viên từ nguồn.");
    } finally {
      setSourceDataImportBusy(false);
    }
  }

  async function handleTrash(student: Student) {
    if (!window.confirm(`Chuyển hồ sơ ${student.fullName} (${student.studentCode}) vào thùng rác?`)) return;
    setBusy(true);
    setError("");
    try {
      await studentService.moveToTrash(student.id);
      setSelectedStudentIds((previous) => { const next = new Set(previous); next.delete(student.id); return next; });
      setMessage(`Đã chuyển ${student.fullName} vào thùng rác.`);
      await loadStudents();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Không thể chuyển sinh viên vào thùng rác.");
    } finally {
      setBusy(false);
    }
  }


  function toggleStudentSelection(studentId: string) {
    setSelectedStudentIds((previous) => {
      const next = new Set(previous);
      if (next.has(studentId)) next.delete(studentId); else next.add(studentId);
      return next;
    });
  }

  function toggleAllVisibleStudents() {
    setSelectedStudentIds((previous) => {
      const next = new Set(previous);
      if (filteredStudents.every((student) => next.has(student.id))) filteredStudents.forEach((student) => next.delete(student.id));
      else filteredStudents.forEach((student) => next.add(student.id));
      return next;
    });
  }

  async function handleBulkTrash(removeAll = false) {
    const targets = removeAll ? students : students.filter((student) => selectedStudentIds.has(student.id));
    if (!targets.length) return;
    const description = removeAll ? "toàn bộ hồ sơ sinh viên" : `${targets.length.toLocaleString("vi-VN")} hồ sơ sinh viên đã chọn`;
    const confirmed = window.confirm(`Chuyển ${description} vào thùng rác?`);
    if (!confirmed) return;
    setBusy(true);
    setError("");
    let moved = 0;
    const failures: string[] = [];
    try {
      for (const student of targets) {
        try { await studentService.moveToTrash(student.id);
      setSelectedStudentIds((previous) => { const next = new Set(previous); next.delete(student.id); return next; }); moved += 1; }
        catch { failures.push(`${student.studentCode} - ${student.fullName}`); }
      }
      setSelectedStudentIds(new Set());
      if (failures.length) {
        setError(`Đã chuyển ${moved} hồ sơ vào thùng rác; ${failures.length} hồ sơ chưa xóa được: ${failures.slice(0, 5).join(", ")}${failures.length > 5 ? "…" : ""}`);
      } else setMessage(`Đã chuyển ${moved.toLocaleString("vi-VN")} hồ sơ vào thùng rác.`);
      await loadStudents();
    } finally { setBusy(false); }
  }

  async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase || !resetStudent) return;
    setResetBusy(true); setError(""); setResetResult("");
    const { data, error: resetError } = await supabase.functions.invoke("swift-api", { body: { action: "reset-student-password", studentId: resetStudent.id, password: customResetPassword ? resetPassword : "" } });
    setResetBusy(false);
    if (resetError || data?.error) { setError(data?.error ?? resetError?.message ?? "Không thể đặt lại mật khẩu."); return; }
    setResetResult(String(data?.password ?? "")); setMessage(`Đã đặt lại mật khẩu cho ${resetStudent.fullName}.`); setResetPassword("");
  }

  const filterOptions = useMemo(() => {
    const distinct = (getValue: (student: Student) => string) => [...new Set(students.map(getValue).map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi"));
    return {
      semesters: [...new Map(distinct((student) => rosterField(student, "", "sourceTerm", "Đợt", "semester") || student.semesterName).map(normalizeSemesterName).filter(Boolean).map((name) => [semesterIdentity(name), name])).values()],
      academicStatuses: distinct((student) => student.academicStatus),
      genders: distinct((student) => rosterField(student, "gender", "gender", "gioi tinh")),
      registrationStatuses: distinct((student) => rosterField(student, "registrationStatus", "trang thai dang ky lhp")),
      academicYears: distinct((student) => rosterField(student, "", "sourceAcademicYear", "Năm học", "academicYear")),
      majors: distinct((student) => rosterField(student, "academicMajor", "sourceFaculty", "Ngành") || student.faculty),
      courseNames: distinct((student) => rosterField(student, "", "courseName", "subjectName", "Tên học phần", "Tên môn học")),
      courseClassNames: distinct((student) => rosterField(student, "", "courseClassName", "Tên LHP")),
      classes: distinct((student) => rosterField(student, "className", "homeroomClass", "Mã lớp chủ", "Lớp sinh hoạt", "className") || student.className),
    };
  }, [students]);
  const studentAcademicPeriods = useMemo(() => students.map((student) => ({
    academicYear: rosterField(student, "", "sourceAcademicYear", "Năm học", "academicYear") || academicYearFromSemester(rosterField(student, "", "sourceTerm", "Đợt", "semester") || student.semesterName),
    semesterName: rosterField(student, "", "sourceTerm", "Đợt", "semester") || student.semesterName,
  })).filter((period) => period.semesterName), [students]);
  const semesterGroups = groupAcademicPeriods(studentAcademicPeriods);
  const visibleSemesterGroups = academicYearFilter === "all" ? semesterGroups : semesterGroups.filter((group) => normalizeAcademicYear(group.academicYear) === normalizeAcademicYear(academicYearFilter));
  const academicYearOptions = uniqueAcademicYears([...filterOptions.academicYears, ...studentAcademicPeriods.map((period) => period.academicYear)]);

  const filteredStudents = useMemo(() => {
    const keyword = normalizeSearch(search);
    return students.filter((student) => {
      const source = importedRosterData(student.notes);
      const searchable = normalizeSearch([
        student.studentCode, student.fullName, student.phone, student.email, student.className, student.faculty, student.semesterName, student.academicStatus,
        ...Object.values(source.details), ...Object.values(source.sourceData),
      ].join(" "));
      const term = rosterField(student, "", "sourceTerm", "Đợt", "semester") || student.semesterName;
      const year = rosterField(student, "", "sourceAcademicYear", "Năm học", "academicYear");
      const className = rosterField(student, "className", "homeroomClass", "Mã lớp chủ", "Lớp sinh hoạt", "className") || student.className;
      const major = rosterField(student, "academicMajor", "sourceFaculty", "Ngành") || student.faculty;
      const gender = rosterField(student, "gender", "gender", "gioi tinh");
      const registrationStatus = rosterField(student, "registrationStatus", "trang thai dang ky lhp");
      const courseName = rosterField(student, "", "courseName", "subjectName", "Tên học phần", "Tên môn học");
      const courseClassName = rosterField(student, "", "courseClassName", "Tên LHP");
      return (!keyword || searchable.includes(keyword))
        && (semesterFilter === "all" || semesterMatchesSelection(term, year, semesterFilter))
        && (academicStatusFilter === "all" || student.academicStatus === academicStatusFilter)
        && (genderFilter === "all" || gender === genderFilter)
        && (registrationStatusFilter === "all" || registrationStatus === registrationStatusFilter)
        && (academicYearFilter === "all" || academicPeriodMatchesYear(term, year, academicYearFilter, studentAcademicPeriods))
        && (classFilter === "all" || className === classFilter)
        && (majorFilter === "all" || major === majorFilter)
        && (courseNameFilter === "all" || courseName === courseNameFilter)
        && (courseClassNameFilter === "all" || courseClassName === courseClassNameFilter);
    });
  }, [students, search, semesterFilter, genderFilter, academicStatusFilter, registrationStatusFilter, academicYearFilter, classFilter, majorFilter, courseNameFilter, courseClassNameFilter, studentAcademicPeriods]);

  const sortedStudents = useMemo(() => {
    const originalOrder = new Map(students.map((student, index) => [student.id, index]));
    const multiplier = sortState.direction === "asc" ? 1 : -1;
    return [...filteredStudents].sort((left, right) => {
      if (sortState.key === "sequence") return ((originalOrder.get(left.id) ?? 0) - (originalOrder.get(right.id) ?? 0)) * multiplier;
      const leftValue = studentSortValue(left, sortState.key).trim();
      const rightValue = studentSortValue(right, sortState.key).trim();
      if (sortState.key === "dateOfBirth" || sortState.key === "registrationDate") {
        const toSortableDate = (value: string) => {
          const dmy = value.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
          return dmy ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : value;
        };
        return toSortableDate(leftValue).localeCompare(toSortableDate(rightValue)) * multiplier;
      }
      return leftValue.localeCompare(rightValue, "vi", { sensitivity: "base", numeric: true }) * multiplier;
    });
  }, [filteredStudents, students, sortState]);

  const pageCount = pageSize === "all" ? 1 : Math.max(1, Math.ceil(sortedStudents.length / Number(pageSize)));
  const safePage = Math.min(currentPage, pageCount);
  const pageStartIndex = pageSize === "all" ? 0 : (safePage - 1) * Number(pageSize);
  const pageStudents = pageSize === "all" ? sortedStudents : sortedStudents.slice(pageStartIndex, pageStartIndex + Number(pageSize));
  const allVisibleSelected = filteredStudents.length > 0 && filteredStudents.every((student) => selectedStudentIds.has(student.id));
  const someVisibleSelected = filteredStudents.some((student) => selectedStudentIds.has(student.id));
  useEffect(() => { setCurrentPage((page) => Math.min(page, pageCount)); }, [pageCount]);
  useEffect(() => { setCurrentPage(1); }, [search, semesterFilter, genderFilter, academicStatusFilter, registrationStatusFilter, academicYearFilter, classFilter, majorFilter, courseNameFilter, courseClassNameFilter]);
  useEffect(() => { setSelectedStudentIds(new Set()); }, [search, semesterFilter, genderFilter, academicStatusFilter, registrationStatusFilter, academicYearFilter, classFilter, majorFilter, courseNameFilter, courseClassNameFilter]);

  function clearStudentFilters() {
    setSearch(""); setSemesterFilter("all"); setGenderFilter("all"); setAcademicStatusFilter("all"); setRegistrationStatusFilter("all"); setAcademicYearFilter("all"); setClassFilter("all"); setMajorFilter("all"); setCourseNameFilter("all"); setCourseClassNameFilter("all");
    localStorage.setItem("vtn-active-semester", "all");
    window.dispatchEvent(new CustomEvent("vtn-semester-filter-changed", { detail: "all" }));
  }

  function chooseAcademicYear(nextYear: string) {
    setAcademicYearFilter(nextYear);
    const validSemesters = nextYear === "all" ? [] : semesterGroups.find((group) => normalizeAcademicYear(group.academicYear) === normalizeAcademicYear(nextYear))?.semesters ?? [];
    const selectedSemesterYear = academicYearFromSemester(semesterFilter);
    if (semesterFilter !== "all" && nextYear !== "all" && (!validSemesters.some((item) => semesterLabelIdentity(item) === semesterLabelIdentity(semesterFilter)) || (selectedSemesterYear && normalizeAcademicYear(selectedSemesterYear) !== normalizeAcademicYear(nextYear)))) {
      setSemesterFilter("all");
      localStorage.setItem("vtn-active-semester", "all");
      window.dispatchEvent(new CustomEvent("vtn-semester-filter-changed", { detail: "all" }));
    }
  }

  function checkDuplicateStudentCodes() {
    const grouped = new Map<string, Student[]>();
    for (const student of students) {
      const code = String(student.studentCode ?? "").trim().toLocaleUpperCase("vi-VN");
      if (!code) continue;
      grouped.set(code, [...(grouped.get(code) ?? []), student]);
    }
    setDuplicateStudentCodes([...grouped.entries()]
      .filter(([, matches]) => matches.length > 1)
      .map(([code, matches]) => ({ code, students: matches })));
  }

  function renderSortableHeader(label: string, key: StudentSortKey) {
    const active = sortState.key === key;
    const direction = active ? sortState.direction : undefined;
    return <th key={key} aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}><button className="students-sort-header" type="button" onClick={() => { setSortState((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }); setCurrentPage(1); }}>{label}<span aria-hidden="true">{direction === "asc" ? "↑" : direction === "desc" ? "↓" : "↕"}</span></button></th>;
  }

  return (
    <main className="students-page">
      <section className="students-content">
        <div className="students-breadcrumb">Quản lý <span>/</span> Sinh viên</div>
        <div className="students-header">
          <div><h1>Quản lý sinh viên</h1><p>Quản lý hồ sơ và thông tin sinh viên của bạn.</p></div>
          {(canCreate || canImportSourceData) && <div className="students-header-actions">
            {canImportSourceData && <button className="students-secondary" type="button" disabled={!canImport || !isSupabaseConfigured || sourceDataImportBusy || rosterImportBusy || busy} onClick={() => void importStudentSourceData()}><Database size={16} />{sourceDataImportBusy || rosterImportBusy ? "Đang lấy dữ liệu…" : "Lấy dữ liệu nguồn"}</button>}
            {canCreate && <button className="students-primary" type="button" disabled={!isSupabaseConfigured || busy} onClick={() => { setEditingStudent(undefined); setShowForm(true); setMessage(""); }}><Plus size={17} /> Thêm sinh viên</button>}
          </div>}
        </div>

        {!isSupabaseConfigured && <div className="students-notice" role="alert">Chưa cấu hình Supabase. Tạo <code>.env.local</code> với <code>VITE_SUPABASE_URL</code> và <code>VITE_SUPABASE_ANON_KEY</code>, sau đó khởi động lại ứng dụng.</div>}
        {error && <div className="students-error" role="alert">{error}<button type="button" aria-label="Đóng thông báo" onClick={() => setError("")}><X size={16} /></button></div>}
        {message && <p className="students-success" role="status">{message}</p>}

        {needsLogin && <form className="student-form students-login" onSubmit={handleLogin}><h2>Đăng nhập</h2><p>Dùng tên tài khoản, mã sinh viên hoặc email và mật khẩu.</p><div className="student-form-grid"><label>Tên đăng nhập hoặc MSSV<input type="text" autoComplete="username" required value={identifier} onChange={(event) => setIdentifier(event.target.value)} /></label><label>Mật khẩu<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label></div><button className="students-primary" type="submit" disabled={busy}>Đăng nhập</button></form>}

        {showForm && <div className="students-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) { setShowForm(false); setEditingStudent(undefined); } }}><div className="students-edit-modal" role="dialog" aria-modal="true" aria-label={editingStudent ? "Chỉnh sửa hồ sơ sinh viên" : "Thêm sinh viên"}><button type="button" className="students-edit-close" aria-label="Đóng biểu mẫu" disabled={busy} onClick={() => { setShowForm(false); setEditingStudent(undefined); }}><X size={19} /></button><StudentForm key={editingStudent?.id ?? "new"} student={editingStudent} onSave={handleSave} onCancel={() => { setShowForm(false); setEditingStudent(undefined); }} /></div></div>}

        
        
        <div className="students-filterbar" aria-label="Bộ lọc sinh viên">
          <QuickFilterHeading onClear={clearStudentFilters} clearDisabled={!search && semesterFilter === "all" && genderFilter === "all" && academicStatusFilter === "all" && registrationStatusFilter === "all" && academicYearFilter === "all" && classFilter === "all" && majorFilter === "all" && courseNameFilter === "all" && courseClassNameFilter === "all"} />
          <label>Năm học<SearchableFilter value={academicYearFilter} allValue="all" allLabel="Tất cả năm học" options={academicYearOptions.map((item) => ({ value: item, label: item }))} onChange={chooseAcademicYear} /></label>
          <label>Học kỳ<SearchableFilter value={semesterFilter} allValue="all" allLabel="Tất cả học kỳ" options={[...(semesterFilter !== "all" && !visibleSemesterGroups.some((group) => group.semesters.includes(semesterFilter)) ? [{ value: semesterFilter, label: semesterFilter }] : []), ...visibleSemesterGroups.flatMap((group) => group.semesters.map((item) => ({ value: item, label: item })))]} onChange={(rawValue) => { const value = rawValue === "all" ? rawValue : normalizeSemesterName(rawValue); setSemesterFilter(value); localStorage.setItem("vtn-active-semester", value); window.dispatchEvent(new CustomEvent("vtn-semester-filter-changed", { detail: value })); }} /></label>
          <label>Ngành<SearchableFilter value={majorFilter} allValue="all" allLabel="Tất cả ngành" options={filterOptions.majors.map((item) => ({ value: item, label: item }))} onChange={setMajorFilter} /></label>
          <label>Tên học phần<SearchableFilter value={courseNameFilter} allValue="all" allLabel="Tất cả học phần" options={filterOptions.courseNames.map((item) => ({ value: item, label: item }))} onChange={setCourseNameFilter} /></label>
          <label>Tên LHP<SearchableFilter value={courseClassNameFilter} allValue="all" allLabel="Tất cả LHP" options={filterOptions.courseClassNames.map((item) => ({ value: item, label: item }))} onChange={setCourseClassNameFilter} /></label>
          <label>Lớp sinh hoạt<SearchableFilter value={classFilter} allValue="all" allLabel="Tất cả lớp sinh hoạt" options={filterOptions.classes.map((item) => ({ value: item, label: item }))} onChange={setClassFilter} /></label>
          <label>Giới tính<SearchableFilter value={genderFilter} allValue="all" allLabel="Tất cả giới tính" options={filterOptions.genders.map((item) => ({ value: item, label: item }))} onChange={setGenderFilter} /></label>
          <label>Trạng thái SV<SearchableFilter value={academicStatusFilter} allValue="all" allLabel="Tất cả trạng thái" options={filterOptions.academicStatuses.map((item) => ({ value: item, label: item }))} onChange={setAcademicStatusFilter} /></label>
          <label>Trạng thái đăng ký LHP<SearchableFilter value={registrationStatusFilter} allValue="all" allLabel="Tất cả đăng ký" options={filterOptions.registrationStatuses.map((item) => ({ value: item, label: item }))} onChange={setRegistrationStatusFilter} /></label>
          
        </div>
        {canImport && <section className="spreadsheet-transfer workspace-panel"><div><strong>Nhập danh sách lớp học phần</strong><p>Chọn nhiều tệp .xls cùng lúc. Hệ thống gộp theo MSSV, lưu lịch sử đăng ký môn học và bỏ qua các tệp tổng hợp học kỳ.</p></div><div className="spreadsheet-transfer-actions"><button type="button" disabled={rosterImportBusy || !isSupabaseConfigured} onClick={() => rosterInputRef.current?.click()}><FileUp size={15} />{rosterImportBusy ? "Đang nhập danh sách…" : "Nhập nhiều tệp .xls"}</button><input ref={rosterInputRef} hidden multiple type="file" accept=".xls,.xlsx" onChange={(event) => void importClassRosters(event.target.files)} /></div></section>}
        <SpreadsheetTransferPanel title="Sinh viên" fields={studentTransferFields} rows={filteredStudents.map((student) => ({ ...student, lecturer: DEFAULT_LECTURER }) as unknown as Record<string, unknown>)} canImport={canImport} canExport={canExport} onImport={importStudents} onArchiveFiles={async (files) => { for (const item of files) await sourceDataService.archiveImportedFile(item.file, "student-records", item.rows); }} />
        {duplicateStudentCodes !== null && <section className="students-duplicate-report" role="status" aria-live="polite">
          <div><strong>{duplicateStudentCodes.length ? "Tìm thấy " + duplicateStudentCodes.length + " mã sinh viên bị trùng" : "Không tìm thấy mã sinh viên bị trùng"}</strong><button type="button" onClick={() => setDuplicateStudentCodes(null)}>Đóng</button></div>
          {duplicateStudentCodes.length > 0 && <ul>{duplicateStudentCodes.map(({ code, students: matches }) => <li key={code}>
            <div className="students-duplicate-code"><span>Mã sinh viên:</span>{visibleStudentDetailTabs.length > 0 ? <button type="button" className="students-duplicate-student-link" aria-label={`Xem thông tin sinh viên ${code}`} onClick={() => { const student = matches[0]; if (student) openStudentDetail(student); }}>{code}</button> : <strong>{code}</strong>}</div>
            <div className="students-duplicate-course-list">
              <div className="students-duplicate-course-row students-duplicate-course-heading"><strong>Họ và tên</strong><strong>Lớp sinh hoạt</strong><strong>Mã học phần</strong><strong>Tên học phần</strong><strong>Học kỳ</strong></div>
              {matches.map((student, index) => {
                const className = rosterField(student, "", "ma lop chu", "lop sinh hoat") || student.className;
                const courseCode = rosterField(student, "", "courseCode", "subjectCode", "ma hoc phan", "ma mon hoc");
                const courseName = rosterField(student, "", "courseName", "subjectName", "ten hoc phan", "ten mon hoc");
                const semester = rosterField(student, "", "sourceTerm", "dot", "semester") || student.semesterName; const semesterYear = rosterField(student, "", "sourceAcademicYear", "academicYear", "nam hoc", "năm học");
                return <div className="students-duplicate-course-row" key={student.id + "-" + index}><span>{student.fullName || "—"}</span><span>{className || "—"}</span><span>{courseCode || "—"}</span><span>{courseName || "—"}</span><span>{formatSemesterLabel(semester, semesterYear) || "—"}</span></div>;
              })}
            </div>
          </li>)}</ul>}
        </section>}
        <div className="students-toolbar"><div className="students-search-wrap"><Search size={17} /><input aria-label="Tìm nhanh hồ sơ sinh viên" placeholder="Tìm MSSV, họ tên, điện thoại, email, CCCD, lớp, môn…" value={search} onChange={(event) => setSearch(event.target.value)} /></div><span>{loading ? "Đang tải..." : `${filteredStudents.length.toLocaleString("vi-VN")} / ${students.length.toLocaleString("vi-VN")} sinh viên`}</span><button type="button" disabled={loading || !students.length} onClick={checkDuplicateStudentCodes}><Search size={15} />Kiểm tra trùng mã SV</button></div>

        <div className="students-bulk-toolbar"><label><input type="checkbox" aria-label="Chọn tất cả sinh viên phù hợp" checked={allVisibleSelected} ref={(element) => { if (element) element.indeterminate = someVisibleSelected && !allVisibleSelected; }} disabled={!filteredStudents.length || busy} onChange={toggleAllVisibleStudents} /> Chọn tất cả {filteredStudents.length.toLocaleString("vi-VN")} dòng phù hợp</label><div className="students-bulk-actions"><button type="button" disabled={!selectedStudentIds.size || busy} onClick={() => void handleBulkTrash()}><Trash2 size={16} />Xóa đã chọn ({selectedStudentIds.size})</button><button type="button" disabled={!students.length || busy} onClick={() => void handleBulkTrash(true)}><Trash2 size={16} />Xóa tất cả ({students.length})</button></div></div><div className="students-pagination"><label>Số dòng<select value={pageSize} onChange={(event) => { setPageSize(event.target.value as "10" | "20" | "50" | "100" | "all"); setCurrentPage(1); }}><option value="10">10 dòng</option><option value="20">20 dòng</option><option value="50">50 dòng</option><option value="100">100 dòng</option><option value="all">Tất cả</option></select></label><span>{filteredStudents.length ? `${pageStartIndex + 1}–${Math.min(pageStartIndex + pageStudents.length, filteredStudents.length)} / ${filteredStudents.length} dòng` : "Đang hiển thị 0–0 / 0 dòng"}</span><div><button type="button" disabled={safePage <= 1 || busy} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>Trước</button><span>Trang {safePage} / {pageCount}</span><button type="button" disabled={safePage >= pageCount || busy} onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}>Sau</button></div></div><div className="students-table-wrapper"><table>
          <thead><tr><th aria-sort={sortState.key === "sequence" ? (sortState.direction === "asc" ? "ascending" : "descending") : "none"}><div className="students-select-header"><input type="checkbox" aria-label="Chọn tất cả sinh viên phù hợp" checked={allVisibleSelected} ref={(element) => { if (element) element.indeterminate = someVisibleSelected && !allVisibleSelected; }} disabled={!filteredStudents.length || busy} onChange={toggleAllVisibleStudents} /><button className="students-sort-header" type="button" onClick={() => { setSortState((current) => current.key === "sequence" ? { key: "sequence", direction: current.direction === "asc" ? "desc" : "asc" } : { key: "sequence", direction: "asc" }); setCurrentPage(1); }}>STT<span aria-hidden="true">{sortState.key === "sequence" ? (sortState.direction === "asc" ? "↑" : "↓") : "↕"}</span></button></div></th>{studentSortHeaders.map(({ key, label }) => renderSortableHeader(label, key))}<th>THAO TÁC</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={23} className="students-state"><span className="students-spinner" />Đang tải danh sách sinh viên...</td></tr>}
            {!loading && !error && pageStudents.map((student, index) => { const name = studentNameParts(student); return <tr key={student.id}>
              <td><label className="students-select-row"><input type="checkbox" aria-label={`Chọn ${student.studentCode} ${student.fullName}`} checked={selectedStudentIds.has(student.id)} disabled={busy} onChange={() => toggleStudentSelection(student.id)} />{pageStartIndex + index + 1}</label></td><td>{visibleStudentDetailTabs.length > 0 ? <button type="button" className="students-code-link" onClick={() => openStudentDetail(student)} aria-label={`Xem hồ sơ sinh viên ${student.studentCode}`}>{student.studentCode}</button> : <strong>{student.studentCode}</strong>}</td><td className="students-name">{name.hoDem || "—"}</td><td className="students-name">{name.ten || "—"}</td>
              <td>{rosterField(student, "gender") || "—"}</td><td>{student.dateOfBirth ? formatDate(student.dateOfBirth) : "—"}</td><td>{student.phone || "—"}</td><td>{rosterField(student, "citizenId", "so cccd", "cccd") || "—"}</td><td>{student.email || "—"}</td><td>{rosterField(student, "birthplace", "noi sinh") || "—"}</td>
              <td>{student.academicStatus || "—"}</td><td>{rosterField(student, "registrationStatus", "trang thai dang ky lhp") || "—"}</td><td>{rosterField(student, "tuitionStatus", "hoc phi") || "—"}</td><td>{rosterField(student, "", "ma lop chu", "mã lớp chữ", "lop sinh hoat") || student.className || "—"}</td><td>{rosterField(student, "registrationDate", "ngay dang ky") ? formatDate(rosterField(student, "registrationDate", "ngay dang ky")) : "—"}</td>
              <td>{rosterField(student, "", "courseClassCode", "ma lhp", "mã lhp") || "—"}</td><td>{rosterField(student, "", "courseClassName", "ten lhp", "tên lhp") || "—"}</td><td>{rosterField(student, "", "courseCode", "subjectCode", "ma mon hoc", "mã môn học") || "—"}</td><td>{rosterField(student, "", "courseName", "subjectName", "ten hoc phan", "tên học phần") || "—"}</td><td>{formatSemesterLabel(rosterField(student, "", "sourceTerm", "dot", "đợt", "semester") || student.semesterName, rosterField(student, "", "sourceAcademicYear", "academicYear", "nam hoc", "năm học")) || "—"}</td><td>{rosterField(student, "", "sourceAcademicYear", "academicYear", "nam hoc", "năm học") || "—"}</td><td>{DEFAULT_LECTURER}</td><td><div className="students-row-actions">{visibleStudentDetailTabs.length > 0 && <button type="button" title="Xem hồ sơ" aria-label={`Xem hồ sơ ${student.fullName}`} onClick={() => setSelectedStudent(student)}><Eye size={17} /></button>}{canUpdate && <button type="button" title="Chỉnh sửa" aria-label={`Chỉnh sửa ${student.fullName}`} onClick={() => { setEditingStudent(student); setShowForm(true); }}><Edit2 size={16} /></button>}{canResetPasswords && <button type="button" title="Đặt lại mật khẩu" aria-label={`Đặt lại mật khẩu ${student.fullName}`} disabled={busy} onClick={() => { setResetStudent(student); setCustomResetPassword(false); setResetResult(""); setResetPassword(""); }}><KeyRound size={16} /></button>}{canDelete && <button type="button" title="Chuyển vào thùng rác" aria-label={`Chuyển ${student.fullName} vào thùng rác`} disabled={busy} onClick={() => void handleTrash(student)}><Trash2 size={16} /></button>}</div></td>
            </tr>; })}
            {!loading && !error && filteredStudents.length === 0 && <tr><td colSpan={23} className="students-state"><div className="students-empty-icon"><Archive size={22} /></div><strong>{search ? "Không tìm thấy sinh viên" : "Chưa có sinh viên nào"}</strong><span>{search ? "Thử tìm bằng mã sinh viên hoặc họ tên khác." : "Thêm hồ sơ đầu tiên để bắt đầu quản lý."}</span></td></tr>}
            {!loading && error && <tr><td colSpan={23} className="students-state">Không thể hiển thị dữ liệu. Kiểm tra kết nối rồi tải lại.</td></tr>}
          </tbody>
        </table></div>
        {error && <button type="button" className="students-retry" onClick={() => void loadStudents()}>Thử tải lại</button>}
      </section>

        {selectedStudent && <div className="students-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedStudent(undefined); }}>
          <section className="students-detail students-profile-dialog students-grade-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="student-detail-title">
            <div className="students-detail-header"><div><span>HỒ SƠ SINH VIÊN</span><h2 id="student-detail-title">{selectedStudent.fullName}</h2><p>Mã SV: {selectedStudent.studentCode}</p></div><button type="button" aria-label="Đóng hồ sơ" onClick={() => setSelectedStudent(undefined)}><X size={19} /></button></div>
            <div className="student-detail-tabs" role="tablist">
              {tabPermissions.profile && <button type="button" role="tab" aria-selected={activeStudentDetailTab === "profile"} className={activeStudentDetailTab === "profile" ? "active" : ""} onClick={() => setStudentDetailTab("profile")}>1. Thông tin sinh viên</button>}
              {tabPermissions.results && <button type="button" role="tab" aria-selected={activeStudentDetailTab === "results"} className={activeStudentDetailTab === "results" ? "active" : ""} onClick={() => setStudentDetailTab("results")}>2. Bảng kết quả học tập</button>}
              {tabPermissions.history && <button type="button" role="tab" aria-selected={activeStudentDetailTab === "courses"} className={activeStudentDetailTab === "courses" ? "active" : ""} onClick={() => setStudentDetailTab("courses")}>3. Lịch sử theo học</button>}
            </div>
            {!activeStudentDetailTab ? <p>Bạn chưa được cấp quyền xem các tab thông tin sinh viên.</p> : activeStudentDetailTab === "profile" ? <><dl className="student-info-fields">{[
              ["Mã sinh viên", selectedStudent.studentCode],
              ["Họ và tên", selectedStudent.fullName],
              ["Giới tính", rosterField(selectedStudent, "gender", "gioi tinh")],
              ["Ngày sinh", selectedStudent.dateOfBirth ? formatDate(selectedStudent.dateOfBirth) : ""],
              ["Số điện thoại", selectedStudent.phone],
              ["Số CCCD", rosterField(selectedStudent, "citizenId", "so cccd", "cccd")],
              ["Email", selectedStudent.email],
              ["Nơi sinh", rosterField(selectedStudent, "birthplace", "noi sinh")],
              ["Lớp sinh hoạt", rosterField(selectedStudent, "", "ma lop chu", "lop sinh hoat") || selectedStudent.className],
              ["Ngành", rosterField(selectedStudent, "academicMajor", "sourceFaculty", "academicMajor", "nganh") || selectedStudent.faculty],
              ["Bậc đào tạo", rosterField(selectedStudent, "", "sourceEducationLevel", "educationLevel", "bac dao tao")],
              ["Loại đào tạo", rosterField(selectedStudent, "", "sourceTrainingType", "trainingType", "loai dao tao")],
              ["Trạng thái SV", selectedStudent.academicStatus],
            ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}</dl>{canUpdate && <button className="students-primary" type="button" onClick={() => { setEditingStudent(selectedStudent); setSelectedStudent(undefined); setShowForm(true); }}>Chỉnh sửa hồ sơ</button>}</>
              : activeStudentDetailTab === "results" ? <StudentGradeResultsPanel records={studentGradeRecords} loading={coursesLoading} error={coursesError} />
                : <section className="student-course-history">
                  <div className="student-history-heading"><div><h3>Lịch sử theo học</h3><p>Lịch sử theo học với ThS. Vũ Trung Nghĩa</p><span className="student-history-lecturer">Giảng viên: {DEFAULT_LECTURER}</span></div><span className="student-history-count">Tổng cộng: {lecturerCourses.length} môn</span></div>
                  {coursesLoading ? <p>Đang tải lịch sử học phần…</p> : coursesError ? <p role="alert" className="students-error">{coursesError}</p> : lecturerCourses.length ? <StudentCourseHistoryTable courses={lecturerCourses} /> : <p>Chưa tìm thấy bản ghi trong Sổ điểm cho sinh viên này với giảng viên ThS. Vũ Trung Nghĩa.</p>}
                </section>}
          </section>
        </div>}
      {resetStudent && <div className="students-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !resetBusy) setResetStudent(undefined); }}><form className="students-detail reset-password-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-student-password-title" onSubmit={handleResetPassword}><div className="students-detail-header"><div><span>TÀI KHOẢN SINH VIÊN</span><h2 id="reset-student-password-title">Đặt lại mật khẩu</h2><p>{resetStudent.fullName} · {resetStudent.studentCode}</p></div><button type="button" aria-label="Đóng" disabled={resetBusy} onClick={() => setResetStudent(undefined)}><X size={19} /></button></div><label className="reset-password-choice"><input type="radio" checked={!customResetPassword} onChange={() => setCustomResetPassword(false)} /> Dùng mã số sinh viên làm mật khẩu tạm</label><label className="reset-password-choice"><input type="radio" checked={customResetPassword} onChange={() => setCustomResetPassword(true)} /> Tạo mật khẩu tùy chỉnh</label>{customResetPassword && <label className="reset-password-custom">Mật khẩu mới<input type="password" minLength={6} maxLength={128} required value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} autoComplete="new-password" /></label>}{resetResult && <div className="reset-password-result"><span>Mật khẩu mới</span><code>{resetResult}</code><button type="button" onClick={() => void navigator.clipboard.writeText(resetResult)}><Copy size={15} /> Sao chép</button></div>}<div className="workspace-form-actions"><button className="students-primary" disabled={resetBusy}>{resetBusy ? "Đang cập nhật…" : resetResult ? "Đặt lại lại mật khẩu" : "Cập nhật mật khẩu"}</button><button type="button" onClick={() => setResetStudent(undefined)}>Đóng</button></div><small>Mật khẩu được đồng bộ trực tiếp với Supabase Auth. Hãy gửi cho sinh viên qua kênh riêng.</small></form></div>}
    </main>
  );
}
