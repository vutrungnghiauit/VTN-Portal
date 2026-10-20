import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import type { AuditLog } from "./audit-log.types";

export const auditLogService = {
  async list(): Promise<AuditLog[]> {
    if (!isSupabaseConfigured || !supabase) throw new Error("Chưa cấu hình Supabase.");
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!auth.user) throw new Error("Phiên đăng nhập đã hết hạn.");
    const { data, error } = await supabase.from("system_audit_logs").select("id, actor_id, subject_user_id, module_key, action, source_table, record_id, record_label, details, ip_address, event_at").is("deleted_at", null).order("event_at", { ascending: false }).limit(500);
    if (error) throw new Error(error.code === "42P01" || error.code === "PGRST205" ? "Chưa tạo nhật ký. Hãy chạy supabase/audit.sql trong Supabase SQL Editor." : error.message);
    return (data ?? []) as AuditLog[];
  },
};
