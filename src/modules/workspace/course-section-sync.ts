import { studentService } from "../students/student.service";
import type { Student, StudentInput } from "../students/student.types";
import { workspaceService, type WorkspaceRecord } from "./workspace.service";
import { academicYearFromSemester, formatSemesterLabel, semesterIdentity } from "../../lib/semester-groups";

type Data = WorkspaceRecord["data"];
type Metadata = Partial<Pick<Data, "courseClassCode" | "courseClassName" | "courseCode" | "courseName" | "semesterName" | "academicYear" | "lecturer">>;

function normalized(value: unknown) {
  return String(value ?? "").normalize("NFKC").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u0111\u0110]/g, "d").replace(/\s+/g, "").toLocaleLowerCase("vi-VN");
}

function value(data: Data | undefined, key: string) {
  return String(data?.[key] ?? "").trim();
}

function enrollmentKey(data: Data | undefined) {
  const studentCode = normalized(value(data, "studentCode"));
  const courseClassCode = normalized(value(data, "courseClassCode") || value(data, "courseCode") || value(data, "courseName"));
  const semester = value(data, "semesterName") || value(data, "semester");
  const year = normalized(value(data, "academicYear") || academicYearFromSemester(semester));
  const period = semesterIdentity(formatSemesterLabel(semester, year));
  return studentCode && courseClassCode && period ? `${studentCode}|${courseClassCode}|${year}|${period}` : "";
}

function mergeEnrollmentValues(records: Array<{ data: Data; updated_at?: string }>): Data {
  const merged: Data = {};
  for (const record of [...records].sort((left, right) => String(left.updated_at ?? "").localeCompare(String(right.updated_at ?? "")))) {
    for (const [key, nextValue] of Object.entries(record.data)) {
      if (nextValue === null || String(nextValue).trim() === "") continue;
      const previous = merged[key];
      if (key === "notes" && previous && String(previous) !== String(nextValue)) {
        merged[key] = [...new Set([String(previous), String(nextValue)])].join("\n");
      } else merged[key] = nextValue;
    }
  }
  return merged;
}

/** Merge repeated rows for one student's same LHP in the same semester, keeping all populated fields. */
export function mergeCourseSectionEnrollmentRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  const mergedRows = new Map<string, T>();
  const unkeyed: T[] = [];
  for (const row of rows) {
    const key = enrollmentKey(row as Data);
    if (!key) { unkeyed.push(row); continue; }
    const previous = mergedRows.get(key);
    mergedRows.set(key, (previous ? mergeEnrollmentValues([{ data: previous as Data }, { data: row as Data }]) : row) as T);
  }
  return [...mergedRows.values(), ...unkeyed];
}

/** Consolidate existing duplicate enrollments after imports or roster synchronization. */
export async function consolidateCourseSectionEnrollments() {
  const records = await workspaceService.list("course-sections");
  const groups = new Map<string, WorkspaceRecord[]>();
  for (const record of records) {
    const key = enrollmentKey(record.data);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  let consolidated = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [survivor, ...duplicates] = [...group].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    if (!survivor) continue;
    const merged = mergeEnrollmentValues(group.map((record) => ({ data: record.data, updated_at: record.updated_at })));
    await workspaceService.save("course-sections", merged, survivor.id, survivor.external_id ?? undefined);
    await workspaceService.moveMergedDuplicatesToTrash(duplicates.map((duplicate) => duplicate.id));
    consolidated += duplicates.length;
  }
  return consolidated;
}

function identity(moduleKey: string, data: Data | undefined) {
  const code = moduleKey === "course-sections" ? value(data, "courseClassCode") : value(data, "courseCode");
  const semester = value(data, "semesterName") || value(data, "semester") || value(data, "round");
  return code && semester ? `${normalized(code)}|${normalized(semester).replace(/[-\u2013\u2014]/g, "")}` : "";
}

