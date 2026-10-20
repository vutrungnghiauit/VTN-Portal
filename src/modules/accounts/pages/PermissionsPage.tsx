import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Check, LockKeyhole, Pencil, Save, Search, Shield, ShieldCheck, Trash2, UsersRound, X, type LucideIcon } from "lucide-react";
import { supabase } from "../../../lib/supabase";
import { SortableTableHeader } from "../../../components/SortableTableHeader";
import SearchableFilter from "../../../components/SearchableFilter";
import { sortTableRows } from "../../../lib/table-sort";
import { permissionActions, permissionGroups, permissionResources, permissionRoles, resourcePermissionKeys, type PermissionAction, type PermissionResource } from "../permission-catalog";
import "./permissions.css";

type PermissionMap = Record<string, Record<string, boolean>>;
type Person = { user_id: string; username: string | null; display_name: string; role_key: string; phone?: string | null; department?: string | null; job_title?: string | null; office?: string | null; avatar_url?: string | null; created_at?: string };
type AccountEditForm = { name: string; username: string; email: string; phone: string; office: string; avatarUrl: string };
const roleIcons: Record<string, LucideIcon> = { super_admin: ShieldCheck, system_admin: LockKeyhole, sub_admin: UsersRound };
const permissionKey = (resource: string, action: string) => `${resource}:${action}`;
const personCategory = (roleKey: string) => roleKey === "student" || roleKey === "class_president" || roleKey === "class_vice" ? "Sinh viên" : roleKey === "teacher" ? "Giảng viên" : roleKey === "assistant" ? "Trợ giảng" : "Quản trị";
const permissionEntriesForAll = (allowed: boolean) => {
  const entries: Array<{ resource: string; action: string; allowed: boolean }> = permissionGroups.map((group) => ({ resource: group.key, action: "read", allowed }));
  for (const resource of permissionResources) {
    entries.push({ resource: resource.group, action: "read", allowed });
    if (resource.kind === "tab") {
      entries.push({ resource: resource.key, action: "read", allowed });
      if (resource.parentKey) entries.push({ resource: resource.parentKey, action: "read", allowed });
      continue;
    }
    for (const action of resource.actions) {
      if (action === "import") continue;
      for (const key of resourcePermissionKeys(resource, action)) entries.push({ resource: key, action, allowed });
    }
  }
  return entries;
};

async function getInvokeErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "context" in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const body = await context.clone().json().catch(() => null) as { error?: unknown; message?: unknown } | null;
      const detail = String(body?.error ?? body?.message ?? "").trim();
      if (detail) return detail;
    }
  }
  return error instanceof Error ? error.message : "Không tải được thông tin tài khoản.";
}

