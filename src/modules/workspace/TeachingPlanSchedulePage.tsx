import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarDays, Download, FileUp, Pencil, Plus, Printer, Trash2, X } from "lucide-react";
import { workspaceService, type WorkspaceRecord } from "./workspace.service";
import { settingsService } from "../settings/settings.service";
import { supabase } from "../../lib/supabase";
import "./teaching-plan-schedule.css";

type Mark = { date: string; kind: "holiday" | "planned"; label: string };
type Term = { name: string; start: string; weeks: number; examWeeks: number[]; marks: Mark[] };
type AcademicSchedule = { year: string; terms: Term[] };

// Monday start dates and marked weeks follow the official NTTU academic progress sheets.
const schedules: AcademicSchedule[] = [
  { year: "2023–2024", terms: [
    { name: "Học kỳ 1", start: "2023-10-09", weeks: 17, examWeeks: [10, 17], marks: [{ date: "2023-11-20", kind: "holiday", label: "Ngày Nhà giáo Việt Nam" }, { date: "2024-01-01", kind: "holiday", label: "Tết Dương lịch" }] },
    { name: "Học kỳ 2", start: "2024-02-05", weeks: 18, examWeeks: [10, 18], marks: [{ date: "2024-04-18", kind: "holiday", label: "Giỗ Tổ Hùng Vương" }, { date: "2024-04-30", kind: "holiday", label: "Ngày Giải phóng miền Nam" }, { date: "2024-05-01", kind: "holiday", label: "Quốc tế Lao động" }] },
    { name: "Học kỳ 3", start: "2024-06-10", weeks: 17, examWeeks: [10, 17], marks: [{ date: "2024-09-02", kind: "holiday", label: "Quốc khánh" }] },
  ] },
  { year: "2024–2025", terms: [
    { name: "Học kỳ 1", start: "2024-10-07", weeks: 18, examWeeks: [16], marks: [{ date: "2024-11-20", kind: "holiday", label: "Ngày Nhà giáo Việt Nam" }, { date: "2025-01-01", kind: "holiday", label: "Tết Dương lịch" }, { date: "2025-01-27", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2025-01-28", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2025-01-29", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2025-01-30", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2025-01-31", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2025-02-01", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2025-02-02", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }] },
    { name: "Học kỳ 2", start: "2025-02-10", weeks: 17, examWeeks: [17], marks: [{ date: "2025-04-07", kind: "holiday", label: "Nghỉ bù" }, { date: "2025-04-30", kind: "holiday", label: "Ngày Giải phóng miền Nam" }, { date: "2025-05-01", kind: "holiday", label: "Quốc tế Lao động" }] },
    { name: "Học kỳ 3", start: "2025-06-09", weeks: 17, examWeeks: [17], marks: [{ date: "2025-09-02", kind: "holiday", label: "Quốc khánh" }] },
  ] },
  { year: "2026–2027", terms: [
    { name: "Học kỳ 1", start: "2026-10-05", weeks: 17, examWeeks: [17], marks: [{ date: "2026-11-20", kind: "planned", label: "Nghỉ theo kế hoạch" }, { date: "2027-01-01", kind: "holiday", label: "Tết Dương lịch" }] },
    { name: "Học kỳ 2", start: "2027-02-01", weeks: 18, examWeeks: [18], marks: [{ date: "2027-02-01", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2027-02-02", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2027-02-03", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2027-02-04", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2027-02-05", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2027-02-06", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2027-02-07", kind: "holiday", label: "Nghỉ Tết Nguyên đán" }, { date: "2027-04-16", kind: "holiday", label: "Giỗ Tổ Hùng Vương" }, { date: "2027-04-30", kind: "holiday", label: "Ngày Giải phóng miền Nam" }, { date: "2027-05-01", kind: "holiday", label: "Quốc tế Lao động" }, { date: "2027-06-05", kind: "planned", label: "Kỷ niệm thành lập Trường" }] },
    { name: "Học kỳ 3", start: "2027-06-07", weeks: 17, examWeeks: [17], marks: [{ date: "2027-09-02", kind: "holiday", label: "Quốc khánh" }, { date: "2027-09-03", kind: "planned", label: "Nghỉ theo kế hoạch" }, { date: "2027-09-04", kind: "planned", label: "Nghỉ theo kế hoạch" }, { date: "2027-09-05", kind: "planned", label: "Nghỉ theo kế hoạch" }] },
  ] },
];

