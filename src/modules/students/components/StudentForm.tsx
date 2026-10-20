import { useState } from "react";
import type { Student, StudentInput } from "../student.types";

interface StudentFormProps {
  student?: Student;
  onSave: (input: StudentInput) => Promise<void>;
  onCancel: () => void;
}

type RosterFields = {
  hoDem: string;
  ten: string;
  gender: string;
  citizenId: string;
  birthplace: string;
  registrationStatus: string;
  tuitionStatus: string;
  registrationDate: string;
  courseClassCode: string;
  courseClassName: string;
  courseCode: string;
  courseName: string;
  major: string;
  specialization: string;
  term: string;
  academicYear: string;
  educationLevel: string;
  trainingType: string;
};

function normalizeKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toDateInput(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : "";
}

function getInitial(student?: Student) {
  const base: StudentInput = {
    studentCode: student?.studentCode ?? "", fullName: student?.fullName ?? "",
    dateOfBirth: student?.dateOfBirth ?? "", className: student?.className ?? "",
    faculty: student?.faculty ?? "", semesterName: student?.semesterName ?? "",
    academicStatus: student?.academicStatus ?? "Đang học", email: student?.email ?? "",
    phone: student?.phone ?? "", notes: student?.notes ?? "",
  };
  let details: Record<string, string> = {};
  let sourceData: Record<string, string> = {};
  let freeNote = student?.notes ?? "";
  try {
    const parsed = JSON.parse(base.notes) as { details?: Record<string, string>; sourceData?: Record<string, string>; freeNote?: string };
    if (parsed.details || parsed.sourceData) {
      details = parsed.details ?? {};
      sourceData = parsed.sourceData ?? {};
      freeNote = parsed.freeNote ?? details.previousNotes ?? "";
    }
  } catch { /* Existing notes are plain text. */ }
  const fromSource = (...keys: string[]) => {
    const wanted = new Set(keys.map(normalizeKey));
    return Object.entries(sourceData).find(([key]) => wanted.has(normalizeKey(key)))?.[1] ?? "";
  };
  const field = (detail: string, ...keys: string[]) => details[detail] ?? fromSource(...keys);
  const words = base.fullName.trim().split(/\s+/).filter(Boolean);
  const roster: RosterFields = {
    hoDem: field("", "hoDem", "ho dem") || words.slice(0, -1).join(" "),
    ten: field("", "ten") || words.at(-1) || "",
    gender: field("gender", "gender", "gioi tinh"),
    citizenId: field("citizenId", "citizenId", "so cccd", "cccd"),
    birthplace: field("birthplace", "birthplace", "noi sinh"),
    registrationStatus: field("registrationStatus", "registrationStatus", "trang thai dang ky lhp", "trang thai dang ky"),
    tuitionStatus: field("tuitionStatus", "tuitionStatus", "hoc phi"),
    registrationDate: toDateInput(field("registrationDate", "registrationDate", "ngay dang ky")),
    courseClassCode: field("", "courseClassCode", "ma lhp", "mã lhp"),
    courseClassName: field("", "courseClassName", "sourceClass", "lop hoc"),
    courseCode: field("", "courseCode", "subjectCode", "ma mon hoc", "mã môn học"),
    courseName: field("", "courseName", "sourceCourse", "mon hoc phan"),
    major: field("academicMajor", "sourceFaculty", "academicMajor", "nganh") || base.faculty,
    specialization: field("major", "sourceMajor", "major", "chuyen nganh"),
    term: field("", "sourceTerm", "term", "dot", "semester") || base.semesterName,
    academicYear: field("", "sourceAcademicYear", "academicYear", "nam hoc"),
    educationLevel: field("", "sourceEducationLevel", "educationLevel", "bac dao tao"),
    trainingType: field("", "sourceTrainingType", "trainingType", "loai dao tao"),
  };
  return { base, roster, freeNote, details, sourceData };
}

