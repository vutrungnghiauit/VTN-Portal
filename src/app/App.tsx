import { lazy, useEffect, useState, type FormEvent } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { GraduationCap } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import MainLayout from "../layouts/MainLayout";
import { moduleDefinitions } from "../modules/workspace/module-definitions";
import { settingsService } from "../modules/settings/settings.service";
import { ensureCurrentAcademicPeriods } from "../modules/workspace/teaching-period-bootstrap";
const StudentListPage = lazy(() => import("../modules/students/pages/StudentListPage"));
const WorkspaceModulePage = lazy(() => import("../modules/workspace/WorkspaceModulePage"));
const SystemModulePage = lazy(() => import("../modules/workspace/SystemModulePage"));
const NotificationsPage = lazy(() => import("../modules/notifications/NotificationsPage"));
const SupportTicketsPage = lazy(() => import("../modules/support-tickets/SupportTicketsPage"));
const StudentSupportPage = lazy(() => import("../modules/student-support/StudentSupportPage"));
const TeachingPlanSchedulePage = lazy(() => import("../modules/workspace/TeachingPlanSchedulePage"));
const AcademicAIPage = lazy(() => import("../modules/academic-ai/AcademicAIPage"));
const AccountsManagementPage = lazy(() => import("../modules/accounts/AccountsManagementPage"));
const StudyGroupsPage = lazy(() => import("../modules/workspace/StudyGroupsPage"));
const RandomPickerPage = lazy(() => import("../modules/workspace/RandomPickerPage"));
const TimetablePage = lazy(() => import("../modules/timetable/TimetablePage"));
const SourceDataPage = lazy(() => import("../modules/source-data/SourceDataPage"));
const SurveysPage = lazy(() => import("../modules/surveys/SurveysPage"));
import { signInWithIdentifier } from "../lib/auth-login";
const PermissionsPage = lazy(() => import("../modules/accounts/pages/PermissionsPage"));
import { permissionResources, resourcePermissionKeys } from "../modules/accounts/permission-catalog";

function SignInPage() {
  const [email, setEmail] = useState(""); const [identifier, setIdentifier] = useState(""); const [password, setPassword] = useState(""); const [fullName, setFullName] = useState(""); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false); const [resetMode, setResetMode] = useState(false); const [registerMode, setRegisterMode] = useState(false); const [registrationEnabled, setRegistrationEnabled] = useState(false);
  useEffect(() => { let active = true; void supabase?.rpc("get_registration_settings").then(({ data }) => { if (active) setRegistrationEnabled(Boolean(data?.enabled)); }); return () => { active = false; }; }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return;
    setBusy(true); setError(""); setNotice("");
    if (resetMode) {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
      if (resetError) setError(resetError.message); else setNotice("Đã gửi liên kết đặt lại mật khẩu nếu email tồn tại trong hệ thống.");
    } else if (registerMode) {
      const { data, error: registerError } = await supabase.functions.invoke("swift-api", { body: { action: "register", email: email.trim(), name: fullName.trim() } });
      if (registerError) setError(registerError.message); else if (data?.error) setError(data.error); else setNotice(data?.message ?? "Đã gửi email xác nhận đăng ký.");
    } else {
      try { await signInWithIdentifier(identifier, password); }
      catch (loginError) { setError(loginError instanceof Error ? loginError.message : "Tên người dùng/MSSV hoặc mật khẩu không chính xác."); }
    }
    setBusy(false);
  }
  return <main className="auth-screen"><form className="auth-card" onSubmit={submit}><span className="auth-logo"><GraduationCap size={25} /></span><p className="auth-eyebrow">VTN PORTAL - Cổng thông tin Vũ Trung Nghĩa</p><h1 className={!resetMode && !registerMode ? "auth-login-title" : undefined}>{resetMode ? "Đặt lại mật khẩu" : registerMode ? "Đăng ký sinh viên" : "Đăng nhập"}</h1><p className="auth-subtitle">{resetMode ? "Nhập email để nhận hướng dẫn đặt lại mật khẩu." : registerMode ? "Tạo hồ sơ Sinh viên bằng email trường hoặc email cá nhân." : "Bạn có thể dùng tên đăng nhập, MSSV hoặc email."}</p>{!isSupabaseConfigured && <div className="auth-error">Chưa cấu hình Supabase. Kiểm tra .env.local rồi khởi động lại ứng dụng.</div>}{error && <div className="auth-error" role="alert">{error}</div>}{notice && <div className="auth-notice" role="status">{notice}</div>}{registerMode && <label>Họ và tên<input autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} required maxLength={120} /></label>}{resetMode || registerMode ? <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label> : <label>Tên đăng nhập hoặc MSSV<input type="text" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required /></label>}{!resetMode && !registerMode && <label>Mật khẩu<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>}{registerMode && <label>Vai trò đăng ký<select value="student" disabled><option value="student">Sinh viên</option></select></label>}<button className="auth-submit" disabled={busy || !isSupabaseConfigured}>{busy ? "Đang xử lý…" : resetMode ? "Gửi liên kết" : registerMode ? "Gửi đăng ký qua email" : "Đăng nhập"}</button><button className="auth-link" type="button" onClick={() => { setResetMode((value) => !value); setRegisterMode(false); setError(""); setNotice(""); }}>{resetMode ? "Quay lại đăng nhập" : "Quên mật khẩu?"}</button>{!resetMode && registrationEnabled && <button className="auth-link" type="button" onClick={() => { setRegisterMode((value) => !value); setError(""); setNotice(""); }}>{registerMode ? "Đã có tài khoản? Đăng nhập" : "Đăng ký tài khoản mới"}</button>}</form></main>;
}