function metadataFor(moduleKey: string, before: Data | undefined, after: Data): Metadata {
  const fieldMap: Array<[keyof Metadata, string]> = moduleKey === "course-sections"
    ? [["courseClassCode", "courseClassCode"], ["courseClassName", "courseClassName"], ["courseCode", "courseCode"], ["courseName", "courseName"], ["semesterName", "semesterName"], ["academicYear", "academicYear"], ["lecturer", "lecturer"]]
    : moduleKey === "grades"
      ? [["courseClassCode", "courseCode"], ["courseName", "courseName"], ["semesterName", "semesterName"], ["academicYear", "academicYear"]]
      : moduleKey === "calendar"
        ? [["courseClassCode", "courseCode"], ["courseName", "title"], ["semesterName", "semesterName"], ["academicYear", "academicYear"], ["lecturer", "lecturer"]]
        : moduleKey === "timetables"
          ? [["courseClassCode", "courseCode"], ["courseName", "subjectName"], ["semesterName", "semesterName"], ["academicYear", "academicYear"], ["lecturer", "lecturer"]]
          : [];
  const patch: Metadata = {};
  for (const [canonicalKey, sourceKey] of fieldMap) {
    const next = Object.prototype.hasOwnProperty.call(after, sourceKey) ? value(after, sourceKey) : "";
    const previous = value(before, sourceKey);
    if (Object.prototype.hasOwnProperty.call(after, sourceKey) && ((!before && next) || (before && next !== previous))) patch[canonicalKey] = next;
  }
  return patch;
}

function dataForModule(moduleKey: string, patch: Metadata): Data {
  const data: Data = {};
  if (moduleKey === "course-sections") {
    for (const key of ["courseClassCode", "courseClassName", "courseCode", "courseName", "semesterName", "academicYear", "lecturer"] as const) {
      if (patch[key] !== undefined) data[key] = patch[key]!;
    }
  } else {
    if (patch.courseClassCode !== undefined) data.courseCode = patch.courseClassCode;
    if (patch.courseName !== undefined) data[moduleKey === "calendar" ? "title" : moduleKey === "timetables" ? "subjectName" : "courseName"] = patch.courseName;
    for (const key of ["semesterName", "academicYear", "lecturer"] as const) {
      if (patch[key] !== undefined) data[key] = patch[key]!;
    }
  }
  return data;
}

async function syncStudentRosterNotes(oldCode: string, oldSemester: string, patch: Metadata) {
  const students = await studentService.list();
  for (const student of students) {
    let parsed: { details?: Record<string, string>; sourceData?: Record<string, string>; [key: string]: unknown };
    try { parsed = JSON.parse(student.notes || "{}"); } catch { continue; }
    const sourceData = parsed.sourceData ?? {};
    const sourceCode = Object.entries(sourceData).find(([key]) => normalized(key) === "courseclasscode" || normalized(key) === "malhp")?.[1] ?? "";
    const sourceSemester = Object.entries(sourceData).find(([key]) => ["sourceterm", "semester", "dot", "hocky"].includes(normalized(key)))?.[1] ?? "";
    if (normalized(sourceCode) !== normalized(oldCode) || (oldSemester && normalized(sourceSemester).replace(/[-\u2013\u2014]/g, "") !== normalized(oldSemester).replace(/[-\u2013\u2014]/g, ""))) continue;
    const nextSource = { ...sourceData };
    const writeAliases = (keys: string[], canonicalKey: string, nextValue: string | number | null | undefined) => {
      if (nextValue === undefined || nextValue === null) return;
      const wanted = new Set(keys.map(normalized));
      for (const key of Object.keys(nextSource)) if (wanted.has(normalized(key))) nextSource[key] = String(nextValue);
      nextSource[canonicalKey] = String(nextValue);
    };
    writeAliases(["courseClassCode", "ma lhp"], "courseClassCode", patch.courseClassCode);
    writeAliases(["courseClassName", "ten lhp"], "courseClassName", patch.courseClassName);
    writeAliases(["courseCode", "subjectCode", "ma mon hoc", "ma hoc phan"], "courseCode", patch.courseCode);
    writeAliases(["courseName", "subjectName", "ten hoc phan", "ten mon hoc"], "courseName", patch.courseName);
    writeAliases(["semesterName", "sourceTerm", "semester", "dot", "hoc ky"], "sourceTerm", patch.semesterName);
    writeAliases(["academicYear", "sourceAcademicYear", "nam hoc"], "sourceAcademicYear", patch.academicYear);
    writeAliases(["lecturer", "giang vien"], "lecturer", patch.lecturer);
    const notes = JSON.stringify({ ...parsed, sourceData: nextSource });
    const input = { studentCode: student.studentCode, fullName: student.fullName, dateOfBirth: student.dateOfBirth, className: student.className, faculty: student.faculty, semesterName: patch.semesterName === undefined ? student.semesterName : String(patch.semesterName), academicStatus: student.academicStatus, email: student.email, phone: student.phone, notes };
    await studentService.save(input, student.id);
  }
}

