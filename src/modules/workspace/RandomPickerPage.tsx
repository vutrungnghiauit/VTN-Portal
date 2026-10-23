import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ArrowDownAZ, BriefcaseBusiness, ChevronLeft, ChevronRight, CircleHelp, Copy, Download, Expand, Eye, Handshake, History, Lightbulb, MessageCircleQuestion, Minimize, RotateCcw, Scale, Search, Shuffle, Sparkles, Timer, Trash2, UsersRound, Volume2 } from "lucide-react";
import { studentService } from "../students/student.service";
import type { Student } from "../students/student.types";
import { formatDateTime } from "../../lib/date-format";
import { supabase } from "../../lib/supabase";
import { randomPickerService, type RandomHistory, type RandomQuestionTopic } from "./random-picker.service";
import RandomQuestionManager from "./RandomQuestionManager";
import { academicPeriodMatchesYear, academicYearFromSemester, groupAcademicPeriods, normalizeAcademicYear, normalizeSemesterName, semesterMatchesSelection, uniqueAcademicYears } from "../../lib/semester-groups";
import QuickFilterHeading from "./QuickFilterHeading";
import SearchableFilter from "../../components/SearchableFilter";
import "./workspace.css";

type Tool = "roll-call" | "groups" | "presentation" | "questions" | "pairs" | "cases" | "challenge" | "debate" | "keywords" | "true-false" | "roles";
type Draw = { name: string; code?: string; id?: string };
type InteractionResult = { title: string; body: string; answer?: string };
function normalizeFilterText(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase().trim(); }
function studentSourceData(notes: string) {
  try {
    const parsed = JSON.parse(notes) as { source?: string; details?: Record<string, string>; sourceData?: Record<string, string> };
    if (!["imported-class-rosters", "manual-student-entry"].includes(parsed.source ?? "")) return { details: {}, sourceData: {} };
    return { details: parsed.details ?? {}, sourceData: parsed.sourceData ?? {} };
  } catch { return { details: {}, sourceData: {} }; }
}
function studentField(student: Student, detailKey: string, ...sourceKeys: string[]) {
  const source = studentSourceData(student.notes);
  const wanted = new Set(sourceKeys.map(normalizeFilterText));
  const sourceValue = Object.entries(source.sourceData).find(([key]) => wanted.has(normalizeFilterText(key)))?.[1] ?? "";
  return source.details[detailKey] || sourceValue || "";
}
function studentCourseClassCode(student: Student) {
  return studentField(student, "courseClassCode", "courseClassCode", "Mã lớp học phần", "Mã LHP", "ma lhp");
}
type RandomStudentFilters = { academicYear: string; semester: string; major: string; courseClassCode: string; course: string; className: string };
type RandomStudentFilterKey = keyof RandomStudentFilters;
function matchesRandomStudentFilters(student: Student, filters: RandomStudentFilters, periods: Array<{ academicYear: string; semesterName: string }>) {
  const semester = studentField(student, "", "sourceTerm", "Đợt", "semester") || student.semesterName;
  const academicYear = studentField(student, "", "sourceAcademicYear", "Năm học", "academicYear");
  const className = studentField(student, "", "courseClassName") || studentField(student, "", "sourceClass", "Lớp học") || student.className;
  const major = studentField(student, "academicMajor", "sourceFaculty", "Ngành") || student.faculty;
  const courseClassCode = studentCourseClassCode(student);
  const course = studentField(student, "courseName", "courseName", "subjectName", "Tên học phần", "Tên môn học", "ten hoc phan", "ten mon hoc");
  return (filters.academicYear === "all" || academicPeriodMatchesYear(semester, academicYear, filters.academicYear, periods))
    && (filters.semester === "all" || semesterMatchesSelection(semester, academicYear, filters.semester))
    && (filters.major === "all" || normalizeFilterText(major) === normalizeFilterText(filters.major))
    && (filters.courseClassCode === "all" || normalizeFilterText(courseClassCode) === normalizeFilterText(filters.courseClassCode))
    && (filters.course === "all" || normalizeFilterText(course) === normalizeFilterText(filters.course))
    && (filters.className === "all" || normalizeFilterText(className) === normalizeFilterText(filters.className));
}
const tools: Array<{ id: Tool; label: string; description: string }> = [
  { id: "roll-call", label: "Quay số gọi tên", description: "Chọn ngẫu nhiên sinh viên, ghi nhận điểm danh và tránh gọi trùng trong ngày." },
  { id: "groups", label: "Chia nhóm tự động", description: "Nhập số nhóm và giới hạn thành viên, sau đó chia ngẫu nhiên cân bằng." },
  { id: "presentation", label: "Thứ tự thuyết trình", description: "Bốc thăm thứ tự trình bày ngẫu nhiên cho cả lớp." },
  { id: "questions", label: "Câu hỏi vấn đáp", description: "Rút thăm câu hỏi chuyên môn Kinh tế số và Quản trị kinh doanh." },
  { id: "pairs", label: "Cặp đôi cùng tiến", description: "Ghép ngẫu nhiên sinh viên thành từng cặp học tập." },
  { id: "cases", label: "Thảo luận tình huống", description: "Rút một tình huống thực tế để cả lớp phân tích và đề xuất giải pháp." },
  { id: "challenge", label: "Thử thách 60 giây", description: "Bốc một nhiệm vụ ngắn và cùng giải quyết trong 60 giây." },
  { id: "debate", label: "Tranh biện nhanh", description: "Rút một nhận định và bốc ngẫu nhiên lập trường cần bảo vệ." },
  { id: "keywords", label: "Bốc thăm từ khóa", description: "Rút một khái niệm để giải thích bằng lời của mình và nêu ví dụ thực tế." },
  { id: "true-false", label: "Đúng hay sai", description: "Cả lớp bình chọn cho một nhận định rồi cùng xem đáp án và giải thích." },
  { id: "roles", label: "Phân vai ngẫu nhiên", description: "Xáo trộn sinh viên và giao vai trò thảo luận cho từng người." },
];
const historyDrawTypeByTool: Record<Tool, string> = {
  "roll-call": "roll_call",
  groups: "groups",
  presentation: "presentation_order",
  questions: "oral_question",
  pairs: "study_pairs",
  cases: "case_study",
  challenge: "speed_challenge",
  debate: "quick_debate",
  keywords: "keyword_draw",
  "true-false": "true_false",
  roles: "role_assignment",
};
const interactionDecks: Record<"cases" | "challenge" | "debate", Array<{ title: string; body: string }>> = {
  cases: [
    { title: "Khách hàng rời bỏ nền tảng", body: "Một ứng dụng giao đồ ăn tăng phí dịch vụ và lượng khách quay lại giảm mạnh. Hãy xác định hai nguyên nhân có thể xảy ra, đề xuất một giải pháp trong tháng tới và chọn chỉ số để đánh giá." },
    { title: "Sự cố lộ dữ liệu", body: "Một cửa hàng trực tuyến phát hiện thông tin liên hệ của khách hàng bị chia sẻ nhầm. Hãy nêu ba việc cần làm ngay, cách thông báo với khách hàng và một biện pháp ngăn sự cố lặp lại." },
    { title: "Ra mắt sản phẩm với ngân sách nhỏ", body: "Một nhóm khởi nghiệp chỉ có ngân sách marketing hạn chế nhưng cần tìm 100 khách hàng đầu tiên. Hãy chọn nhóm khách hàng mục tiêu, một kênh tiếp cận và cách kiểm tra hiệu quả." },
    { title: "Nhóm dự án trễ tiến độ", body: "Dự án còn hai tuần nhưng một hạng mục quan trọng đang chậm và các thành viên chưa thống nhất ưu tiên. Hãy đề xuất cách chia lại công việc và một nguyên tắc phối hợp để hoàn thành đúng hạn." },
    { title: "Đánh giá một chương trình khuyến mãi", body: "Doanh số tăng trong thời gian giảm giá nhưng lợi nhuận giảm và khách hàng ít quay lại sau đó. Hãy nêu dữ liệu cần xem và đề xuất cách điều chỉnh chương trình." },
  ],
  challenge: [
    { title: "Một câu giới thiệu", body: "Trong 60 giây, hãy giới thiệu một ý tưởng kinh doanh bằng đúng một câu nêu rõ khách hàng, nhu cầu và giá trị mang lại." },
    { title: "Ba cách kiểm chứng", body: "Trong 60 giây, hãy nêu ba cách ít tốn chi phí để kiểm chứng xem khách hàng có thật sự cần một sản phẩm mới hay không." },
    { title: "Chỉ số trọng tâm", body: "Trong 60 giây, hãy chọn một chỉ số quan trọng nhất để đánh giá một nền tảng học trực tuyến và giải thích ngắn gọn lý do." },
    { title: "Lập luận bằng dữ liệu", body: "Trong 60 giây, hãy đưa ra một lập luận có dữ liệu cần thu thập để thuyết phục nhóm thử nghiệm một thay đổi nhỏ trong sản phẩm." },
    { title: "Tái sử dụng nguồn lực", body: "Trong 60 giây, hãy nêu một cách biến nguồn lực sẵn có của doanh nghiệp thành giá trị mới cho khách hàng." },
  ],
  debate: [
    { title: "Làm việc từ xa", body: "Doanh nghiệp nên cho nhân viên làm việc từ xa phần lớn thời gian. Lập trường được bốc: " },
    { title: "Trí tuệ nhân tạo trong học tập", body: "Sinh viên nên được dùng công cụ trí tuệ nhân tạo trong mọi bài tập nếu có trích dẫn. Lập trường được bốc: " },
    { title: "Giảm giá để tăng trưởng", body: "Giảm giá thường xuyên là cách tốt nhất để một doanh nghiệp mới tăng trưởng nhanh. Lập trường được bốc: " },
    { title: "Dữ liệu cá nhân", body: "Khách hàng nên nhận được ưu đãi khi đồng ý chia sẻ dữ liệu cá nhân cho doanh nghiệp. Lập trường được bốc: " },
    { title: "Họp nhóm", body: "Các nhóm dự án nên thay phần lớn cuộc họp bằng cập nhật tiến độ bằng văn bản. Lập trường được bốc: " },
  ],
};
const keywordDeck: Array<{ title: string; body: string }> = [
  { title: "Chi phí cơ hội", body: "Giải thích khái niệm bằng lời của bạn và nêu một ví dụ trong quyết định kinh doanh." },
  { title: "Lợi thế cạnh tranh", body: "Nêu một nguồn tạo lợi thế cạnh tranh và cách doanh nghiệp duy trì lợi thế đó." },
  { title: "Phân khúc khách hàng", body: "Mô tả một cách phân khúc khách hàng và đưa ra ví dụ phù hợp." },
  { title: "Hiệu ứng mạng lưới", body: "Giải thích vì sao một nền tảng có thể có giá trị hơn khi có thêm người dùng." },
  { title: "Dòng tiền", body: "Phân biệt dòng tiền với lợi nhuận và nêu một lý do doanh nghiệp cần theo dõi cả hai." },
  { title: "Giá trị vòng đời khách hàng", body: "Giải thích cách doanh nghiệp có thể tăng giá trị vòng đời của khách hàng." },
  { title: "Chuỗi cung ứng", body: "Nêu một rủi ro trong chuỗi cung ứng và cách giảm thiểu rủi ro đó." },
  { title: "Chuyển đổi số", body: "Phân biệt chuyển đổi số với việc chỉ đưa quy trình giấy lên phần mềm." },
];
const trueFalseDeck: Array<{ title: string; body: string; answer: string }> = [
  { title: "Doanh thu tăng luôn đồng nghĩa lợi nhuận tăng.", body: "Cả lớp bình chọn Đúng hoặc Sai, sau đó giải thích lựa chọn.", answer: "Sai. Chi phí có thể tăng nhanh hơn doanh thu nên lợi nhuận vẫn giảm." },
  { title: "Giá bán thấp hơn đối thủ luôn tạo lợi thế cạnh tranh bền vững.", body: "Cả lớp bình chọn Đúng hoặc Sai, sau đó giải thích lựa chọn.", answer: "Sai. Doanh nghiệp còn cần khác biệt hóa, chất lượng, dịch vụ hoặc lợi thế chi phí lâu dài." },
  { title: "Tỷ lệ chuyển đổi có thể tính bằng số người thực hiện hành động chia cho số người được tiếp cận.", body: "Cả lớp bình chọn Đúng hoặc Sai, sau đó giải thích lựa chọn.", answer: "Đúng. Cần xác định rõ hành động mục tiêu và cùng một khoảng thời gian đo lường." },
  { title: "Khảo sát khách hàng là cách duy nhất để kiểm chứng một ý tưởng kinh doanh.", body: "Cả lớp bình chọn Đúng hoặc Sai, sau đó giải thích lựa chọn.", answer: "Sai. Có thể kiểm chứng bằng phỏng vấn, thử nghiệm nguyên mẫu, dữ liệu hành vi hoặc bán thử." },
  { title: "Lãi suất tăng có thể làm chi phí vay vốn của doanh nghiệp tăng.", body: "Cả lớp bình chọn Đúng hoặc Sai, sau đó giải thích lựa chọn.", answer: "Đúng. Khoản vay lãi suất thả nổi hoặc khoản vay mới thường chịu tác động trực tiếp." },
  { title: "Thông tin cá nhân đã xuất hiện công khai thì doanh nghiệp có thể tùy ý sử dụng.", body: "Cả lớp bình chọn Đúng hoặc Sai, sau đó giải thích lựa chọn.", answer: "Sai. Việc sử dụng vẫn cần có mục đích và căn cứ phù hợp, đồng thời phải tôn trọng quyền riêng tư." },
];
const discussionRoles = ["Điều phối viên", "Người phân tích", "Người phản biện", "Thư ký", "Báo cáo viên", "Quản lý thời gian"];
const wheelColors = ["#d71935", "#3473df", "#079c3b", "#f2bd12"];
const questionBank: Record<string, string[]> = {
  "Kinh tế số": ["Phân tích tác động của nền tảng số đến chi phí giao dịch và cấu trúc thị trường.", "Hiệu ứng mạng lưới là gì? Nêu ví dụ trong một nền tảng tại Việt Nam.", "Dữ liệu trở thành tài sản kinh tế như thế nào và cần quản trị ra sao?", "So sánh mô hình kinh doanh nền tảng với mô hình kinh doanh truyền thống.", "Phân tích cơ hội và rủi ro của trí tuệ nhân tạo đối với năng suất lao động.", "Thương mại điện tử xuyên biên giới tạo ra những thách thức nào cho doanh nghiệp nhỏ?", "Giải thích khái niệm kinh tế chia sẻ và đánh giá một ví dụ thực tế.", "Doanh nghiệp cần những năng lực số nào để chuyển đổi số thành công?", "Phân tích vai trò của thanh toán số trong tài chính toàn diện.", "Quyền riêng tư dữ liệu ảnh hưởng thế nào đến niềm tin và tăng trưởng nền tảng?"],
  "Quản trị kinh doanh": ["Phân tích cách doanh nghiệp xây dựng lợi thế cạnh tranh bền vững.", "So sánh lãnh đạo chuyển đổi và lãnh đạo giao dịch; khi nào nên áp dụng?", "Trình bày các bước xây dựng kế hoạch marketing cho sản phẩm mới.", "Phân tích cách quản trị rủi ro trong quyết định mở rộng thị trường.", "Văn hóa tổ chức tác động thế nào đến hiệu quả đổi mới sáng tạo?", "Đề xuất chỉ số KPI phù hợp để đánh giá hiệu quả một nhóm dự án.", "Phân biệt chiến lược cấp công ty và chiến lược cấp đơn vị kinh doanh.", "Doanh nghiệp nên xử lý xung đột lợi ích giữa tăng trưởng và trách nhiệm xã hội thế nào?", "Phân tích vai trò của trải nghiệm khách hàng trong giữ chân khách hàng.", "Một doanh nghiệp nhỏ có ngân sách hạn chế nên ưu tiên nguồn lực theo nguyên tắc nào?"]
};

