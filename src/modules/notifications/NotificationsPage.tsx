import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Bell, CheckCheck, ChevronDown, ChevronUp, Send, X } from "lucide-react";
import { formatDateTime } from "../../lib/date-format";
import { notificationService, type AppNotification } from "./notification.service";
import "../workspace/workspace.css";
import "./notification.css";

export default function NotificationsPage({ canCreate = false, role = "" }: { canCreate?: boolean; canReadStudents?: boolean; role?: string }) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [classes, setClasses] = useState<string[]>([]);
  const [showCompose, setShowCompose] = useState(false);
  const [scope, setScope] = useState<"class" | "school">("class");
  const [className, setClassName] = useState("");
  const canSend = canCreate && ["super_admin", "system_admin", "sub_admin", "teacher", "assistant"].includes(role);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const inbox = await notificationService.inbox();
      setItems(inbox);
      const availableClasses = canSend ? await notificationService.classes() : [];
      setClasses(availableClasses);
      setClassName((current) => current && availableClasses.includes(current) ? current : availableClasses[0] ?? "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể tải thông báo."); }
    finally { setLoading(false); }
  }, [canSend]);
  useEffect(() => { void load(); }, [load]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canSend) return; const formElement = event.currentTarget; const form = new FormData(formElement); setSending(true); setError("");
    try {
      await notificationService.publish({ title: String(form.get("title")), body: String(form.get("body")), severity: String(form.get("severity")), scope, className: scope === "class" ? className : "" });
      setNotice("Đã gửi thông báo đến người nhận phù hợp.");
      formElement.reset();
      setScope("class");
      setClassName(classes[0] ?? "");
      setShowCompose(false);
      void load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể gửi thông báo."); }
    finally { setSending(false); }
  }

  async function markRead(id: string) { try { await notificationService.markRead(id); setItems((previous) => previous.map((item) => item.id === id ? { ...item, read_at: new Date().toISOString() } : item)); } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể cập nhật thông báo."); } }
  async function markAll() { try { await notificationService.markAllRead(); setItems((previous) => previous.map((item) => ({ ...item, read_at: item.read_at ?? new Date().toISOString() }))); } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể cập nhật thông báo."); } }

  return <section className="workspace-page"><div className="workspace-title-row"><div><div className="workspace-breadcrumb">Quản trị <span>/</span> Thông báo</div><h1>Thông báo</h1><p>Thông báo được gửi trực tiếp đến tài khoản sinh viên theo phạm vi lớp hoặc toàn trường.</p></div><button type="button" className="workspace-secondary" onClick={() => void markAll()}><CheckCheck size={16} /> Đọc tất cả</button></div>{error && <div className="workspace-alert" role="alert">{error}</div>}{notice && <div className="workspace-notice" role="status">{notice}</div>}
    {canSend && <>
      <div className="notification-compose-toggle"><button type="button" className="workspace-primary" aria-expanded={showCompose} aria-controls={showCompose ? "notification-compose-form" : undefined} onClick={() => setShowCompose((open) => !open)}>{showCompose ? <X size={16} /> : <Send size={16} />}{showCompose ? "Đóng biểu mẫu" : "Soạn thông báo"}{showCompose ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button></div>
      {showCompose && <form id="notification-compose-form" className="workspace-form notification-compose" onSubmit={send}>
        <div className="notification-compose-heading"><h2><Send size={17} /> Soạn thông báo</h2><span>{["super_admin", "system_admin", "sub_admin"].includes(role) ? "Gửi theo lớp hoặc toàn trường" : "Gửi đến sinh viên thuộc phạm vi phụ trách"}</span></div>
        <div className="workspace-form-grid">
          <label>Tiêu đề<input name="title" required maxLength={160} /></label>
          <label>Mức độ<select name="severity"><option value="normal">Thông thường</option><option value="important">Quan trọng</option><option value="urgent">Khẩn cấp</option></select></label>
          <label>Phạm vi<select name="scope" value={scope} onChange={(event) => setScope(event.target.value as "class" | "school")}><option value="class">Theo lớp phụ trách</option><option value="school">Toàn trường{["super_admin", "system_admin", "sub_admin"].includes(role) ? " · Tất cả người dùng" : " · Sinh viên phụ trách"}</option></select></label>
          {scope === "class" && <label>Lớp nhận<select name="className" value={className} required disabled={!classes.length} onChange={(event) => setClassName(event.target.value)}>{classes.map((name) => <option key={name} value={name}>{name}</option>)}</select>{!classes.length && <small className="notification-compose-hint">Chưa có lớp phụ trách để gửi thông báo.</small>}</label>}
          <label className="workspace-span">Nội dung<textarea name="body" rows={4} required maxLength={5000} /></label>
        </div>
        <button className="workspace-primary" disabled={sending || (scope === "class" && !className)}><Send size={15} /> {sending ? "Đang gửi…" : "Gửi thông báo"}</button>
      </form>}
    </>}
    {loading ? <div className="workspace-loading">Đang tải hộp thư…</div> : <div className="notification-list">{items.map((item) => <article key={item.id} className={`notification-card ${item.read_at ? "is-read" : ""}`}><div className={`notification-level level-${item.severity}`}><Bell size={16} /></div><div className="notification-card-body"><div className="notification-card-heading"><strong>{item.title}</strong><span>{formatDateTime(item.created_at)}</span></div><p>{item.body}</p><div className="notification-card-meta"><span>{item.scope === "school" ? "Toàn trường" : `Lớp ${item.class_name ?? ""}`}</span><span>{item.severity === "urgent" ? "Khẩn cấp" : item.severity === "important" ? "Quan trọng" : "Thông thường"}</span>{!item.read_at && <button type="button" onClick={() => void markRead(item.id)}>Đánh dấu đã đọc</button>}</div></div></article>)}{!items.length && <div className="workspace-panel notification-empty"><Bell size={22} /><strong>Chưa có thông báo</strong><span>Thông báo mới sẽ hiển thị tại đây.</span></div>}</div>}</section>;
}
