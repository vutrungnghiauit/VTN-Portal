import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Copy, Download, Handshake, History, MessageCircleQuestion, Shuffle, Sparkles, UsersRound, Volume2 } from "lucide-react";
import { studentService } from "../students/student.service";
import type { Student } from "../students/student.types";
import { formatDateTime } from "../../lib/date-format";
import { supabase } from "../../lib/supabase";
import { randomPickerService, type RandomHistory } from "./random-picker.service";
import "./workspace.css";

type Tool = "roll-call" | "groups" | "presentation" | "questions" | "pairs";
type Draw = { name: string; code?: string; id?: string };
const tools: Array<{ id: Tool; label: string; description: string }> = [
  { id: "roll-call", label: "Quay số gọi tên", description: "Chọn ngẫu nhiên sinh viên, ghi nhận điểm danh và tránh gọi trùng trong ngày." },
  { id: "groups", label: "Chia nhóm tự động", description: "Xáo trộn danh sách và chia đều thành 2 đến 8 nhóm." },
  { id: "presentation", label: "Thứ tự thuyết trình", description: "Bốc thăm thứ tự trình bày ngẫu nhiên cho cả lớp." },
  { id: "questions", label: "Câu hỏi vấn đáp", description: "Rút thăm câu hỏi chuyên môn Kinh tế số và Quản trị kinh doanh." },
  { id: "pairs", label: "Cặp đôi cùng tiến", description: "Ghép ngẫu nhiên sinh viên thành từng cặp học tập." },
];
const colors = ["#283898", "#2058A8", "#009FC0", "#20B6A4", "#70C058", "#F06028", "#8B5CF6", "#F472B6"];
const questionBank: Record<string, string[]> = {
  "Kinh tế số": ["Phân tích tác động của nền tảng số đến chi phí giao dịch và cấu trúc thị trường.", "Hiệu ứng mạng lưới là gì? Nêu ví dụ trong một nền tảng tại Việt Nam.", "Dữ liệu trở thành tài sản kinh tế như thế nào và cần quản trị ra sao?", "So sánh mô hình kinh doanh nền tảng với mô hình kinh doanh truyền thống.", "Phân tích cơ hội và rủi ro của trí tuệ nhân tạo đối với năng suất lao động.", "Thương mại điện tử xuyên biên giới tạo ra những thách thức nào cho doanh nghiệp nhỏ?", "Giải thích khái niệm kinh tế chia sẻ và đánh giá một ví dụ thực tế.", "Doanh nghiệp cần những năng lực số nào để chuyển đổi số thành công?", "Phân tích vai trò của thanh toán số trong tài chính toàn diện.", "Quyền riêng tư dữ liệu ảnh hưởng thế nào đến niềm tin và tăng trưởng nền tảng?"],
  "Quản trị kinh doanh": ["Phân tích cách doanh nghiệp xây dựng lợi thế cạnh tranh bền vững.", "So sánh lãnh đạo chuyển đổi và lãnh đạo giao dịch; khi nào nên áp dụng?", "Trình bày các bước xây dựng kế hoạch marketing cho sản phẩm mới.", "Phân tích cách quản trị rủi ro trong quyết định mở rộng thị trường.", "Văn hóa tổ chức tác động thế nào đến hiệu quả đổi mới sáng tạo?", "Đề xuất chỉ số KPI phù hợp để đánh giá hiệu quả một nhóm dự án.", "Phân biệt chiến lược cấp công ty và chiến lược cấp đơn vị kinh doanh.", "Doanh nghiệp nên xử lý xung đột lợi ích giữa tăng trưởng và trách nhiệm xã hội thế nào?", "Phân tích vai trò của trải nghiệm khách hàng trong giữ chân khách hàng.", "Một doanh nghiệp nhỏ có ngân sách hạn chế nên ưu tiên nguồn lực theo nguyên tắc nào?"]
};

