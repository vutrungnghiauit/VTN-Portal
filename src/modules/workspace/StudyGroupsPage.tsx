import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, MessageCircle, MessagesSquare, Plus, Search, Send, UsersRound } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatDateTime } from "../../lib/date-format";
import "./workspace.css";

type ForumTopic = { id: string; title: string; category: string; description: string; author_id: string; author_name: string; author_role: string; created_at: string; last_activity_at: string; message_count?: number };
type ForumMessage = { id: string; topic_id: string; content: string; author_id: string; author_name: string; author_role: string; created_at: string };
const categories = ["Thảo luận chung", "Hỏi đáp môn học", "Chia sẻ tài liệu", "Học nhóm", "Khác"];
const roleNames: Record<string, string> = { super_admin: "Quản trị viên", system_admin: "Quản trị hệ thống", sub_admin: "Quản trị viên phụ", teacher: "Giảng viên", assistant: "Trợ giảng", class_president: "Lớp trưởng", class_vice: "Lớp phó", student: "Sinh viên" };

export default function StudyGroupsPage({ canCreate }: { canCreate: boolean }) {
  const [topics, setTopics] = useState<ForumTopic[]>([]);
  const [messages, setMessages] = useState<ForumMessage[]>([]);
  const [selected, setSelected] = useState<ForumTopic | null>(null);
  const [search, setSearch] = useState("");
  const [showTopicForm, setShowTopicForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadTopics = useCallback(async () => {
    if (!supabase) { setError("Chưa cấu hình Supabase."); setLoading(false); return; }
    const { data, error: queryError } = await supabase.from("study_forum_topics").select("id,title,category,description,author_id,author_name,author_role,created_at,last_activity_at").order("last_activity_at", { ascending: false });
    if (queryError) { setError(queryError.message); setLoading(false); return; }
    const rows = (data ?? []) as ForumTopic[];
    const { data: counts } = rows.length ? await supabase.from("study_forum_messages").select("topic_id").in("topic_id", rows.map((row) => row.id)) : { data: [] as { topic_id: string }[] };
    const countByTopic = new Map<string, number>();
    for (const item of counts ?? []) countByTopic.set(item.topic_id, (countByTopic.get(item.topic_id) ?? 0) + 1);
    setTopics(rows.map((row) => ({ ...row, message_count: countByTopic.get(row.id) ?? 0 })));
    setLoading(false);
  }, []);

  const loadMessages = useCallback(async (topicId: string) => {
    if (!supabase) return;
    const { data, error: queryError } = await supabase.from("study_forum_messages").select("id,topic_id,content,author_id,author_name,author_role,created_at").eq("topic_id", topicId).order("created_at", { ascending: true });
    if (queryError) setError(queryError.message); else setMessages((data ?? []) as ForumMessage[]);
  }, []);

  useEffect(() => { void loadTopics(); }, [loadTopics]);
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    const channel = client.channel("study-forum-topics")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "study_forum_topics" }, () => void loadTopics())
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [loadTopics]);
  useEffect(() => {
    if (!supabase || !selected) return;
    const client = supabase;
    void loadMessages(selected.id);
    const channel = client.channel(`study-forum-messages-${selected.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "study_forum_messages", filter: `topic_id=eq.${selected.id}` }, ({ new: row }) => {
        const incoming = row as ForumMessage;
        setMessages((items) => items.some((item) => item.id === incoming.id) ? items : [...items, incoming]);
        void loadTopics();
      })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [selected?.id, loadMessages, loadTopics]);

  const visibleTopics = useMemo(() => topics.filter((topic) => `${topic.title} ${topic.description} ${topic.category} ${topic.author_name}`.toLocaleLowerCase("vi-VN").includes(search.toLocaleLowerCase("vi-VN"))), [topics, search]);

  async function createTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase || !canCreate) return;
    const form = new FormData(event.currentTarget); const title = String(form.get("title") ?? "").trim(); const description = String(form.get("description") ?? "").trim(); const category = String(form.get("category") ?? categories[0]);
    if (!title || !description) { setError("Hãy nhập tiêu đề và nội dung mở đầu."); return; }
    setSending(true); setError("");
    const { data, error: insertError } = await supabase.from("study_forum_topics").insert({ title, description, category }).select("id,title,category,description,author_id,author_name,author_role,created_at,last_activity_at").single();
    setSending(false);
    if (insertError) { setError(insertError.message); return; }
    const created = data as ForumTopic; setShowTopicForm(false); setNotice("Đã tạo chủ đề thảo luận."); await loadTopics(); setSelected({ ...created, message_count: 0 });
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase || !selected || !canCreate) return;
    const form = event.currentTarget; const content = String(new FormData(form).get("content") ?? "").trim(); if (!content) return;
    setSending(true); setError("");
    const { error: insertError } = await supabase.from("study_forum_messages").insert({ topic_id: selected.id, content });
    setSending(false);
    if (insertError) { setError(insertError.message); return; }
    form.reset();
  }

  return <section className="workspace-page study-forum-page">
    <div className="workspace-title-row"><div><div className="workspace-breadcrumb">Đào tạo <span>/</span> Nhóm học tập</div><h1>Nhóm học tập</h1><p>Diễn đàn trao đổi tự do, chia sẻ kiến thức và trò chuyện theo từng chủ đề.</p></div>{canCreate && <button className="workspace-primary" type="button" onClick={() => { setShowTopicForm((value) => !value); setError(""); }}><Plus size={17} /> Tạo chủ đề</button>}</div>
    {error && <div className="workspace-alert" role="alert">{error}</div>}{notice && <div className="workspace-notice" role="status">{notice}</div>}
    {showTopicForm && <form className="workspace-form" onSubmit={(event) => void createTopic(event)}><div className="workspace-form-head"><h2>Mở cuộc thảo luận mới</h2><button type="button" onClick={() => setShowTopicForm(false)}>Đóng</button></div><div className="workspace-form-grid"><label>Chủ đề<input name="title" required maxLength={180} placeholder="Ví dụ: Trao đổi bài tập Kinh tế số" /></label><label>Phân loại<select name="category">{categories.map((item) => <option key={item}>{item}</option>)}</select></label><label className="workspace-span">Nội dung mở đầu<textarea name="description" rows={4} required maxLength={5000} placeholder="Nêu câu hỏi hoặc nội dung muốn chia sẻ..." /></label></div><div className="workspace-form-actions"><button className="workspace-primary" disabled={sending}>{sending ? "Đang tạo..." : "Đăng chủ đề"}</button><button type="button" onClick={() => setShowTopicForm(false)}>Hủy</button></div></form>}
    <div className="study-forum-layout">
      <div className={`study-forum-list ${selected ? "is-hidden-mobile" : ""}`}><div className="workspace-toolbar"><label><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm chủ đề..." aria-label="Tìm chủ đề" /></label><span>{visibleTopics.length} chủ đề</span></div>{loading ? <div className="workspace-loading">Đang tải thảo luận...</div> : visibleTopics.length ? visibleTopics.map((topic) => <button type="button" className={`study-forum-topic ${selected?.id === topic.id ? "active" : ""}`} key={topic.id} onClick={() => { setSelected(topic); setError(""); }}><span className="study-forum-topic-icon"><MessagesSquare size={18} /></span><span className="study-forum-topic-copy"><span className="study-forum-category">{topic.category}</span><strong>{topic.title}</strong><small>{topic.author_name} · {formatDateTime(topic.last_activity_at)}</small><span className="study-forum-topic-summary">{topic.description}</span></span><span className="study-forum-count"><MessageCircle size={13} /> {topic.message_count}</span></button>) : <div className="workspace-panel study-forum-empty"><UsersRound size={25} /><strong>{search ? "Không tìm thấy chủ đề" : "Chưa có cuộc thảo luận"}</strong><span>{search ? "Thử từ khóa khác." : "Tạo chủ đề đầu tiên để bắt đầu trao đổi."}</span></div>}</div>
      <div className={`study-forum-conversation ${!selected ? "is-hidden-mobile" : ""}`}>{selected ? <><header className="study-forum-conversation-head"><button className="study-forum-back" type="button" aria-label="Quay lại danh sách" onClick={() => setSelected(null)}><ArrowLeft size={18} /></button><div><span className="study-forum-category">{selected.category}</span><h2>{selected.title}</h2><p>{selected.description}</p><small>{selected.author_name} · {roleNames[selected.author_role] ?? "Thành viên"} · {formatDateTime(selected.created_at)}</small></div></header><div className="study-forum-messages">{messages.map((message) => <article className={`study-forum-message ${message.author_id === selected.author_id ? "topic-starter" : ""}`} key={message.id}><div className="study-forum-message-meta"><strong>{message.author_name}</strong><span>{roleNames[message.author_role] ?? "Thành viên"}</span><time>{formatDateTime(message.created_at)}</time></div><p>{message.content}</p></article>)}{!messages.length && <div className="study-forum-empty-inline">Chưa có phản hồi. Hãy bắt đầu cuộc trò chuyện.</div>}</div>{canCreate ? <form className="study-forum-compose" onSubmit={(event) => void sendMessage(event)}><textarea name="content" required maxLength={5000} rows={2} placeholder="Viết phản hồi trong chủ đề này..." aria-label="Nội dung tin nhắn" /><button className="workspace-primary" disabled={sending}><Send size={16} /> Gửi</button></form> : <p className="study-forum-empty-inline">Bạn chưa được cấp quyền gửi phản hồi.</p>}</> : <div className="study-forum-welcome"><span><MessagesSquare size={27} /></span><h2>Chọn một chủ đề để trò chuyện</h2><p>Mỗi chủ đề có luồng tin nhắn riêng. Tin nhắn mới sẽ xuất hiện trực tiếp cho các thành viên.</p></div>}</div>
    </div>
  </section>;
}
