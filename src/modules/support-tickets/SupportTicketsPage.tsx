import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, LifeBuoy, Plus, Search, Trash2 } from "lucide-react";
import QuickFilterHeading from "../workspace/QuickFilterHeading";
import SearchableFilter from "../../components/SearchableFilter";
import { formatDateTime } from "../../lib/date-format";
import { supabase } from "../../lib/supabase";
import { supportTicketService, type SupportTicket, type SupportTicketStatus } from "./support-ticket.service";
import SupportTicketDetails from "./SupportTicketDetails";
import SupportTicketForm from "./SupportTicketForm";
import "../workspace/workspace.css";
import "./support-tickets.css";

const statusNames: Record<SupportTicketStatus, string> = { pending: "Mới tạo", assigned: "Đã phân công", in_progress: "Đang xử lý", completed: "Đã hoàn tất" };
const priorityNames = { low: "Thấp", normal: "Trung bình", high: "Cao", urgent: "Khẩn cấp" };
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("vi-VN").trim();

export default function SupportTicketsPage({ role, canCreate = false, canUpdate = false, canDelete = false }: { role: string; canCreate?: boolean; canUpdate?: boolean; canDelete?: boolean }) {
  const [items, setItems] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const isStaff = ["super_admin", "system_admin", "sub_admin", "teacher", "assistant"].includes(role);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setItems(await supportTicketService.list()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể tải danh sách phiếu hỗ trợ."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const channel = client.channel("support-ticket-inbox")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "support_tickets" }, () => void load())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "support_tickets" }, () => void load())
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [load]);

  const categories = useMemo(() => [...new Set(items.map((item) => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi")), [items]);
  const statusCounts = useMemo(() => items.reduce<Record<string, number>>((counts, item) => { counts[item.status] = (counts[item.status] ?? 0) + 1; return counts; }, {}), [items]);
  const statusTabs = [{ value: "", label: "Tất cả", count: items.length }, ...Object.entries(statusNames).map(([value, label]) => ({ value, label, count: statusCounts[value] ?? 0 }))];
  const visibleItems = useMemo(() => items.filter((item) => {
    const text = normalize(`${item.ticket_code ?? ""} ${item.student_code ?? ""} ${item.student_name ?? ""} ${item.title} ${item.description} ${item.category}`);
    return (!search || text.includes(normalize(search))) && (!statusFilter || item.status === statusFilter) && (!categoryFilter || item.category === categoryFilter);
  }), [items, search, statusFilter, categoryFilter]);
  const hasFilters = Boolean(search || statusFilter || categoryFilter);

  async function moveToTrash(item: SupportTicket) {
    if (!window.confirm(`Chuyển phiếu “${item.title}” vào thùng rác?`)) return;
    try { await supportTicketService.moveToTrash(item.id); setNotice("Đã chuyển phiếu vào thùng rác."); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể chuyển phiếu vào thùng rác."); }
  }

  return <section className="workspace-page support-page">
    <div className="workspace-title-row"><div><div className="workspace-breadcrumb">Hỗ trợ <span>/</span> Quản lý phiếu hỗ trợ</div><h1>Quản lý phiếu hỗ trợ</h1><p>Tiếp nhận yêu cầu, phân công nhân sự và theo dõi từng bước xử lý cho sinh viên.</p></div><div className="workspace-title-actions">{canCreate && <button type="button" className="workspace-primary" onClick={() => { setShowCreate((value) => !value); setNotice(""); }}><Plus size={16} />{showCreate ? "Đóng biểu mẫu" : "Tạo phiếu hỗ trợ mới"}</button>}</div></div>
    {error && <div className="workspace-alert" role="alert">{error}</div>}{notice && <div className="workspace-notice" role="status">{notice}</div>}
    {showCreate && canCreate && <SupportTicketForm staff onClose={() => setShowCreate(false)} onSaved={(message) => { setNotice(message); setShowCreate(false); void load(); }} />}
    <nav className="support-status-tabs" aria-label="Lọc theo trạng thái phiếu">{statusTabs.map((tab) => <button type="button" key={tab.value || "all"} className={statusFilter === tab.value ? "is-active" : ""} onClick={() => setStatusFilter(tab.value)}><i className={`support-tab-dot ${tab.value || "all"}`} />{tab.label} <span>({tab.count})</span></button>)}</nav>
    <div className="workspace-filter-panel" aria-label="Bộ lọc Phiếu hỗ trợ"><QuickFilterHeading subtitle={loading ? "Đang tải phiếu…" : `${visibleItems.length} / ${items.length} phiếu`} onClear={() => { setSearch(""); setStatusFilter(""); setCategoryFilter(""); }} clearDisabled={!hasFilters} /><div className="workspace-filter-controls support-ticket-filter-controls"><label className="support-ticket-search"><span>Tìm nhanh</span><div><Search size={16} /><input aria-label="Tìm phiếu hỗ trợ" placeholder="Tìm mã phiếu, mã SV, họ tên hoặc nội dung…" value={search} onChange={(event) => setSearch(event.target.value)} /></div></label><label>Trạng thái<SearchableFilter value={statusFilter} allValue="" allLabel="Tất cả trạng thái" options={Object.entries(statusNames).map(([value, label]) => ({ value, label }))} onChange={setStatusFilter} /></label><label>Loại yêu cầu<SearchableFilter value={categoryFilter} allValue="" allLabel="Tất cả loại" options={categories.map((category) => ({ value: category, label: category }))} onChange={setCategoryFilter} /></label></div></div>
    {loading ? <div className="workspace-loading">Đang tải phiếu hỗ trợ…</div> : <div className="support-ticket-list">{visibleItems.map((item) => <article className="support-ticket-card" key={item.id}><div className="support-ticket-card-main"><div className="support-ticket-list-meta"><strong>{item.ticket_code || `YC-${new Date(item.created_at).getFullYear()}-${item.id.slice(0, 6).toUpperCase()}`}</strong>{item.room && <span>Phòng {item.room}</span>}<span className={`support-priority-pill is-${item.priority}`}>{priorityNames[item.priority] ?? "Trung bình"}</span></div><h2>{item.title}</h2><p>{item.description}</p><div className="support-ticket-student-line">Sinh viên: <strong>{item.student_name || "Chưa có tên"}</strong>{item.student_code ? <span> · {item.student_code}</span> : null} · {item.category}</div><div className="support-ticket-card-bottom"><span className={`support-status-pill is-${item.status}`}>{statusNames[item.status]}</span><small>{formatDateTime(item.created_at)}</small></div></div><div className="support-ticket-card-actions"><button type="button" className="support-icon-button" title="Xem quy trình" aria-label={`Xem quy trình ${item.ticket_code ?? item.title}`} onClick={() => setSelected(item)}><Eye size={17} /></button>{canDelete && <button type="button" className="support-icon-button is-danger" title="Xóa phiếu" aria-label="Xóa phiếu" onClick={() => void moveToTrash(item)}><Trash2 size={16} /></button>}</div></article>)}{!visibleItems.length && <div className="workspace-panel notification-empty"><LifeBuoy size={22} /><strong>{items.length ? "Không tìm thấy phiếu phù hợp" : "Chưa có phiếu hỗ trợ"}</strong><span>Phiếu do sinh viên hoặc nhân sự hỗ trợ tạo sẽ xuất hiện tại đây.</span></div>}</div>}
    {selected && <SupportTicketDetails ticket={items.find((item) => item.id === selected.id) ?? selected} staff={isStaff} canUpdate={canUpdate} onClose={() => setSelected(null)} onChanged={() => void load()} />}
  </section>;
}
