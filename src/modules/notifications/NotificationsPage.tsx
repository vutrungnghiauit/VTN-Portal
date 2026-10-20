import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Bell, CheckCheck, Send } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatDateTime } from "../../lib/date-format";
import { studentService } from "../students/student.service";
import { notificationService, type AppNotification } from "./notification.service";
import "../workspace/workspace.css";
import "./notification.css";

export default function NotificationsPage() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [classes, setClasses] = useState<string[]>([]);
  const [canSend, setCanSend] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [inbox, students, accessResult] = await Promise.all([notificationService.inbox(), studentService.list(), supabase!.rpc("get_my_access_matrix")]);
      if (accessResult.error) throw accessResult.error;
      const access = accessResult.data as { permissions: Record<string, Record<string, boolean>>; superAdmin: boolean };
      setItems(inbox); setClasses([...new Set(students.map((student) => student.className).filter(Boolean))]); setCanSend(access.superAdmin || access.permissions.notifications?.create === true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể tải thông báo."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); setSending(true); setError("");
    try {
      await notificationService.publish({ title: String(form.get("title")), body: String(form.get("body")), severity: String(form.get("severity")), scope: String(form.get("scope")), className: String(form.get("className") ?? "") });
      setNotice("Đã gửi thông báo đến người nhận phù hợp."); formElement.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể gửi thông báo."); }
    finally { setSending(false); }
  }

  async function markRead(id: string) { try { await notificationService.markRead(id); setItems((previous) => previous.map((item) => item.id === id ? { ...item, read_at: new Date().toISOString() } : item)); } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể cập nhật thông báo."); } }
  async function markAll() { try { await notificationService.markAllRead(); setItems((previous) => previous.map((item) => ({ ...item, read_at: item.read_at ?? new Date().toISOString() }))); } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể cập nhật thông báo."); } }

  return <section className="workspace-page"><div className="workspace-title-row"><div><div className="workspace-breadcrumb">Tài nguyên <span>/</span> Thông báo</div><h1>Thông báo</h1><p>Thông báo được gửi trực tiếp đến tài khoản sinh viên theo phạm vi lớp hoặc toàn trường.</p></div><button type="button" className="workspace-secondary" onClick={() => void markAll()}><CheckCheck size={16} /> Đọc tất cả</button></div>{error && <div className="workspace-alert" role="alert">{error}</div>}{notice && <div className="workspace-notice" role="status">{notice}</div>}
    {canSend && <form className="workspace-form notification-compose" onSubmit={send}><h2><Send size={17} /> Soạn thông báo</h2><div className="workspace-form-grid"><label>Tiêu đề<input name="title" required maxLength={160} /></label><label>Mức độ<select name="severity"><option value="normal">Thông thường</option><option value="important">Quan trọng</option><option value="urgent">Khẩn cấp</option></select></label><label>Phạm vi<select name="scope" defaultValue="class" onChange={(event) => { const select = document.querySelector<HTMLSelectElement>("[name=className]"); if (select) select.disabled = event.target.value !== "class"; }}><option value="class">Theo lớp phụ trách</option><option value="school">Toàn trường (chỉ admin)</option></select></label><label>Lớp nhận<select name="className" required>{classes.map((name) => <option key={name}>{name}</option>)}</select></label><label className="workspace-span">Nội dung<textarea name="body" rows={4} required maxLength={5000} /></label></div><button className="workspace-primary" disabled={sending}><Send size={15} /> {sending ? "Đang gửi…" : "Gửi thông báo"}</button></form>}
    {loading ? <div className="workspace-loading">Đang tải hộp thư…</div> : <div className="notification-list">{items.map((item) => <article key={item.id} className={`notification-card ${item.read_at ? "is-read" : ""}`}><div className={`notification-level level-${item.severity}`}><Bell size={16} /></div><div className="notification-card-body"><div className="notification-card-heading"><strong>{item.title}</strong><span>{formatDateTime(item.created_at)}</span></div><p>{item.body}</p><div className="notification-card-meta"><span>{item.scope === "school" ? "Toàn trường" : `Lớp ${item.class_name ?? ""}`}</span><span>{item.severity === "urgent" ? "Khẩn cấp" : item.severity === "important" ? "Quan trọng" : "Thông thường"}</span>{!item.read_at && <button type="button" onClick={() => void markRead(item.id)}>Đánh dấu đã đọc</button>}</div></div></article>)}{!items.length && <div className="workspace-panel notification-empty"><Bell size={22} /><strong>Chưa có thông báo</strong><span>Thông báo mới sẽ hiển thị tại đây.</span></div>}</div>}</section>;
}