function FullscreenToggle({ fullscreen, onToggle }: { fullscreen: boolean; onToggle: () => void }) {
  return <button type="button" className="random-fullscreen-toggle" onClick={onToggle} aria-label={fullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"} title={fullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"}>{fullscreen ? <Minimize size={17} /> : <Expand size={17} />}<span>{fullscreen ? "Thu nhỏ" : "Toàn màn hình"}</span></button>;
}

function RandomInteractionCard({ tool, question, result, challengeSeconds, busy, canCreate, canExport, fullscreen, onToggleFullscreen, onRun, onStartTimer, onCopy, onExport }: {
  tool: Tool;
  question: string;
  result: InteractionResult | null;
  challengeSeconds: number;
  busy: boolean;
  canCreate: boolean;
  canExport: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onRun: () => void;
  onStartTimer: () => void;
  onCopy: () => void;
  onExport: () => void;
}) {
  const [answerVisible, setAnswerVisible] = useState(false);
  useEffect(() => { setAnswerVisible(false); }, [tool, result?.title, result?.body]);
  const isQuestion = tool === "questions";
  const title = isQuestion ? "Câu hỏi vấn đáp" : result?.title;
  const body = isQuestion ? question || "Chọn chủ đề rồi bấm nút để rút câu hỏi vấn đáp." : result?.body || tools.find((item) => item.id === tool)?.description;
  const Icon = tool === "questions" ? MessageCircleQuestion : tool === "cases" ? BriefcaseBusiness : tool === "challenge" ? Timer : tool === "keywords" ? Lightbulb : tool === "true-false" ? CircleHelp : Scale;
  const action = tool === "questions" ? "Bốc câu hỏi" : tool === "cases" ? "Rút tình huống" : tool === "challenge" ? "Bốc thử thách" : tool === "keywords" ? "Rút từ khóa" : tool === "true-false" ? "Bốc nhận định" : "Rút chủ đề tranh biện";

  return <div className="random-question-card random-interaction-card">
    <Icon size={28} />
    <span>{isQuestion ? question ? "CÂU HỎI ĐƯỢC BỐC" : "NGÂN HÀNG CÂU HỎI" : tools.find((item) => item.id === tool)?.label.toLocaleUpperCase("vi")}</span>
    {title && <strong className="random-interaction-title">{title}</strong>}
    <p>{body}</p>
    {tool === "true-false" && result?.answer && <><button className="random-secondary-action" type="button" onClick={() => setAnswerVisible((visible) => !visible)}>{answerVisible ? "Ẩn đáp án" : "Hiện đáp án"}</button>{answerVisible && <p className="random-interaction-answer"><strong>Đáp án:</strong> {result.answer}</p>}</>}
    <div className="random-run-actions"><button className="workspace-primary" type="button" onClick={onRun} disabled={busy || !canCreate}><Shuffle size={16} /> {busy ? "Đang chọn..." : action}</button><FullscreenToggle fullscreen={fullscreen} onToggle={onToggleFullscreen} /></div>
    {tool === "challenge" && result && <button className="random-secondary-action random-challenge-timer" type="button" onClick={onStartTimer} disabled={challengeSeconds > 0}>{challengeSeconds > 0 ? `Còn ${challengeSeconds} giây` : "Bắt đầu 60 giây"}</button>}
    {result && canExport && <div className="random-result-actions"><button type="button" onClick={onCopy}><Copy size={15} /> Sao chép</button><button type="button" onClick={onExport}><Download size={15} /> Tải CSV</button></div>}
    {isQuestion && question && canExport && <button className="random-secondary-action" type="button" onClick={onCopy}><Copy size={15} /> Sao chép câu hỏi</button>}
  </div>;
}

