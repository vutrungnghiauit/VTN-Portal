import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, Copy, Eye, KeyRound, Pencil, RefreshCw, ShieldCheck, Trash2, UserPlus, UserRound, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SortableTableHeader } from "../../components/SortableTableHeader";
import { sortTableRows } from "../../lib/table-sort";
import "./accounts.css";

type Role = "super_admin" | "system_admin" | "sub_admin" | "teacher" | "assistant" | "class_president" | "class_vice" | "student";
type Account = { user_id: string; username: string | null; display_name: string; role_key: Role; phone: string | null; registration_status: "pending" | "approved" | "rejected"; created_at: string; email: string; studentCode: string | null; lastSignInAt: string | null; confirmed: boolean; bannedUntil: string | null };
type StudentOption = { student_code: string; full_name?: string };
type AccountForm = { name: string; username: string; email: string; phone: string; role: Role; studentCode: string };
const labels: Record<Role, string> = { super_admin: "Super Admin", system_admin: "System Admin", sub_admin: "Sub Admin", teacher: "Giảng viên", assistant: "Trợ giảng", class_president: "Lớp trưởng", class_vice: "Lớp phó", student: "Sinh viên" };
const roles = Object.keys(labels) as Role[];
const emptyForm: AccountForm = { name: "", username: "", email: "", phone: "", role: "student", studentCode: "" };
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : "Không thỒ xử lý yêu cầu.";

