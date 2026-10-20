import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

type SupportTicketRow = {
  id: string;
  ticket_code: string | null;
  title: string;
  description: string;
  category: string;
  student_user_id: string | null;
  student_record_id: string | null;
  student_code: string | null;
  student_name: string | null;
  teacher_id: string;
  created_at: string;
};
export type PushTicketToast = {
  id: string;
  code: string;
  studentName: string;
  className: string;
  title: string;
  summary: string;
};

function playDing() {
  try {
    const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(1320, context.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.34);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.36);
    oscillator.onended = () => void context.close();
  } catch { /* Audio can be blocked by browser policy. */ }
}

function ticketCode(ticket: SupportTicketRow) {
  if (ticket.ticket_code) return ticket.ticket_code;
  const year = new Date(ticket.created_at || Date.now()).getFullYear();
  const suffix = ticket.id.replace(/\D/g, "").slice(-3).padStart(3, "0");
  return `YC-${year}-${suffix}`;
}

export function usePushNotifications(enabled: boolean, role: string) {
  const [toast, setToast] = useState<PushTicketToast | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>(() => typeof Notification === "undefined" ? "denied" : Notification.permission);
  const timer = useRef<number | undefined>(undefined);

  const requestPermission = useCallback(async () => {
    if (!("Notification" in window)) return "denied" as NotificationPermission;
    try {
      const next = await Notification.requestPermission();
      setPermission(next);
      return next;
    } catch {
      setPermission("denied");
      return "denied" as NotificationPermission;
    }
  }, []);

  const publish = useCallback((notice: PushTicketToast) => {
    setToast(notice);
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 10000);
    playDing();
    if ("Notification" in window && Notification.permission === "granted") {
      const notification = new Notification("Có phiếu hỗ trợ mới", {
        body: `${notice.code} · ${notice.studentName} · ${notice.className}: ${notice.summary}`,
        tag: notice.id,
      });
      notification.onclick = () => { window.focus(); window.location.assign("/supports"); notification.close(); };
    }
  }, []);

  const dismiss = useCallback(() => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    setToast(null);
  }, []);

  useEffect(() => {
    if (!enabled || !supabase) return;
    let active = true;
    let channel: ReturnType<NonNullable<typeof supabase>["channel"]> | undefined;
    const test = () => publish({ id: "push-test", code: `YC-${new Date().getFullYear()}-892`, studentName: "Nguyễn Minh Anh", className: "23DQT1A", title: "Kiểm tra thông báo đẩy", summary: "Đây là thông báo thử để xác nhận luồng nhận phiếu hỗ trợ." });
    window.addEventListener("vtn-test-push-notification", test);

    void supabase.auth.getUser().then(async ({ data, error }) => {
      if (!active || error || !data.user || !supabase) return;
      const currentUserId = data.user.id;
      const subscription = supabase.channel(`support-ticket-push-${currentUserId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "support_tickets" }, async ({ new: row }) => {
          const ticket = row as SupportTicketRow;
          const studentQuery = supabase!.from("students").select("full_name,class_name").is("deleted_at", null);
          const { data: student } = ticket.student_record_id
            ? await studentQuery.eq("id", ticket.student_record_id).maybeSingle()
            : ticket.student_user_id
              ? await studentQuery.eq("auth_user_id", ticket.student_user_id).eq("owner_id", ticket.teacher_id).limit(1).maybeSingle()
              : { data: null };
          if (!active) return;
          const summary = ticket.description.replace(/\s+/g, " ").trim();
          publish({ id: ticket.id, code: ticketCode(ticket), studentName: student?.full_name ?? ticket.student_name ?? "Sinh viên", className: student?.class_name ?? "Chưa có lớp", title: ticket.title || ticket.category || "Phiếu hỗ trợ mới", summary: summary.length > 150 ? `${summary.slice(0, 147)}…` : summary });
        })
        .subscribe();
      channel = subscription;
    }).catch(() => undefined);

    return () => {
      active = false;
      window.removeEventListener("vtn-test-push-notification", test);
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      if (channel && supabase) void supabase.removeChannel(channel);
    };
  }, [enabled, publish, role]);

  return { toast, permission, requestPermission, dismiss };
}

export const useSystemPushNotifications = usePushNotifications;
