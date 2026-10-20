import { useEffect, useMemo, useRef, useState } from "react";
import { BellRing, ChevronDown, LogOut, Menu, Minus, Monitor, Plus, Smartphone, Tablet, Type, UserRound, X } from "lucide-react";
import { Link } from "react-router-dom";
import NotificationBell from "../modules/notifications/NotificationBell";
import { usePushNotifications } from "../hooks/useSystemPushNotifications";
import { workspaceService, type WorkspaceRecord } from "../modules/workspace/workspace.service";
import { buildSemesterDateCatalog, getTeachingEventsOnDate } from "../modules/workspace/TeachingWeekCalendar";
import { buildTimetableRows, toTimetableWeekRecords } from "../modules/timetable/timetable-week-data";
import { solarToVietnameseLunar, vietnameseLunarYearName } from "../lib/vietnamese-lunar-date";

const roleLabels: Record<string, string> = { super_admin: "Super Admin", system_admin: "System Admin", sub_admin: "Sub Admin", teacher: "Giảng viên", assistant: "Trợ giảng", class_president: "Lớp trưởng", class_vice: "Lớp phó", student: "Sinh viên" };
const greetings = [
  "Chúc bạn một ngày làm việc hiệu quả và thuận lợi!",
  "Chúc bạn luôn tràn đầy năng lượng và đạt nhiều kết quả tốt!",
  "Chúc bạn một ngày học tập, giảng dạy thật suôn sẻ!",
  "Chúc bạn nhiều niềm vui và hoàn thành tốt mọi kế hoạch hôm nay!",
  "Chúc bạn một ngày mới bình an, tích cực và thành công!",
];
const vietnamDateKey = (date: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).format(date);
const dateFromKey = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
};
const weekdays = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
const dayLabel = (date: Date) => weekdays[date.getDay()];
const shiftLabels = ["Sáng", "Chiều", "Tối"];
type ViewMode = "web" | "tablet" | "mobile";
const FONT_SCALE_SETTINGS_VERSION = "2";
const viewModes: Array<{ key: ViewMode; label: string; Icon: typeof Monitor }> = [
  { key: "web", label: "Web", Icon: Monitor },
  { key: "tablet", label: "Tablet", Icon: Tablet },
  { key: "mobile", label: "Mobile", Icon: Smartphone },
];
function savedViewMode(): ViewMode {
  const value = localStorage.getItem("vtn-view-mode");
  return value === "tablet" || value === "mobile" ? value : "web";
}
function savedFontScale() {
  if (localStorage.getItem("vtn-font-scale-version") !== FONT_SCALE_SETTINGS_VERSION) {
    localStorage.setItem("vtn-font-scale", "100");
    localStorage.setItem("vtn-font-scale-version", FONT_SCALE_SETTINGS_VERSION);
    return 100;
  }
  const savedValue = localStorage.getItem("vtn-font-scale");
  if (savedValue === null || savedValue.trim() === "") return 100;
  const value = Number(savedValue);
  return Number.isFinite(value) ? Math.min(140, Math.max(80, Math.round(value / 10) * 10)) : 100;
}