function shuffle<T>(items: T[]) { const result = [...items]; for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; } return result; }
function vietnamDateKey() { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date()); }
function formatVietnamDrawTime(value: string) { return new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(value)); }
function playWheelSound() {
  try {
    const Ctx = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const context = new Ctx(); const start = context.currentTime;
    for (let i = 0; i < 22; i++) { const at = start + i * (0.035 + i * 0.006); const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.type = "triangle"; oscillator.frequency.setValueAtTime(i === 21 ? 880 : 280 + (i % 3) * 80, at); gain.gain.setValueAtTime(0.001, at); gain.gain.exponentialRampToValueAtTime(i === 21 ? 0.15 : 0.04, at + 0.006); gain.gain.exponentialRampToValueAtTime(0.001, at + 0.045); oscillator.connect(gain); gain.connect(context.destination); oscillator.start(at); oscillator.stop(at + 0.05); }
    window.setTimeout(() => void context.close(), 2200);
  } catch { /* Sound can be blocked by browser preferences. */ }
}

function WheelSegments({ entries }: { entries: Array<{ name: string; code?: string }> }) {
  const count = Math.max(entries.length, 1);
  const slice = 360 / count;
  const point = (angle: number, radius: number) => {
    const radians = (angle - 90) * Math.PI / 180;
    return { x: 200 + radius * Math.cos(radians), y: 200 + radius * Math.sin(radians) };
  };
  return <svg className="random-wheel-art" viewBox="0 0 400 400" aria-hidden="true">
    {entries.map((entry, index) => {
      const start = point(index * slice, 198); const end = point((index + 1) * slice, 198);
      const mid = index * slice + slice / 2; const label = point(mid, 139); const radialRotation = mid - 90; const textRotation = radialRotation > 90 && radialRotation < 270 ? radialRotation + 180 : radialRotation;
      const largeArc = slice > 180 ? 1 : 0;
      const color = wheelColors[index % wheelColors.length];
      const studentLabel = `${entry.code ? `${entry.code} ` : ""}${entry.name}`;
      const maxChars = count <= 24 ? 28 : count <= 60 ? 22 : count <= 100 ? 16 : count <= 240 ? 9 : 5;
      const fontSize = count <= 24 ? 11 : count <= 60 ? 8 : count <= 100 ? 6 : count <= 240 ? 4 : 2.5;
      return <g key={`${index}-${entry.name}`}>
        <path d={`M 200 200 L ${start.x} ${start.y} A 198 198 0 ${largeArc} 1 ${end.x} ${end.y} Z`} fill={color} stroke="#fff" strokeWidth="1.5" />
        {!!entries.length && <text x={label.x} y={label.y} transform={`rotate(${textRotation}, ${label.x}, ${label.y})`} textAnchor="middle" dominantBaseline="middle" className={`random-wheel-label${index % 4 === 0 || index % 4 === 1 ? " is-light" : ""}`} style={{ fontSize }}>{studentLabel.length > maxChars ? `${studentLabel.slice(0, maxChars - 1)}…` : studentLabel}</text>}
      </g>;
    })}
  </svg>;
}

