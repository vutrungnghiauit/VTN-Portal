import { supabase } from "../../lib/supabase";

export type SurveyRatingSummary = { averageRating: number; responseCount: number };
export type SurveyAnswerValue = string | number | boolean | null | SurveyAnswerValue[] | { [key: string]: SurveyAnswerValue };
export type SurveyAnswerFile = { path: string; name: string; type: string; size: number; url: string | null };
export type SurveyResponse = {
  survey_id: string;
  respondent_id: string;
  rating: number;
  answers: Record<string, SurveyAnswerValue>;
  comment: string;
  respondent_name: string;
  class_name: string;
  created_at: string;
};

const responseFilesBucket = "vtn-survey-response-files";

function isAnswerFile(value: unknown): value is SurveyAnswerFile {
  return Boolean(value && typeof value === "object" && "path" in value && typeof value.path === "string" && "name" in value && typeof value.name === "string");
}

export const surveyService = {
  async mySurveyIds(surveyIds: string[]) {
    if (!surveyIds.length) return [] as string[];
    if (!supabase) throw new Error("Chưa cấu hình Supabase.");
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!authData.user) throw new Error("Phiên đăng nhập đã hết hạn.");
    const { data, error } = await supabase.from("survey_responses").select("survey_id")
      .eq("respondent_id", authData.user.id).in("survey_id", surveyIds);
    if (error) throw new Error(error.message);
    return [...new Set((data ?? []).map((row) => String(row.survey_id)))];
  },

  async myRatings(surveyIds: string[]) {
    if (!surveyIds.length) return {} as Record<string, number>;
    if (!supabase) throw new Error("Chưa cấu hình Supabase.");
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!authData.user) throw new Error("Phiên đăng nhập đã hết hạn.");
    const { data, error } = await supabase.from("survey_responses").select("survey_id,rating")
      .eq("respondent_id", authData.user.id).in("survey_id", surveyIds);
    if (error) throw new Error(error.message);
    return Object.fromEntries((data ?? []).map((row) => [row.survey_id, Number(row.rating)])) as Record<string, number>;
  },

  async submitRating(surveyId: string, rating: number) {
    if (!supabase) throw new Error("Chưa cấu hình Supabase.");
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!authData.user) throw new Error("Phiên đăng nhập đã hết hạn.");
    const { error } = await supabase.from("survey_responses").upsert({ survey_id: surveyId, respondent_id: authData.user.id, rating }, { onConflict: "survey_id,respondent_id" });
    if (error) throw new Error(error.message);
  },

  async currentUser() {
    if (!supabase) throw new Error("Chưa cấu hình Supabase.");
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (!data.user) throw new Error("Phiên đăng nhập đã hết hạn.");
    return { id: data.user.id, name: String(data.user.user_metadata?.full_name ?? data.user.user_metadata?.name ?? data.user.email ?? "Sinh viên") };
  },

  async responses(surveyId: string): Promise<SurveyResponse[]> {
    if (!supabase) throw new Error("Chưa cấu hình Supabase.");
    const client = supabase;
    const { data, error } = await client.from("survey_responses")
      .select("survey_id,respondent_id,rating,answers,comment,respondent_name,class_name,created_at")
      .eq("survey_id", surveyId).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return await Promise.all((data ?? []).map(async (row) => {
      const answers = (row.answers ?? {}) as Record<string, SurveyAnswerValue>;
      for (const [questionId, value] of Object.entries(answers)) {
        if (!Array.isArray(value) || !value.every(isAnswerFile)) continue;
        answers[questionId] = await Promise.all(value.map(async (file) => {
          const { data: signed } = await client.storage.from(responseFilesBucket).createSignedUrl(file.path, 60 * 60);
          return { ...file, url: signed?.signedUrl ?? null };
        }));
      }
      return {
        ...row,
        rating: Number(row.rating ?? 0),
        answers,
        comment: String(row.comment ?? ""),
        respondent_name: String(row.respondent_name ?? "Sinh viên"),
        class_name: String(row.class_name ?? ""),
      } as SurveyResponse;
    }));
  },

  async uploadResponseFiles(surveyId: string, questionId: string, files: File[]): Promise<SurveyAnswerFile[]> {
    if (!supabase) throw new Error("Chưa cấu hình Supabase.");
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!authData.user) throw new Error("Phiên đăng nhập đã hết hạn.");
    const selected = files.slice(0, 5);
    const oversized = selected.find((file) => file.size > 10 * 1024 * 1024);
    if (oversized) throw new Error(`Tệp ${oversized.name} vượt quá 10 MB.`);
    const uploaded: SurveyAnswerFile[] = [];
    for (const file of selected) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-100) || "tep-dinh-kem";
      const path = `${surveyId}/${authData.user.id}/${questionId}/${crypto.randomUUID()}-${safeName}`;
      const { error } = await supabase.storage.from(responseFilesBucket).upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
      if (error) throw new Error(error.message);
      uploaded.push({ path, name: file.name, type: file.type || "application/octet-stream", size: file.size, url: null });
    }
    return uploaded;
  },

  async submitAnswers(input: {
    surveyId: string;
    answers: Record<string, SurveyAnswerValue>;
    comment: string;
    rating: number;
    respondentName: string;
    className?: string;
  }) {
    if (!supabase) throw new Error("Chưa cấu hình Supabase.");
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!authData.user) throw new Error("Phiên đăng nhập đã hết hạn.");
    const { error } = await supabase.from("survey_responses").upsert({
      survey_id: input.surveyId,
      respondent_id: authData.user.id,
      rating: Math.min(5, Math.max(1, Math.round(input.rating))),
      answers: input.answers,
      comment: input.comment,
      respondent_name: input.respondentName,
      class_name: input.className ?? "",
    }, { onConflict: "survey_id,respondent_id" });
    if (error) throw new Error(error.message);
  },

  async moveToTrash(surveyId: string) {
    if (!supabase) throw new Error("Chưa cấu hình Supabase.");
    const client = supabase;
    const { error } = await client.rpc("set_survey_trash_state", { p_id: surveyId });
    if (error) throw new Error(error.message);
  },

  async ratingSummary(): Promise<SurveyRatingSummary> {
    if (!supabase) throw new Error("Chưa cấu hình Supabase.");
    const { data, error } = await supabase.rpc("get_survey_rating_summary");
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return { averageRating: Number(row?.average_rating ?? 0), responseCount: Number(row?.response_count ?? 0) };
  },

  subscribeToRatings(onChange: () => void) {
    if (!supabase) return () => undefined;
    const client = supabase;
    const channel = client.channel("survey-rating-summary")
      .on("postgres_changes", { event: "*", schema: "public", table: "survey_responses" }, onChange)
      .subscribe();
    return () => { void client.removeChannel(channel); };
  },
};
