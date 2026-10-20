import { supabase } from "../../lib/supabase";

export type SupportTicketStatus = "pending" | "assigned" | "in_progress" | "completed";
export type SupportTicketPriority = "low" | "normal" | "high" | "urgent";
export type SupportTicket = {
  id: string;
  ticket_code: string | null;
  student_user_id: string | null;
  student_record_id: string | null;
  teacher_id: string;
  created_by: string | null;
  creator_name: string | null;
  student_code: string | null;
  student_name: string | null;
  location: string | null;
  room: string | null;
  title: string;
  description: string;
  category: string;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_role: string | null;
  image_path: string | null;
  created_at: string;
  deleted_at?: string | null;
  purge_at?: string | null;
};

export type SupportTicketEvent = {
  id: string;
  ticket_id: string;
  event_type: "submitted" | "assigned" | "status_changed" | "note";
  status: SupportTicketStatus | null;
  message: string;
  actor_id: string | null;
  actor_name: string;
  created_at: string;
};
export type SupportTicketAssignee = { user_id: string; display_name: string; role_key: string; role_label: string };
export type SupportTicketStudent = { student_record_id: string; student_code: string; student_name: string; class_name: string };

const ticketColumns = "id,ticket_code,student_user_id,student_record_id,teacher_id,created_by,creator_name,student_code,student_name,location,room,title,description,category,priority,status,assignee_id,assignee_name,assignee_role,image_path,created_at,deleted_at,purge_at";
const attachmentBucket = "vtn-source-files";
function db() {
  if (!supabase) throw new Error("Supabase chưa được cấu hình.");
  return supabase;
}

export const supportTicketService = {
  async list() {
    const { data, error } = await db().from("support_tickets").select(ticketColumns).is("deleted_at", null).order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as SupportTicket[];
  },
  async listTrash() {
    const rows: SupportTicket[] = [];
    const pageSize = 500;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db().from("support_tickets").select(ticketColumns).not("deleted_at", "is", null).order("deleted_at", { ascending: false }).range(from, from + pageSize - 1);
      if (error) throw error;
      const page = (data ?? []) as SupportTicket[];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return rows;
  },
  async searchStudents(query: string): Promise<SupportTicketStudent[]> {
    if (query.trim().length < 2) return [];
    const { data, error } = await db().rpc("search_support_ticket_students", { p_query: query.trim() });
    if (error) throw error;
    return (data ?? []) as SupportTicketStudent[];
  },
  async create(input: { title: string; description: string; category: string; priority: SupportTicketPriority; studentCode?: string; studentRecordId?: string; location?: string; room: string; image?: File | null }) {
    const client = db();
    if (input.image && !input.image.type.startsWith("image/")) throw new Error("Tệp đính kèm phải là định dạng hình ảnh.");
    if (input.image && input.image.size > 12 * 1024 * 1024) throw new Error("Ảnh đính kèm không được vượt quá 12 MB.");
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user) throw authError ?? new Error("Phiên đăng nhập đã hết hạn.");
    const { data, error } = await client.rpc("create_support_ticket", {
      p_title: input.title.trim(),
      p_description: input.description.trim(),
      p_category: input.category,
      p_priority: input.priority,
      p_student_code: input.studentCode?.trim() || null,
      p_location: input.location?.trim() || null,
      p_room: input.room?.trim() || null,
      p_student_record_id: input.studentRecordId || null,
    });
    if (error) throw error;
    const ticketId = String(data);
    if (input.image) {
      const safeName = input.image.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-100) || "anh-dinh-kem";
      const path = `${auth.user.id}/${ticketId}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await client.storage.from(attachmentBucket).upload(path, input.image, { upsert: false, contentType: input.image.type });
      if (!uploadError) {
        const { error: updateError } = await client.rpc("set_support_ticket_image", { p_ticket_id: ticketId, p_image_path: path, p_file_name: input.image.name, p_content_type: input.image.type || "application/octet-stream", p_size: input.image.size });
        if (!updateError) return { ticketId, attachmentSaved: true };
        await client.storage.from(attachmentBucket).remove([path]).catch(() => undefined);
        return { ticketId, attachmentSaved: false };
      }
      return { ticketId, attachmentSaved: false };
    }
    return { ticketId, attachmentSaved: true };
  },
  async listEvents(ticketId: string) {
    const { data, error } = await db().from("support_ticket_events").select("id,ticket_id,event_type,status,message,actor_id,actor_name,created_at").eq("ticket_id", ticketId).order("created_at", { ascending: true }).order("id", { ascending: true });
    if (error) throw error;
    return (data ?? []) as SupportTicketEvent[];
  },
  async listAssignees() {
    const { data, error } = await db().rpc("list_support_ticket_assignees");
    if (error) throw error;
    return (data ?? []) as SupportTicketAssignee[];
  },
  async signedImageUrl(path: string) {
    const { data, error } = await db().storage.from(attachmentBucket).createSignedUrl(path, 60 * 60);
    if (error) throw error;
    return data.signedUrl;
  },
  async updateProgress(input: { ticketId: string; status: SupportTicketStatus; assigneeId: string | null; note: string }) {
    const { error } = await db().rpc("update_support_ticket_progress", {
      p_ticket_id: input.ticketId,
      p_status: input.status,
      p_assignee_id: input.assigneeId,
      p_note: input.note.trim() || null,
    });
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
  async deletePermanently(id: string, expiredOnly = false) {
    const { data, error } = await db().functions.invoke("swift-api", { body: { action: "purge-support-ticket", userId: id, expiredOnly } });
    if (error) throw error;
    if (data?.error) throw new Error(String(data.error));
  },
};
