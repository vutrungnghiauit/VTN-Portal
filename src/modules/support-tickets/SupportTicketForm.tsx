import { useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, ImagePlus, Send, Star, X } from "lucide-react";
import { supportTicketService, type SupportTicketPriority, type SupportTicketStudent } from "./support-ticket.service";

const priorityOptions: { value: SupportTicketPriority; label: string }[] = [
  { value: "low", label: "Thấp" },
  { value: "normal", label: "Trung bình" },
  { value: "high", label: "Cao" },
  { value: "urgent", label: "Khẩn cấp" },
];
const categoryOptions = ["Hệ thống điện", "Hệ thống nước", "Mạng WiFi/Internet", "Thiết bị phòng học", "Phòng học / cơ sở vật chất", "An ninh & khóa cửa", "Vệ sinh", "Học vụ", "Khác"];
const roomSuggestions = ["T.101 - Tòa nhà A", "P.101", "P.102", "P.201", "P.301", "Phòng thực hành", "Phòng thí nghiệm"];
const quickIssues = [
  { title: "Máy lạnh rò rỉ nước", category: "Thiết bị phòng học", description: "Máy lạnh bị rò rỉ nước. Vui lòng kiểm tra và hỗ trợ sửa chữa." },
  { title: "Vòi nước / vòi sen hư", category: "Hệ thống nước", description: "Vòi nước bị hỏng hoặc rò rỉ. Vui lòng kiểm tra và sửa chữa." },
  { title: "Sự cố điện chập", category: "Hệ thống điện", description: "Phát hiện sự cố điện, có dấu hiệu chập hoặc mất điện. Vui lòng kiểm tra sớm." },
  { title: "Khóa cửa / quẹt thẻ lỗi", category: "An ninh & khóa cửa", description: "Khóa cửa hoặc đầu đọc thẻ hoạt động không ổn định. Vui lòng kiểm tra." },
];