export default function PermissionsPage({ access, canManage }: { access: { role: string; superAdmin: boolean; permissions: PermissionMap }; canManage: boolean }) {
  const [view, setView] = useState<"roles" | "users">("roles");
  const [selectedRole, setSelectedRole] = useState(() => permissionRoles.some((role) => role.key === access.role) ? access.role : "teacher");
  const [selectedUser, setSelectedUser] = useState("");
  const [userPermissionsOpen, setUserPermissionsOpen] = useState(false);
  const [loadingUserMatrix, setLoadingUserMatrix] = useState(false);
  const [rolePermissions, setRolePermissions] = useState<Record<string, boolean>>({});
  const [matrix, setMatrix] = useState<Record<string, boolean>>({});
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [people, setPeople] = useState<Person[]>([]);
  const [resourceSearch, setResourceSearch] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [accountRoleFilter, setAccountRoleFilter] = useState("all");
  const [userPageSize, setUserPageSize] = useState<"10" | "20" | "50" | "100" | "all">("10");
  const [userPage, setUserPage] = useState(1);
  const [userSort, setUserSort] = useState({ key: "ordinal", direction: "asc" as "asc" | "desc" });
  const [selectedPermissionUserIds, setSelectedPermissionUserIds] = useState<Set<string>>(() => new Set());
  const [currentUserId, setCurrentUserId] = useState("");
  const [editingAccount, setEditingAccount] = useState<Person | null>(null);
  const [accountEditForm, setAccountEditForm] = useState<AccountEditForm>({ name: "", username: "", email: "", phone: "", office: "", avatarUrl: "" });
  const [accountEditBusy, setAccountEditBusy] = useState(false);
  const [accountEditError, setAccountEditError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selectedPerson = people.find((person) => person.user_id === selectedUser);
  const isProtected = view === "roles" ? selectedRole === "super_admin" : selectedPerson?.role_key === "super_admin";
  const canEditAccounts = access.superAdmin || access.permissions.accounts?.update === true;

  useEffect(() => {
    let active = true;
    void supabase?.auth.getUser().then(({ data }) => { if (active) setCurrentUserId(data.user?.id ?? ""); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (view !== "users" || !currentUserId || selectedUser || !people.some((person) => person.user_id === currentUserId)) return;
    void selectUser(currentUserId);
  }, [view, currentUserId, selectedUser, people]);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase) { setError("Chưa cấu hình Supabase."); setLoading(false); return; }
      setLoading(true); setError("");
      const [{ data: roles, error: rolesError }, { data: permissions, error: permissionsError }] = await Promise.all([
        supabase.from("user_profiles").select("user_id,username,display_name,role_key,phone,department,job_title,office,avatar_url,created_at").is("deleted_at", null).order("display_name"),
        supabase.from("role_module_permissions").select("role_key,module_key,action_key,allowed"),
      ]);
      if (!active) return;
      if (rolesError || permissionsError) { setError((rolesError ?? permissionsError)?.message ?? "Không tải được ma trận quyền."); setLoading(false); return; }
      const roleRows = permissions ?? [];
      const completeRoleMap = Object.fromEntries(roleRows.map((row) => [`${row.role_key}:${permissionKey(row.module_key, row.action_key)}`, row.allowed]));
      setPeople((roles ?? []) as Person[]);
      setRolePermissions(completeRoleMap);
      setMatrix(Object.fromEntries(roleRows.filter((row) => row.role_key === selectedRole).map((row) => [permissionKey(row.module_key, row.action_key), row.allowed])));
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, []);

  const visibleResources = useMemo(() => permissionResources.filter((resource) => `${resource.title} ${resource.detail} ${resource.key}`.toLocaleLowerCase("vi-VN").includes(resourceSearch.trim().toLocaleLowerCase("vi-VN"))), [resourceSearch]);
  const resourcesByGroup = useMemo(() => permissionGroups.map((group) => ({ ...group, resources: visibleResources.filter((resource) => resource.group === group.key) })).filter((group) => group.resources.length), [visibleResources]);

  async function writePermission(resource: string, action: string, allowed: boolean) {
    if (!supabase) throw new Error("Chưa cấu hình Supabase.");
    if (view === "roles") {
      const { error: saveError } = await supabase.rpc("set_role_module_permission", { p_role: selectedRole, p_module: resource, p_action: action, p_allowed: allowed });
      if (saveError) throw saveError;
      setRolePermissions((current) => ({ ...current, [`${selectedRole}:${permissionKey(resource, action)}`]: allowed }));
    } else {
      if (!selectedUser) throw new Error("Chọn một tài khoản trước khi chỉnh quyền.");
      const { error: saveError } = await supabase.rpc("set_user_module_permission", { p_user_id: selectedUser, p_module: resource, p_action: action, p_allowed: allowed });
      if (saveError) throw saveError;
      setOverrides((current) => ({ ...current, [permissionKey(resource, action)]: allowed }));
    }
    setMatrix((current) => ({ ...current, [permissionKey(resource, action)]: allowed }));
  }

  async function writeMany(entries: Array<{ resource: string; action: string; allowed: boolean }>) {
    const unique = [...new Map(entries.map((entry) => [`${entry.resource}:${entry.action}`, entry])).values()];
    const failures: unknown[] = [];
    for (let start = 0; start < unique.length; start += 8) {
      const results = await Promise.allSettled(unique.slice(start, start + 8).map((entry) => writePermission(entry.resource, entry.action, entry.allowed)));
      results.forEach((result) => { if (result.status === "rejected") failures.push(result.reason); });
    }
    if (failures.length) {
      const detail = failures[0] instanceof Error ? failures[0].message : "";
      throw new Error(`Không lưu được ${failures.length} quyền${detail ? `: ${detail}` : ". Hãy thử lại."}`);
    }
  }

  async function selectRole(role: string) {
    setSelectedRole(role); setSelectedUser(""); setOverrides({}); setUserPermissionsOpen(false);
    setMatrix(Object.fromEntries(Object.entries(rolePermissions).filter(([key]) => key.startsWith(`${role}:`)).map(([key, value]) => [key.slice(role.length + 1), value])));
  }

  async function selectUser(userId: string) {
    setSelectedUser(userId); setError(""); setNotice(""); setOverrides({}); setMatrix({});
    if (!userId || !supabase) { setMatrix({}); setLoadingUserMatrix(false); return; }
    setLoadingUserMatrix(true);
    try {
      const [{ data, error: matrixError }, { data: overrideRows, error: overrideError }] = await Promise.all([
        supabase.rpc("get_user_access_matrix", { p_user_id: userId }),
        supabase.from("user_module_permissions").select("module_key,action_key,allowed").eq("user_id", userId),
      ]);
      if (matrixError || overrideError) { setError((matrixError ?? overrideError)?.message ?? "Không tải được quyền tài khoản."); return; }
      const permissions = (data as { permissions?: PermissionMap } | null)?.permissions ?? {};
      setMatrix(Object.fromEntries(Object.entries(permissions).flatMap(([resource, actions]) => Object.entries(actions).map(([action, allowed]) => [permissionKey(resource, action), allowed]))));
      setOverrides(Object.fromEntries((overrideRows ?? []).map((row) => [permissionKey(row.module_key, row.action_key), row.allowed])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được quyền tài khoản.");
    } finally {
      setLoadingUserMatrix(false);
    }
  }

  async function openAccountEditor(person: Person) {
    if (!supabase || !canEditAccounts || (person.role_key === "super_admin" && (!access.superAdmin || person.user_id !== currentUserId))) return;
    setEditingAccount(person); setAccountEditForm({ name: "", username: "", email: "", phone: "", office: "", avatarUrl: "" }); setAccountEditBusy(true); setAccountEditError("");
    // The account list endpoint is already used by account management and is
    // available on existing deployments; use it to avoid relying on a newer
    // get-account Edge Function action just to populate this form.
    const { data, error: detailError } = await supabase.functions.invoke("swift-api", { body: { action: "list" } });
    setAccountEditBusy(false);
    if (detailError || data?.error) {
      setAccountEditError(data?.error ?? await getInvokeErrorMessage(detailError));
      return;
    }
    const account = (data?.accounts ?? []).find((item: { user_id?: string }) => item.user_id === person.user_id) as { display_name?: string; username?: string | null; email?: string; phone?: string | null } | undefined;
    if (!account) {
      setAccountEditError("Không tìm thấy tài khoản trong danh sách được phép quản lý.");
      return;
    }
    setAccountEditForm({ name: account.display_name ?? person.display_name ?? "", username: account.username ?? person.username ?? "", email: account.email ?? "", phone: account.phone ?? person.phone ?? "", office: person.office ?? "", avatarUrl: person.avatar_url ?? "" });
  }

  async function saveAccountEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !editingAccount || !canEditAccounts || accountEditBusy) return;
    setAccountEditBusy(true); setAccountEditError("");
    const payload = { action: "edit", userId: editingAccount.user_id, name: accountEditForm.name.trim(), username: accountEditForm.username.trim(), email: accountEditForm.email.trim(), phone: accountEditForm.phone.trim(), office: accountEditForm.office, avatarUrl: accountEditForm.avatarUrl.trim() };
    const { data, error: saveError } = await supabase.functions.invoke("swift-api", { body: payload });
    setAccountEditBusy(false);
    if (saveError || data?.error) { setAccountEditError(data?.error ?? saveError?.message ?? "Không lưu được thông tin tài khoản."); return; }
    setPeople((current) => current.map((person) => person.user_id === editingAccount.user_id ? { ...person, display_name: payload.name, username: payload.username, phone: payload.phone || null, office: payload.office || null, avatar_url: payload.avatarUrl || null } : person));
    setNotice(data?.message ?? "Đã cập nhật tài khoản."); setEditingAccount(null);
  }

  function hasPermission(resource: string, action: string) {
    if (isProtected) return true;
    if (view === "users" && Object.prototype.hasOwnProperty.call(overrides, permissionKey(resource, action))) return overrides[permissionKey(resource, action)];
    return Boolean(matrix[permissionKey(resource, action)]);
  }

  function effectiveResourcePermission(resource: PermissionResource, action: PermissionAction) {
    const keys = resourcePermissionKeys(resource, action);
    return keys.length > 0 && (action === "read" ? keys.some((key) => hasPermission(key, action)) : keys.every((key) => hasPermission(key, action)));
  }

  async function toggleResource(resource: PermissionResource, action: PermissionAction | "import", allowed: boolean) {
    const actionConfig = permissionActions.find((item) => item.key === action);
    if (!actionConfig || isProtected || !canManage || (view === "users" && !selectedUser)) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const entries = actionConfig.keys.flatMap((permissionAction) => resourcePermissionKeys(resource, permissionAction).map((key) => ({ resource: key, action: permissionAction, allowed })));
      if (action === "read" && allowed) {
        entries.push({ resource: resource.group, action: "read", allowed: true });
        if (resource.kind === "tab" && resource.parentKey) entries.push({ resource: resource.parentKey, action: "read", allowed: true });
      }
      if (action === "read" && !allowed && resource.kind === "module") {
        for (const tab of permissionResources.filter((item) => item.kind === "tab" && item.parentKey === resource.key)) {
          entries.push({ resource: tab.key, action: "read", allowed: false });
        }
      }
      await writeMany(entries);
      setNotice("Đã cập nhật quyền truy cập.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không lưu được quyền truy cập."); }
    finally { setSaving(false); }
  }

  async function toggleGroup(groupKey: string, allowed: boolean) {
    if (isProtected || !canManage || (view === "users" && !selectedUser)) return;
    const resources = permissionResources.filter((resource) => resource.group === groupKey);
    const entries = [{ resource: groupKey, action: "read", allowed }];
    for (const resource of resources) {
      if (resource.kind === "module") {
        for (const key of resourcePermissionKeys(resource, "read")) entries.push({ resource: key, action: "read", allowed });
      } else entries.push({ resource: resource.key, action: "read", allowed });
    }
    setSaving(true); setError(""); setNotice("");
    try { await writeMany(entries); setNotice(allowed ? "Đã cấp quyền xem nhóm menu và các mục bên trong." : "Đã thu hồi quyền xem nhóm menu và các mục bên trong."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không lưu được quyền nhóm menu."); }
    finally { setSaving(false); }
  }

  async function grantAllPermissions() {
    if (isProtected || !canManage || (view === "users" && !selectedUser)) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await writeMany(permissionEntriesForAll(true));
      setNotice(view === "roles" ? `Đã cấp tất cả quyền cho vai trò ${activeRole?.name ?? selectedRole}.` : "Đã cấp tất cả quyền riêng cho tài khoản.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể cấp tất cả quyền."); }
    finally { setSaving(false); }
  }

  async function clearAllPermissions() {
    if (isProtected || !canManage || (view === "users" && !selectedUser)) return;
    const target = view === "roles" ? `vai trò ${activeRole?.name ?? selectedRole}` : `tài khoản ${selectedPerson?.display_name ?? selectedPerson?.username ?? "đang chọn"}`;
    if (!window.confirm(`Thu hồi tất cả quyền của ${target}? Người dùng sẽ không còn truy cập các menu và chức năng được phân quyền.`)) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await writeMany(permissionEntriesForAll(false));
      setNotice(view === "roles" ? `Đã thu hồi tất cả quyền của ${target}.` : `Đã thu hồi tất cả quyền riêng của ${target}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể thu hồi tất cả quyền."); }
    finally { setSaving(false); }
  }

  async function resetRolePermissions() {
    if (!supabase || !canManage || view !== "roles") return;
    setSaving(true); setError(""); setNotice("");
    const { error: resetError } = await supabase.rpc("reset_role_permissions");
    if (resetError) setError(resetError.message);
    else {
      const { data } = await supabase.from("role_module_permissions").select("role_key,module_key,action_key,allowed");
      const next = Object.fromEntries((data ?? []).map((row) => [`${row.role_key}:${permissionKey(row.module_key, row.action_key)}`, row.allowed]));
      setRolePermissions(next);
      setMatrix(Object.fromEntries((data ?? []).filter((row) => row.role_key === selectedRole).map((row) => [permissionKey(row.module_key, row.action_key), row.allowed])));
      setNotice("Đã khôi phục quyền mặc định theo vai trò.");
    }
    setSaving(false);
  }

  const filteredPeople = people.filter((person) => (accountRoleFilter === "all" || person.role_key === accountRoleFilter) && `${person.display_name} ${person.username ?? ""} ${person.role_key} ${person.phone ?? ""} ${person.department ?? ""}`.toLocaleLowerCase("vi-VN").includes(accountSearch.trim().toLocaleLowerCase("vi-VN")));
  const sortedPeople = sortTableRows(filteredPeople, userSort, (person, key, index) => key === "ordinal" ? index : key === "account" ? `${person.display_name} ${person.username ?? ""} ${person.user_id}` : key === "contact" ? person.phone : key === "unit" ? [person.department, person.job_title, person.office].filter(Boolean).join(" · ") : key === "category" ? personCategory(person.role_key) : key === "role" ? permissionRoles.find((item) => item.key === person.role_key)?.name ?? person.role_key : undefined);
  function sortUsersBy(key: string) {
    setUserSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" });
    setUserPage(1);
  }
  const userPageCount = userPageSize === "all" ? 1 : Math.max(1, Math.ceil(filteredPeople.length / Number(userPageSize)));
  const safeUserPage = Math.min(userPage, userPageCount);
  const userPageStart = userPageSize === "all" ? 0 : (safeUserPage - 1) * Number(userPageSize);
  const visiblePeople = userPageSize === "all" ? sortedPeople : sortedPeople.slice(userPageStart, userPageStart + Number(userPageSize));
  const selectedVisiblePeople = filteredPeople.reduce((count, person) => count + Number(selectedPermissionUserIds.has(person.user_id)), 0);
  const allVisiblePeopleSelected = filteredPeople.length > 0 && selectedVisiblePeople === filteredPeople.length;
  const activeRole = permissionRoles.find((role) => role.key === (view === "roles" ? selectedRole : selectedPerson?.role_key));

  return <main className="workspace-page permissions-page">
    <header className="workspace-title-row"><div><p className="workspace-eyebrow">QUẢN TRỊ</p><h1>Phân quyền hệ thống</h1><p>Quản lý quyền theo nhóm menu, từng menu, từng tab và từng thao tác.</p></div></header>
    <div className="permissions-tabs" role="tablist" aria-label="Phạm vi phân quyền">
      <button type="button" role="tab" aria-selected={view === "roles"} className={view === "roles" ? "is-active" : ""} onClick={() => { setView("roles"); setUserPermissionsOpen(false); void selectRole(selectedRole); }}><ShieldCheck size={17} />Theo vai trò</button>
      {(access.superAdmin || access.permissions.accounts?.read === true) && <button type="button" role="tab" aria-selected={view === "users"} className={view === "users" ? "is-active" : ""} onClick={() => { setView("users"); setUserPermissionsOpen(false); setOverrides({}); if (currentUserId && people.some((person) => person.user_id === currentUserId)) void selectUser(currentUserId); else { setSelectedUser(""); setMatrix({}); } }}><UsersRound size={17} />Theo người dùng</button>}
    </div>

    {view === "roles" ? <section className="permissions-role-grid" aria-label="Chọn vai trò">{permissionRoles.map((role) => {
      const Icon = roleIcons[role.key] ?? UsersRound;
      return <button type="button" key={role.key} className={`permissions-role-card ${selectedRole === role.key ? "is-selected" : ""} ${role.key === "super_admin" ? "is-super" : ""}`} onClick={() => void selectRole(role.key)}><span className="permissions-role-icon"><Icon size={19} /></span><strong>{role.name} <small>({role.label})</small></strong><span>{role.description}</span></button>;
    })}</section> : <section className="permissions-users-panel">
      <div className="permissions-users-heading"><div><h2>Phân quyền theo tài khoản</h2><p>Tài khoản nhận quyền theo vai trò được gán. Quyền riêng của người dùng sẽ được ưu tiên.</p></div><label className="permissions-search"><Search size={17} /><input value={accountSearch} onChange={(event) => { setAccountSearch(event.target.value); setUserPage(1); setSelectedPermissionUserIds(new Set()); }} placeholder="Tìm tên hoặc tài khoản" /></label><SearchableFilter className="permissions-role-filter" ariaLabel="Lọc theo phân loại" value={accountRoleFilter} allValue="all" allLabel="Tất cả phân loại" options={permissionRoles.filter((role) => role.key !== "super_admin").map((role) => ({ value: role.key, label: role.name }))} onChange={(value) => { setAccountRoleFilter(value); setUserPage(1); setSelectedPermissionUserIds(new Set()); }} /></div>
      <div className="workspace-data-selection"><label><input type="checkbox" aria-label="Chọn tất cả tài khoản phù hợp" checked={allVisiblePeopleSelected} ref={(element) => { if (element) element.indeterminate = selectedVisiblePeople > 0 && !allVisiblePeopleSelected; }} onChange={(event) => setSelectedPermissionUserIds((previous) => { const next = new Set(previous); filteredPeople.forEach((person) => event.target.checked ? next.add(person.user_id) : next.delete(person.user_id)); return next; })} /> Chọn tất cả {filteredPeople.length.toLocaleString("vi-VN")} dòng phù hợp</label><span>Đã chọn {selectedVisiblePeople.toLocaleString("vi-VN")} / {filteredPeople.length.toLocaleString("vi-VN")} dòng</span><button type="button" disabled={!selectedPermissionUserIds.size} onClick={() => setSelectedPermissionUserIds(new Set())}>Bỏ chọn</button></div><div className="permissions-user-list"><table><thead><tr><th className="gradebook-select-column"><input type="checkbox" aria-label="Chọn tất cả tài khoản phù hợp" checked={allVisiblePeopleSelected} ref={(element) => { if (element) element.indeterminate = selectedVisiblePeople > 0 && !allVisiblePeopleSelected; }} onChange={(event) => setSelectedPermissionUserIds((previous) => { const next = new Set(previous); filteredPeople.forEach((person) => event.target.checked ? next.add(person.user_id) : next.delete(person.user_id)); return next; })} /></th><SortableTableHeader label="STT" sortKey="ordinal" sortState={userSort} onSort={sortUsersBy} /><SortableTableHeader label="TÀI KHOẢN" sortKey="account" sortState={userSort} onSort={sortUsersBy} /><SortableTableHeader label="LIÊN HỆ" sortKey="contact" sortState={userSort} onSort={sortUsersBy} /><SortableTableHeader label="ĐƠN VỊ" sortKey="unit" sortState={userSort} onSort={sortUsersBy} /><SortableTableHeader label="PHÂN LOẠI" sortKey="category" sortState={userSort} onSort={sortUsersBy} /><SortableTableHeader label="VAI TRÒ ĐƯỢC PHÂN QUYỀN" sortKey="role" sortState={userSort} onSort={sortUsersBy} /><th>THÔNG TIN</th></tr></thead><tbody>{visiblePeople.map((person, index) => { const role = permissionRoles.find((item) => item.key === person.role_key); const category = person.role_key === "student" || person.role_key === "class_president" || person.role_key === "class_vice" ? "Sinh viên" : person.role_key === "teacher" ? "Giảng viên" : person.role_key === "assistant" ? "Trợ giảng" : "Quản trị"; const canEditThisAccount = canEditAccounts && (person.role_key !== "super_admin" || (access.superAdmin && person.user_id === currentUserId)); const isEditingPermissions = person.user_id === selectedUser; return <tr key={person.user_id} className={isEditingPermissions ? "is-selected" : ""}><td className="gradebook-select-column"><input type="checkbox" aria-label={`Chọn tài khoản ${person.display_name || person.username || person.user_id}`} checked={selectedPermissionUserIds.has(person.user_id)} onChange={(event) => setSelectedPermissionUserIds((previous) => { const next = new Set(previous); if (event.target.checked) next.add(person.user_id); else next.delete(person.user_id); return next; })} /></td><td>{userPageStart + index + 1}</td><td><strong>{person.display_name || person.username || person.user_id}</strong><small>@{person.username || "—"}</small><small>ID: {person.user_id}</small></td><td>{person.phone || "Chưa cập nhật"}</td><td>{[person.department, person.job_title, person.office].filter(Boolean).join(" · ") || "Chưa gán đơn vị"}</td><td><span className={`permissions-role-badge role-${person.role_key}`}>{category}</span></td><td>{role?.name ?? person.role_key}</td><td><div className="permissions-user-actions">{canEditThisAccount && <button className="permissions-icon-action" type="button" aria-label={`Chỉnh sửa tài khoản ${person.display_name || person.username || ""}`} title="Chỉnh sửa tài khoản" onClick={() => void openAccountEditor(person)}><Pencil size={16} /></button>}<button className={`permissions-icon-action${isEditingPermissions ? " is-active" : ""}`} type="button" aria-label={isEditingPermissions ? "Đang chỉnh quyền" : `Chỉnh sửa quyền ${person.display_name || person.username || ""}`} title={isEditingPermissions ? "Đang chỉnh quyền" : "Chỉnh sửa quyền"} disabled={person.role_key === "super_admin" && !access.superAdmin} onClick={() => { setUserPermissionsOpen(true); void selectUser(person.user_id); }}>{isEditingPermissions ? <ShieldCheck size={16} /> : <Shield size={16} />}</button></div></td></tr>; })}{!filteredPeople.length && <tr><td colSpan={8}>Không có tài khoản phù hợp.</td></tr>}</tbody></table></div><div className="workspace-pagination"><label>Số dòng<select aria-label="Số dòng tài khoản mỗi trang" value={userPageSize} onChange={(event) => { setUserPageSize(event.target.value as "10" | "20" | "50" | "100" | "all"); setUserPage(1); }}><option value="10">10 dòng</option><option value="20">20 dòng</option><option value="50">50 dòng</option><option value="100">100 dòng</option><option value="all">Tất cả</option></select></label><span>{filteredPeople.length ? `Đang hiển thị ${userPageStart + 1}–${Math.min(userPageStart + visiblePeople.length, filteredPeople.length)} / ${filteredPeople.length.toLocaleString("vi-VN")} dòng` : "Đang hiển thị 0–0 / 0 dòng"}</span><div><button type="button" disabled={safeUserPage <= 1} onClick={() => setUserPage((page) => Math.max(1, page - 1))}>Trước</button><span>Trang {safeUserPage} / {userPageCount}</span><button type="button" disabled={safeUserPage >= userPageCount} onClick={() => setUserPage((page) => Math.min(userPageCount, page + 1))}>Sau</button></div></div>
    </section>}

    {editingAccount && <div className="permissions-account-edit-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !accountEditBusy) setEditingAccount(null); }}><section className="permissions-account-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="permissions-account-edit-title"><header><div><h2 id="permissions-account-edit-title">Chỉnh sửa tài khoản</h2><p>ID: {editingAccount.username ? `u-${editingAccount.username}` : editingAccount.user_id} · Ngày tạo: {editingAccount.created_at ? new Date(editingAccount.created_at).toLocaleDateString("vi-VN") : "—"} · {permissionRoles.find((role) => role.key === editingAccount.role_key)?.name ?? editingAccount.role_key}</p></div><button type="button" aria-label="Đóng" disabled={accountEditBusy} onClick={() => setEditingAccount(null)}><X size={20} /></button></header>{accountEditError && <div className="permissions-message is-error" role="alert">{accountEditError}</div>}{accountEditBusy && !accountEditForm.email ? <div className="workspace-loading">Đang tải thông tin tài khoản…</div> : <form onSubmit={(event) => void saveAccountEdit(event)}><div className="permissions-account-edit-grid"><label>Họ tên<input required maxLength={120} value={accountEditForm.name} onChange={(event) => setAccountEditForm((form) => ({ ...form, name: event.target.value }))} /></label><label>Tên đăng nhập<input required minLength={3} maxLength={60} pattern="[A-Za-z0-9._-]+" value={accountEditForm.username} onChange={(event) => setAccountEditForm((form) => ({ ...form, username: event.target.value }))} /></label><label>Email<input required type="email" value={accountEditForm.email} onChange={(event) => setAccountEditForm((form) => ({ ...form, email: event.target.value }))} /></label><label>Số điện thoại<input type="tel" value={accountEditForm.phone} onChange={(event) => setAccountEditForm((form) => ({ ...form, phone: event.target.value }))} /></label><label className="is-wide">Phòng / cơ sở<select value={accountEditForm.office} onChange={(event) => setAccountEditForm((form) => ({ ...form, office: event.target.value }))}><option value="">Chưa gắn phòng / cơ sở</option>{[...new Set(people.map((person) => person.office).filter((office): office is string => Boolean(office)))].map((office) => <option key={office} value={office}>{office}</option>)}{accountEditForm.office && !people.some((person) => person.office === accountEditForm.office) && <option value={accountEditForm.office}>{accountEditForm.office}</option>}</select></label><label className="is-wide">URL ảnh đại diện<input type="url" placeholder="https://…" value={accountEditForm.avatarUrl} onChange={(event) => setAccountEditForm((form) => ({ ...form, avatarUrl: event.target.value }))} /></label></div><footer><button type="button" disabled={accountEditBusy} onClick={() => setEditingAccount(null)}>Hủy</button><button className="workspace-primary" type="submit" disabled={accountEditBusy}><Save size={16} />{accountEditBusy ? "Đang lưu…" : "Lưu thông tin"}</button></footer></form>}</section></div>}



    {(view === "roles" || (view === "users" && userPermissionsOpen && Boolean(selectedUser))) && <div className={view === "users" ? "permissions-matrix-backdrop" : "permissions-matrix-inline"} role={view === "users" ? "presentation" : undefined} onMouseDown={(event) => { if (view === "users" && event.target === event.currentTarget && !saving) setUserPermissionsOpen(false); }}><section className="permissions-matrix-panel" role={view === "users" ? "dialog" : undefined} aria-modal={view === "users" ? true : undefined} aria-labelledby="permissions-matrix-title">
      <header className="permissions-matrix-heading"><div><h2 id="permissions-matrix-title">Ma trận quyền hạn {view === "roles" ? <>cho vai trò: <em>{activeRole?.name ?? selectedRole}</em></> : <>cho tài khoản: <em>{selectedPerson?.display_name || "Chưa chọn"}</em></>}</h2><p>Quyền được áp dụng ngay. Nhóm menu cấp quyền xem cho các menu bên trong; quyền thao tác được cấu hình riêng từng menu.</p></div><div className="permissions-legend"><span><i className="is-allowed" />Cho phép</span><span><i />Không có quyền</span></div>{view === "users" && <button type="button" className="permissions-matrix-close" aria-label="Đóng ma trận quyền" disabled={saving} onClick={() => setUserPermissionsOpen(false)}><X size={18} /></button>}</header>
      {error && <div className="permissions-message is-error" role="alert">{error}</div>}{notice && <div className="permissions-message is-success" role="status">{notice}</div>}
      <label className="permissions-resource-search"><Search size={16} /><input value={resourceSearch} onChange={(event) => setResourceSearch(event.target.value)} placeholder="Tìm nhóm menu, menu hoặc tab" /></label>
      <div className="permissions-matrix-toolbar"><span>{view === "roles" ? "Áp dụng cho toàn bộ quyền của vai trò đang chọn." : "Áp dụng quyền riêng cho toàn bộ menu và chức năng của tài khoản."}</span><div className="permissions-matrix-actions"><button type="button" className="permissions-select-all" disabled={!canManage || saving || isProtected || (view === "users" && (!selectedUser || loadingUserMatrix))} onClick={() => void grantAllPermissions()}><Check size={16} />{saving ? "Đang áp dụng…" : "Chọn tất cả quyền"}</button><button type="button" className="permissions-clear-all" disabled={!canManage || saving || isProtected || (view === "users" && (!selectedUser || loadingUserMatrix))} onClick={() => void clearAllPermissions()}><Trash2 size={16} />{saving ? "Đang xử lý…" : "Xóa tất cả quyền"}</button></div></div>
      {loading || (view === "users" && loadingUserMatrix) ? <div className="workspace-loading">Đang tải ma trận quyền…</div> : <div className="permissions-matrix-scroll"><table className="permissions-matrix-table"><thead><tr><th>NHÓM MENU / CHỨC NĂNG</th>{permissionActions.map((action) => <th key={action.key}>{action.label}</th>)}</tr></thead><tbody>{resourcesByGroup.map((group) => {
        const groupAllowed = isProtected || hasPermission(group.key, "read");
        return <FragmentGroup key={group.key} group={group} groupAllowed={groupAllowed} disabled={!canManage || saving || (view === "users" && !selectedUser) || isProtected} onToggleGroup={(allowed) => void toggleGroup(group.key, allowed)}>
          {group.resources.map((resource) => resource.kind === "module" ? <FragmentModule key={resource.key} resource={resource} matrix={matrix} overrides={overrides} isProtected={isProtected} disabled={!canManage || saving || (view === "users" && !selectedUser)} effectiveResourcePermission={effectiveResourcePermission} onToggle={toggleResource} /> : <FragmentTab key={resource.key} resource={resource} allowed={isProtected || hasPermission(resource.key, "read")} overridden={Object.prototype.hasOwnProperty.call(overrides, permissionKey(resource.key, "read"))} disabled={!canManage || saving || (view === "users" && !selectedUser) || isProtected} onToggle={(allowed) => void toggleResource(resource, "read", allowed)} />)}
        </FragmentGroup>;
      })}</tbody></table></div>}
      <footer className="permissions-matrix-footer"><span>{isProtected ? "Super Admin có toàn quyền và không thể bị chỉnh sửa." : canManage ? "Chọn quyền theo từng menu hoặc cấp quyền xem cả nhóm menu." : "Bạn chỉ có quyền xem ma trận. Liên hệ quản trị viên để thay đổi."}</span>{view === "roles" && canManage && <button type="button" disabled={saving} onClick={() => void resetRolePermissions()}>Khôi phục quyền mặc định</button>}</footer>
    </section></div>}
  </main>;
}

function FragmentGroup({ group, groupAllowed, disabled, onToggleGroup, children }: { group: { key: string; name: string; resources: PermissionResource[] }; groupAllowed: boolean; disabled: boolean; onToggleGroup: (allowed: boolean) => void; children: ReactNode }) {
  return <><tr className="permissions-group-row"><td><strong>{group.name}</strong><small>Nhóm menu · {group.resources.filter((item) => item.kind === "module").length} menu</small></td><td><PermissionToggle label={`${group.name}: xem nhóm`} allowed={groupAllowed} disabled={disabled} onClick={() => onToggleGroup(!groupAllowed)} /></td>{permissionActions.slice(1).map((action) => <td key={action.key}><span className="permissions-not-applicable">—</span></td>)}</tr>{children}</>;
}

function FragmentModule({ resource, isProtected, disabled, effectiveResourcePermission, onToggle }: { resource: PermissionResource; matrix: Record<string, boolean>; overrides: Record<string, boolean>; isProtected: boolean; disabled: boolean; effectiveResourcePermission: (resource: PermissionResource, action: PermissionAction) => boolean; onToggle: (resource: PermissionResource, action: PermissionAction | "import", allowed: boolean) => void }) {
  return <tr className="permissions-module-row"><td><strong>{resource.title}</strong><small>{resource.detail}</small></td>{permissionActions.map((action) => {
    const allowed = isProtected || (action.key === "import" ? effectiveResourcePermission(resource, "create") && effectiveResourcePermission(resource, "update") : action.keys.every((key) => effectiveResourcePermission(resource, key)));
    const available = resource.actions.includes(action.key);
    return <td key={action.key}>{available ? <PermissionToggle label={`${resource.title}: ${action.label}`} allowed={allowed} disabled={disabled || isProtected} onClick={() => onToggle(resource, action.key, !allowed)} /> : <span className="permissions-not-applicable">—</span>}</td>;
  })}</tr>;
}

function FragmentTab({ resource, allowed, overridden, disabled, onToggle }: { resource: PermissionResource; allowed: boolean; overridden: boolean; disabled: boolean; onToggle: (allowed: boolean) => void }) {
  return <tr className="permissions-tab-row"><td><strong>↳ {resource.title}</strong><small>{resource.detail}{overridden ? " · Quyền riêng" : ""}</small></td><td><PermissionToggle label={`${resource.title}: xem tab`} allowed={allowed} disabled={disabled} onClick={() => onToggle(!allowed)} /></td>{permissionActions.slice(1).map((action) => <td key={action.key}><span className="permissions-not-applicable">—</span></td>)}</tr>;
}

function PermissionToggle({ label, allowed, disabled = false, onClick }: { label: string; allowed: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className={`permissions-toggle ${allowed ? "is-allowed" : "is-denied"}`} aria-label={label} aria-pressed={allowed} disabled={disabled} onClick={onClick}>{allowed ? <Check size={15} /> : <X size={15} />}</button>;
}