function shuffle<T>(items: T[]) { const result = [...items]; for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; } return result; }
function vietnamDateKey() { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date()); }
function playWheelSound() {
  try {
    const Ctx = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const context = new Ctx(); const start = context.currentTime;
    for (let i = 0; i < 22; i++) { const at = start + i * (0.035 + i * 0.006); const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.type = "triangle"; oscillator.frequency.setValueAtTime(i === 21 ? 880 : 280 + (i % 3) * 80, at); gain.gain.setValueAtTime(0.001, at); gain.gain.exponentialRampToValueAtTime(i === 21 ? 0.15 : 0.04, at + 0.006); gain.gain.exponentialRampToValueAtTime(0.001, at + 0.045); oscillator.connect(gain); gain.connect(context.destination); oscillator.start(at); oscillator.stop(at + 0.05); }
    window.setTimeout(() => void context.close(), 2200);
  } catch { /* Sound can be blocked by browser preferences. */ }
}

export default function RandomPickerPage({ canCreate }: { canCreate: boolean }) {
  const [students, setStudents] = useState<Student[]>([]); const [history, setHistory] = useState<RandomHistory[]>([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [tool, setTool] = useState<Tool>("roll-call"); const [className, setClassName] = useState(""); const [manualNames, setManualNames] = useState(""); const [groupCount, setGroupCount] = useState(4); const [useManualRoster, setUseManualRoster] = useState(false);
  const [draws, setDraws] = useState<Draw[]>([]); const [question, setQuestion] = useState(""); const [questionTopic, setQuestionTopic] = useState("Kinh tế số");
  const [wheelDegrees, setWheelDegrees] = useState(0); const [spinning, setSpinning] = useState(false); const [celebrate, setCelebrate] = useState(false); const [callHistory, setCallHistory] = useState<RandomHistory[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const reload = useCallback(async () => {
    setLoading(true); setError("");
    try { const [roster, recent] = await Promise.all([studentService.list(), randomPickerService.history()]); setStudents(roster); setHistory(recent); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được dữ liệu Random."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); return () => { if (timer.current) window.clearTimeout(timer.current); }; }, [reload]);
  const classes = useMemo(() => [...new Set(students.map((item) => item.className).filter(Boolean))].sort(), [students]);
  const roster = useMemo(() => {
    const chosen = className ? students.filter((item) => item.className === className) : students;
    return chosen.map((item) => ({ id: item.id, code: item.studentCode, name: item.fullName }));
  }, [students, className]);
  const manualRoster = useMemo<Array<{ id?: string; code?: string; name: string }>>(() => manualNames.split(/\r?\n/).map((name) => name.trim()).filter(Boolean).map((name) => ({ name })), [manualNames]);
  const participants = useManualRoster ? manualRoster : roster.length ? roster : manualRoster;
  const todayDrawn = useMemo(() => new Set(callHistory.filter((item) => item.draw_type === "roll_call" && item.drawn_on === vietnamDateKey()).map((item) => item.student_id ?? `${item.student_code ?? ""}:${item.student_name ?? ""}`)), [callHistory]);
  const remaining = useMemo(() => participants.filter((item) => !todayDrawn.has(item.id ?? `${item.code ?? ""}:${item.name}`)), [participants, todayDrawn]);
  const currentRollHistory = draws[0]?.id ? callHistory.find((item) => item.student_id === draws[0].id) : undefined;

  useEffect(() => {
    if (tool !== "roll-call" || !supabase) return;
    let active = true;
    void randomPickerService.history(500).then((items) => { if (active) setCallHistory(items); }).catch(() => undefined);
    return () => { active = false; };
  }, [tool, history.length]);

  const record = useCallback(async (drawType: string, result: Draw[], metadata: Record<string, unknown> = {}) => {
    if (!canCreate) return;
    try {
      if (drawType === "roll_call") {
        const person = result[0];
        const saved = await randomPickerService.save({ draw_type: drawType, student_id: person.id ?? null, student_code: person.code ?? null, student_name: person.name, class_name: className || null, results: metadata });
        setHistory((items) => [saved, ...items]); setCallHistory((items) => [saved, ...items]);
      } else {
        const saved = await randomPickerService.save({ draw_type: drawType, class_name: className || null, student_name: result.length === 1 ? result[0].name : null, results: { ...metadata, entries: result } });
        setHistory((items) => [saved, ...items]);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể lưu lịch sử bốc thăm."); }
  }, [canCreate, className]);

  function startRollCall() {
    if (!canCreate) { setError("Tài khoản chưa có quyền ghi lịch sử Random. Hãy nhờ quản trị viên cấp quyền."); return; }
    if (!participants.length) { setError("Chưa có danh sách sinh viên. Hãy chọn lớp hoặc nhập tên, mỗi dòng một sinh viên."); return; }
    setError(""); setNotice("");
    if (remaining.length === 0) { setNotice("Danh sách đã được gọi hết trong ngày; các lượt đã chọn sẽ không bị gọi trùng."); return; }
    const pool = remaining.length ? remaining : participants; const winner = pool[Math.floor(Math.random() * pool.length)];
    const index = participants.findIndex((item) => item.id === winner.id && item.code === winner.code && item.name === winner.name); const sector = 360 / participants.length;
    setSpinning(true); setCelebrate(false); setDraws([]); setWheelDegrees((value) => value + 1800 + (360 - (index + 0.5) * sector)); playWheelSound();
    timer.current = window.setTimeout(() => { setSpinning(false); setDraws([winner]); setCelebrate(true); void record("roll_call", [winner], { source: roster.length ? "students" : "manual" }); window.setTimeout(() => setCelebrate(false), 2500); }, 4200);
  }

  async function setAttendance(item: RandomHistory, status: "present" | "absent") {
    try { await randomPickerService.setAttendance(item.id, status); const update = (rows: RandomHistory[]) => rows.map((row) => row.id === item.id ? { ...row, attendance_status: status } : row); setHistory(update); setCallHistory(update); setNotice(`Đã ghi nhận ${item.student_name}: ${status === "present" ? "có mặt" : "vắng mặt"}.`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không cập nhật được điểm danh."); }
  }

  async function runOtherTool() {
    setError(""); setNotice(""); setDraws([]); setBusy(true);
    if (tool === "questions") {
      const bank = questionBank[questionTopic]; const selectedQuestion = bank[Math.floor(Math.random() * bank.length)]; setQuestion(selectedQuestion); await record("oral_question", [{ name: selectedQuestion }], { topic: questionTopic, question: selectedQuestion }); setBusy(false); return;
    }
    const list = shuffle(participants);
    if (!list.length) { setBusy(false); setError("Chưa có sinh viên để bốc thăm. Hãy chọn lớp hoặc nhập danh sách."); return; }
    if (tool === "groups") {
      const buckets = Array.from({ length: groupCount }, (_, index) => ({ group: index + 1, members: [] as Draw[] }));
      list.forEach((person, index) => buckets[index % groupCount].members.push(person));
      const flat = buckets.flatMap((bucket) => bucket.members.map((person) => ({ ...person, name: `Nhóm ${bucket.group}: ${person.name}` })));
      setDraws(flat); await record("groups", flat, { groupCount, groups: buckets });
    } else if (tool === "presentation") {
      const ordered = list.map((person, index) => ({ ...person, name: `${index + 1}. ${person.name}` })); setDraws(ordered); await record("presentation_order", ordered, { entries: ordered });
    } else if (tool === "pairs") {
      const paired = list.map((person, index) => ({ ...person, name: `${Math.floor(index / 2) + 1}: ${person.name}${index === list.length - 1 && list.length % 2 ? " (chưa có cặp)" : ""}` })); setDraws(paired); await record("study_pairs", paired, { pairs: paired });
    }
    setBusy(false);
  }

  function exportCsv() {
    if (!draws.length) return;
    const rows = tool === "groups" ? draws.map((item) => item.name.split(": ")) : draws.map((item) => [item.name, item.code ?? ""]);
    const csv = `\uFEFF${rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n")}`;
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); link.download = `random-${tool}-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
  }
  async function copyResults() { const text = tool === "questions" ? question : draws.map((item) => item.name).join("\n"); try { await navigator.clipboard.writeText(text); setNotice("Đã sao chép kết quả."); } catch { setError("Trình duyệt không cho phép sao chép tự động."); } }

  return <section className="workspace-page random-suite-page">
    <div className="workspace-title-row"><div><div className="workspace-breadcrumb">Công cụ <span>/</span> Random</div><h1>Random tương tác</h1><p>Gọi tên, chia nhóm, xếp thứ tự, rút câu hỏi và ghép cặp học tập.</p></div><span className="random-live-badge"><Sparkles size={14} /> {students.length} sinh viên khả dụng</span></div>
    {error && <div className="workspace-alert" role="alert">{error}</div>}{notice && <div className="workspace-notice" role="status">{notice}</div>}
    <div className="random-suite-layout"><nav className="random-tool-tabs" aria-label="Công cụ bốc thăm">{tools.map((item) => <button type="button" key={item.id} className={tool === item.id ? "active" : ""} onClick={() => { setTool(item.id); setDraws([]); setError(""); }}>{item.label}</button>)}</nav>
      <div className="random-tool-content"><div className="random-tool-heading"><div><span>CÔNG CỤ TƯƠNG TÁC</span><h2>{tools.find((item) => item.id === tool)?.label}</h2><p>{tools.find((item) => item.id === tool)?.description}</p></div><Volume2 size={21} /></div>
        <div className="random-controls"><label>Lớp sinh viên<select value={className} onChange={(event) => setClassName(event.target.value)}><option value="">Tất cả lớp có quyền truy cập</option>{classes.map((item) => <option key={item}>{item}</option>)}</select></label>{tool === "groups" && <label>Số nhóm<select value={groupCount} onChange={(event) => setGroupCount(Number(event.target.value))}>{Array.from({ length: 7 }, (_, index) => index + 2).map((count) => <option key={count} value={count}>{count} nhóm</option>)}</select></label>}{tool === "questions" && <label>Chủ đề<select value={questionTopic} onChange={(event) => setQuestionTopic(event.target.value)}>{Object.keys(questionBank).map((item) => <option key={item}>{item}</option>)}</select></label>}</div>
        <label className="random-manual-toggle"><input type="checkbox" checked={useManualRoster} onChange={(event) => setUseManualRoster(event.target.checked)} /> Dùng danh sách tự nhập thay cho danh sách từ hệ thống</label>
        <label className="random-manual-roster">Danh sách thêm (mỗi tên một dòng, dùng khi không chọn được lớp)<textarea rows={3} value={manualNames} onChange={(event) => setManualNames(event.target.value)} placeholder="Nguyễn Văn A&#10;Trần Thị B" /></label>
        {tool === "roll-call" ? <div className="random-roll-stage"><div className="random-wheel" style={{ background: `conic-gradient(${participants.map((_, index) => `${colors[index % colors.length]} ${index * (100 / Math.max(1, participants.length))}% ${(index + 1) * (100 / Math.max(1, participants.length))}%`).join(",")})`, transform: `rotate(${wheelDegrees}deg)` }}><span>{spinning ? <Shuffle size={28} /> : draws[0]?.name ?? <UsersRound size={30} />}</span></div><div className="random-roll-caption">{draws[0] ? <><small>SINH VIÊN ĐƯỢC CHỌN</small><strong>{draws[0].name}</strong><span>{draws[0].code ?? ""}</span></> : <p>{remaining.length} lượt chưa gọi trong ngày</p>}</div><button type="button" className="workspace-primary" disabled={spinning || loading || !canCreate} onClick={startRollCall}><Shuffle size={17} /> {spinning ? "Đang quay..." : "Quay gọi tên"}</button>{draws[0]?.id && <div className="random-attendance-actions"><button type="button" disabled={!currentRollHistory} onClick={() => { if (currentRollHistory) void setAttendance(currentRollHistory, "present"); }}>Có mặt</button><button type="button" disabled={!currentRollHistory} onClick={() => { if (currentRollHistory) void setAttendance(currentRollHistory, "absent"); }}>Vắng mặt</button></div>}</div> : tool === "questions" ? <div className="random-question-card"><MessageCircleQuestion size={28} /><span>{question ? "CÂU HỎI ĐƯỢC BỐC" : "NGÂN HÀNG CÂU HỎI"}</span><p>{question || "Chọn chủ đề rồi bấm nút để rút câu hỏi vấn đáp."}</p><button className="workspace-primary" type="button" onClick={() => void runOtherTool()} disabled={busy || !canCreate}><Shuffle size={16} /> Bốc câu hỏi</button>{question && <button className="random-secondary-action" type="button" onClick={() => void copyResults()}><Copy size={15} /> Sao chép câu hỏi</button>}</div> : <div className="random-result-panel">{draws.length ? <div className={tool === "groups" ? "random-groups-grid" : "random-draw-list"}>{tool === "groups" ? Array.from({ length: groupCount }, (_, index) => <article key={index}><h3>Nhóm {index + 1}</h3><ol>{draws.filter((item) => item.name.startsWith(`Nhóm ${index + 1}: `)).map((item) => <li key={`${index}-${item.id ?? item.name}`}>{item.name.replace(`Nhóm ${index + 1}: `, "")}</li>)}</ol></article>) : draws.map((item, index) => <div key={`${index}-${item.id ?? item.name}`}><span>{tool === "presentation" ? `#${index + 1}` : `${Math.floor(index / 2) + 1}`}</span>{item.name.replace(/^\d+\. /, "").replace(/^\d+: /, "")}</div>)}</div> : <div className="random-result-placeholder"><Shuffle size={25} /><strong>Kết quả sẽ xuất hiện tại đây</strong><span>{participants.length} người trong danh sách hiện tại</span></div>}{draws.length > 0 && <div className="random-result-actions"><button type="button" onClick={() => void copyResults()}><Copy size={15} /> Sao chép</button><button type="button" onClick={exportCsv}><Download size={15} /> Tải CSV</button></div>}<button className="workspace-primary" type="button" onClick={() => void runOtherTool()} disabled={busy || loading || !canCreate}><Shuffle size={16} /> {busy ? "Đang xáo trộn..." : tool === "groups" ? "Chia nhóm" : tool === "pairs" ? "Ghép cặp" : "Bốc thứ tự"}</button></div>}
      </div>
    </div>
    <section className="workspace-panel random-history-panel"><div className="random-history-heading"><div><History size={18} /><h2>Lịch sử gọi tên và bốc thăm</h2></div><span>{history.length} lượt gần đây</span></div>{loading ? <div className="workspace-loading">Đang tải...</div> : <div className="random-history-list">{history.slice(0, 20).map((item) => <article key={item.id}><span className="random-history-mark">{item.draw_type === "roll_call" ? <UsersRound size={15} /> : item.draw_type === "study_pairs" ? <Handshake size={15} /> : <Shuffle size={15} />}</span><div><strong>{item.student_name ?? String(item.results?.topic ?? item.draw_type.replaceAll("_", " "))}</strong><small>{item.student_code ? `${item.student_code} · ` : ""}{item.class_name ?? "Danh sách thủ công"} · {formatDateTime(item.created_at)}</small></div>{item.draw_type === "roll_call" ? <div className="random-history-attendance"><button type="button" className={item.attendance_status === "present" ? "selected" : ""} disabled={!canCreate} onClick={() => void setAttendance(item, "present")}>Có mặt</button><button type="button" className={item.attendance_status === "absent" ? "selected absent" : ""} disabled={!canCreate} onClick={() => void setAttendance(item, "absent")}>Vắng</button></div> : <span className="random-history-type">{item.draw_type.replaceAll("_", " ")}</span>}</article>)}{!history.length && <div className="random-history-empty">Chưa có lịch sử. Kết quả sẽ được lưu ở đây.</div>}</div>}</section>
    {celebrate && <div className="random-fireworks" aria-hidden="true">{Array.from({ length: 26 }, (_, index) => <i key={index} style={{ "--x": `${(index * 37) % 100}%`, "--y": `${(index * 53) % 75}%`, "--h": `${(index * 29) % 360}deg`, "--delay": `${(index % 8) * 45}ms` } as CSSProperties} />)}</div>}
  </section>;
}
