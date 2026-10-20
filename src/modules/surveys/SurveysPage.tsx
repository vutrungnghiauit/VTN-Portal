import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { BarChart3, CheckCircle2, Clock3, FileUp, MessageSquareText, Pencil, Plus, Send, Star, Trash2, Users, X } from "lucide-react";
import { formatDate, formatDateTime } from "../../lib/date-format";
import { formatSemesterLabel } from "../../lib/semester-groups";
import SearchableFilter from "../../components/SearchableFilter";
import { studentService } from "../students/student.service";
import { workspaceService, type WorkspaceRecord } from "../workspace/workspace.service";
import { surveyService, type SurveyAnswerFile, type SurveyAnswerValue, type SurveyResponse } from "../workspace/survey.service";
import { sourceDataService } from "../source-data/source-data.service";
import { extractSurveyResults, type SurveyImportDraft } from "./survey-import";
import "./surveys.css";

type SurveyQuestionType = "likert" | "text" | "short" | "paragraph" | "multiple_choice" | "checkboxes" | "dropdown" | "file_upload" | "linear_scale" | "rating" | "multiple_choice_grid" | "checkbox_grid" | "date" | "time";
type SurveyQuestion = {
  id: string;
  text: string;
  type: SurveyQuestionType;
  required: boolean;
  options?: string[];
  rows?: string[];
  columns?: string[];
  scaleMin?: number;
  scaleMax?: number;
  scaleMinLabel?: string;
  scaleMaxLabel?: string;
};
type SurveyPermissions = { read?: boolean; create: boolean; update: boolean; delete: boolean };
const surveyQuestionTypes: Array<{ value: SurveyQuestionType; label: string }> = [
  { value: "short", label: "Trả lời ngắn" }, { value: "paragraph", label: "Đoạn" },
  { value: "multiple_choice", label: "Trắc nghiệm" }, { value: "checkboxes", label: "Hộp kiểm" },
  { value: "dropdown", label: "Menu thả xuống" }, { value: "file_upload", label: "Tải tệp lên" },
  { value: "linear_scale", label: "Phạm vi tuyến tính" }, { value: "rating", label: "Xếp hạng" },
  { value: "multiple_choice_grid", label: "Lưới trắc nghiệm" }, { value: "checkbox_grid", label: "Lưới hộp kiểm" },
  { value: "date", label: "Ngày" }, { value: "time", label: "Giờ" },
  { value: "likert", label: "Thang đo Likert 5 mức" }, { value: "text", label: "Câu hỏi mở (trả lời bằng văn bản)" },
];
const defaultOptions = () => ["Lựa chọn 1", "Lựa chọn 2"];
const newQuestion = (): SurveyQuestion => ({ id: crypto.randomUUID(), text: "", type: "likert", required: true, options: defaultOptions(), rows: ["Hàng 1", "Hàng 2"], columns: defaultOptions(), scaleMin: 1, scaleMax: 5 });

function isSurveyQuestionType(value: unknown): value is SurveyQuestionType {
  return surveyQuestionTypes.some((item) => item.value === value);
}

function isEmptyAnswer(value: unknown) {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.values(value).every(isEmptyAnswer);
  return typeof value === "string" && !value.trim();
}

function isMissingRequiredAnswer(question: SurveyQuestion, value: SurveyAnswerValue | undefined, hasNewFiles: boolean) {
  if (!question.required || (question.type === "file_upload" && hasNewFiles)) return false;
  if (question.type === "multiple_choice_grid" || question.type === "checkbox_grid") {
    const grid = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return (question.rows ?? []).some((row) => isEmptyAnswer(grid[row]));
  }
  return isEmptyAnswer(value);
}

function answerLabel(value: unknown): string {
  if (Array.isArray(value)) return value.map(answerLabel).filter(Boolean).join(", ");
  if (value && typeof value === "object") {
    if ("name" in value && typeof value.name === "string") return value.name;
    return Object.entries(value).map(([key, answer]) => `${key}: ${answerLabel(answer)}`).join("; ");
  }
  return String(value ?? "");
}

function stripTemporaryAnswerUrls(value: SurveyAnswerValue): SurveyAnswerValue {
  if (Array.isArray(value)) return value.map(stripTemporaryAnswerUrls);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "url").map(([key, item]) => [key, stripTemporaryAnswerUrls(item)]));
  return value;
}

function questionsOf(record?: WorkspaceRecord | null): SurveyQuestion[] {
  if (!record?.data.questions) return [];
  try {
    const value = JSON.parse(String(record.data.questions)) as unknown;
    if (!Array.isArray(value)) return [];
    return value.map((question, index) => {
      const item = question as Partial<SurveyQuestion>;
      const type = isSurveyQuestionType(item.type) ? item.type : "likert";
      return {
        id: String(item.id || `question-${index + 1}`), text: String(item.text ?? ""), type, required: item.required !== false,
        options: Array.isArray(item.options) ? item.options.map(String) : defaultOptions(),
        rows: Array.isArray(item.rows) ? item.rows.map(String) : ["Hàng 1", "Hàng 2"],
        columns: Array.isArray(item.columns) ? item.columns.map(String) : defaultOptions(),
        scaleMin: Number.isFinite(Number(item.scaleMin)) ? Number(item.scaleMin) : 1,
        scaleMax: Number.isFinite(Number(item.scaleMax)) ? Number(item.scaleMax) : 5,
        scaleMinLabel: String(item.scaleMinLabel ?? ""), scaleMaxLabel: String(item.scaleMaxLabel ?? ""),
      };
    });
  } catch { return []; }
}

function dateLabel(value: unknown) {
  const date = String(value ?? "").slice(0, 10);
  return date ? formatDate(date) : "Không giới hạn";
}

function isOpen(record: WorkspaceRecord) {
  const status = String(record.data.status ?? "").toLocaleLowerCase("vi-VN");
  const dueDate = String(record.data.dueDate ?? "").slice(0, 10);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return !["đã kết thúc", "đã đóng", "hoàn thành", "closed"].includes(status) && (!dueDate || dueDate >= today);
}

function allowsStudent(record: WorkspaceRecord) {
  const audience = String(record.data.audience ?? "").trim().toLocaleLowerCase("vi-VN");
  return !audience || audience.includes("sinh viên") || audience.includes("toàn trường") || audience.includes("student");
}

function normalizeSurveyScope(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi-VN").replace(/[^a-z0-9]+/g, " ").trim();
}