/** Keep the shared course-section fields aligned in the roster, gradebook and schedule menus. */
export async function syncRelatedCourseSectionMetadata(moduleKey: string, before: Data | undefined, after: Data, syncStudentProfiles = true) {
  if (!["course-sections", "grades", "calendar", "timetables"].includes(moduleKey)) return;
  const patch = metadataFor(moduleKey, before, after);
  if (!Object.keys(patch).length) return;
  const oldCode = moduleKey === "course-sections" ? value(before, "courseClassCode") : value(before, "courseCode");
  const oldSemester = value(before, "semesterName") || value(before, "semester") || value(before, "round");
  const newCode = String(patch.courseClassCode ?? (moduleKey === "course-sections" ? value(after, "courseClassCode") : value(after, "courseCode")));
  const newSemester = String(patch.semesterName ?? value(after, "semesterName") ?? value(after, "semester") ?? value(after, "round"));
  const matchKey = oldCode && oldSemester ? `${normalized(oldCode)}|${normalized(oldSemester).replace(/[-\u2013\u2014]/g, "")}` : identity(moduleKey, after);
  if (!matchKey) return;

  for (const targetModule of ["course-sections", "grades", "calendar", "timetables"]) {
    const records = await workspaceService.list(targetModule);
    for (const record of records) {
      if (identity(targetModule, record.data) !== matchKey) continue;
      const updates = dataForModule(targetModule, patch);
      const next = { ...record.data, ...updates };
      if (Object.entries(updates).every(([key, nextValue]) => String(record.data[key] ?? "") === String(nextValue ?? ""))) continue;
      await workspaceService.save(targetModule, next, record.id, record.external_id ?? undefined);
    }
  }

  if (syncStudentProfiles && oldCode && oldSemester) await syncStudentRosterNotes(oldCode, oldSemester, { ...patch, courseClassCode: newCode, semesterName: newSemester });
}

const studentModules = ["course-sections", "academic-advisors", "grades"];
const studentFieldKeys = ["studentCode", "studentName", "studentMiddleName", "studentGivenName", "className", "major", "gender", "dateOfBirth", "phone", "citizenId", "email", "birthplace", "academicStatus"] as const;

function nameParts(fullName: string) {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  return { studentMiddleName: words.slice(0, -1).join(" "), studentGivenName: words.at(-1) ?? "" };
}

function studentSharedData(student: Student): Data {
  let details: Record<string, unknown> = {};
  try { details = (JSON.parse(student.notes || "{}") as { details?: Record<string, unknown> }).details ?? {}; } catch { /* Legacy notes may not be JSON. */ }
  const parts = nameParts(student.fullName);
  const shared: Data = {
    studentCode: student.studentCode,
    studentName: student.fullName,
    ...parts,
    className: student.className,
    dateOfBirth: student.dateOfBirth,
    phone: student.phone,
    email: student.email,
    academicStatus: student.academicStatus,
  };
  if (Object.prototype.hasOwnProperty.call(details, "major") || Object.prototype.hasOwnProperty.call(details, "academicMajor") || student.faculty) shared.major = String(details.major ?? details.academicMajor ?? student.faculty ?? "");
  for (const key of ["gender", "citizenId", "birthplace"] as const) if (Object.prototype.hasOwnProperty.call(details, key)) shared[key] = String(details[key] ?? "");
  return shared;
}

