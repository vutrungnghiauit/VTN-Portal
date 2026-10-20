import { useEffect, useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { randomPickerService, type RandomQuestionTopic } from "./random-picker.service";

type Permissions = { create: boolean; update: boolean; delete: boolean };

export default function RandomQuestionManager({ topics, permissions, activityType, activityLabel, loadError, onClose, onChanged }: {
  topics: RandomQuestionTopic[];
  permissions: Permissions & { read?: boolean };
  activityType: string;
  activityLabel: string;
  loadError: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [selectedTopicId, setSelectedTopicId] = useState(topics[0]?.id ?? "");
  const [topicDraft, setTopicDraft] = useState("");
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [questionTitleDraft, setQuestionTitleDraft] = useState("");
  const [questionDraft, setQuestionDraft] = useState("");
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selectedTopic = topics.find((topic) => topic.id === selectedTopicId) ?? topics[0];
  const needsTitle = ["keyword_draw", "true_false", "role_assignment"].includes(activityType);
  const titleLabel = activityType === "keyword_draw" ? "Từ khóa" : activityType === "true_false" ? "Nhận định" : activityType === "role_assignment" ? "Tên vai trò" : "Tiêu đề / tình huống";
  const contentLabel = activityType === "keyword_draw" ? "Gợi ý thảo luận" : activityType === "true_false" ? "Đáp án và giải thích" : activityType === "role_assignment" ? "Mô tả vai trò" : "Nội dung câu hỏi";
  const itemLabel = activityType === "keyword_draw" ? "Từ khóa" : activityType === "true_false" ? "Nhận định" : activityType === "role_assignment" ? "Vai trò" : "Câu hỏi";

  useEffect(() => {
    if (!topics.some((topic) => topic.id === selectedTopicId)) setSelectedTopicId(topics[0]?.id ?? "");
  }, [topics, selectedTopicId]);

  async function saveTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = topicDraft.trim();
    if (!name) return;
    setSaving(true); setError("");
    try {
      if (editingTopicId) await randomPickerService.updateQuestionTopic(editingTopicId, name);
      else setSelectedTopicId((await randomPickerService.createQuestionTopic(name, activityType)).id);
      setTopicDraft(""); setEditingTopicId(null); await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không lưu được chủ đề."); }
    finally { setSaving(false); }
  }

  async function deleteTopic(topic: RandomQuestionTopic) {
    if (!permissions.delete) return;
    if (!window.confirm(`Chuyển chủ đề “${topic.name}” cùng ${topic.questions.length} câu hỏi vào thùng rác?`)) return;
    setSaving(true); setError("");
    try { await randomPickerService.deleteQuestionTopic(topic.id); setEditingTopicId(null); setTopicDraft(""); setEditingQuestionId(null); setQuestionTitleDraft(""); setQuestionDraft(""); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không xóa được chủ đề."); }
    finally { setSaving(false); }
  }

  async function saveQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTopic || !questionDraft.trim()) return;
    setSaving(true); setError("");
    try {
      if (editingQuestionId) await randomPickerService.updateQuestion(editingQuestionId, selectedTopic.id, questionDraft, questionTitleDraft);
      else await randomPickerService.createQuestion(selectedTopic.id, questionDraft, questionTitleDraft);
      setQuestionTitleDraft(""); setQuestionDraft(""); setEditingQuestionId(null); await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không lưu được câu hỏi."); }
    finally { setSaving(false); }
  }

  async function deleteQuestion(id: string) {
    if (!permissions.delete || !window.confirm("Chuyển câu hỏi này vào thùng rác?")) return;
    setSaving(true); setError("");
    try { await randomPickerService.deleteQuestion(id); setEditingQuestionId(null); setQuestionTitleDraft(""); setQuestionDraft(""); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không xóa được câu hỏi."); }
    finally { setSaving(false); }
  }

  return <div className="random-history-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="random-question-manager" role="dialog" aria-modal="true" aria-labelledby="random-question-manager-title">
      <header><div><h2 id="random-question-manager-title">Quản lý câu hỏi và chủ đề</h2><p>Ngân hàng riêng cho hoạt động {activityLabel}.</p></div><button type="button" aria-label="Đóng" onClick={onClose}><X size={18} /></button></header>
      {loadError && <div className="workspace-error" role="alert">{loadError} Hãy áp dụng supabase/random-picker.sql để bật ngân hàng câu hỏi.</div>}
      {error && <div className="workspace-error" role="alert">{error}</div>}
      <section className="random-question-manager-section">
        <h3>Chủ đề</h3>
          {(permissions.create || (permissions.update && editingTopicId)) && <form onSubmit={(event) => void saveTopic(event)}>
          <input aria-label="Tên chủ đề" value={topicDraft} onChange={(event) => setTopicDraft(event.target.value)} placeholder="Nhập tên chủ đề" maxLength={160} />
          {editingTopicId && <button type="button" onClick={() => { setEditingTopicId(null); setTopicDraft(""); }}>Hủy</button>}
          {editingTopicId ? permissions.update && <button type="submit" disabled={saving || !topicDraft.trim()}>Lưu chủ đề</button> : permissions.create && <button type="submit" disabled={saving || !topicDraft.trim()}><Plus size={15} /> Thêm chủ đề</button>}
          </form>}
        <div className="random-question-topic-list">{topics.map((topic) => <article key={topic.id} className={topic.id === selectedTopic?.id ? "selected" : ""}>
          <button type="button" className="random-question-topic-select" onClick={() => setSelectedTopicId(topic.id)}><strong>{topic.name}</strong><small>{topic.questions.length} câu hỏi</small></button>
          {permissions.update && <button type="button" aria-label={`Sửa chủ đề ${topic.name}`} title="Sửa chủ đề" disabled={saving} onClick={() => { setSelectedTopicId(topic.id); setEditingTopicId(topic.id); setTopicDraft(topic.name); }}><Pencil size={15} /></button>}
          {permissions.delete && <button type="button" className="danger" aria-label={`Xóa chủ đề ${topic.name}`} title="Xóa chủ đề" disabled={saving} onClick={() => void deleteTopic(topic)}><Trash2 size={15} /></button>}
        </article>)}{!topics.length && <p className="random-question-empty">Chưa có chủ đề. Hãy thêm chủ đề để bắt đầu.</p>}</div>
      </section>
      <section className="random-question-manager-section">
        <div className="random-question-manager-subheading"><h3>{itemLabel}</h3><select aria-label="Chủ đề đang quản lý" value={selectedTopic?.id ?? ""} onChange={(event) => { setSelectedTopicId(event.target.value); setEditingQuestionId(null); setQuestionTitleDraft(""); setQuestionDraft(""); }} disabled={!topics.length}>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></div>
        {selectedTopic && <>
          {permissions.create || (permissions.update && editingQuestionId) ? <form className="random-question-editor" onSubmit={(event) => void saveQuestion(event)}>
            {activityType !== "oral_question" && <input aria-label={titleLabel} maxLength={160} value={questionTitleDraft} onChange={(event) => setQuestionTitleDraft(event.target.value)} placeholder={titleLabel} />}
            <textarea aria-label={contentLabel} rows={3} maxLength={4000} value={questionDraft} onChange={(event) => setQuestionDraft(event.target.value)} placeholder={activityType === "oral_question" ? "Nhập câu hỏi vấn đáp" : contentLabel} />
            <div>{editingQuestionId && <button type="button" onClick={() => { setEditingQuestionId(null); setQuestionTitleDraft(""); setQuestionDraft(""); }}>Hủy</button>}<button type="submit" disabled={saving || !questionDraft.trim() || (needsTitle && !questionTitleDraft.trim()) || (editingQuestionId ? !permissions.update : !permissions.create)}><Plus size={15} /> {editingQuestionId ? `Lưu ${itemLabel.toLocaleLowerCase("vi")}` : `Thêm ${itemLabel.toLocaleLowerCase("vi")}`}</button></div>
          </form> : null}
          <ol className="random-question-list">{selectedTopic.questions.map((item, index) => <li key={item.id}><span>{index + 1}.</span><p>{item.title && <strong>{item.title}<br /></strong>}{item.question}</p>{permissions.update && <button type="button" aria-label={`Sửa ${itemLabel.toLocaleLowerCase("vi")} ${index + 1}`} title={`Sửa ${itemLabel.toLocaleLowerCase("vi")}`} disabled={saving} onClick={() => { setEditingQuestionId(item.id); setQuestionTitleDraft(item.title ?? ""); setQuestionDraft(item.question); }}><Pencil size={15} /></button>}{permissions.delete && <button type="button" className="danger" aria-label={`Xóa ${itemLabel.toLocaleLowerCase("vi")} ${index + 1}`} title={`Xóa ${itemLabel.toLocaleLowerCase("vi")}`} disabled={saving} onClick={() => void deleteQuestion(item.id)}><Trash2 size={15} /></button>}</li>)}{!selectedTopic.questions.length && <li className="random-question-empty">Chủ đề này chưa có {itemLabel.toLocaleLowerCase("vi")}.</li>}</ol>
        </>}
      </section>
      <footer><button type="button" onClick={onClose}>Đóng</button></footer>
    </section>
  </div>;
}
