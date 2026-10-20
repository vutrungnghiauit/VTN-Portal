import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Check, Clock3, Image, LoaderCircle, X } from "lucide-react";
import { formatDateTime } from "../../lib/date-format";
import { supabase } from "../../lib/supabase";
import { supportTicketService, type SupportTicket, type SupportTicketAssignee, type SupportTicketEvent, type SupportTicketStatus } from "./support-ticket.service";

const stages: { status: SupportTicketStatus; title: string }[] = [
  { status: "pending", title: "Đã gửi phiếu" },
  { status: "assigned", title: "Đã phân công" },
  { status: "in_progress", title: "Đang xử lý" },
  { status: "completed", title: "Hoàn tất" },
];
const statusIndex = (value: SupportTicketStatus) => stages.findIndex((stage) => stage.status === value);
const priorityLabels = { low: "Thấp", normal: "Trung bình", high: "Cao", urgent: "Khẩn cấp" };

export default function SupportTicketDetails({ ticket, staff, canUpdate, onClose, onChanged }: {
  ticket: SupportTicket;
  staff: boolean;
  canUpdate: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [events, setEvents] = useState<SupportTicketEvent[]>([]);
  const [assignees, setAssignees] = useState<SupportTicketAssignee[]>([]);
  const [imageUrl, setImageUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<SupportTicketStatus>(ticket.status);
  const [assigneeId, setAssigneeId] = useState(ticket.assignee_id ?? "");
  const [assigneeName, setAssigneeName] = useState(ticket.assignee_name ?? "");
  const [assigneeRole, setAssigneeRole] = useState(ticket.assignee_role ?? "");
  const [startNote, setStartNote] = useState("");
  const [startHasCost, setStartHasCost] = useState(false);
  const [costReason, setCostReason] = useState("");
  const [costAmount, setCostAmount] = useState("");
  const [progressNote, setProgressNote] = useState("");
  const onChangedRef = useRef(onChanged);

  useEffect(() => { onChangedRef.current = onChanged; }, [onChanged]);
  useEffect(() => {
    setStatus(ticket.status);
    setAssigneeId(ticket.assignee_id ?? "");
    setAssigneeName(ticket.assignee_name ?? "");
    setAssigneeRole(ticket.assignee_role ?? "");
  }, [ticket.status, ticket.assignee_id, ticket.assignee_name, ticket.assignee_role]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([
      supportTicketService.listEvents(ticket.id),
      ticket.image_path ? supportTicketService.signedImageUrl(ticket.image_path).catch(() => "") : Promise.resolve(""),
      staff && canUpdate ? supportTicketService.listAssignees().catch(() => []) : Promise.resolve([]),
    ]).then(([nextEvents, nextImage, nextAssignees]) => {
      if (!active) return;
      setEvents(nextEvents);
      setImageUrl(nextImage);
      setAssignees(nextAssignees as SupportTicketAssignee[]);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Không tải được lịch sử phiếu hỗ trợ.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ticket.id, ticket.image_path, staff, canUpdate]);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const channel = client.channel(`support-ticket-workflow-${ticket.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "support_tickets", filter: `id=eq.${ticket.id}` }, () => {
        void supportTicketService.listEvents(ticket.id).then(setEvents).catch(() => undefined);
        onChangedRef.current();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "support_ticket_events", filter: `ticket_id=eq.${ticket.id}` }, () => {
        void supportTicketService.listEvents(ticket.id).then(setEvents).catch(() => undefined);
        onChangedRef.current();
      })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [ticket.id]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const currentStage = useMemo(() => stages[statusIndex(status)]?.title ?? "Đã gửi phiếu", [status]);

  async function update(nextStatus: SupportTicketStatus, note = "", nextAssigneeId = assigneeId) {
    setSaving(true);
    setError("");
    try {
      await supportTicketService.updateProgress({ ticketId: ticket.id, status: nextStatus, assigneeId: nextAssigneeId || null, note });
      setStatus(nextStatus);
      setEvents(await supportTicketService.listEvents(ticket.id));
      setProgressNote("");
      setStartNote("");
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không lưu được tiến độ xử lý.");
    } finally {
      setSaving(false);
    }
  }

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const person = assignees.find((option) => option.user_id === assigneeId);
    if (!person && assigneeId !== ticket.assignee_id) {
      setError("Hãy chọn một tài khoản phụ trách hợp lệ.");
      return;
    }
    setAssigneeName(person?.display_name ?? assigneeName);
    setAssigneeRole(person?.role_label ?? assigneeRole);
    await update(status === "pending" ? "assigned" : status, "", assigneeId);
  }

  async function beginWork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assigneeId) {
      setError("Cần phân công người phụ trách trước khi bắt đầu xử lý.");
      return;
    }
    if (startHasCost && (!costReason.trim() || !/^\d+$/.test(costAmount) || Number(costAmount) <= 0)) {
      setError("Nhập lý do và số tiền nguyên dương khi phát sinh chi phí.");
      return;
    }
    const details = [startNote.trim() ? `Ghi chú ban đầu: ${startNote.trim()}` : "", startHasCost ? `Phát sinh chi phí: ${costReason.trim()} — ${Number(costAmount).toLocaleString("vi-VN")} VNĐ` : ""].filter(Boolean).join("\n");
    await update("in_progress", details);
  }

  const eventTitle = (item: SupportTicketEvent) => item.event_type === "submitted" ? "Phiếu hỗ trợ đã được gửi"
    : item.event_type === "assigned" ? "Đã phân công phụ trách"
      : item.event_type === "status_changed" ? `Cập nhật trạng thái: ${stages[statusIndex(item.status ?? "pending")]?.title ?? "Đang xử lý"}`
        : "Ghi chú xử lý";

  return <div className="support-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="support-ticket-modal" role="dialog" aria-modal="true" aria-labelledby="support-detail-title">
      <header className="support-detail-header">
        <div className="support-ticket-ident"><strong>{ticket.ticket_code || `YC-${new Date(ticket.created_at).getFullYear()}-${ticket.id.slice(0, 6).toUpperCase()}`}</strong>{ticket.room && <span>Phòng {ticket.room}</span>}<span className={`support-status-pill is-${status}`}>{currentStage}</span></div>
        <div className="support-detail-byline">Người tạo: {ticket.creator_name || ticket.student_name || "Sinh viên"} · {formatDateTime(ticket.created_at)}</div>
        <button type="button" className="support-modal-close" aria-label="Đóng" onClick={onClose}><X size={19} /></button>
      </header>
      <div className="support-detail-content">
        <div className="support-ticket-category">{ticket.category} · Mức độ ưu tiên: <strong>{priorityLabels[ticket.priority] ?? "Trung bình"}</strong></div>
        <h2 id="support-detail-title">{ticket.title}</h2>
        {(ticket.student_name || ticket.student_code) && <p className="support-ticket-student-context">Sinh viên: <strong>{ticket.student_name || "Chưa có tên"}</strong>{ticket.student_code ? ` · ${ticket.student_code}` : ""}</p>}
        <p className="support-ticket-description">{ticket.description}</p>
        {ticket.location && <p className="support-ticket-location">Địa điểm: {ticket.location}</p>}
        {imageUrl && <a className="support-ticket-image" href={imageUrl} target="_blank" rel="noreferrer"><img src={imageUrl} alt="Ảnh đính kèm phiếu hỗ trợ" /><span><Image size={14} /> Xem ảnh đính kèm</span></a>}
        <section className="support-workflow" aria-label="Quy trình xử lý">
          <div className="support-workflow-heading"><strong>Quy trình xử lý</strong><span>Trạng thái hiện tại: {currentStage.toLocaleUpperCase("vi-VN")}</span></div>
          <div className="support-workflow-steps">{stages.map((stage, index) => <div className={`support-workflow-step ${index <= statusIndex(status) ? "is-done" : ""} ${stage.status === status ? "is-current" : ""}`} key={stage.status}><small>Bước {index + 1}</small><strong>{stage.title}</strong>{index < statusIndex(status) && <Check size={14} />}</div>)}</div>
        </section>
        {(assigneeName || assigneeRole) && <div className="support-assignee-box">Phụ trách kỹ thuật: <strong>{assigneeName || "Chưa ghi tên"}</strong>{assigneeRole ? ` (${assigneeRole})` : ""}</div>}

        {staff && canUpdate && status !== "completed" && <>
          <form className="support-progress-form" onSubmit={assign}>
            <h3>Phân công kỹ thuật viên</h3>
            <div className="support-assignment-row"><select aria-label="Chọn người phụ trách" value={assigneeId} onChange={(event) => { const id = event.target.value; const person = assignees.find((option) => option.user_id === id); setAssigneeId(id); setAssigneeName(person?.display_name ?? ""); setAssigneeRole(person?.role_label ?? ""); }}><option value="">Chọn tài khoản phụ trách</option>{ticket.assignee_id && !assignees.some((person) => person.user_id === ticket.assignee_id) && <option value={ticket.assignee_id}>{assigneeName || "Người phụ trách hiện tại"}</option>}{assignees.map((person) => <option key={person.user_id} value={person.user_id}>{person.display_name} · {person.role_label}</option>)}</select><button className="workspace-primary" disabled={saving || !assigneeId}>{saving ? <LoaderCircle size={15} className="support-spinner" /> : null}Gán người phụ trách</button></div>
          </form>

          {status === "assigned" && <form className="support-progress-form support-start-form" onSubmit={beginWork}>
            <h3>Bắt đầu xử lý phiếu</h3>
            <label>Ghi chú ban đầu<textarea rows={3} value={startNote} onChange={(event) => setStartNote(event.target.value)} placeholder="Mô tả tình trạng khi bắt đầu xử lý…" /></label>
            <label className="support-cost-toggle"><input type="checkbox" checked={startHasCost} onChange={(event) => setStartHasCost(event.target.checked)} />Phát sinh chi phí</label>
            {startHasCost && <div className="support-cost-fields"><label>Lý do phát sinh *<input required value={costReason} onChange={(event) => setCostReason(event.target.value)} placeholder="Ví dụ: Thay bộ tay cầm vòi sen" /></label><label>Giá tiền (VNĐ, số nguyên) *<input required type="number" min="1" step="1" value={costAmount} onChange={(event) => setCostAmount(event.target.value)} placeholder="Nhập số tiền đầy đủ, ví dụ 250000" /></label><small>Chi phí được ghi nhận trong lịch sử phiếu để đối chiếu.</small></div>}
            <div className="support-progress-actions"><button type="submit" className="support-action-button is-warning" disabled={saving || !assigneeId}>{saving ? "Đang lưu…" : "Bắt đầu xử lý"}</button></div>
          </form>}

          {status === "in_progress" && <form className="support-progress-form support-start-form" onSubmit={(event) => { event.preventDefault(); void update("in_progress", progressNote); }}>
            <h3>Cập nhật tiến độ xử lý</h3>
            <label>Ghi chú tiến độ<textarea rows={3} value={progressNote} onChange={(event) => setProgressNote(event.target.value)} placeholder="Ghi chú tiến độ sẽ hiển thị trong lịch sử của sinh viên…" /></label>
            <div className="support-progress-actions"><button type="submit" className="support-secondary-button" disabled={saving || !progressNote.trim()}>Lưu cập nhật</button><button type="button" className="support-action-button is-success" disabled={saving} onClick={() => void update("completed", progressNote)}>{saving ? "Đang lưu…" : "Hoàn tất phiếu"}</button></div>
          </form>}
        </>}

        <section className="support-event-list" aria-label="Lịch sử xử lý">
          {loading ? <p className="support-timeline-muted"><Clock3 size={15} /> Đang tải lịch sử…</p> : events.length ? events.map((item) => <article className="support-event" key={item.id}><span className="support-event-dot" /><div><strong>{eventTitle(item)}</strong>{item.message && <p>{item.message}</p>}<small>{item.actor_name || "Người dùng"} · {formatDateTime(item.created_at)}</small></div></article>) : <p className="support-timeline-muted">Chưa có cập nhật tiến độ.</p>}
        </section>
        {error && <div className="workspace-alert" role="alert">{error}</div>}
      </div>
      <footer className="support-detail-footer"><button type="button" onClick={onClose}>Đóng</button></footer>
    </section>
  </div>;
}
