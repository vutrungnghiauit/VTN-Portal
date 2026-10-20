import { supabase } from "../../lib/supabase";

export type SupportTicket = { id: string; student_user_id: string; teacher_id: string; title: string; description: string; category: string; status: "pending" | "in_progress" | "completed"; created_at: string; deleted_at?: string | null; purge_at?: string | null };
function db() { if (!supabase) throw new Error("Supabase chưa được cấu hình."); return supabase; }

export const supportTicketService = {
  async list() {
    const { data, error } = await db().from("support_tickets").select("id,student_user_id,teacher_id,title,description,category,status,created_at,deleted_at,purge_at").is("deleted_at", null).order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as SupportTicket[];
  },
  async listTrash() {
    const rows: SupportTicket[] = [];
    const pageSize = 500;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db().from("support_tickets").select("id,student_user_id,teacher_id,title,description,category,status,created_at,deleted_at,purge_at").not("deleted_at", "is", null).order("deleted_at", { ascending: false }).range(from, from + pageSize - 1);
      if (error) throw error;
      const page = (data ?? []) as SupportTicket[];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return rows;
  },
  async create(input: { title: string; description: string; category: string }) {
    const client = db();
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user) throw authError ?? new Error("Phiên đăng nhập đã hết hạn.");
    const { data: studentRecords, error: studentError } = await client.from("students").select("owner_id").eq("auth_user_id", auth.user.id).is("deleted_at", null);
    if (studentError) throw new Error("Tài khoản sinh viên chưa được liên kết với giảng viên phụ trách.");
    const teacherIds = [...new Set((studentRecords ?? []).map((student) => student.owner_id))];
    if (!teacherIds.length) throw new Error("Tài khoản sinh viên chưa được liên kết với giảng viên phụ trách.");
    if (teacherIds.length > 1) throw new Error("Hồ sơ của bạn gắn với nhiều giảng viên. Vui lòng liên hệ quản trị viên để chọn giảng viên phụ trách phiếu.");
    const { error } = await client.from("support_tickets").insert({ student_user_id: auth.user.id, teacher_id: teacherIds[0], ...input });
    if (error) throw error;
  },
  async updateStatus(id: string, status: SupportTicket["status"]) {
    const { error } = await db().from("support_tickets").update({ status }).eq("id", id);
    if (error) throw error;
  },
  async update(id: string, input: { title: string; description: string; category: string }) {
    const { error } = await db().from("support_tickets").update(input).eq("id", id);
    if (error) throw error;
  },
  async moveToTrash(id: string) {
    const { error } = await db().from("support_tickets").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
  },
  async restore(id: string) {
    const { error } = await db().from("support_tickets").update({ deleted_at: null }).eq("id", id);
    if (error) throw error;
  },
  async deletePermanently(id: string) {
    const { error } = await db().from("support_tickets").delete().eq("id", id);
    if (error) throw error;
  },
};
