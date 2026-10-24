import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import type { Student, StudentInput } from "./student.types";
import { workspaceService } from "../workspace/workspace.service";
import { studentDeletionWarning } from "../workspace/deletion-guard";
import { academicYearFromSemester, formatSemesterLabel, semesterIdentity } from "../../lib/semester-groups";

type StudentRow = {
  id: string;
  student_code: string;
  full_name: string;
  date_of_birth: string | null;
  class_name: string | null;
  faculty: string | null;
  semester_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
  purge_at?: string | null;
  academic_status?: string;
  auth_user_id?: string | null;
};

function client() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Chưa cấu hình Supabase. Hãy thêm VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY vào tệp .env.local.");
  }
  return supabase;
}

async function requireUser() {
  const { data, error } = await client().auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
  return data.user;
}

function mapStudent(row: StudentRow): Student {
  return {
    id: row.id,
    studentCode: row.student_code,
    fullName: row.full_name,
    dateOfBirth: row.date_of_birth ?? "",
    className: row.class_name ?? "",
    faculty: row.faculty ?? "Chưa phân khoa",
    semesterName: row.semester_name ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    notes: row.notes ?? "",
    createdAt: row.created_at,
    purgeAt: row.purge_at ?? null,
    academicStatus: row.academic_status ?? "Đang học",
    authUserId: row.auth_user_id ?? null,
  };
}

function notifyStudentsUpdated() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("vtn-students-updated"));
}

function normalizeInput(input: StudentInput) {
  const studentCode = input.studentCode.trim();
  const fullName = input.fullName.trim();
  if (!studentCode || !fullName) throw new Error("Vui lòng nhập mã sinh viên và họ tên.");
  return {
    student_code: studentCode,
    full_name: fullName,
    date_of_birth: input.dateOfBirth || null,
    class_name: input.className.trim() || null,
    faculty: input.faculty.trim() || null,
    semester_name: input.semesterName.trim() || null,
    academic_status: input.academicStatus,
    email: input.email.trim() || null,
    phone: input.phone.trim() || null,
    notes: input.notes.trim() || null,
  };
}

function friendlyError(error: { code?: string; message: string }) {
  if (error.code === "23505") return new Error("Mã sinh viên này đã tồn tại trong dữ liệu của bạn.");
  if (error.code === "42P01" || error.code === "PGRST205") return new Error("Chưa tạo bảng students. Hãy chạy tệp supabase/students.sql trong Supabase SQL Editor.");
  if (error.code === "42501" || error.code === "PGRST301") return new Error("Bạn không có quyền thực hiện thao tác này. Hãy kiểm tra chính sách RLS và tài khoản đăng nhập.");
  return new Error(error.message || "Không thể kết nối dữ liệu sinh viên.");
}

const normalizeRosterValue = (value: unknown) => String(value ?? "").normalize("NFKC").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").replace(/[^a-z0-9]/gi, "").toLocaleLowerCase("vi-VN");

function rosterRegistrationIdentity(student: Student) {
  try {
    const parsed = JSON.parse(student.notes || "{}") as { sourceData?: Record<string, unknown> };
    const sourceData = parsed.sourceData ?? {};
    const read = (...keys: string[]) => {
      const wanted = new Set(keys.map(normalizeRosterValue));
      return Object.entries(sourceData).find(([key, value]) => wanted.has(normalizeRosterValue(key)) && String(value ?? "").trim())?.[1] ?? "";
    };
    const classCode = normalizeRosterValue(read("courseClassCode", "ma lhp") || read("courseCode", "subjectCode", "ma hoc phan", "ma mon hoc") || read("courseName", "subjectName", "ten hoc phan", "ten mon hoc"));
    const semester = String(read("sourceTerm", "semester", "dot", "hoc ky") || student.semesterName);
    const year = String(read("sourceAcademicYear", "academicYear", "nam hoc") || academicYearFromSemester(semester));
    const period = semesterIdentity(formatSemesterLabel(semester, year));
    return classCode && period ? `${normalizeRosterValue(student.studentCode)}|${classCode}|${normalizeRosterValue(year)}|${period}` : "";
  } catch { return ""; }
}

