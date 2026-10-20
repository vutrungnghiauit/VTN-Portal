import { Suspense, useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";

export default function MainLayout({ email, role, facultyLabel, allowedModules, onSignOut }: { email: string; role: string; facultyLabel: string; allowedModules: string[]; onSignOut: () => void }) {
  void facultyLabel;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("vtn-sidebar-collapsed") === "true");
  const [outletRefreshKey, setOutletRefreshKey] = useState(0);
  function toggleSidebar() {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      localStorage.setItem("vtn-sidebar-collapsed", String(next));
      return next;
    });
  }
  return <div className={`app-shell ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}><Sidebar allowedModules={allowedModules} onRefresh={() => setOutletRefreshKey((key) => key + 1)} open={sidebarOpen} collapsed={sidebarCollapsed} onToggleCollapse={toggleSidebar} onClose={() => setSidebarOpen(false)} /><div className="app-main"><Header email={email} role={role} canViewTimetable={allowedModules.includes("timetables")} onMenu={() => setSidebarOpen(true)} onSignOut={onSignOut} /><main className="app-content"><Suspense fallback={<section className="workspace-page"><div className="workspace-state">Đang tải chức năng…</div></section>}><Outlet key={outletRefreshKey} /></Suspense></main><footer className="app-footer"><strong>VTN PORTAL • Cổng thông tin Vũ Trung Nghĩa</strong></footer></div></div>;
}
