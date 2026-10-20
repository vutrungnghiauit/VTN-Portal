import { useEffect, useState } from "react";
import { BellRing, LogOut, Menu, UserRound, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { moduleDefinitions } from "../modules/workspace/module-definitions";
import NotificationBell from "../modules/notifications/NotificationBell";
import { usePushNotifications } from "../hooks/useSystemPushNotifications";
import { workspaceService } from "../modules/workspace/workspace.service";
import { settingsService } from "../modules/settings/settings.service";
import { groupSemestersByAcademicYear, normalizeSemesterName, semesterIdentity } from "../lib/semester-groups";
import { studentService } from "../modules/students/student.service";

const roleLabels: Record<string, string> = { super_admin: "Super Admin", system_admin: "System Admin", sub_admin: "Sub Admin", teacher: "Giảng viên", assistant: "Trợ giảng", class_president: "Lớp trưởng", class_vice: "Lớp phó", student: "Sinh viên" };

export default function Header({ email, role, onMenu, onSignOut }: { email: string; role: string; onMenu: () => void; onSignOut: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [semester, setSemester] = useState(() => { const saved = localStorage.getItem("vtn-active-semester") || "all"; return saved === "all" ? saved : normalizeSemesterName(saved); });
  const [semesters, setSemesters] = useState<string[]>([]);
  const [currentSemester, setCurrentSemester] = useState("");
  const location = useLocation();
  const title = moduleDefinitions.find((item) => item.path === location.pathname)?.title ?? "Tổng quan";
  const push = usePushNotifications(["teacher", "assistant", "super_admin", "system_admin", "sub_admin"].includes(role), role);
  const semesterGroups = groupSemestersByAcademicYear(semesters);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void Promise.all([workspaceService.list("semesters"), settingsService.get(), studentService.list(), workspaceService.allRecords()]).then(([rows, settings, students, records]) => {
        if (!active) return;
        const current = normalizeSemesterName(String(settings.current_semester ?? ""));
        setCurrentSemester(current);
        const rawNames = [...rows.map((row) => String(row.data.title ?? "")), ...students.map((student) => student.semesterName), ...records.filter((record) => record.module_key === "calendar" || record.module_key === "timetables").map((record) => String(record.data.semesterName ?? record.data.semester ?? record.data.round ?? "")), String(settings.current_semester ?? "")];
        const uniqueNames = new Map<string, string>();
        for (const rawName of rawNames) {
          const name = normalizeSemesterName(rawName);
          if (name && !uniqueNames.has(semesterIdentity(name))) uniqueNames.set(semesterIdentity(name), name);
        }
        const names = [...uniqueNames.values()].sort((a, b) => b.localeCompare(a, "vi", { numeric: true }));
        setSemesters(names);
      }).catch(() => undefined);
    };
    const selected = (event: Event) => { const value = (event as CustomEvent<string>).detail || "all"; setSemester(value === "all" ? value : normalizeSemesterName(value)); };
    const storageChanged = (event: StorageEvent) => { if (event.key === "vtn-active-semester") { const value = event.newValue || "all"; setSemester(value === "all" ? value : normalizeSemesterName(value)); } };
    refresh();
    window.addEventListener("vtn-semester-list-updated", refresh);
    window.addEventListener("vtn-semester-options-updated", refresh);
    window.addEventListener("vtn-students-updated", refresh);
    window.addEventListener("vtn-system-settings-updated", refresh);
    window.addEventListener("vtn-semester-filter-changed", selected);
    window.addEventListener("storage", storageChanged);
    return () => { active = false; window.removeEventListener("vtn-semester-list-updated", refresh); window.removeEventListener("vtn-semester-options-updated", refresh); window.removeEventListener("vtn-students-updated", refresh); window.removeEventListener("vtn-system-settings-updated", refresh); window.removeEventListener("vtn-semester-filter-changed", selected); window.removeEventListener("storage", storageChanged); };
  }, []);

  function changeSemester(value: string) {
    const normalizedValue = value === "all" ? value : normalizeSemesterName(value);
    setSemester(normalizedValue);
    localStorage.setItem("vtn-active-semester", normalizedValue);
    window.dispatchEvent(new CustomEvent("vtn-semester-filter-changed", { detail: normalizedValue }));
  }

  return <>
    <header className="app-topbar">
      <button className="app-menu-button" onClick={onMenu} aria-label="Mở điều hướng"><Menu size={20} /></button>
      <div className="app-topbar-title">{title}</div><div className="app-topbar-spacer" />
      <label className="app-semester-filter"><span>Học kỳ</span><select value={semester} onChange={(event) => changeSemester(event.target.value)}><option value="all">Tất cả học kỳ</option>{semesterGroups.map((group) => <optgroup key={group.academicYear} label={group.academicYear === "Khác" ? "Năm học chưa xác định" : `Năm học ${group.academicYear}`}>{group.semesters.map((name) => <option key={name} value={name}>{name}{currentSemester && semesterIdentity(name) === semesterIdentity(currentSemester) ? " · Hiện hành" : ""}</option>)}</optgroup>)}</select></label>
      {push.permission === "default" && <button type="button" className="system-push-enable" onClick={() => void push.requestPermission()}><BellRing size={14} /> Bật thông báo</button>}
      <NotificationBell />
      <div className="app-user-menu"><button className="app-user-trigger" onClick={() => setMenuOpen((open) => !open)}><span className="app-avatar"><UserRound size={16} /></span><span className="app-user-ident"><span className="app-user-email">{email}</span><small>{roleLabels[role] ?? role}</small></span></button>{menuOpen && <div className="app-user-popover"><Link to="/my-profile" onClick={() => setMenuOpen(false)}><UserRound size={15} /> Hồ sơ của tôi</Link><button onClick={onSignOut}><LogOut size={15} /> Đăng xuất</button></div>}</div>
    </header>
    {push.toast && <aside className="system-push-toast" role="status" aria-live="polite">
      <div className="system-push-toast-heading"><BellRing size={17} /><strong>Phiếu hỗ trợ mới</strong><button type="button" aria-label="Đóng thông báo" onClick={push.dismiss}><X size={16} /></button></div>
      <p className="system-push-ticket-code">{push.toast.code} · {push.toast.studentName} · {push.toast.className}</p>
      <strong className="system-push-ticket-title">{push.toast.title}</strong>
      <p className="system-push-ticket-summary">{push.toast.summary}</p>
      <Link to="/supports" onClick={push.dismiss}>Xem ngay</Link>
    </aside>}
  </>;
}
