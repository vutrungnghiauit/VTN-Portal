import { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";

export default function MainLayout({ email, role, facultyLabel, allowedModules, onSignOut }: { email: string; role: string; facultyLabel: string; allowedModules: string[]; onSignOut: () => void }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("vtn-sidebar-collapsed") === "true");
  function toggleSidebar() {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      localStorage.setItem("vtn-sidebar-collapsed", String(next));
      return next;
    });
  }
  return <div className={`app-shell ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}><Sidebar allowedModules={allowedModules} facultyLabel={facultyLabel} open={sidebarOpen} collapsed={sidebarCollapsed} onToggleCollapse={toggleSidebar} onClose={() => setSidebarOpen(false)} /><div className="app-main"><Header email={email} role={role} onMenu={() => setSidebarOpen(true)} onSignOut={onSignOut} /><main className="app-content"><Outlet /></main><footer className="app-footer">NTTU · {facultyLabel} <span>•</span> Cổng quản lý đào tạo</footer></div></div>;
}