/** Merge duplicate student enrollment profiles for the same LHP and term. */
export async function consolidateStudentRosterDuplicates() {
  const students = await studentService.list();
  const groups = new Map<string, Student[]>();
  for (const student of students) {
    const identity = rosterRegistrationIdentity(student);
    if (!identity) continue;
    const group = groups.get(identity) ?? [];
    group.push(student);
    groups.set(identity, group);
  }
  let consolidated = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const survivor = ordered.at(-1)!;
    const details: Record<string, string> = {};
    const sourceData: Record<string, string> = {};
    let freeNote = "";
    for (const student of ordered) {
      try {
        const parsed = JSON.parse(student.notes || "{}") as { details?: Record<string, unknown>; sourceData?: Record<string, unknown>; freeNote?: string };
        for (const [key, value] of Object.entries(parsed.details ?? {})) if (String(value ?? "").trim()) details[key] = String(value);
        for (const [key, value] of Object.entries(parsed.sourceData ?? {})) if (String(value ?? "").trim()) sourceData[key] = String(value);
        if (parsed.freeNote?.trim()) freeNote = [...new Set([freeNote, parsed.freeNote.trim()].filter(Boolean))].join("\n");
      } catch {
        if (student.notes.trim()) freeNote = [...new Set([freeNote, student.notes.trim()].filter(Boolean))].join("\n");
      }
    }
    const latestNonEmpty = (key: keyof Student) => [...ordered].reverse().map((student) => String(student[key] ?? "").trim()).find(Boolean) ?? "";
    await studentService.save({
      studentCode: survivor.studentCode,
      fullName: latestNonEmpty("fullName"),
      dateOfBirth: latestNonEmpty("dateOfBirth"),
      className: latestNonEmpty("className"),
      faculty: latestNonEmpty("faculty"),
      semesterName: latestNonEmpty("semesterName"),
      academicStatus: latestNonEmpty("academicStatus"),
      email: latestNonEmpty("email"),
      phone: latestNonEmpty("phone"),
      notes: JSON.stringify({ source: "imported-class-rosters", details, sourceData, ...(freeNote ? { freeNote } : {}) }),
    }, survivor.id);
    const duplicates = ordered.filter((student) => student.id !== survivor.id);
    await studentService.moveMergedRosterDuplicatesToTrash(duplicates.map((student) => student.id));
    consolidated += duplicates.length;
  }
  return consolidated;
}

export const studentService = {
  async list(): Promise<Student[]> {
    await requireUser();
    const rows: StudentRow[] = []; const pageSize = 500;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await client()
        .from("students")
        .select("id, student_code, full_name, date_of_birth, class_name, faculty, semester_name, academic_status, email, phone, notes, created_at, purge_at, auth_user_id")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw friendlyError(error);
      const page = (data ?? []) as StudentRow[];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return [...new Map(rows.map((row) => [row.id, row])).values()].map(mapStudent);
  },

  async save(input: StudentInput, id?: string): Promise<Student> {
    const user = await requireUser();
    const values = normalizeInput(input);
    const query = id
      ? client().from("students").update(values).eq("id", id)
      : client().from("students").insert({ ...values, owner_id: user.id });
    const { data, error } = await query
      .select("id, student_code, full_name, date_of_birth, class_name, faculty, semester_name, academic_status, email, phone, notes, created_at, purge_at, auth_user_id")
      .single();
    if (error) throw friendlyError(error);
    const student = mapStudent(data as StudentRow);
    notifyStudentsUpdated();
    return student;
  },

  async moveToTrash(id: string): Promise<void> {
    await requireUser();
    const [students, records] = await Promise.all([this.list(), workspaceService.allRecords()]);
    const target = students.find((student) => student.id === id);
    if (target) {
      const { data: role } = await client().rpc("current_role_key");
      if (role !== "super_admin") {
        const warning = studentDeletionWarning(target, records, students);
        if (warning) throw new Error(warning);
      }
    }
    const { error } = await client().rpc("set_student_trash_state", { p_id: id, p_restore: false });
    if (error) throw friendlyError(error);
    notifyStudentsUpdated();
  },

  /** Archive rows only after consolidateStudentRosterDuplicates has merged their populated fields. */
  async moveMergedRosterDuplicatesToTrash(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await requireUser();
    for (let offset = 0; offset < ids.length; offset += 20) {
      const chunk = ids.slice(offset, offset + 20);
      const results = await Promise.all(chunk.map((id) => client().rpc("set_student_trash_state", { p_id: id, p_restore: false })));
      const failed = results.find((result) => result.error)?.error;
      if (failed) throw friendlyError(failed);
    }
    notifyStudentsUpdated();
  },

  async listTrash(): Promise<Student[]> {
    await requireUser();
    const rows: StudentRow[] = []; const pageSize = 500;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await client().from("students")
        .select("id, student_code, full_name, date_of_birth, class_name, faculty, semester_name, academic_status, email, phone, notes, created_at, purge_at, auth_user_id")
        .not("deleted_at", "is", null).order("deleted_at", { ascending: false }).order("id", { ascending: true }).range(from, from + pageSize - 1);
      if (error) throw friendlyError(error);
      const page = (data ?? []) as StudentRow[];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return [...new Map(rows.map((row) => [row.id, row])).values()].map(mapStudent);
  },

  async restore(id: string): Promise<void> {
    await requireUser();
    const { error } = await client().rpc("set_student_trash_state", { p_id: id, p_restore: true });
    if (error) throw friendlyError(error);
    notifyStudentsUpdated();
  },

  async deletePermanently(id: string): Promise<void> {
    await requireUser();
    const { error } = await client().from("students").delete().eq("id", id);
    if (error) throw friendlyError(error);
    notifyStudentsUpdated();
  },

  async purgeExpired(): Promise<number> {
    await requireUser();
    const { data, error } = await client().rpc("purge_expired_trash");
    if (error) throw friendlyError(error);
    return Number(data ?? 0);
  },
};