function surveyScopeKey(survey: WorkspaceRecord) {
  const owner = String(survey.owner_id ?? "");
  const term = normalizeSurveyScope(survey.data.semesterName) || "__all__";
  const course = normalizeSurveyScope(survey.data.courseName ?? survey.data.title);
  return owner && course ? `${owner}|${term}|${course}` : "";
}

function SurveyEditor({
  initial, semesters, saving, saveError, importDraft, onClose, onSave,
}: {
  initial: WorkspaceRecord | null;
  semesters: string[];
  saving: boolean;
  saveError: string;
  importDraft: SurveyImportDraft | null;
  onClose: () => void;
  onSave: (values: { title: string; description: string; dueDate: string; audience: string; semesterName: string; courseName: string; questions: SurveyQuestion[] }) => void;
}) {
  const [title, setTitle] = useState(String(initial?.data.title ?? importDraft?.fileName.replace(/\.[^.]+$/, "") ?? ""));
  const [description, setDescription] = useState(String(initial?.data.notes ?? (importDraft ? `Khảo sát được khởi tạo từ kết quả nhập: ${importDraft.fileName}` : "")));
  const [dueDate, setDueDate] = useState(String(initial?.data.dueDate ?? ""));
  const [audience, setAudience] = useState(String(initial?.data.audience ?? "Sinh viên"));
  const [semesterName, setSemesterName] = useState(formatSemesterLabel(initial?.data.semesterName, initial?.data.academicYear));
  const [courseName, setCourseName] = useState(String(initial?.data.courseName ?? ""));
  const [questions, setQuestions] = useState<SurveyQuestion[]>(() => {
    const savedQuestions = questionsOf(initial);
    if (savedQuestions.length) return savedQuestions;
    if (importDraft?.questions.length) return importDraft.questions.map(({ id, text, type, required }) => ({ id, text, type, required, options: defaultOptions(), rows: ["Hàng 1", "Hàng 2"], columns: defaultOptions(), scaleMin: 1, scaleMax: 5 }));
    return [newQuestion()];
  });
  const [formError, setFormError] = useState("");

  function updateQuestion(id: string, patch: Partial<SurveyQuestion>) {
    setQuestions((current) => current.map((question) => question.id === id ? { ...question, ...patch } : question));
  }
  function updateQuestionLines(id: string, key: "options" | "rows" | "columns", value: string) {
    updateQuestion(id, { [key]: value.split("\n").map((item) => item.trim()).filter(Boolean) });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const unfinished = questions.findIndex((question) => !question.text.trim());
    if (unfinished >= 0) { setFormError(`Vui lòng nhập nội dung Câu ${unfinished + 1}.`); return; }
    const incompleteChoices = questions.findIndex((question) => ["multiple_choice", "checkboxes", "dropdown"].includes(question.type) && !(question.options ?? []).filter(Boolean).length);
    if (incompleteChoices >= 0) { setFormError(`Vui lòng thêm ít nhất một lựa chọn cho Câu ${incompleteChoices + 1}.`); return; }
    const incompleteGrid = questions.findIndex((question) => ["multiple_choice_grid", "checkbox_grid"].includes(question.type) && (!(question.rows ?? []).filter(Boolean).length || !(question.columns ?? []).filter(Boolean).length));
    if (incompleteGrid >= 0) { setFormError(`Vui lòng nhập ít nhất một hàng và một cột cho Câu ${incompleteGrid + 1}.`); return; }
    const invalidScale = questions.findIndex((question) => ["linear_scale", "rating"].includes(question.type) && (Number(question.scaleMax ?? 5) <= Number(question.scaleMin ?? 1)));
    if (invalidScale >= 0) { setFormError(`Mức kết thúc phải lớn hơn mức bắt đầu ở Câu ${invalidScale + 1}.`); return; }
    setFormError("");
    if (!courseName.trim()) { setFormError("Vui lòng nhập học phần để giới hạn lượt tham gia theo giảng viên và học kỳ."); return; }
    if (!semesterName.trim()) { setFormError("Vui lòng chọn học kỳ áp dụng."); return; }
    onSave({ title: title.trim(), description: description.trim(), dueDate, audience, semesterName, courseName: courseName.trim(), questions });
  }

  return <div className="edu-survey-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="edu-survey-modal" role="dialog" aria-modal="true" aria-labelledby="edu-survey-editor-title">
      <header className="edu-survey-modal-head"><h2 id="edu-survey-editor-title"><Plus size={19} />{initial ? "Chỉnh sửa khảo sát" : "Khởi tạo khảo sát mới"}</h2><button type="button" aria-label="Đóng" onClick={onClose} disabled={saving}><X size={19} /></button></header>
      <form onSubmit={submit}>
        <div className="edu-survey-editor-meta">
          <label className="edu-survey-field edu-survey-field-wide">Tên khảo sát *<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} placeholder="Ví dụ: Khảo sát chất lượng giảng dạy học kỳ 1" required /></label>
          <label className="edu-survey-field">Học phần *<input value={courseName} onChange={(event) => setCourseName(event.target.value)} maxLength={180} placeholder="Tên học phần / môn học" required /></label>
          <label className="edu-survey-field edu-survey-field-wide">Mô tả mục tiêu khảo sát<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={1200} placeholder="Mô tả ngắn gọn nội dung và mục tiêu khảo sát…" /></label>
          <label className="edu-survey-field">Hạn nhận ý kiến<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
          <label className="edu-survey-field">Đối tượng khảo sát<select value={audience} onChange={(event) => setAudience(event.target.value)}><option>Sinh viên</option><option>Sinh viên theo lớp</option><option>Sinh viên theo học phần</option><option>Giảng viên</option><option>Toàn trường</option></select></label>
          <label className="edu-survey-field edu-survey-field-wide">Học kỳ áp dụng *<select value={semesterName} onChange={(event) => setSemesterName(event.target.value)} required><option value="" disabled>Chọn học kỳ</option>{semesters.map((semester) => <option key={semester} value={semester}>{semester}</option>)}</select></label>
        </div>
        <div className="edu-survey-questions-head"><div><strong>Câu hỏi khảo sát</strong><p>Chọn dạng câu hỏi và thiết lập lựa chọn trả lời phù hợp.</p></div><button type="button" className="edu-survey-outline-button" onClick={() => setQuestions((current) => [...current, newQuestion()])}><Plus size={15} />Thêm câu hỏi</button></div>
        {importDraft && <section className="edu-survey-import-preview"><div><strong>Kết quả trích xuất từ {importDraft.fileName}</strong><span>{importDraft.questions.length} câu hỏi · {importDraft.responseCount} câu trả lời được nhận diện</span></div><p>Câu trả lời dưới đây dùng để đối chiếu nội dung nhập. Bạn có thể chỉnh sửa câu hỏi trước khi tạo khảo sát.</p><div className="edu-survey-import-preview-list">{importDraft.questions.map((question, index) => <article key={question.id}><strong>Câu {index + 1}: {question.text}</strong><span>{question.responseCount} câu trả lời{question.answers.length ? ` · ${question.answers.map((answer) => `${answer.value} (${answer.count})`).join("; ")}` : " · Không nhận diện được nội dung câu trả lời"}</span></article>)}</div></section>}
        <div className="edu-survey-question-list">{questions.map((question, index) => <article className="edu-survey-question-editor" key={question.id}>
          <div className="edu-survey-question-title"><strong>Câu {index + 1}</strong><button type="button" aria-label={`Xóa câu ${index + 1}`} onClick={() => setQuestions((current) => current.length > 1 ? current.filter((item) => item.id !== question.id) : current)} disabled={questions.length === 1}>Xóa</button></div>
          <label className="edu-survey-visually-hidden" htmlFor={`survey-question-${question.id}`}>Nội dung câu hỏi {index + 1}</label><input id={`survey-question-${question.id}`} value={question.text} onChange={(event) => updateQuestion(question.id, { text: event.target.value })} placeholder="Nhập nội dung câu hỏi" maxLength={500} required />
          <div className="edu-survey-question-controls"><select aria-label={`Loại câu hỏi ${index + 1}`} value={question.type} onChange={(event) => updateQuestion(question.id, { type: event.target.value as SurveyQuestionType })}>{surveyQuestionTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select><label><input type="checkbox" checked={question.required} onChange={(event) => updateQuestion(question.id, { required: event.target.checked })} />Bắt buộc</label></div>
          {["multiple_choice", "checkboxes", "dropdown"].includes(question.type) && <label className="edu-survey-question-config">Các lựa chọn (mỗi dòng một lựa chọn)<textarea rows={3} value={(question.options ?? defaultOptions()).join("\n")} onChange={(event) => updateQuestionLines(question.id, "options", event.target.value)} placeholder="Lựa chọn 1&#10;Lựa chọn 2" /></label>}
          {["multiple_choice_grid", "checkbox_grid"].includes(question.type) && <div className="edu-survey-grid-config"><label className="edu-survey-question-config">Hàng (mỗi dòng một hàng)<textarea rows={3} value={(question.rows ?? ["Hàng 1", "Hàng 2"]).join("\n")} onChange={(event) => updateQuestionLines(question.id, "rows", event.target.value)} /></label><label className="edu-survey-question-config">Cột (mỗi dòng một cột)<textarea rows={3} value={(question.columns ?? defaultOptions()).join("\n")} onChange={(event) => updateQuestionLines(question.id, "columns", event.target.value)} /></label></div>}
          {["linear_scale", "rating"].includes(question.type) && <div className="edu-survey-scale-config"><label className="edu-survey-question-config">Từ<input type="number" min={0} max={9} value={question.scaleMin ?? 1} onChange={(event) => updateQuestion(question.id, { scaleMin: Number(event.target.value) })} /></label><label className="edu-survey-question-config">Đến<input type="number" min={1} max={10} value={question.scaleMax ?? 5} onChange={(event) => updateQuestion(question.id, { scaleMax: Number(event.target.value) })} /></label><label className="edu-survey-question-config">Nhãn đầu thấp<input value={question.scaleMinLabel ?? ""} maxLength={40} onChange={(event) => updateQuestion(question.id, { scaleMinLabel: event.target.value })} placeholder="Không hài lòng" /></label><label className="edu-survey-question-config">Nhãn đầu cao<input value={question.scaleMaxLabel ?? ""} maxLength={40} onChange={(event) => updateQuestion(question.id, { scaleMaxLabel: event.target.value })} placeholder="Rất hài lòng" /></label></div>}
          {question.type === "file_upload" && <small className="edu-survey-likert-hint">Người tham gia có thể tải tối đa 5 tệp, mỗi tệp không quá 10 MB.</small>}
          {question.type === "likert" && <small className="edu-survey-likert-hint">1: Rất không đồng ý · 2: Không đồng ý · 3: Bình thường · 4: Đồng ý · 5: Rất đồng ý</small>}
        </article>)}</div>
        {(formError || saveError) && <div className="edu-survey-form-error" role="alert">{formError || saveError}</div>}
        <footer className="edu-survey-modal-actions"><button type="button" className="edu-survey-cancel-button" onClick={onClose} disabled={saving}>Hủy bỏ</button><button className="edu-survey-primary-button" disabled={saving}>{saving ? "Đang lưu…" : initial ? "Lưu thay đổi" : "Tạo khảo sát"}</button></footer>
      </form>
    </section>
  </div>;
}

