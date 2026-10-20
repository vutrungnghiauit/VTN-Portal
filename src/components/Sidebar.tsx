import { NavLink } from "react-router-dom";
import { Activity, ArchiveRestore, Bell, BookOpenCheck, CalendarCheck2, CalendarClock, CalendarDays, CalendarRange, CircleHelp, CircleUserRound, ClipboardList, ContactRound, Database, FileStack, Files, GraduationCap, HeartHandshake, KeyRound, LifeBuoy, ListChecks, ListTodo, Megaphone, PanelLeftClose, PanelLeftOpen, PanelsTopLeft, Settings, Shuffle, Sparkles, UsersRound, UserRoundCog, X, type LucideIcon } from "lucide-react";
import { moduleDefinitions } from "../modules/workspace/module-definitions";

const iconByKey: Record<string, LucideIcon> = {
  dashboard: PanelsTopLeft,
  "academic-years": CalendarRange,
  semesters: CalendarDays,
  timetables: CalendarClock,
  "student-records": ContactRound,
  groups: UsersRound,
  "teaching-plans": BookOpenCheck,
  calendar: CalendarCheck2,
  grades: GraduationCap,
  assignments: ClipboardList,
  tasks: ListTodo,
  "student-support": HeartHandshake,
  documents: Files,
  surveys: ListChecks,
  notifications: Bell,
  announcements: Megaphone,
  supports: LifeBuoy,
  "academic-ai": Sparkles,
  "forms-templates": FileStack,
  "random-picker": Shuffle,
  "my-profile": CircleUserRound,
  accounts: UserRoundCog,
  permissions: KeyRound,
  "audit-logs": Activity,
  backup: Database,
  trash: ArchiveRestore,
  settings: Settings,
};
const iconFor = (key: string) => iconByKey[key] ?? CircleHelp;
const groups = ["Chung", "Đào tạo", "Theo dõi", "Tài nguyên", "Học Vụ & Quản Trị", "Công cụ", "Tài khoản", "Quản trị"];

export default function Sidebar({ open = false, collapsed = false, onClose, onToggleCollapse, allowedModules, facultyLabel }: { open?: boolean; collapsed?: boolean; onClose?: () => void; onToggleCollapse?: () => void; allowedModules: string[]; facultyLabel: string }) {
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return <><button className={`app-sidebar-scrim ${open ? "is-open" : ""}`} aria-label="Đóng menu" onClick={onClose} /><aside className={`app-sidebar ${open ? "is-open" : ""} ${collapsed ? "is-collapsed" : ""}`}><div className="app-sidebar-brand"><span className="app-logo"><GraduationCap size={21} /></span><span className="app-sidebar-brand-label">VTN PORTAL<small>Cổng thông tin Vũ Trung Nghĩa</small></span><button type="button" className="app-sidebar-collapse" onClick={onToggleCollapse} aria-label={collapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"} title={collapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"}><CollapseIcon size={18} /></button><button type="button" className="app-sidebar-close" onClick={onClose} aria-label="Đóng menu"><X size={18} /></button></div><nav>{groups.map((group) => { const entries = moduleDefinitions.filter((item) => item.group === group && allowedModules.includes(item.key)); return entries.length ? <div className="app-nav-group" key={group}><div className="app-nav-heading">{group}</div>{entries.map((item) => { const Icon = iconFor(item.key); return <NavLink key={item.key} to={item.path} end={item.key === "dashboard"} onClick={onClose} title={item.title} aria-label={item.title} className={({ isActive }) => `app-nav-link ${isActive ? "active" : ""}`}><Icon size={18} aria-hidden="true" /><span>{item.title}</span></NavLink>; })}</div> : null; })}</nav><div className="app-sidebar-foot">{facultyLabel}</div></aside></>;
}