function ResetPasswordPage() {
  const [password, setPassword] = useState(""); const [repeat, setRepeat] = useState(""); const [error, setError] = useState(""); const [complete, setComplete] = useState(false); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (password.length < 8) { setError("Mật khẩu cần có ít nhất 8 ký tự."); return; }
    if (password !== repeat) { setError("Hai mật khẩu chưa khớp."); return; }
    if (!supabase) return;
    setBusy(true); const { error: updateError } = await supabase.auth.updateUser({ password }); setBusy(false);
    if (updateError) setError(updateError.message); else setComplete(true);
  }
  return <main className="auth-screen"><form className="auth-card" onSubmit={submit}><span className="auth-logo"><GraduationCap size={25} /></span><p className="auth-eyebrow">VTN PORTAL</p><h1>Đặt mật khẩu mới</h1>{complete ? <><p className="auth-subtitle">Đã cập nhật mật khẩu. Bạn có thể tiếp tục vào hệ thống.</p><button className="auth-submit" type="button" onClick={() => window.location.assign("/")}>Tiếp tục</button></> : <><p className="auth-subtitle">Chọn mật khẩu mới cho tài khoản của bạn.</p>{error && <div className="auth-error" role="alert">{error}</div>}<label>Mật khẩu mới<input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label><label>Nhập lại mật khẩu<input type="password" autoComplete="new-password" minLength={8} value={repeat} onChange={(event) => setRepeat(event.target.value)} required /></label><button className="auth-submit" disabled={busy}>{busy ? "Đang cập nhật…" : "Cập nhật mật khẩu"}</button></>}</form></main>;
}

