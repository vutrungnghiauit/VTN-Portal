import { isSupabaseConfigured, supabase } from "../../lib/supabase";

export type WorkspaceRecord = { id: string; module_key: string; external_id?: string | null; owner_id?: string; data: Record<string, string | number | null>; created_at: string; updated_at: string; deleted_at: string | null; purge_at: string | null };

function db() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Chưa cấu hình Supabase. Kiểm tra .env.local rồi khởi động lại ứng dụng.");
  return supabase;
}

async function userId() {
  const { data, error } = await db().auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
  return data.user.id;
}

export const workspaceService = {
  async list(moduleKey: string, includeDeleted = false) {
    await userId();
    const rows: WorkspaceRecord[] = [];
    const pageSize = 500;
    for (let from = 0; ; from += pageSize) {
      let query = db().from("workspace_records").select("id, module_key, external_id, owner_id, data, created_at, updated_at, deleted_at, purge_at").eq("module_key", moduleKey).order("updated_at", { ascending: false }).order("id", { ascending: true });
      query = includeDeleted ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
      const { data, error } = await query.range(from, from + pageSize - 1);
      if (error) throw new Error(error.code === "42P01" || error.code === "PGRST205" ? "Chưa tạo bảng workspace_records. Hãy chạy supabase/workspace.sql trong SQL Editor." : error.message);
      const page = (data ?? []) as WorkspaceRecord[];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return rows;
  },

  async listTrash() {
    await userId();
    const rows: WorkspaceRecord[] = [];
    const pageSize = 500;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db().from("workspace_records").select("id, module_key, external_id, data, created_at, updated_at, deleted_at, purge_at").not("deleted_at", "is", null).order("deleted_at", { ascending: false }).range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as WorkspaceRecord[];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return rows;
  },

  async allRecords() {
    await userId();
    const { data, error } = await db().from("workspace_records").select("id, module_key, external_id, data, created_at, updated_at, deleted_at, purge_at").order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as WorkspaceRecord[];
  },

  async save(moduleKey: string, values: Record<string, string | number | null>, id?: string, externalId?: string) {
    const ownerId = await userId();
    const { data, error } = id
      ? await db().from("workspace_records").update({ data: values, ...(externalId ? { external_id: externalId } : {}) }).eq("id", id).select("id, module_key, external_id, data, created_at, updated_at, deleted_at, purge_at").single()
      : await db().from("workspace_records").insert({ module_key: moduleKey, owner_id: ownerId, data: values, ...(externalId ? { external_id: externalId } : {}) }).select("id, module_key, external_id, data, created_at, updated_at, deleted_at, purge_at").single();
    if (error) throw new Error(error.message);
    return data as WorkspaceRecord;
  },

  async saveMany(moduleKey: string, records: Array<{ values: Record<string, string | number | null>; externalId: string }>) {
    if (!records.length) return [] as WorkspaceRecord[];
    const ownerId = await userId();
    const { data, error } = await db().from("workspace_records").upsert(
      records.map(({ values, externalId }) => ({ owner_id: ownerId, module_key: moduleKey, external_id: externalId, data: values })),
      { onConflict: "owner_id,module_key,external_id" },
    ).select("id, module_key, external_id, data, created_at, updated_at, deleted_at, purge_at");
    if (error) throw new Error(error.message);
    return (data ?? []) as WorkspaceRecord[];
  },

  async moveToTrash(id: string) {
    await userId();
    const { error } = await db().rpc("set_workspace_trash_state", { p_id: id, p_restore: false });
    if (error) throw new Error(error.message);
  },

  async restore(id: string) {
    await userId();
    const { error } = await db().rpc("set_workspace_trash_state", { p_id: id, p_restore: true });
    if (error) throw new Error(error.message);
  },

  async deletePermanently(id: string) {
    await userId();
    const { error } = await db().from("workspace_records").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },

  async counts() {
    await userId();
    const { data, error } = await db().from("workspace_records").select("module_key").is("deleted_at", null);
    if (error) throw new Error(error.message);
    return (data ?? []).reduce<Record<string, number>>((result, row) => { result[row.module_key] = (result[row.module_key] ?? 0) + 1; return result; }, {});
  },

  async purgeExpired() {
    await userId();
    const { data, error } = await db().rpc("purge_expired_trash");
    if (error) throw new Error(error.message);
    return Number(data ?? 0);
  },
};