function ResponseForm({
  survey, questions, existing, busy, onSubmit,
}: {
  survey: WorkspaceRecord;
  questions: SurveyQuestion[];
  existing: SurveyResponse | null;
  busy: boolean;
  onSubmit: (answers: Record<string, SurveyAnswerValue>, comment: string, rating: number) => void | Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, SurveyAnswerValue>>(() => existing?.answers ?? {});
  const [selectedFiles, setSelectedFiles] = useState<Record<string, File[]>>({});
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [rating, setRating] = useState(existing?.rating ?? 5);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [validationError, setValidationError] = useState("");
  useEffect(() => { setAnswers(existing?.answers ?? {}); setSelectedFiles({}); setComment(existing?.comment ?? ""); setRating(existing?.rating ?? 5); }, [existing, survey.id]);
  const dueDate = String(survey.data.dueDate ?? "").slice(0, 10);
  const closed = !isOpen(survey);
  if (closed) return <section className="edu-survey-response-form"><div className="edu-survey-section-title"><div><h2><MessageSquareText size={18} />Gửi ý kiến &amp; đánh giá của bạn</h2><p>{String(survey.data.title ?? "")}</p></div></div><div className="edu-survey-closed-notice">Khảo sát đã kết thúc{dueDate ? ` vào ngày ${dateLabel(dueDate)}` : ""}. Không thể gửi hoặc chỉnh sửa phản hồi.</div></section>;

  function setAnswer(questionId: string, value: SurveyAnswerValue) {
    setValidationError("");
    setAnswers((current) => ({ ...current, [questionId]: value }));
  }

  function answerFiles(value: SurveyAnswerValue | undefined): SurveyAnswerFile[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is SurveyAnswerFile => Boolean(item && typeof item === "object" && "path" in item && "name" in item));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploadError) return;
    const missing = questions.find((question) => isMissingRequiredAnswer(question, answers[question.id], Boolean(selectedFiles[question.id]?.length)));
    if (missing) {
      setValidationError(`Vui lòng trả lời Câu ${questions.findIndex((question) => question.id === missing.id) + 1}.`);
      const target = document.getElementById(`response-${missing.id}`);
      target?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>("input, textarea, select, button")?.focus();
      return;
    }
    setUploading(true); setUploadError("");
    try {
      const savedAnswers: Record<string, SurveyAnswerValue> = Object.fromEntries(Object.entries(answers).map(([id, value]) => [id, stripTemporaryAnswerUrls(value)]));
      for (const question of questions.filter((item) => item.type === "file_upload")) {
        const files = selectedFiles[question.id] ?? [];
        if (files.length) savedAnswers[question.id] = await surveyService.uploadResponseFiles(survey.id, question.id, files);
      }
      await onSubmit(savedAnswers, comment, rating);
      setSelectedFiles({});
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : "Không tải được tệp đính kèm.");
    } finally { setUploading(false); }
  }

  return <section className="edu-survey-response-form"><div className="edu-survey-section-title"><div><h2><MessageSquareText size={18} />Gửi ý kiến &amp; đánh giá của bạn</h2><p>{String(survey.data.title ?? "Khảo sát học tập")}</p></div>{dueDate && <span className="edu-survey-due"><Clock3 size={14} />Hạn {dateLabel(dueDate)}</span>}</div>
    {existing && <div className="edu-survey-inline-success"><CheckCircle2 size={16} />Bạn đã gửi phản hồi. Có thể cập nhật trước hạn khảo sát.</div>}
    <form onSubmit={submit}>
      <div className="edu-survey-overall-rating"><strong>Mức độ hài lòng chung của bạn</strong><div className="edu-survey-stars" role="radiogroup" aria-label="Đánh giá chung từ 1 đến 5 sao">{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={`${value} trên 5`} onClick={() => setRating(value)}><Star size={23} fill={rating >= value ? "currentColor" : "none"} /></button>)}<b>{rating}/5</b></div></div>
      {questions.map((question, index) => {
        const answer = answers[question.id];
        const options = (question.options ?? defaultOptions()).filter(Boolean);
        const rows = (question.rows ?? ["Hàng 1", "Hàng 2"]).filter(Boolean);
        const columns = (question.columns ?? defaultOptions()).filter(Boolean);
        const minimum = Math.min(9, Math.max(0, Number(question.scaleMin ?? 1)));
        const maximum = Math.min(10, Math.max(minimum + 1, Number(question.scaleMax ?? 5)));
        const scaleValues = Array.from({ length: maximum - minimum + 1 }, (_, i) => minimum + i);
        const gridAnswer = answer && typeof answer === "object" && !Array.isArray(answer) ? answer as Record<string, SurveyAnswerValue> : {};
        return <fieldset className="edu-survey-answer-question" key={question.id}><legend>{index + 1}. {question.text}{question.required && <span> *</span>}</legend><div id={`response-${question.id}`} className="edu-survey-answer-control">
          {question.type === "likert" && <div className="edu-survey-likert-options">{[1, 2, 3, 4, 5].map((value) => <label key={value} className={Number(answer) === value ? "selected" : ""}><input type="radio" name={question.id} value={value} checked={Number(answer) === value} onChange={() => setAnswer(question.id, value)} /><span>{value}</span><small>{["Rất không đồng ý", "Không đồng ý", "Bình thường", "Đồng ý", "Rất đồng ý"][value - 1]}</small></label>)}</div>}
          {(question.type === "short") && <input type="text" value={typeof answer === "string" ? answer : ""} onChange={(event) => setAnswer(question.id, event.target.value)} placeholder="Câu trả lời của bạn" />}
          {(question.type === "text" || question.type === "paragraph") && <textarea value={typeof answer === "string" ? answer : ""} onChange={(event) => setAnswer(question.id, event.target.value)} rows={question.type === "text" ? 3 : 5} placeholder="Chia sẻ ý kiến của bạn…" />}
          {question.type === "multiple_choice" && <div className="edu-survey-choice-list">{options.map((option) => <label key={option}><input type="radio" name={question.id} checked={answer === option} onChange={() => setAnswer(question.id, option)} /><span>{option}</span></label>)}</div>}
          {question.type === "checkboxes" && <div className="edu-survey-choice-list">{options.map((option) => { const selected = Array.isArray(answer) ? answer : []; return <label key={option}><input type="checkbox" checked={selected.includes(option)} onChange={(event) => setAnswer(question.id, event.target.checked ? [...selected, option] : selected.filter((item) => item !== option))} /><span>{option}</span></label>; })}</div>}
          {question.type === "dropdown" && <select value={typeof answer === "string" ? answer : ""} onChange={(event) => setAnswer(question.id, event.target.value)}><option value="">Chọn câu trả lời</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>}
          {question.type === "file_upload" && <div className="edu-survey-file-answer"><input type="file" multiple accept="*/*" onChange={(event) => { const chosen = Array.from(event.target.files ?? []); const files = chosen.slice(0, 5); const oversized = files.find((file) => file.size > 10 * 1024 * 1024); setValidationError(""); setUploadError(chosen.length > 5 ? "Mỗi câu hỏi chỉ nhận tối đa 5 tệp." : oversized ? `Tệp ${oversized.name} vượt quá 10 MB.` : ""); setSelectedFiles((current) => ({ ...current, [question.id]: chosen.length > 5 || oversized ? [] : files })); }} /><small>Tối đa 5 tệp, mỗi tệp không quá 10 MB.</small>{answerFiles(answer).map((file) => <a key={file.path} href={file.url ?? undefined} target="_blank" rel="noreferrer" aria-disabled={!file.url}>{file.name}</a>)}{selectedFiles[question.id]?.map((file) => <span key={`${file.name}-${file.lastModified}`}>{file.name} · {Math.ceil(file.size / 1024)} KB</span>)}</div>}
          {question.type === "linear_scale" && <div className="edu-survey-scale-answer"><div className="edu-survey-scale-buttons">{scaleValues.map((value) => <button type="button" className={Number(answer) === value ? "selected" : ""} key={value} onClick={() => setAnswer(question.id, value)}>{value}</button>)}</div><div className="edu-survey-scale-labels"><span>{question.scaleMinLabel || minimum}</span><span>{question.scaleMaxLabel || maximum}</span></div></div>}
          {question.type === "rating" && <div className="edu-survey-rating-answer" role="radiogroup" aria-label="Chọn mức xếp hạng">{scaleValues.map((value) => <button type="button" role="radio" aria-checked={Number(answer) === value} key={value} onClick={() => setAnswer(question.id, value)}><Star size={22} fill={Number(answer) >= value ? "currentColor" : "none"} /><span>{value}</span></button>)}</div>}
          {(question.type === "multiple_choice_grid" || question.type === "checkbox_grid") && <div className="edu-survey-grid-answer"><table><thead><tr><th></th>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row}><th>{row}</th>{columns.map((column) => { const value = gridAnswer[row]; const selected = Array.isArray(value) ? value : typeof value === "string" ? [value] : []; const checked = selected.includes(column); return <td key={column}><input type={question.type === "checkbox_grid" ? "checkbox" : "radio"} name={`${question.id}-${row}`} aria-label={`${row}: ${column}`} checked={checked} onChange={(event) => { const nextRow = question.type === "checkbox_grid" ? event.target.checked ? [...selected, column] : selected.filter((item) => item !== column) : event.target.checked ? column : ""; setAnswer(question.id, { ...gridAnswer, [row]: nextRow }); }} /></td>; })}</tr>)}</tbody></table></div>}
          {question.type === "date" && <input type="date" value={typeof answer === "string" ? answer : ""} onChange={(event) => setAnswer(question.id, event.target.value)} />}
          {question.type === "time" && <input type="time" value={typeof answer === "string" ? answer : ""} onChange={(event) => setAnswer(question.id, event.target.value)} />}
        </div></fieldset>;
      })}
      <label className="edu-survey-field edu-survey-comment">Góp ý thêm<textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} maxLength={1600} placeholder="Chia sẻ thêm về môn học, phương pháp giảng dạy hoặc trải nghiệm học tập…" /></label>
      {(validationError || uploadError) && <div className="edu-survey-form-error" role="alert">{validationError || uploadError}</div>}
      <div className="edu-survey-submit-row"><small>Phản hồi giúp nhà trường nâng cao chất lượng đào tạo.</small><button className="edu-survey-primary-button" disabled={busy || uploading}><Send size={15} />{uploading ? "Đang tải tệp…" : busy ? "Đang gửi…" : existing ? "Cập nhật phản hồi" : "Gửi khảo sát"}</button></div>
    </form>
  </section>;
}

