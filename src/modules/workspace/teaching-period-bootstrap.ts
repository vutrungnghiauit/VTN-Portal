import { supabase } from "../../lib/supabase";
import { settingsService } from "../settings/settings.service";
import { workspaceService } from "./workspace.service";
import { estimatedSchedule, schedules } from "./teaching-plan-schedule-data";

const asDate = (iso: string) => new Date(`${iso}T00:00:00`);
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

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
  if (!years.some((row) => row.data.title === schedule.year)) {
    await workspaceService.save("academic-years", { title: schedule.year, startDate: current.start, endDate: current.end, status: "Đang áp dụng", notes: estimate ? "Năm học tự động khởi tạo theo mốc dự kiến (thứ Hai đầu tiên của tháng 10); cần đối chiếu thông báo chính thức." : "Tự động khởi tạo theo lịch tiến độ đào tạo đã cấu hình." });
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