function profileInputWithSharedFields(student: Student, patch: Data): StudentInput {
  const notes: { details?: Record<string, unknown>; sourceData?: Record<string, unknown>; [key: string]: unknown } = (() => {
    try { return JSON.parse(student.notes || "{}"); } catch { return {}; }
  })();
  const details = { ...(notes.details ?? {}) };
  const sourceData = { ...(notes.sourceData ?? {}) };
  const setIfPresent = (sourceKeys: string[], detailKey: string, valueKey: string) => {
    if (!Object.prototype.hasOwnProperty.call(patch, valueKey)) return;
    const next = String(patch[valueKey] ?? "");
    details[detailKey] = next;
    for (const key of sourceKeys) sourceData[key] = next;
  };
  const previousNameParts = nameParts(student.fullName);
  const middleName = Object.prototype.hasOwnProperty.call(patch, "studentMiddleName") ? String(patch.studentMiddleName ?? "") : previousNameParts.studentMiddleName;
  const givenName = Object.prototype.hasOwnProperty.call(patch, "studentGivenName") ? String(patch.studentGivenName ?? "") : previousNameParts.studentGivenName;
  const hasNameUpdate = ["studentName", "studentMiddleName", "studentGivenName"].some((key) => Object.prototype.hasOwnProperty.call(patch, key));
  const fullName = String(Object.prototype.hasOwnProperty.call(patch, "studentName") ? patch.studentName ?? "" : hasNameUpdate ? [middleName, givenName].filter(Boolean).join(" ") : student.fullName).trim();
  setIfPresent(["gender"], "gender", "gender");
  setIfPresent(["citizenId", "so cccd", "cccd"], "citizenId", "citizenId");
  setIfPresent(["birthplace", "noi sinh"], "birthplace", "birthplace");
  setIfPresent(["major", "academicMajor", "nganh"], "major", "major");
  const input: StudentInput = {
    studentCode: String(patch.studentCode ?? student.studentCode),
    fullName: fullName || student.fullName,
    dateOfBirth: String(patch.dateOfBirth ?? student.dateOfBirth),
    className: String(patch.className ?? student.className),
    faculty: String(patch.major ?? student.faculty),
    semesterName: student.semesterName,
    academicStatus: String(patch.academicStatus ?? student.academicStatus),
    email: String(patch.email ?? student.email),
    phone: String(patch.phone ?? student.phone),
    notes: JSON.stringify({ ...notes, details, sourceData }),
  };
  return input;
}

type StudentFieldChange = { studentCode: string; previousStudentCode?: string; source: Data; sourceModule: string; sourceStudent?: Student };

/** Synchronize the shared student columns across profile, advisor, enrollment and grade rows. */
export async function syncRelatedStudentFieldsBatch(changes: StudentFieldChange[]) {
  const normalizedChanges = new Map<string, { patch: Data; sourceModule: string; sourceStudent?: Student; previousStudentCode?: string }>();
  for (const change of changes) {
    const code = normalized(change.studentCode);
    if (!code) continue;
    const patch = normalizedChanges.get(code)?.patch ?? {};
    if (change.sourceStudent) Object.assign(patch, studentSharedData(change.sourceStudent));
    for (const key of studentFieldKeys) if (Object.prototype.hasOwnProperty.call(change.source, key)) patch[key] = change.source[key] ?? "";
    if (Object.keys(patch).length > 1) normalizedChanges.set(code, { patch, sourceModule: change.sourceModule, sourceStudent: change.sourceStudent, previousStudentCode: change.previousStudentCode });
  }
  if (!normalizedChanges.size) return;

  const [profiles, ...recordsByModule] = await Promise.all([
    studentService.list(),
    ...studentModules.map((moduleKey) => workspaceService.list(moduleKey)),
  ]);
  for (const [code, change] of normalizedChanges) {
    const previousCode = normalized(change.previousStudentCode);
    const profile = change.sourceStudent ?? profiles.find((student) => normalized(student.studentCode) === code || normalized(student.studentCode) === previousCode);
    if (profile && change.sourceModule !== "student-records") await studentService.save(profileInputWithSharedFields(profile, change.patch), profile.id);
    for (let index = 0; index < studentModules.length; index += 1) {
      const targetModule = studentModules[index]!;
      for (const record of recordsByModule[index]!) {
        const recordCode = normalized(record.data.studentCode);
        if (recordCode !== code && recordCode !== normalized(change.previousStudentCode)) continue;
        const updates = Object.fromEntries(Object.entries(change.patch).filter(([key]) => (key === "studentCode" || studentFieldKeys.includes(key as typeof studentFieldKeys[number]))));
        if (!Object.entries(updates).some(([key, value]) => String(record.data[key] ?? "") !== String(value ?? ""))) continue;
        await workspaceService.save(targetModule, { ...record.data, ...updates }, record.id, record.external_id ?? undefined);
      }
    }
  }
}

