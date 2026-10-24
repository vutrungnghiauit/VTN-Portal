import { Link, NavLink, useLocation } from "react-router-dom";
import { Activity, ArchiveRestore, Bell, BookOpenCheck, CalendarCheck2, CalendarClock, CalendarDays, CalendarRange, CircleHelp, CircleUserRound, ClipboardCheck, ClipboardList, ContactRound, Database, FileStack, Files, GraduationCap, HeartHandshake, KeyRound, LifeBuoy, ListChecks, ListTodo, Megaphone, PanelLeftClose, PanelLeftOpen, PanelsTopLeft, Settings, Shuffle, Sparkles, UsersRound, UserRoundCog, X, type LucideIcon } from "lucide-react";
import { moduleDefinitions } from "../modules/workspace/module-definitions";

const iconByKey: Record<string, LucideIcon> = {
  dashboard: PanelsTopLeft,
  "academic-years": CalendarRange,
  semesters: CalendarDays,
  timetables: CalendarClock,
  "student-records": ContactRound,
  "course-sections": BookOpenCheck,
  "academic-advisors": UserRoundCog,
  groups: UsersRound,
  "teaching-plans": BookOpenCheck,
  calendar: CalendarCheck2,
  grades: GraduationCap,
  assignments: ClipboardList,
  tasks: ListTodo,
  "student-support": HeartHandshake,
  documents: Files,
  surveys: ListChecks,
  "survey-participation": ClipboardCheck,
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
  "source-data": Database,
  trash: ArchiveRestore,
  settings: Settings,
};
const iconFor = (key: string) => iconByKey[key] ?? CircleHelp;
const preferredGroups = ["Chung", "Đào tạo", "Học vụ", "Hỗ trợ", "Mục khác", "Quản trị"];
const groups = [
  ...preferredGroups.filter((group) => moduleDefinitions.some((item) => item.group === group)),
  ...[...new Set(moduleDefinitions.map((item) => item.group))].filter((group) => !preferredGroups.includes(group)),
];
const moduleOrderByGroup: Record<string, string[]> = {
  Chung: ["dashboard", "my-profile"],
  "Đào tạo": ["teaching-plans", "academic-years", "semesters", "timetables", "calendar", "tasks"],
  "Học vụ": ["student-records", "course-sections", "academic-advisors", "grades", "assignments", "groups", "academic-ai", "random-picker", "survey-participation", "surveys"],
  "Hỗ trợ": ["student-support", "supports", "forms-templates", "documents"],
  "Mục khác": [],
  "Quản trị": ["notifications", "announcements", "settings", "source-data", "accounts", "permissions", "audit-logs", "backup", "trash"],
};

export default function Sidebar({ open = false, collapsed = false, onClose, onToggleCollapse, onRefresh, allowedModules }: { open?: boolean; collapsed?: boolean; onClose?: () => void; onToggleCollapse?: () => void; onRefresh?: () => void; allowedModules: string[] }) {
  const location = useLocation();
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  function handleMenuClick(path: string) {
    onClose?.();
    if (location.pathname === path) onRefresh?.();
  }
  return <><button className={`app-sidebar-scrim ${open ? "is-open" : ""}`} aria-label="Đóng menu" onClick={onClose} /><aside className={`app-sidebar ${open ? "is-open" : ""} ${collapsed ? "is-collapsed" : ""}`}><div className="app-sidebar-brand"><Link to="/" className="app-sidebar-home" aria-label="Về trang Tổng quan" onClick={() => handleMenuClick("/")}><span className="app-logo"><GraduationCap size={21} /></span><span className="app-sidebar-brand-label">VTN PORTAL<small>Cổng thông tin Vũ Trung Nghĩa</small></span></Link><button type="button" className="app-sidebar-collapse" onClick={onToggleCollapse} aria-label={collapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"} title={collapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"}><CollapseIcon size={18} /></button><button type="button" className="app-sidebar-close" onClick={onClose} aria-label="Đóng menu"><X size={18} /></button></div><nav>{groups.map((group) => { const order = moduleOrderByGroup[group] ?? []; const entries = moduleDefinitions.filter((item) => item.group === group && allowedModules.includes(item.key)).sort((left, right) => { const leftIndex = order.indexOf(left.key); const rightIndex = order.indexOf(right.key); return (leftIndex < 0 ? order.length : leftIndex) - (rightIndex < 0 ? order.length : rightIndex); }); return entries.length ? <div className="app-nav-group" key={group}><div className="app-nav-heading">{group}</div>{entries.map((item) => { const Icon = iconFor(item.key); return <NavLink key={item.key} to={item.path} end={item.key === "dashboard"} onClick={() => handleMenuClick(item.path)} title={item.title} aria-label={item.title} className={({ isActive }) => `app-nav-link ${isActive ? "active" : ""}`}><Icon size={18} aria-hidden="true" /><span>{item.title}</span></NavLink>; })}</div> : null; })}</nav><div className="app-sidebar-foot"><strong>Cổng thông tin Vũ Trung Nghĩa</strong></div></aside></>;
}
