import { isSupabaseConfigured, supabase } from "../../lib/supabase";

export type AppNotification = { id: string; title: string; body: string; severity: "normal" | "important" | "urgent"; scope: "school" | "class"; class_name: string | null; created_at: string; read_at: string | null };

function db() { if (!isSupabaseConfigured || !supabase) throw new Error("Chưa cấu hình Supabase."); return supabase; }

export const notificationService = {
  async inbox() {
    const { data, error } = await db().from("app_notification_recipients").select("notification_id, read_at, app_notifications(id,title,body,severity,scope,class_name,created_at)").order("notification_id", { ascending: false }).limit(100);
    if (error) throw new Error(error.code === "42P01" || error.code === "PGRST205" ? "Chưa tạo hệ thống thông báo. Hãy chạy supabase/notifications.sql." : error.message);
    return (data ?? []).flatMap((row) => {
      const notice = row.app_notifications as unknown as Omit<AppNotification, "read_at"> | null;
      return notice ? [{ ...notice, read_at: row.read_at } satisfies AppNotification] : [];
    }).sort((a,b) => b.created_at.localeCompare(a.created_at));
  },
  async markRead(id: string) {
    const { error } = await db().from("app_notification_recipients").update({ read_at: new Date().toISOString() }).eq("notification_id", id);
    if (error) throw new Error(error.message);
  },
  async markAllRead() {
    const { error } = await db().from("app_notification_recipients").update({ read_at: new Date().toISOString() }).is("read_at", null);
    if (error) throw new Error(error.message);
  },
  async publish(values: { title: string; body: string; severity: string; scope: string; className?: string }) {
    const { error } = await db().rpc("publish_app_notification", { p_title: values.title, p_body: values.body, p_severity: values.severity, p_scope: values.scope, p_class_name: values.className || null });
    if (error) throw new Error(error.message);
  },
};
