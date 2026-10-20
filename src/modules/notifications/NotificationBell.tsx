import { useEffect, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { formatDateTime } from "../../lib/date-format";
import { notificationService, type AppNotification } from "./notification.service";
import "./notification.css";

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = async () => { try { const inbox = await notificationService.inbox(); if (active) { setItems(inbox); setError(""); } } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Không thể tải thông báo."); } };
    void load();
    let channel: ReturnType<NonNullable<typeof supabase>["channel"]> | undefined;
    void supabase?.auth.getUser().then(({ data }) => {
      if (data.user && active) channel = supabase?.channel(`inbox-${data.user.id}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "app_notification_recipients", filter: `recipient_id=eq.${data.user.id}` }, () => void load()).subscribe();
    });
    const timer = window.setInterval(() => void load(), 30000);
    return () => { active = false; window.clearInterval(timer); if (channel) void supabase?.removeChannel(channel); };
  }, []);
  const unread = items.filter((item) => !item.read_at).length;
  async function markAll() { try { await notificationService.markAllRead(); setItems((previous) => previous.map((item) => ({ ...item, read_at: item.read_at ?? new Date().toISOString() }))); } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể cập nhật."); } }
  async function markRead(item: AppNotification) { if (item.read_at) return; try { await notificationService.markRead(item.id); setItems((previous) => previous.map((value) => value.id === item.id ? { ...value, read_at: new Date().toISOString() } : value)); } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể cập nhật."); } }
  return <div className="notification-bell"><button type="button" className="notification-bell-button" aria-label={`Thông báo chưa đọc: ${unread}`} onClick={() => setOpen((value) => !value)}><Bell size={18} />{unread > 0 && <span>{unread > 99 ? "99+" : unread}</span>}</button>{open && <div className="notification-popover"><div className="notification-popover-head"><strong>Thông báo</strong><button type="button" onClick={() => void markAll()}><CheckCheck size={14} /> Đọc tất cả</button></div>{error && <p className="notification-popover-error">{error}</p>}{items.slice(0, 6).map((item) => <button key={item.id} type="button" className={`notification-popover-item ${item.read_at ? "read" : ""}`} onClick={() => void markRead(item)}><strong>{item.title}</strong><span>{item.body}</span><small>{formatDateTime(item.created_at)}</small></button>)}{!items.length && <p className="notification-popover-empty">Chưa có thông báo.</p>}<Link to="/notifications" onClick={() => setOpen(false)}>Xem tất cả thông báo</Link></div>}</div>;
}