function AuthenticatedApp({ session }: { session: Session }) {
  async function signOut() { await supabase?.auth.signOut(); }
  const [access, setAccess] = useState<{ role: string; superAdmin: boolean; permissions: Record<string, Record<string, boolean>> }>();
  const [accessError, setAccessError] = useState("");
  const [facultyLabel, setFacultyLabel] = useState("Khoa Quản trị kinh doanh");
  useEffect(() => {
    let active = true;
    void supabase?.rpc("get_my_access_matrix").then(({ data, error }) => {
      if (!active) return;
      if (error) setAccessError("Chưa thiết lập quyền truy cập. Hãy chạy supabase/security.sql trong SQL Editor và gán vai trò cho tài khoản.");
      else setAccess(data as { role: string; superAdmin: boolean; permissions: Record<string, Record<string, boolean>>; registrationStatus?: string });
    });
    return () => { active = false; };
  }, [session.user.id]);
  useEffect(() => {
    const client = supabase;
    if (!client || !access) return;
    const refreshAccess = () => {
      void client.rpc("get_my_access_matrix").then(({ data, error }) => {
        if (!error && data) setAccess(data as { role: string; superAdmin: boolean; permissions: Record<string, Record<string, boolean>>; registrationStatus?: string });
      });
    };
    const channel = client.channel(`permissions:${session.user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "role_module_permissions", filter: `role_key=eq.${access.role}` }, refreshAccess)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_module_permissions", filter: `user_id=eq.${session.user.id}` }, refreshAccess)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_profiles", filter: `user_id=eq.${session.user.id}` }, refreshAccess)
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [access?.role, session.user.id]);
  useEffect(() => {
    let active = true;
    const update = (event: Event) => { const value = (event as CustomEvent<Record<string, unknown>>).detail; if (typeof value?.faculty === "string") setFacultyLabel(value.faculty); };
    window.addEventListener("vtn-system-settings-updated", update);
    void settingsService.get().then((data) => { if (active && typeof data.faculty === "string") setFacultyLabel(data.faculty); }).catch(() => undefined);
    return () => { active = false; window.removeEventListener("vtn-system-settings-updated", update); };
  }, [session.user.id]);
  useEffect(() => {
    if (!access) return;
    const canCreatePeriods = access.superAdmin || (access.permissions["academic-years"]?.create === true && access.permissions.semesters?.create === true);
    if (!canCreatePeriods) return;
    const check = () => void ensureCurrentAcademicPeriods().catch((cause) => console.warn("Không thể tự động khởi tạo năm học/học kỳ hiện hành:", cause));
    check();
    const timer = window.setInterval(check, 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [access, session.user.id]);
  if (accessError) return <main className="auth-screen"><section className="auth-card"><h1>Chưa thiết lập vai trò</h1><p className="auth-subtitle">{accessError}</p><button className="auth-submit" onClick={() => void signOut()}>Đăng xuất</button></section></main>;
  if (!access) return <main className="auth-screen"><div className="auth-loading">Đang tải quyền truy cập…</div></main>;
  if ((access as { registrationStatus?: string }).registrationStatus !== "approved" && !access.superAdmin) return <main className="auth-screen"><section className="auth-card"><h1>{(access as { registrationStatus?: string }).registrationStatus === "rejected" ? "Hồ sơ chưa được duyệt" : "Hồ sơ đang chờ duyệt"}</h1><p className="auth-subtitle">{(access as { registrationStatus?: string }).registrationStatus === "rejected" ? "Quản trị viên chưa chấp thuận hồ sơ này. Vui lòng liên hệ bộ phận quản trị để được hỗ trợ." : "Email đã được xác nhận. Quản trị viên sẽ duyệt tài khoản trước khi cấp quyền truy cập hệ thống."}</p><button className="auth-submit" onClick={() => void signOut()}>Đăng xuất</button></section></main>;
  const canRead = (key: string) => {
    if (access.superAdmin) return true;
    const resource = permissionResources.find((item) => item.kind === "module" && item.key === key);
    const keys = resource ? resourcePermissionKeys(resource, "read") : [key];
    // A direct module grant is authoritative. Group toggles already write the
    // corresponding child permissions, so a stale group deny must not hide a
    // menu that has since been granted explicitly.
    return keys.some((permissionKey) => access.permissions[permissionKey]?.read === true);
  };
  const canReadTab = (moduleKey: string, tabKey: string) => access.superAdmin || access.permissions[`tab:${moduleKey}:${tabKey}`]?.read === true;
  const supportStaff = ["super_admin", "system_admin", "sub_admin", "teacher", "assistant"].includes(access.role);
  const systemAdministrator = ["super_admin", "system_admin", "sub_admin"].includes(access.role);
  const surveyStudent = ["student", "class_president", "class_vice"].includes(access.role);
  const canOpenModule = (key: string) => key === "permissions" ? systemAdministrator && canRead(key) : key === "survey-participation" ? surveyStudent && canRead(key) : key === "surveys" ? supportStaff && canRead(key) : canRead(key);
  const allowedModules = moduleDefinitions.filter((module) => canOpenModule(module.key)).map((module) => module.key);
  return <Routes><Route element={<MainLayout email={session.user.email ?? "Tài khoản"} role={access.role} facultyLabel={facultyLabel} allowedModules={allowedModules} onSignOut={() => void signOut()} />}>
    {moduleDefinitions.map((module) => <Route key={module.key} path={module.path} element={!canOpenModule(module.key) ? <main className="workspace-page"><div className="workspace-panel"><h1>Không có quyền truy cập</h1><p>Vai trò của bạn chưa được cấp quyền đọc phân hệ này.</p></div></main> : module.key === "survey-participation" ? <SurveysPage role={access.role} mode="participate" permissions={{ read: surveyStudent && canRead("survey-participation"), create: access.superAdmin || access.permissions["survey-participation"]?.create === true, update: access.superAdmin || access.permissions["survey-participation"]?.update === true, delete: false }} /> : module.key === "surveys" ? <SurveysPage role={access.role} mode="manage" permissions={{ read: supportStaff && canRead("surveys"), create: supportStaff && (access.superAdmin || access.permissions.surveys?.create === true), update: supportStaff && (access.superAdmin || access.permissions.surveys?.update === true), delete: supportStaff && (access.superAdmin || access.permissions.surveys?.delete === true) }} /> : module.key === "student-support" ? <StudentSupportPage role={access.role} canCreate={access.superAdmin || access.permissions["student-support"]?.create === true} canCreateForStudent={access.superAdmin || access.permissions.supports?.create === true} /> : module.key === "permissions" ? <PermissionsPage access={access} canManage={access.superAdmin || access.permissions.permissions?.update === true} /> : module.key === "accounts" ? <AccountsManagementPage role={access.role} permissions={{ create: access.superAdmin || access.permissions.accounts?.create === true, update: access.superAdmin || access.permissions.accounts?.update === true, delete: access.superAdmin || access.permissions.accounts?.delete === true }} canExport={access.superAdmin || access.permissions.accounts?.export === true} /> : module.key === "groups" ? <StudyGroupsPage canCreate={access.superAdmin || access.permissions.groups?.create === true} /> : module.key === "random-picker" ? <RandomPickerPage canCreate={access.superAdmin || access.permissions["random-picker"]?.create === true} canUpdate={access.superAdmin || access.permissions["random-picker"]?.update === true} canDelete={access.superAdmin || access.permissions["random-picker"]?.delete === true} canExport={access.superAdmin || access.permissions["random-picker"]?.export === true} questionPermissions={{ read: supportStaff && canRead("random-picker"), create: supportStaff && (access.superAdmin || access.permissions["random-picker"]?.create === true), update: supportStaff && (access.superAdmin || access.permissions["random-picker"]?.update === true), delete: supportStaff && (access.superAdmin || access.permissions["random-picker"]?.delete === true) }} /> : module.key === "source-data" ? <SourceDataPage permissions={access.permissions} superAdmin={access.superAdmin} /> : module.key === "timetables" ? <TimetablePage canCreate={access.superAdmin || access.permissions.timetables?.create === true} canUpdate={access.superAdmin || access.permissions.timetables?.update === true} canDelete={access.superAdmin || access.permissions.timetables?.delete === true} canImport={access.superAdmin || (access.permissions.timetables?.create === true && access.permissions.timetables?.update === true)} canExport={access.superAdmin || access.permissions.timetables?.export === true} canSyncPeriods={access.superAdmin || (canRead("source-data") && access.permissions["academic-years"]?.create === true && access.permissions["academic-years"]?.update === true && access.permissions.semesters?.create === true && access.permissions.semesters?.update === true)} canViewList={canReadTab("timetables", "list")} canViewWeek={canReadTab("timetables", "week")} /> : module.key === "student-records" ? <StudentListPage canResetPasswords={access.superAdmin || (["system_admin", "sub_admin", "teacher", "assistant"].includes(access.role) && access.permissions.students?.update === true)} canImport={access.superAdmin || (access.permissions.students?.create === true && access.permissions.students?.update === true)} canImportSourceData={access.superAdmin || (canRead("source-data") && access.permissions.students?.create === true && access.permissions.students?.update === true)} canExport={access.superAdmin || access.permissions[module.key]?.export === true} canCreate={access.superAdmin || access.permissions.students?.create === true} canUpdate={access.superAdmin || access.permissions.students?.update === true} canDelete={access.superAdmin || access.permissions.students?.delete === true} tabPermissions={{ profile: canReadTab("student-records", "student-profile"), results: canReadTab("student-records", "academic-results"), history: canReadTab("student-records", "study-history") }} /> : module.key === "teaching-plans" ? <TeachingPlanSchedulePage canImportSourceData={access.superAdmin || (canRead("source-data") && access.permissions["teaching-plans"]?.create === true && access.permissions["teaching-plans"]?.update === true)} canImportSchedule={access.superAdmin || (access.permissions["teaching-plans"]?.create === true && access.permissions["teaching-plans"]?.update === true)} canCreateSchedule={access.superAdmin || access.permissions["teaching-plans"]?.create === true} canUpdateSchedule={access.superAdmin || access.permissions["teaching-plans"]?.update === true} canDeleteSchedule={access.superAdmin || access.permissions["teaching-plans"]?.delete === true} canExportSchedule={access.superAdmin || access.permissions["teaching-plans"]?.export === true} /> : module.key === "academic-ai" ? <AcademicAIPage role={access.role} canReadSources={canReadTab("academic-ai", "sources")} canManageSources={access.superAdmin || (access.permissions[module.key]?.create === true && access.permissions[module.key]?.update === true && canReadTab("academic-ai", "sources"))} canDeleteSources={access.superAdmin || access.permissions[module.key]?.delete === true} canImportSourceData={canRead("source-data")} canReadChat={canReadTab("academic-ai", "chat")} /> : module.key === "notifications" ? <NotificationsPage role={access.role} canCreate={access.superAdmin || access.permissions.notifications?.create === true} canReadStudents={canRead("students")} /> : module.key === "supports" ? <SupportTicketsPage role={access.role} canCreate={access.superAdmin || access.permissions.supports?.create === true} canUpdate={access.superAdmin || access.permissions.supports?.update === true} canDelete={access.superAdmin || access.permissions.supports?.delete === true} /> : module.system ? <SystemModulePage module={module} role={access.role} canViewSurveyResults={canRead("surveys")} canParticipateSurveys={surveyStudent && canRead("survey-participation")} permissions={{ read: canRead(module.key), create: access.superAdmin || access.permissions[module.key]?.create === true, update: access.superAdmin || access.permissions[module.key]?.update === true, delete: access.superAdmin || access.permissions[module.key]?.delete === true, restore: access.superAdmin || access.permissions[module.key]?.restore === true, export: access.superAdmin || access.permissions[module.key]?.export === true }} canTestPush={["teacher", "assistant", "super_admin", "system_admin", "sub_admin"].includes(access.role)} /> : <WorkspaceModulePage module={module} role={access.role} tabPermissions={{ calendarList: canReadTab("calendar", "list"), calendarWeek: canReadTab("calendar", "week"), gradeProfile: canReadTab("grades", "student-profile"), gradeResults: canReadTab("grades", "academic-results"), gradeHistory: canReadTab("grades", "study-history") }} permissions={{ create: access.superAdmin || access.permissions[module.key]?.create === true, update: access.superAdmin || access.permissions[module.key]?.update === true, delete: access.superAdmin || access.permissions[module.key]?.delete === true, import: access.superAdmin || (access.permissions[module.key]?.create === true && access.permissions[module.key]?.update === true), export: access.superAdmin || access.permissions[module.key]?.export === true }} />} />)}
    <Route path="*" element={<Navigate to="/" replace />} />
  </Route></Routes>;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checked, setChecked] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  useEffect(() => {
    if (localStorage.getItem("vtn-reduce-motion") === "true") document.documentElement.dataset.reduceMotion = "true";
    if (!supabase) { setChecked(true); return; }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => { setSession(nextSession); if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true); if (event === "SIGNED_OUT") setPasswordRecovery(false); setChecked(true); });
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setChecked(true); });
    return () => subscription.unsubscribe();
  }, []);
  return <BrowserRouter>{!checked ? <main className="auth-screen"><div className="auth-loading">Đang kiểm tra phiên đăng nhập…</div></main> : passwordRecovery ? <ResetPasswordPage /> : session ? <AuthenticatedApp session={session} /> : <SignInPage />}</BrowserRouter>;
}
