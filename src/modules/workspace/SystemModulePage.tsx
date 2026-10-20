import { useEffect, useState, type FormEvent } from "react";
import { ArchiveRestore, BellRing, Download, LockKeyhole, RotateCcw, Trash2, UserRound, Shuffle, X, Search, Check, X as XMark, Eye, FileSpreadsheet, Shield, History, Terminal } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "../../lib/supabase";
import { formatDate, formatDateTime, formatTime } from "../../lib/date-format";
import { groupSemestersByAcademicYear, normalizeSemesterName, semesterIdentity } from "../../lib/semester-groups";
import { studentService } from "../students/student.service";
import type { Student } from "../students/student.types";
import type { StudentInput } from "../students/student.types";
import { moduleByKey, type ModuleDefinition } from "./module-definitions";
import { workspaceService, type WorkspaceRecord } from "./workspace.service";
import { getTeachingPeriodCatalog } from "./TeachingPlanSchedulePage";
import { auditLogService } from "../audit-logs/audit-log.service";
import { supportTicketService, type SupportTicket } from "../support-tickets/support-ticket.service";
import type { AuditLog } from "../audit-logs/audit-log.types";
import { settingsService, type SystemBackup, type SystemSettings } from "../settings/settings.service";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import "./workspace.css";

function labelFor(key: string) { return moduleByKey[key]?.title ?? key; }
function parseBirthDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText); const month = Number(monthText); const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}
function studentAge(birthDate: Date, today: Date) {
  let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
  if (today.getUTCMonth() < birthDate.getUTCMonth() || (today.getUTCMonth() === birthDate.getUTCMonth() && today.getUTCDate() < birthDate.getUTCDate())) age -= 1;
  return age;
}
function upcomingBirthdayDays(birthDate: Date, today: Date) {
  const year = today.getUTCFullYear();
  let month = birthDate.getUTCMonth();
  let day = birthDate.getUTCDate();
  if (month === 1 && day === 29 && new Date(Date.UTC(year, 1, 29)).getUTCDate() !== 29) day = 28;
  let next = Date.UTC(year, month, day);
  const todayUtc = Date.UTC(year, today.getUTCMonth(), today.getUTCDate());
  if (next < todayUtc) {
    const nextYear = year + 1;
    if (month === 1 && day === 29 && new Date(Date.UTC(nextYear, 1, 29)).getUTCDate() !== 29) day = 28;
    next = Date.UTC(nextYear, month, day);
  }
  return Math.round((next - todayUtc) / 86_400_000);
}
const studyMajors = [
  { name: "Quản trị kinh doanh tổng hợp", aliases: ["quan tri kinh doanh tong hop", "qtkd tong hop", "qtkd"] },
  { name: "Kinh tế số & FinTech", aliases: ["kinh te so", "fintech"] },
  { name: "Marketing số", aliases: ["marketing so", "marketing"] },
  { name: "Logistics & Chuỗi cung ứng", aliases: ["logistics", "chuoi cung ung"] },
  { name: "Quản trị nhân lực", aliases: ["quan tri nhan luc", "nhan luc"] },
  { name: "QTKD quốc tế", aliases: ["qtkd quoc te", "quan tri kinh doanh quoc te"] },
];
const studyStatuses = [
  { name: "Đang học", color: "#20B6A4" }, { name: "Bảo lưu", color: "#F07020" },
  { name: "Cảnh báo học vụ", color: "#FF6B6B" }, { name: "Đã tốt nghiệp", color: "#283898" },
];
const rbacRoles = [
  { key: "super_admin", label: "SUPER ADMIN", name: "Super Admin" },
  { key: "system_admin", label: "SYSTEM ADMIN", name: "System Admin" },
  { key: "sub_admin", label: "SUB ADMIN", name: "Sub Admin" },
  { key: "teacher", label: "GIẢNG VIÊN", name: "Giảng viên" },
  { key: "assistant", label: "TRỢ GIẢNG", name: "Trợ giảng" },
  { key: "class_president", label: "LỚP TRƯỞNG", name: "Lớp trưởng" },
  { key: "class_vice", label: "LỚP PHÓ", name: "Lớp phó" },
  { key: "student", label: "SINH VIÊN", name: "Sinh viên" },
];
const rbacFeatures = [
  { key: "students:read", module: "students", action: "read", label: "Xem hồ sơ sinh viên & tra cứu", detail: "Được quyền xem danh sách sinh viên, thẻ sinh viên và hồ sơ học tập." },
  { key: "students:create", module: "students", action: "create", label: "Thêm mới sinh viên", detail: "Được quyền tạo hồ sơ sinh viên trong hệ thống." },
  { key: "students:update", module: "students", action: "update", label: "Chỉnh sửa hồ sơ sinh viên", detail: "Được quyền cập nhật thông tin và hồ sơ học tập." },
  { key: "students:delete", module: "students", action: "delete", label: "Xóa sinh viên vào Thùng rác", detail: "Được quyền chuyển hồ sơ vào thùng rác." },
  { key: "trash:restore", module: "trash", action: "restore", label: "Khôi phục mục trong Thùng rác", detail: "Đưa hồ sơ đã xóa mềm trở lại danh sách hoạt động." },
  { key: "trash:delete", module: "trash", action: "delete", label: "Xóa vĩnh viễn dữ liệu hết hạn", detail: "Xóa vĩnh viễn các mục đã nằm trong thùng rác." },
  { key: "grades:update", module: "grades", action: "update", label: "Nhập & sửa điểm học phần", detail: "Được quyền cập nhật điểm và kết quả học tập." },
  { key: "calendar:update", module: "calendar", action: "update", label: "Quản lý lịch giảng dạy", detail: "Cập nhật lịch học phần và thông tin buổi học." },
  { key: "timetables:update", module: "timetables", action: "update", label: "Quản trị thời khóa biểu", detail: "Cập nhật lớp học phần, lịch học và giảng viên." },
  { key: "semesters:update", module: "semesters", action: "update", label: "Quản lý Học kỳ - Năm học", detail: "Thiết lập niên khóa, học kỳ và học kỳ hiện hành." },
  { key: "announcements:create", module: "announcements", action: "create", label: "Phát thông báo nội bộ", detail: "Gửi thông báo toàn trường hoặc theo lớp." },
  { key: "random-picker:create", module: "random-picker", action: "create", label: "Sử dụng tiện ích Random tương tác", detail: "Quay số, chia nhóm, bốc thăm và ghép cặp." },
  { key: "documents:update", module: "documents", action: "update", label: "Quản lý Kho tài liệu & Giáo trình", detail: "Tải lên, sửa và quản lý quyền truy cập tài liệu." },
  { key: "surveys:create", module: "surveys", action: "create", label: "Tạo & quản lý khảo sát ý kiến", detail: "Tạo khảo sát, theo dõi tỷ lệ và phản hồi." },
  { key: "audit-logs:read", module: "audit-logs", action: "read", label: "Xem Nhật ký hệ thống (Audit Logs)", detail: "Tra cứu nhật ký theo phạm vi quyền được cấp." },
  { key: "permissions:update", module: "permissions", action: "update", label: "Quản lý phân quyền truy cập (RBAC)", detail: "Cấu hình ma trận quyền theo vai trò hoặc tài khoản." },
  { key: "settings:update", module: "settings", action: "update", label: "Cài đặt hệ thống & cấu hình", detail: "Chỉnh sửa thông tin trường, giảng viên và cấu hình." },
  { key: "backup:export", module: "backup", action: "export", label: "Quản lý bản sao lưu Snapshot", detail: "Tạo, khôi phục và tải xuống bản sao lưu." },
  { key: "students:export", module: "students", action: "export", label: "Xuất báo cáo & dữ liệu ra Excel", detail: "Xuất danh sách sinh viên và báo cáo dữ liệu." },
];
const normalizeLabel = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/đ/g, "d");
type StudentCourseSummary = { courseCode: string; courseName: string; semester: string };
function studentCourses(student: Student, students: Student[], records: WorkspaceRecord[]): StudentCourseSummary[] {
  const codeKey = normalizeLabel(student.studentCode).replace(/[^a-z0-9]/g, "");
  const summaries: StudentCourseSummary[] = [];
  const readProfileCourse = (profile: Student) => {
    try {
      const notes = JSON.parse(profile.notes || "{}") as { details?: Record<string, unknown>; sourceData?: Record<string, unknown> };
      const fields = { ...(notes.details ?? {}), ...(notes.sourceData ?? {}) };
      const read = (...keys: string[]) => Object.entries(fields).find(([key]) => keys.some((candidate) => normalizeLabel(key).replace(/[^a-z0-9]/g, "") === normalizeLabel(candidate).replace(/[^a-z0-9]/g, "")))?.[1];
      const courseCode = String(read("courseClassCode", "ma lhp", "ma lop hoc phan", "courseCode", "subjectCode") ?? "").trim();
      const courseName = String(read("courseClassName", "ten lhp", "courseName", "subjectName", "sourceCourse", "ten hoc phan", "mon hoc") ?? "").trim();
      const semester = String(read("sourceTerm", "semester", "dot", "hoc ky") ?? profile.semesterName).trim();
      if (courseCode || courseName) summaries.push({ courseCode, courseName, semester });
    } catch { /* Student notes can be plain text. */ }
  };
  students.filter((profile) => normalizeLabel(profile.studentCode).replace(/[^a-z0-9]/g, "") === codeKey).forEach(readProfileCourse);
  records.filter((record) => record.module_key === "grades" && !record.deleted_at && normalizeLabel(String(record.data.studentCode ?? "")).replace(/[^a-z0-9]/g, "") === codeKey).forEach((record) => {
    const courseCode = String(record.data.courseCode ?? record.data.courseClassCode ?? "").trim();
    const courseName = String(record.data.courseName ?? record.data.subjectName ?? record.data.title ?? "").trim();
    const semester = String(record.data.semesterName ?? record.data.semester ?? "").trim();
    if (courseCode || courseName) summaries.push({ courseCode, courseName, semester });
  });
  const registeredCourseCodes = new Set(summaries.map((item) => normalizeLabel(item.courseCode).replace(/[^a-z0-9]/g, "")).filter(Boolean));
  records.filter((record) => record.module_key === "timetables" && !record.deleted_at).forEach((record) => {
    const scheduleCode = String(record.data.courseClassCode ?? record.data.courseCode ?? record.data.lhpCode ?? "").trim();
    const scheduleCodeKey = normalizeLabel(scheduleCode).replace(/[^a-z0-9]/g, "");
    if (!scheduleCodeKey || !registeredCourseCodes.has(scheduleCodeKey)) return;
    const courseName = String(record.data.subjectName ?? record.data.courseName ?? record.data.title ?? "").trim();
    const semester = String(record.data.semesterName ?? record.data.semester ?? "").trim();
    summaries.push({ courseCode: scheduleCode, courseName, semester });
  });
  return [...new Map(summaries.map((item) => [`${normalizeLabel(item.courseCode)}|${normalizeLabel(item.courseName)}|${normalizeLabel(item.semester)}`, item])).values()];
}
function studentMajor(student: Student) {
  let source = String(student.faculty ?? "");
  try {
    const notes = JSON.parse(student.notes || "{}") as { details?: Record<string, string>; sourceData?: Record<string, string> };
    const fields = { ...(notes.details ?? {}), ...(notes.sourceData ?? {}) };
    const rawMajor = notes.details?.academicMajor ?? notes.details?.major ?? notes.sourceData?.academicMajor ?? notes.sourceData?.major ?? Object.entries(fields).find(([key]) => /major|nganh/i.test(normalizeLabel(key)))?.[1];
    if (rawMajor) source = String(rawMajor);
  } catch { /* Notes can be plain text. */ }
  const normalized = normalizeLabel(source);
  const ordered = [...studyMajors].sort((a, b) => Number(b.name === "QTKD quốc tế") - Number(a.name === "QTKD quốc tế"));
  return ordered.find((major) => major.aliases.some((alias) => normalized.includes(alias)))?.name ?? (source.trim() || "Chưa phân ngành");
}
function academicStatusKey(value: string) {
  const status = normalizeLabel(value);
  if (status.includes("bao luu") || status.includes("reserved")) return "Bảo lưu";
  if (status.includes("canh bao") || status.includes("warning")) return "Cảnh báo học vụ";
  if (status.includes("tot nghiep") || status.includes("graduated")) return "Đã tốt nghiệp";
  return String(value ?? "").trim() || "Đang học";
}
function studentGender(student: Student) {
  let value = "";
  try {
    const notes = JSON.parse(student.notes || "{}") as { gender?: string; details?: Record<string, string>; sourceData?: Record<string, string> };
    const fields = { ...(notes.details ?? {}), ...(notes.sourceData ?? {}) };
    const importedGender = Object.entries(fields).find(([key]) => /gender|gioi tinh|sex/i.test(normalizeLabel(key)))?.[1];
    value = String(notes.details?.gender ?? notes.sourceData?.gender ?? importedGender ?? notes.gender ?? "");
  } catch { /* Notes can be plain text. */ }
  const gender = normalizeLabel(value);
  if (gender === "nam" || gender === "male" || gender.startsWith("nam ")) return "male";
  if (gender === "nu" || gender === "female" || gender.startsWith("nu ")) return "female";
  return "unknown";
}
function StudyStatusDonut({ data, hidden, total, onToggle }: { data: Array<{ name: string; value: number; color: string }>; hidden: Set<string>; total: number; onToggle: (name: string) => void }) {
  const visible = data.filter((item) => !hidden.has(item.name));
  return <div className="overview-status-chart">
    <div className="overview-donut"><ResponsiveContainer width="100%" height="100%"><PieChart>
      <Pie data={visible} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={68} outerRadius={103} paddingAngle={3} stroke="white" strokeWidth={3}>{visible.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie>
      <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" className="overview-donut-total">{total}</text>
      <text x="50%" y="55%" textAnchor="middle" dominantBaseline="middle" className="overview-donut-caption">HỒ SƠ</text>
      <Tooltip contentStyle={{ border: "1px solid #DCE8FF", borderRadius: 12, boxShadow: "0 12px 32px #17255426" }} formatter={(value) => [`${value} sinh viên`, "Số lượng"]} />
    </PieChart></ResponsiveContainer></div>
    <div className="overview-status-legend" aria-label="Chọn trạng thái học tập">
      {data.map((item) => <button type="button" key={item.name} aria-pressed={!hidden.has(item.name)} className={hidden.has(item.name) ? "is-hidden" : ""} onClick={() => onToggle(item.name)}><span style={{ background: item.color }} /><span>{item.name}</span><strong>{item.value}</strong></button>)}
    </div>
  </div>;
}

export default function SystemModulePage({ module, canTestPush = false }: { module: ModuleDefinition; canTestPush?: boolean }) {
  const [user, setUser] = useState<{ email?: string; name?: string; phone?: string }>();
  const [systemSettings, setSystemSettings] = useState<SystemSettings>({});
  const [systemBackups, setSystemBackups] = useState<SystemBackup[]>([]);
  const [canManageBackups, setCanManageBackups] = useState(false);
  const [dashboardRecords, setDashboardRecords] = useState<WorkspaceRecord[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [trash, setTrash] = useState<WorkspaceRecord[]>([]);
  const [trashedStudents, setTrashedStudents] = useState<Student[]>([]);
  const [trashedSupportTickets, setTrashedSupportTickets] = useState<SupportTicket[]>([]);
  const [trashPageSize, setTrashPageSize] = useState<"10" | "20" | "50" | "100" | "all">("10");
  const [trashPage, setTrashPage] = useState(1);
  const [selectedTrash, setSelectedTrash] = useState<Set<string>>(() => new Set());
  const [showBatchDelete, setShowBatchDelete] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditAction, setAuditAction] = useState("");
  const [auditUser, setAuditUser] = useState("");
  const [auditUsers, setAuditUsers] = useState<Array<{ user_id: string; username: string | null; display_name: string; role_key: string }>>([]);
  const [auditRole, setAuditRole] = useState("");
  const [selectedAuditLog, setSelectedAuditLog] = useState<AuditLog>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [random, setRandom] = useState("");
  const [reduceMotion, setReduceMotion] = useState(() => localStorage.getItem("vtn-reduce-motion") === "true");
  const [matrixRole, setMatrixRole] = useState("teacher");
  const [currentUserId, setCurrentUserId] = useState("");
  const [matrixUser, setMatrixUser] = useState("");
  const [matrix, setMatrix] = useState<Record<string, boolean>>({});
  const [rolePermissions, setRolePermissions] = useState<Record<string, boolean>>({});
  const [userOverrides, setUserOverrides] = useState<Record<string, boolean>>({});
  const [permissionView, setPermissionView] = useState<"roles" | "users">("roles");
  const [permissionSearch, setPermissionSearch] = useState("");
  const [people, setPeople] = useState<Array<{ user_id: string; username: string | null; display_name: string; role_key: string }>>([]);
  const [semesterFilter, setSemesterFilter] = useState(() => { const saved = localStorage.getItem("vtn-active-semester") || "all"; return saved === "all" ? saved : normalizeSemesterName(saved); });
  const [currentSemester, setCurrentSemester] = useState("");
  const [semesterNames, setSemesterNames] = useState<string[]>([]);
  const [semesterPeriods, setSemesterPeriods] = useState<Array<{ title: string; startDate: string; endDate: string }>>([]);
  const [hiddenStudyStatuses, setHiddenStudyStatuses] = useState<Set<string>>(() => new Set());
  const [selectedStudentChartTerm, setSelectedStudentChartTerm] = useState("");
  const [selectedBirthdayStudentId, setSelectedBirthdayStudentId] = useState("");
  const [selectedAgeMetric, setSelectedAgeMetric] = useState<"oldest" | "youngest" | "average" | "">("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError("");
      try {
        if (!supabase) throw new Error("Chưa cấu hình Supabase.");
        if (module.key === "my-profile") {
          const { data, error: authError } = await supabase.auth.getUser();
          if (authError) throw authError;
          const { data: profile } = await supabase.from("user_profiles").select("display_name, phone").eq("user_id", data.user?.id).maybeSingle();
          if (active && data.user) setUser({ email: data.user.email, name: String(profile?.display_name ?? data.user.user_metadata?.full_name ?? ""), phone: profile?.phone ?? "" });
        } else if (module.key === "dashboard") {
          const [newStudents, settings, semesters, records] = await Promise.all([studentService.list(), settingsService.get(), workspaceService.list("semesters"), workspaceService.allRecords()]);
          if (active) { setStudents(newStudents); setSystemSettings(settings); setCurrentSemester(String(settings.current_semester ?? "")); setSemesterNames(semesters.map((row) => String(row.data.title ?? "")).filter(Boolean)); setSemesterPeriods(semesters.map((row) => ({ title: String(row.data.title ?? ""), startDate: String(row.data.startDate ?? ""), endDate: String(row.data.endDate ?? "") })).filter((row) => row.title)); setDashboardRecords(records); }
        } else if (module.key === "trash") {
          const [records, studentsInTrash, supportTickets, settings] = await Promise.all([workspaceService.listTrash(), studentService.listTrash(), supportTicketService.listTrash(), settingsService.get()]);
          if (active) { setTrash(records); setTrashedStudents(studentsInTrash); setTrashedSupportTickets(supportTickets); setSystemSettings(settings); }
        } else if (module.key === "audit-logs") {
          const [logs, { data: access, error: accessError }] = await Promise.all([auditLogService.list(), supabase.rpc("get_my_access_matrix")]);
          if (accessError) throw accessError;
          const actorIds = [...new Set(logs.map((log) => log.actor_id).filter((id): id is string => Boolean(id)))];
          let users: Array<{ user_id: string; username: string | null; display_name: string; role_key: string }> = [];
          if (actorIds.length) {
            const { data: profiles, error: profilesError } = await supabase.from("user_profiles").select("user_id,username,display_name,role_key").in("user_id", actorIds);
            if (profilesError) throw profilesError;
            users = profiles ?? [];
          }
          if (active) { setAuditLogs(logs); setAuditRole(String((access as { role?: string } | null)?.role ?? "")); setAuditUsers(users); }
        } else if (module.key === "permissions") {
          const { data: access, error: accessError } = await supabase.rpc("get_my_access_matrix");
          if (accessError) throw accessError;
          void access;
          const { data: roles, error: peopleError } = await supabase.from("user_profiles").select("user_id, username, display_name, role_key").order("display_name");
          if (peopleError) throw peopleError;
          const { data: permissions, error: permissionError } = await supabase.from("role_module_permissions").select("role_key, module_key, action_key, allowed");
          if (permissionError) throw permissionError;
          if (active) {
            const roleMatrix = Object.fromEntries((permissions ?? []).map((item) => [`${item.role_key}:${item.module_key}:${item.action_key}`, item.allowed]));
            const { data: authUser } = await supabase.auth.getUser();
            const ownId = authUser.user?.id ?? "";
            setCurrentUserId(ownId); setPeople((roles ?? []).filter((person) => person.role_key !== "super_admin" || person.user_id === ownId)); setRolePermissions(roleMatrix);
            setMatrix(Object.fromEntries((permissions ?? []).filter((item) => item.role_key === "teacher").map((item) => [`${item.module_key}:${item.action_key}`, item.allowed])));
          }
        } else if (module.key === "settings") {
          const settings = await settingsService.get();
          if (active) setSystemSettings(settings);
        } else if (module.key === "backup") {
          const { data: access, error: accessError } = await supabase.rpc("get_my_access_matrix");
          if (accessError) throw accessError;
          const role = (access as { role: string }).role;
          if (active && ["super_admin","system_admin","sub_admin"].includes(role)) { setCanManageBackups(true); setSystemBackups(await settingsService.backups()); }
        }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Không thể tải dữ liệu."); }
      finally { if (active) setLoading(false); }
    }
    void load(); return () => { active = false; };
  }, [module.key]);
  useEffect(() => {
    if (module.key !== "dashboard") return;
    let active = true;
    const refreshStudents = () => { void studentService.list().then((rows) => { if (active) setStudents(rows); }).catch(() => undefined); };
    window.addEventListener("vtn-students-updated", refreshStudents);
    return () => { active = false; window.removeEventListener("vtn-students-updated", refreshStudents); };
  }, [module.key]);
  useEffect(() => { const update = (event: Event) => setSemesterFilter((event as CustomEvent<string>).detail || "all"); window.addEventListener("vtn-semester-filter-changed", update); return () => window.removeEventListener("vtn-semester-filter-changed", update); }, []);

  async function exportBackup() {
    setError("");
    try {
      const [records, activeStudents, deletedStudents] = await Promise.all([workspaceService.allRecords(), studentService.list(), studentService.listTrash()]);
      const schoolSettings = await settingsService.get();
      const backup = { format: "vtn-portal-backup-v1", exportedAt: new Date().toISOString(), workspaceRecords: records, students: activeStudents, trashedStudents: deletedStudents, systemSettings: schoolSettings };
      const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" })); link.download = `vtn-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href);
      setNotice("Đã tải xuống bản sao lưu JSON. Hãy lưu tệp ở nơi an toàn.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể tạo bản sao lưu."); }
  }

  async function importBackup(file: File) {
    setError(""); setNotice("");
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== "object" || (parsed as { format?: string }).format !== "vtn-portal-backup-v1") throw new Error("Tệp không đúng định dạng bản sao lưu VTN Portal.");
      const backup = parsed as { workspaceRecords?: WorkspaceRecord[]; students?: Student[]; trashedStudents?: Student[]; systemSettings?: SystemSettings };
      let restored = 0; let skipped = 0;
      for (const record of backup.workspaceRecords ?? []) {
        if (!record.module_key || !record.data) { skipped += 1; continue; }
        try { const saved = await workspaceService.save(record.module_key, record.data); if (record.deleted_at) await workspaceService.moveToTrash(saved.id); restored += 1; } catch { skipped += 1; }
      }
      const trashedIds = new Set((backup.trashedStudents ?? []).map((item) => item.studentCode.toLowerCase()));
      for (const item of [...(backup.students ?? []), ...(backup.trashedStudents ?? [])]) {
        const input: StudentInput = { studentCode: item.studentCode, fullName: item.fullName, dateOfBirth: item.dateOfBirth, className: item.className, faculty: item.faculty ?? "", semesterName: item.semesterName ?? "", academicStatus: item.academicStatus ?? "Đang học", email: item.email, phone: item.phone, notes: item.notes };
        try { const saved = await studentService.save(input); if (trashedIds.has(item.studentCode.toLowerCase())) await studentService.moveToTrash(saved.id); restored += 1; } catch { skipped += 1; }
      }
      if (backup.systemSettings && typeof backup.systemSettings === "object") {
        try { await settingsService.save(backup.systemSettings); } catch { skipped += 1; }
      }
      setNotice(`Đã nhập ${restored} bản ghi. Bỏ qua ${skipped} bản ghi không hợp lệ hoặc bị trùng.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể đọc tệp sao lưu."); }
  }

  async function restoreRecord(item: WorkspaceRecord | Student | SupportTicket, student: boolean, support = false) {
    try { if (support) await supportTicketService.restore(item.id); else if (student) await studentService.restore(item.id); else await workspaceService.restore(item.id); setNotice("Đã khôi phục hồ sơ."); window.location.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể khôi phục hồ sơ."); }
  }

  async function purgeRecord(item: WorkspaceRecord | Student | SupportTicket, student: boolean, support = false) {
    const name = support ? (item as SupportTicket).title : student ? (item as Student).fullName : String((item as WorkspaceRecord).data.title ?? "bản ghi");
    if (!window.confirm(`Xóa vĩnh viễn “${name}”? Thao tác này không thể hoàn tác.`)) return;
    try { if (support) await supportTicketService.deletePermanently(item.id); else if (student) await studentService.deletePermanently(item.id); else await workspaceService.deletePermanently(item.id); window.location.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể xóa hồ sơ."); }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return;
    const form = new FormData(event.currentTarget); const name = String(form.get("name") ?? "").trim(); const email = String(form.get("email") ?? "").trim(); const phone = String(form.get("phone") ?? "").trim();
    const authUpdate = await supabase.auth.updateUser({ ...(email && email !== user?.email ? { email } : {}), data: { full_name: name } });
    if (authUpdate.error) { setError(authUpdate.error.message); return; }
    const { error: profileError } = await supabase.from("user_profiles").update({ display_name: name, phone }).eq("user_id", (await supabase.auth.getUser()).data.user?.id);
    if (profileError) setError(profileError.message); else { setNotice(email !== user?.email ? "Đã cập nhật hồ sơ. Hãy xác nhận email mới trong hộp thư." : "Đã cập nhật hồ sơ."); setUser((previous) => ({ ...previous, name, phone })); }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setError(""); setNotice("");
    if (newPassword.length < 8) { setError("Mật khẩu mới cần có ít nhất 8 ký tự."); return; }
    if (newPassword !== confirmNewPassword) { setError("Mật khẩu xác nhận chưa khớp."); return; }
    setPasswordBusy(true);
    try {
      const { error: passwordError } = await supabase.auth.updateUser({ password: newPassword });
      if (passwordError) throw passwordError;
      setNewPassword(""); setConfirmNewPassword("");
      setNotice("Đã đổi mật khẩu thành công.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể đổi mật khẩu."); }
    finally { setPasswordBusy(false); }
  }

  async function saveSystemSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const next: SystemSettings = {};
    for (const [key, value] of form.entries()) next[key] = key === "trash_retention_days" ? Number(value) : String(value).trim();
    setError("");
    try { await settingsService.save(next); const { error: syncError } = await supabase!.rpc("set_current_semester", { p_name: String(next.current_semester ?? "") }); if (syncError) throw syncError; setSystemSettings(next); setNotice("Đã lưu cài đặt. Bản cấu hình trước đó được sao lưu tự động."); window.dispatchEvent(new CustomEvent("vtn-system-settings-updated", { detail: next })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể lưu cài đặt."); }
  }

  async function rollbackBackup(backup: SystemBackup) {
    if (!window.confirm("Khôi phục snapshot này? Cấu hình hiện tại sẽ được sao lưu trước khi rollback.")) return;
    try { await settingsService.restoreBackup(backup.id); const restored = await settingsService.get(); setSystemSettings(restored); setNotice("Đã khôi phục snapshot cấu hình."); window.dispatchEvent(new CustomEvent("vtn-system-settings-updated", { detail: restored })); setSystemBackups(await settingsService.backups()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể khôi phục snapshot."); }
  }

  async function createSettingsSnapshot() {
    try { await settingsService.createBackup("Snapshot thủ công trước khi thay đổi hệ thống"); setSystemBackups(await settingsService.backups()); setNotice("Đã tạo snapshot cấu hình hệ thống."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể tạo snapshot."); }
  }

  async function scanExpiredTrash() {
    try {
      const removed = await workspaceService.purgeExpired();
      const [records, studentsInTrash, supportTickets] = await Promise.all([workspaceService.listTrash(), studentService.listTrash(), supportTicketService.listTrash()]);
      setTrash(records); setTrashedStudents(studentsInTrash); setTrashedSupportTickets(supportTickets);
      setNotice(`Đã quét thùng rác; hệ thống đã dọn ${removed ?? 0} mục hết hạn.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể quét thùng rác."); }
  }

  const trashEntries = [
    ...trashedStudents.map((student) => ({ key: `student:${student.id}`, id: student.id, item: student as Student | WorkspaceRecord | SupportTicket, student: true, support: false, name: `${student.fullName} (${student.studentCode})`, moduleName: "Sinh viên", purgeAt: student.purgeAt })),
    ...trash.map((item) => ({ key: `record:${item.id}`, id: item.id, item: item as Student | WorkspaceRecord | SupportTicket, student: false, support: false, name: String(item.data.title ?? item.data.listName ?? "Bản ghi"), moduleName: labelFor(item.module_key), purgeAt: item.purge_at })),
    ...trashedSupportTickets.map((item) => ({ key: `support:${item.id}`, id: item.id, item: item as Student | WorkspaceRecord | SupportTicket, student: false, support: true, name: item.title, moduleName: "Phiếu hỗ trợ", purgeAt: item.purge_at })),
  ];
  const trashPageCount = trashPageSize === "all" ? 1 : Math.max(1, Math.ceil(trashEntries.length / Number(trashPageSize)));
  const safeTrashPage = Math.min(trashPage, trashPageCount);
  const trashPageStart = trashPageSize === "all" ? 0 : (safeTrashPage - 1) * Number(trashPageSize);
  const visibleTrashEntries = trashPageSize === "all" ? trashEntries : trashEntries.slice(trashPageStart, trashPageStart + Number(trashPageSize));
  useEffect(() => { setTrashPage((page) => Math.min(page, trashPageCount)); }, [trashPageCount]);

  async function restoreSelectedTrash() {
    const selected = trashEntries.filter((entry) => selectedTrash.has(entry.key));
    if (!selected.length) return;
    setError("");
    const results = await Promise.allSettled(selected.map((entry) => entry.support ? supportTicketService.restore(entry.id) : entry.student ? studentService.restore(entry.id) : workspaceService.restore(entry.id)));
    const failed = results.filter((result) => result.status === "rejected").length;
    const [records, studentsInTrash, supportTickets] = await Promise.all([workspaceService.listTrash(), studentService.listTrash(), supportTicketService.listTrash()]);
    setTrash(records); setTrashedStudents(studentsInTrash); setTrashedSupportTickets(supportTickets); setSelectedTrash(new Set());
    setNotice(`Đã khôi phục ${selected.length - failed} mục${failed ? `; ${failed} mục gặp lỗi` : ""}. Nhật ký hệ thống đã được cập nhật.`);
    if (failed) setError("Một số mục không thể khôi phục. Hãy kiểm tra quyền truy cập và thử lại.");
  }

  async function permanentlyDeleteSelectedTrash() {
    const selected = trashEntries.filter((entry) => selectedTrash.has(entry.key));
    if (!selected.length) return;
    const results = await Promise.allSettled(selected.map((entry) => entry.support ? supportTicketService.deletePermanently(entry.id) : entry.student ? studentService.deletePermanently(entry.id) : workspaceService.deletePermanently(entry.id)));
    const failed = results.filter((result) => result.status === "rejected").length;
    const [records, studentsInTrash, supportTickets] = await Promise.all([workspaceService.listTrash(), studentService.listTrash(), supportTicketService.listTrash()]);
    setTrash(records); setTrashedStudents(studentsInTrash); setTrashedSupportTickets(supportTickets); setSelectedTrash(new Set()); setShowBatchDelete(false);
    setNotice(`Đã xóa vĩnh viễn ${selected.length - failed} mục${failed ? `; ${failed} mục gặp lỗi` : ""}.`);
    if (failed) setError("Một số mục không thể xóa. Hãy kiểm tra quyền truy cập và thử lại.");
  }

  function exportAuditReport() {
    const rows = visibleAuditLogs.map((log) => ({
      "Mốc thời gian": formatDateTime(log.event_at),
      "Người thực hiện": auditUserLabel(log.actor_id),
      "Địa chỉ IP": log.ip_address ?? "—",
      "Phân loại": auditCategory(log),
      "Hành động": auditActionLabel(log.action),
      "Chi tiết thay đổi": JSON.stringify(log.details),
      "Người liên quan": auditUserLabel(log.subject_user_id),
      "Bản ghi": log.record_label,
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Nhật ký hệ thống");
    XLSX.writeFile(workbook, `nhat-ky-he-thong-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function auditUserLabel(id: string | null) {
    if (!id) return "—";
    const profile = auditUsers.find((item) => item.user_id === id);
    return profile ? `${profile.display_name || profile.username || id}${profile.username ? ` (@${profile.username})` : ""}` : `Tài khoản ${id.slice(0, 8)}`;
  }
  function auditActorDetailLabel(log: AuditLog) {
    const profile = auditUsers.find((item) => item.user_id === log.actor_id);
    const name = profile?.display_name || profile?.username || (log.actor_id ? `Tài khoản ${log.actor_id.slice(0, 8)}` : "Người dùng đã xóa");
    const role = rbacRoles.find((item) => item.key === profile?.role_key)?.name ?? profile?.role_key;
    return `${name}${role ? ` (${role})` : ""}${profile?.username ? ` (@${profile.username})` : ""}`;
  }
  function auditCategory(log: AuditLog) {
    const action = log.action.toLocaleLowerCase();
    if (action.includes("login") || action.includes("sign")) return "Đăng nhập / Thoát";
    if (action.includes("permission") || log.module_key === "permissions") return "Phân quyền RBAC";
    if (action.includes("trash") || action.includes("restore") || log.module_key === "trash") return "Thùng rác";
    if (log.module_key === "supports") return "Ticket";
    return labelFor(log.module_key);
  }
  function auditActionLabel(action: string) {
    const labels: Record<string, string> = { insert: "Tạo mới", update: "Cập nhật", delete: "Xóa", move_to_trash: "Chuyển vào Thùng rác", restore: "Khôi phục", login: "Đăng nhập hệ thống thành công", logout: "Đăng xuất", create_topic: "Tạo chủ đề", send_message: "Gửi tin nhắn", reset_password: "Đặt lại mật khẩu" };
    return labels[action.toLocaleLowerCase()] ?? action.replaceAll("_", " ");
  }
  function auditDetailText(log: AuditLog) {
    const entries = Object.entries(log.details ?? {});
    if (!entries.length) return log.record_label || "Không có chi tiết bổ sung.";
    const details = log.details as Record<string, unknown>;
    if (log.action.toLocaleLowerCase().includes("permission") || log.module_key === "permissions") {
      const permission = details.permission_key ?? details.permission ?? details.module_key ?? details.module;
      const allowed = details.allowed ?? details.granted;
      const username = details.target_username ?? details.username;
      if (permission && typeof allowed === "boolean") return `Gán quyền "${String(permission)}" thành ${allowed ? "Được phép" : "Bị cấm"}${username ? ` cho tài khoản @${String(username).replace(/^@/, "")}` : ""}.`;
    }
    return entries.map(([key, value]) => {
      const label = key.replaceAll("_", " ");
      const text = value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "—");
      return `${label}: ${text}`;
    }).join(" · ");
  }
  function auditTimestamp(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${formatTime(date)}`;
  }
  async function deleteAuditLog(log: AuditLog) {
    if (auditRole !== "super_admin" || !supabase) return;
    if (!window.confirm("Xóa vĩnh viễn dòng nhật ký này? Thao tác không thể hoàn tác.")) return;
    const { error: deleteError } = await supabase.rpc("super_admin_delete_audit_log", { p_id: log.id });
    if (deleteError) { setError(deleteError.message); return; }
    setAuditLogs((previous) => previous.filter((item) => item.id !== log.id));
    setSelectedAuditLog(undefined);
    setNotice("Đã xóa dòng nhật ký.");
  }
  async function clearAuditLogs() {
    if (auditRole !== "super_admin" || !supabase) return;
    if (!window.confirm("Dọn sạch toàn bộ nhật ký hệ thống? Thao tác này không thể hoàn tác.")) return;
    const { data, error: clearError } = await supabase.rpc("super_admin_clear_audit_logs");
    if (clearError) { setError(clearError.message); return; }
    setAuditLogs([]); setAuditUser(""); setSelectedAuditLog(undefined);
    setNotice(`Đã dọn sạch ${Number(data ?? 0)} dòng nhật ký.`);
  }

  const auditUserOptions = [...new Set(auditLogs.map((log) => log.actor_id).filter((id): id is string => Boolean(id)))].map((id) => ({ id, label: auditUserLabel(id) }));
  const auditCategories = [...new Set(auditLogs.map(auditCategory))];
  const visibleAuditLogs = auditLogs.filter((log) => (!auditAction || auditCategory(log) === auditAction) && (!auditUser || log.actor_id === auditUser) && (!auditSearch || `${auditUserLabel(log.actor_id)} ${log.actor_id} ${log.subject_user_id} ${log.module_key} ${log.action} ${log.record_label} ${JSON.stringify(log.details)} ${log.ip_address}`.toLocaleLowerCase().includes(auditSearch.toLocaleLowerCase())));
  const rawSemesterChoices = [...semesterNames, ...students.map((student) => student.semesterName).filter(Boolean), ...dashboardRecords.filter((record) => record.module_key === "calendar" || record.module_key === "timetables").map((record) => String(record.data.semesterName ?? record.data.semester ?? record.data.round ?? "")).filter(Boolean)];
  const semesterChoiceMap = new Map<string, string>();
  for (const rawName of rawSemesterChoices) {
    const name = normalizeSemesterName(rawName);
    if (name && !semesterChoiceMap.has(semesterIdentity(name))) semesterChoiceMap.set(semesterIdentity(name), name);
  }
  const semesterChoices = [...semesterChoiceMap.values()].sort((a, b) => b.localeCompare(a, "vi", { numeric: true }));
  const normalizedCurrentSemester = normalizeSemesterName(currentSemester);
  const semesterOptions = [...semesterChoices];
  if (normalizedCurrentSemester && !semesterChoiceMap.has(semesterIdentity(normalizedCurrentSemester))) semesterOptions.push(normalizedCurrentSemester);
  const semesterGroups = groupSemestersByAcademicYear(semesterOptions);
  const todayKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`;
  const progressionTerms = getTeachingPeriodCatalog().flatMap((year) => year.terms);
  const catalogCurrentTerm = progressionTerms.find((term) => term.startDate <= todayKey && term.endDate >= todayKey);
  const savedCurrentTerm = semesterPeriods.find((term) => term.startDate && term.endDate && term.startDate <= todayKey && term.endDate >= todayKey);
  const normalizeTermTitle = (title: string) => normalizeLabel(title).replace(/[–—−]/g, "-").replace(/\s+/g, " ").trim();
  const currentOperatingSemester = savedCurrentTerm ? normalizeSemesterName(savedCurrentTerm.title)
    : catalogCurrentTerm ? normalizeSemesterName(semesterChoices.find((name) => normalizeTermTitle(name) === normalizeTermTitle(catalogCurrentTerm.title)) ?? catalogCurrentTerm.title) : "";
  const dashboardStudents = students.filter((student) => semesterFilter === "all" || normalizeSemesterName(student.semesterName) === semesterFilter);
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const datedStudents = dashboardStudents.flatMap((student) => {
    const birthDate = parseBirthDate(student.dateOfBirth);
    if (!birthDate || birthDate.getTime() > today.getTime()) return [];
    return [{ student, birthDate, age: studentAge(birthDate, today) }];
  });
  const upcomingBirthdays = datedStudents.map(({ student, birthDate, age }) => ({ student, birthDate, age, daysUntil: upcomingBirthdayDays(birthDate, today), courses: studentCourses(student, students, dashboardRecords).filter((course) => semesterFilter === "all" || normalizeSemesterName(course.semester) === semesterFilter) }))
    .filter((item) => item.daysUntil <= 7)
    .sort((a, b) => a.daysUntil - b.daysUntil || a.birthDate.getTime() - b.birthDate.getTime() || a.student.fullName.localeCompare(b.student.fullName, "vi"));
  const todayBirthdayCount = upcomingBirthdays.filter((item) => item.daysUntil === 0).length;
  const ageValues = datedStudents.map((item) => item.age);
  const averageStudentAge = ageValues.length ? ageValues.reduce((sum, age) => sum + age, 0) / ageValues.length : 0;
  const oldestStudentAge = ageValues.length ? Math.max(...ageValues) : 0;
  const youngestStudentAge = ageValues.length ? Math.min(...ageValues) : 0;
  const ageStats = ageValues.length ? [
    { key: "oldest" as const, metric: "Lớn nhất", age: oldestStudentAge, fill: "#283898" },
    { key: "youngest" as const, metric: "Nhỏ nhất", age: youngestStudentAge, fill: "#009FC0" },
    { key: "average" as const, metric: "Trung bình", age: Number(averageStudentAge.toFixed(1)), fill: "#70C058" },
  ] : [];
  const selectedAge = selectedAgeMetric === "oldest" ? oldestStudentAge : selectedAgeMetric === "youngest" ? youngestStudentAge : Math.round(averageStudentAge);
  const selectedAgeStudents = selectedAgeMetric ? datedStudents.filter((item) => item.age === selectedAge) : [];
  const filteredWorkspaceRecords = dashboardRecords.filter((record) => semesterFilter === "all" || normalizeSemesterName(String(record.data.semesterName ?? record.data.semester ?? record.data.round ?? "")) === semesterFilter);
  function applySemesterFilter(value: string) {
    const normalizedValue = value === "all" ? value : normalizeSemesterName(value);
    setSemesterFilter(normalizedValue);
    localStorage.setItem("vtn-active-semester", normalizedValue);
    window.dispatchEvent(new CustomEvent("vtn-semester-filter-changed", { detail: normalizedValue }));
  }
  const filteredCounts = filteredWorkspaceRecords.reduce<Record<string, number>>((result, row) => { result[row.module_key] = (result[row.module_key] ?? 0) + 1; return result; }, {});
  const semesterClassCount = new Set(filteredWorkspaceRecords.filter((record) => record.module_key === "timetables" || record.module_key === "calendar").map((record) => {
    const term = String(record.data.semesterName ?? record.data.semester ?? record.data.round ?? "").trim();
    const classCode = String(record.data.classCode ?? record.data.className ?? record.data.courseClassCode ?? record.data.courseCode ?? "").trim();
    return term && classCode ? `${normalizeLabel(term)}|${normalizeLabel(classCode)}` : "";
  }).filter(Boolean)).size;
  const timetableSections = new Map<string, { semester: string; courseCode: string }>();
  for (const record of filteredWorkspaceRecords.filter((item) => item.module_key === "timetables" || item.module_key === "calendar")) {
    const term = normalizeSemesterName(String(record.data.semesterName ?? record.data.semester ?? record.data.round ?? ""));
    const courseCode = String(record.data.subjectCode ?? record.data.courseCode ?? record.data.courseClassCode ?? "");
    const classCode = String(record.data.classCode ?? record.data.className ?? record.data.courseClassCode ?? courseCode);
    if (!term || !courseCode || !classCode) continue;
    const key = `${term}|${courseCode}|${classCode}`;
    if (!timetableSections.has(key)) timetableSections.set(key, { semester: term, courseCode });
  }
  const scheduleTerms = [...new Set([...timetableSections.values()].map((section) => section.semester))].sort((a, b) => {
    const parse = (value: string) => { const match = value.match(/(?:HK|Học kỳ)\s*(\d+)\s*(?:NH\s*)?(\d{4})-(\d{4})/i); return match ? [Number(match[2]), Number(match[1])] : null; };
    const parsedA = parse(a); const parsedB = parse(b);
    if (parsedA && parsedB) return parsedA[0] - parsedB[0] || parsedA[1] - parsedB[1] || a.localeCompare(b, "vi", { numeric: true });
    if (parsedA) return -1;
    if (parsedB) return 1;
    return a.localeCompare(b, "vi", { numeric: true });
  });
  const semesterCourseStats = scheduleTerms.map((term) => ({ semester: term, courses: new Set([...timetableSections.values()].filter((section) => section.semester === term).map((section) => section.courseCode)).size }));
  const studentCountsBySemester = new Map<string, Map<string, string>>();
  for (const student of students) {
    const term = normalizeSemesterName(String(student.semesterName ?? "").trim());
    const code = String(student.studentCode ?? "").trim();
    if (!term || !code) continue;
    const codes = studentCountsBySemester.get(term) ?? new Map<string, string>();
    const gender = studentGender(student);
    const existingGender = codes.get(code);
    if (!existingGender || (existingGender === "unknown" && gender !== "unknown")) codes.set(code, gender);
    studentCountsBySemester.set(term, codes);
  }
  const studentCountTerms = [...new Set([...scheduleTerms, ...studentCountsBySemester.keys()])].filter((term) => semesterFilter === "all" || normalizeSemesterName(term) === semesterFilter).sort((a, b) => a.localeCompare(b, "vi", { numeric: true }));
  const semesterStudentStats = studentCountTerms.map((term) => {
    const genders = [...(studentCountsBySemester.get(term)?.values() ?? [])];
    return { semester: term, male: genders.filter((gender) => gender === "male").length, female: genders.filter((gender) => gender === "female").length, other: genders.filter((gender) => gender !== "male" && gender !== "female").length };
  });
  const semesterStudentTotals = semesterStudentStats.reduce((totals, item) => ({ male: totals.male + item.male, female: totals.female + item.female, other: totals.other + item.other }), { male: 0, female: 0, other: 0 });
  const selectedSemesterStudentStats = semesterStudentStats.find((item) => item.semester === selectedStudentChartTerm);
  const displayedSemesterStudentTotals = selectedSemesterStudentStats ?? semesterStudentTotals;
  const majorCounts = dashboardStudents.reduce<Record<string, number>>((counts, student) => { const major = studentMajor(student); if (major) counts[major] = (counts[major] ?? 0) + 1; return counts; }, {});
  const knownMajorNames = new Set(studyMajors.map((major) => major.name));
  const majorStats = [...studyMajors.map((major) => ({ major: major.name, students: majorCounts[major.name] ?? 0 })), ...Object.entries(majorCounts).filter(([major]) => !knownMajorNames.has(major)).map(([major, students]) => ({ major, students }))];
  const statusCounts = dashboardStudents.reduce<Record<string, { name: string; value: number }>>((counts, student) => {
    const name = academicStatusKey(student.academicStatus);
    const key = normalizeLabel(name);
    if (counts[key]) counts[key].value += 1;
    else counts[key] = { name, value: 1 };
    return counts;
  }, {});
  const knownStatuses = new Set(studyStatuses.map((status) => normalizeLabel(status.name)));
  const extraStatusColors = ["#8B5CF6", "#F472B6", "#009FC0", "#F06028", "#146C62", "#64748B", "#A855F7"];
  const statusStats = [...studyStatuses.map((status) => ({ ...status, value: statusCounts[normalizeLabel(status.name)]?.value ?? 0 })), ...Object.entries(statusCounts).filter(([key]) => !knownStatuses.has(key)).map(([, status], index) => ({ ...status, color: extraStatusColors[index % extraStatusColors.length] }))];
  const toggleStudyStatus = (name: string) => setHiddenStudyStatuses((previous) => { const next = new Set(previous); if (next.has(name)) next.delete(name); else next.add(name); return next; });

  async function togglePermission(moduleKey: string, actionKey: string, allowed: boolean, targetRole = matrixRole) {
    if (!supabase || (!matrixUser && targetRole === "super_admin")) return;
    const selectedPerson = people.find((person) => person.user_id === matrixUser);
    if (selectedPerson?.role_key === "super_admin" && (!currentUserId || matrixUser !== currentUserId)) return;
    setError("");
    const { error: saveError } = matrixUser
      ? await supabase.rpc("set_user_module_permission", { p_user_id: matrixUser, p_module: moduleKey, p_action: actionKey, p_allowed: allowed })
      : await supabase.rpc("set_role_module_permission", { p_role: targetRole, p_module: moduleKey, p_action: actionKey, p_allowed: allowed });
    if (saveError) { setError(saveError.message); return; }
    setMatrix((previous) => ({ ...previous, [`${moduleKey}:${actionKey}`]: allowed }));
    if (matrixUser) setUserOverrides((previous) => ({ ...previous, [`${moduleKey}:${actionKey}`]: allowed }));
    else setRolePermissions((previous) => ({ ...previous, [`${targetRole}:${moduleKey}:${actionKey}`]: allowed }));
  }

  async function selectMatrixTarget(role: string, userId: string) {
    setMatrixRole(role); setMatrixUser(userId);
    if (!supabase) return;
    if (userId) {
      const { data, error: matrixError } = await supabase.rpc("get_user_access_matrix", { p_user_id: userId });
      if (matrixError) { setError(matrixError.message); return; }
      const accessData = data as { permissions: Record<string, Record<string, boolean>> };
      setMatrix(Object.fromEntries(Object.entries(accessData.permissions).flatMap(([moduleKey, actions]) => Object.entries(actions).map(([action, allowed]) => [`${moduleKey}:${action}`, allowed]))));
      const { data: overrides, error: overrideError } = await supabase.from("user_module_permissions").select("module_key, action_key, allowed").eq("user_id", userId);
      if (overrideError) { setError(overrideError.message); return; }
      setUserOverrides(Object.fromEntries((overrides ?? []).map((item) => [`${item.module_key}:${item.action_key}`, item.allowed])));
      return;
    }
    setUserOverrides({});
    const { data, error: queryError } = await supabase.from("role_module_permissions").select("module_key, action_key, allowed").eq("role_key", role);
    if (queryError) { setError(queryError.message); return; }
    setMatrix(Object.fromEntries((data ?? []).map((item) => [`${item.module_key}:${item.action_key}`, item.allowed])));
    setRolePermissions((previous) => {
      const next = { ...previous };
      for (const item of data ?? []) next[`${role}:${item.module_key}:${item.action_key}`] = item.allowed;
      return next;
    });
  }

  if (loading) return <section className="workspace-page"><div className="workspace-loading">Đang tải {module.title.toLowerCase()}…</div></section>;
  return <section className="workspace-page">
    {module.key !== "audit-logs" && <div className="workspace-title-row"><div><div className="workspace-breadcrumb">{module.group} <span>/</span> {module.title}</div><h1>{module.title}</h1><p>{module.description}</p></div></div>}
    {error && <div className="workspace-alert" role="alert">{error}</div>}{notice && <div className="workspace-notice" role="status">{notice}</div>}
    {module.key === "dashboard" && <>
      <div className="overview-filter"><div className="overview-filter-controls"><label>Học kỳ<select value={semesterFilter} onChange={(event) => applySemesterFilter(event.target.value)}><option value="all">Tất cả học kỳ</option>{semesterGroups.map((group) => <optgroup key={group.academicYear} label={group.academicYear === "Khác" ? "Năm học chưa xác định" : `Năm học ${group.academicYear}`}>{group.semesters.map((name) => <option key={name} value={name}>{name}{currentOperatingSemester && semesterIdentity(name) === semesterIdentity(currentOperatingSemester) ? " · Hiện hành" : ""}</option>)}</optgroup>)}</select></label><button type="button" className={`overview-current-semester-button${currentOperatingSemester && semesterIdentity(semesterFilter) === semesterIdentity(currentOperatingSemester) ? " is-active" : ""}`} disabled={!currentOperatingSemester} onClick={() => applySemesterFilter(currentOperatingSemester)}><span>Học kỳ hiện tại</span><strong>{currentOperatingSemester || "Chưa xác định theo tiến độ đào tạo"}</strong></button></div>{canTestPush && <button type="button" className="overview-push-test" onClick={() => window.dispatchEvent(new Event("vtn-test-push-notification"))}><BellRing size={15} /> Thử nhận thông báo đẩy</button>}</div>
      <div className="workspace-stat-grid"><article><span>Tổng số lớp học kỳ</span><strong>{semesterClassCount}</strong><small>{semesterFilter === "all" ? "Tất cả học kỳ" : `Học kỳ ${semesterFilter}`}</small></article><article><span>Sinh viên</span><strong>{dashboardStudents.length}</strong><small>{semesterFilter === "all" ? "Tất cả học kỳ" : "Theo học kỳ đã chọn"}</small></article><article><span>Bản ghi công việc</span><strong>{filteredWorkspaceRecords.length}</strong><small>Trong các module khác</small></article><article><span>Nhóm học tập</span><strong>{filteredCounts.groups ?? 0}</strong><small>Được quản lý</small></article><article><span>Bài tập</span><strong>{filteredCounts.assignments ?? 0}</strong><small>Đang theo dõi</small></article></div>
      <div className="overview-dashboard-charts">
        <div className="workspace-panel overview-chart-panel"><div className="overview-chart-heading"><div><h2>Trạng thái học tập</h2><p>Tỷ lệ theo hồ sơ sinh viên đang lọc</p></div></div>{dashboardStudents.length ? <StudyStatusDonut data={statusStats} hidden={hiddenStudyStatuses} total={dashboardStudents.length} onToggle={toggleStudyStatus} /> : <div className="overview-chart-empty">Chưa có trạng thái học tập để thống kê.</div>}</div>
        <div className="workspace-panel overview-chart-panel"><div className="overview-chart-heading"><div><h2>Sinh nhật trong 7 ngày tới</h2><p>{semesterFilter === "all" ? "Theo hồ sơ sinh viên hiện có" : `Theo học kỳ ${semesterFilter}`}</p></div><span className="overview-birthday-today-count"><b>{todayBirthdayCount}</b> sinh nhật hôm nay</span></div>{upcomingBirthdays.length ? <ul className="overview-birthday-list">{upcomingBirthdays.map(({ student, age, daysUntil, courses }) => <li key={student.id}><div><button type="button" className="overview-birthday-student" aria-expanded={selectedBirthdayStudentId === student.id} onClick={() => setSelectedBirthdayStudentId((current) => current === student.id ? "" : student.id)}>{student.fullName}</button>{selectedBirthdayStudentId === student.id && <div className="overview-birthday-courses"><b>Học phần đã ghi nhận</b>{courses.length ? <ul>{courses.map((course, index) => <li key={`${course.courseCode}-${course.courseName}-${course.semester}-${index}`}><span>{course.courseName || "Học phần chưa rõ tên"}</span><small>{course.courseCode ? `Mã LHP: ${course.courseCode}` : ""}{course.semester ? ` · ${course.semester}` : ""}</small></li>)}</ul> : <p>Chưa có thông tin học phần trong hồ sơ sinh viên hoặc sổ điểm.</p>}</div>}<small>{student.studentCode} · {student.dateOfBirth ? formatDate(student.dateOfBirth) : "Chưa có ngày sinh"} · {age} tuổi</small></div><span className={daysUntil === 0 ? "is-today" : ""}>{daysUntil === 0 ? "Hôm nay" : `Còn ${daysUntil} ngày`}</span></li>)}</ul> : <div className="overview-chart-empty">Không có sinh nhật nào trong 7 ngày tới.</div>}</div>
        <div className="workspace-panel overview-chart-panel"><div className="overview-chart-heading"><div><h2>Độ tuổi sinh viên</h2><p>Bấm vào cột hoặc chỉ số để xem hồ sơ sinh viên theo độ tuổi.</p></div></div>{ageStats.length ? <><div className="overview-chart overview-age-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={ageStats} margin={{ top: 12, right: 16, left: -12, bottom: 10 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="metric" tick={{ fontSize: 12 }} /><YAxis allowDecimals={false} tick={{ fontSize: 12 }} /><Tooltip formatter={(value) => [`${value} tuổi`, "Độ tuổi"]} /><Bar dataKey="age" name="Độ tuổi" radius={[6, 6, 0, 0]} cursor="pointer" onClick={(data) => { const key = String(data?.payload?.key ?? ""); if (key === "oldest" || key === "youngest" || key === "average") setSelectedAgeMetric(key); }}>{ageStats.map((item) => <Cell key={item.key} fill={item.fill} />)}</Bar></BarChart></ResponsiveContainer></div><div className="overview-age-metrics">{ageStats.map((item) => <button type="button" key={item.key} className={selectedAgeMetric === item.key ? "is-selected" : ""} onClick={() => setSelectedAgeMetric((current) => current === item.key ? "" : item.key)}><span>{item.metric}</span><strong>{item.age.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} tuổi</strong></button>)}</div>{selectedAgeMetric && <div className="overview-age-students"><strong>{selectedAgeStudents.length} sinh viên · {selectedAge} tuổi{selectedAgeMetric === "average" ? " (làm tròn)" : ""}</strong>{selectedAgeStudents.length ? <ul>{selectedAgeStudents.map(({ student, age }) => <li key={student.id}><span><b>{student.fullName}</b><small>{student.studentCode} · {formatDate(student.dateOfBirth)} · {age} tuổi</small></span><span>{student.className || "Chưa có lớp"}</span></li>)}</ul> : <p>Không có hồ sơ trùng với độ tuổi trung bình đã làm tròn.</p>}</div>}</> : <div className="overview-chart-empty">Chưa có hồ sơ với ngày sinh hợp lệ để tính tuổi.</div>}</div>
        <div className="workspace-panel overview-chart-panel"><div className="overview-chart-heading"><div><h2>Tổng số lượng sinh viên theo kỳ</h2><p>Bấm vào cột để xem tổng nam/nữ của học kỳ đó.</p></div></div>{semesterStudentStats.length ? <><div className="overview-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={semesterStudentStats} margin={{ top: 12, right: 18, left: -15, bottom: 28 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="semester" tick={{ fontSize: 12 }} angle={-18} textAnchor="end" height={55} /><YAxis allowDecimals={false} tick={{ fontSize: 12 }} /><Tooltip /><Legend /><Bar dataKey="male" name="Nam" stackId="gender" fill="#283898" radius={[0,0,0,0]} cursor="pointer" onClick={(data) => { const term = String(data?.payload?.semester ?? ""); setSelectedStudentChartTerm((current) => current === term ? "" : term); }} /><Bar dataKey="female" name="Nữ" stackId="gender" fill="#F472B6" radius={[5,5,0,0]} cursor="pointer" onClick={(data) => { const term = String(data?.payload?.semester ?? ""); setSelectedStudentChartTerm((current) => current === term ? "" : term); }} /><Bar dataKey="other" name="Khác / chưa rõ" stackId="gender" fill="#94A3B8" radius={[5,5,0,0]} cursor="pointer" onClick={(data) => { const term = String(data?.payload?.semester ?? ""); setSelectedStudentChartTerm((current) => current === term ? "" : term); }} /></BarChart></ResponsiveContainer></div><div className="overview-gender-total" aria-label={`Tổng cộng${selectedSemesterStudentStats ? ` ${selectedSemesterStudentStats.semester}` : " các học kỳ đang lọc"}: nam ${displayedSemesterStudentTotals.male}, nữ ${displayedSemesterStudentTotals.female}, khác/chưa rõ ${displayedSemesterStudentTotals.other}`}><strong>{selectedSemesterStudentStats ? `Tổng cộng · ${selectedSemesterStudentStats.semester}` : "Tổng cộng các học kỳ đang lọc"}</strong><span><i className="male" />Nam <b>{displayedSemesterStudentTotals.male.toLocaleString("vi-VN")}</b></span><span><i className="female" />Nữ <b>{displayedSemesterStudentTotals.female.toLocaleString("vi-VN")}</b></span><span><i className="other" />Khác / chưa rõ <b>{displayedSemesterStudentTotals.other.toLocaleString("vi-VN")}</b></span></div></> : <div className="overview-chart-empty">Chưa có hồ sơ sinh viên theo học kỳ để thống kê.</div>}</div>
        <div className="workspace-panel overview-chart-panel"><div className="overview-chart-heading"><div><h2>Số môn học / học phần theo học kỳ</h2><p>Đếm mã học phần khác nhau trong dữ liệu lịch đã nhập.</p></div></div>{semesterCourseStats.length ? <div className="overview-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={semesterCourseStats} margin={{ top: 12, right: 18, left: -15, bottom: 28 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="semester" tick={{ fontSize: 12 }} angle={-18} textAnchor="end" height={55} /><YAxis allowDecimals={false} tick={{ fontSize: 12 }} /><Tooltip /><Bar dataKey="courses" name="Môn / học phần" fill="#283898" radius={[5,5,0,0]} /></BarChart></ResponsiveContainer></div> : <div className="overview-chart-empty">Nhập thời khóa biểu để thống kê số môn theo học kỳ.</div>}</div>
        <div className="workspace-panel overview-chart-panel"><div className="overview-chart-heading"><div><h2>Số lượng sinh viên theo chuyên ngành đào tạo</h2><p>{semesterFilter === "all" ? "Tất cả học kỳ" : semesterFilter}</p></div></div>{dashboardStudents.length ? <div className="overview-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={majorStats} margin={{ top: 14, right: 16, left: -12, bottom: 68 }}><CartesianGrid stroke="#DBE7F5" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="major" interval={0} angle={-18} textAnchor="end" height={78} tick={{ fontSize: 12 }} /><YAxis allowDecimals={false} tick={{ fontSize: 12 }} /><Tooltip cursor={{ fill: "#EDF3FF" }} contentStyle={{ border: "1px solid #DCE8FF", borderRadius: 12, boxShadow: "0 12px 32px #17255426" }} formatter={(value) => [`${value} sinh viên`, "Số lượng"]} /><Bar dataKey="students" name="Sinh viên" fill="#283898" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div> : <div className="overview-chart-empty">Chưa có hồ sơ sinh viên trong học kỳ đã chọn.</div>}</div>
      </div>
    </>}
    {module.key === "my-profile" && <><form className="workspace-form workspace-profile" onSubmit={saveProfile}><div className="workspace-profile-avatar"><UserRound size={24} /></div><h2>Thông tin cá nhân</h2><label>Email đăng nhập<input name="email" type="email" defaultValue={user?.email ?? ""} required /></label><label>Họ và tên<input name="name" defaultValue={user?.name ?? ""} required /></label><label>Số điện thoại<input name="phone" type="tel" defaultValue={user?.phone ?? ""} /></label><p>Thay đổi email có thể cần xác nhận qua email mới.</p><button className="workspace-primary">Lưu hồ sơ</button></form><form className="workspace-form workspace-profile workspace-password-form" onSubmit={(event) => void changePassword(event)}><h2>Đổi mật khẩu</h2><p>Chọn mật khẩu mới có ít nhất 8 ký tự.</p><label>Mật khẩu mới<input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label><label>Nhập lại mật khẩu mới<input type="password" autoComplete="new-password" minLength={8} value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} required /></label><button className="workspace-primary" disabled={passwordBusy}>{passwordBusy ? "Đang cập nhật…" : "Cập nhật mật khẩu"}</button></form></>}
    {module.key === "accounts" && <div className="workspace-panel"><h2>Tài khoản giảng viên</h2><p>Tài khoản được quản lý trong Supabase Auth để mật khẩu không nằm trong dữ liệu ứng dụng.</p><ol><li>Mở Supabase Dashboard â†’ Authentication â†’ Users.</li><li>Chọn <b>Add user â†’ Send invitation</b>, nhập email giảng viên và gửi lời mời.</li><li>Người nhận hoàn tất lời mời rồi đăng nhập vào ứng dụng.</li></ol><p>Chỉ quản trị viên dự án Supabase mới có thể mời hoặc vô hiệu hóa người dùng.</p></div>}
    {module.key === "permissions" && <>
      <div className="rbac-tabs" role="tablist" aria-label="Chế độ phân quyền">
        <button type="button" role="tab" aria-selected={permissionView === "roles"} className={permissionView === "roles" ? "is-active" : ""} onClick={() => { setPermissionView("roles"); setMatrixUser(""); }}>Theo Vai Trò (Role Matrix)</button>
        <button type="button" role="tab" aria-selected={permissionView === "users"} className={permissionView === "users" ? "is-active" : ""} onClick={() => setPermissionView("users")}>Theo Người Dùng (User-Specific Overrides)</button>
      </div>
      <label className="rbac-search"><Search size={15} /><input value={permissionSearch} onChange={(event) => setPermissionSearch(event.target.value)} placeholder="Lọc phân hệ chức năng (thêm sinh viên, điểm, thùng rác...)" /></label>
      {permissionView === "roles" ? <div className="workspace-panel rbac-panel">
        <div className="rbac-table-wrap"><table className="rbac-table"><thead><tr><th className="rbac-feature-column">PHÂN HỆ &amp; QUYỀN HẠN</th>{rbacRoles.map((role) => <th key={role.key} className={`rbac-role-heading rbac-role-${role.key}`}><span>{role.label}</span>{role.key === "super_admin" && <small><LockKeyhole size={11} /> KHÓA 100%</small>}</th>)}</tr></thead>
          <tbody>{rbacFeatures.filter((feature) => `${feature.label} ${feature.detail}`.toLocaleLowerCase("vi").includes(permissionSearch.trim().toLocaleLowerCase("vi"))).map((feature) => <tr key={feature.key}><td className="rbac-feature-column"><strong>{feature.label}</strong><small>{feature.detail}</small></td>{rbacRoles.map((role) => {
            const allowed = role.key === "super_admin" || Boolean(rolePermissions[`${role.key}:${feature.key}`]);
            return <td key={role.key} className={role.key === "super_admin" ? "rbac-super-cell" : ""}>{role.key === "super_admin" ? <span className="rbac-lock" title="Super Admin luôn có toàn quyền"><LockKeyhole size={15} /></span> : <button type="button" className={`rbac-state ${allowed ? "is-allowed" : "is-denied"}`} aria-label={`${feature.label}: ${allowed ? "được phép" : "bị cấm"} với ${role.name}`} aria-pressed={allowed} onClick={() => { setMatrixRole(role.key); void togglePermission(feature.module, feature.action, !allowed, role.key); }}>{allowed ? <Check size={13} /> : <XMark size={13} />}</button>}</td>;
          })}</tr>)}</tbody></table></div>
        <div className="rbac-footer"><span>Chọn ô quyền để bật hoặc tắt trực tiếp theo vai trò.</span><button type="button" onClick={async () => { const { error: resetError } = await supabase!.rpc("reset_role_permissions"); if (resetError) setError(resetError.message); else { setMatrixUser(""); setUserOverrides({}); await selectMatrixTarget(matrixRole, ""); const { data } = await supabase!.from("role_module_permissions").select("role_key,module_key,action_key,allowed"); if (data) setRolePermissions(Object.fromEntries(data.map((item) => [`${item.role_key}:${item.module_key}:${item.action_key}`, item.allowed]))); setNotice("Đã khôi phục ma trận quyền mặc định."); } }}>Khôi phục quyền mặc định</button></div>
      </div> : <div className="rbac-user-view">
        <div className="workspace-panel rbac-user-selector"><label>Chọn người dùng để phân quyền trực tiếp:<select value={matrixUser} onChange={(event) => { const target = people.find((person) => person.user_id === event.target.value); void selectMatrixTarget(target?.role_key ?? "student", event.target.value); }}><option value="">Chọn tài khoản</option>{people.map((person) => <option value={person.user_id} key={person.user_id}>{person.display_name || person.username || person.user_id} (@{person.username ?? "—"} · {rbacRoles.find((role) => role.key === person.role_key)?.name ?? person.role_key})</option>)}</select>{matrixUser && <span className="rbac-selected-user"><UserRound size={17} />{people.find((person) => person.user_id === matrixUser)?.display_name || people.find((person) => person.user_id === matrixUser)?.username} <small>Vai trò gốc: {rbacRoles.find((role) => role.key === people.find((person) => person.user_id === matrixUser)?.role_key)?.name}</small></span>}</label></div>
        <div className="workspace-panel rbac-panel"><div className="rbac-table-wrap"><table className="rbac-table rbac-user-table"><thead><tr><th className="rbac-feature-column">PHÂN HỆ &amp; QUYỀN HẠN</th><th>QUYỀN MẶC ĐỊNH THEO VAI TRÒ</th><th>GÁN QUYỀN RIÊNG CHO NGƯỜI DÙNG</th></tr></thead><tbody>{rbacFeatures.filter((feature) => `${feature.label} ${feature.detail}`.toLocaleLowerCase("vi").includes(permissionSearch.trim().toLocaleLowerCase("vi"))).map((feature) => {
          const userRole = people.find((person) => person.user_id === matrixUser)?.role_key ?? "student";
          const defaultAllowed = userRole === "super_admin" || Boolean(rolePermissions[`${userRole}:${feature.key}`]);
          const currentAllowed = userRole === "super_admin" ? (userOverrides[feature.key] ?? true) : Boolean(matrix[feature.key]);
          const hasOverride = Object.prototype.hasOwnProperty.call(userOverrides, feature.key);
          return <tr key={feature.key}><td className="rbac-feature-column"><strong>{feature.label}</strong><small>{feature.detail}</small></td><td><span className={`rbac-badge ${defaultAllowed ? "is-allowed" : "is-denied"}`}>{defaultAllowed ? "Được phép" : "Chưa cấp"}</span></td><td><button type="button" className={`rbac-user-grant ${currentAllowed ? "is-allowed" : "is-denied"}`} disabled={!matrixUser} onClick={() => void togglePermission(feature.module, feature.action, !currentAllowed)}>{currentAllowed ? <><Check size={13} /> Được phép</> : <><XMark size={13} /> Bị cấm</>}{hasOverride && <small>Quyền riêng</small>}</button></td></tr>;
        })}</tbody></table></div>{!matrixUser && <p className="rbac-empty-hint">Chọn một tài khoản để xem quyền mặc định và gán quyền riêng.</p>}</div>
      </div>}
      <p className="workspace-muted">Super Admin luôn có toàn quyền, kể cả phân hệ mới. Cột này được khóa cố định và không thể thay đổi bởi tài khoản khác.</p>
    </>}
    {module.key === "backup" && <><div className="workspace-panel"><div className="workspace-backup-icon"><ArchiveRestore size={24} /></div><h2>Sao lưu dữ liệu</h2><p>Tải xuống tệp JSON gồm bản ghi module, hồ sơ sinh viên và cấu hình hệ thống. Nhập sẽ thêm bản ghi mới; dữ liệu trùng mã được bỏ qua.</p><div className="workspace-backup-actions"><button className="workspace-primary" type="button" onClick={() => void exportBackup()}><Download size={17} /> Tải bản sao lưu JSON</button><label className="workspace-import-button">Nhập bản sao lưu<input type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importBackup(file); event.currentTarget.value = ""; }} /></label>{canManageBackups && <button type="button" onClick={() => void createSettingsSnapshot()}>Tạo snapshot cài đặt</button>}</div><p className="workspace-muted">Tệp chứa thông tin cá nhân. Lưu trữ an toàn và không chia sẻ công khai.</p></div>{canManageBackups && <div className="workspace-table-wrap"><table><thead><tr><th>THỜI GIAN</th><th>LÝ DO</th><th>THAO TÁC</th></tr></thead><tbody>{systemBackups.map((backup) => <tr key={backup.id}><td>{formatDateTime(backup.created_at)}</td><td>{backup.reason}</td><td><button className="workspace-inline-action" type="button" onClick={() => void rollbackBackup(backup)}>Khôi phục snapshot</button></td></tr>)}{!systemBackups.length && <tr><td className="workspace-state" colSpan={3}>Chưa có snapshot cài đặt.</td></tr>}</tbody></table></div>}</>}
    {module.key === "trash" && <>
      <div className="workspace-panel trash-batch-toolbar"><span>Mục đã chọn: <strong>{selectedTrash.size}</strong></span><div><button type="button" onClick={() => void scanExpiredTrash()}>Quét mục hết hạn</button><button type="button" disabled={!selectedTrash.size} onClick={() => void restoreSelectedTrash()}><RotateCcw size={15} /> Khôi phục đã chọn</button><button className="trash-danger" type="button" disabled={!selectedTrash.size} onClick={() => setShowBatchDelete(true)}><Trash2 size={15} /> Xóa vĩnh viễn đã chọn</button></div><small>Mục trong thùng rác được lưu trong {Number(systemSettings.trash_retention_days ?? 30)} ngày.</small></div>
      <div className="trash-pagination"><label>Số dòng<select value={trashPageSize} onChange={(event) => { setTrashPageSize(event.target.value as "10" | "20" | "50" | "100" | "all"); setTrashPage(1); }}><option value="10">10 dòng</option><option value="20">20 dòng</option><option value="50">50 dòng</option><option value="100">100 dòng</option><option value="all">Tất cả</option></select></label><span>{trashEntries.length ? `${trashPageStart + 1}–${Math.min(trashPageStart + visibleTrashEntries.length, trashEntries.length)} / ${trashEntries.length}` : "0 mục"}</span><div><button type="button" disabled={safeTrashPage <= 1} onClick={() => setTrashPage((page) => Math.max(1, page - 1))}>Trước</button><span>Trang {safeTrashPage} / {trashPageCount}</span><button type="button" disabled={safeTrashPage >= trashPageCount} onClick={() => setTrashPage((page) => Math.min(trashPageCount, page + 1))}>Sau</button></div></div><div className="workspace-table-wrap trash-table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="Chọn tất cả mục trong thùng rác" checked={trashEntries.length > 0 && selectedTrash.size === trashEntries.length} onChange={(event) => setSelectedTrash(event.target.checked ? new Set(trashEntries.map((entry) => entry.key)) : new Set())} /></th><th>HỒ SƠ</th><th>MODULE</th><th>HẠN LƯU</th><th>THAO TÁC</th></tr></thead><tbody>{visibleTrashEntries.map((entry) => { const days = Math.max(0, Math.ceil((new Date(entry.purgeAt ?? Date.now()).getTime() - Date.now()) / 86400000)); return <tr key={entry.key}><td><input type="checkbox" aria-label={`Chọn ${entry.name}`} checked={selectedTrash.has(entry.key)} onChange={(event) => setSelectedTrash((previous) => { const next = new Set(previous); if (event.target.checked) next.add(entry.key); else next.delete(entry.key); return next; })} /></td><td className="workspace-record-name">{entry.name}</td><td>{entry.moduleName}</td><td>Còn {days} ngày</td><td><div className="workspace-row-actions"><button type="button" title="Khôi phục" aria-label={`Khôi phục ${entry.name}`} onClick={() => void restoreRecord(entry.item, entry.student, entry.support)}><RotateCcw size={16} /></button><button type="button" title="Xóa vĩnh viễn" aria-label={`Xóa ${entry.name} vĩnh viễn`} onClick={() => void purgeRecord(entry.item, entry.student, entry.support)}><Trash2 size={16} /></button></div></td></tr>; })}{!trashEntries.length && <tr><td className="workspace-state" colSpan={5}><ArchiveRestore size={22} /><strong>Thùng rác đang trống</strong></td></tr>}</tbody></table></div>
      {showBatchDelete && <div className="students-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowBatchDelete(false); }}><section className="students-detail" role="alertdialog" aria-modal="true" aria-labelledby="trash-delete-title"><div className="students-detail-header"><div><span>XÓA VĨNH VIỄN</span><h2 id="trash-delete-title">Xóa {selectedTrash.size} mục đã chọn?</h2></div><button type="button" aria-label="Đóng xác nhận" onClick={() => setShowBatchDelete(false)}><X size={19} /></button></div><p>Thao tác này không thể hoàn tác. Các mục đã chọn sẽ bị xóa khỏi hệ thống.</p><div className="workspace-form-actions"><button className="trash-danger trash-danger-confirm" type="button" onClick={() => void permanentlyDeleteSelectedTrash()}>Xóa vĩnh viễn</button><button type="button" onClick={() => setShowBatchDelete(false)}>Hủy</button></div></section></div>}
    </>}
    {module.key === "random-picker" && <div className="workspace-panel"><h2>Rút thăm nhanh</h2><p>Dán danh sách lớp, mỗi sinh viên một dòng. Kết quả được lưu để tránh gọi lặp.</p><form onSubmit={(event) => { event.preventDefault(); const text = String(new FormData(event.currentTarget).get("items") ?? ""); const candidates = text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean); if (!candidates.length) { setRandom("Hãy nhập ít nhất một lựa chọn."); return; } const key = `vtn-random-history-${new Date().toISOString().slice(0,10)}`; const used = new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]); const remaining = candidates.filter((candidate) => !used.has(candidate)); const pool = remaining.length ? remaining : candidates; const selected = pool[Math.floor(Math.random() * pool.length)]; used.add(selected); localStorage.setItem(key, JSON.stringify([...used])); setRandom(selected); }}><label>Các lựa chọn<textarea name="items" rows={7} placeholder="Nguyễn Văn A&#10;Trần Thị B" /></label><button className="workspace-primary"><Shuffle size={17} /> Chọn ngẫu nhiên</button></form>{random && <div className="workspace-random-result">{random}</div>}</div>}
    {module.key === "settings" && <><form className="workspace-form system-settings-form" onSubmit={saveSystemSettings}><h2>Thông tin trường Đại học &amp; Khoa</h2><div className="workspace-form-grid">{[["school_name","Tên trường"],["faculty","Khoa / Viện đào tạo"],["academic_year","Niên khóa"],["current_semester","Học kỳ hiện tại"],["school_address","Địa chỉ cơ sở"],["school_email","Email liên hệ đào tạo"],["school_hotline","Hotline"],["education_philosophy","Khẩu hiệu / Triết lý giáo dục"]].map(([key,label]) => <label key={key}>{label}<input name={key} defaultValue={String(systemSettings[key] ?? "")} /></label>)}</div><h2>Thông tin giảng viên phụ trách</h2><div className="workspace-form-grid">{[["lecturer_code","Mã giảng viên"],["lecturer_name","Họ và tên"],["lecturer_degree","Học hàm / Học vị"],["lecturer_title","Chức vụ"],["lecturer_department","Bộ môn"],["lecturer_email","Email giảng viên"],["lecturer_phone","Số điện thoại"],["lecturer_office","Văn phòng / Phòng tiếp sinh viên"]].map(([key,label]) => <label key={key}>{label}<input name={key} defaultValue={String(systemSettings[key] ?? "")} /></label>)}</div><h2>Quản lý thùng rác</h2><div className="workspace-form-grid"><label>Số ngày lưu trữ<input name="trash_retention_days" type="number" min={1} max={3650} required defaultValue={Number(systemSettings.trash_retention_days ?? 30)} /></label><label className="workspace-setting"><input type="checkbox" checked={reduceMotion} onChange={(event) => { const enabled = event.target.checked; setReduceMotion(enabled); localStorage.setItem("vtn-reduce-motion", String(enabled)); document.documentElement.dataset.reduceMotion = String(enabled); }} /> Giảm chuyển động giao diện</label></div><p>Tự động tạo snapshot cấu hình trước mỗi lần lưu.</p><div className="workspace-form-actions"><button className="workspace-primary">Lưu cài đặt hệ thống</button></div></form></>}
    {module.key === "audit-logs" && <>
      <div className="audit-heading-panel"><div className="audit-heading-icon"><History size={24} /></div><div className="audit-heading-copy"><h1>Nhật Ký Hệ Thống</h1><p>Ghi vết tự động mọi tác động (thao tác, thời gian, IP, chi tiết) với chính sách phân quyền lọc nghiêm ngặt</p></div><div className="audit-heading-actions">{auditRole === "super_admin" && <button className="audit-clear-button" type="button" onClick={() => void clearAuditLogs()}><Trash2 size={16} /> Dọn sạch nhật ký (Super Admin)</button>}<button className="audit-export-button" type="button" onClick={exportAuditReport}><FileSpreadsheet size={16} /> Xuất Báo Cáo XLSX ({visibleAuditLogs.length})</button></div></div>
      <div className="audit-policy-banner"><Shield size={21} /><div><strong>QUY TẮC PHÂN QUYỀN HIỂN THỊ NHẬT KÝ: <span>{auditRole === "super_admin" ? "QUẢN TRỊ VIÊN TOÀN QUYỀN" : auditRole === "system_admin" || auditRole === "sub_admin" ? "QUẢN TRỊ VIÊN" : auditRole === "teacher" ? "GIẢNG VIÊN" : "NGƯỜI DÙNG"}</span></strong><p><b>{auditRole === "super_admin" || auditRole === "system_admin" || auditRole === "sub_admin" ? "Quản trị viên (Admin):" : auditRole === "teacher" ? "Giảng viên:" : "Người dùng:"}</b> {auditRole === "super_admin" || auditRole === "system_admin" || auditRole === "sub_admin" ? "Bạn có quyền xem toàn bộ nhật ký hệ thống của tất cả người dùng và sử dụng bộ lọc tra cứu theo từng tài khoản cụ thể." : auditRole === "teacher" ? "Nhật ký chỉ hiển thị tài khoản của bạn và các sinh viên thuộc phạm vi lớp được phân công." : "Nhật ký chỉ hiển thị hoạt động của tài khoản bạn."}</p></div></div>
      <div className="workspace-panel audit-filter-panel"><label className="audit-search-field"><Search size={17} /><input aria-label="Tìm nhật ký" placeholder="Tìm theo nội dung, IP, người thực hiện..." value={auditSearch} onChange={(event) => setAuditSearch(event.target.value)} /></label><select aria-label="Lọc phân loại thao tác" value={auditAction} onChange={(event) => setAuditAction(event.target.value)}><option value="">Tất cả phân loại thao tác</option>{auditCategories.map((category) => <option key={category}>{category}</option>)}</select><select aria-label="Lọc người dùng" value={auditUser} onChange={(event) => setAuditUser(event.target.value)}><option value="">Tất cả người dùng</option>{auditUserOptions.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></div>
      <div className="workspace-table-wrap audit-table-wrap"><table className="audit-table"><thead><tr><th>MỐC THỜI GIAN</th><th>NGƯỜI THỰC HIỆN</th><th>ĐỊA CHỈ IP</th><th>PHÂN LOẠI</th><th>HÀNH ĐỘNG</th><th>CHI TIẾT THAY ĐỔI</th><th>XEM</th></tr></thead><tbody>{visibleAuditLogs.map((log) => {
        const profile = auditUsers.find((item) => item.user_id === log.actor_id);
        const actorName = profile?.display_name || profile?.username || (log.actor_id ? `Tài khoản ${log.actor_id.slice(0, 8)}` : "Người dùng đã xóa");
        const roleName = rbacRoles.find((role) => role.key === profile?.role_key)?.label ?? profile?.role_key?.toLocaleUpperCase() ?? "TÀI KHOẢN";
        const categoryClass = auditCategory(log).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-");
        return <tr key={log.id}><td className="audit-time-cell"><strong>{formatTime(log.event_at)}</strong><small>{formatDate(log.event_at)}</small></td><td className="audit-actor-cell"><strong>{actorName}</strong><small>@{profile?.username ?? log.actor_id?.slice(0, 8) ?? "đã xóa"} · {roleName}</small></td><td><span className="audit-ip-pill">{log.ip_address ?? "IP không xác định"}</span></td><td><span className={`audit-category-pill audit-category-${categoryClass}`}>{auditCategory(log)}</span></td><td className="audit-action-cell">{auditActionLabel(log.action)}{log.record_label && <small>{log.record_label}</small>}</td><td className="audit-details-cell" title={JSON.stringify(log.details)}>{JSON.stringify(log.details) || log.record_label || "—"}</td><td><div className="audit-row-actions"><button type="button" aria-label="Xem chi tiết nhật ký" title="Xem chi tiết" onClick={() => setSelectedAuditLog(log)}><Eye size={17} /></button>{auditRole === "super_admin" && <button type="button" aria-label="Xóa dòng nhật ký" title="Xóa nhật ký" onClick={() => void deleteAuditLog(log)}><Trash2 size={16} /></button>}</div></td></tr>;
      })}{!visibleAuditLogs.length && <tr><td className="workspace-state" colSpan={7}><ArchiveRestore size={22} /><strong>Không có nhật ký phù hợp</strong><span>Dữ liệu hiển thị đã được giới hạn theo quyền tài khoản.</span></td></tr>}</tbody></table></div>
      {selectedAuditLog && <div className="students-modal-backdrop audit-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedAuditLog(undefined); }}><section className="students-detail audit-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="audit-detail-title">
        <div className="audit-detail-header"><div className="audit-detail-title"><Terminal size={22} /><h2 id="audit-detail-title">Chi Tiết Bản Ghi Nhật Ký</h2></div><button type="button" aria-label="Đóng" onClick={() => setSelectedAuditLog(undefined)}><X size={22} /></button></div>
        <div className="audit-detail-summary">
          <div><strong>Mã bản ghi (Log ID):</strong><span>log_{selectedAuditLog.id}</span></div>
          <div><strong>Thời gian ghi nhận:</strong><span className="audit-value-time">{auditTimestamp(selectedAuditLog.event_at)}</span></div>
          <div><strong>Địa chỉ IP máy trạm:</strong><span className="audit-value-ip">{selectedAuditLog.ip_address ?? "Không xác định"}</span></div>
          <div><strong>Người thực hiện:</strong><span>{auditActorDetailLabel(selectedAuditLog)}</span></div>
          <div><strong>Vai trò hệ thống:</strong><span className="audit-value-role">{auditUsers.find((profile) => profile.user_id === selectedAuditLog.actor_id)?.role_key?.toLocaleUpperCase() ?? "NGƯỜI DÙNG"}</span></div>
        </div>
        <div className="audit-detail-section"><h3>Hành động:</h3><div className="audit-detail-action">{selectedAuditLog.record_label ? `${auditActionLabel(selectedAuditLog.action)}: ${selectedAuditLog.record_label}` : auditActionLabel(selectedAuditLog.action)}</div></div>
        <div className="audit-detail-section"><h3>Chi tiết thay đổi tác động:</h3><div className="audit-detail-change">{auditDetailText(selectedAuditLog)}</div></div>
        <div className="audit-detail-footer"><button type="button" onClick={() => setSelectedAuditLog(undefined)}>Đóng</button></div>
      </section></div>}
    </>}
  </section>;
}
