import { useEffect, useRef, useState, type FormEvent } from "react";
import { BookOpenCheck, Bot, Globe2, MessageSquare, Paperclip, Send, ShieldCheck, Trash2, UploadCloud, UserRound } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatDateTime } from "../../lib/date-format";
import "./academic-ai.css";

type Source = { id: string; title: string; file_name: string; mime_type: string; status: string; created_at: string };
type Citation = { title?: string; url?: string; fileName?: string; type?: string };
type ChatMessage = { role: "user" | "assistant"; content: string; citations?: Citation[] };

const ACCEPTED_TYPES = ".pdf,.txt,.md,.csv,.docx,.html";
const MAX_FILE_BYTES = 15 * 1024 * 1024;

function toBase64(file: File) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer); let binary = ""; const block = 0x8000;
    for (let i = 0; i < bytes.length; i += block) binary += String.fromCharCode(...bytes.subarray(i, i + block));
    return btoa(binary);
  });
}

export default function AcademicAIPage({ role, canManageSources, canDeleteSources }: { role: string; canManageSources: boolean; canDeleteSources: boolean }) {
  const [tab, setTab] = useState<"chat" | "sources">("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "assistant", content: "Xin chào! Tôi có thể giúp bạn tra cứu quy chế, lịch học, học vụ và nội dung trong tài liệu do nhà trường cung cấp. Hãy đặt câu hỏi cụ thể; tôi sẽ ưu tiên nguồn nội bộ và ghi rõ khi tham khảo web." }]);
  const [question, setQuestion] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [webSearch, setWebSearch] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadingSources, setLoadingSources] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploadProgress, setUploadProgress] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function loadSources() {
    if (!supabase || !canManageSources) return;
    setLoadingSources(true); setError("");
    const { data, error: invokeError } = await supabase.functions.invoke("academic-ai", { body: { action: "list-sources" } });
    setLoadingSources(false);
    if (invokeError) { setError(invokeError.message); return; }
    if (data?.error) { setError(data.error); return; }
    setSources((data?.sources ?? []) as Source[]);
  }

  useEffect(() => { void loadSources(); }, [canManageSources]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);

  async function sendQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const prompt = question.trim(); if (!prompt || busy) return;
    if (!supabase) { setError("Chưa cấu hình Supabase."); return; }
    const nextMessages = [...messages, { role: "user" as const, content: prompt }]; setMessages(nextMessages); setQuestion(""); setBusy(true); setError("");
    const { data, error: invokeError } = await supabase.functions.invoke("academic-ai", { body: { action: "chat", question: prompt, webSearch, messages: messages.slice(-8).map(({ role: messageRole, content }) => ({ role: messageRole, content })) } });
    setBusy(false);
    if (invokeError || data?.error) { setError(data?.error ?? invokeError?.message ?? "Không thể nhận câu trả lời."); return; }
    setMessages((previous) => [...previous, { role: "assistant", content: String(data?.answer ?? "Chưa có câu trả lời."), citations: (data?.citations ?? []) as Citation[] }]);
  }

  async function uploadSource(file: File) {
    if (!supabase) { setError("Chưa cấu hình Supabase."); return; }
    if (file.size > MAX_FILE_BYTES) { setError("Dung lượng mỗi tài liệu tối đa 15 MB."); return; }
    setBusy(true); setError(""); setNotice(""); setUploadProgress(`Đang tải và lập chỉ mục ${file.name}…`);
    try {
      const base64 = await toBase64(file);
      const { data, error: invokeError } = await supabase.functions.invoke("academic-ai", { body: { action: "upload-source", fileName: file.name, mimeType: file.type || "application/octet-stream", base64 } });
      if (invokeError || data?.error) throw new Error(data?.error ?? invokeError?.message ?? "Không thể thêm tài liệu.");
      setNotice(`Đã thêm nguồn dữ liệu: ${file.name}`); await loadSources();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể tải tài liệu."); }
    finally { setBusy(false); setUploadProgress(""); }
  }

  async function removeSource(source: Source) {
    if (!supabase || !window.confirm(`Gỡ tài liệu “${source.file_name}” khỏi nguồn AI?`)) return;
    setBusy(true); setError("");
    const { data, error: invokeError } = await supabase.functions.invoke("academic-ai", { body: { action: "delete-source", sourceId: source.id } });
    setBusy(false);
    if (invokeError || data?.error) { setError(data?.error ?? invokeError?.message ?? "Không thể gỡ tài liệu."); return; }
    setNotice("Đã gỡ nguồn dữ liệu."); await loadSources();
  }

  return <main className="workspace-page academic-ai-page">
    <header className="workspace-title-row"><div><div className="workspace-breadcrumb">Học Vụ &amp; Quản Trị <span>/</span> Học vụ AI</div><h1>Học vụ AI</h1><p>Tra cứu học vụ theo tài liệu nguồn và thông tin tham khảo từ web.</p></div><div className="academic-ai-trust"><ShieldCheck size={16} /> Nguồn nội bộ được ưu tiên</div></header>
    {error && <div className="workspace-alert" role="alert">{error}<button type="button" onClick={() => setError("")}>Đóng</button></div>}{notice && <div className="workspace-notice" role="status">{notice}</div>}
    <div className="academic-ai-layout">
      <section className="academic-ai-main">
        <nav className="academic-ai-tabs" aria-label="Khu vực Học vụ AI"><button type="button" className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}><MessageSquare size={16} /> Hỏi đáp</button>{canManageSources && <button type="button" className={tab === "sources" ? "active" : ""} onClick={() => { setTab("sources"); void loadSources(); }}><BookOpenCheck size={16} /> Nguồn dữ liệu <span>{sources.length}</span></button>}</nav>
        {tab === "chat" ? <div className="academic-ai-chat"><div className="academic-ai-chat-scroll">{messages.map((message, index) => <article className={`academic-ai-message ${message.role}`} key={`${message.role}-${index}`}><span className="academic-ai-message-icon">{message.role === "assistant" ? <Bot size={17} /> : <UserRound size={16} />}</span><div><strong>{message.role === "assistant" ? "Học vụ AI" : "Bạn"}</strong><p>{message.content}</p>{message.citations?.length ? <div className="academic-ai-citations"><span>Nguồn tham khảo</span>{message.citations.map((citation, citationIndex) => <a key={`${citation.url ?? citation.fileName}-${citationIndex}`} href={citation.url || undefined} target={citation.url ? "_blank" : undefined} rel="noreferrer">{citation.title || citation.fileName || "Tài liệu nguồn"}</a>)}</div> : null}</div></article>)}{busy && <article className="academic-ai-message assistant"><span className="academic-ai-message-icon"><Bot size={17} /></span><div><strong>Học vụ AI</strong><p className="academic-ai-thinking">Đang đối chiếu nguồn dữ liệu…</p></div></article>}<div ref={endRef} /></div><div className="academic-ai-compose-tools"><label><input type="checkbox" checked={webSearch} onChange={(event) => setWebSearch(event.target.checked)} /><Globe2 size={15} /> Tham khảo web</label><span>{sources.length ? `${sources.length} nguồn nội bộ đã thiết lập` : canManageSources ? "Chưa có nguồn nội bộ" : "Hỏi đáp theo nội dung được cấu hình"}</span></div><form className="academic-ai-compose" onSubmit={sendQuestion}><textarea aria-label="Câu hỏi học vụ" placeholder="Nhập câu hỏi về quy chế, học phần, lịch học…" rows={2} value={question} onChange={(event) => setQuestion(event.target.value)} disabled={busy} /><button className="workspace-primary" type="submit" disabled={busy || !question.trim()}><Send size={16} /> Gửi</button></form></div> : <div className="academic-ai-sources"><div className="academic-ai-source-intro"><div><h2>Thư viện nguồn dữ liệu</h2><p>Nạp tài liệu để chatbot tra cứu. Hỗ trợ PDF, DOCX, TXT, Markdown, CSV và HTML (tối đa 15 MB mỗi tệp).</p></div><button className="workspace-primary" type="button" onClick={() => fileRef.current?.click()} disabled={busy}><UploadCloud size={17} /> Thêm tài liệu</button><input ref={fileRef} hidden type="file" accept={ACCEPTED_TYPES} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void uploadSource(file); event.currentTarget.value = ""; }} /></div>{uploadProgress && <div className="academic-ai-indexing"><Paperclip size={16} />{uploadProgress}</div>}{loadingSources ? <div className="workspace-loading">Đang tải nguồn dữ liệu…</div> : <div className="academic-ai-source-list">{sources.map((source) => <article className="academic-ai-source-card" key={source.id}><span><BookOpenCheck size={19} /></span><div><strong>{source.title || source.file_name}</strong><small>{source.file_name} · {formatDateTime(source.created_at)}</small><small className="academic-ai-source-status">{source.status === "ready" ? "Đã lập chỉ mục" : source.status}</small></div>{canDeleteSources && <button type="button" aria-label={`Gỡ ${source.file_name}`} disabled={busy} onClick={() => void removeSource(source)}><Trash2 size={16} /></button>}</article>)}{!sources.length && <div className="academic-ai-empty"><BookOpenCheck size={24} /><strong>Chưa có tài liệu nguồn</strong><span>Thêm đề cương, quy chế, lịch đào tạo hoặc tài liệu môn học.</span></div>}</div>}</div>}
      </section>
      <aside className="academic-ai-side"><div className="academic-ai-side-icon"><Bot size={24} /></div><h2>Trợ lý học vụ</h2><p>Trả lời dựa trên nội dung tài liệu đã được quản trị viên hoặc giảng viên nạp vào.</p><div className="academic-ai-capability"><BookOpenCheck size={16} /><span><strong>Tra cứu tài liệu</strong><small>Tìm kiếm trong các file PDF, DOCX và văn bản đã lập chỉ mục.</small></span></div><div className="academic-ai-capability"><Globe2 size={16} /><span><strong>Tham khảo internet</strong><small>Có thể bật/tắt tìm kiếm web cho từng câu hỏi.</small></span></div><div className="academic-ai-privacy">Tài liệu nguồn chỉ dùng cho hỏi đáp trong hệ thống. Không đưa khóa AI vào trình duyệt.</div><small className="academic-ai-role">Vai trò: {role}</small></aside>
    </div>
  </main>;
}