export default function SupportTicketForm({ staff, onSaved, onClose }: { staff: boolean; onSaved: (message: string) => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Hệ thống điện");
  const [priority, setPriority] = useState<SupportTicketPriority>("normal");
  const [room, setRoom] = useState("");
  const [studentCode, setStudentCode] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<SupportTicketStudent | null>(null);
  const [studentSuggestions, setStudentSuggestions] = useState<SupportTicketStudent[]>([]);
  const [searchingStudents, setSearchingStudents] = useState(false);
  const [studentSearchError, setStudentSearchError] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const deviceInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!staff || studentCode.trim().length < 2 || selectedStudent) { setStudentSuggestions([]); setSearchingStudents(false); return; }
    let active = true;
    setSearchingStudents(true); setStudentSearchError("");
    const timer = window.setTimeout(() => {
      void supportTicketService.searchStudents(studentCode).then((results) => {
        if (active) setStudentSuggestions(results);
      }).catch((cause) => {
        if (active) { setStudentSuggestions([]); setStudentSearchError(cause instanceof Error ? cause.message : "Không thể tìm mã sinh viên."); }
      }).finally(() => { if (active) setSearchingStudents(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [staff, studentCode, selectedStudent]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saving]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (staff && (!selectedStudent || selectedStudent.student_code.toLocaleLowerCase("vi-VN") !== studentCode.trim().toLocaleLowerCase("vi-VN"))) {
      setError("Hãy chọn mã sinh viên trong danh sách gợi ý. Chỉ sinh viên có hồ sơ trong hệ thống mới tạo được phiếu.");
      return;
    }
    setSaving(true); setError("");
    try {
      const result = await supportTicketService.create({
        title, description, category, priority,
        studentCode: staff ? selectedStudent!.student_code : undefined,
        studentRecordId: staff ? selectedStudent!.student_record_id : undefined,
        room: room.trim(), image,
      });
      onSaved(result.attachmentSaved ? "Phiếu hỗ trợ đã được gửi." : "Phiếu đã được tạo nhưng ảnh đính kèm chưa tải lên được.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể gửi phiếu hỗ trợ.");
    } finally { setSaving(false); }
  }

  function chooseIssue(issue: typeof quickIssues[number]) {
    setTitle(issue.title); setCategory(issue.category); setDescription(issue.description); setError("");
  }

  return <div className="support-form-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="support-request-modal" role="dialog" aria-modal="true" aria-labelledby="support-form-title">
      <header className="support-request-modal-head"><h2 id="support-form-title">Tạo phiếu yêu cầu hỗ trợ &amp; sửa chữa</h2><button type="button" aria-label="Đóng biểu mẫu" onClick={onClose} disabled={saving}><X size={20} /></button></header>
      <form className="support-request-form" onSubmit={submit}>
        {error && <div className="workspace-alert" role="alert">{error}</div>}
        <div className="support-form-grid">
          <label className="support-form-wide">Tiêu đề sự cố / yêu cầu *<input autoFocus name="title" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={180} placeholder="Ví dụ: Máy lạnh chảy nước, vòi nước hư, chập cầu dao…" /></label>
          {staff && <label className="support-form-student-field">Mã sinh viên *<input autoComplete="off" name="studentCode" value={studentCode} required maxLength={40} placeholder="Nhập mã sinh viên" aria-autocomplete="list" aria-expanded={studentSuggestions.length > 0} onChange={(event) => { setStudentCode(event.target.value); setSelectedStudent(null); setStudentSearchError(""); }} />
            {studentCode.trim().length >= 2 && !selectedStudent && <div className="support-student-suggestions" role="listbox" aria-label="Sinh viên phù hợp">{searchingStudents ? <span className="support-student-suggestion-message">Đang tìm sinh viên…</span> : studentSuggestions.length ? studentSuggestions.map((student) => <button type="button" role="option" aria-selected="false" key={`${student.student_code}-${student.student_name}`} onMouseDown={(event) => event.preventDefault()} onClick={() => { setStudentCode(student.student_code); setSelectedStudent(student); setStudentSuggestions([]); }}><strong>{student.student_code}</strong><span>{student.student_name}</span>{student.class_name && <small>{student.class_name}</small>}</button>) : <span className="support-student-suggestion-message">{studentSearchError || "Không tìm thấy hồ sơ sinh viên đang hoạt động."}</span>}</div>}
            {selectedStudent && <small className="support-selected-student"><strong>{selectedStudent.student_code}</strong> · {selectedStudent.student_name}{selectedStudent.class_name ? ` · ${selectedStudent.class_name}` : ""}</small>}
          </label>}
          <label className={staff ? "" : "support-form-wide"}>Số phòng *<input list="support-ticket-room-suggestions" name="room" required value={room} onChange={(event) => setRoom(event.target.value)} maxLength={120} placeholder="Chọn hoặc nhập số phòng" /><datalist id="support-ticket-room-suggestions">{roomSuggestions.map((value) => <option key={value} value={value} />)}</datalist></label>
          <label className={staff ? "" : "support-form-wide"}>Danh mục sự cố *<select name="category" value={category} onChange={(event) => setCategory(event.target.value)} required>{categoryOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
          <fieldset className="support-form-priority support-form-wide"><legend>Mức độ ưu tiên (mặc định là Trung bình) *</legend><div>{priorityOptions.map((option) => <label key={option.value} className={priority === option.value ? "is-selected" : ""}><input type="radio" name="priority" value={option.value} checked={priority === option.value} onChange={() => setPriority(option.value)} /><span>{option.label}{option.value === "normal" && priority === option.value ? <Star size={13} fill="currentColor" /> : null}</span></label>)}</div></fieldset>
          <label className="support-form-wide">Mô tả chi tiết sự cố *<textarea name="description" value={description} onChange={(event) => setDescription(event.target.value)} required rows={4} maxLength={4000} placeholder="Mô tả cụ thể hiện tượng, vị trí và thời điểm phát hiện sự cố…" /></label>
          <div className="support-form-wide support-image-picker"><strong>Chụp ảnh hoặc chọn ảnh minh họa hiện trường</strong><div className="support-image-picker-actions"><button type="button" onClick={() => cameraInput.current?.click()}><Camera size={17} />Chụp ảnh ngay</button><button type="button" onClick={() => deviceInput.current?.click()}><ImagePlus size={17} />Chọn ảnh từ thiết bị</button><input ref={cameraInput} type="file" accept="image/*" capture="environment" onChange={(event) => setImage(event.target.files?.[0] ?? null)} /><input ref={deviceInput} type="file" accept="image/*" onChange={(event) => setImage(event.target.files?.[0] ?? null)} /></div>{image && <div className="support-picked-image"><span>{image.name}</span><button type="button" onClick={() => { setImage(null); if (cameraInput.current) cameraInput.current.value = ""; if (deviceInput.current) deviceInput.current.value = ""; }}>Bỏ ảnh</button></div>}</div>
          <div className="support-form-wide support-issue-presets"><span>Hoặc chọn nhanh sự cố mẫu:</span><div>{quickIssues.map((issue) => <button type="button" key={issue.title} onClick={() => chooseIssue(issue)}>{issue.title}</button>)}</div></div>
        </div>
        <footer className="support-form-actions"><button type="button" className="support-form-cancel" onClick={onClose} disabled={saving}>Hủy</button><button className="workspace-primary" disabled={saving}><Send size={15} />{saving ? "Đang gửi…" : "Gửi phiếu hỗ trợ"}</button></footer>
      </form>
    </section>
  </div>;
}
