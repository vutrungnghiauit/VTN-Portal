import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArchiveRestore, BellRing, Download, LockKeyhole, RotateCcw, Trash2, UserRound, Shuffle, X, Search, Check, X as XMark, Eye, Shield, History, Terminal, UploadCloud } from "lucide-react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import { supabase } from "../../lib/supabase";
import { SortableTableHeader } from "../../components/SortableTableHeader";
import { sortTableRows } from "../../lib/table-sort";
import { formatDate, formatDateTime, formatTime } from "../../lib/date-format";
import { formatSemesterLabel, groupSemestersByAcademicYear, normalizeAcademicYear, normalizeSemesterName, semesterIdentity } from "../../lib/semester-groups";
import { studentService } from "../students/student.service";
import type { Student } from "../students/student.types";
import type { StudentInput } from "../students/student.types";
import { moduleByKey, type ModuleDefinition } from "./module-definitions";
import { workspaceService, type WorkspaceRecord } from "./workspace.service";
import { surveyService, type SurveyRatingSummary } from "./survey.service";
import { getTeachingPeriodCatalog } from "./teaching-plan-schedule-data";
import { auditLogService } from "../audit-logs/audit-log.service";
import { supportTicketService, type SupportTicket } from "../support-tickets/support-ticket.service";
import { sourceDataService, type StoredSourceFile } from "../source-data/source-data.service";
import type { AuditLog } from "../audit-logs/audit-log.types";
import { settingsService, type SystemBackup, type SystemSettings } from "../settings/settings.service";
import { systemTrashService } from "../trash/trash.service";
import type { SystemTrashEntry } from "../trash/trash.types";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import QuickFilterHeading from "./QuickFilterHeading";
import SearchableFilter from "../../components/SearchableFilter";
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
type StudentCourseIndexes = { profilesByCode: Map<string, Student[]>; gradesByCode: Map<string, WorkspaceRecord[]>; schedulesByCourseCode: Map<string, WorkspaceRecord[]> };
type StudyResultDimension = "semester" | "academicYear" | "course" | "className";
type StudyResultChartType = "column" | "bar" | "line" | "area" | "pie" | "doughnut" | "radar";
const studyResultDimensions: Array<{ value: StudyResultDimension; label: string }> = [
  { value: "semester", label: "Học kỳ" }, { value: "academicYear", label: "Năm học" },
  { value: "course", label: "Học phần / môn học" }, { value: "className", label: "Lớp" },
];
const studyResultChartTypes: Array<{ value: StudyResultChartType; label: string }> = [
  { value: "column", label: "Cột 2-D" }, { value: "bar", label: "Thanh ngang 2-D" },
  { value: "line", label: "Đường 2-D" }, { value: "area", label: "Vùng 2-D" },
  { value: "pie", label: "Biểu đồ tròn" }, { value: "doughnut", label: "Vành khuyên" }, { value: "radar", label: "Radar" },
];
const studyOutcomeNames = ["Xuất sắc", "Giỏi", "Khá", "Trung bình", "Đạt", "Không đạt", "Yếu", "Kém", "Chưa xếp loại"] as const;
type StudyOutcomeName = typeof studyOutcomeNames[number];
type StudyScoreSummary = { name: string; average: number; count: number };
type StudyOutcomeRow = { name: string; total: number } & Record<StudyOutcomeName, number>;
const studyOutcomeColors: Record<StudyOutcomeName, string> = {
  "Xuất sắc": "#0f9d78", "Giỏi": "#20b486", "Khá": "#4589cc", "Trung bình": "#d9a229",
  "Đạt": "#36a36f", "Không đạt": "#bd3e4b", "Yếu": "#ec8750", "Kém": "#d45454", "Chưa xếp loại": "#94a3b8",
};
const studyGroupColors = ["#3568d4", "#20b486", "#d9a229", "#8b5cf6", "#e16b5c", "#16a6b6", "#64748b", "#ca6acb"];
const ageChartColors = [
  "#b91c1c", "#1d4ed8", "#15803d", "#7e22ce", "#c2410c", "#0e7490", "#be185d", "#4d7c0f", "#4338ca", "#a16207",
  "#0f766e", "#9f1239", "#0369a1", "#6d28d9", "#047857", "#b45309", "#334155", "#7c2d12", "#4f46e5", "#a21caf",
];
function storedStudyChartType(key: string): StudyResultChartType {
  const value = localStorage.getItem(key);
  return studyResultChartTypes.some((item) => item.value === value) ? value as StudyResultChartType : "column";
}
function normalizedStudyLabel(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/đ/g, "d").trim().replace(/\s+/g, " ");
}
function readStudyScore(value: unknown, max = 10) {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!text) return null;
  const score = Number(text);
  return Number.isFinite(score) && score >= 0 && score <= max ? score : null;
}
function studyScore10(data: WorkspaceRecord["data"]) {
  const finalScore = readStudyScore(data.totalScore10);
  if (finalScore !== null) return finalScore;
  const score4 = readStudyScore(data.totalScore4, 4);
  if (score4 !== null) return score4 * 2.5;
  const midterm = readStudyScore(data.midtermScore);
  const essay = readStudyScore(data.essayScore);
  const finalExam = readStudyScore(data.finalExamScore);
  return midterm !== null && essay !== null && finalExam !== null ? midterm * 0.3 + essay * 0.2 + finalExam * 0.5 : null;
}
function studyOutcome(data: WorkspaceRecord["data"], score: number | null): StudyOutcomeName | null {
  const classification = normalizedStudyLabel(data.classification);
  if (classification.includes("xuat sac") || classification.includes("excellent")) return "Xuất sắc";
  if (classification.includes("gioi") || classification === "a") return "Giỏi";
  if (classification.includes("kha") || classification === "b" || classification === "c") return "Khá";
  if (classification.includes("trung binh") || classification === "tb" || classification === "d") return "Trung bình";
  if (classification === "dat") return "Đạt";
  if (classification.includes("khong dat")) return "Không đạt";
  if (classification.includes("yeu") || classification === "e") return "Yếu";
  if (classification.includes("kem") || classification.includes("fail") || classification === "f") return "Kém";
  if (classification.includes("chua xep loai")) return "Chưa xếp loại";
  const letter = normalizedStudyLabel(data.letterGrade).replace(/\s+/g, "");
  if (letter === "a+") return "Xuất sắc";
  if (letter === "a") return "Giỏi";
  if (letter === "b" || letter === "c") return "Khá";
  if (letter === "d") return "Trung bình";
  if (letter === "e") return "Yếu";
  if (letter === "f") return "Kém";
  if (score === null) return null;
  if (score >= 8.5) return "Giỏi";
  if (score >= 7) return "Khá";
  if (score >= 5.5) return "Trung bình";
  if (score >= 4) return "Yếu";
  return "Kém";
}
function studyResultGroupName(record: WorkspaceRecord, dimension: StudyResultDimension) {
  const data = record.data;
  if (dimension === "semester") {
    const semester = String(data.semesterName ?? data.semester ?? "").trim();
    return semester ? formatSemesterLabel(semester, data.academicYear) : "Chưa xác định học kỳ";
  }
  if (dimension === "academicYear") {
    const semester = String(data.semesterName ?? data.semester ?? "");
    const inferredYear = semester.match(/\d{4}\s*[-\u2010-\u2015\u2212]\s*\d{4}/)?.[0] ?? "";
    const year = normalizeAcademicYear(String(data.academicYear ?? "").trim() || inferredYear);
    return year || "Chưa xác định năm học";
  }
  if (dimension === "className") return String(data.className ?? data.classCode ?? "").trim() || "Chưa xác định lớp";
  return String(data.courseName ?? data.subjectName ?? data.courseCode ?? data.courseClassCode ?? data.title ?? "").trim() || "Chưa xác định học phần";
}
function studyResultGroupKey(value: string) { return normalizedStudyLabel(value) || value.toLocaleLowerCase("vi-VN"); }
function compareStudyGroupNames(left: string, right: string) {
  const leftUnknown = normalizedStudyLabel(left).startsWith("chua xac dinh");
  const rightUnknown = normalizedStudyLabel(right).startsWith("chua xac dinh");
  return Number(leftUnknown) - Number(rightUnknown) || left.localeCompare(right, "vi", { numeric: true, sensitivity: "base" });
}
function summarizeStudyScores(records: WorkspaceRecord[], dimension: StudyResultDimension): StudyScoreSummary[] {
  const groups = new Map<string, { name: string; total: number; count: number }>();
  for (const record of records) {
    const score = studyScore10(record.data);
    if (score === null) continue;
    const name = studyResultGroupName(record, dimension);
    const key = studyResultGroupKey(name);
    const group = groups.get(key) ?? { name, total: 0, count: 0 };
    group.total += score;
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.values()].map(({ name, total, count }) => ({ name, average: Math.round(total / count * 100) / 100, count })).sort((left, right) => compareStudyGroupNames(left.name, right.name));
}
function summarizeStudyOutcomes(records: WorkspaceRecord[], dimension: StudyResultDimension) {
  const groups = new Map<string, { name: string; counts: Record<StudyOutcomeName, number> }>();
  const totals = Object.fromEntries(studyOutcomeNames.map((name) => [name, 0])) as Record<StudyOutcomeName, number>;
  for (const record of records) {
    const outcome = studyOutcome(record.data, studyScore10(record.data));
    if (!outcome) continue;
    const name = studyResultGroupName(record, dimension);
    const key = studyResultGroupKey(name);
    const group = groups.get(key) ?? { name, counts: Object.fromEntries(studyOutcomeNames.map((item) => [item, 0])) as Record<StudyOutcomeName, number> };
    group.counts[outcome] += 1;
    totals[outcome] += 1;
    groups.set(key, group);
  }
  const rows = [...groups.values()].map(({ name, counts }) => {
    const total = studyOutcomeNames.reduce((sum, outcome) => sum + counts[outcome], 0);
    return { name, total, ...Object.fromEntries(studyOutcomeNames.map((outcome) => [outcome, total ? Math.round(counts[outcome] / total * 1000) / 10 : 0])) } as StudyOutcomeRow;
  }).sort((left, right) => compareStudyGroupNames(left.name, right.name));
  const slices = studyOutcomeNames.filter((name) => totals[name] > 0).map((name) => ({ name, value: totals[name], percent: Math.round(totals[name] / Math.max(1, Object.values(totals).reduce((sum, count) => sum + count, 0)) * 1000) / 10, color: studyOutcomeColors[name] }));
  return { rows, slices, gradedRecords: Object.values(totals).reduce((sum, count) => sum + count, 0) };
}
function compactChartLabel(value: unknown) {
  const label = String(value ?? "");
  return label.length > 18 ? `${label.slice(0, 17)}…` : label;
}
function studentCodeKey(value: unknown) { return normalizeLabel(String(value ?? "")).replace(/[^a-z0-9]/g, ""); }
function createStudentCourseIndexes(students: Student[], records: WorkspaceRecord[]): StudentCourseIndexes {
  const profilesByCode = new Map<string, Student[]>();
  const gradesByCode = new Map<string, WorkspaceRecord[]>();
  const schedulesByCourseCode = new Map<string, WorkspaceRecord[]>();
  for (const student of students) {
    const key = studentCodeKey(student.studentCode);
    if (key) { const profiles = profilesByCode.get(key) ?? []; profiles.push(student); profilesByCode.set(key, profiles); }
  }
  for (const record of records) {
    if (record.deleted_at) continue;
    if (record.module_key === "grades") {
      const key = studentCodeKey(record.data.studentCode);
      if (key) { const grades = gradesByCode.get(key) ?? []; grades.push(record); gradesByCode.set(key, grades); }
    } else if (record.module_key === "timetables") {
      const key = studentCodeKey(record.data.courseClassCode ?? record.data.courseCode ?? record.data.lhpCode);
      if (key) { const schedules = schedulesByCourseCode.get(key) ?? []; schedules.push(record); schedulesByCourseCode.set(key, schedules); }
    }
  }
  return { profilesByCode, gradesByCode, schedulesByCourseCode };
}
function studentCourses(student: Student, indexes: StudentCourseIndexes): StudentCourseSummary[] {
  const codeKey = studentCodeKey(student.studentCode);
  if (!codeKey) return [];
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
  (indexes.profilesByCode.get(codeKey) ?? []).forEach(readProfileCourse);
  (indexes.gradesByCode.get(codeKey) ?? []).forEach((record) => {
    const courseCode = String(record.data.courseCode ?? record.data.courseClassCode ?? "").trim();
    const courseName = String(record.data.courseName ?? record.data.subjectName ?? record.data.title ?? "").trim();
    const semester = String(record.data.semesterName ?? record.data.semester ?? "").trim();
    if (courseCode || courseName) summaries.push({ courseCode, courseName, semester });
  });
  const registeredCourseCodes = new Set(summaries.map((item) => normalizeLabel(item.courseCode).replace(/[^a-z0-9]/g, "")).filter(Boolean));
  for (const scheduleCodeKey of registeredCourseCodes) for (const record of indexes.schedulesByCourseCode.get(scheduleCodeKey) ?? []) {
      const scheduleCode = String(record.data.courseClassCode ?? record.data.courseCode ?? record.data.lhpCode ?? "").trim();
      const courseName = String(record.data.subjectName ?? record.data.courseName ?? record.data.title ?? "").trim();
      const semester = String(record.data.semesterName ?? record.data.semester ?? "").trim();
      summaries.push({ courseCode: scheduleCode, courseName, semester });
    }
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
function OverviewChartTypeSelect({ chartType, onChange, ariaLabel }: { chartType: StudyResultChartType; onChange: (chartType: StudyResultChartType) => void; ariaLabel: string }) {
  return <label className="overview-chart-type-picker">Kiểu biểu đồ<select aria-label={ariaLabel} value={chartType} onChange={(event) => onChange(event.target.value as StudyResultChartType)}>{studyResultChartTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>;
}

function chartCategoryClick(state: unknown, onSelect: (name: string) => void) {
  const point = state as { activePayload?: Array<{ payload?: { name?: unknown } }> } | null;
  const name = String(point?.activePayload?.[0]?.payload?.name ?? "");
  if (name) onSelect(name);
}

function StudyStatusChart({ data, hidden, total, onToggle, chartType }: { data: Array<{ name: string; value: number; color: string }>; hidden: Set<string>; total: number; onToggle: (name: string) => void; chartType: StudyResultChartType }) {
  const visible = data.filter((item) => !hidden.has(item.name));
  const tooltip = <Tooltip contentStyle={{ border: "1px solid #DCE8FF", borderRadius: 12, boxShadow: "0 12px 32px #17255426" }} formatter={(value) => [`${Number(value).toLocaleString("vi-VN")} sinh viên`, "Số lượng"]} />;
  const chart = chartType === "pie" || chartType === "doughnut" ? <div className="overview-donut"><ResponsiveContainer width="100%" height="100%"><PieChart>
    <Pie data={visible} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={chartType === "doughnut" ? 68 : 0} outerRadius={103} paddingAngle={0} stroke="none" strokeWidth={0}>{visible.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie>
    {chartType === "doughnut" && <><text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" className="overview-donut-total">{total}</text><text x="50%" y="55%" textAnchor="middle" dominantBaseline="middle" className="overview-donut-caption">HỒ SƠ</text></>}{tooltip}
  </PieChart></ResponsiveContainer></div>
    : chartType === "radar" ? <div className="overview-result-chart-area"><ResponsiveContainer width="100%" height="100%"><RadarChart data={visible} outerRadius="75%"><PolarGrid /><PolarAngleAxis dataKey="name" tick={{ fontSize: 9, fill: "#64748b" }} /><PolarRadiusAxis tick={{ fontSize: 9, fill: "#64748b" }} /><Radar dataKey="value" name="Sinh viên" stroke="#3568d4" fill="#6a91e8" fillOpacity={0.4} />{tooltip}</RadarChart></ResponsiveContainer></div>
    : chartType === "line" ? <div className="overview-result-chart-area"><ResponsiveContainer width="100%" height="100%"><LineChart data={visible} margin={{ top: 8, right: 12, bottom: 12, left: -15 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tickFormatter={compactChartLabel} interval="preserveStartEnd" angle={-18} textAnchor="end" height={48} tick={{ fontSize: 9, fill: "#64748b" }} /><YAxis allowDecimals={false} tick={{ fontSize: 9, fill: "#64748b" }} />{tooltip}<Line type="monotone" dataKey="value" name="Sinh viên" stroke="#3568d4" strokeWidth={2.5} dot={{ r: 4 }} /></LineChart></ResponsiveContainer></div>
    : chartType === "area" ? <div className="overview-result-chart-area"><ResponsiveContainer width="100%" height="100%"><AreaChart data={visible} margin={{ top: 8, right: 12, bottom: 12, left: -15 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tickFormatter={compactChartLabel} interval="preserveStartEnd" angle={-18} textAnchor="end" height={48} tick={{ fontSize: 9, fill: "#64748b" }} /><YAxis allowDecimals={false} tick={{ fontSize: 9, fill: "#64748b" }} />{tooltip}<Area type="monotone" dataKey="value" name="Sinh viên" stroke="#3568d4" fill="#8eb0f4" fillOpacity={0.42} /></AreaChart></ResponsiveContainer></div>
    : <div className="overview-result-chart-area"><ResponsiveContainer width="100%" height="100%"><BarChart data={visible} layout={chartType === "bar" ? "vertical" : "horizontal"} margin={{ top: 8, right: 12, bottom: 14, left: chartType === "bar" ? 2 : -15 }}><CartesianGrid strokeDasharray="3 3" horizontal={chartType !== "bar"} vertical={chartType === "bar"} />{chartType === "bar" ? <><XAxis type="number" allowDecimals={false} tick={{ fontSize: 9, fill: "#64748b" }} /><YAxis type="category" dataKey="name" width={105} tickFormatter={compactChartLabel} tick={{ fontSize: 9, fill: "#64748b" }} /></> : <><XAxis dataKey="name" tickFormatter={compactChartLabel} interval="preserveStartEnd" angle={-18} textAnchor="end" height={48} tick={{ fontSize: 9, fill: "#64748b" }} /><YAxis allowDecimals={false} tick={{ fontSize: 9, fill: "#64748b" }} /></>}{tooltip}<Bar dataKey="value" name="Sinh viên" radius={chartType === "bar" ? [0, 4, 4, 0] : [4, 4, 0, 0]}>{visible.map((item) => <Cell key={item.name} fill={item.color} />)}</Bar></BarChart></ResponsiveContainer></div>;
  return <div className="overview-status-chart">
    {chart}
    <div className="overview-status-legend" aria-label="Chọn trạng thái học tập">
      {data.map((item) => <button type="button" key={item.name} aria-pressed={!hidden.has(item.name)} className={hidden.has(item.name) ? "is-hidden" : ""} onClick={() => onToggle(item.name)}><span style={{ background: item.color }} /><span>{item.name}</span><strong>{item.value}</strong></button>)}
    </div>
  </div>;
}

function OverviewCategoryChart({ data, unit, caption, chartType }: { data: Array<{ name: string; value: number; color: string }>; unit: string; caption: string; chartType: StudyResultChartType }) {
  const chartData = data.filter((item) => item.value > 0);
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const tooltip = <Tooltip contentStyle={{ border: "1px solid #DCE8FF", borderRadius: 12, boxShadow: "0 12px 32px #17255426" }} formatter={(value) => [`${Number(value).toLocaleString("vi-VN")} ${unit}`, "Số lượng"]} />;
  const chart = chartType === "pie" || chartType === "doughnut" ? <div className="overview-donut"><ResponsiveContainer width="100%" height="100%"><PieChart>
    <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={chartType === "doughnut" ? 68 : 0} outerRadius={103} paddingAngle={0} stroke="none" strokeWidth={0}>{chartData.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie>
    {chartType === "doughnut" && <><text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" className="overview-donut-total">{total.toLocaleString("vi-VN")}</text><text x="50%" y="55%" textAnchor="middle" dominantBaseline="middle" className="overview-donut-caption">{caption}</text></>}{tooltip}
  </PieChart></ResponsiveContainer></div>
    : chartType === "radar" ? <div className="overview-result-chart-area"><ResponsiveContainer width="100%" height="100%"><RadarChart data={chartData} outerRadius="75%"><PolarGrid /><PolarAngleAxis dataKey="name" tickFormatter={compactChartLabel} tick={{ fontSize: 9, fill: "#64748b" }} /><PolarRadiusAxis tick={{ fontSize: 9, fill: "#64748b" }} /><Radar dataKey="value" name={unit} stroke="#3568d4" fill="#6a91e8" fillOpacity={0.4} />{tooltip}</RadarChart></ResponsiveContainer></div>
    : chartType === "line" ? <div className="overview-result-chart-area"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 12, left: -15 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tickFormatter={compactChartLabel} interval="preserveStartEnd" angle={-18} textAnchor="end" height={48} tick={{ fontSize: 9, fill: "#64748b" }} /><YAxis allowDecimals={false} tick={{ fontSize: 9, fill: "#64748b" }} />{tooltip}<Line type="monotone" dataKey="value" name={unit} stroke="#3568d4" strokeWidth={2.5} dot={{ r: 4 }} /></LineChart></ResponsiveContainer></div>
    : chartType === "area" ? <div className="overview-result-chart-area"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 8, right: 12, bottom: 12, left: -15 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tickFormatter={compactChartLabel} interval="preserveStartEnd" angle={-18} textAnchor="end" height={48} tick={{ fontSize: 9, fill: "#64748b" }} /><YAxis allowDecimals={false} tick={{ fontSize: 9, fill: "#64748b" }} />{tooltip}<Area type="monotone" dataKey="value" name={unit} stroke="#3568d4" fill="#8eb0f4" fillOpacity={0.42} /></AreaChart></ResponsiveContainer></div>
    : <div className="overview-result-chart-area"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} layout={chartType === "bar" ? "vertical" : "horizontal"} margin={{ top: 8, right: 12, bottom: 14, left: chartType === "bar" ? 2 : -15 }}><CartesianGrid strokeDasharray="3 3" horizontal={chartType !== "bar"} vertical={chartType === "bar"} />{chartType === "bar" ? <><XAxis type="number" allowDecimals={false} tick={{ fontSize: 9, fill: "#64748b" }} /><YAxis type="category" dataKey="name" width={105} tickFormatter={compactChartLabel} tick={{ fontSize: 9, fill: "#64748b" }} /></> : <><XAxis dataKey="name" tickFormatter={compactChartLabel} interval="preserveStartEnd" angle={-18} textAnchor="end" height={48} tick={{ fontSize: 9, fill: "#64748b" }} /><YAxis allowDecimals={false} tick={{ fontSize: 9, fill: "#64748b" }} /></>}{tooltip}<Bar dataKey="value" name={unit} radius={chartType === "bar" ? [0, 4, 4, 0] : [4, 4, 0, 0]}>{chartData.map((item) => <Cell key={item.name} fill={item.color} />)}</Bar></BarChart></ResponsiveContainer></div>;
  return <div className="overview-status-chart overview-category-chart">
    {chart}
    <div className="overview-status-legend overview-category-legend" role="list" aria-label={`Phân loại ${unit.toLocaleLowerCase("vi-VN")}`}>
      {data.map((item) => <div key={item.name} role="listitem"><span style={{ background: item.color }} /><span title={item.name}>{item.name}</span><strong>{item.value.toLocaleString("vi-VN")}</strong></div>)}
    </div>
  </div>;
}

function OverviewInteractiveChart({ data, unit, caption, selected, onSelect, chartType }: { data: Array<{ name: string; value: number; color: string }>; unit: string; caption: string; selected: string; onSelect: (name: string) => void; chartType: StudyResultChartType }) {
  const chartData = data.filter((item) => item.value > 0);
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const selectedValue = data.find((item) => item.name === selected)?.value;
  const toggleSelection = (name: string) => onSelect(selected === name ? "" : name);
  const tooltip = <Tooltip contentStyle={{ border: "1px solid #DCE8FF", borderRadius: 12, boxShadow: "0 12px 32px #17255426" }} formatter={(value) => [`${Number(value).toLocaleString("vi-VN")} ${unit}`, "Số lượng"]} />;
  const chart = chartType === "pie" || chartType === "doughnut" ? <div className="overview-donut"><ResponsiveContainer width="100%" height="100%"><PieChart>
    <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={chartType === "doughnut" ? 66 : 0} outerRadius={103} paddingAngle={0} stroke="none" strokeWidth={0} cursor="pointer" onClick={(entry) => { const point = entry as { name?: string; payload?: { name?: string } }; const name = String(point?.payload?.name ?? point?.name ?? ""); if (name) toggleSelection(name); }}>{chartData.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie>
    {chartType === "doughnut" && <><text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" className="overview-donut-total">{(selectedValue ?? total).toLocaleString("vi-VN")}</text><text x="50%" y="55%" textAnchor="middle" dominantBaseline="middle" className="overview-donut-caption">{caption}</text></>}{tooltip}
  </PieChart></ResponsiveContainer></div>
    : chartType === "radar" ? <div className="overview-result-chart-area"><ResponsiveContainer width="100%" height="100%"><RadarChart data={chartData} onClick={(state) => chartCategoryClick(state, toggleSelection)} outerRadius="75%"><PolarGrid /><PolarAngleAxis dataKey="name" tickFormatter={compactChartLabel} tick={{ fontSize: 9, fill: "#64748b" }} /><PolarRadiusAxis tick={{ fontSize: 9, fill: "#64748b" }} /><Radar dataKey="value" name={unit} stroke="#3568d4" fill="#6a91e8" fillOpacity={0.4} />{tooltip}</RadarChart></ResponsiveContainer></div>
    : chartType === "line" ? <div className="overview-result-chart-area"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} onClick={(state) => chartCategoryClick(state, toggleSelection)} margin={{ top: 8, right: 12, bottom: 12, left: -15 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tickFormatter={compactChartLabel} interval="preserveStartEnd" angle={-18} textAnchor="end" height={48} tick={{ fontSize: 9, fill: "#64748b" }} /><YAxis allowDecimals={false} tick={{ fontSize: 9, fill: "#64748b" }} />{tooltip}<Line type="monotone" dataKey="value" name={unit} stroke="#3568d4" strokeWidth={2.5} dot={{ r: 4 }} /></LineChart></ResponsiveContainer></div>
    : chartType === "area" ? <div className="overview-result-chart-area"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} onClick={(state) => chartCategoryClick(state, toggleSelection)} margin={{ top: 8, right: 12, bottom: 12, left: -15 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tickFormatter={compactChartLabel} interval="preserveStartEnd" angle={-18} textAnchor="end" height={48} tick={{ fontSize: 9, fill: "#64748b" }} /><YAxis allowDecimals={false} tick={{ fontSize: 9, fill: "#64748b" }} />{tooltip}<Area type="monotone" dataKey="value" name={unit} stroke="#3568d4" fill="#8eb0f4" fillOpacity={0.42} /></AreaChart></ResponsiveContainer></div>
    : <div className="overview-result-chart-area"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} onClick={(state) => chartCategoryClick(state, toggleSelection)} layout={chartType === "bar" ? "vertical" : "horizontal"} margin={{ top: 8, right: 12, bottom: 14, left: chartType === "bar" ? 2 : -15 }}><CartesianGrid strokeDasharray="3 3" horizontal={chartType !== "bar"} vertical={chartType === "bar"} />{chartType === "bar" ? <><XAxis type="number" allowDecimals={false} tick={{ fontSize: 9, fill: "#64748b" }} /><YAxis type="category" dataKey="name" width={105} tickFormatter={compactChartLabel} tick={{ fontSize: 9, fill: "#64748b" }} /></> : <><XAxis dataKey="name" tickFormatter={compactChartLabel} interval="preserveStartEnd" angle={-18} textAnchor="end" height={48} tick={{ fontSize: 9, fill: "#64748b" }} /><YAxis allowDecimals={false} tick={{ fontSize: 9, fill: "#64748b" }} /></>}{tooltip}<Bar dataKey="value" name={unit} cursor="pointer" radius={chartType === "bar" ? [0, 4, 4, 0] : [4, 4, 0, 0]}>{chartData.map((item) => <Cell key={item.name} fill={item.color} fillOpacity={!selected || selected === item.name ? 1 : 0.38} />)}</Bar></BarChart></ResponsiveContainer></div>;
  return <div className="overview-status-chart">
    {chart}
    <div className="overview-status-legend" role="group" aria-label={`Phân loại ${unit.toLocaleLowerCase("vi-VN")}`}>
      {data.map((item) => <button type="button" key={item.name} aria-pressed={selected === item.name} className={selected === item.name ? "is-selected" : ""} onClick={() => toggleSelection(item.name)}><span style={{ background: item.color }} /><span title={item.name}>{item.name}</span><strong>{item.value.toLocaleString("vi-VN")}</strong></button>)}
    </div>
  </div>;
}

function StudyAverageChart({ data, chartType }: { data: StudyScoreSummary[]; chartType: StudyResultChartType }) {
  const rows = data.map((item, index) => ({ ...item, color: studyGroupColors[index % studyGroupColors.length] }));
  const tooltip = <Tooltip contentStyle={{ border: "1px solid #DCE8FF", borderRadius: 10, boxShadow: "0 12px 32px #17255426" }} formatter={(value) => [`${Number(value).toFixed(2)} / 10`, "Điểm trung bình"]} />;
  if (chartType === "pie" || chartType === "doughnut") return <div className="overview-result-pie-layout"><div className="overview-result-pie"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={rows.filter((item) => item.average > 0)} dataKey="average" nameKey="name" cx="50%" cy="50%" innerRadius={chartType === "doughnut" ? 48 : 0} outerRadius={88} paddingAngle={0} stroke="none" strokeWidth={0}>{rows.filter((item) => item.average > 0).map((item) => <Cell key={item.name} fill={item.color} />)}</Pie>{tooltip}</PieChart></ResponsiveContainer></div><div className="overview-result-legend">{rows.map((item) => <div key={item.name}><span style={{ background: item.color }} /><span title={item.name}>{item.name}</span><strong>{item.average.toFixed(2)} / 10</strong></div>)}</div></div>;
  if (chartType === "radar") return <div className="overview-result-chart-area"><ResponsiveContainer width="100%" height="100%"><RadarChart data={rows} outerRadius="75%"><PolarGrid /><PolarAngleAxis dataKey="name" tickFormatter={compactChartLabel} tick={{ fontSize: 9, fill: "#64748b" }} /><PolarRadiusAxis domain={[0, 10]} tick={{ fontSize: 9, fill: "#64748b" }} /><Radar dataKey="average" name="Điểm trung bình" stroke="#3568d4" fill="#6a91e8" fillOpacity={0.4} />{tooltip}</RadarChart></ResponsiveContainer></div>;
  if (chartType === "bar") return <div className="overview-result-chart-area"><ResponsiveContainer width="100%" height="100%"><BarChart data={rows} layout="vertical" margin={{ top: 5, right: 16, bottom: 5, left: 4 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" domain={[0, 10]} tick={{ fontSize: 10, fill: "#64748b" }} /><YAxis type="category" dataKey="name" width={112} tickFormatter={compactChartLabel} tick={{ fontSize: 10, fill: "#64748b" }} /><Tooltip contentStyle={{ border: "1px solid #DCE8FF", borderRadius: 10 }} formatter={(value) => [`${Number(value).toFixed(2)} / 10`, "Điểm trung bình"]} /><Bar dataKey="average" name="Điểm trung bình" fill="#3568d4" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div>;
  const axes = <><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tickFormatter={compactChartLabel} interval="preserveStartEnd" angle={-22} textAnchor="end" height={54} tick={{ fontSize: 9, fill: "#64748b" }} /><YAxis domain={[0, 10]} tick={{ fontSize: 10, fill: "#64748b" }} />{tooltip}</>;
  if (chartType === "line") return <div className="overview-result-chart-area"><ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ top: 8, right: 14, bottom: 16, left: -18 }}>{axes}<Line type="monotone" dataKey="average" name="Điểm trung bình" stroke="#3568d4" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} /></LineChart></ResponsiveContainer></div>;
  if (chartType === "area") return <div className="overview-result-chart-area"><ResponsiveContainer width="100%" height="100%"><AreaChart data={rows} margin={{ top: 8, right: 14, bottom: 16, left: -18 }}>{axes}<Area type="monotone" dataKey="average" name="Điểm trung bình" stroke="#3568d4" fill="#8eb0f4" fillOpacity={0.42} /></AreaChart></ResponsiveContainer></div>;
  return <div className="overview-result-chart-area"><ResponsiveContainer width="100%" height="100%"><BarChart data={rows} margin={{ top: 8, right: 14, bottom: 16, left: -18 }}>{axes}<Bar dataKey="average" name="Điểm trung bình" fill="#3568d4" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>;
}

function StudyOutcomeChart({ rows, slices, chartType }: { rows: StudyOutcomeRow[]; slices: Array<{ name: StudyOutcomeName; value: number; percent: number; color: string }>; chartType: StudyResultChartType }) {
  const series = studyOutcomeNames.filter((name) => rows.some((row) => row[name] > 0));
  if (chartType === "pie" || chartType === "doughnut") return <div className="overview-result-pie-layout"><div className="overview-result-pie"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={slices} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={chartType === "doughnut" ? 48 : 0} outerRadius={88} paddingAngle={0} stroke="none" strokeWidth={0}>{slices.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie><Tooltip contentStyle={{ border: "1px solid #DCE8FF", borderRadius: 10 }} formatter={(value, name) => [`${Number(value).toLocaleString("vi-VN")} lượt`, String(name)]} /></PieChart></ResponsiveContainer></div><div className="overview-result-legend">{slices.map((item) => <div key={item.name}><span style={{ background: item.color }} /><span title={item.name}>{item.name}</span><strong>{item.percent.toFixed(1)}%</strong></div>)}</div></div>;
  if (chartType === "radar") return <div className="overview-result-chart-area"><ResponsiveContainer width="100%" height="100%"><RadarChart data={rows} outerRadius="70%"><PolarGrid /><PolarAngleAxis dataKey="name" tickFormatter={compactChartLabel} tick={{ fontSize: 9, fill: "#64748b" }} /><PolarRadiusAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 8, fill: "#64748b" }} />{series.map((name) => <Radar key={name} dataKey={name} name={name} stroke={studyOutcomeColors[name]} fill={studyOutcomeColors[name]} fillOpacity={0.12} />)}<Legend wrapperStyle={{ fontSize: 10 }} /><Tooltip contentStyle={{ border: "1px solid #DCE8FF", borderRadius: 10 }} formatter={(value, name) => [`${Number(value).toFixed(1)}%`, String(name)]} /></RadarChart></ResponsiveContainer></div>;
  const common = <><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tickFormatter={compactChartLabel} interval="preserveStartEnd" angle={-22} textAnchor="end" height={54} tick={{ fontSize: 9, fill: "#64748b" }} /><YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 9, fill: "#64748b" }} /><Legend wrapperStyle={{ fontSize: 10 }} /><Tooltip contentStyle={{ border: "1px solid #DCE8FF", borderRadius: 10 }} formatter={(value, name) => [`${Number(value).toFixed(1)}%`, String(name)]} /></>;
  if (chartType === "bar") return <div className="overview-result-chart-area"><ResponsiveContainer width="100%" height="100%"><BarChart data={rows} layout="vertical" margin={{ top: 8, right: 20, bottom: 8, left: 4 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 9, fill: "#64748b" }} /><YAxis type="category" dataKey="name" width={112} tickFormatter={compactChartLabel} tick={{ fontSize: 9, fill: "#64748b" }} /><Legend wrapperStyle={{ fontSize: 10 }} /><Tooltip contentStyle={{ border: "1px solid #DCE8FF", borderRadius: 10 }} formatter={(value, name) => [`${Number(value).toFixed(1)}%`, String(name)]} />{series.map((name) => <Bar key={name} dataKey={name} name={name} stackId="share" fill={studyOutcomeColors[name]} />)}</BarChart></ResponsiveContainer></div>;
  if (chartType === "line") return <div className="overview-result-chart-area"><ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ top: 8, right: 14, bottom: 16, left: -16 }}>{common}{series.map((name) => <Line key={name} type="monotone" dataKey={name} name={name} stroke={studyOutcomeColors[name]} strokeWidth={2} dot={{ r: 2 }} />)}</LineChart></ResponsiveContainer></div>;
  if (chartType === "area") return <div className="overview-result-chart-area"><ResponsiveContainer width="100%" height="100%"><AreaChart data={rows} margin={{ top: 8, right: 14, bottom: 16, left: -16 }}>{common}{series.map((name) => <Area key={name} type="monotone" dataKey={name} name={name} stackId="share" stroke={studyOutcomeColors[name]} fill={studyOutcomeColors[name]} fillOpacity={0.5} />)}</AreaChart></ResponsiveContainer></div>;
  return <div className="overview-result-chart-area"><ResponsiveContainer width="100%" height="100%"><BarChart data={rows} margin={{ top: 8, right: 14, bottom: 16, left: -16 }}>{common}{series.map((name) => <Bar key={name} dataKey={name} name={name} stackId="share" fill={studyOutcomeColors[name]} radius={[2, 2, 0, 0]} />)}</BarChart></ResponsiveContainer></div>;
}

export default function SystemModulePage({ module, role = "student", canTestPush = false, canViewSurveyResults = false, canParticipateSurveys = false, permissions = { read: true, create: true, update: true, delete: true, restore: true, export: true } }: { module: ModuleDefinition; role?: string; canTestPush?: boolean; canViewSurveyResults?: boolean; canParticipateSurveys?: boolean; permissions?: { read: boolean; create: boolean; update: boolean; delete: boolean; restore: boolean; export: boolean } }) {
  const canViewSurveyResultsForRole = ["super_admin", "system_admin", "sub_admin", "teacher", "assistant"].includes(role) && canViewSurveyResults;
  const isStudentSurveyUser = ["student", "class_president", "class_vice"].includes(role) && canParticipateSurveys;
  const [user, setUser] = useState<{ email?: string; name?: string; phone?: string }>();
  const [systemSettings, setSystemSettings] = useState<SystemSettings>({});
  const [systemBackups, setSystemBackups] = useState<SystemBackup[]>([]);
  const [backupPageSize, setBackupPageSize] = useState<"10" | "20" | "50" | "100" | "all">("10");
  const [backupPage, setBackupPage] = useState(1);
  const [backupSort, setBackupSort] = useState({ key: "ordinal", direction: "asc" as "asc" | "desc" });
  const [selectedBackupIds, setSelectedBackupIds] = useState<Set<string>>(() => new Set());
  const [canManageBackups, setCanManageBackups] = useState(false);
  const [dashboardRecords, setDashboardRecords] = useState<WorkspaceRecord[]>([]);
  const [dashboardGradeRecords, setDashboardGradeRecords] = useState<WorkspaceRecord[]>([]);
  const [dashboardGradesLoading, setDashboardGradesLoading] = useState(false);
  const [dashboardStudentsLoading, setDashboardStudentsLoading] = useState(false);
  const [dashboardRecordsLoading, setDashboardRecordsLoading] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [trash, setTrash] = useState<WorkspaceRecord[]>([]);
  const [trashedStudents, setTrashedStudents] = useState<Student[]>([]);
  const [trashedSupportTickets, setTrashedSupportTickets] = useState<SupportTicket[]>([]);
  const [otherTrashedItems, setOtherTrashedItems] = useState<SystemTrashEntry[]>([]);
  const [trashPageSize, setTrashPageSize] = useState<"10" | "20" | "50" | "100" | "all">("10");
  const [trashPage, setTrashPage] = useState(1);
  const [trashSort, setTrashSort] = useState({ key: "ordinal", direction: "asc" as "asc" | "desc" });
  const [selectedTrash, setSelectedTrash] = useState<Set<string>>(() => new Set());
  const [showBatchDelete, setShowBatchDelete] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditTrashEntries, setAuditTrashEntries] = useState<SystemTrashEntry[]>([]);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditAction, setAuditAction] = useState("");
  const [auditUser, setAuditUser] = useState("");
  const [auditPageSize, setAuditPageSize] = useState<"10" | "20" | "50" | "100" | "all">("10");
  const [auditPage, setAuditPage] = useState(1);
  const [auditSort, setAuditSort] = useState({ key: "ordinal", direction: "asc" as "asc" | "desc" });
  const [selectedAuditLogIds, setSelectedAuditLogIds] = useState<Set<number>>(() => new Set());
  const [auditExportFormat, setAuditExportFormat] = useState<"xls" | "csv" | "pdf">("xls");
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
  const [todayBirthdayDialogOpen, setTodayBirthdayDialogOpen] = useState(false);
  const [selectedAgeMetric, setSelectedAgeMetric] = useState("");
  const [studyStatusChartType, setStudyStatusChartType] = useState<StudyResultChartType>(() => storedStudyChartType("vtn-dashboard-study-status-chart"));
  const [ageChartType, setAgeChartType] = useState<StudyResultChartType>(() => storedStudyChartType("vtn-dashboard-age-chart"));
  const [semesterStudentChartType, setSemesterStudentChartType] = useState<StudyResultChartType>(() => storedStudyChartType("vtn-dashboard-semester-students-chart"));
  const [semesterCourseChartType, setSemesterCourseChartType] = useState<StudyResultChartType>(() => storedStudyChartType("vtn-dashboard-semester-courses-chart"));
  const [majorChartType, setMajorChartType] = useState<StudyResultChartType>(() => storedStudyChartType("vtn-dashboard-major-chart"));
  const [studyScoreDimension, setStudyScoreDimension] = useState<StudyResultDimension>(() => {
    const value = localStorage.getItem("vtn-dashboard-study-score-dimension");
    return studyResultDimensions.some((item) => item.value === value) ? value as StudyResultDimension : "semester";
  });
  const [studyOutcomeDimension, setStudyOutcomeDimension] = useState<StudyResultDimension>(() => {
    const value = localStorage.getItem("vtn-dashboard-study-outcome-dimension");
    return studyResultDimensions.some((item) => item.value === value) ? value as StudyResultDimension : "semester";
  });
  const [studyScoreChartType, setStudyScoreChartType] = useState<StudyResultChartType>(() => storedStudyChartType("vtn-dashboard-study-score-chart"));
  const [studyOutcomeChartType, setStudyOutcomeChartType] = useState<StudyResultChartType>(() => storedStudyChartType("vtn-dashboard-study-outcome-chart"));
  const [surveyRatingSummary, setSurveyRatingSummary] = useState<SurveyRatingSummary>({ averageRating: 0, responseCount: 0 });

  useEffect(() => {
    if (!todayBirthdayDialogOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTodayBirthdayDialogOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [todayBirthdayDialogOpen]);

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
          setDashboardStudentsLoading(true); setDashboardRecordsLoading(true); setDashboardGradesLoading(true); setLoading(false);
          const gradeRequest = workspaceService.list("grades").then((grades) => {
            if (active) setDashboardGradeRecords(grades);
          }).catch((cause) => {
            if (active) setError(cause instanceof Error ? `Không tải được dữ liệu điểm: ${cause.message}` : "Không tải được dữ liệu điểm.");
          }).finally(() => { if (active) setDashboardGradesLoading(false); });
          const [newStudents, settings, semesters] = await Promise.all([studentService.list(), settingsService.get(), workspaceService.list("semesters")]);
          if (active) {
            setStudents(newStudents); setSystemSettings(settings); setCurrentSemester(String(settings.current_semester ?? ""));
            setSemesterNames(semesters.map((row) => formatSemesterLabel(row.data.title, row.data.academicYear)).filter(Boolean));
            setSemesterPeriods(semesters.map((row) => ({ title: String(row.data.title ?? ""), startDate: String(row.data.startDate ?? ""), endDate: String(row.data.endDate ?? "") })).filter((row) => row.title));
            setDashboardStudentsLoading(false);
          }
          const records = await workspaceService.allRecords();
          if (active) { setDashboardRecords(records); setDashboardRecordsLoading(false); }
          await gradeRequest;
        } else if (module.key === "trash") {
          const [records, studentsInTrash, supportTickets, settings, otherItems] = await Promise.all([workspaceService.listTrash(), studentService.listTrash(), supportTicketService.listTrash(), settingsService.get(), systemTrashService.list()]);
          if (active) {
            setTrash(records); setTrashedStudents(studentsInTrash); setTrashedSupportTickets(supportTickets); setOtherTrashedItems(otherItems); setSystemSettings(settings);
            if (permissions.delete) void scanExpiredTrash(false);
          }
        } else if (module.key === "audit-logs") {
          const [logs, trashEntries, { data: access, error: accessError }] = await Promise.all([auditLogService.list(), permissions.restore ? systemTrashService.list() : Promise.resolve([]), supabase.rpc("get_my_access_matrix")]);
          if (accessError) throw accessError;
          const actorIds = [...new Set(logs.map((log) => log.actor_id).filter((id): id is string => Boolean(id)))];
          let users: Array<{ user_id: string; username: string | null; display_name: string; role_key: string }> = [];
          if (actorIds.length) {
            const { data: profiles, error: profilesError } = await supabase.from("user_profiles").select("user_id,username,display_name,role_key").in("user_id", actorIds);
            if (profilesError) throw profilesError;
            users = profiles ?? [];
          }
          if (active) { setAuditLogs(logs); setAuditTrashEntries(trashEntries.filter((entry) => entry.entity_type === "system_audit_logs")); setAuditRole(String((access as { role?: string } | null)?.role ?? "")); setAuditUsers(users); }
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
          if (active && ["super_admin","system_admin","sub_admin"].includes(role) && permissions.read) { setCanManageBackups(permissions.create || (permissions.restore && permissions.update)); setSystemBackups(await settingsService.backups()); }
        }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Không thể tải dữ liệu."); }
      finally { if (active) { setLoading(false); setDashboardStudentsLoading(false); setDashboardRecordsLoading(false); setDashboardGradesLoading(false); } }
    }
    void load(); return () => { active = false; };
  }, [module.key]);
  useEffect(() => {
    if (module.key !== "dashboard" || !canViewSurveyResultsForRole) return;
    let active = true;
    const refresh = async () => {
      try { const summary = await surveyService.ratingSummary(); if (active) setSurveyRatingSummary(summary); }
      catch { if (active) setSurveyRatingSummary({ averageRating: 0, responseCount: 0 }); }
    };
    const unsubscribe = surveyService.subscribeToRatings(() => { void refresh(); });
    const refreshTimer = window.setInterval(() => { void refresh(); }, 30_000);
    window.addEventListener("vtn-surveys-updated", refresh);
    void refresh();
    return () => { active = false; window.clearInterval(refreshTimer); unsubscribe(); window.removeEventListener("vtn-surveys-updated", refresh); };
  }, [module.key, canViewSurveyResultsForRole]);
  useEffect(() => {
    if (module.key !== "dashboard") return;
    let active = true;
    const refreshStudents = () => { void studentService.list().then((rows) => { if (active) setStudents(rows); }).catch(() => undefined); };
    window.addEventListener("vtn-students-updated", refreshStudents);
    return () => { active = false; window.removeEventListener("vtn-students-updated", refreshStudents); };
  }, [module.key]);
  useEffect(() => { const update = (event: Event) => setSemesterFilter((event as CustomEvent<string>).detail || "all"); window.addEventListener("vtn-semester-filter-changed", update); return () => window.removeEventListener("vtn-semester-filter-changed", update); }, []);

  async function exportBackup() {
    if (!permissions.export) return;
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
    if (!permissions.create || !permissions.update) return;
    setError(""); setNotice("");
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== "object" || (parsed as { format?: string }).format !== "vtn-portal-backup-v1") throw new Error("Tệp không đúng định dạng bản sao lưu VTN Portal.");
      await sourceDataService.archiveImportedFile(file, "backup");
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
    if (!permissions.restore) return;
    try { if (support) await supportTicketService.restore(item.id); else if (student) await studentService.restore(item.id); else await workspaceService.restore(item.id); setNotice("Đã khôi phục hồ sơ."); window.location.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể khôi phục hồ sơ."); }
  }

  async function permanentlyDeleteWorkspaceRecord(item: WorkspaceRecord) {
    if (item.module_key === "source-data-files") await sourceDataService.deleteOriginalFilePermanently(item as StoredSourceFile);
    else if (item.module_key === "surveys") await systemTrashService.deleteSurveyPermanently(item.id);
    else await workspaceService.deletePermanently(item.id);
  }

  async function purgeRecord(item: WorkspaceRecord | Student | SupportTicket, student: boolean, support = false) {
    if (!permissions.delete) return;
    const name = support ? (item as SupportTicket).title : student ? (item as Student).fullName : String((item as WorkspaceRecord).data.title ?? "bản ghi");
    if (!window.confirm(`Xóa vĩnh viễn “${name}”? Thao tác này không thể hoàn tác.`)) return;
    try { if (support) await supportTicketService.deletePermanently(item.id); else if (student) await studentService.deletePermanently(item.id); else await permanentlyDeleteWorkspaceRecord(item as WorkspaceRecord); window.location.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể xóa hồ sơ."); }
  }

  async function reloadTrashLists() {
    const [records, studentsInTrash, supportTickets, otherItems] = await Promise.all([
      workspaceService.listTrash(), studentService.listTrash(), supportTicketService.listTrash(), systemTrashService.list(),
    ]);
    setTrash(records); setTrashedStudents(studentsInTrash); setTrashedSupportTickets(supportTickets); setOtherTrashedItems(otherItems);
  }

  async function restoreTrashEntry(entry: TrashEntry) {
    try {
      if (entry.systemEntity) await systemTrashService.setState(entry.systemEntity.entityType, entry.systemEntity.entityId, true);
      else await restoreRecord(entry.item, entry.student, entry.support);
      await reloadTrashLists();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể khôi phục mục này."); }
  }

  async function permanentlyDeleteTrashEntry(entry: TrashEntry) {
    if (entry.systemEntity && !window.confirm(`Xóa vĩnh viễn “${entry.name}”? Thao tác không thể hoàn tác.`)) return;
    try {
      if (entry.systemEntity) await systemTrashService.deletePermanently(entry.systemEntity.entityType, entry.systemEntity.entityId);
      else await purgeRecord(entry.item, entry.student, entry.support);
      await reloadTrashLists();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể xóa mục trong thùng rác."); }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!permissions.update || !supabase) return;
    const form = new FormData(event.currentTarget); const name = String(form.get("name") ?? "").trim(); const email = String(form.get("email") ?? "").trim(); const phone = String(form.get("phone") ?? "").trim();
    const authUpdate = await supabase.auth.updateUser({ ...(email && email !== user?.email ? { email } : {}), data: { full_name: name } });
    if (authUpdate.error) { setError(authUpdate.error.message); return; }
    const { error: profileError } = await supabase.from("user_profiles").update({ display_name: name, phone }).eq("user_id", (await supabase.auth.getUser()).data.user?.id);
    if (profileError) setError(profileError.message); else { setNotice(email !== user?.email ? "Đã cập nhật hồ sơ. Hãy xác nhận email mới trong hộp thư." : "Đã cập nhật hồ sơ."); setUser((previous) => ({ ...previous, name, phone })); }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!permissions.update || !supabase) return;
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
    event.preventDefault(); if (!permissions.update) return; const form = new FormData(event.currentTarget); const next: SystemSettings = {};
    for (const [key, value] of form.entries()) next[key] = key === "trash_retention_days" || key === "briefing_scroll_duration" || key === "datetime_scroll_duration" || key === "greeting_scroll_duration" || key === "agenda_scroll_duration" ? Number(value) : String(value).trim();
    setError("");
    try { await settingsService.save(next); const { error: syncError } = await supabase!.rpc("set_current_semester", { p_name: String(next.current_semester ?? "") }); if (syncError) throw syncError; setSystemSettings(next); setNotice("Đã lưu cài đặt. Bản cấu hình trước đó được sao lưu tự động."); window.dispatchEvent(new CustomEvent("vtn-system-settings-updated", { detail: next })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể lưu cài đặt."); }
  }

  async function rollbackBackup(backup: SystemBackup) {
    if (!permissions.restore || !permissions.update) return;
    if (!window.confirm("Khôi phục snapshot này? Cấu hình hiện tại sẽ được sao lưu trước khi rollback.")) return;
    try { await settingsService.restoreBackup(backup.id); const restored = await settingsService.get(); setSystemSettings(restored); setNotice("Đã khôi phục snapshot cấu hình."); window.dispatchEvent(new CustomEvent("vtn-system-settings-updated", { detail: restored })); setSystemBackups(await settingsService.backups()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể khôi phục snapshot."); }
  }

  async function createSettingsSnapshot() {
    if (!permissions.create) return;
    try { await settingsService.createBackup("Snapshot thủ công trước khi thay đổi hệ thống"); setSystemBackups(await settingsService.backups()); setNotice("Đã tạo snapshot cấu hình hệ thống."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể tạo snapshot."); }
  }

  async function scanExpiredTrash(announce = true) {
    if (!permissions.delete) return;
    try {
      const now = Date.now();
      const [trashedFiles, trashedTickets, registeredItems] = await Promise.all([
        workspaceService.listTrash(), supportTicketService.listTrash(), systemTrashService.list(),
      ]);
      const expiredTickets = trashedTickets.filter((ticket) => ticket.purge_at && new Date(ticket.purge_at).getTime() <= now);
      const expiredTicketIds = new Set(expiredTickets.map((ticket) => ticket.id));
      let externalRemoved = 0;
      const externalFailures: string[] = [];
      const expiredSurveys = trashedFiles.filter((item) => item.module_key === "surveys" && item.purge_at && new Date(item.purge_at).getTime() <= now);
      for (const survey of expiredSurveys) {
        try { await systemTrashService.deleteSurveyPermanently(survey.id, true); externalRemoved += 1; }
        catch { externalFailures.push(String(survey.data.title ?? survey.id)); }
      }
      for (const ticket of expiredTickets) {
        try { await supportTicketService.deletePermanently(ticket.id, true); externalRemoved += 1; }
        catch { externalFailures.push(ticket.title || ticket.id); }
      }
      const expiredFiles = trashedFiles.filter((file) => file.module_key === "source-data-files" && file.purge_at && new Date(file.purge_at).getTime() <= now && !(file.data.supportTicketId && expiredTicketIds.has(String(file.data.supportTicketId))));
      for (const file of expiredFiles) {
        try { await sourceDataService.deleteOriginalFilePermanently(file as StoredSourceFile, true); externalRemoved += 1; }
        catch { externalFailures.push(String(file.data.fileName ?? file.id)); }
      }
      const expiredRegistered = registeredItems.filter((item) => item.purge_at && new Date(item.purge_at).getTime() <= now && ["academic_ai_sources", "user_profiles"].includes(item.entity_type));
      const registeredResults = await Promise.allSettled(expiredRegistered.map((item) => systemTrashService.deletePermanently(item.entity_type, item.entity_id, true)));
      externalRemoved += registeredResults.filter((result) => result.status === "fulfilled").length;
      externalFailures.push(...registeredResults.flatMap((result, index) => result.status === "rejected" ? [expiredRegistered[index].record_label] : []));
      const removed = await workspaceService.purgeExpired();
      await reloadTrashLists();
      if (announce) setNotice(`Đã quét thùng rác; hệ thống đã dọn ${(removed ?? 0) + externalRemoved} mục hết hạn.`);
      if (externalFailures.length) setError(`Chưa dọn được ${externalFailures.length} mục hết hạn (${externalFailures.slice(0, 3).join(", ")}). Kiểm tra quyền truy cập hoặc thử lại.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể quét thùng rác."); }
  }

  const trashEntries = [
    ...trashedStudents.map((student) => ({ key: `student:${student.id}`, id: student.id, item: student as Student | WorkspaceRecord | SupportTicket, student: true, support: false, systemEntity: null, name: `${student.fullName} (${student.studentCode})`, moduleName: "Sinh viên", purgeAt: student.purgeAt })),
    ...trash.map((item) => ({ key: `record:${item.id}`, id: item.id, item: item as Student | WorkspaceRecord | SupportTicket, student: false, support: false, systemEntity: null, name: String(item.data.title ?? item.data.listName ?? "Bản ghi"), moduleName: labelFor(item.module_key), purgeAt: item.purge_at })),
    ...trashedSupportTickets.map((item) => ({ key: `support:${item.id}`, id: item.id, item: item as Student | WorkspaceRecord | SupportTicket, student: false, support: true, systemEntity: null, name: item.title, moduleName: "Quản lý phiếu hỗ trợ", purgeAt: item.purge_at })),
    ...otherTrashedItems.map((item) => ({ key: `system:${item.entity_type}:${item.entity_id}`, id: item.entity_id, item: null as unknown as Student | WorkspaceRecord | SupportTicket, student: false, support: false, systemEntity: { entityType: item.entity_type, entityId: item.entity_id }, name: item.record_label, moduleName: labelFor(item.module_key), purgeAt: item.purge_at })),
  ];
  type TrashEntry = (typeof trashEntries)[number];
  const sortedTrashEntries = sortTableRows(trashEntries, trashSort, (entry, key, index) => key === "ordinal" ? index : key === "name" ? entry.name : key === "module" ? entry.moduleName : key === "purgeAt" ? entry.purgeAt : undefined);
  function sortTrashBy(key: string) { setTrashSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }); setTrashPage(1); }
  const trashPageCount = trashPageSize === "all" ? 1 : Math.max(1, Math.ceil(trashEntries.length / Number(trashPageSize)));
  const safeTrashPage = Math.min(trashPage, trashPageCount);
  const trashPageStart = trashPageSize === "all" ? 0 : (safeTrashPage - 1) * Number(trashPageSize);
  const visibleTrashEntries = trashPageSize === "all" ? sortedTrashEntries : sortedTrashEntries.slice(trashPageStart, trashPageStart + Number(trashPageSize));
  useEffect(() => { setTrashPage((page) => Math.min(page, trashPageCount)); }, [trashPageCount]);

  async function restoreSelectedTrash() {
    if (!permissions.restore) return;
    const selected = trashEntries.filter((entry) => selectedTrash.has(entry.key));
    if (!selected.length) return;
    setError("");
    const results = await Promise.allSettled(selected.map((entry) => entry.systemEntity ? systemTrashService.setState(entry.systemEntity.entityType, entry.systemEntity.entityId, true) : entry.support ? supportTicketService.restore(entry.id) : entry.student ? studentService.restore(entry.id) : workspaceService.restore(entry.id)));
    const failed = results.filter((result) => result.status === "rejected").length;
    await reloadTrashLists(); setSelectedTrash(new Set());
    setNotice(`Đã khôi phục ${selected.length - failed} mục${failed ? `; ${failed} mục gặp lỗi` : ""}. Nhật ký hệ thống đã được cập nhật.`);
    if (failed) setError("Một số mục không thể khôi phục. Hãy kiểm tra quyền truy cập và thử lại.");
  }

  async function permanentlyDeleteSelectedTrash() {
    if (!permissions.delete) return;
    const selected = trashEntries.filter((entry) => selectedTrash.has(entry.key));
    if (!selected.length) return;
    const results = await Promise.allSettled(selected.map((entry) => entry.systemEntity ? systemTrashService.deletePermanently(entry.systemEntity.entityType, entry.systemEntity.entityId) : entry.support ? supportTicketService.deletePermanently(entry.id) : entry.student ? studentService.deletePermanently(entry.id) : permanentlyDeleteWorkspaceRecord(entry.item as WorkspaceRecord)));
    const failed = results.filter((result) => result.status === "rejected").length;
    await reloadTrashLists(); setSelectedTrash(new Set()); setShowBatchDelete(false);
    setNotice(`Đã xóa vĩnh viễn ${selected.length - failed} mục${failed ? `; ${failed} mục gặp lỗi` : ""}.`);
    if (failed) setError("Một số mục không thể xóa. Hãy kiểm tra quyền truy cập và thử lại.");
  }

  function exportAuditReport() {
    if (!permissions.export) return;
    const logsToExport = selectedAuditLogIds.size ? visibleAuditLogs.filter((log) => selectedAuditLogIds.has(log.id)) : visibleAuditLogs;
    const rows = logsToExport.map((log) => ({
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
    const fileName = `nhat-ky-he-thong-${new Date().toISOString().slice(0, 10)}`;
    if (auditExportFormat === "xls") {
      XLSX.writeFile(workbook, `${fileName}.xls`, { bookType: "biff8" });
      return;
    }
    if (auditExportFormat === "csv") {
      const headers = Object.keys(rows[0] ?? { "Mốc thời gian": "", "Người thực hiện": "", "Địa chỉ IP": "", "Phân loại": "", "Hành động": "", "Chi tiết thay đổi": "", "Người liên quan": "", "Bản ghi": "" });
      const escapeCell = (value: unknown) => {
        const raw = String(value ?? "");
        const safe = /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw;
        return `"${safe.replaceAll('"', '""')}"`;
      };
      const csv = [headers, ...rows.map((row) => headers.map((header) => row[header as keyof typeof row]))].map((row) => row.map(escapeCell).join(",")).join("\r\n");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
      link.download = `${fileName}.csv`; link.click(); window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      return;
    }

    const printWindow = window.open("", "_blank", "width=1100,height=800");
    if (!printWindow) { setError("Trình duyệt đã chặn cửa sổ xuất PDF. Hãy cho phép cửa sổ bật lên rồi thử lại."); return; }
    const escapeHtml = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
    const headers = ["Mốc thời gian", "Người thực hiện", "Địa chỉ IP", "Phân loại", "Hành động", "Chi tiết thay đổi", "Người liên quan", "Bản ghi"];
    const tableHead = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
    const tableRows = rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header as keyof typeof row])}</td>`).join("")}</tr>`).join("");
    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${fileName}.pdf</title><style>@page{size:landscape;margin:12mm}body{font-family:Arial,sans-serif;color:#172554;font-size:10px}h1{font-size:18px;margin:0 0 6px}p{color:#64748b;margin:0 0 14px}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #dbe3ef;padding:6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eff4fb;color:#334155}tr{break-inside:avoid}</style></head><body><h1>Nhật ký hệ thống</h1><p>${rows.length.toLocaleString("vi-VN")} dòng · Xuất ngày ${new Date().toLocaleString("vi-VN")}</p><table><thead><tr>${tableHead}</tr></thead><tbody>${tableRows}</tbody></table></body></html>`);
    printWindow.document.close();
    window.setTimeout(() => { printWindow.focus(); printWindow.print(); }, 350);
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
    if (!window.confirm("Chuyển dòng nhật ký này vào thùng rác?")) return;
    const { error: deleteError } = await supabase.rpc("set_system_trash_state", { p_entity_type: "system_audit_logs", p_entity_id: String(log.id), p_restore: false });
    if (deleteError) { setError(deleteError.message); return; }
    setAuditLogs((previous) => previous.filter((item) => item.id !== log.id));
    setSelectedAuditLogIds((previous) => { const next = new Set(previous); next.delete(log.id); return next; });
    setSelectedAuditLog(undefined);
    if (permissions.restore) setAuditTrashEntries((await systemTrashService.list()).filter((entry) => entry.entity_type === "system_audit_logs"));
    setNotice("Đã chuyển dòng nhật ký vào thùng rác.");
  }
  async function clearAuditLogs() {
    if (auditRole !== "super_admin" || !permissions.delete || !supabase) return;
    if (!window.confirm("Chuyển toàn bộ nhật ký hệ thống vào thùng rác?")) return;
    const { data, error: clearError } = await supabase.rpc("super_admin_clear_audit_logs");
    if (clearError) { setError(clearError.message); return; }
    if (permissions.restore) setAuditTrashEntries((await systemTrashService.list()).filter((entry) => entry.entity_type === "system_audit_logs"));
    setAuditLogs([]); setAuditUser(""); setSelectedAuditLog(undefined); setSelectedAuditLogIds(new Set()); setAuditPage(1);
    setNotice(`Đã chuyển ${Number(data ?? 0)} dòng nhật ký vào thùng rác.`);
  }

  async function restoreAuditLog(entry: SystemTrashEntry) {
    if (!permissions.restore || entry.entity_type !== "system_audit_logs") return;
    try {
      await systemTrashService.setState(entry.entity_type, entry.entity_id, true);
      const [logs, trashEntries] = await Promise.all([auditLogService.list(), systemTrashService.list()]);
      setAuditLogs(logs);
      setAuditTrashEntries(trashEntries.filter((item) => item.entity_type === "system_audit_logs"));
      setNotice(`Đã khôi phục nhật ký “${entry.record_label || `log_${entry.entity_id}`}”.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể khôi phục nhật ký.");
    }
  }

  const auditUserOptions = [...new Set(auditLogs.map((log) => log.actor_id).filter((id): id is string => Boolean(id)))].map((id) => ({ id, label: auditUserLabel(id) }));
  const auditCategories = [...new Set(auditLogs.map(auditCategory))];
  const visibleAuditLogs = auditLogs.filter((log) => (!auditAction || auditCategory(log) === auditAction) && (!auditUser || log.actor_id === auditUser) && (!auditSearch || `${auditUserLabel(log.actor_id)} ${log.actor_id} ${log.subject_user_id} ${log.module_key} ${log.action} ${log.record_label} ${JSON.stringify(log.details)} ${log.ip_address}`.toLocaleLowerCase().includes(auditSearch.toLocaleLowerCase())));
  const sortedAuditLogs = sortTableRows(visibleAuditLogs, auditSort, (log, key, index) => key === "ordinal" ? index : key === "time" ? log.event_at : key === "actor" ? auditUserLabel(log.actor_id) : key === "ip" ? log.ip_address : key === "category" ? auditCategory(log) : key === "action" ? auditActionLabel(log.action) : key === "details" ? JSON.stringify(log.details) || log.record_label : undefined);
  function sortAuditBy(key: string) { setAuditSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }); setAuditPage(1); }
  const sortedSystemBackups = sortTableRows(systemBackups, backupSort, (backup, key, index) => key === "ordinal" ? index : key === "created_at" ? backup.created_at : key === "reason" ? backup.reason : undefined);
  function sortBackupsBy(key: string) { setBackupSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }); setBackupPage(1); }
  const backupPageCount = backupPageSize === "all" ? 1 : Math.max(1, Math.ceil(systemBackups.length / Number(backupPageSize)));
  const safeBackupPage = Math.min(backupPage, backupPageCount);
  const backupPageStart = backupPageSize === "all" ? 0 : (safeBackupPage - 1) * Number(backupPageSize);
  const visibleSystemBackups = backupPageSize === "all" ? sortedSystemBackups : sortedSystemBackups.slice(backupPageStart, backupPageStart + Number(backupPageSize));
  const allBackupsSelected = systemBackups.length > 0 && selectedBackupIds.size === systemBackups.length;
  const auditPageCount = auditPageSize === "all" ? 1 : Math.max(1, Math.ceil(visibleAuditLogs.length / Number(auditPageSize)));
  const safeAuditPage = Math.min(auditPage, auditPageCount);
  const auditPageStart = auditPageSize === "all" ? 0 : (safeAuditPage - 1) * Number(auditPageSize);
  const visibleAuditPageLogs = auditPageSize === "all" ? sortedAuditLogs : sortedAuditLogs.slice(auditPageStart, auditPageStart + Number(auditPageSize));
  const selectedVisibleAuditCount = visibleAuditLogs.reduce((count, log) => count + Number(selectedAuditLogIds.has(log.id)), 0);
  const auditAllVisibleSelected = visibleAuditLogs.length > 0 && selectedVisibleAuditCount === visibleAuditLogs.length;
  function toggleAllVisibleAuditLogs(checked: boolean) {
    setSelectedAuditLogIds((previous) => {
      const next = new Set(previous);
      visibleAuditLogs.forEach((log) => checked ? next.add(log.id) : next.delete(log.id));
      return next;
    });
  }
  const rawSemesterChoices = [...semesterNames, ...students.map((student) => student.semesterName).filter(Boolean), ...dashboardRecords.filter((record) => record.module_key === "calendar" || record.module_key === "timetables").map((record) => formatSemesterLabel(record.data.semesterName ?? record.data.semester ?? record.data.round, record.data.academicYear)).filter(Boolean)];
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
  const currentOperatingSemester = savedCurrentTerm ? formatSemesterLabel(savedCurrentTerm.title, systemSettings.academic_year)
    : catalogCurrentTerm ? formatSemesterLabel(semesterChoices.find((name) => semesterIdentity(name) === semesterIdentity(catalogCurrentTerm.title)) ?? catalogCurrentTerm.title, catalogCurrentTerm.academicYear) : "";
  const dashboardStudents = students.filter((student) => semesterFilter === "all" || normalizeSemesterName(student.semesterName) === semesterFilter);
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const datedStudents = dashboardStudents.flatMap((student) => {
    const birthDate = parseBirthDate(student.dateOfBirth);
    if (!birthDate || birthDate.getTime() > today.getTime()) return [];
    return [{ student, birthDate, age: studentAge(birthDate, today) }];
  });
  const datedStudentRecords = new Set(datedStudents.map((item) => item.student));
  const studentsWithUnknownAge = dashboardStudents.filter((student) => !datedStudentRecords.has(student));
  const courseIndexes = useMemo(() => createStudentCourseIndexes(students, dashboardRecords), [students, dashboardRecords]);
  const upcomingBirthdays = datedStudents.map(({ student, birthDate, age }) => ({ student, birthDate, age, daysUntil: upcomingBirthdayDays(birthDate, today) }))
    .filter((item) => item.daysUntil <= 7)
    .map((item) => ({ ...item, courses: studentCourses(item.student, courseIndexes).filter((course) => semesterFilter === "all" || normalizeSemesterName(course.semester) === semesterFilter) }))
    .sort((a, b) => a.daysUntil - b.daysUntil || a.birthDate.getTime() - b.birthDate.getTime() || a.student.fullName.localeCompare(b.student.fullName, "vi"));
  const todayBirthdayCount = upcomingBirthdays.filter((item) => item.daysUntil === 0).length;
  const todayBirthdayStudents = upcomingBirthdays.filter((item) => item.daysUntil === 0);
  const ageValues = datedStudents.map((item) => item.age);
  const ageCounts = ageValues.reduce<Map<number, number>>((counts, age) => counts.set(age, (counts.get(age) ?? 0) + 1), new Map());
  const sortedAgeCounts = [...ageCounts].sort(([left], [right]) => left - right);
  const ageStats = sortedAgeCounts.map(([age, count], index) => ({ name: `${age} tuổi`, value: count, color: ageChartColors[index % ageChartColors.length] }));
  const ageRange = sortedAgeCounts.length ? { min: sortedAgeCounts[0][0], max: sortedAgeCounts[sortedAgeCounts.length - 1][0] } : null;
  if (studentsWithUnknownAge.length) ageStats.push({ name: "Chưa xác định tuổi", value: studentsWithUnknownAge.length, color: "#94a3b8" });
  const selectedAge = Number(selectedAgeMetric.replace(/\s*tuổi$/, ""));
  const selectedAgeStudents = selectedAgeMetric === "Chưa xác định tuổi"
    ? studentsWithUnknownAge.map((student) => ({ student, age: null }))
    : selectedAgeMetric ? datedStudents.filter((item) => item.age === selectedAge) : [];
  const filteredWorkspaceRecords = dashboardRecords.filter((record) => semesterFilter === "all" || normalizeSemesterName(String(record.data.semesterName ?? record.data.semester ?? record.data.round ?? "")) === semesterFilter);
  const filteredGradeRecords = useMemo(() => dashboardGradeRecords.filter((record) => semesterFilter === "all" || normalizeSemesterName(String(record.data.semesterName ?? record.data.semester ?? record.data.round ?? "")) === semesterFilter), [dashboardGradeRecords, semesterFilter]);
  const studyScoreStats = useMemo(() => summarizeStudyScores(filteredGradeRecords, studyScoreDimension), [filteredGradeRecords, studyScoreDimension]);
  const studyOutcomeStats = useMemo(() => summarizeStudyOutcomes(filteredGradeRecords, studyOutcomeDimension), [filteredGradeRecords, studyOutcomeDimension]);
  function applySemesterFilter(value: string) {
    const normalizedValue = value === "all" ? value : normalizeSemesterName(value);
    setSemesterFilter(normalizedValue);
    localStorage.setItem("vtn-active-semester", normalizedValue);
    window.dispatchEvent(new CustomEvent("vtn-semester-filter-changed", { detail: normalizedValue }));
  }
  const filteredCounts = filteredWorkspaceRecords.reduce<Record<string, number>>((result, row) => { result[row.module_key] = (result[row.module_key] ?? 0) + 1; return result; }, {});
  const timetableSections = new Map<string, { semester: string; courseCode: string }>();
  for (const record of filteredWorkspaceRecords.filter((item) => item.module_key === "timetables" || item.module_key === "calendar")) {
    const term = formatSemesterLabel(record.data.semesterName ?? record.data.semester ?? record.data.round, record.data.academicYear);
    const courseCode = String(record.data.courseCode ?? record.data.subjectCode ?? record.data.courseClassCode ?? "").trim();
    const classCode = String(record.data.classCode ?? record.data.className ?? record.data.courseClassCode ?? courseCode).trim();
    if (!term || !courseCode || !classCode) continue;
    const key = `${semesterIdentity(term)}|${normalizeLabel(courseCode)}|${normalizeLabel(classCode)}`;
    if (!timetableSections.has(key)) timetableSections.set(key, { semester: term, courseCode });
  }
  const semesterClassCount = timetableSections.size;
  const scheduleTerms = [...new Set([...timetableSections.values()].map((section) => section.semester))].sort((a, b) => {
    const parse = (value: string) => { const match = value.match(/(?:HK|Học kỳ)\s*(\d+)\s*(?:NH\s*)?(\d{4})-(\d{4})/i); return match ? [Number(match[2]), Number(match[1])] : null; };
    const parsedA = parse(a); const parsedB = parse(b);
    if (parsedA && parsedB) return parsedA[0] - parsedB[0] || parsedA[1] - parsedB[1] || a.localeCompare(b, "vi", { numeric: true });
    if (parsedA) return -1;
    if (parsedB) return 1;
    return a.localeCompare(b, "vi", { numeric: true });
  });
  const semesterCourseStats = scheduleTerms.map((term) => ({ semester: term, courses: new Set([...timetableSections.values()].filter((section) => section.semester === term).map((section) => section.courseCode)).size }));
  const categoryColor = (index: number, total: number) => `hsl(${Math.round((index * 360) / Math.max(total, 1))} 68% 46%)`;
  const unknownSemesterLabel = "Chưa xác định học kỳ";
  const semesterCountKey = (value: string) => value === unknownSemesterLabel ? "__unknown_semester__" : semesterIdentity(value);
  const studentCountsBySemester = new Map<string, Map<string, string>>();
  const studentTermLabels = new Map<string, string>();
  for (const student of students) {
    const rawTerm = String(student.semesterName ?? "").trim();
    const term = rawTerm ? normalizeSemesterName(rawTerm) : unknownSemesterLabel;
    const key = semesterCountKey(term);
    const profileId = String(student.id || student.studentCode || "").trim();
    if (!profileId) continue;
    const profiles = studentCountsBySemester.get(key) ?? new Map<string, string>();
    profiles.set(profileId, studentGender(student));
    studentCountsBySemester.set(key, profiles);
    if (!studentTermLabels.has(key)) studentTermLabels.set(key, term);
  }
  const studentCountTermsByKey = new Map<string, string>();
  for (const term of scheduleTerms) studentCountTermsByKey.set(semesterCountKey(term), term);
  for (const [key, term] of studentTermLabels) if (!studentCountTermsByKey.has(key)) studentCountTermsByKey.set(key, term);
  const studentCountTerms = [...studentCountTermsByKey.entries()]
    .filter(([key]) => semesterFilter === "all" || key === semesterCountKey(semesterFilter))
    .map(([, term]) => term)
    .sort((a, b) => a.localeCompare(b, "vi", { numeric: true }));
  const semesterStudentStats = studentCountTerms.map((term) => {
    const genders = [...(studentCountsBySemester.get(semesterCountKey(term))?.values() ?? [])];
    return { semester: term, male: genders.filter((gender) => gender === "male").length, female: genders.filter((gender) => gender === "female").length, other: genders.filter((gender) => gender !== "male" && gender !== "female").length };
  });
  const semesterStudentPieStats = semesterStudentStats.map((item, index) => ({ name: item.semester, value: item.male + item.female + item.other, color: categoryColor(index, semesterStudentStats.length) }));
  const semesterStudentTotals = semesterStudentStats.reduce((totals, item) => ({ male: totals.male + item.male, female: totals.female + item.female, other: totals.other + item.other }), { male: 0, female: 0, other: 0 });
  const selectedSemesterStudentStats = semesterStudentStats.find((item) => item.semester === selectedStudentChartTerm);
  const displayedSemesterStudentTotals = selectedSemesterStudentStats ?? semesterStudentTotals;
  const majorCounts = dashboardStudents.reduce<Record<string, number>>((counts, student) => { const major = studentMajor(student); if (major) counts[major] = (counts[major] ?? 0) + 1; return counts; }, {});
  const knownMajorNames = new Set(studyMajors.map((major) => major.name));
  const majorStats = [...studyMajors.map((major) => ({ major: major.name, students: majorCounts[major.name] ?? 0 })), ...Object.entries(majorCounts).filter(([major]) => !knownMajorNames.has(major)).map(([major, students]) => ({ major, students }))].sort((left, right) => right.students - left.students || left.major.localeCompare(right.major, "vi"));
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
      <div className="overview-filter"><QuickFilterHeading onClear={() => applySemesterFilter("all")} clearDisabled={semesterFilter === "all"} /><div className="overview-filter-controls"><label>Học kỳ<SearchableFilter value={semesterFilter} allValue="all" allLabel="Tất cả học kỳ" options={semesterGroups.flatMap((group) => group.semesters.map((name) => ({ value: name, label: name + (currentOperatingSemester && semesterIdentity(name) === semesterIdentity(currentOperatingSemester) ? " · Hiện hành" : "") })))} onChange={applySemesterFilter} /></label><button type="button" className={`overview-current-semester-button${currentOperatingSemester && semesterIdentity(semesterFilter) === semesterIdentity(currentOperatingSemester) ? " is-active" : ""}`} disabled={!currentOperatingSemester} onClick={() => applySemesterFilter(currentOperatingSemester)}><span>Học kỳ hiện tại</span><strong>{currentOperatingSemester || "Chưa xác định theo tiến độ đào tạo"}</strong></button></div>{canTestPush && permissions.create && <button type="button" className="overview-push-test" onClick={() => window.dispatchEvent(new Event("vtn-test-push-notification"))}><BellRing size={15} /> Thử nhận thông báo đẩy</button>}</div>
      {isStudentSurveyUser && <article className="overview-survey-rating"><header><h2>{"Kh\u1ea3o s\u00e1t h\u1ecdc ph\u1ea7n"}</h2></header><div className="overview-survey-score overview-survey-prompt"><strong>{"Chia s\u1ebb tr\u1ea3i nghi\u1ec7m h\u1ecdc t\u1eadp"}</strong></div><footer><span>{"\u00dd ki\u1ebfn c\u1ee7a b\u1ea1n gi\u00fap c\u1ea3i thi\u1ec7n h\u1ecdc ph\u1ea7n"}</span><Link to="/survey-participation">{"Tham gia kh\u1ea3o s\u00e1t \u2192"}</Link></footer></article>}
      <div className="workspace-stat-grid"><Link className="workspace-stat-card-link" to="/timetables"><article><span>{"T\u1ed5ng s\u1ed1 l\u1edbp h\u1ecdc k\u1ef3"}</span><strong>{dashboardRecordsLoading ? "?" : semesterClassCount}</strong><small>{semesterFilter === "all" ? "T\u1ea5t c\u1ea3 h\u1ecdc k\u1ef3" : `H\u1ecdc k\u1ef3 ${semesterFilter}`}</small></article></Link><Link className="workspace-stat-card-link" to="/student-records"><article><span>{"Sinh vi\u00ean"}</span><strong>{dashboardStudentsLoading ? "?" : dashboardStudents.length}</strong><small>{semesterFilter === "all" ? "T\u1ea5t c\u1ea3 h\u1ecdc k\u1ef3" : "Theo h\u1ecdc k\u1ef3 \u0111\u00e3 ch\u1ecdn"}</small></article></Link>{canViewSurveyResultsForRole ? <Link className="workspace-stat-card-link" to="/surveys"><article><span>{"\u0110\u00e1nh gi\u00e1 kh\u1ea3o s\u00e1t"}</span><strong>{surveyRatingSummary.averageRating.toFixed(1)}/5.0</strong><small>{surveyRatingSummary.responseCount.toLocaleString("vi-VN")} {"l\u01b0\u1ee3t kh\u1ea3o s\u00e1t"}</small></article></Link> : <Link className="workspace-stat-card-link" to="/tasks"><article><span>{"B\u1ea3n ghi c\u00f4ng vi\u1ec7c"}</span><strong>{dashboardRecordsLoading ? "?" : filteredWorkspaceRecords.length}</strong><small>{"Trong c\u00e1c module kh\u00e1c"}</small></article></Link>}<Link className="workspace-stat-card-link" to="/groups"><article><span>{"Nh\u00f3m h\u1ecdc t\u1eadp"}</span><strong>{dashboardRecordsLoading ? "?" : filteredCounts.groups ?? 0}</strong><small>{"\u0110\u01b0\u1ee3c qu\u1ea3n l\u00fd"}</small></article></Link><Link className="workspace-stat-card-link" to="/assignments"><article><span>{"B\u00e0i t\u1eadp"}</span><strong>{dashboardRecordsLoading ? "?" : filteredCounts.assignments ?? 0}</strong><small>{"\u0110ang theo d\u00f5i"}</small></article></Link></div>
      <div className="overview-dashboard-charts">
        <div className="workspace-panel overview-chart-panel"><div className="overview-chart-heading"><div><h2>Trạng thái học tập</h2><p>Tỷ lệ theo hồ sơ sinh viên đang lọc</p></div><OverviewChartTypeSelect chartType={studyStatusChartType} ariaLabel="Kiểu biểu đồ trạng thái học tập" onChange={(value) => { setStudyStatusChartType(value); localStorage.setItem("vtn-dashboard-study-status-chart", value); }} /></div>{dashboardStudents.length ? <StudyStatusChart data={statusStats} hidden={hiddenStudyStatuses} total={dashboardStudents.length} onToggle={toggleStudyStatus} chartType={studyStatusChartType} /> : <div className="overview-chart-empty">{dashboardStudentsLoading ? "Đang tải thông tin sinh viên..." : "Chưa có trạng thái học tập để thống kê."}</div>}</div>
        <div className="workspace-panel overview-chart-panel"><div className="overview-chart-heading"><div><h2>Sinh nhật trong 7 ngày tới</h2><p>{semesterFilter === "all" ? "Theo hồ sơ sinh viên hiện có" : `Theo học kỳ ${semesterFilter}`}</p></div><button type="button" className="overview-birthday-today-count" aria-haspopup="dialog" aria-label="Xem danh sách sinh nhật hôm nay" disabled={!todayBirthdayCount} onClick={() => setTodayBirthdayDialogOpen(true)}><b>{todayBirthdayCount}</b> sinh nhật hôm nay</button></div>{upcomingBirthdays.length ? <ul className="overview-birthday-list">{upcomingBirthdays.map(({ student, age, daysUntil, courses }) => <li key={student.id}><div><button type="button" className="overview-birthday-student" aria-expanded={selectedBirthdayStudentId === student.id} onClick={() => setSelectedBirthdayStudentId((current) => current === student.id ? "" : student.id)}>{student.fullName}</button>{selectedBirthdayStudentId === student.id && <div className="overview-birthday-courses"><b>Học phần đã ghi nhận</b>{courses.length ? <ul>{courses.map((course, index) => <li key={`${course.courseCode}-${course.courseName}-${course.semester}-${index}`}><span>{course.courseName || "Học phần chưa rõ tên"}</span><small>{course.courseCode ? `Mã LHP: ${course.courseCode}` : ""}{course.semester ? ` · ${course.semester}` : ""}</small></li>)}</ul> : <p>Chưa có thông tin học phần trong hồ sơ sinh viên hoặc sổ điểm.</p>}</div>}<small>{student.studentCode} · {student.dateOfBirth ? formatDate(student.dateOfBirth) : "Chưa có ngày sinh"} · {age} tuổi</small></div><span className={daysUntil === 0 ? "is-today" : ""}>{daysUntil === 0 ? "Hôm nay" : `Còn ${daysUntil} ngày`}</span></li>)}</ul> : <div className="overview-chart-empty">{dashboardStudentsLoading ? "Đang tải thông tin sinh viên..." : "Không có sinh nhật nào trong 7 ngày tới."}</div>}</div>
        <div className="workspace-panel overview-chart-panel overview-result-panel">
          <div className="overview-chart-heading"><div><h2>Thống kê điểm theo học kỳ / năm học / học phần / lớp</h2><p>Điểm trung bình hệ 10 từ {studyScoreStats.reduce((total, item) => total + item.count, 0).toLocaleString("vi-VN")} bản ghi có điểm hợp lệ.</p></div></div>
          <div className="overview-result-controls">
            <label>Phân nhóm<select aria-label="Phân nhóm biểu đồ điểm" value={studyScoreDimension} onChange={(event) => { const value = event.target.value as StudyResultDimension; setStudyScoreDimension(value); localStorage.setItem("vtn-dashboard-study-score-dimension", value); }}>{studyResultDimensions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label>Kiểu biểu đồ<select aria-label="Kiểu biểu đồ điểm" value={studyScoreChartType} onChange={(event) => { const value = event.target.value as StudyResultChartType; setStudyScoreChartType(value); localStorage.setItem("vtn-dashboard-study-score-chart", value); }}>{studyResultChartTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          </div>
          {studyScoreStats.length ? <StudyAverageChart data={studyScoreStats} chartType={studyScoreChartType} /> : <div className="overview-chart-empty">{dashboardGradesLoading ? "Đang tải dữ liệu điểm..." : "Chưa có bản ghi điểm hợp lệ trong phạm vi học kỳ đang chọn."}</div>}
        </div>
        <div className="workspace-panel overview-chart-panel overview-result-panel">
          <div className="overview-chart-heading"><div><h2>Tỉ lệ kết quả học tập theo học kỳ / năm học / học phần / lớp</h2><p>{studyOutcomeStats.gradedRecords.toLocaleString("vi-VN")} kết quả được phân nhóm theo xếp loại.</p></div></div>
          <div className="overview-result-controls">
            <label>Phân nhóm<select aria-label="Phân nhóm biểu đồ kết quả" value={studyOutcomeDimension} onChange={(event) => { const value = event.target.value as StudyResultDimension; setStudyOutcomeDimension(value); localStorage.setItem("vtn-dashboard-study-outcome-dimension", value); }}>{studyResultDimensions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label>Kiểu biểu đồ<select aria-label="Kiểu biểu đồ kết quả" value={studyOutcomeChartType} onChange={(event) => { const value = event.target.value as StudyResultChartType; setStudyOutcomeChartType(value); localStorage.setItem("vtn-dashboard-study-outcome-chart", value); }}>{studyResultChartTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          </div>
          {studyOutcomeStats.gradedRecords ? <StudyOutcomeChart rows={studyOutcomeStats.rows} slices={studyOutcomeStats.slices} chartType={studyOutcomeChartType} /> : <div className="overview-chart-empty">{dashboardGradesLoading ? "Đang tải dữ liệu điểm..." : "Chưa có kết quả học tập để thống kê trong phạm vi học kỳ đang chọn."}</div>}
        </div>
        <div className="workspace-panel overview-chart-panel"><div className="overview-chart-heading"><div><h2>Độ tuổi sinh viên</h2><p>Bấm vào lát cắt hoặc độ tuổi để xem hồ sơ sinh viên.</p></div><OverviewChartTypeSelect chartType={ageChartType} ariaLabel="Kiểu biểu đồ độ tuổi" onChange={(value) => { setAgeChartType(value); localStorage.setItem("vtn-dashboard-age-chart", value); }} /></div>{ageStats.length ? <><OverviewInteractiveChart data={ageStats} unit="sinh viên" caption="SINH VIÊN" selected={selectedAgeMetric} onSelect={setSelectedAgeMetric} chartType={ageChartType} /><div className="overview-age-range" aria-label="Độ tuổi sinh viên nhỏ nhất và lớn nhất"><div><span>Tuổi nhỏ nhất</span><strong>{ageRange ? `${ageRange.min} tuổi` : "—"}</strong></div><div><span>Tuổi lớn nhất</span><strong>{ageRange ? `${ageRange.max} tuổi` : "—"}</strong></div></div>{selectedAgeMetric && <div className="overview-age-students"><strong>{selectedAgeStudents.length.toLocaleString("vi-VN")} sinh viên · {selectedAgeMetric}</strong>{selectedAgeStudents.length ? <ul>{selectedAgeStudents.map(({ student, age }) => <li key={student.id}><span><b>{student.fullName}</b><small>{student.studentCode} · {student.dateOfBirth ? formatDate(student.dateOfBirth) : "Chưa có ngày sinh"} · {age == null ? "Chưa xác định tuổi" : `${age} tuổi`}</small></span><span>{student.className || "Chưa có lớp"}</span></li>)}</ul> : <p>Không có hồ sơ theo độ tuổi đã chọn.</p>}</div>}</> : <div className="overview-chart-empty">{dashboardStudentsLoading ? "Đang tải thông tin sinh viên..." : "Chưa có hồ sơ sinh viên để thống kê."}</div>}</div>
        <div className="workspace-panel overview-chart-panel"><div className="overview-chart-heading"><div><h2>Tổng số lượng sinh viên theo kỳ</h2><p>Bấm vào lát cắt hoặc tên học kỳ để xem tổng nam/nữ.</p></div><OverviewChartTypeSelect chartType={semesterStudentChartType} ariaLabel="Kiểu biểu đồ sinh viên theo học kỳ" onChange={(value) => { setSemesterStudentChartType(value); localStorage.setItem("vtn-dashboard-semester-students-chart", value); }} /></div>{semesterStudentStats.length && semesterStudentPieStats.some((item) => item.value > 0) ? <><OverviewInteractiveChart data={semesterStudentPieStats} unit="sinh viên" caption="SINH VIÊN" selected={selectedStudentChartTerm} onSelect={setSelectedStudentChartTerm} chartType={semesterStudentChartType} /><div className="overview-gender-total" aria-label={"Tổng cộng " + (selectedSemesterStudentStats ? selectedSemesterStudentStats.semester : "các học kỳ đang lọc") + ": nam " + displayedSemesterStudentTotals.male + ", nữ " + displayedSemesterStudentTotals.female + ", khác/chưa rõ " + displayedSemesterStudentTotals.other}><strong>{selectedSemesterStudentStats ? "Tổng cộng · " + selectedSemesterStudentStats.semester : "Tổng cộng các học kỳ đang lọc"}</strong><span><i className="male" />Nam <b>{displayedSemesterStudentTotals.male.toLocaleString("vi-VN")}</b></span><span><i className="female" />Nữ <b>{displayedSemesterStudentTotals.female.toLocaleString("vi-VN")}</b></span><span><i className="other" />Khác / chưa rõ <b>{displayedSemesterStudentTotals.other.toLocaleString("vi-VN")}</b></span></div></> : <div className="overview-chart-empty">{dashboardRecordsLoading ? "Đang tải thông tin học kỳ..." : "Chưa có hồ sơ sinh viên theo học kỳ để thống kê."}</div>}</div>
        <div className="workspace-panel overview-chart-panel"><div className="overview-chart-heading"><div><h2>Số môn học / học phần theo học kỳ</h2><p>Đếm mã học phần khác nhau trong dữ liệu lịch đã nhập.</p></div><OverviewChartTypeSelect chartType={semesterCourseChartType} ariaLabel="Kiểu biểu đồ học phần theo học kỳ" onChange={(value) => { setSemesterCourseChartType(value); localStorage.setItem("vtn-dashboard-semester-courses-chart", value); }} /></div>{semesterCourseStats.length ? <OverviewCategoryChart data={semesterCourseStats.map((item, index) => ({ name: item.semester, value: item.courses, color: categoryColor(index, semesterCourseStats.length) }))} unit="môn học" caption="HỌC PHẦN" chartType={semesterCourseChartType} /> : <div className="overview-chart-empty">{dashboardRecordsLoading ? "Đang tải dữ liệu thời khóa biểu..." : "Nhập thời khóa biểu để thống kê số môn theo học kỳ."}</div>}</div>
        <div className="workspace-panel overview-chart-panel"><div className="overview-chart-heading"><div><h2>Số lượng sinh viên theo chuyên ngành đào tạo</h2><p>{dashboardStudentsLoading ? "Đang tải số ngành..." : `Tổng ${majorStats.length} ngành đào tạo`}</p></div><OverviewChartTypeSelect chartType={majorChartType} ariaLabel="Kiểu biểu đồ sinh viên theo chuyên ngành" onChange={(value) => { setMajorChartType(value); localStorage.setItem("vtn-dashboard-major-chart", value); }} /></div>{dashboardStudents.length ? <OverviewCategoryChart data={majorStats.map((item, index) => ({ name: item.major, value: item.students, color: categoryColor(index, majorStats.length) }))} unit="sinh viên" caption="SINH VIÊN" chartType={majorChartType} /> : <div className="overview-chart-empty">{dashboardStudentsLoading ? "Đang tải thông tin sinh viên..." : "Chưa có hồ sơ sinh viên trong học kỳ đã chọn."}</div>}</div>
      </div>
      {todayBirthdayDialogOpen && <div className="overview-birthday-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTodayBirthdayDialogOpen(false); }}><section className="overview-birthday-dialog" role="dialog" aria-modal="true" aria-labelledby="overview-birthday-dialog-title" aria-describedby="overview-birthday-dialog-description"><header><div><span>CHI TIẾT DANH SÁCH</span><h2 id="overview-birthday-dialog-title">Sinh nhật hôm nay</h2><p id="overview-birthday-dialog-description">{todayBirthdayCount} sinh viên · {new Date().toLocaleDateString("vi-VN")}{semesterFilter === "all" ? " · Tất cả học kỳ" : ` · ${formatSemesterLabel(semesterFilter)}`}</p></div><button type="button" aria-label="Đóng danh sách sinh nhật" onClick={() => setTodayBirthdayDialogOpen(false)}><X size={19} /></button></header><ul className="overview-birthday-dialog-list">{todayBirthdayStudents.map(({ student, age }) => <li key={student.id}><div className="overview-birthday-dialog-student"><strong>{student.fullName}</strong><span>{student.className || "Chưa cập nhật lớp"}</span></div><dl><div><dt>Mã sinh viên</dt><dd>{student.studentCode || "Chưa cập nhật"}</dd></div><div><dt>Ngày sinh</dt><dd>{student.dateOfBirth ? formatDate(student.dateOfBirth) : "Chưa cập nhật"}</dd></div><div><dt>Tuổi</dt><dd>{age}</dd></div></dl></li>)}</ul></section></div>}
    </>}
    {module.key === "my-profile" && <><form className="workspace-form workspace-profile" onSubmit={saveProfile}><fieldset className="system-permission-fieldset" disabled={!permissions.update}><div className="workspace-profile-avatar"><UserRound size={24} /></div><h2>Thông tin cá nhân</h2><label>Email đăng nhập<input name="email" type="email" defaultValue={user?.email ?? ""} required /></label><label>Họ và tên<input name="name" defaultValue={user?.name ?? ""} required /></label><label>Số điện thoại<input name="phone" type="tel" defaultValue={user?.phone ?? ""} /></label><p>Thay đổi email có thể cần xác nhận qua email mới.</p><button className="workspace-primary">Lưu hồ sơ</button></fieldset></form><form className="workspace-form workspace-profile workspace-password-form" onSubmit={(event) => void changePassword(event)}><fieldset className="system-permission-fieldset" disabled={!permissions.update}><h2>Đổi mật khẩu</h2><p>Chọn mật khẩu mới có ít nhất 8 ký tự.</p><label>Mật khẩu mới<input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label><label>Nhập lại mật khẩu mới<input type="password" autoComplete="new-password" minLength={8} value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} required /></label><button className="workspace-primary" disabled={passwordBusy}>{passwordBusy ? "Đang cập nhật…" : "Cập nhật mật khẩu"}</button></fieldset></form></>}
    {module.key === "accounts" && <div className="workspace-panel"><h2>Tài khoản giảng viên</h2><p>Tài khoản được quản lý trong Supabase Auth để mật khẩu không nằm trong dữ liệu ứng dụng.</p><ol><li>Mở Supabase Dashboard → Authentication → Users.</li><li>Chọn <b>Add user → Send invitation</b>, nhập email giảng viên và gửi lời mời.</li><li>Người nhận hoàn tất lời mời rồi đăng nhập vào ứng dụng.</li></ol><p>Chỉ quản trị viên dự án Supabase mới có thể mời hoặc vô hiệu hóa người dùng.</p></div>}
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
    {module.key === "backup" && <><section className="workspace-panel workspace-backup-panel"><div className="workspace-backup-heading"><div className="workspace-backup-icon"><ArchiveRestore size={24} /></div><div><h2>Sao lưu dữ liệu</h2><p>Tải xuống tệp JSON gồm bản ghi các phân hệ, hồ sơ sinh viên và cấu hình hệ thống. Khi nhập, bản ghi mới sẽ được thêm vào; dữ liệu trùng mã được bỏ qua.</p></div></div><div className="workspace-backup-actions">{permissions.export && <button className="workspace-primary" type="button" onClick={() => void exportBackup()}><Download size={17} /> Tải bản sao lưu JSON</button>}{permissions.create && permissions.update && <label className="workspace-import-button"><UploadCloud size={17} /> Nhập bản sao lưu<input type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importBackup(file); event.currentTarget.value = ""; }} /></label>}{canManageBackups && permissions.create && <button className="workspace-backup-snapshot-button" type="button" onClick={() => void createSettingsSnapshot()}><ArchiveRestore size={17} /> Tạo snapshot cài đặt</button>}</div><p className="workspace-backup-note">Tệp sao lưu có thể chứa thông tin cá nhân. Hãy lưu ở nơi an toàn và chỉ chia sẻ với người được phép.</p></section>{canManageBackups && <section className="workspace-panel workspace-backup-list-panel"><div className="workspace-backup-list-heading"><div><h2>Snapshot cài đặt</h2><p>Bản lưu cấu hình được tạo trước khi thay đổi hệ thống hoặc theo yêu cầu quản trị.</p></div><span>{systemBackups.length} snapshot</span></div><div className="workspace-data-selection"><label><input type="checkbox" aria-label="Chọn tất cả snapshot" checked={allBackupsSelected} ref={(element) => { if (element) element.indeterminate = selectedBackupIds.size > 0 && !allBackupsSelected; }} onChange={(event) => setSelectedBackupIds(event.target.checked ? new Set(systemBackups.map((backup) => backup.id)) : new Set())} /> Chọn tất cả {systemBackups.length.toLocaleString("vi-VN")} snapshot</label><span>Đã chọn {selectedBackupIds.size.toLocaleString("vi-VN")} / {systemBackups.length.toLocaleString("vi-VN")} snapshot</span><button type="button" disabled={!selectedBackupIds.size} onClick={() => setSelectedBackupIds(new Set())}>Bỏ chọn</button></div><div className="workspace-table-wrap"><table><thead><tr><th className="gradebook-select-column"><input type="checkbox" aria-label="Chọn tất cả snapshot" checked={allBackupsSelected} ref={(element) => { if (element) element.indeterminate = selectedBackupIds.size > 0 && !allBackupsSelected; }} onChange={(event) => setSelectedBackupIds(event.target.checked ? new Set(systemBackups.map((backup) => backup.id)) : new Set())} /></th><SortableTableHeader label="STT" sortKey="ordinal" sortState={backupSort} onSort={sortBackupsBy} /><SortableTableHeader label="THỜI GIAN" sortKey="created_at" sortState={backupSort} onSort={sortBackupsBy} /><SortableTableHeader label="LÝ DO" sortKey="reason" sortState={backupSort} onSort={sortBackupsBy} /><th>THAO TÁC</th></tr></thead><tbody>{visibleSystemBackups.map((backup, index) => <tr key={backup.id}><td className="gradebook-select-column"><input type="checkbox" aria-label={`Chọn snapshot ${formatDateTime(backup.created_at)}`} checked={selectedBackupIds.has(backup.id)} onChange={(event) => setSelectedBackupIds((previous) => { const next = new Set(previous); if (event.target.checked) next.add(backup.id); else next.delete(backup.id); return next; })} /></td><td>{backupPageStart + index + 1}</td><td>{formatDateTime(backup.created_at)}</td><td>{backup.reason}</td><td>{permissions.restore && permissions.update && <button className="workspace-inline-action" type="button" onClick={() => void rollbackBackup(backup)}><RotateCcw size={15} /> Khôi phục snapshot</button>}</td></tr>)}{!systemBackups.length && <tr><td className="workspace-state" colSpan={5}>Chưa có snapshot cài đặt.</td></tr>}</tbody></table></div><div className="workspace-pagination"><label>Số dòng<select aria-label="Số dòng snapshot mỗi trang" value={backupPageSize} onChange={(event) => { setBackupPageSize(event.target.value as "10" | "20" | "50" | "100" | "all"); setBackupPage(1); }}><option value="10">10 dòng</option><option value="20">20 dòng</option><option value="50">50 dòng</option><option value="100">100 dòng</option><option value="all">Tất cả</option></select></label><span>{systemBackups.length ? `Đang hiển thị ${backupPageStart + 1}–${Math.min(backupPageStart + visibleSystemBackups.length, systemBackups.length)} / ${systemBackups.length.toLocaleString("vi-VN")} dòng` : "Đang hiển thị 0–0 / 0 dòng"}</span><div><button type="button" disabled={safeBackupPage <= 1} onClick={() => setBackupPage((page) => Math.max(1, page - 1))}>Trước</button><span>Trang {safeBackupPage} / {backupPageCount}</span><button type="button" disabled={safeBackupPage >= backupPageCount} onClick={() => setBackupPage((page) => Math.min(backupPageCount, page + 1))}>Sau</button></div></div></section>}</>}
    {module.key === "trash" && <>
      <div className="workspace-panel trash-batch-toolbar"><span>Mục đã chọn: <strong>{selectedTrash.size}</strong></span><div>{permissions.delete && <button type="button" onClick={() => void scanExpiredTrash()}>Quét mục hết hạn</button>}<button type="button" disabled={!permissions.restore || !selectedTrash.size} onClick={() => void restoreSelectedTrash()}><RotateCcw size={15} /> Khôi phục đã chọn</button><button className="trash-danger" type="button" disabled={!permissions.delete || !selectedTrash.size} onClick={() => setShowBatchDelete(true)}><Trash2 size={15} /> Xóa vĩnh viễn đã chọn</button></div><small>Mục trong thùng rác được lưu theo số ngày cấu hình ({Number(systemSettings.trash_retention_days ?? 30)} ngày).</small></div>
      <div className="trash-pagination"><label>Số dòng<select value={trashPageSize} onChange={(event) => { setTrashPageSize(event.target.value as "10" | "20" | "50" | "100" | "all"); setTrashPage(1); }}><option value="10">10 dòng</option><option value="20">20 dòng</option><option value="50">50 dòng</option><option value="100">100 dòng</option><option value="all">Tất cả</option></select></label><span>{trashEntries.length ? `${trashPageStart + 1}–${Math.min(trashPageStart + visibleTrashEntries.length, trashEntries.length)} / ${trashEntries.length}` : "0 mục"}</span><div><button type="button" disabled={safeTrashPage <= 1} onClick={() => setTrashPage((page) => Math.max(1, page - 1))}>Trước</button><span>Trang {safeTrashPage} / {trashPageCount}</span><button type="button" disabled={safeTrashPage >= trashPageCount} onClick={() => setTrashPage((page) => Math.min(trashPageCount, page + 1))}>Sau</button></div></div><div className="workspace-table-wrap trash-table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="Chọn tất cả mục trong thùng rác" checked={trashEntries.length > 0 && selectedTrash.size === trashEntries.length} onChange={(event) => setSelectedTrash(event.target.checked ? new Set(trashEntries.map((entry) => entry.key)) : new Set())} /></th><SortableTableHeader label="STT" sortKey="ordinal" sortState={trashSort} onSort={sortTrashBy} /><SortableTableHeader label="HỒ SƠ" sortKey="name" sortState={trashSort} onSort={sortTrashBy} /><SortableTableHeader label="MODULE" sortKey="module" sortState={trashSort} onSort={sortTrashBy} /><SortableTableHeader label="HẠN LƯU" sortKey="purgeAt" sortState={trashSort} onSort={sortTrashBy} /><th>THAO TÁC</th></tr></thead><tbody>{visibleTrashEntries.map((entry, index) => { const days = Math.max(0, Math.ceil((new Date(entry.purgeAt ?? Date.now()).getTime() - Date.now()) / 86400000)); return <tr key={entry.key}><td><input type="checkbox" aria-label={`Chọn ${entry.name}`} checked={selectedTrash.has(entry.key)} onChange={(event) => setSelectedTrash((previous) => { const next = new Set(previous); if (event.target.checked) next.add(entry.key); else next.delete(entry.key); return next; })} /></td><td>{trashPageStart + index + 1}</td><td className="workspace-record-name">{entry.name}</td><td>{entry.moduleName}</td><td>Còn {days} ngày</td><td><div className="workspace-row-actions">{permissions.restore && <button type="button" title="Khôi phục" aria-label={`Khôi phục ${entry.name}`} onClick={() => void restoreTrashEntry(entry)}><RotateCcw size={16} /></button>}{permissions.delete && <button type="button" title="Xóa vĩnh viễn" aria-label={`Xóa ${entry.name} vĩnh viễn`} onClick={() => void permanentlyDeleteTrashEntry(entry)}><Trash2 size={16} /></button>}</div></td></tr>; })}{!trashEntries.length && <tr><td className="workspace-state" colSpan={6}><ArchiveRestore size={22} /><strong>Thùng rác đang trống</strong></td></tr>}</tbody></table></div>
      {showBatchDelete && <div className="students-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowBatchDelete(false); }}><section className="students-detail" role="alertdialog" aria-modal="true" aria-labelledby="trash-delete-title"><div className="students-detail-header"><div><span>XÓA VĨNH VIỄN</span><h2 id="trash-delete-title">Xóa {selectedTrash.size} mục đã chọn?</h2></div><button type="button" aria-label="Đóng xác nhận" onClick={() => setShowBatchDelete(false)}><X size={19} /></button></div><p>Thao tác này không thể hoàn tác. Các mục đã chọn sẽ bị xóa khỏi hệ thống.</p><div className="workspace-form-actions">{permissions.delete && <button className="trash-danger trash-danger-confirm" type="button" onClick={() => void permanentlyDeleteSelectedTrash()}>Xóa vĩnh viễn</button>}<button type="button" onClick={() => setShowBatchDelete(false)}>Hủy</button></div></section></div>}
    </>}
    {module.key === "random-picker" && <div className="workspace-panel"><h2>Rút thăm nhanh</h2><p>Dán danh sách lớp, mỗi sinh viên một dòng. Kết quả được lưu để tránh gọi lặp.</p><form onSubmit={(event) => { event.preventDefault(); const text = String(new FormData(event.currentTarget).get("items") ?? ""); const candidates = text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean); if (!candidates.length) { setRandom("Hãy nhập ít nhất một lựa chọn."); return; } const key = `vtn-random-history-${new Date().toISOString().slice(0,10)}`; const used = new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]); const remaining = candidates.filter((candidate) => !used.has(candidate)); const pool = remaining.length ? remaining : candidates; const selected = pool[Math.floor(Math.random() * pool.length)]; used.add(selected); localStorage.setItem(key, JSON.stringify([...used])); setRandom(selected); }}><label>Các lựa chọn<textarea name="items" rows={7} placeholder="Nguyễn Văn A&#10;Trần Thị B" /></label><button className="workspace-primary"><Shuffle size={17} /> Chọn ngẫu nhiên</button></form>{random && <div className="workspace-random-result">{random}</div>}</div>}
    {module.key === "settings" && <><form className="workspace-form system-settings-form" onSubmit={saveSystemSettings}><fieldset className="system-permission-fieldset" disabled={!permissions.update}><h2>Thông tin trường Đại học &amp; Khoa</h2><div className="workspace-form-grid">{[["school_name","Tên trường"],["faculty","Khoa / Viện đào tạo"],["academic_year","Niên khóa"],["current_semester","Học kỳ hiện tại"],["school_address","Địa chỉ cơ sở"],["school_email","Email liên hệ đào tạo"],["school_hotline","Hotline"],["education_philosophy","Khẩu hiệu / Triết lý giáo dục"]].map(([key,label]) => <label key={key}>{label}<input name={key} defaultValue={String(systemSettings[key] ?? "")} /></label>)}</div><h2>Thông tin giảng viên phụ trách</h2><div className="workspace-form-grid">{[["lecturer_code","Mã giảng viên"],["lecturer_name","Họ và tên"],["lecturer_degree","Học hàm / Học vị"],["lecturer_title","Chức vụ"],["lecturer_department","Bộ môn"],["lecturer_email","Email giảng viên"],["lecturer_phone","Số điện thoại"],["lecturer_office","Văn phòng / Phòng tiếp sinh viên"]].map(([key,label]) => <label key={key}>{label}<input name={key} defaultValue={String(systemSettings[key] ?? "")} /></label>)}</div><h2>Quản lý thùng rác</h2><div className="workspace-form-grid"><label>Số ngày lưu trữ<input name="trash_retention_days" type="number" min={1} max={3650} required defaultValue={Number(systemSettings.trash_retention_days ?? 30)} /></label><label className="workspace-setting"><input type="checkbox" checked={reduceMotion} onChange={(event) => { const enabled = event.target.checked; setReduceMotion(enabled); localStorage.setItem("vtn-reduce-motion", String(enabled)); document.documentElement.dataset.reduceMotion = String(enabled); }} /> Giảm chuyển động giao diện</label></div><h2>Cuộn thời gian / ngày tháng</h2><div className="workspace-form-grid"><label>Thời gian cuộn (giây)<input name="datetime_scroll_duration" type="number" min={3} max={120} required defaultValue={Number(systemSettings.datetime_scroll_duration ?? systemSettings.briefing_scroll_duration ?? 20)} /></label><label>Hướng cuộn<select name="datetime_scroll_direction" defaultValue={String(systemSettings.datetime_scroll_direction ?? systemSettings.briefing_scroll_direction ?? "left")}><option value="left">Cuộn sang trái</option><option value="right">Cuộn sang phải</option><option value="up">Cuộn lên trên</option><option value="down">Cuộn xuống dưới</option></select></label></div><h2>Cuộn lời chúc</h2><div className="workspace-form-grid"><label>Thời gian cuộn (giây)<input name="greeting_scroll_duration" type="number" min={3} max={120} required defaultValue={Number(systemSettings.greeting_scroll_duration ?? systemSettings.briefing_scroll_duration ?? 20)} /></label><label>Hướng cuộn<select name="greeting_scroll_direction" defaultValue={String(systemSettings.greeting_scroll_direction ?? systemSettings.briefing_scroll_direction ?? "left")}><option value="left">Cuộn sang trái</option><option value="right">Cuộn sang phải</option><option value="up">Cuộn lên trên</option><option value="down">Cuộn xuống dưới</option></select></label></div><h2>Cuộn Công việc hôm nay</h2><div className="workspace-form-grid"><label>Thời gian cuộn (giây)<input name="agenda_scroll_duration" type="number" min={3} max={120} required defaultValue={Number(systemSettings.agenda_scroll_duration ?? 20)} /></label><label>Hướng cuộn<select name="agenda_scroll_direction" defaultValue={String(systemSettings.agenda_scroll_direction ?? "left")}><option value="left">Cuộn sang trái</option><option value="right">Cuộn sang phải</option><option value="up">Cuộn lên trên</option><option value="down">Cuộn xuống dưới</option></select></label></div><p>Tự động tạo snapshot cấu hình trước mỗi lần lưu.</p><div className="workspace-form-actions"><button className="workspace-primary">Lưu cài đặt hệ thống</button></div></fieldset></form></>}
    {module.key === "audit-logs" && <>
      <div className="audit-heading-panel"><div className="audit-heading-icon"><History size={24} /></div><div className="audit-heading-copy"><h1>Nhật Ký Hệ Thống</h1><p>Ghi vết tự động mọi tác động (thao tác, thời gian, IP, chi tiết) với chính sách phân quyền lọc nghiêm ngặt</p></div><div className="audit-heading-actions">{auditRole === "super_admin" && permissions.delete && <button className="audit-clear-button" type="button" onClick={() => void clearAuditLogs()}><Trash2 size={16} /> Dọn sạch nhật ký</button>}{permissions.export && <><select className="audit-export-format" aria-label="Định dạng xuất nhật ký" value={auditExportFormat} onChange={(event) => setAuditExportFormat(event.target.value as "xls" | "csv" | "pdf")}><option value="xls">Excel (.xls)</option><option value="csv">CSV (.csv)</option><option value="pdf">PDF (.pdf)</option></select><button className="audit-export-button" type="button" onClick={exportAuditReport}><Download size={16} /> {selectedVisibleAuditCount ? `Xuất ${selectedVisibleAuditCount} dòng đã chọn` : "Xuất nhật ký"}</button></>}</div></div>
      <div className="audit-policy-banner"><Shield size={21} /><div><strong>QUY TẮC PHÂN QUYỀN HIỂN THỊ NHẬT KÝ: <span>{auditRole === "super_admin" ? "QUẢN TRỊ VIÊN TOÀN QUYỀN" : auditRole === "system_admin" || auditRole === "sub_admin" ? "QUẢN TRỊ VIÊN" : auditRole === "teacher" ? "GIẢNG VIÊN" : "NGƯỜI DÙNG"}</span></strong><p><b>{auditRole === "super_admin" || auditRole === "system_admin" || auditRole === "sub_admin" ? "Quản trị viên (Admin):" : auditRole === "teacher" ? "Giảng viên:" : "Người dùng:"}</b> {auditRole === "super_admin" || auditRole === "system_admin" || auditRole === "sub_admin" ? "Bạn có quyền xem toàn bộ nhật ký hệ thống của tất cả người dùng và sử dụng bộ lọc tra cứu theo từng tài khoản cụ thể." : auditRole === "teacher" ? "Nhật ký chỉ hiển thị tài khoản của bạn và các sinh viên thuộc phạm vi lớp được phân công." : "Nhật ký chỉ hiển thị hoạt động của tài khoản bạn."}</p></div></div>
      <div className="workspace-panel audit-filter-panel"><QuickFilterHeading onClear={() => { setAuditSearch(""); setAuditAction(""); setAuditUser(""); setAuditPage(1); setSelectedAuditLogIds(new Set()); }} clearDisabled={!auditSearch && !auditAction && !auditUser} /><label className="audit-search-field"><Search size={17} /><input aria-label="Tìm nhật ký" placeholder="Tìm theo nội dung, IP, người thực hiện..." value={auditSearch} onChange={(event) => { setAuditSearch(event.target.value); setAuditPage(1); setSelectedAuditLogIds(new Set()); }} /></label><SearchableFilter ariaLabel="Lọc phân loại thao tác" className="audit-filter-select" value={auditAction} allValue="" allLabel="Tất cả phân loại thao tác" options={auditCategories.map((category) => ({ value: category, label: category }))} onChange={(value) => { setAuditAction(value); setAuditPage(1); setSelectedAuditLogIds(new Set()); }} /><SearchableFilter ariaLabel="Lọc người dùng" className="audit-filter-select" value={auditUser} allValue="" allLabel="Tất cả người dùng" options={auditUserOptions.map((item) => ({ value: item.id, label: item.label }))} onChange={(value) => { setAuditUser(value); setAuditPage(1); setSelectedAuditLogIds(new Set()); }} /></div>
      <div className="audit-selection-toolbar"><label><input type="checkbox" aria-label="Chọn tất cả nhật ký phù hợp" checked={auditAllVisibleSelected} disabled={!visibleAuditLogs.length} onChange={(event) => toggleAllVisibleAuditLogs(event.target.checked)} /> Chọn tất cả nhật ký phù hợp</label><span>Đã chọn {selectedVisibleAuditCount.toLocaleString("vi-VN")} / {visibleAuditLogs.length.toLocaleString("vi-VN")} dòng</span><button type="button" disabled={!selectedAuditLogIds.size} onClick={() => setSelectedAuditLogIds(new Set())}>Bỏ chọn</button></div>
      <div className="workspace-table-wrap audit-table-wrap"><table className="audit-table"><thead><tr><th className="audit-select-column"><input type="checkbox" aria-label="Chọn tất cả nhật ký phù hợp" checked={auditAllVisibleSelected} disabled={!visibleAuditLogs.length} onChange={(event) => toggleAllVisibleAuditLogs(event.target.checked)} /></th><SortableTableHeader label="STT" sortKey="ordinal" sortState={auditSort} onSort={sortAuditBy} /><SortableTableHeader label="MỐC THỜI GIAN" sortKey="time" sortState={auditSort} onSort={sortAuditBy} /><SortableTableHeader label="NGƯỜI THỰC HIỆN" sortKey="actor" sortState={auditSort} onSort={sortAuditBy} /><SortableTableHeader label="ĐỊA CHỈ IP" sortKey="ip" sortState={auditSort} onSort={sortAuditBy} /><SortableTableHeader label="PHÂN LOẠI" sortKey="category" sortState={auditSort} onSort={sortAuditBy} /><SortableTableHeader label="HÀNH ĐỘNG" sortKey="action" sortState={auditSort} onSort={sortAuditBy} /><SortableTableHeader label="CHI TIẾT THAY ĐỔI" sortKey="details" sortState={auditSort} onSort={sortAuditBy} /><th>THAO TÁC</th></tr></thead><tbody>{visibleAuditPageLogs.map((log, index) => {
        const profile = auditUsers.find((item) => item.user_id === log.actor_id);
        const actorName = profile?.display_name || profile?.username || (log.actor_id ? `Tài khoản ${log.actor_id.slice(0, 8)}` : "Người dùng đã xóa");
        const roleName = rbacRoles.find((role) => role.key === profile?.role_key)?.label ?? profile?.role_key?.toLocaleUpperCase() ?? "TÀI KHOẢN";
        const categoryClass = auditCategory(log).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-");
        return <tr key={log.id}><td className="audit-select-column"><input type="checkbox" aria-label={`Chọn nhật ký ${formatDateTime(log.event_at)}`} checked={selectedAuditLogIds.has(log.id)} onChange={(event) => setSelectedAuditLogIds((previous) => { const next = new Set(previous); if (event.target.checked) next.add(log.id); else next.delete(log.id); return next; })} /></td><td>{auditPageStart + index + 1}</td><td className="audit-time-cell"><strong>{formatTime(log.event_at)}</strong><small>{formatDate(log.event_at)}</small></td><td className="audit-actor-cell"><strong>{actorName}</strong><small>@{profile?.username ?? log.actor_id?.slice(0, 8) ?? "đã xóa"} · {roleName}</small></td><td><span className="audit-ip-pill">{log.ip_address ?? "IP không xác định"}</span></td><td><span className={`audit-category-pill audit-category-${categoryClass}`}>{auditCategory(log)}</span></td><td className="audit-action-cell">{auditActionLabel(log.action)}{log.record_label && <small>{log.record_label}</small>}</td><td className="audit-details-cell" title={JSON.stringify(log.details)}>{JSON.stringify(log.details) || log.record_label || "—"}</td><td><div className="audit-row-actions"><button type="button" aria-label="Xem chi tiết nhật ký" title="Xem chi tiết" onClick={() => setSelectedAuditLog(log)}><Eye size={17} /></button>{auditRole === "super_admin" && permissions.delete && <button type="button" aria-label="Xóa dòng nhật ký" title="Xóa nhật ký" onClick={() => void deleteAuditLog(log)}><Trash2 size={16} /></button>}</div></td></tr>;
      })}{!visibleAuditLogs.length && <tr><td className="workspace-state" colSpan={9}><ArchiveRestore size={22} /><strong>Không có nhật ký phù hợp</strong><span>Dữ liệu hiển thị đã được giới hạn theo quyền tài khoản.</span></td></tr>}</tbody></table></div>
      <div className="audit-pagination"><label>Số dòng<select aria-label="Số dòng nhật ký mỗi trang" value={auditPageSize} onChange={(event) => { setAuditPageSize(event.target.value as "10" | "20" | "50" | "100" | "all"); setAuditPage(1); }}><option value="10">10 dòng</option><option value="20">20 dòng</option><option value="50">50 dòng</option><option value="100">100 dòng</option><option value="all">Tất cả</option></select></label><span className="audit-pagination-count">{visibleAuditLogs.length ? `Đang hiển thị ${auditPageStart + 1}–${Math.min(auditPageStart + visibleAuditPageLogs.length, visibleAuditLogs.length)} / ${visibleAuditLogs.length.toLocaleString("vi-VN")} dòng` : "Đang hiển thị 0–0 / 0 dòng"}</span><div className="audit-pagination-controls"><button type="button" aria-label="Trang trước" disabled={safeAuditPage <= 1} onClick={() => setAuditPage(safeAuditPage - 1)}>Trước</button><span>Trang {safeAuditPage} / {auditPageCount}</span><button type="button" aria-label="Trang sau" disabled={safeAuditPage >= auditPageCount} onClick={() => setAuditPage(safeAuditPage + 1)}>Sau</button></div></div>
      {permissions.restore && <section className="workspace-panel audit-trashed-panel"><div className="audit-trashed-heading"><div><h2>Nhật ký đã chuyển vào Thùng rác</h2><p>Các dòng này vẫn được lưu theo thời hạn cấu hình và có thể khôi phục.</p></div><span>{auditTrashEntries.length.toLocaleString("vi-VN")} dòng</span></div><div className="workspace-table-wrap audit-table-wrap audit-trashed-table-wrap"><table className="audit-table audit-trashed-table"><thead><tr><th>STT</th><th>NỘI DUNG NHẬT KÝ</th><th>THỜI GIAN XÓA</th><th>HẠN LƯU</th><th>THAO TÁC</th></tr></thead><tbody>{auditTrashEntries.map((entry, index) => <tr key={entry.entity_id}><td>{index + 1}</td><td className="audit-details-cell" title={entry.record_label}>{entry.record_label || `log_${entry.entity_id}`}</td><td>{formatDateTime(entry.deleted_at)}</td><td>{formatDateTime(entry.purge_at)}</td><td><div className="audit-row-actions"><button type="button" aria-label={`Khôi phục nhật ký ${entry.record_label || entry.entity_id}`} title="Khôi phục nhật ký" onClick={() => void restoreAuditLog(entry)}><RotateCcw size={16} /></button></div></td></tr>)}{!auditTrashEntries.length && <tr><td className="workspace-state" colSpan={5}><ArchiveRestore size={22} /><strong>Chưa có nhật ký trong Thùng rác</strong></td></tr>}</tbody></table></div></section>}
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