export default function StudentForm({ student, onSave, onCancel }: StudentFormProps) {
  const initial = getInitial(student);
  const [form, setForm] = useState(initial.base);
  const [roster, setRoster] = useState(initial.roster);
  const [freeNote, setFreeNote] = useState(initial.freeNote);
  const [existingDetails] = useState(initial.details);
  const [existingSourceData] = useState(initial.sourceData);
  const [error, setError] = useState("");
  const update = (field: keyof StudentInput, value: string) => setForm((previous) => ({ ...previous, [field]: value }));
  const updateRoster = (field: keyof RosterFields, value: string) => setRoster((previous) => ({ ...previous, [field]: value }));

  const textField = (label: string, field: keyof RosterFields, options: { required?: boolean; type?: string; placeholder?: string } = {}) => (
    <label key={field}>{label}{options.required ? " *" : ""}<input type={options.type ?? "text"} required={options.required} value={roster[field]} placeholder={options.placeholder} onChange={(event) => updateRoster(field, event.target.value)} /></label>
  );

  return (
    <form className="student-form" onSubmit={async (event) => {
      event.preventDefault(); setError("");
      const fullName = `${roster.hoDem.trim()} ${roster.ten.trim()}`.trim();
      if (!fullName) { setError("Vui lòng nhập họ đệm và tên sinh viên."); return; }
      const input: StudentInput = {
        ...form,
        fullName,
        className: form.className.trim(),
        faculty: roster.major,
        semesterName: roster.term,
        notes: JSON.stringify({
          source: "manual-student-entry",
          details: {
            ...existingDetails,
            gender: roster.gender, citizenId: roster.citizenId, birthplace: roster.birthplace,
            registrationStatus: roster.registrationStatus,
            tuitionStatus: roster.tuitionStatus, registrationDate: roster.registrationDate,
            academicMajor: roster.major, major: roster.specialization,
          },
          sourceData: {
            ...existingSourceData,
            hoDem: roster.hoDem, ten: roster.ten, courseClassCode: roster.courseClassCode,
            courseClassName: roster.courseClassName, courseCode: roster.courseCode,
            courseName: roster.courseName, sourceTerm: roster.term, sourceAcademicYear: roster.academicYear,
            sourceFaculty: roster.major, sourceMajor: roster.specialization,
            sourceEducationLevel: roster.educationLevel, sourceTrainingType: roster.trainingType,
          },
          freeNote,
        }),
      };
      try { await onSave(input); }
      catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Không thể lưu dữ liệu."); }
    }}>
      <h2>{student ? "Chỉnh sửa sinh viên" : "Thêm sinh viên"}</h2>
      {error && <p role="alert" className="students-error">{error}</p>}

      <div className="student-form-section"><h3>Thông tin sinh viên</h3><div className="student-form-grid">
        <label>Mã SV *<input required value={form.studentCode} onChange={(event) => update("studentCode", event.target.value)} /></label>
        {textField("Họ đệm", "hoDem", { required: true })}
        {textField("Tên", "ten", { required: true })}
        {textField("Giới tính", "gender")}
        <label>Ngày sinh<input type="date" value={form.dateOfBirth} onChange={(event) => update("dateOfBirth", event.target.value)} /></label>
        <label>Điện thoại<input type="tel" value={form.phone} onChange={(event) => update("phone", event.target.value)} /></label>
        {textField("Số CCCD", "citizenId")}
        <label>Email<input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} /></label>
        {textField("Nơi sinh", "birthplace")}
        <label>Trạng thái SV<select value={form.academicStatus} onChange={(event) => update("academicStatus", event.target.value)}>{["Đang học", "Bảo lưu", "Tạm dừng", "Cảnh báo học vụ", "Đã tốt nghiệp", "Thôi học"].map((status) => <option key={status}>{status}</option>)}</select></label>
        {textField("Trạng thái đăng ký LHP", "registrationStatus")}
        {textField("Học phí", "tuitionStatus")}
        <label>Lớp sinh hoạt<input value={form.className} onChange={(event) => update("className", event.target.value)} /></label>
        <label>Ngày đăng ký<input type="date" value={roster.registrationDate} onChange={(event) => updateRoster("registrationDate", event.target.value)} /></label>
      </div></div>

      <div className="student-form-section"><h3>Thông tin lớp học và đào tạo</h3><div className="student-form-grid">
        {textField("Mã LHP", "courseClassCode")}
        {textField("Tên LHP", "courseClassName")}
        {textField("Mã môn học", "courseCode")}
        {textField("Tên học phần", "courseName")}
        {textField("Ngành", "major")}
        {textField("Chuyên ngành", "specialization")}
        {textField("Đợt", "term")}
        {textField("Năm học", "academicYear", { placeholder: "Ví dụ: 2025-2026" })}
        {textField("Bậc đào tạo", "educationLevel")}
        {textField("Loại đào tạo", "trainingType")}
      </div></div>

      <label>Ghi chú<textarea rows={3} value={freeNote} onChange={(event) => setFreeNote(event.target.value)} /></label>
      <div className="students-actions"><button type="submit">Lưu sinh viên</button><button type="button" onClick={onCancel}>Hủy</button></div>
    </form>
  );
}