const weekdays = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"];
const asDate = (iso: string) => new Date(`${iso}T00:00:00`);
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const formatDate = (date: Date) => date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });

export function getTeachingPeriodCatalog() {
  return schedules.map((schedule) => {
    const year = schedule.year.replace(/[–—−]/g, "-");
    const terms = schedule.terms.map((term) => {
      const end = asDate(term.start); end.setDate(end.getDate() + term.weeks * 7 - 1);
      return { title: `${term.name} - ${year}`, academicYear: year, startDate: term.start, endDate: dateKey(end), weeks: term.weeks };
    });
    return { year: { title: year, startDate: terms[0].startDate, endDate: terms[terms.length - 1].endDate }, terms };
  });
}

function firstMonday(year: number, month: number) {
  const date = new Date(year, month, 1); date.setDate(1 + ((8 - date.getDay()) % 7)); return dateKey(date);
}

function estimatedSchedule(year: number): AcademicSchedule {
  const nextYear = year + 1;
  return { year: `${year}–${nextYear}`, terms: [
    { name: "Học kỳ 1", start: firstMonday(year, 9), weeks: 17, examWeeks: [], marks: [] },
    { name: "Học kỳ 2", start: firstMonday(nextYear, 1), weeks: 18, examWeeks: [], marks: [] },
    { name: "Học kỳ 3", start: firstMonday(nextYear, 5), weeks: 17, examWeeks: [], marks: [] },
  ] };
}

export async function ensureCurrentAcademicPeriods() {
  const today = dateKey(new Date());
  const known = schedules.map((schedule) => {
    const first = schedule.terms[0]; const last = schedule.terms[schedule.terms.length - 1];
    const end = asDate(last.start); end.setDate(end.getDate() + last.weeks * 7 - 1);
    return { schedule, start: first.start, end: dateKey(end) };
  }).find((period) => period.start <= today && period.end >= today);
  const academicStartYear = new Date().getMonth() >= 9 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const estimate = known ? undefined : estimatedSchedule(academicStartYear);
  const estimateEnd = estimate ? asDate(estimate.terms[2].start) : undefined;
  if (estimateEnd && estimate) estimateEnd.setDate(estimateEnd.getDate() + estimate.terms[2].weeks * 7 - 1);
  const current = known ?? (estimate && estimateEnd && estimate.terms[0].start <= today && dateKey(estimateEnd) >= today
    ? { schedule: estimate, start: estimate.terms[0].start, end: dateKey(estimateEnd) }
    : undefined);
  if (!current) return;

  const [years, semesters] = await Promise.all([workspaceService.list("academic-years"), workspaceService.list("semesters")]);
  const { schedule } = current;
  const endDate = current.end;
  if (!years.some((row) => row.data.title === schedule.year)) {
    await workspaceService.save("academic-years", { title: schedule.year, startDate: current.start, endDate, status: "Đang áp dụng", notes: estimate ? "Năm học tự động khởi tạo theo mốc dự kiến (thứ Hai đầu tiên của tháng 10); cần đối chiếu thông báo chính thức." : "Tự động khởi tạo theo lịch tiến độ đào tạo đã cấu hình." });
  }

  const activeTerm = schedule.terms.find((term) => {
    const end = asDate(term.start); end.setDate(end.getDate() + term.weeks * 7 - 1);
    return term.start <= today && dateKey(end) >= today;
  });
  if (!activeTerm) return;
  const title = `${activeTerm.name} - ${schedule.year}`;
  const termEnd = asDate(activeTerm.start); termEnd.setDate(termEnd.getDate() + activeTerm.weeks * 7 - 1);
  if (!semesters.some((row) => row.data.title === title)) {
    await workspaceService.save("semesters", { title, academicYear: schedule.year, startDate: activeTerm.start, endDate: dateKey(termEnd), weeks: activeTerm.weeks, current: "Có", notes: estimate ? "Học kỳ tự động tạo theo mốc dự kiến; cần cập nhật theo lịch chính thức của trường." : "Tự động khởi tạo khi học kỳ bắt đầu theo lịch tiến độ đào tạo đã cấu hình." });
    window.dispatchEvent(new CustomEvent("vtn-semester-list-updated", { detail: title }));
  }
  const settings = await settingsService.get();
  if (settings.current_semester !== title) {
    if (!supabase) return;
    const { error } = await supabase.rpc("set_current_semester", { p_name: title });
    if (error) throw error;
    window.dispatchEvent(new CustomEvent("vtn-system-settings-updated", { detail: { ...settings, current_semester: title } }));
  }
}

