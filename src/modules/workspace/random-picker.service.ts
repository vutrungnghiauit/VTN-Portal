import { supabase } from "../../lib/supabase";

export type RandomHistory = {
  id: string; draw_type: string; student_id: string | null; student_code: string | null; student_name: string | null;
  class_name: string | null; attendance_status: "present" | "absent" | null; drawn_on: string; results: Record<string, unknown>; created_at: string;
};

export type RandomHistoryPage = { items: RandomHistory[]; total: number };
export type RandomQuestion = { id: string; topic_id: string; title: string; question: string };
export type RandomQuestionTopic = { id: string; name: string; activity_type: string; questions: RandomQuestion[] };

function client() { if (!supabase) throw new Error("Supabase chưa được cấu hình."); return supabase; }

export const randomPickerService = {
  async questionBank(activityType = "oral_question"): Promise<RandomQuestionTopic[]> {
    const database = client();
    const { data: topics, error: topicError } = await database.from("random_picker_topics").select("id,name,activity_type").eq("activity_type", activityType).is("deleted_at", null).order("name");
    if (topicError) throw topicError;
    const topicRows = (topics ?? []) as Array<{ id: string; name: string; activity_type: string }>;
    const topicIds = topicRows.map((topic) => topic.id);
    const { data: questions, error: questionError } = topicIds.length
      ? await database.from("random_picker_questions").select("id,topic_id,title,question").in("topic_id", topicIds).is("deleted_at", null).order("created_at", { ascending: true })
      : { data: [], error: null };
    if (questionError) throw questionError;
    const questionRows = (questions ?? []) as RandomQuestion[];
    return topicRows.map((topic) => ({
      ...topic,
      questions: questionRows.filter((question) => question.topic_id === topic.id),
    }));
  },
  async createQuestionTopic(name: string, activityType = "oral_question") {
    const { data, error } = await client().from("random_picker_topics").insert({ name: name.trim(), activity_type: activityType }).select("id,name,activity_type").single();
    if (error) throw error;
    return data as { id: string; name: string; activity_type: string };
  },
  async updateQuestionTopic(id: string, name: string) {
    const { error } = await client().from("random_picker_topics").update({ name: name.trim() }).eq("id", id);
    if (error) throw error;
  },
  async deleteQuestionTopic(id: string) {
    const { error } = await client().rpc("set_system_trash_state", { p_entity_type: "random_picker_topics", p_entity_id: id, p_restore: false });
    if (error) throw error;
  },
  async createQuestion(topicId: string, question: string, title = "") {
    const { error } = await client().from("random_picker_questions").insert({ topic_id: topicId, title: title.trim(), question: question.trim() });
    if (error) throw error;
  },
  async updateQuestion(id: string, topicId: string, question: string, title = "") {
    const { error } = await client().from("random_picker_questions").update({ topic_id: topicId, title: title.trim(), question: question.trim() }).eq("id", id);
    if (error) throw error;
  },
  async deleteQuestion(id: string) {
    const { error } = await client().rpc("set_system_trash_state", { p_entity_type: "random_picker_questions", p_entity_id: id, p_restore: false });
    if (error) throw error;
  },
  async history(offset = 0, limit = 20, drawType?: string): Promise<RandomHistoryPage> {
    let query = client().from("random_picker_history").select("id,draw_type,student_id,student_code,student_name,class_name,attendance_status,drawn_on,results,created_at", { count: "exact" }).is("deleted_at", null);
    if (drawType) query = query.eq("draw_type", drawType);
    const { data, count, error } = await query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);
    if (error) throw error;
    return { items: (data ?? []) as RandomHistory[], total: count ?? 0 };
  },
  async allHistory(drawType?: string): Promise<RandomHistoryPage> {
    const items: RandomHistory[] = [];
    let offset = 0;
    let total = 0;
    do {
      const page = await this.history(offset, 500, drawType);
      items.push(...page.items);
      total = page.total;
      offset += page.items.length;
    } while (offset < total && offset > 0);
    return { items, total };
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
  async updateNote(id: string, results: Record<string, unknown>) {
    const { error } = await client().from("random_picker_history").update({ results }).eq("id", id);
    if (error) throw error;
  },
  async deleteHistory(ids: string[]) {
    if (!ids.length) return;
    const results = await Promise.all(ids.map((id) => client().rpc("set_system_trash_state", { p_entity_type: "random_picker_history", p_entity_id: id, p_restore: false })));
    const failure = results.find((result) => result.error)?.error;
    if (failure) throw failure;
  },
};