export default function RandomPickerPage({ canCreate, canUpdate = false, canDelete = false, canExport = false, questionPermissions = { create: false, update: false, delete: false } }: { canCreate: boolean; canUpdate?: boolean; canDelete?: boolean; canExport?: boolean; questionPermissions?: { read?: boolean; create: boolean; update: boolean; delete: boolean } }) {
  const [students, setStudents] = useState<Student[]>([]); const [history, setHistory] = useState<RandomHistory[]>([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true); const [historyTotal, setHistoryTotal] = useState(0); const [historyPage, setHistoryPage] = useState(1); const [historyPageSize, setHistoryPageSize] = useState<"10" | "20" | "50" | "100" | "all">("10"); const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(() => new Set()); const [historyDetail, setHistoryDetail] = useState<RandomHistory | null>(null); const [historyNoteDraft, setHistoryNoteDraft] = useState(""); const [editingHistoryNote, setEditingHistoryNote] = useState(false); const [savingHistoryNote, setSavingHistoryNote] = useState(false);
  const [tool, setTool] = useState<Tool>("roll-call"); const [manualNames, setManualNames] = useState(""); const [groupCount, setGroupCount] = useState(4); const [maxMembersPerGroup, setMaxMembersPerGroup] = useState(30); const [useManualRoster, setUseManualRoster] = useState(false);
  const historyDrawType = historyDrawTypeByTool[tool];
  const [search, setSearch] = useState("");
  const [semesterFilter, setSemesterFilter] = useState(() => { const saved = localStorage.getItem("vtn-active-semester") || "all"; return saved === "all" ? saved : normalizeSemesterName(saved); });
  const [academicYearFilter, setAcademicYearFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all"); const [majorFilter, setMajorFilter] = useState("all");
  const [courseClassCodeFilter, setCourseClassCodeFilter] = useState("all");
  const [courseFilter, setCourseFilter] = useState("all");
  const [draws, setDraws] = useState<Draw[]>([]); const [question, setQuestion] = useState(""); const [questionTopic, setQuestionTopic] = useState("Kinh tế số"); const [questionTopics, setQuestionTopics] = useState<RandomQuestionTopic[]>([]); const [questionBankError, setQuestionBankError] = useState(""); const [showQuestionManager, setShowQuestionManager] = useState(false); const [interactionResult, setInteractionResult] = useState<InteractionResult | null>(null); const [challengeSeconds, setChallengeSeconds] = useState(0);
  const [wheelDegrees, setWheelDegrees] = useState(0); const [spinning, setSpinning] = useState(false); const [celebrate, setCelebrate] = useState(false); const [callHistory, setCallHistory] = useState<RandomHistory[]>([]);
  const [wheelPanel, setWheelPanel] = useState<"items" | "results">("items"); const [wheelSidebarCollapsed, setWheelSidebarCollapsed] = useState(false); const [fullscreen, setFullscreen] = useState(false); const [wheelOrder, setWheelOrder] = useState<Draw[]>([]); const [winnerPopup, setWinnerPopup] = useState<{ student: Draw; color: string } | null>(null); const [selectedRollResultIds, setSelectedRollResultIds] = useState<Set<string>>(() => new Set()); const [restoringRollResults, setRestoringRollResults] = useState(false);
  const interactionViewRef = useRef<HTMLDivElement>(null);
  const wheelRef = useRef<HTMLDivElement>(null); const wheelPointerRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const challengeTimer = useRef<number | undefined>(undefined);
  const historyRequestId = useRef(0);
  const questionBankRequestId = useRef(0);
  const reload = useCallback(async () => {
    setLoading(true); setError("");
    try { setStudents(await studentService.list()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được dữ liệu Random."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); return () => { if (timer.current) window.clearTimeout(timer.current); if (challengeTimer.current) window.clearInterval(challengeTimer.current); }; }, [reload]);
  const reloadHistory = useCallback(async () => {
    const requestId = ++historyRequestId.current;
    setHistoryLoading(true);
    try {
      const result = historyPageSize === "all" ? await randomPickerService.allHistory(historyDrawType) : await randomPickerService.history((historyPage - 1) * Number(historyPageSize), Number(historyPageSize), historyDrawType);
      if (requestId !== historyRequestId.current) return;
      const lastPage = historyPageSize === "all" ? 1 : Math.max(1, Math.ceil(result.total / Number(historyPageSize)));
      setHistoryTotal(result.total);
      if (historyPage > lastPage) { setHistoryPage(lastPage); return; }
      setHistory(result.items);
    } catch (cause) { if (requestId === historyRequestId.current) setError(cause instanceof Error ? cause.message : "Không tải được lịch sử Random."); }
    finally { if (requestId === historyRequestId.current) setHistoryLoading(false); }
  }, [historyDrawType, historyPage, historyPageSize]);
  useEffect(() => { void reloadHistory(); }, [reloadHistory]);
  const bankActivityType = ["questions", "cases", "challenge", "debate", "keywords", "true-false", "roles"].includes(tool) ? historyDrawType : "";
  const reloadQuestionBank = useCallback(async () => {
    if (!bankActivityType) return;
    const requestId = ++questionBankRequestId.current;
    setQuestionBankError("");
    try {
      const topics = await randomPickerService.questionBank(bankActivityType);
      if (requestId === questionBankRequestId.current) setQuestionTopics(topics);
    } catch (cause) { if (requestId === questionBankRequestId.current) setQuestionBankError(cause instanceof Error ? cause.message : "Không tải được ngân hàng câu hỏi."); }
  }, [bankActivityType]);
  useEffect(() => {
    if (!bankActivityType) { questionBankRequestId.current += 1; return; }
    setQuestionTopics([]);
    void reloadQuestionBank();
  }, [bankActivityType, reloadQuestionBank]);
  useEffect(() => {
    if (questionTopics.length && !questionTopics.some((topic) => topic.name === questionTopic)) setQuestionTopic(questionTopics[0].name);
  }, [questionTopics, questionTopic]);
  const studentAcademicPeriods = useMemo(() => students.map((student) => {
    const semesterName = studentField(student, "", "sourceTerm", "semester") || student.semesterName;
    return { academicYear: studentField(student, "", "sourceAcademicYear", "academicYear") || academicYearFromSemester(semesterName), semesterName };
  }).filter((period) => period.semesterName), [students]);
  const activeFilters: RandomStudentFilters = { academicYear: academicYearFilter, semester: semesterFilter, major: majorFilter, courseClassCode: courseClassCodeFilter, course: courseFilter, className: classFilter };
  const filterOptions = useMemo(() => {
    const selectedFilters: RandomStudentFilters = { academicYear: academicYearFilter, semester: semesterFilter, major: majorFilter, courseClassCode: courseClassCodeFilter, course: courseFilter, className: classFilter };
    const candidatesFor = (excluded: RandomStudentFilterKey) => students.filter((student) => matchesRandomStudentFilters(student, { ...selectedFilters, [excluded]: "all" }, studentAcademicPeriods));
    const distinct = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi", { numeric: true, sensitivity: "base" }));
    const semesterCandidates = candidatesFor("semester").map((student) => {
      const semesterName = studentField(student, "", "sourceTerm", "Đợt", "semester") || student.semesterName;
      return { academicYear: studentField(student, "", "sourceAcademicYear", "Năm học", "academicYear") || academicYearFromSemester(semesterName), semesterName };
    }).filter((period) => period.semesterName);
    return {
      academicYears: uniqueAcademicYears(candidatesFor("academicYear").map((student) => {
        const term = studentField(student, "", "sourceTerm", "Đợt", "semester") || student.semesterName;
        return studentField(student, "", "sourceAcademicYear", "Năm học", "academicYear") || academicYearFromSemester(term);
      })),
      semesterGroups: groupAcademicPeriods(semesterCandidates),
      courseClassCodes: distinct(candidatesFor("courseClassCode").map(studentCourseClassCode)),
      classes: distinct(candidatesFor("className").map((student) => studentField(student, "", "courseClassName") || studentField(student, "", "sourceClass", "Lớp học") || student.className)),
      majors: distinct(candidatesFor("major").map((student) => studentField(student, "academicMajor", "sourceFaculty", "Ngành") || student.faculty)),
      courses: distinct(candidatesFor("course").map((student) => studentField(student, "courseName", "courseName", "subjectName", "Tên học phần", "Tên môn học", "ten hoc phan", "ten mon hoc"))),
    };
  }, [students, studentAcademicPeriods, academicYearFilter, semesterFilter, majorFilter, courseClassCodeFilter, courseFilter, classFilter]);
  const visibleSemesterGroups = academicYearFilter === "all" ? filterOptions.semesterGroups : filterOptions.semesterGroups.filter((group) => normalizeAcademicYear(group.academicYear) === normalizeAcademicYear(academicYearFilter));
  const academicYearOptions = filterOptions.academicYears;
  const filteredStudents = useMemo(() => {
    const keyword = normalizeFilterText(search);
    return students.filter((student) => {
      const imported = studentSourceData(student.notes);
      const searchable = normalizeFilterText([student.studentCode, student.fullName, student.phone, student.email, student.className, student.faculty, student.semesterName, student.academicStatus, ...Object.values(imported.details), ...Object.values(imported.sourceData)].join(" "));
      const term = studentField(student, "", "sourceTerm", "Đợt", "semester") || student.semesterName;
      const year = studentField(student, "", "sourceAcademicYear", "Năm học", "academicYear");
      const className = studentField(student, "", "courseClassName") || studentField(student, "", "sourceClass", "Lớp học") || student.className;
      const major = studentField(student, "academicMajor", "sourceFaculty", "Ngành") || student.faculty;
      const courseClassCode = studentCourseClassCode(student);
      const courseName = studentField(student, "courseName", "courseName", "subjectName", "Tên học phần", "Tên môn học", "ten hoc phan", "ten mon hoc");
      return (!keyword || searchable.includes(keyword))
        && (semesterFilter === "all" || semesterMatchesSelection(term, year, semesterFilter))
        && (academicYearFilter === "all" || academicPeriodMatchesYear(term, year, academicYearFilter, studentAcademicPeriods))
        && (majorFilter === "all" || major === majorFilter)
        && (courseClassCodeFilter === "all" || normalizeFilterText(courseClassCode) === normalizeFilterText(courseClassCodeFilter))
        && (courseFilter === "all" || courseName === courseFilter)
        && (classFilter === "all" || className === classFilter);
    });
  }, [students, search, semesterFilter, academicYearFilter, majorFilter, courseClassCodeFilter, courseFilter, classFilter, studentAcademicPeriods]);
  const roster = useMemo(() => filteredStudents.map((item) => ({ id: item.id, code: item.studentCode, name: item.fullName })), [filteredStudents]);
  const manualRoster = useMemo<Array<{ id?: string; code?: string; name: string }>>(() => manualNames.split(/\r?\n/).map((name) => name.trim()).filter(Boolean).map((name) => ({ name })), [manualNames]);
  const participants = useManualRoster ? manualRoster : students.length ? roster : manualRoster;
  useEffect(() => { setWheelOrder(participants); }, [participants]);
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === interactionViewRef.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  useEffect(() => {
    let frame = 0;
    const updatePointerColor = () => {
      const wheel = wheelRef.current;
      const pointer = wheelPointerRef.current;
      if (!wheel || !pointer) return;
      const matrix = new DOMMatrixReadOnly(getComputedStyle(wheel).transform);
      const angle = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
      const sector = 360 / Math.max(1, wheelOrder.length);
      const pointedAt = Math.floor((((90 - angle) % 360 + 360) % 360) / sector);
      pointer.style.setProperty("--pointer-color", wheelColors[pointedAt % wheelColors.length]);
      if (spinning) frame = window.requestAnimationFrame(updatePointerColor);
    };
    updatePointerColor();
    return () => { if (frame) window.cancelAnimationFrame(frame); };
  }, [spinning, wheelDegrees, wheelOrder.length]);
  useEffect(() => {
    if (!winnerPopup) return;
    const dismissOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setWinnerPopup(null); };
    window.addEventListener("keydown", dismissOnEscape);
    return () => window.removeEventListener("keydown", dismissOnEscape);
  }, [winnerPopup]);
  const filteredCallHistory = useMemo(() => {
    const currentIds = new Set(participants.map((item) => item.id).filter((id): id is string => Boolean(id)));
    const currentKeys = new Set(participants.map((item) => `${item.code ?? ""}:${item.name}`));
    return callHistory.filter((item) => item.draw_type === "roll_call" && item.drawn_on === vietnamDateKey()
      && (item.student_id ? currentIds.has(item.student_id) : currentKeys.has(`${item.student_code ?? ""}:${item.student_name ?? ""}`)));
  }, [callHistory, participants]);
  const todayDrawn = useMemo(() => new Set(filteredCallHistory.map((item) => item.student_id ?? `${item.student_code ?? ""}:${item.student_name ?? ""}`)), [filteredCallHistory]);
  const remaining = useMemo(() => participants.filter((item) => !todayDrawn.has(item.id ?? `${item.code ?? ""}:${item.name}`)), [participants, todayDrawn]);
  const currentRollHistory = draws[0]?.id ? callHistory.find((item) => item.student_id === draws[0].id) : undefined;

  useEffect(() => {
    if (tool !== "roll-call" || !supabase) return;
    let active = true;
    void randomPickerService.history(0, 500).then(({ items }) => { if (active) setCallHistory(items); }).catch(() => undefined);
    return () => { active = false; };
  }, [tool, history.length]);

  useEffect(() => { setDraws([]); setQuestion(""); setWheelDegrees(0); }, [search, semesterFilter, academicYearFilter, majorFilter, courseClassCodeFilter, courseFilter, classFilter]);

  function clearStudentFilters() {
    setSearch(""); setSemesterFilter("all"); setAcademicYearFilter("all"); setClassFilter("all"); setMajorFilter("all"); setCourseClassCodeFilter("all"); setCourseFilter("all");
    localStorage.setItem("vtn-active-semester", "all");
    window.dispatchEvent(new CustomEvent("vtn-semester-filter-changed", { detail: "all" }));
  }

  function changeStudentFilter(key: RandomStudentFilterKey, value: string) {
    const normalizedValue = key === "semester" && value !== "all" ? normalizeSemesterName(value) : value;
    const nextFilters: RandomStudentFilters = { ...activeFilters, [key]: normalizedValue };
    const order: RandomStudentFilterKey[] = ["academicYear", "semester", "major", "courseClassCode", "course", "className"];
    const changedIndex = order.indexOf(key);
    for (const dependent of order.slice(changedIndex + 1)) {
      if (nextFilters[dependent] === "all") continue;
      const dependentIndex = order.indexOf(dependent);
      const prefixFilters = { ...nextFilters };
      for (const later of order.slice(dependentIndex + 1)) prefixFilters[later] = "all";
      if (!students.some((student) => matchesRandomStudentFilters(student, prefixFilters, studentAcademicPeriods))) nextFilters[dependent] = "all";
    }

    setAcademicYearFilter(nextFilters.academicYear);
    setSemesterFilter(nextFilters.semester);
    setMajorFilter(nextFilters.major);
    setCourseClassCodeFilter(nextFilters.courseClassCode);
    setCourseFilter(nextFilters.course);
    setClassFilter(nextFilters.className);
    if (nextFilters.semester !== semesterFilter) {
      localStorage.setItem("vtn-active-semester", nextFilters.semester);
      window.dispatchEvent(new CustomEvent("vtn-semester-filter-changed", { detail: nextFilters.semester }));
    }
  }

  const record = useCallback(async (drawType: string, result: Draw[], metadata: Record<string, unknown> = {}) => {
    if (!canCreate) return;
    try {
      if (drawType === "roll_call") {
        const person = result[0];
        const saved = await randomPickerService.save({ draw_type: drawType, student_id: person.id ?? null, student_code: person.code ?? null, student_name: person.name, class_name: classFilter === "all" ? null : classFilter, results: metadata });
        setHistory((items) => [saved, ...items].slice(0, historyPageSize === "all" ? Number.MAX_SAFE_INTEGER : Number(historyPageSize))); setHistoryTotal((total) => total + 1); setHistoryPage(1); setCallHistory((items) => [saved, ...items]);
      } else {
        const saved = await randomPickerService.save({ draw_type: drawType, class_name: classFilter === "all" ? null : classFilter, student_name: result.length === 1 ? result[0].name : null, results: { ...metadata, entries: result } });
        setHistory((items) => [saved, ...items].slice(0, historyPageSize === "all" ? Number.MAX_SAFE_INTEGER : Number(historyPageSize))); setHistoryTotal((total) => total + 1); setHistoryPage(1);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể lưu lịch sử bốc thăm."); }
  }, [canCreate, classFilter, historyPageSize]);

  function startRollCall() {
    if (!canCreate) { setError("Tài khoản chưa có quyền ghi lịch sử Random. Hãy nhờ quản trị viên cấp quyền."); return; }
    if (!participants.length) { setError("Không có sinh viên phù hợp với bộ lọc. Hãy điều chỉnh bộ lọc hoặc nhập danh sách thủ công."); return; }
    setError(""); setNotice("");
    if (remaining.length === 0) { setNotice("Danh sách đã được gọi hết trong ngày; các lượt đã chọn sẽ không bị gọi trùng."); return; }
    const pool = remaining.length ? remaining : participants; const winner = pool[Math.floor(Math.random() * pool.length)];
    const index = wheelOrder.findIndex((item) => item.id === winner.id && item.code === winner.code && item.name === winner.name); const sector = 360 / Math.max(1, wheelOrder.length);
    const currentRotation = ((wheelDegrees % 360) + 360) % 360;
    const targetRotation = 90 - (index + 0.5) * sector;
    const rotationDelta = ((targetRotation - currentRotation) % 360 + 360) % 360;
    setSpinning(true); setCelebrate(false); setDraws([]); setWheelDegrees((value) => value + 1800 + rotationDelta); playWheelSound();
    timer.current = window.setTimeout(() => { setSpinning(false); setDraws([winner]); setWinnerPopup({ student: winner, color: wheelColors[index % wheelColors.length] }); setCelebrate(true); void record("roll_call", [winner], { source: useManualRoster || !students.length ? "manual" : "students" }); window.setTimeout(() => setCelebrate(false), 2500); }, 4200);
  }

  async function toggleFullscreen() {
    if (!interactionViewRef.current) return;
    try {
      if (document.fullscreenElement === interactionViewRef.current) await document.exitFullscreen();
      else await interactionViewRef.current.requestFullscreen();
    } catch { setNotice("Trình duyệt chưa cho phép mở chế độ toàn màn hình."); }
  }

  function reorderWheel(mode: "shuffle" | "sort") {
    setWheelOrder((items) => mode === "shuffle" ? shuffle(items) : [...items].sort((a, b) => a.name.localeCompare(b.name, "vi")));
  }

  async function setAttendance(item: RandomHistory, status: "present" | "absent") {
    if (!canUpdate) return;
    try { await randomPickerService.setAttendance(item.id, status); const update = (rows: RandomHistory[]) => rows.map((row) => row.id === item.id ? { ...row, attendance_status: status } : row); setHistory(update); setCallHistory(update); setHistoryDetail((current) => current?.id === item.id ? { ...current, attendance_status: status } : current); setNotice(`Đã ghi nhận ${item.student_name}: ${status === "present" ? "có mặt" : "vắng mặt"}.`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không cập nhật được điểm danh."); }
  }

  const historyPageCount = historyPageSize === "all" ? 1 : Math.max(1, Math.ceil(historyTotal / Number(historyPageSize)));
  const historyRangeStart = historyTotal ? (historyPageSize === "all" ? 1 : (historyPage - 1) * Number(historyPageSize) + 1) : 0;
  const historyRangeEnd = historyTotal ? (historyPageSize === "all" ? history.length : Math.min(historyPage * Number(historyPageSize), historyTotal)) : 0;
  const allVisibleHistorySelected = history.length > 0 && history.every((item) => selectedHistoryIds.has(item.id));

  function toggleVisibleHistory(checked: boolean) {
    setSelectedHistoryIds((previous) => {
      const next = new Set(previous);
      history.forEach((item) => checked ? next.add(item.id) : next.delete(item.id));
      return next;
    });
  }

  async function deleteSelectedHistory() {
    if (!canDelete || !selectedHistoryIds.size) return;
    const ids = [...selectedHistoryIds];
    if (!window.confirm(`Chuyển ${ids.length.toLocaleString("vi-VN")} dòng lịch sử vào thùng rác?`)) return;
    try {
      await randomPickerService.deleteHistory(ids);
      setSelectedHistoryIds(new Set());
      setHistoryTotal((total) => Math.max(0, total - ids.length));
      setNotice(`Đã chuyển ${ids.length.toLocaleString("vi-VN")} dòng lịch sử vào thùng rác.`);
      await reloadHistory();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không xóa được lịch sử đã chọn."); }
  }

  async function restoreRollResults(ids: string[]) {
    const uniqueIds = [...new Set(ids)].filter((id) => filteredCallHistory.some((item) => item.id === id));
    if (!canDelete || !uniqueIds.length || restoringRollResults) return;
    setRestoringRollResults(true);
    setError("");
    try {
      await randomPickerService.deleteHistory(uniqueIds);
      setCallHistory((items) => items.filter((item) => !uniqueIds.includes(item.id)));
      setSelectedRollResultIds((items) => { const next = new Set(items); uniqueIds.forEach((id) => next.delete(id)); return next; });
      setNotice(`${uniqueIds.length.toLocaleString("vi-VN")} sinh viên đã được trả về danh sách gọi lại.`);
      await reloadHistory();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể khôi phục sinh viên về danh sách gọi lại."); }
    finally { setRestoringRollResults(false); }
  }

  function openHistoryDetail(item: RandomHistory) {
    setHistoryDetail(item);
    setHistoryNoteDraft(String(item.results?.note ?? ""));
    setEditingHistoryNote(false);
  }

  async function saveHistoryNote() {
    if (!canUpdate || !historyDetail) return;
    setSavingHistoryNote(true);
    const updated = { ...historyDetail, results: { ...historyDetail.results, note: historyNoteDraft.trim() } };
    try {
      await randomPickerService.updateNote(historyDetail.id, updated.results);
      setHistory((rows) => rows.map((row) => row.id === updated.id ? updated : row));
      setHistoryDetail(updated);
      setEditingHistoryNote(false);
      setNotice("Đã cập nhật ghi chú lịch sử.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không cập nhật được ghi chú lịch sử."); }
    finally { setSavingHistoryNote(false); }
  }

  async function runOtherTool() {
    setError(""); setNotice(""); setDraws([]); setBusy(true);
    if (tool === "questions") {
      const bank = questionTopics.find((topic) => topic.name === questionTopic)?.questions.map((item) => item.question) ?? questionBank[questionTopic] ?? [];
      if (!bank.length) { setBusy(false); setError(questionBankError || "Chủ đề này chưa có câu hỏi."); return; }
      const selectedQuestion = bank[Math.floor(Math.random() * bank.length)]; setQuestion(selectedQuestion); await record("oral_question", [{ name: selectedQuestion }], { topic: questionTopic, question: selectedQuestion }); setBusy(false); return;
    }
    if (tool === "keywords") {
      const selectedTopic = questionTopics.find((topic) => topic.name === questionTopic);
      const deck = selectedTopic ? selectedTopic.questions.map((item) => ({ title: item.title || item.question.slice(0, 100), body: item.question })) : questionBankError ? keywordDeck : [];
      if (!deck.length) { setBusy(false); setError(questionBankError || "Chủ đề hiện tại chưa có từ khóa."); return; }
      const card = deck[Math.floor(Math.random() * deck.length)];
      setInteractionResult(card); setQuestion("");
      await record("keyword_draw", [{ name: card.title }], { topic: selectedTopic?.name ?? null, title: card.title, prompt: card.body });
      setBusy(false); return;
    }
    if (tool === "true-false") {
      const selectedTopic = questionTopics.find((topic) => topic.name === questionTopic);
      const deck = selectedTopic ? selectedTopic.questions.map((item) => ({ title: item.title || item.question.slice(0, 100), body: "Cả lớp bình chọn Đúng hoặc Sai, sau đó giải thích lựa chọn.", answer: item.question })) : questionBankError ? trueFalseDeck : [];
      if (!deck.length) { setBusy(false); setError(questionBankError || "Chủ đề hiện tại chưa có nhận định."); return; }
      const item = deck[Math.floor(Math.random() * deck.length)];
      const card = item;
      setInteractionResult(card); setQuestion("");
      await record("true_false", [{ name: card.title }], { topic: selectedTopic?.name ?? null, title: card.title, prompt: card.body, answer: card.answer });
      setBusy(false); return;
    }
    if (tool === "cases" || tool === "challenge" || tool === "debate") {
      const selectedTopic = questionTopics.find((topic) => topic.name === questionTopic);
      const deck = selectedTopic
        ? selectedTopic.questions.map((item) => ({ title: item.title || item.question.slice(0, 100), body: item.question }))
        : interactionDecks[tool];
      if (!deck.length) { setBusy(false); setError(questionBankError || "Chủ đề hiện tại chưa có câu hỏi."); return; }
      const card = deck[Math.floor(Math.random() * deck.length)];
      const body = tool === "debate" ? `${card.body}${Math.random() < 0.5 ? "Đồng tình." : "Phản đối."}` : card.body;
      const result = { title: card.title, body };
      setInteractionResult(result);
      setQuestion("");
      setChallengeSeconds(0);
      if (challengeTimer.current) window.clearInterval(challengeTimer.current);
      const drawType = tool === "cases" ? "case_study" : tool === "challenge" ? "speed_challenge" : "quick_debate";
      await record(drawType, [{ name: card.title }], { topic: selectedTopic?.name ?? null, title: card.title, prompt: body, ...(tool === "challenge" ? { timerSeconds: 60 } : {}) });
      setBusy(false);
      return;
    }
    const list = shuffle(participants);
    if (!list.length) { setBusy(false); setError("Chưa có sinh viên để bốc thăm. Hãy chọn lớp hoặc nhập danh sách."); return; }
    if (tool === "groups") {
      if (!Number.isInteger(groupCount) || groupCount < 2) { setBusy(false); setError("Số nhóm phải là số nguyên từ 2 trở lên."); return; }
      if (!Number.isInteger(maxMembersPerGroup) || maxMembersPerGroup < 1) { setBusy(false); setError("Số thành viên tối đa mỗi nhóm phải là số nguyên từ 1 trở lên."); return; }
      if (groupCount > list.length) { setBusy(false); setError(`Có ${list.length} sinh viên, không thể chia thành ${groupCount} nhóm có thành viên.`); return; }
      const capacity = groupCount * maxMembersPerGroup;
      if (list.length > capacity) { setBusy(false); setError(`${list.length} sinh viên vượt sức chứa ${capacity}. Hãy tăng số nhóm hoặc số thành viên tối đa mỗi nhóm.`); return; }
      const buckets = Array.from({ length: groupCount }, (_, index) => ({ group: index + 1, members: [] as Draw[] }));
      list.forEach((person, index) => buckets[index % groupCount].members.push(person));
      const flat = buckets.flatMap((bucket) => bucket.members.map((person) => ({ ...person, name: `Nhóm ${bucket.group}: ${person.name}` })));
      setDraws(flat); await record("groups", flat, { groupCount, maxMembersPerGroup, groups: buckets });
    } else if (tool === "presentation") {
      const ordered = list.map((person, index) => ({ ...person, name: `${index + 1}. ${person.name}` })); setDraws(ordered); await record("presentation_order", ordered, { entries: ordered });
    } else if (tool === "pairs") {
      const paired = list.map((person, index) => ({ ...person, name: `${Math.floor(index / 2) + 1}: ${person.name}${index === list.length - 1 && list.length % 2 ? " (chưa có cặp)" : ""}` })); setDraws(paired); await record("study_pairs", paired, { pairs: paired });
    } else if (tool === "roles") {
      const selectedTopic = questionTopics.find((topic) => topic.name === questionTopic);
      const roleItems = selectedTopic?.questions.length ? selectedTopic.questions : questionBankError ? discussionRoles.map((title) => ({ id: title, topic_id: "", title, question: "" })) : [];
      if (!roleItems.length) { setBusy(false); setError(questionBankError || "Chủ đề hiện tại chưa có vai trò."); return; }
      const assigned = list.map((person, index) => {
        const role = roleItems[index % roleItems.length];
        return { ...person, name: `${person.name} — ${role.title || role.question}` };
      });
      setDraws(assigned); await record("role_assignment", assigned, { topic: selectedTopic?.name ?? null, assignments: assigned.map((item) => item.name), roles: roleItems.map((item) => ({ title: item.title, description: item.question })) });
    }
    setBusy(false);
  }

  function startChallengeTimer() {
    if (challengeSeconds > 0 || !interactionResult) return;
    setChallengeSeconds(60);
    if (challengeTimer.current) window.clearInterval(challengeTimer.current);
    challengeTimer.current = window.setInterval(() => {
      setChallengeSeconds((remaining) => {
        if (remaining <= 1) {
          if (challengeTimer.current) window.clearInterval(challengeTimer.current);
          challengeTimer.current = undefined;
          return 0;
        }
        return remaining - 1;
      });
    }, 1000);
  }

  function exportCsv() {
    if (!canExport || (!draws.length && !interactionResult)) return;
    const rows = interactionResult ? [[interactionResult.title, interactionResult.body, ...(interactionResult.answer ? [interactionResult.answer] : [])]] : tool === "groups" ? draws.map((item) => item.name.split(": ")) : draws.map((item) => [item.name, item.code ?? ""]);
    const csv = `\uFEFF${rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n")}`;
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); link.download = `random-${tool}-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
  }
  async function copyResults() { if (!canExport) return; const text = tool === "questions" ? question : interactionResult ? `${interactionResult.title}\n${interactionResult.body}${interactionResult.answer ? `\nĐáp án: ${interactionResult.answer}` : ""}` : draws.map((item) => item.name).join("\n"); try { await navigator.clipboard.writeText(text); setNotice("Đã sao chép kết quả."); } catch { setError("Trình duyệt không cho phép sao chép tự động."); } }

  return <section className="workspace-page random-suite-page">
    <div className="workspace-title-row"><div><div className="workspace-breadcrumb">Học vụ <span>/</span> Random</div><h1>Random tương tác</h1><p>Gọi tên, chia nhóm, xếp thứ tự, rút câu hỏi, thảo luận tình huống, thử thách nhanh và tranh biện.</p></div><span className="random-live-badge"><Sparkles size={14} /> {participants.length.toLocaleString("vi-VN")} sinh viên phù hợp</span></div>
    {error && <div className="workspace-alert" role="alert">{error}</div>}{notice && <div className="workspace-notice" role="status">{notice}</div>}
    <div className={`random-suite-layout${canCreate ? "" : " is-readonly"}`}>{canCreate && <nav className="random-tool-tabs" aria-label="Công cụ bốc thăm">{tools.map((item) => <button type="button" key={item.id} className={tool === item.id ? "active" : ""} onClick={() => { historyRequestId.current += 1; setTool(item.id); setHistoryPage(1); setHistory([]); setHistoryTotal(0); setHistoryLoading(true); setSelectedHistoryIds(new Set()); setHistoryDetail(null); setDraws([]); setQuestion(""); setInteractionResult(null); setChallengeSeconds(0); if (challengeTimer.current) window.clearInterval(challengeTimer.current); setError(""); }}>{item.label}</button>)}</nav>}
      <div className="random-tool-content"><div className="random-tool-heading"><div><span>CÔNG CỤ TƯƠNG TÁC</span><h2>{tools.find((item) => item.id === tool)?.label}</h2><p>{tools.find((item) => item.id === tool)?.description}</p></div><Volume2 size={21} /></div>
        {canCreate ? <><section className="random-student-filters" aria-label="Bộ lọc sinh viên">
  <QuickFilterHeading onClear={clearStudentFilters} clearDisabled={!search && semesterFilter === "all" && academicYearFilter === "all" && majorFilter === "all" && courseClassCodeFilter === "all" && courseFilter === "all" && classFilter === "all"} />
  <label>Năm học<SearchableFilter value={academicYearFilter} disabled={useManualRoster} allValue="all" allLabel="Tất cả năm học" options={[...new Set([...academicYearOptions, ...(academicYearFilter !== "all" ? [academicYearFilter] : [])])].map((item) => ({ value: item, label: item }))} onChange={(value) => changeStudentFilter("academicYear", value)} /></label>
  <label>Học kỳ<SearchableFilter value={semesterFilter} disabled={useManualRoster} allValue="all" allLabel="Tất cả học kỳ" options={[...(semesterFilter !== "all" && !visibleSemesterGroups.some((group) => group.semesters.includes(semesterFilter)) ? [{ value: semesterFilter, label: semesterFilter }] : []), ...visibleSemesterGroups.flatMap((group) => group.semesters.map((item) => ({ value: item, label: item })))]} onChange={(value) => changeStudentFilter("semester", value)} /></label>
  <label>Ngành<SearchableFilter value={majorFilter} disabled={useManualRoster} allValue="all" allLabel="Tất cả ngành" options={filterOptions.majors.map((item) => ({ value: item, label: item }))} onChange={(value) => changeStudentFilter("major", value)} /></label>
  <label>Mã lớp học phần<SearchableFilter value={courseClassCodeFilter} disabled={useManualRoster} allValue="all" allLabel="Tất cả mã lớp học phần" options={filterOptions.courseClassCodes.map((item) => ({ value: item, label: item }))} onChange={(value) => changeStudentFilter("courseClassCode", value)} /></label>
  <label>Tên học phần<SearchableFilter value={courseFilter} disabled={useManualRoster} allValue="all" allLabel="Tất cả học phần" options={filterOptions.courses.map((item) => ({ value: item, label: item }))} onChange={(value) => changeStudentFilter("course", value)} /></label>
  <label>Lớp học<SearchableFilter value={classFilter} disabled={useManualRoster} allValue="all" allLabel="Tất cả lớp" options={filterOptions.classes.map((item) => ({ value: item, label: item }))} onChange={(value) => changeStudentFilter("className", value)} /></label>
  <div className="random-student-search"><Search size={16} /><input aria-label="Tìm sinh viên" placeholder="Tìm MSSV, họ tên, mã lớp học phần, tên học phần, lớp…" value={search} onChange={(event) => setSearch(event.target.value)} disabled={useManualRoster} /></div>
  <span className="random-filter-count">{useManualRoster ? manualRoster.length + " tên tự nhập" : filteredStudents.length.toLocaleString("vi-VN") + " / " + students.length.toLocaleString("vi-VN") + " sinh viên"}</span>
</section>
<div className="random-controls">
  {tool === "groups" && <><label>Số nhóm<input type="number" min={2} step={1} value={groupCount} onChange={(event) => { setGroupCount(Number(event.target.value)); setDraws([]); }} /></label><label>Thành viên tối đa mỗi nhóm<input type="number" min={1} step={1} value={maxMembersPerGroup} onChange={(event) => { setMaxMembersPerGroup(Number(event.target.value)); setDraws([]); }} /></label></>}
  {bankActivityType && <label>Chủ đề<select value={questionTopic} onChange={(event) => setQuestionTopic(event.target.value)} disabled={!questionTopics.length}>{questionTopics.map((topic) => <option key={topic.id} value={topic.name}>{topic.name}</option>)}</select></label>}
  {bankActivityType && (questionPermissions.read === true || questionPermissions.create || questionPermissions.update || questionPermissions.delete) && <button type="button" onClick={() => setShowQuestionManager(true)}>Quản lý câu hỏi và chủ đề</button>}
</div>
        <label className="random-manual-toggle"><input type="checkbox" checked={useManualRoster} onChange={(event) => setUseManualRoster(event.target.checked)} /> Dùng danh sách tự nhập thay cho danh sách từ hệ thống</label>
        <label className="random-manual-roster">Danh sách thêm (mỗi tên một dòng, dùng khi không chọn được lớp)<textarea rows={3} value={manualNames} onChange={(event) => setManualNames(event.target.value)} placeholder="Nguyễn Văn A&#10;Trần Thị B" /></label>
        <div ref={interactionViewRef} className="random-interaction-view">
        {tool === "roll-call" ? <div className={`random-wheel-workspace${wheelSidebarCollapsed ? " is-sidebar-collapsed" : ""}`}>
          <div className="random-roll-stage"><div className="random-wheel-container"><div ref={wheelPointerRef} className="random-wheel-pointer" aria-hidden="true" /><div ref={wheelRef} className="random-wheel" style={{ transform: `rotate(${wheelDegrees}deg)` }}><WheelSegments entries={wheelOrder} /><span className="random-wheel-hub" aria-hidden="true" /></div></div><div className="random-roll-caption">{draws[0] ? <><small>SINH VIÊN ĐƯỢC CHỌN</small><strong>{draws[0].name}</strong><span>{draws[0].code ?? ""}</span></> : <p>{remaining.length} lượt chưa gọi trong ngày</p>}</div><div className="random-run-actions"><button type="button" className="workspace-primary" disabled={spinning || loading || !canCreate} onClick={startRollCall}><Shuffle size={17} /> {spinning ? "Đang quay..." : "Quay gọi tên"}</button><FullscreenToggle fullscreen={fullscreen} onToggle={() => void toggleFullscreen()} /></div>{draws[0]?.id && canUpdate && <div className="random-attendance-actions"><button type="button" disabled={!currentRollHistory} onClick={() => { if (currentRollHistory) void setAttendance(currentRollHistory, "present"); }}>Có mặt</button><button type="button" disabled={!currentRollHistory} onClick={() => { if (currentRollHistory) void setAttendance(currentRollHistory, "absent"); }}>Vắng mặt</button></div>}</div>
          <aside className={`random-wheel-sidebar${canDelete ? " can-restore" : ""}`}><button type="button" className="random-wheel-panel-toggle" onClick={() => setWheelSidebarCollapsed((collapsed) => !collapsed)} aria-label={wheelSidebarCollapsed ? "Mở rộng danh sách" : "Thu gọn danh sách"} aria-expanded={!wheelSidebarCollapsed} title={wheelSidebarCollapsed ? "Mở rộng danh sách" : "Thu gọn danh sách"}>{wheelSidebarCollapsed ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}</button><div className="random-wheel-tabs"><button type="button" className={wheelPanel === "items" ? "active" : ""} onClick={() => setWheelPanel("items")}>Mục <b>{participants.length}</b></button><button type="button" className={wheelPanel === "results" ? "active" : ""} onClick={() => setWheelPanel("results")}>Kết quả <b>{filteredCallHistory.length}</b></button></div>{wheelPanel === "items" ? <><div className="random-wheel-list-actions"><button type="button" onClick={() => reorderWheel("shuffle")}><Shuffle size={15} /> Xáo trộn</button><button type="button" onClick={() => reorderWheel("sort")}><ArrowDownAZ size={15} /> Sắp xếp</button></div><div className="random-wheel-items">{wheelOrder.map((item, index) => <div key={`${item.id ?? item.code ?? item.name}-${index}`}><span>{index + 1}</span><span>{item.code ? `${item.code} ` : ""}{item.name}</span>{todayDrawn.has(item.id ?? `${item.code ?? ""}:${item.name}`) && <small>Đã gọi</small>}</div>)}{!wheelOrder.length && <p>Hãy chọn lớp hoặc nhập danh sách tên để bắt đầu.</p>}</div><div className="random-wheel-list-footer"><span><UsersRound size={15} /> {participants.length} mục</span><button type="button" onClick={() => setUseManualRoster((value) => !value)}>{useManualRoster ? "Dùng danh sách sinh viên" : "Nhập danh sách"}</button></div></> : <><div className="random-wheel-result-actions"><label><input type="checkbox" aria-label="Chọn tất cả sinh viên trong kết quả bộ lọc này" checked={filteredCallHistory.length > 0 && filteredCallHistory.every((item) => selectedRollResultIds.has(item.id))} onChange={(event) => setSelectedRollResultIds((previous) => { const next = new Set(previous); filteredCallHistory.forEach((item) => event.target.checked ? next.add(item.id) : next.delete(item.id)); return next; })} /> Chọn tất cả</label>{canDelete && <button type="button" disabled={!filteredCallHistory.some((item) => selectedRollResultIds.has(item.id)) || restoringRollResults} onClick={() => void restoreRollResults(filteredCallHistory.filter((item) => selectedRollResultIds.has(item.id)).map((item) => item.id))}><RotateCcw size={14} />{restoringRollResults ? "Đang khôi phục..." : `Khôi phục đã chọn (${filteredCallHistory.filter((item) => selectedRollResultIds.has(item.id)).length})`}</button>}</div><div className="random-wheel-results">{filteredCallHistory.map((item, index) => <div className={canDelete ? "has-restore" : ""} key={item.id}>{canDelete && <input type="checkbox" aria-label={`Chọn ${item.student_name} để gọi lại`} checked={selectedRollResultIds.has(item.id)} onChange={(event) => setSelectedRollResultIds((previous) => { const next = new Set(previous); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} />}<b>{index + 1}</b><span><strong>{item.student_name}</strong><small>{formatVietnamDrawTime(item.created_at)}</small></span>{canDelete && <button type="button" aria-label={`Khôi phục ${item.student_name} để gọi lại`} title="Khôi phục để gọi lại" disabled={restoringRollResults} onClick={() => void restoreRollResults([item.id])}><RotateCcw size={14} /></button>}</div>)}{!filteredCallHistory.length && <p>Chưa có sinh viên được gọi trong bộ lọc hiện tại hôm nay.</p>}</div></>}</aside>
        </div> : (tool === "questions" || tool === "cases" || tool === "challenge" || tool === "debate" || tool === "keywords" || tool === "true-false") ? <RandomInteractionCard tool={tool} question={question} result={interactionResult} challengeSeconds={challengeSeconds} busy={busy} canCreate={canCreate} canExport={canExport} fullscreen={fullscreen} onToggleFullscreen={() => void toggleFullscreen()} onRun={() => void runOtherTool()} onStartTimer={startChallengeTimer} onCopy={() => void copyResults()} onExport={exportCsv} /> : <div className="random-result-panel">{draws.length ? <div className={tool === "groups" ? "random-groups-grid" : "random-draw-list"}>{tool === "groups" ? Array.from({ length: groupCount }, (_, index) => <article key={index}><h3>Nhóm {index + 1}</h3><ol>{draws.filter((item) => item.name.startsWith(`Nhóm ${index + 1}: `)).map((item) => <li key={`${index}-${item.id ?? item.name}`}>{item.name.replace(`Nhóm ${index + 1}: `, "")}</li>)}</ol></article>) : draws.map((item, index) => <div key={`${index}-${item.id ?? item.name}`}><span>{tool === "roles" ? "Vai" : tool === "presentation" ? `#${index + 1}` : `${Math.floor(index / 2) + 1}`}</span>{item.name.replace(/^\d+\. /, "").replace(/^\d+: /, "")}</div>)}</div> : <div className="random-result-placeholder"><Shuffle size={25} /><strong>Kết quả sẽ xuất hiện tại đây</strong><span>{participants.length} người trong danh sách hiện tại</span></div>}{draws.length > 0 && canExport && <div className="random-result-actions"><button type="button" onClick={() => void copyResults()}><Copy size={15} /> Sao chép</button><button type="button" onClick={exportCsv}><Download size={15} /> Tải CSV</button></div>}<div className="random-run-actions"><button className="workspace-primary" type="button" onClick={() => void runOtherTool()} disabled={busy || loading || !canCreate}><Shuffle size={16} /> {busy ? "Đang xáo trộn..." : tool === "groups" ? "Chia nhóm" : tool === "pairs" ? "Ghép cặp" : tool === "roles" ? "Phân vai ngẫu nhiên" : "Bốc thứ tự"}</button><FullscreenToggle fullscreen={fullscreen} onToggle={() => void toggleFullscreen()} /></div></div>}</div></> : <div className="random-readonly-message">Bạn chưa được cấp quyền tạo kết quả Random.</div>}
      </div>
    </div>

    <section className="workspace-panel random-history-panel">
      <div className="random-history-heading"><div><History size={18} /><h2>Lịch sử: {tools.find((item) => item.id === tool)?.label}</h2></div><span>{historyTotal.toLocaleString("vi-VN")} lượt</span></div>
      {canDelete && <div className="random-history-selection">
        <label><input type="checkbox" aria-label="Chọn tất cả lịch sử trên trang" checked={allVisibleHistorySelected} onChange={(event) => toggleVisibleHistory(event.target.checked)} /> Chọn tất cả {history.length.toLocaleString("vi-VN")} dòng trên trang</label>
        <span>Đã chọn {selectedHistoryIds.size.toLocaleString("vi-VN")} / {historyTotal.toLocaleString("vi-VN")} dòng</span>
        <button type="button" className="random-history-delete" disabled={!selectedHistoryIds.size} onClick={() => void deleteSelectedHistory()}><Trash2 size={15} /> Xóa đã chọn</button>
        <button type="button" disabled={!selectedHistoryIds.size} onClick={() => setSelectedHistoryIds(new Set())}>Bỏ chọn</button>
      </div>}
      {historyLoading ? <div className="workspace-loading">Đang tải lịch sử...</div> : <div className="random-history-list">{history.map((item) => <article key={item.id}>
        {canDelete && <input type="checkbox" aria-label={`Chọn lịch sử ${item.student_name ?? item.draw_type}`} checked={selectedHistoryIds.has(item.id)} onChange={(event) => setSelectedHistoryIds((previous) => { const next = new Set(previous); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} />}
        <span className="random-history-mark">{item.draw_type === "roll_call" ? <UsersRound size={15} /> : item.draw_type === "study_pairs" ? <Handshake size={15} /> : <Shuffle size={15} />}</span>
        <div><strong>{item.student_name ?? String(item.results?.topic ?? item.draw_type.replaceAll("_", " "))}</strong><small>{item.student_code ? `${item.student_code} · ` : ""}{item.class_name ?? "Danh sách thủ công"} · {formatDateTime(item.created_at)}</small></div>
        <button type="button" className="random-history-view" aria-label="Xem chi tiết lịch sử" title="Xem chi tiết" onClick={() => openHistoryDetail(item)}><Eye size={15} /></button>
        {item.draw_type === "roll_call" && canUpdate ? <div className="random-history-attendance"><button type="button" className={item.attendance_status === "present" ? "selected" : ""} onClick={() => void setAttendance(item, "present")}>Có mặt</button><button type="button" className={item.attendance_status === "absent" ? "selected absent" : ""} onClick={() => void setAttendance(item, "absent")}>Vắng</button></div> : <span className="random-history-type">{item.draw_type.replaceAll("_", " ")}</span>}
      </article>)}{!history.length && <div className="random-history-empty">Chưa có lịch sử. Kết quả sẽ được lưu ở đây.</div>}</div>}
      {!historyLoading && <div className="random-history-pagination">
        <label>Số dòng<select aria-label="Số dòng lịch sử mỗi trang" value={historyPageSize} onChange={(event) => { setHistoryPageSize(event.target.value as typeof historyPageSize); setHistoryPage(1); }}><option value="10">10</option><option value="20">20</option><option value="50">50</option><option value="100">100</option><option value="all">Tất cả</option></select></label>
        <span>Đang xem {historyRangeStart.toLocaleString("vi-VN")}–{historyRangeEnd.toLocaleString("vi-VN")} / {historyTotal.toLocaleString("vi-VN")} lượt</span>
        <div><button type="button" aria-label="Trang trước" disabled={historyPage <= 1 || historyPageSize === "all"} onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}><ChevronLeft size={16} /></button><span>Trang {historyPage} / {historyPageCount}</span><button type="button" aria-label="Trang sau" disabled={historyPage >= historyPageCount || historyPageSize === "all"} onClick={() => setHistoryPage((page) => Math.min(historyPageCount, page + 1))}><ChevronRight size={16} /></button></div>
      </div>}
    </section>
    {historyDetail && <div className="random-history-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setHistoryDetail(null); }}><section className="random-history-modal" role="dialog" aria-modal="true" aria-labelledby="random-history-modal-title"><header><div><Eye size={18} /><h2 id="random-history-modal-title">Chi tiết lịch sử</h2></div><button type="button" aria-label="Đóng" onClick={() => setHistoryDetail(null)}>×</button></header><p><strong>{historyDetail.student_name ?? String(historyDetail.results?.topic ?? historyDetail.draw_type.replaceAll("_", " "))}</strong></p><p>{historyDetail.student_code ? `${historyDetail.student_code} · ` : ""}{historyDetail.class_name ?? "Danh sách thủ công"} · {formatDateTime(historyDetail.created_at)}</p><pre>{JSON.stringify(historyDetail.results, null, 2)}</pre>{canUpdate && <div className="random-history-note-editor">{editingHistoryNote ? <><label>Ghi chú<textarea rows={3} value={historyNoteDraft} onChange={(event) => setHistoryNoteDraft(event.target.value)} /></label><button type="button" disabled={savingHistoryNote} onClick={() => void saveHistoryNote()}>{savingHistoryNote ? "Đang lưu..." : "Lưu ghi chú"}</button><button type="button" disabled={savingHistoryNote} onClick={() => { setEditingHistoryNote(false); setHistoryNoteDraft(String(historyDetail.results?.note ?? "")); }}>Hủy</button></> : <><p>{historyDetail.results?.note ? <>Ghi chú: {String(historyDetail.results.note)}</> : "Chưa có ghi chú."}</p><button type="button" onClick={() => setEditingHistoryNote(true)}>Sửa ghi chú</button></>}</div>}{historyDetail.draw_type === "roll_call" && canUpdate && <footer><button type="button" className={historyDetail.attendance_status === "present" ? "selected" : ""} onClick={() => void setAttendance(historyDetail, "present")}>Có mặt</button><button type="button" className={historyDetail.attendance_status === "absent" ? "selected absent" : ""} onClick={() => void setAttendance(historyDetail, "absent")}>Vắng</button></footer>}</section></div>}
        {showQuestionManager && <RandomQuestionManager topics={questionTopics} permissions={questionPermissions} activityType={historyDrawType} activityLabel={tools.find((item) => item.id === tool)?.label ?? "Random"} loadError={questionBankError} onClose={() => setShowQuestionManager(false)} onChanged={reloadQuestionBank} />}
    {winnerPopup && createPortal(<div className="random-winner-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setWinnerPopup(null); }}><section className="random-winner-modal" role="dialog" aria-modal="true" aria-labelledby="random-winner-title"><header style={{ backgroundColor: winnerPopup.color }}><h2 id="random-winner-title">Sinh viên được chọn</h2><button type="button" aria-label="Đóng" onClick={() => setWinnerPopup(null)}>×</button></header><div className="random-winner-details"><span>{winnerPopup.student.code ?? "Sinh viên"}</span><strong>{winnerPopup.student.name}</strong></div><footer><button type="button" onClick={() => setWinnerPopup(null)}>Đóng</button></footer></section></div>, interactionViewRef.current ?? document.body)}
    {celebrate && <div className="random-fireworks" aria-hidden="true">{Array.from({ length: 26 }, (_, index) => <i key={index} style={{ "--x": `${(index * 37) % 100}%`, "--y": `${(index * 53) % 75}%`, "--h": `${(index * 29) % 360}deg`, "--delay": `${(index % 8) * 45}ms` } as CSSProperties} />)}</div>}
  </section>;
}
