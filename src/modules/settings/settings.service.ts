import { isSupabaseConfigured, supabase } from "../../lib/supabase";

export type SystemSettings = Record<string, string | number>;
export type SystemBackup = { id: string; reason: string; snapshot: { settings: SystemSettings }; created_at: string };
function db() { if (!isSupabaseConfigured || !supabase) throw new Error("Chưa cấu hình Supabase."); return supabase; }

export const settingsService = {
  async get(): Promise<SystemSettings> {
    const { data, error } = await db().from("system_settings").select("data").eq("id", true).single();
    if (error) throw new Error(error.code === "42P01" || error.code === "PGRST205" ? "Chưa tạo cài đặt hệ thống. Hãy chạy supabase/system-settings.sql." : error.message);
    return (data?.data ?? {}) as SystemSettings;
  },
  async save(data: SystemSettings) {
    const { error } = await db().rpc("save_system_settings", { p_data: data });
    if (error) throw new Error(error.message);
  },
  async backups(): Promise<SystemBackup[]> {
    const { data, error } = await db().from("system_backups").select("id, reason, snapshot, created_at").is("deleted_at", null).order("created_at", { ascending: false }).limit(30);
    if (error) throw new Error(error.message);
    return (data ?? []) as SystemBackup[];
  },
  async createBackup(reason = "Sao lưu trước khi thay đổi") {
    const { error } = await db().rpc("create_system_settings_backup", { p_reason: reason });
    if (error) throw new Error(error.message);
  },
  async restoreBackup(id: string) {
    const { error } = await db().rpc("restore_system_settings_backup", { p_backup_id: id });
    if (error) throw new Error(error.message);
  },
};