const planHeaders = ["academicYear", "semester", "week", "date", "subject", "className", "title", "status", "notes"];

function parseCsvLine(line: string, delimiter: string) {
  const cells: string[] = []; let value = ""; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') { value += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { cells.push(value.trim()); value = ""; }
    else value += char;
  }
  cells.push(value.trim()); return cells;
}

function normalizePlanDate(value: string) {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return value;
  const local = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return local ? `${local[3]}-${local[2]}-${local[1]}` : "";
}

function downloadCsvFile(name: string, rows: string[][]) {
  const csv = "\uFEFF" + rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}

export default function TeachingPlanSchedulePage() {
  const [year, setYear] = useState(schedules[2].year);
  const [plans, setPlans] = useState<WorkspaceRecord[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [plansError, setPlansError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WorkspaceRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [importing, setImporting] = useState(false);
  const schedule = useMemo(() => schedules.find((item) => item.year === year) ?? schedules[0], [year]);

  async function loadPlans() {
    setLoadingPlans(true); setPlansError("");
    try { setPlans(await workspaceService.list("teaching-plans")); }
    catch (cause) { setPlansError(cause instanceof Error ? cause.message : "Không thể tải kế hoạch đã tạo."); }
    finally { setLoadingPlans(false); }
  }
  useEffect(() => { void loadPlans(); }, []);

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const academicYear = String(form.get("academicYear") ?? "").trim(); const semester = String(form.get("semester") ?? "").trim();
    const data: Record<string, string> = { academicYear, semester, semesterName: `${semester} - ${academicYear}`, week: String(form.get("week") ?? "").trim(), date: String(form.get("date") ?? "").trim(), subject: String(form.get("subject") ?? "").trim(), className: String(form.get("className") ?? "").trim(), title: String(form.get("title") ?? "").trim(), status: String(form.get("status") ?? "Đã lên kế hoạch").trim(), notes: String(form.get("notes") ?? "").trim() };
    if (!data.title || !data.date || !data.week || !data.academicYear || !data.semester) { setPlansError("Vui lòng điền tiêu đề, năm học, học kỳ, tuần và ngày thực hiện."); return; }
    setSaving(true); setPlansError("");
    try { await workspaceService.save("teaching-plans", data, editing?.id); setFormOpen(false); setEditing(null); setNotice(editing ? "Đã cập nhật kế hoạch." : "Đã tạo kế hoạch giảng dạy."); await loadPlans(); }
    catch (cause) { setPlansError(cause instanceof Error ? cause.message : "Không thể lưu kế hoạch."); }
    finally { setSaving(false); }
  }

  async function importPlans(file: File) {
    setImporting(true); setPlansError(""); setNotice("");
    try {
      const text = (await file.text()).replace(/^\uFEFF/, ""); const lines = text.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) throw new Error("Tệp chưa có dòng kế hoạch. Hãy tải file mẫu CSV và điền dữ liệu trước khi nhập.");
      const delimiter = lines[0].includes("\t") ? "\t" : ","; const headers = parseCsvLine(lines[0], delimiter).map((value) => value.trim());
      const missing = planHeaders.filter((header) => !headers.includes(header));
      if (missing.length) throw new Error(`Thiếu cột bắt buộc của file mẫu: ${missing.join(", ")}.`);
      const records = lines.slice(1).map((line, index) => {
        const cells = parseCsvLine(line, delimiter); const row = Object.fromEntries(headers.map((header, column) => [header, cells[column] ?? ""]));
        if (![row.academicYear, row.semester, row.week, row.date, row.title].every((value) => String(value).trim())) throw new Error(`Dòng ${index + 2}: cần có academicYear, semester, week, date và title.`);
        const normalizedDate = normalizePlanDate(row.date);
        if (!normalizedDate || Number(row.week) < 1 || Number(row.week) > 60) throw new Error(`Dòng ${index + 2}: ngày cần theo DD/MM/YYYY và tuần từ 1 đến 60.`);
        return { academicYear: row.academicYear, semester: row.semester, semesterName: `${row.semester} - ${row.academicYear}`, week: row.week, date: normalizedDate, subject: row.subject, className: row.className, title: row.title, status: row.status || "Đã lên kế hoạch", notes: row.notes };
      });
      for (const record of records) await workspaceService.save("teaching-plans", record);
      setNotice(`Đã nhập ${records.length} kế hoạch từ ${file.name}.`); await loadPlans();
    } catch (cause) { setPlansError(cause instanceof Error ? cause.message : "Không thể nhập tệp kế hoạch."); }
    finally { setImporting(false); }
  }

  function editPlan(record: WorkspaceRecord) {
    setYear(String(record.data.academicYear ?? year));
    setEditing(record);
    setFormOpen(true);
    setPlansError("");
    setNotice("");
  }

  async function trashPlan(record: WorkspaceRecord) {
    if (!window.confirm(`Chuyển kế hoạch “${record.data.title ?? ""}” vào thùng rác?`)) return;
    try { await workspaceService.moveToTrash(record.id); setNotice("Đã chuyển kế hoạch vào thùng rác."); await loadPlans(); }
    catch (cause) { setPlansError(cause instanceof Error ? cause.message : "Không thể chuyển kế hoạch vào thùng rác."); }
  }

  function downloadTemplate() {
    downloadCsvFile("mau-ke-hoach-giang-day.csv", [planHeaders, ["2026–2027", "Học kỳ 1", "1", "05/10/2026", "Tên môn học", "Mã lớp", "Chủ đề / nội dung buổi học", "Đã lên kế hoạch", "Ghi chú"]]);
  }

  function downloadCsv() {
    const rows: string[][] = [planHeaders];
    schedule.terms.forEach((term) => {
      const start = asDate(term.start);
      for (let week = 1; week <= term.weeks; week++) {
        for (let day = 0; day < 7; day++) {
          const date = new Date(start); date.setDate(start.getDate() + (week - 1) * 7 + day);
          const mark = term.marks.find((item) => item.date === dateKey(date));
          const detail = mark?.label ?? (term.examWeeks.includes(week) ? "Tuần thi học kỳ" : "");
          rows.push([schedule.year, term.name, String(week), formatDate(date), "", "", detail, "Lịch tham chiếu", `${weekdays[day]} · ${formatDate(date)}`]);
        }
      }
    });
    plans.filter((plan) => plan.data.academicYear === year).forEach((plan) => rows.push([year, String(plan.data.semester ?? ""), String(plan.data.week ?? ""), String(plan.data.date ?? ""), String(plan.data.title ?? ""), String(plan.data.status ?? ""), String(plan.data.notes ?? "")]));
    downloadCsvFile(`ke-hoach-giang-day-${year.replace("–", "-")}.csv`, rows);
  }

  return <main className="workspace-page teaching-schedule-page">
    <header className="workspace-title-row"><div><div className="workspace-breadcrumb">Đào tạo <span>/</span> Kế hoạch giảng dạy</div><h1>Kế hoạch giảng dạy</h1><p>Lịch tiến độ đào tạo NTTU theo tuần, học kỳ và năm học.</p></div><div className="teaching-schedule-actions"><button type="button" onClick={downloadTemplate}><Download size={16} /> File mẫu</button><label className="teaching-upload-button"><FileUp size={16} />{importing ? "Đang nhập…" : "Nhập kế hoạch"}<input type="file" accept=".csv,text/csv,text/tab-separated-values" disabled={importing} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importPlans(file); event.currentTarget.value = ""; }} /></label><button type="button" onClick={() => { setEditing(null); setFormOpen(true); setPlansError(""); }}><Plus size={16} /> Tạo kế hoạch</button><button type="button" onClick={() => window.print()}><Printer size={16} /> In lịch</button><button type="button" onClick={downloadCsv}><Download size={16} /> Tải CSV</button></div></header>
    {plansError && <div className="workspace-alert" role="alert">{plansError}<button type="button" aria-label="Đóng thông báo" onClick={() => setPlansError("")}><X size={15} /></button></div>}{notice && <div className="workspace-notice" role="status">{notice}</div>}
    {formOpen && <form className="workspace-form teaching-plan-form" onSubmit={savePlan}><div className="workspace-form-head"><h2>{editing ? "Sửa kế hoạch giảng dạy" : "Tạo kế hoạch giảng dạy"}</h2><button type="button" aria-label="Đóng biểu mẫu" onClick={() => { setFormOpen(false); setEditing(null); }}><X size={18} /></button></div><div className="workspace-form-grid"><label>Năm học<select name="academicYear" value={String(editing?.data.academicYear ?? year)} onChange={(event) => setYear(event.target.value)}>{schedules.map((item) => <option key={item.year}>{item.year}</option>)}</select></label><label>Học kỳ<select name="semester" defaultValue={String(editing?.data.semester ?? schedule.terms[0].name)}>{(schedules.find((item) => item.year === String(editing?.data.academicYear ?? year)) ?? schedule).terms.map((term) => <option key={term.name}>{term.name}</option>)}</select></label><label>Tuần<input name="week" type="number" min="1" max="60" defaultValue={String(editing?.data.week ?? 1)} required /></label><label>Ngày thực hiện<input name="date" type="date" defaultValue={String(editing?.data.date ?? "")} required /></label><label>Môn học<input name="subject" defaultValue={String(editing?.data.subject ?? "")} /></label><label>Lớp học phần<input name="className" defaultValue={String(editing?.data.className ?? "")} /></label><label className="workspace-span">Chủ đề / nội dung<input name="title" defaultValue={String(editing?.data.title ?? "")} required /></label><label>Trạng thái<select name="status" defaultValue={String(editing?.data.status ?? "Đã lên kế hoạch")}><option>Đã lên kế hoạch</option><option>Đang thực hiện</option><option>Hoàn thành</option><option>Tạm hoãn</option></select></label><label className="workspace-span">Ghi chú<textarea name="notes" rows={3} defaultValue={String(editing?.data.notes ?? "")} /></label></div><div className="workspace-form-actions"><button className="workspace-primary" disabled={saving}>{saving ? "Đang lưu…" : "Lưu kế hoạch"}</button><button type="button" onClick={() => setFormOpen(false)}>Hủy</button></div></form>}
    <section className="teaching-schedule-toolbar"><div className="teaching-schedule-heading"><span><CalendarDays size={18} /></span><div><strong>Tiến độ đào tạo</strong><small>Tham chiếu lịch năm học chính thức</small></div></div><label>Năm học<select value={year} onChange={(event) => setYear(event.target.value)}>{schedules.map((item) => <option key={item.year}>{item.year}</option>)}</select></label></section>
    <div className="teaching-schedule-legend"><span><i className="exam" /> Thi học kỳ</span><span><i className="holiday" /> Nghỉ lễ / Tết / nghỉ bù</span><span><i className="planned" /> Nghỉ theo kế hoạch</span></div>
    <div className="teaching-term-grid">{schedule.terms.map((term) => {
      const start = asDate(term.start);
      const end = new Date(start); end.setDate(start.getDate() + term.weeks * 7 - 1);
      return <article className="teaching-term-card" key={term.name}>
        <header><div><span>{term.name}</span><strong>{formatDate(start)} – {formatDate(end)}</strong></div><b>{term.weeks} tuần</b></header>
        <div className="teaching-calendar-scroll"><table><thead><tr><th>Tuần</th>{weekdays.map((day) => <th key={day}>{day}</th>)}</tr></thead><tbody>{Array.from({ length: term.weeks }, (_, weekIndex) => {
          const week = weekIndex + 1; const isExam = term.examWeeks.includes(week);
          return <tr key={week} className={isExam ? "exam-week" : ""}><th><span>{String(week).padStart(2, "0")}</span>{isExam && <small>Thi</small>}</th>{weekdays.map((_, day) => {
            const date = new Date(start); date.setDate(start.getDate() + weekIndex * 7 + day);
            const mark = term.marks.find((item) => item.date === dateKey(date));
            const dayPlans = plans.filter((plan) => plan.data.date === dateKey(date));
            return <td key={day} className={mark?.kind ?? ""} title={mark?.label ?? (isExam ? "Tuần thi học kỳ" : `${weekdays[day]}, ${formatDate(date)}`)}><span>{formatDate(date)}</span>{mark && <small>{mark.label}</small>}{dayPlans.map((plan) => <button type="button" className="teaching-plan-event" key={plan.id} title="Chỉnh sửa kế hoạch" onClick={() => editPlan(plan)}>{String(plan.data.title ?? "Kế hoạch")}</button>)}</td>;
          })}</tr>;
        })}</tbody></table></div>
      </article>;
    })}</div>
    <section className="teaching-plans-list"><div className="teaching-plans-list-head"><div><h2>Kế hoạch đã tạo · {year}</h2><p>Các nội dung cá nhân được lưu cùng năm học tương ứng.</p></div><span>{loadingPlans ? "Đang tải…" : `${plans.filter((plan) => plan.data.academicYear === year).length} kế hoạch`}</span></div><div className="workspace-table-wrap"><table><thead><tr><th>NGÀY / TUẦN</th><th>HỌC KỲ</th><th>MÔN / LỚP</th><th>NỘI DUNG</th><th>TRẠNG THÁI</th><th>THAO TÁC</th></tr></thead><tbody>{plans.filter((plan) => plan.data.academicYear === year).map((plan) => <tr key={plan.id}><td>{plan.data.date ? formatDate(asDate(String(plan.data.date))) : "—"} · Tuần {String(plan.data.week ?? "—")}</td><td>{String(plan.data.semester ?? "—")}</td><td>{[plan.data.subject, plan.data.className].filter(Boolean).join(" · ") || "—"}</td><td className="workspace-record-name">{String(plan.data.title ?? "—")}</td><td>{String(plan.data.status ?? "—")}</td><td><div className="workspace-row-actions"><button className="teaching-plan-edit-button" type="button" title="Sửa kế hoạch" aria-label={`Sửa ${plan.data.title ?? "kế hoạch"}`} onClick={() => editPlan(plan)}><Pencil size={15} />Sửa kế hoạch</button><button type="button" title="Chuyển vào thùng rác" aria-label={`Chuyển ${plan.data.title ?? "kế hoạch"} vào thùng rác`} onClick={() => void trashPlan(plan)}><Trash2 size={16} /></button></div></td></tr>)}{!loadingPlans && !plans.filter((plan) => plan.data.academicYear === year).length && <tr><td colSpan={6} className="workspace-state">Chưa có kế hoạch tự tạo cho năm học này.</td></tr>}{loadingPlans && <tr><td colSpan={6} className="workspace-state">Đang tải kế hoạch…</td></tr>}</tbody></table></div></section>
    <p className="teaching-schedule-note">Ngày nghỉ và tuần thi được tô màu theo lịch đính kèm. Đơn vị đào tạo có thể bố trí lịch thi riêng sau khi kết thúc thời gian học phần; lịch nghỉ theo kế hoạch có thể được cập nhật bằng thông báo chính thức.</p>
  </main>;
}
