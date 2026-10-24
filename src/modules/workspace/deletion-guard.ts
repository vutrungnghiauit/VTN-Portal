import type { Student } from "../students/student.types";
import type { WorkspaceRecord } from "./workspace.service";
import { academicYearFromSemester, formatSemesterLabel, semesterIdentity } from "../../lib/semester-groups";

const normalize = (value: unknown) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").replace(/[^a-z0-9]/gi, "").toLocaleLowerCase("vi-VN");
const read = (data: WorkspaceRecord["data"], ...keys: string[]) => keys.map((key) => String(data[key] ?? "").trim()).find(Boolean) ?? "";
const active = (record: WorkspaceRecord) => !record.deleted_at;
const periodIdentity = (data: WorkspaceRecord["data"]) => {
  const semester = read(data, "semesterName", "semester", "round");
  const year = read(data, "academicYear") || academicYearFromSemester(semester);
  return semesterIdentity(formatSemesterLabel(semester, year));
};

export function workspaceDeletionWarning(target: WorkspaceRecord, records: WorkspaceRecord[], students: Student[] = []) {
  const others = records.filter((record) => active(record) && record.id !== target.id);
  const moduleKey = target.module_key;
  const data = target.data;
  if (moduleKey === "academic-years") {
    const year = normalize(read(data, "title", "academicYear"));
    const linkedRecords = others.some((record) => ["semesters", "course-sections", "academic-advisors", "grades", "calendar", "timetables", "teaching-plans"].includes(record.module_key)
      && normalize(record.data.academicYear).includes(year));
    const linkedStudents = students.some((student) => normalize(student.semesterName).includes(year));
    const linked = linkedRecords || linkedStudents;
    if (year && linked) return "Năm học này đang được dùng trong học kỳ hoặc dữ liệu đào tạo nên không thể xóa.";
  }
  if (moduleKey === "semesters") {
    const term = normalize(read(data, "title", "semesterName"));
    const linkedRecords = others.some((record) => ["course-sections", "academic-advisors", "grades", "calendar", "timetables", "teaching-plans", "assignments"].includes(record.module_key)
      && ["semesterName", "semester", "round"].some((key) => normalize(record.data[key]).includes(term)));
    const linkedStudents = students.some((student) => normalize(student.semesterName).includes(term));
    const linked = linkedRecords || linkedStudents;
    if (term && linked) return "Học kỳ này đang có dữ liệu liên quan nên không thể xóa.";
  }
  if (moduleKey === "course-sections") {
    const code = normalize(read(data, "courseClassCode"));
    const term = normalize(read(data, "semesterName", "semester", "round"));
    const student = normalize(read(data, "studentCode"));
    const duplicateEnrollment = others.some((record) => record.module_key === "course-sections"
      && normalize(read(record.data, "studentCode")) === student
      && normalize(read(record.data, "courseClassCode")) === code
      && periodIdentity(record.data) === periodIdentity(data));
    if (duplicateEnrollment) return "";
    const linkedAcademicData = others.some((record) => ["grades", "calendar", "timetables"].includes(record.module_key)
      && normalize(read(record.data, "courseCode")) === code
      && (!term || normalize(read(record.data, "semesterName", "semester", "round")) === term));
    const linkedStudentRoster = students.some((student) => {
      try {
        const parsed = JSON.parse(student.notes || "{}") as { sourceData?: Record<string, unknown> };
        const sourceData = parsed.sourceData ?? {};
        const sourceCode = Object.entries(sourceData).find(([key]) => ["courseclasscode", "malhp"].includes(normalize(key)))?.[1];
        const sourceTerm = Object.entries(sourceData).find(([key]) => ["sourceterm", "semester", "dot", "hocky"].includes(normalize(key)))?.[1];
        return normalize(sourceCode) === code && (!term || normalize(sourceTerm).includes(term));
      } catch { return false; }
    });
    if (code && (linkedAcademicData || linkedStudentRoster)) return "Lớp học phần đang có sinh viên, dữ liệu điểm hoặc lịch học liên quan nên không thể xóa.";
  }
  return "";
}

export function studentDeletionWarning(student: Student, records: WorkspaceRecord[], students: Student[] = []) {
  const code = normalize(student.studentCode);
  const registrationIdentity = (candidate: Student) => {
    try {
      const sourceData = (JSON.parse(candidate.notes || "{}") as { sourceData?: Record<string, unknown> }).sourceData ?? {};
      const field = (...names: string[]) => {
        const keys = new Set(names.map(normalize));
        return Object.entries(sourceData).find(([key, value]) => keys.has(normalize(key)) && String(value ?? "").trim())?.[1] ?? "";
      };
      const classCode = normalize(field("courseClassCode", "ma lhp") || field("courseCode", "subjectCode", "ma hoc phan", "ma mon hoc") || field("courseName", "subjectName", "ten hoc phan", "ten mon hoc"));
      const semester = String(field("sourceTerm", "semester", "dot", "hoc ky") || candidate.semesterName);
      const year = String(field("sourceAcademicYear", "academicYear", "nam hoc") ?? "") || academicYearFromSemester(semester);
      const period = semesterIdentity(formatSemesterLabel(semester, year));
      return classCode && period ? `${normalize(candidate.studentCode)}|${classCode}|${normalize(year)}|${period}` : "";
    } catch { return ""; }
  };
  const duplicateRegistration = registrationIdentity(student);
  if (duplicateRegistration && students.some((candidate) => candidate.id !== student.id && registrationIdentity(candidate) === duplicateRegistration)) return "";
  const linked = records.some((record) => active(record) && ["course-sections", "academic-advisors", "grades"].includes(record.module_key)
    && normalize(record.data.studentCode) === code);
  return linked ? `Sinh viên ${student.studentCode} đang có dữ liệu lớp học phần, cố vấn hoặc điểm nên không thể xóa hồ sơ.` : "";
}