export default function AccountsManagementPage({ role, permissions }: { role: string; permissions: { create: boolean; update: boolean; delete: boolean } }) {
  const isSuperAdmin = role === "super_admin";
  const isAdmin = ["super_admin", "system_admin", "sub_admin"].includes(role);
  const isTeacher = role === "teacher";
  const canCreate = permissions.create;
  const canUpdate = permissions.update;
  const canDelete = permissions.delete;
  const allowedRoles = useMemo(() => isTeacher ? ["student", "assistant"] as Role[] : roles.filter((item) => item !== "super_admin" && (isSuperAdmin || !["system_admin", "sub_admin"].includes(item))), [isTeacher, isSuperAdmin]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [approval, setApproval] = useState(false);
  const [form, setForm] = useState<AccountForm>(emptyForm);
  const [editing, setEditing] = useState<Account | null>(null);
  const [viewing, setViewing] = useState<Account | null>(null);
  const [deleteConfirmAccount, setDeleteConfirmAccount] = useState<Account | null>(null);
 const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetTarget, setResetTarget] = useState<Account | null>(null);
  const [customPassword, setCustomPassword] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");

  useEffect(() => {
    let active = true;
    void supabase?.auth.getUser().then(({ data }) => { if (active) setCurrentUserId(data.user?.id ?? ""); });
    return () => { active = false; };
  }, []);

  const call = useCallback(async (action: string, data: Record<string, unknown> = {}) => {
    if (!supabase) throw new Error("Chưa cấu hình Supabase.");
    const { data: result, error: invokeError } = await supabase.functions.invoke("swift-api", { body: { action, ...data } });
    if (invokeError) {
      const context = (invokeError as { context?: unknown }).context;
      if (context instanceof Response) {
        const responseBody = await context.clone().json().catch(() => null) as { error?: unknown; message?: unknown } | null;
        const detail = String(responseBody?.error ?? responseBody?.message ?? "").trim();
        if (detail) {
          const authPasswordIssue = /password|weak.?password|password should be at least/i.test(detail);
          throw new Error(authPasswordIssue ? `Supabase Auth từ chối mật khẩu mặc định 12345678. Hãy đặt Password minimum length thành 4 trong cấu hình Auth của dự án. Chi tiết: ${detail}` : detail);
        }
      }
      throw invokeError;
    }
    if (result?.error) throw new Error(result.error);
    return result;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [result, settings] = await Promise.all([
        call("list"),
        isAdmin && supabase ? supabase.rpc("get_registration_settings") : Promise.resolve({ data: null, error: null }),
      ]);
      if (settings.error) throw settings.error;
      const nextAccounts = (result.accounts ?? []) as Account[];
      setAccounts(nextAccounts);
      setSelectedAccountIds((previous) => new Set([...previous].filter((id) => nextAccounts.some((account) => account.user_id === id))));
      setStudents((result.availableStudents ?? []) as StudentOption[]);
      if (settings.data) { setEnabled(Boolean(settings.data.enabled)); setApproval(Boolean(settings.data.approvalRequired)); }
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }, [call, isAdmin]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function run(action: string, data: Record<string, unknown> = {}) {
    if ((action === "delete" && !canDelete) || (action !== "delete" && !canUpdate)) return false;
    setBusy(true); setError(""); setNotice(""); setResetPassword("");
    try {
      const result = await call(action, data);
      setNotice(result?.message ?? "Đã cập nhật.");
      if (action.startsWith("reset")) setResetPassword(String(result?.password ?? ""));
      await refresh();
      return true;
    } catch (cause) { setError(errorMessage(cause)); return false; }
    finally { setBusy(false); }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault(); if (!supabase || !canUpdate) return;
    setBusy(true); setError(""); setNotice("");
    const { error: saveError } = await supabase.rpc("save_registration_settings", { p_enabled: enabled, p_approval_required: approval });
    if (saveError) setError(saveError.message); else setNotice("Đã lưu thiết lập đăng ký.");
    setBusy(false);
  }

  function updateForm<K extends keyof AccountForm>(key: K, value: AccountForm[K]) { setForm((current) => ({ ...current, [key]: value })); }

  async function submitAccount(event: FormEvent) {
    event.preventDefault();
    if (editing ? !canUpdate : !canCreate) return;
    const payload = { userId: editing?.user_id, name: form.name.trim(), username: form.username.trim(), email: form.email.trim(), phone: form.phone.trim(), role: form.role, password: "12345678", studentCode: form.studentCode };
    if (editing) {
      if (await run("edit", payload)) { setForm(emptyForm); setEditing(null); setViewing(null); }
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await call("create", payload);
      const createdAccount: Account = result?.account ?? {
        user_id: String(result?.userId ?? crypto.randomUUID()), username: payload.username, display_name: payload.name,
        role_key: payload.role, phone: payload.phone || null, registration_status: "approved", created_at: new Date().toISOString(),
        email: payload.email, studentCode: payload.studentCode || null, lastSignInAt: null, confirmed: true, bannedUntil: null,
      };
      setAccounts((current) => [createdAccount, ...current.filter((item) => item.user_id !== createdAccount.user_id)]);
      setNotice(result?.message ?? "Đã tạo tài khoản và cấp quyền truy cập.");
      setForm(emptyForm);
      await refresh();
      setAccounts((current) => current.some((item) => item.user_id === createdAccount.user_id) ? current : [createdAccount, ...current]);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  function startEdit(account: Account) {
    if (!canUpdate) return;
    if (account.role_key === "super_admin" && (!isSuperAdmin || account.user_id !== currentUserId)) return;
    setEditing(account);
    setViewing(account);
    setForm({ ...emptyForm, name: account.display_name ?? "", username: account.username ?? "", email: account.email, phone: account.phone ?? "", role: account.role_key });
  }

  function removeAccount(account: Account) { if (canDelete) setDeleteConfirmAccount(account); }

  async function confirmRemoveAccount() {
    if (!deleteConfirmAccount) return;
    const deleted = await run("delete", { userId: deleteConfirmAccount.user_id });
    if (deleted) {
      setViewing((current) => current?.user_id === deleteConfirmAccount.user_id ? null : current);
      setDeleteConfirmAccount(null);
    }
  }

  async function submitPasswordReset(event: FormEvent) {
    event.preventDefault();
    if (!canUpdate || !resetTarget || customPassword.length < 6) return;
    const updated = await run("reset-student-password", { userId: resetTarget.user_id, password: customPassword });
    if (updated) { setResetTarget(null); setCustomPassword(""); }
  }

  const [accountPageSize, setAccountPageSize] = useState<"10" | "20" | "50" | "100" | "all">("10");
  const [accountPage, setAccountPage] = useState(1);
  const [accountSort, setAccountSort] = useState({ key: "ordinal", direction: "asc" as "asc" | "desc" });
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(() => new Set());
  const sortedAccounts = useMemo(() => sortTableRows(accounts, accountSort, (account, key, index) => key === "ordinal" ? index : key === "name" ? account.display_name || account.username || account.email : key === "role" ? labels[account.role_key] : key === "status" ? account.registration_status === "pending" ? "Chờ duyệt" : account.registration_status === "rejected" ? "Từ chối" : account.bannedUntil && new Date(account.bannedUntil).getTime() > Date.now() ? "Đã khóa" : "Đang hoạt động" : key === "recent" ? account.lastSignInAt : undefined), [accounts, accountSort]);
  function sortAccountsBy(key: string) {
    setAccountSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" });
    setAccountPage(1);
  }
  const accountPageCount = accountPageSize === "all" ? 1 : Math.max(1, Math.ceil(accounts.length / Number(accountPageSize)));
  const safeAccountPage = Math.min(accountPage, accountPageCount);
  const accountPageStart = accountPageSize === "all" ? 0 : (safeAccountPage - 1) * Number(accountPageSize);
  const accountPageRows = accountPageSize === "all" ? sortedAccounts : sortedAccounts.slice(accountPageStart, accountPageStart + Number(accountPageSize));
  const allAccountsSelected = accounts.length > 0 && selectedAccountIds.size === accounts.length;
  const headerCopy = isTeacher ? "Tài khoản sinh viên và trợ giảng thuộc phạm vi bạn phụ trách." : "Quản lý tài khoản và quyền truy cập trong hệ thống.";

  return <main className="workspace-page accounts-page">
    <header className="workspace-title-row"><div><p className="workspace-eyebrow">QUẢN TRỊ</p><h1>Quản lý tài khoản</h1><p>{headerCopy}</p></div><button type="button" className="accounts-refresh-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} /> Làm mới</button></header>
    {error && <div className="auth-error" role="alert">{error}</div>}
    {notice && <div className="auth-notice" role="status">{notice}{resetPassword && <div className="accounts-reset-result"><code>{resetPassword}</code><button type="button" onClick={() => void navigator.clipboard?.writeText(resetPassword)}><Copy size={14} /> Sao chép mật khẩu</button></div>}</div>}

    {isAdmin && canUpdate && <form className="workspace-panel accounts-settings" onSubmit={(event) => void saveSettings(event)}><div><h2><ShieldCheck size={19} /> Thiết lập đăng ký mới</h2><p>Bật hoặc tắt đăng ký công khai và yêu cầu duyệt tài khoản sinh viên.</p></div><label><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Cho phép đăng ký tài khoản mới</label><label><input type="checkbox" checked={approval} onChange={(event) => setApproval(event.target.checked)} /> Yêu cầu quản trị viên duyệt sau khi xác nhận email</label><button className="workspace-primary" disabled={busy}>Lưu thiết lập</button></form>}

    {!editing && canCreate && <form className="workspace-panel accounts-invite" onSubmit={(event) => void submitAccount(event)}><div><h2><UserPlus size={19} /> Thêm tài khoản</h2><p>Tạo tài khoản đăng nhập ngay trong hệ thống.</p></div>
      <label>Họ và tên<input value={form.name} onChange={(event) => updateForm("name", event.target.value)} required maxLength={120} /></label>
      <label>Tên đăng nhập<input value={form.username} onChange={(event) => updateForm("username", event.target.value)} required minLength={3} maxLength={60} pattern="[A-Za-z0-9._-]+" /></label>
      <label>Email<input type="email" value={form.email} onChange={(event) => updateForm("email", event.target.value)} required /></label>
      <label>Số điện thoại<input value={form.phone} onChange={(event) => updateForm("phone", event.target.value)} /></label>
      <label>Vai trò<select value={form.role} onChange={(event) => updateForm("role", event.target.value as Role)} disabled={Boolean(editing && isTeacher)}>{allowedRoles.map((item) => <option key={item} value={item}>{labels[item]}</option>)}</select></label>
      {!editing && <label>Mật khẩu ban đầu<input type="text" value="12345678" readOnly aria-readonly="true" /></label>}
      {!editing && form.role === "student" && <label>Hồ sơ MSSV cần liên kết{isTeacher ? <select value={form.studentCode} onChange={(event) => updateForm("studentCode", event.target.value)} required><option value="">Chọn sinh viên phụ trách</option>{students.map((student) => <option key={student.student_code} value={student.student_code}>{student.student_code}{student.full_name ? ` · ${student.full_name}` : ""}</option>)}</select> : <input value={form.studentCode} onChange={(event) => updateForm("studentCode", event.target.value)} placeholder="Không bắt buộc" />}</label>}
      <div className="accounts-form-actions"><button className="workspace-primary" disabled={busy}><UserPlus size={16} /> {editing ? "Lưu thay đổi" : "Tạo tài khoản"}</button>{editing && <button type="button" onClick={() => { setEditing(null); setForm(emptyForm); }}>Hủy sửa</button>}</div>
    </form>}

    <section className="accounts-list"><div className="accounts-list-heading"><div><h2>Tài khoản {isTeacher ? "được phụ trách" : "trong hệ thống"}</h2><p>{accounts.length} tài khoản</p></div><span>Quyền Super Admin luôn được khóa bảo vệ.</span></div>{loading ? <div className="workspace-loading">Dang tai tai khoan...</div> : <><div className="workspace-data-selection"><label><input type="checkbox" aria-label="Chọn tất cả tài khoản" checked={allAccountsSelected} ref={(element) => { if (element) element.indeterminate = selectedAccountIds.size > 0 && !allAccountsSelected; }} onChange={(event) => setSelectedAccountIds(event.target.checked ? new Set(accounts.map((account) => account.user_id)) : new Set())} /> Chọn tất cả {accounts.length.toLocaleString("vi-VN")} dòng</label><span>Đã chọn {selectedAccountIds.size.toLocaleString("vi-VN")} / {accounts.length.toLocaleString("vi-VN")} dòng</span><button type="button" disabled={!selectedAccountIds.size} onClick={() => setSelectedAccountIds(new Set())}>Bỏ chọn</button></div><div className="workspace-table-wrap"><table><thead><tr><th className="gradebook-select-column"><input type="checkbox" aria-label="Chọn tất cả tài khoản" checked={allAccountsSelected} ref={(element) => { if (element) element.indeterminate = selectedAccountIds.size > 0 && !allAccountsSelected; }} onChange={(event) => setSelectedAccountIds(event.target.checked ? new Set(accounts.map((account) => account.user_id)) : new Set())} /></th><SortableTableHeader label="STT" sortKey="ordinal" sortState={accountSort} onSort={sortAccountsBy} /><SortableTableHeader label="NGƯỜI DÙNG" sortKey="name" sortState={accountSort} onSort={sortAccountsBy} /><SortableTableHeader label="VAI TRÒ" sortKey="role" sortState={accountSort} onSort={sortAccountsBy} /><SortableTableHeader label="TRẠNG THÁI" sortKey="status" sortState={accountSort} onSort={sortAccountsBy} /><SortableTableHeader label="HOẠT ĐỘNG GẦN ĐÂY" sortKey="recent" sortState={accountSort} onSort={sortAccountsBy} /><th>THAO TÁC</th></tr></thead><tbody>{accountPageRows.map((account, index) => { const protectedAccount = account.role_key === "super_admin"; const banned = Boolean(account.bannedUntil && new Date(account.bannedUntil).getTime() > Date.now()); return <tr key={account.user_id}><td className="gradebook-select-column"><input type="checkbox" aria-label={`Chọn tài khoản ${account.email}`} checked={selectedAccountIds.has(account.user_id)} onChange={(event) => setSelectedAccountIds((previous) => { const next = new Set(previous); if (event.target.checked) next.add(account.user_id); else next.delete(account.user_id); return next; })} /></td>
<td>{accountPageStart + index + 1}</td><td><div className="accounts-user"><span><UserRound size={17} /></span><div><button type="button" className="accounts-name-link" onClick={() => { setViewing(account); setEditing(null); }}>{account.display_name || account.email}</button><small>{account.email}{account.confirmed ? " · Email đã xác nhận" : " · Chờ xác nhận email"}</small>{account.username && <small>Tên đăng nhập: {account.username}</small>}{account.studentCode && <small>MSSV: {account.studentCode}</small>}</div></div></td>
<td>{protectedAccount ? <span className="accounts-locked"><ShieldCheck size={15} /> {labels[account.role_key]}</span> : canUpdate && (isAdmin || isTeacher) ? <select aria-label={`Vai trò ${account.email}`} value={account.role_key} disabled={busy} onChange={(event) => void run("role", { userId: account.user_id, role: event.target.value })}>{allowedRoles.map((item) => <option key={item} value={item}>{labels[item]}</option>)}</select> : labels[account.role_key]}</td>
<td>{protectedAccount ? <span className="accounts-status">Được bảo vệ</span> : canUpdate && (isAdmin || isTeacher) ? <select className={`accounts-status-select accounts-status ${account.registration_status}`} aria-label={`Trạng thái ${account.email}`} value={account.registration_status === "pending" ? "pending" : account.registration_status === "rejected" ? "rejected" : banned ? "locked" : "active"} disabled={busy} onChange={(event) => void run("account-status", { userId: account.user_id, status: event.target.value })}><option value="pending">Chờ duyệt</option><option value="active">Đang hoạt động</option><option value="rejected">Từ chối</option><option value="locked">Đã khóa</option></select> : <span className={`accounts-status ${account.registration_status}`}>{account.registration_status === "pending" ? "Chờ duyệt" : account.registration_status === "rejected" ? "Từ chối" : banned ? "Đã khóa" : "Đang hoạt động"}</span>}</td>
<td>{account.lastSignInAt ? new Date(account.lastSignInAt).toLocaleString("vi-VN") : "Ch?a ??ng nh?p"}</td>
<td><div className="accounts-quick-actions"><button type="button" title="Xem tài khoản" aria-label={`Xem tài khoản ${account.email}`} onClick={() => { setViewing(account); setEditing(null); }}><Eye size={15} /></button>{canUpdate && account.registration_status === "pending" && isAdmin && !protectedAccount && <><button type="button" title="Duyệt tài khoản" aria-label={`Duyệt tài khoản ${account.email}`} disabled={busy} onClick={() => void run("approval", { userId: account.user_id, status: "approved" })}><Check size={15} /></button><button type="button" title="Từ chối tài khoản" aria-label={`Từ chối tài khoản ${account.email}`} disabled={busy} onClick={() => void run("approval", { userId: account.user_id, status: "rejected" })}><X size={15} /></button></>}{canUpdate && <button type="button" title="Sửa tài khoản" aria-label={`Sửa tài khoản ${account.email}`} disabled={busy || (protectedAccount && (!isSuperAdmin || account.user_id !== currentUserId))} onClick={() => startEdit(account)}><Pencil size={15} /></button>}{canUpdate && !protectedAccount && <><button type="button" title="Đặt lại mật khẩu" aria-label={`Đặt lại mật khẩu ${account.email}`} disabled={busy} onClick={() => { setResetTarget(account); setCustomPassword(""); setError(""); }}><KeyRound size={15} /></button><button type="button" className="accounts-access-button" title={banned ? "Mở khóa tài khoản" : "Khóa tài khoản"} disabled={busy} onClick={() => void run("access", { userId: account.user_id, suspended: !banned })}>{banned ? "Mở khóa" : "Khóa"}</button></>}{canDelete && !protectedAccount && <button type="button" className="accounts-danger" title="Xóa tài khoản" aria-label={`Xóa tài khoản ${account.email}`} disabled={busy} onClick={() => void removeAccount(account)}><Trash2 size={15} /></button>}</div></td>
</tr>; })}{!accounts.length && <tr><td colSpan={7} className="workspace-state">{isTeacher ? "Chưa có tài khoản cấp dưới được gán hoặc liên kết với hồ sơ bạn phụ trách." : "Chưa có tài khoản trong danh sách."}</td></tr>}</tbody></table></div><div className="workspace-pagination"><label>Số dòng<select aria-label="Số dòng tài khoản mỗi trang" value={accountPageSize} onChange={(event) => { setAccountPageSize(event.target.value as "10" | "20" | "50" | "100" | "all"); setAccountPage(1); }}><option value="10">10 dòng</option><option value="20">20 dòng</option><option value="50">50 dòng</option><option value="100">100 dòng</option><option value="all">Tất cả</option></select></label><span>{accounts.length ? `Đang hiển thị ${accountPageStart + 1}–${Math.min(accountPageStart + accountPageRows.length, accounts.length)} / ${accounts.length.toLocaleString("vi-VN")} dòng` : "Đang hiển thị 0–0 / 0 dòng"}</span><div><button type="button" disabled={safeAccountPage <= 1} onClick={() => setAccountPage((page) => Math.max(1, page - 1))}>Trước</button><span>Trang {safeAccountPage} / {accountPageCount}</span><button type="button" disabled={safeAccountPage >= accountPageCount} onClick={() => setAccountPage((page) => Math.min(accountPageCount, page + 1))}>Sau</button></div></div></>}</section>
    {viewing && <div className="accounts-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setViewing(null); setEditing(null); } }}><section className="accounts-modal" role="dialog" aria-modal="true" aria-labelledby="accounts-modal-title"><header><div><span>THÔNG TIN TÀI KHOẢN</span><h2 id="accounts-modal-title">{editing?.user_id === viewing.user_id ? "Sửa thông tin tài khoản" : viewing.display_name || viewing.email}</h2></div><button type="button" aria-label="Đóng thông tin tài khoản" onClick={() => { setViewing(null); setEditing(null); }}><X size={19} /></button></header>{editing?.user_id === viewing.user_id ? <form className="accounts-modal-form" onSubmit={(event) => void submitAccount(event)}><label>Họ và tên<input value={form.name} onChange={(event) => updateForm("name", event.target.value)} required maxLength={120} /></label><label>Tên đăng nhập<input value={form.username} onChange={(event) => updateForm("username", event.target.value)} required minLength={3} maxLength={60} pattern="[A-Za-z0-9._-]+" /></label><label>Email<input type="email" value={form.email} onChange={(event) => updateForm("email", event.target.value)} required /></label><label>Số điện thoại<input value={form.phone} onChange={(event) => updateForm("phone", event.target.value)} /></label><label>Vai trò<select value={form.role} onChange={(event) => updateForm("role", event.target.value as Role)} disabled={isTeacher || (editing?.role_key === "super_admin")}>{(editing?.role_key === "super_admin" ? ["super_admin" as Role] : allowedRoles).map((item) => <option key={item} value={item}>{labels[item]}</option>)}</select></label><div className="accounts-modal-actions"><button className="workspace-primary" disabled={busy}>{busy ? "Đang lưu…" : "Lưu thay đổi"}</button><button type="button" disabled={busy} onClick={() => { setEditing(null); setForm(emptyForm); }}>Hủy sửa</button></div></form> : <><dl className="accounts-details"><div><dt>Họ và tên</dt><dd>{viewing.display_name || "—"}</dd></div><div><dt>Tên đăng nhập</dt><dd>{viewing.username || "—"}</dd></div><div><dt>Email</dt><dd>{viewing.email || "—"}</dd></div><div><dt>Số điện thoại</dt><dd>{viewing.phone || "—"}</dd></div><div><dt>Vai trò</dt><dd>{labels[viewing.role_key] ?? viewing.role_key}</dd></div><div><dt>Mã sinh viên</dt><dd>{viewing.studentCode || "—"}</dd></div><div><dt>Trạng thái đăng ký</dt><dd>{viewing.registration_status === "pending" ? "Chờ duyệt" : viewing.registration_status === "rejected" ? "Từ chối" : "Đã duyệt"}</dd></div><div><dt>Đăng nhập gần nhất</dt><dd>{viewing.lastSignInAt ? new Date(viewing.lastSignInAt).toLocaleString("vi-VN") : "Chưa đăng nhập"}</dd></div></dl><div className="accounts-modal-actions">{canUpdate && <button className="workspace-primary" type="button" disabled={viewing.role_key === "super_admin" && (!isSuperAdmin || viewing.user_id !== currentUserId)} onClick={() => startEdit(viewing)}><Pencil size={15} /> Sửa thông tin</button>}<button type="button" onClick={() => { setViewing(null); setEditing(null); }}>Đóng</button></div></>}</section></div>}
    {resetTarget && <div className="accounts-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setResetTarget(null); }}><form className="accounts-modal accounts-password-dialog" role="dialog" aria-modal="true" aria-labelledby="accounts-password-title" onSubmit={(event) => void submitPasswordReset(event)}><header><div><span>ĐẶT LẠI MẬT KHẨU</span><h2 id="accounts-password-title">Đặt mật khẩu cho tài khoản</h2></div><button type="button" aria-label="Đóng" disabled={busy} onClick={() => setResetTarget(null)}><X size={19} /></button></header><p>{resetTarget.display_name || resetTarget.username || resetTarget.email} (@{resetTarget.username || "—"})</p><label className="accounts-password-field">Mật khẩu mới<input type="password" autoComplete="new-password" minLength={6} maxLength={128} required value={customPassword} onChange={(event) => setCustomPassword(event.target.value)} placeholder="Nhập mật khẩu (ít nhất 6 ký tự)" /></label><small>Mật khẩu được cập nhật trực tiếp trong Supabase Auth.</small><div className="accounts-modal-actions"><button className="workspace-primary" disabled={busy}>{busy ? "Đang cập nhật…" : "Lưu mật khẩu"}</button><button type="button" disabled={busy} onClick={() => setResetTarget(null)}>Hủy</button></div></form></div>}
    {deleteConfirmAccount && <div className="accounts-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDeleteConfirmAccount(null); }}><section className="accounts-modal accounts-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="accounts-delete-title"><header><div><span>CHUYỂN VÀO THÙNG RÁC</span><h2 id="accounts-delete-title">Chuyển tài khoản này vào thùng rác?</h2></div><button type="button" aria-label="Đóng xác nhận" disabled={busy} onClick={() => setDeleteConfirmAccount(null)}><X size={19} /></button></header><p>Tài khoản <strong>{deleteConfirmAccount.display_name || deleteConfirmAccount.username || deleteConfirmAccount.email}</strong> sẽ bị khóa đăng nhập và lưu theo thời hạn trong mục Quản lý thùng rác. Có thể khôi phục trước khi hết hạn.</p><div className="accounts-modal-actions"><button className="accounts-delete-confirm" type="button" disabled={busy} onClick={() => void confirmRemoveAccount()}><Trash2 size={15} />{busy ? "Đang chuyển…" : "Chuyển vào thùng rác"}</button><button type="button" disabled={busy} onClick={() => setDeleteConfirmAccount(null)}>Hủy</button></div></section></div>}
  </main>;
}
