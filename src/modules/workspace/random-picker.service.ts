import { supabase } from "../../lib/supabase";

export type RandomHistory = {
  id: string; draw_type: string; student_id: string | null; student_code: string | null; student_name: string | null;
  class_name: string | null; attendance_status: "present" | "absent" | null; drawn_on: string; results: Record<string, unknown>; created_at: string;
};

function client() { if (!supabase) throw new Error("Supabase chưa được cấu hình."); return supabase; }

export const randomPickerService = {
  async history(limit = 100) {
    const { data, error } = await client().from("random_picker_history").select("id,draw_type,student_id,student_code,student_name,class_name,attendance_status,drawn_on,results,created_at").order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return (data ?? []) as RandomHistory[];
  },
  async save(input: { draw_type: string; student_id?: string | null; student_code?: string | null; student_name?: string | null; class_name?: string | null; attendance_status?: "present" | "absent" | null; results?: Record<string, unknown> }) {
    const { data, error } = await client().from("random_picker_history").insert(input).select("id,draw_type,student_id,student_code,student_name,class_name,attendance_status,drawn_on,results,created_at").single();
    if (error) throw error;
    return data as RandomHistory;
  },
  async setAttendance(id: string, status: "present" | "absent") {
    const { error } = await client().from("random_picker_history").update({ attendance_status: status }).eq("id", id);
    if (error) throw error;
  },
};
