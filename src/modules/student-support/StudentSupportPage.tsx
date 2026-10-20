import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, LifeBuoy, Plus, Search } from "lucide-react";
import { formatDateTime } from "../../lib/date-format";
import { supabase } from "../../lib/supabase";
import QuickFilterHeading from "../workspace/QuickFilterHeading";
import SearchableFilter from "../../components/SearchableFilter";
import SupportTicketDetails from "../support-tickets/SupportTicketDetails";
import SupportTicketForm from "../support-tickets/SupportTicketForm";
import { supportTicketService, type SupportTicket, type SupportTicketStatus } from "../support-tickets/support-ticket.service";
import "../workspace/workspace.css";
import "../support-tickets/support-tickets.css";

const labels: Record<SupportTicketStatus, string> = { pending: "Đã gửi phiếu", assigned: "Đã phân công", in_progress: "Đang xử lý", completed: "Hoàn tất" };
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("vi-VN").trim();

export default function StudentSupportPage({ role, canCreate = false, canCreateForStudent = false }: { role: string; canCreate?: boolean; canCreateForStudent?: boolean }) {
  const staff = ["super_admin", "system_admin", "sub_admin", "teacher", "assistant"].includes(role);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setTickets(await supportTicketService.list()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể tải yêu cầu hỗ trợ."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const channel = client.channel("student-support-ticket-list")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "support_tickets" }, () => void load())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "support_tickets" }, () => void load())
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [load]);

  const filtered = useMemo(() => tickets.filter((ticket) => {
    const haystack = normalize(`${ticket.ticket_code ?? ""} ${ticket.title} ${ticket.description} ${ticket.category}`);
    return (!search || haystack.includes(normalize(search))) && (!statusFilter || ticket.status === statusFilter);
  }), [tickets, search, statusFilter]);
  const hasFilters = Boolean(search || statusFilter);

  const canSubmit = canCreate && (!staff || canCreateForStudent);
  return <section className="workspace-page support-page">
    <div className="workspace-title-row"><div><div className="workspace-breadcrumb">Hỗ trợ <span>/</span> Hỗ trợ sinh viên</div><h1>Hỗ trợ sinh viên</h1><p>Tạo yêu cầu và theo dõi từng bước xử lý phiếu hỗ trợ.</p></div>{canSubmit && <button type="button" className="workspace-primary" onClick={() => { setShowCreate(true); setNotice(""); }}><Plus size={16} />Tạo phiếu hỗ trợ mới</button>}</div>
    {error && <div className="workspace-alert" role="alert">{error}</div>}{notice && <div className="workspace-notice" role="status">{notice}</div>}
    {showCreate && <SupportTicketForm staff={staff} onClose={() => setShowCreate(false)} onSaved={(message) => { setNotice(message); setShowCreate(false); void load(); }} />}
    <div className="support-student-ticket-section"><div className="support-section-title"><div><h2>Phiếu hỗ trợ của tôi</h2><p>Trạng thái và ghi chú được cập nhật theo tiến trình xử lý.</p></div><span>{filtered.length} phiếu</span></div>
      <div className="workspace-filter-panel" aria-label="Lọc phiếu hỗ trợ của tôi"><QuickFilterHeading subtitle={loading ? "Đang tải phiếu…" : `${filtered.length} / ${tickets.length} phiếu`} onClear={() => { setSearch(""); setStatusFilter(""); }} clearDisabled={!hasFilters} /><div className="workspace-filter-controls support-ticket-filter-controls student-support-filter-controls"><label className="support-ticket-search"><span>Tìm nhanh</span><div><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Tìm phiếu của tôi" placeholder="Tìm mã phiếu, tiêu đề hoặc nội dung…" /></div></label><label>Trạng thái<SearchableFilter value={statusFilter} allValue="" allLabel="Tất cả trạng thái" options={Object.entries(labels).map(([value, label]) => ({ value, label }))} onChange={setStatusFilter} /></label></div></div>
      {loading ? <div className="workspace-loading">Đang tải phiếu hỗ trợ…</div> : <div className="support-ticket-list">{filtered.map((ticket) => <article className="support-ticket-card" key={ticket.id}><div className="support-ticket-card-main"><div className="support-ticket-list-meta"><strong>{ticket.ticket_code || `YC-${new Date(ticket.created_at).getFullYear()}-${ticket.id.slice(0, 6).toUpperCase()}`}</strong>{ticket.room && <span>Phòng {ticket.room}</span>}<span className={`support-status-pill is-${ticket.status}`}>{labels[ticket.status]}</span></div><h2>{ticket.title}</h2><p>{ticket.description}</p><div className="support-ticket-student-line">{ticket.category} · {formatDateTime(ticket.created_at)}</div></div><button type="button" className="support-icon-button" title="Xem quy trình xử lý" aria-label="Xem quy trình xử lý" onClick={() => setSelected(ticket)}><Eye size={17} /></button></article>)}{!filtered.length && <div className="workspace-panel notification-empty"><LifeBuoy size={22} /><strong>{tickets.length ? "Không tìm thấy phiếu phù hợp" : "Bạn chưa gửi phiếu hỗ trợ nào"}</strong><span>Khi gửi phiếu, bạn có thể mở từng phiếu để xem tiến độ và ghi chú.</span></div>}</div>}
    </div>
    {selected && <SupportTicketDetails ticket={tickets.find((ticket) => ticket.id === selected.id) ?? selected} staff={staff} canUpdate={false} onClose={() => setSelected(null)} onChanged={() => void load()} />}
  </section>;
}