export default function SurveysPage({ role, mode = "manage", permissions }: { role: string; mode?: "manage" | "participate"; permissions: SurveyPermissions }) {
  const isStudent = ["student", "class_president", "class_vice"].includes(role);
  const isParticipationView = mode === "participate";
  const canViewResults = !isStudent && (permissions.read ?? permissions.update);
  const [surveys, setSurveys] = useState<WorkspaceRecord[]>([]);
  const [respondedSurveyIds, setRespondedSurveyIds] = useState<Set<string>>(() => new Set());
  const [participationFilter, setParticipationFilter] = useState<"all" | "pending" | "completed">("all");
  const [selectedId, setSelectedId] = useState("");
  const [responses, setResponses] = useState<SurveyResponse[]>([]);
  const [myResponse, setMyResponse] = useState<SurveyResponse | null>(null);
  const [userIdentity, setUserIdentity] = useState({ id: "", name: "Sinh viên", className: "" });
  const [semesters, setSemesters] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<WorkspaceRecord | null>(null);
  const [importDraft, setImportDraft] = useState<SurveyImportDraft | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const studentSurveys = useMemo(() => surveys.filter(allowsStudent), [surveys]);
  const completedSurveyIds = useMemo(() => {
    const completed = new Set(respondedSurveyIds);
    const completedScopes = new Set(surveys.filter((survey) => respondedSurveyIds.has(survey.id)).map(surveyScopeKey).filter(Boolean));
    surveys.forEach((survey) => { const scope = surveyScopeKey(survey); if (scope && completedScopes.has(scope)) completed.add(survey.id); });
    return completed;
  }, [surveys, respondedSurveyIds]);
  const visibleParticipationSurveys = useMemo(() => studentSurveys.filter((survey) => participationFilter === "all" || (participationFilter === "completed" ? completedSurveyIds.has(survey.id) : !completedSurveyIds.has(survey.id))), [studentSurveys, participationFilter, completedSurveyIds]);
  const surveyOptions = isParticipationView ? visibleParticipationSurveys : surveys;
  const selectedSurvey = surveyOptions.find((survey) => survey.id === selectedId) ?? surveyOptions[0] ?? null;
  const questions = useMemo(() => questionsOf(selectedSurvey), [selectedSurvey]);
  const openSurveys = useMemo(() => surveys.filter(isOpen), [surveys]);
  const canRespond = isParticipationView && isStudent && permissions.read && Boolean(selectedSurvey)
    && (myResponse ? permissions.update : permissions.create && !completedSurveyIds.has(selectedSurvey.id));

  const loadSurveys = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [records, semesterRecords, identity, studentProfiles] = await Promise.all([
        workspaceService.list("surveys"), workspaceService.list("semesters").catch(() => []), surveyService.currentUser(),
        isStudent ? studentService.list().catch(() => []) : Promise.resolve([]),
      ]);
      const sorted = records.filter((record) => !isParticipationView || allowsStudent(record)).sort((left, right) => right.updated_at.localeCompare(left.updated_at));
      const completedIds = isParticipationView ? await surveyService.mySurveyIds(sorted.map((record) => record.id)) : [];
      const profile = studentProfiles.find((student) => student.authUserId === identity.id);
      setSurveys(sorted); setSemesters(semesterRecords.map((item) => formatSemesterLabel(item.data.title, item.data.academicYear)).filter(Boolean));
      setRespondedSurveyIds(new Set(completedIds));
      setUserIdentity(profile ? { ...identity, name: profile.fullName, className: profile.className } : { ...identity, className: "" });
      setSelectedId((current) => sorted.some((item) => item.id === current) ? current : (sorted.find(isOpen) ?? sorted[0])?.id ?? "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể tải danh sách khảo sát."); }
    finally { setLoading(false); }
  }, [isParticipationView, isStudent]);

  useEffect(() => { void loadSurveys(); }, [loadSurveys]);
  useEffect(() => {
    let active = true;
    if (!selectedSurvey) { setResponses([]); setMyResponse(null); return; }
    void surveyService.responses(selectedSurvey.id).then((items) => {
      if (!active) return;
      setResponses(items);
      setMyResponse(items.find((item) => item.respondent_id === userIdentity.id) ?? null);
    }).catch((cause) => { if (active) setError(cause instanceof Error ? `${cause.message} (Cần cập nhật cấu hình supabase/surveys.sql.)` : "Không tải được phản hồi khảo sát."); });
    return () => { active = false; };
  }, [selectedSurvey?.id, userIdentity.id]);
  useEffect(() => {
    if (!selectedSurvey) return;
    let active = true;
    const refresh = () => void surveyService.responses(selectedSurvey.id).then((items) => {
      if (!active) return;
      setResponses(items); setMyResponse(items.find((item) => item.respondent_id === userIdentity.id) ?? null);
    }).catch(() => undefined);
    const unsubscribe = surveyService.subscribeToRatings(refresh);
    return () => { active = false; unsubscribe(); };
  }, [selectedSurvey?.id, userIdentity.id]);

  async function saveSurvey(values: { title: string; description: string; dueDate: string; audience: string; semesterName: string; courseName: string; questions: SurveyQuestion[] }) {
    setSaving(true); setError("");
    try {
      const previousDeadline = String(editing?.data.dueDate ?? "").slice(0, 10);
      const deadlineExtended = !editing || (!previousDeadline && Boolean(values.dueDate)) || Boolean(values.dueDate && values.dueDate > previousDeadline);
      const row = await workspaceService.save("surveys", {
        title: values.title,
        notes: values.description,
        dueDate: values.dueDate || null,
        audience: values.audience,
        semesterName: values.semesterName || null,
        courseName: values.courseName,
        status: deadlineExtended ? "Đang mở" : String(editing?.data.status ?? "Đang mở"),
        questions: JSON.stringify(values.questions),
      }, editing?.id);
      setSurveys((current) => [row, ...current.filter((item) => item.id !== row.id)]);
      setSelectedId(row.id); setEditorOpen(false); setEditing(null); setImportDraft(null); setNotice(editing ? "Đã cập nhật khảo sát." : "Đã tạo khảo sát mới.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể lưu khảo sát."); }
    finally { setSaving(false); }
  }

  async function importSurveyResults(file?: File) {
    if (!file) return;
    setImporting(true); setError(""); setNotice("");
    let draft: SurveyImportDraft | null = null;
    let extractionError = "";
    try { draft = await extractSurveyResults(file); }
    catch (cause) { extractionError = cause instanceof Error ? cause.message : "Không thể trích xuất dữ liệu khảo sát từ tệp này."; }
    try {
      await sourceDataService.archiveImportedFile(file, "surveys", draft?.questions.map((question) => ({ title: question.text, audience: "Sinh viên" })) ?? []);
    } catch (cause) {
      setError(`Không thể lưu tệp vào Tệp nguồn đã lưu: ${cause instanceof Error ? cause.message : "Lỗi lưu tệp."}`);
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
      return;
    }
    if (extractionError || !draft?.questions.length) {
      setError(`${extractionError || "Không tìm thấy câu hỏi khảo sát trong tệp."} Tệp gốc đã được lưu trong Tệp nguồn đã lưu.`);
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
      return;
    }
    setEditing(null); setImportDraft(draft); setEditorOpen(true);
    setNotice(`Đã lưu tệp “${file.name}” và trích xuất ${draft.questions.length} câu hỏi để tạo khảo sát.`);
    setImporting(false);
    if (importInputRef.current) importInputRef.current.value = "";
  }

  async function deleteSurvey(survey: WorkspaceRecord) {
    if (!window.confirm(`Xóa khảo sát “${String(survey.data.title ?? "Khảo sát") }”?`)) return;
    try {
      await surveyService.moveToTrash(survey.id);
      const remaining = surveys.filter((item) => item.id !== survey.id); setSurveys(remaining); setSelectedId(remaining[0]?.id ?? ""); setNotice("Đã chuyển khảo sát vào thùng rác.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể xóa khảo sát."); }
  }

  async function submitResponse(answers: Record<string, SurveyAnswerValue>, comment: string, rating: number) {
    if (!selectedSurvey || !canRespond) return;
    setSending(true); setError("");
    try {
      await surveyService.submitAnswers({ surveyId: selectedSurvey.id, answers, comment, rating, respondentName: userIdentity.name, className: userIdentity.className });
      const latest = await surveyService.responses(selectedSurvey.id); setResponses(latest); setMyResponse(latest.find((item) => item.respondent_id === userIdentity.id) ?? null); setNotice("Cảm ơn bạn đã gửi phản hồi khảo sát.");
      setRespondedSurveyIds((current) => new Set(current).add(selectedSurvey.id));
      window.dispatchEvent(new Event("vtn-surveys-updated"));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Không thể gửi phản hồi.";
      setError(message.toLocaleLowerCase("en-US").includes("already completed") ? "Bạn đã thực hiện khảo sát học phần này với giảng viên trong học kỳ này." : message);
      throw cause;
    }
    finally { setSending(false); }
  }

  const mean = responses.length ? responses.reduce((sum, response) => sum + response.rating, 0) / responses.length : 0;
  const positive = responses.length ? Math.round(responses.filter((response) => response.rating >= 4).length / responses.length * 100) : 0;
  const distribution = [1, 2, 3, 4, 5].map((rating) => responses.filter((response) => response.rating === rating).length);
  const sentiment = [responses.filter((response) => response.rating <= 2).length, responses.filter((response) => response.rating === 3).length, responses.filter((response) => response.rating >= 4).length];
  const positiveShare = responses.length ? sentiment[2] / responses.length * 100 : 0;
  const neutralShare = responses.length ? sentiment[1] / responses.length * 100 : 0;

  return <main className="edu-surveys-page">
    <header className="edu-surveys-heading"><div><div className="edu-surveys-title"><span><MessageSquareText size={19} /></span><h1>{isParticipationView ? "Tham gia khảo sát" : "Quản lý khảo sát"}</h1></div><p>{isParticipationView ? "Xem khảo sát cần thực hiện và cập nhật phản hồi trước hạn kết thúc." : "Thu thập ý kiến sinh viên để nâng cao chất lượng giảng dạy và trải nghiệm học tập."}</p></div>{!isParticipationView && permissions.create && <div className="edu-survey-heading-actions"><input ref={importInputRef} className="edu-survey-visually-hidden" type="file" accept="*/*" aria-label="Chọn tệp kết quả khảo sát" onChange={(event) => void importSurveyResults(event.target.files?.[0])} /><button className="edu-survey-outline-button" disabled={importing} onClick={() => importInputRef.current?.click()}><FileUp size={16} />{importing ? "Đang đọc tệp…" : "Nhập kết quả khảo sát"}</button><button className="edu-survey-primary-button" onClick={() => { setEditing(null); setImportDraft(null); setEditorOpen(true); }}><Plus size={16} />Tạo khảo sát mới</button></div>}</header>
    {error && <div className="edu-survey-alert" role="alert">{error}<button aria-label="Đóng thông báo" onClick={() => setError("")}><X size={16} /></button></div>}
    {notice && <div className="edu-survey-notice" role="status">{notice}<button aria-label="Đóng thông báo" onClick={() => setNotice("")}><X size={16} /></button></div>}
    {loading ? <div className="edu-survey-loading">Đang tải khảo sát…</div> : <>
      {isParticipationView && <section className="edu-survey-participation-summary" aria-label="Tổng hợp tình trạng khảo sát"><article><span>Tổng khảo sát</span><strong>{studentSurveys.length}</strong></article><article><span>Chưa thực hiện</span><strong>{studentSurveys.filter((survey) => !completedSurveyIds.has(survey.id)).length}</strong></article><article><span>Đã thực hiện</span><strong>{studentSurveys.filter((survey) => completedSurveyIds.has(survey.id)).length}</strong></article><SearchableFilter ariaLabel="Lọc tình trạng khảo sát" value={participationFilter} allValue="all" allLabel="Tất cả" options={[{ value: "all", label: "Tất cả" }, { value: "pending", label: "Chưa thực hiện" }, { value: "completed", label: "Đã thực hiện" }]} onChange={(value) => setParticipationFilter(value as "all" | "pending" | "completed")} /></section>}
      {surveyOptions.length > 0 && <nav className="edu-survey-campaigns" aria-label="Danh sách khảo sát">{surveyOptions.map((survey) => { const completed = completedSurveyIds.has(survey.id); return <button type="button" key={survey.id} className={survey.id === selectedSurvey?.id ? "active" : ""} onClick={() => setSelectedId(survey.id)}><span>{String(survey.data.title ?? "Khảo sát")}</span><small>{String(survey.data.courseName ?? "Học phần")} · {formatSemesterLabel(survey.data.semesterName, survey.data.academicYear) || "Chưa chọn học kỳ"}</small><small>{isParticipationView ? completed ? "Đã thực hiện" : isOpen(survey) ? "Chưa thực hiện · Còn hạn" : "Chưa thực hiện · Đã hết hạn" : isOpen(survey) ? "Đang nhận phản hồi" : "Đã kết thúc"}</small></button>; })}</nav>}
      {!selectedSurvey ? <section className="edu-survey-empty"><MessageSquareText size={30} /><h2>{isParticipationView && studentSurveys.length ? "Không có khảo sát trong mục này" : "Chưa có khảo sát"}</h2><p>{isParticipationView ? "Chọn một trạng thái khác để xem khảo sát." : "Tạo khảo sát về học phần, phương pháp giảng dạy hoặc trải nghiệm sinh viên."}</p>{!isParticipationView && permissions.create && <button className="edu-survey-primary-button" onClick={() => { setEditing(null); setImportDraft(null); setEditorOpen(true); }}><Plus size={16} />Tạo khảo sát đầu tiên</button>}</section> : <>
        <div className="edu-survey-active-banner"><div><strong>{String(selectedSurvey.data.title ?? "Khảo sát học tập")}</strong><span>{String(selectedSurvey.data.courseName ?? "Học phần")} · {questions.length} câu hỏi{selectedSurvey.data.semesterName ? ` · ${formatSemesterLabel(selectedSurvey.data.semesterName, selectedSurvey.data.academicYear)}` : ` · ${String(selectedSurvey.data.audience ?? "Sinh viên")}`}</span></div><span className={`edu-survey-status ${isOpen(selectedSurvey) ? "is-open" : "is-closed"}`}><i />{isOpen(selectedSurvey) ? "Đang nhận phản hồi" : "Đã kết thúc"}</span><span className="edu-survey-deadline"><Clock3 size={14} />Hạn: {dateLabel(selectedSurvey.data.dueDate)}</span>{permissions.update && !isParticipationView && <button className="edu-survey-icon-action" aria-label="Sửa khảo sát" title="Sửa khảo sát" onClick={() => { setEditing(selectedSurvey); setEditorOpen(true); }}><Pencil size={15} /></button>}{permissions.delete && !isParticipationView && <button className="edu-survey-icon-action danger" aria-label="Xóa khảo sát" title="Xóa khảo sát" onClick={() => void deleteSurvey(selectedSurvey)}><Trash2 size={15} /></button>}</div>

        <div className={`edu-survey-layout ${canViewResults ? "" : "student"}`}><div className="edu-survey-main-column">
          {canViewResults && <><div className="edu-survey-stat-grid"><article><div><span>Số phản hồi</span><strong>{responses.length}</strong><small>{openSurveys.length} khảo sát đang mở</small></div><i className="indigo"><MessageSquareText size={19} /></i></article><article><div><span>Điểm hài lòng trung bình</span><strong>{mean.toFixed(1)}<small className="out-of"> / 5.0</small></strong><small className="edu-survey-rating-stars">{[1,2,3,4,5].map((star) => <Star key={star} size={13} fill={mean >= star - .5 ? "currentColor" : "none"} />)}</small></div><i className="amber"><Star size={19} /></i></article><article><div><span>Phản hồi tích cực</span><strong className="positive-value">{positive}%</strong><small>{sentiment[2]} sinh viên đánh giá tốt</small></div><i className="green"><CheckCircle2 size={19} /></i></article></div>

          {canViewResults && <section className="edu-survey-panel edu-survey-charts"><div className="edu-survey-panel-heading"><div><h2>Phân tích mức độ hài lòng</h2><p>Đánh giá về học phần và hoạt động giảng dạy</p></div><span><BarChart3 size={15} />Cập nhật theo phản hồi</span></div><div className="edu-survey-chart-grid"><div className="edu-survey-donut-area"><div className="edu-survey-donut" style={{ background: responses.length ? `conic-gradient(#08b783 0 ${positiveShare}%, #665af1 ${positiveShare}% ${positiveShare + neutralShare}%, #f05252 ${positiveShare + neutralShare}% 100%)` : "#e7edf6" }}><span><b>{Math.round(positiveShare)}%</b><small>hài lòng</small></span></div><div className="edu-survey-chart-legend"><span><i className="purple" />Bình thường</span><span><i className="red" />Cần cải thiện</span><span><i className="green" />Hài lòng</span></div></div><div className="edu-survey-bars" aria-label="Phân bố điểm đánh giá"><div className="edu-survey-bar-scale"><span>5</span><span>4</span><span>3</span><span>2</span><span>0</span></div><div className="edu-survey-bar-grid">{distribution.map((count, index) => <div className="edu-survey-bar-column" key={index}><div className="edu-survey-bar-track"><i style={{ height: `${responses.length ? Math.max(4, count / Math.max(...distribution, 1) * 100) : 4}%` }} /></div><small>{index + 1} sao</small></div>)}</div></div></div></section>}

          <section className="edu-survey-panel edu-survey-question-results"><div className="edu-survey-panel-heading"><div><h2>Kết quả theo từng câu hỏi</h2><p>Tổng hợp câu trả lời trong khảo sát đang chọn.</p></div></div>{questions.length ? questions.map((question, index) => {
            const values = responses.map((response) => response.answers?.[question.id]).filter((value) => !isEmptyAnswer(value));
            const numeric = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
            const average = numeric.length ? numeric.reduce((sum, value) => sum + value, 0) / numeric.length : 0;
            const scaleQuestion = ["likert", "linear_scale", "rating"].includes(question.type);
            const maxScale = question.type === "likert" ? 5 : Number(question.scaleMax ?? 5);
            const preview = scaleQuestion ? "" : values.slice(0, 2).map(answerLabel).filter(Boolean).join(" · ");
            return <article className="edu-survey-result-row" key={question.id}><div><span>Câu {index + 1}</span><strong>{question.text || "Câu hỏi"}</strong>{preview && <small>{preview}</small>}</div><span className={values.length ? "result-value" : "result-empty"}>{scaleQuestion ? numeric.length ? `${average.toFixed(1)} / ${maxScale} · ${numeric.length} phản hồi` : `Chưa có đánh giá · ${responses.length} phản hồi` : `${values.length} câu trả lời`}</span></article>;
          }) : <div className="edu-survey-no-questions">Chưa thêm câu hỏi cho khảo sát này.</div>}</section></>}

          {isStudent && isParticipationView && completedSurveyIds.has(selectedSurvey.id) && !respondedSurveyIds.has(selectedSurvey.id) ? <div className="edu-survey-course-completed"><CheckCircle2 size={17} /><span>Bạn đã thực hiện khảo sát học phần này với giảng viên trong học kỳ {formatSemesterLabel(selectedSurvey.data.semesterName, selectedSurvey.data.academicYear)}.</span></div> : canRespond ? <ResponseForm key={selectedSurvey.id} survey={selectedSurvey} questions={questions} existing={myResponse} busy={sending} onSubmit={(answers, comment, rating) => submitResponse(answers, comment, rating)} /> : isParticipationView && !completedSurveyIds.has(selectedSurvey.id) ? <div className="edu-survey-closed-notice">Tài khoản chưa được cấp quyền gửi hoặc cập nhật phản hồi khảo sát.</div> : null}
        </div>

        {canViewResults && <aside className="edu-survey-recent-panel"><div className="edu-survey-recent-heading"><div><h2>Ý kiến sinh viên gần đây ({responses.length})</h2><p>Phản hồi theo thời gian thực</p></div><span><Users size={15} />{responses.length}</span></div><div className="edu-survey-recent-list">{responses.length ? responses.map((response) => <article className="edu-survey-comment-card" key={`${response.survey_id}-${response.respondent_id}`}><div className="edu-survey-comment-top"><i>{response.respondent_name.trim().split(/\s+/).slice(-1)[0]?.slice(0, 1) ?? "S"}</i><div><strong>{response.respondent_name}</strong><small>{response.class_name || "Sinh viên"}</small></div><span className="edu-survey-mini-stars">{[1,2,3,4,5].map((star) => <Star key={star} size={12} fill={response.rating >= star ? "currentColor" : "none"} />)}</span></div><div className="edu-survey-comment-answers">{questions.filter((question) => question.type === "text" && response.answers?.[question.id]).slice(0, 2).map((question) => <p key={question.id}>“{String(response.answers[question.id])}”</p>)}{response.comment && <p>“{response.comment}”</p>}{!response.comment && !questions.some((question) => question.type === "text" && response.answers?.[question.id]) && <p className="no-comment">Sinh viên đã gửi đánh giá.</p>}</div><div className="edu-survey-comment-foot"><span className={response.rating >= 4 ? "positive" : response.rating === 3 ? "neutral" : "negative"}>{response.rating >= 4 ? "Tích cực" : response.rating === 3 ? "Bình thường" : "Cần cải thiện"}</span><time>{formatDateTime(response.created_at)}</time></div></article>) : <div className="edu-survey-recent-empty"><MessageSquareText size={22} /><strong>Chưa có phản hồi</strong><span>Ý kiến của sinh viên sẽ hiển thị tại đây.</span></div>}</div></aside>}
        </div>
      </>}
    </>}
    {editorOpen && !isParticipationView && <SurveyEditor initial={editing} semesters={semesters} saving={saving} saveError={error} importDraft={importDraft} onClose={() => { if (!saving) { setEditorOpen(false); setEditing(null); setImportDraft(null); setError(""); } }} onSave={(values) => void saveSurvey(values)} />}
  </main>;
}