export async function syncRelatedStudentFields(studentCode: string, source: Data, sourceModule: string, sourceStudent?: Student) {
  return syncRelatedStudentFieldsBatch([{ studentCode, source, sourceModule, sourceStudent }]);
}

/** Keep the academic year and semester labels consistent after a catalog edit. */
export async function syncRelatedAcademicPeriodMetadata(moduleKey: string, before: Data | undefined, after: Data) {
  if (!["academic-years", "semesters"].includes(moduleKey) || !before) return;
  const yearChange = moduleKey === "academic-years";
  const oldTitle = value(before, "title");
  const newTitle = value(after, "title");
  const oldYear = yearChange ? oldTitle : value(before, "academicYear");
  const newYear = yearChange ? newTitle : value(after, "academicYear");
  const oldTerm = yearChange ? "" : oldTitle;
  const newTerm = yearChange ? "" : newTitle;
  if ((!yearChange && !normalized(oldTerm)) || (yearChange && !normalized(oldYear))) return;

  const modules = ["semesters", "course-sections", "academic-advisors", "grades", "calendar", "timetables", "teaching-plans"];
  const recordsByModule = await Promise.all(modules.map((key) => workspaceService.list(key)));
  for (let index = 0; index < modules.length; index += 1) {
    const targetModule = modules[index]!;
    for (const record of recordsByModule[index]!) {
      const recordYear = value(record.data, "academicYear");
      const recordTerm = value(record.data, "semesterName") || value(record.data, "semester") || value(record.data, "round");
      const sameYear = oldYear && normalized(recordYear) === normalized(oldYear);
      const sameTerm = oldTerm && normalized(recordTerm).includes(normalized(oldTerm));
      if (yearChange ? !sameYear : !(sameTerm && (!oldYear || !recordYear || sameYear))) continue;
      const updates: Data = {};
      if (yearChange) updates.academicYear = newYear;
      else {
        if (Object.prototype.hasOwnProperty.call(record.data, "semesterName") || targetModule !== "teaching-plans") updates.semesterName = newTerm;
        if (Object.prototype.hasOwnProperty.call(record.data, "semester")) updates.semester = newTerm;
        if (Object.prototype.hasOwnProperty.call(record.data, "round")) updates.round = newTerm;
        if (oldYear && Object.prototype.hasOwnProperty.call(after, "academicYear")) updates.academicYear = newYear;
      }
      if (!Object.entries(updates).some(([key, next]) => String(record.data[key] ?? "") !== String(next ?? ""))) continue;
      await workspaceService.save(targetModule, { ...record.data, ...updates }, record.id, record.external_id ?? undefined);
    }
  }
  if (!yearChange && oldTerm) {
    const students = await studentService.list();
    for (const student of students) {
      const studentTerm = normalized(student.semesterName);
      if (!studentTerm.includes(normalized(oldTerm)) || (oldYear && !studentTerm.includes(normalized(oldYear)))) continue;
      await studentService.save({ studentCode: student.studentCode, fullName: student.fullName, dateOfBirth: student.dateOfBirth, className: student.className, faculty: student.faculty, semesterName: newTerm, academicStatus: student.academicStatus, email: student.email, phone: student.phone, notes: student.notes }, student.id);
    }
  }
}