export default function Header({ email, role, canViewTimetable, onMenu, onSignOut }: { email: string; role: string; canViewTimetable: boolean; onMenu: () => void; onSignOut: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(savedViewMode);
  const [fontScale, setFontScale] = useState(savedFontScale);
  const [viewModeOpen, setViewModeOpen] = useState(false);
  const [fontScaleOpen, setFontScaleOpen] = useState(false);
  const viewControlsRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [timetableRows, setTimetableRows] = useState<WorkspaceRecord[]>([]);
  const [semesterRows, setSemesterRows] = useState<WorkspaceRecord[]>([]);
  const [progressRows, setProgressRows] = useState<WorkspaceRecord[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(canViewTimetable);
  const [greeting] = useState(() => greetings[Math.floor(Math.random() * greetings.length)]);
  const SelectedViewIcon = viewModes.find((mode) => mode.key === viewMode)?.Icon ?? Monitor;
  const push = usePushNotifications(["teacher", "assistant", "super_admin", "system_admin", "sub_admin"].includes(role), role);
  const todayKey = vietnamDateKey(now);
  const [todayYear, todayMonth, todayDay] = todayKey.split("-").map(Number);
  const todayDate = useMemo(() => dateFromKey(todayKey), [todayKey]);
  const lunarDate = useMemo(() => {
    const [year, month, day] = todayKey.split("-").map(Number);
    return solarToVietnameseLunar(day, month, year);
  }, [todayKey]);
  const lunarYearName = vietnameseLunarYearName(lunarDate.year);
  const semesterDateCatalog = useMemo(() => buildSemesterDateCatalog(semesterRows, progressRows), [semesterRows, progressRows]);
  const todayLessons = useMemo(() => getTeachingEventsOnDate(timetableRows, todayDate, semesterDateCatalog).filter((event) => event.type !== "cancelled"), [timetableRows, todayDate, semesterDateCatalog]);
  const timeLabel = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now);
  const dateLabel = `Ngày ${todayDay} Tháng ${todayMonth} Năm ${todayYear}`;

  useEffect(() => {
    document.documentElement.dataset.viewMode = viewMode;
    localStorage.setItem("vtn-view-mode", viewMode);
  }, [viewMode]);

  useEffect(() => {
    document.documentElement.dataset.fontScale = String(fontScale);
    document.documentElement.style.setProperty("--app-font-zoom", String(fontScale / 100));
    localStorage.setItem("vtn-font-scale", String(fontScale));
  }, [fontScale]);

  useEffect(() => {
    const closeControls = (event: PointerEvent) => {
      if (!viewControlsRef.current?.contains(event.target as Node)) {
        setViewModeOpen(false);
        setFontScaleOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setViewModeOpen(false); setFontScaleOpen(false); }
    };
    document.addEventListener("pointerdown", closeControls);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeControls);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!canViewTimetable) { setScheduleLoading(false); return; }
    let active = true;
    let loading = false;
    const refreshSchedule = async () => {
      if (loading) return;
      loading = true;
      try {
        const [timetablesResult, semestersResult, progressResult] = await Promise.allSettled([
          workspaceService.list("timetables"),
          workspaceService.list("semesters"),
          workspaceService.list("teaching-plan-schedules"),
        ]);
        if (timetablesResult.status === "rejected") throw timetablesResult.reason;
        if (!active) return;
        setTimetableRows(toTimetableWeekRecords(buildTimetableRows(timetablesResult.value)));
        setSemesterRows(semestersResult.status === "fulfilled" ? semestersResult.value : []);
        setProgressRows(progressResult.status === "fulfilled" ? progressResult.value : []);
      } catch {
        if (active) { setTimetableRows([]); setSemesterRows([]); setProgressRows([]); }
      } finally {
        loading = false;
        if (active) setScheduleLoading(false);
      }
    };
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void refreshSchedule(); };
    void refreshSchedule();
    const refreshTimer = window.setInterval(() => void refreshSchedule(), 5 * 60 * 1000);
    window.addEventListener("vtn-timetable-list-updated", refreshWhenVisible);
    window.addEventListener("vtn-semester-list-updated", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      window.removeEventListener("vtn-timetable-list-updated", refreshWhenVisible);
      window.removeEventListener("vtn-semester-list-updated", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [canViewTimetable]);

  return <>
    <div className="app-header-shell">
      <header className="app-topbar">
        <button className="app-menu-button" onClick={onMenu} aria-label="Mở điều hướng"><Menu size={20} /></button>
        <section className="app-header-briefing" aria-label="Daily overview">
          <div className="app-header-briefing-meta">
            <div className="app-header-briefing-row"><strong>{timeLabel}, {dayLabel(todayDate)}, {dateLabel}</strong> ({lunarDate.day}/{lunarDate.month}{lunarDate.isLeapMonth ? " nhuận" : ""} Năm {lunarYearName})</div>
            <div className="app-header-briefing-row app-header-greeting">{greeting}</div>
          </div>
          <div className="app-header-briefing-agenda">
            <div className="app-header-briefing-row app-header-agenda"><strong>Công việc hôm nay:</strong><div className="app-header-agenda-items">{!canViewTimetable ? <span>Chưa được cấp quyền xem thời khóa biểu.</span> : scheduleLoading ? <span>Đang tải lịch dạy…</span> : todayLessons.length ? todayLessons.map((event) => {
          const data = event.record.data;
          const title = String(data.title ?? data.subjectName ?? data.courseName ?? "Môn học");
          const room = String(data.room ?? "").trim() || "Chưa cập nhật";
          const periodText = event.startPeriod ? `Tiết ${event.startPeriod}${event.endPeriod && event.endPeriod !== event.startPeriod ? `-${event.endPeriod}` : ""}` : "Chưa cập nhật tiết";
          return <p className="app-header-agenda-item" key={event.id}><span>{shiftLabels[event.shift]}:</span> {title}<i>•</i> {periodText}<i>•</i> Phòng {room}</p>;
        }) : <span>Không có lịch dạy hôm nay.</span>}</div></div>
          </div>
        </section>
        <div className="app-view-controls" ref={viewControlsRef}>
          <div className="app-view-control">
            <button type="button" className="app-view-control-trigger" aria-label={`Chế độ xem: ${viewModes.find((mode) => mode.key === viewMode)?.label ?? "Web"}`} aria-haspopup="menu" aria-expanded={viewModeOpen} onClick={() => { setViewModeOpen((open) => !open); setFontScaleOpen(false); }}><SelectedViewIcon size={17} /><span className="app-view-control-label">Chế độ xem</span><ChevronDown size={15} /></button>
            {viewModeOpen && <div className="app-view-mode-menu" role="menu" aria-label="Chọn chế độ xem">{viewModes.map(({ key, label, Icon }) => <button type="button" role="menuitemradio" aria-checked={viewMode === key} className={viewMode === key ? "is-selected" : ""} key={key} onClick={() => { setViewMode(key); setViewModeOpen(false); }}><Icon size={17} />{label}</button>)}</div>}
          </div>
          <div className="app-view-control">
            <button type="button" className="app-view-control-trigger" aria-label="Cỡ chữ" aria-haspopup="dialog" aria-expanded={fontScaleOpen} onClick={() => { setFontScaleOpen((open) => !open); setViewModeOpen(false); }}><Type size={17} /><span className="app-view-control-label">Cỡ chữ</span></button>
            {fontScaleOpen && <div className="app-font-scale-menu" role="dialog" aria-label="Điều chỉnh cỡ chữ"><div className="app-font-scale-heading"><strong>Cỡ chữ</strong><span>{fontScale}%</span></div><div className="app-font-scale-controls"><button type="button" aria-label="Giảm cỡ chữ" disabled={fontScale <= 80} onClick={() => setFontScale((size) => Math.max(80, size - 10))}><Minus size={17} /></button><input type="range" min="80" max="140" step="10" aria-label="Cỡ chữ phần trăm" value={fontScale} onChange={(event) => setFontScale(Number(event.target.value))} /><button type="button" aria-label="Tăng cỡ chữ" disabled={fontScale >= 140} onClick={() => setFontScale((size) => Math.min(140, size + 10))}><Plus size={17} /></button></div></div>}
          </div>
        </div>
        {push.permission === "default" && <button type="button" className="system-push-enable" onClick={() => void push.requestPermission()}><BellRing size={14} /> Bật thông báo</button>}
        <NotificationBell />
        <div className="app-user-menu"><button className="app-user-trigger" onClick={() => setMenuOpen((open) => !open)}><span className="app-avatar"><UserRound size={16} /></span><span className="app-user-ident"><span className="app-user-email">{email}</span><small>{roleLabels[role] ?? role}</small></span></button>{menuOpen && <div className="app-user-popover"><Link to="/my-profile" onClick={() => setMenuOpen(false)}><UserRound size={15} /> Hồ sơ của tôi</Link><button onClick={onSignOut}><LogOut size={15} /> Đăng xuất</button></div>}</div>
      </header>

    </div>
    {push.toast && <aside className="system-push-toast" role="status" aria-live="polite">
      <div className="system-push-toast-heading"><BellRing size={17} /><strong>Phiếu hỗ trợ mới</strong><button type="button" aria-label="Đóng thông báo" onClick={push.dismiss}><X size={16} /></button></div>
      <p className="system-push-ticket-code">{push.toast.code} · {push.toast.studentName} · {push.toast.className}</p>
      <strong className="system-push-ticket-title">{push.toast.title}</strong>
      <p className="system-push-ticket-summary">{push.toast.summary}</p>
      <Link to="/supports" onClick={push.dismiss}>Xem ngay</Link>
    </aside>}
  </>;
}
