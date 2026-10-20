export type FieldKind = "text" | "textarea" | "date" | "datetime-local" | "number" | "email" | "url" | "select";
export type ModuleField = { key: string; label: string; kind?: FieldKind; required?: boolean; options?: string[]; hidden?: boolean };
export type ModuleDefinition = { key: string; path: string; title: string; description: string; group: string; fields: ModuleField[]; readOnly?: boolean; system?: boolean };

const status = ["Mới", "Đang thực hiện", "Hoàn thành", "Tạm dừng"];
const priority = ["Thấp", "Bình thường", "Cao", "Khẩn cấp"];
const date = (key = "date", label = "Ngày") => ({ key, label, kind: "date" as const });
const dueDate = date("dueDate", "Hạn / ngày diễn ra");
const statusField = { key: "status", label: "Trạng thái", kind: "select" as const, options: status };
const priorityField = { key: "priority", label: "Mức độ ưu tiên", kind: "select" as const, options: priority };
const notes = { key: "notes", label: "Ghi chú", kind: "textarea" as const };
const title = { key: "title", label: "Tên / tiêu đề", required: true };

export const moduleDefinitions: ModuleDefinition[] = [
  { key: "dashboard", path: "/", title: "Tổng quan", description: "Tổng hợp nhanh hoạt động giảng dạy.", group: "Chung", fields: [], system: true },
  { key: "source-data", path: "/source-data", title: "Dữ liệu nguồn", description: "Tải tệp theo năm học, học kỳ và tự động trích xuất đến các phân hệ.", group: "Quản trị", fields: [], system: true },
  { key: "academic-years", path: "/academic-years", title: "Năm học", description: "Quản lý năm học và thời gian áp dụng.", group: "Đào tạo", fields: [title, date("startDate", "Ngày bắt đầu"), date("endDate", "Ngày kết thúc"), statusField, notes] },
  { key: "semesters", path: "/semesters", title: "Quản lý học kỳ", description: "Quản lý niên khóa, học kỳ hiện hành, thời gian và số tuần học.", group: "Đào tạo", fields: [title, { key: "academicYear", label: "Niên khóa", required: true }, date("startDate", "Ngày bắt đầu"), date("endDate", "Ngày kết thúc"), { key: "weeks", label: "Số tuần học", kind: "number" }, { key: "current", label: "Học kỳ hiện hành", kind: "select", options: ["Không", "Có"] }, notes] },
  { key: "timetables", path: "/timetables", title: "Thời khóa biểu", description: "Thời khóa biểu theo học kỳ, lưu lịch học, sĩ số, phòng và giảng viên.", group: "Đào tạo", fields: [], system: true },
  { key: "student-records", path: "/student-records", title: "Hồ sơ sinh viên", description: "Tra cứu thông tin lý lịch và trạng thái học vụ.", group: "Học vụ", fields: [], system: true },
  { key: "groups", path: "/groups", title: "Nhóm học tập", description: "Diễn đàn sinh viên thảo luận và trò chuyện theo chủ đề.", group: "Học vụ", fields: [title, { key: "className", label: "Lớp" }, { key: "leader", label: "Nhóm trưởng" }, { key: "members", label: "Thành viên" }, notes] },
  { key: "teaching-plans", path: "/teaching-plans", title: "Tiến độ đào tạo", description: "Tiến độ đào tạo theo lịch năm học và học kỳ của NTTU.", group: "Đào tạo", fields: [], system: true },
  { key: "calendar", path: "/calendar", title: "Lịch giảng dạy", description: "Lịch học phần theo tiến độ đào tạo, có thể lọc theo học kỳ.", group: "Đào tạo", fields: [
    { key: "ordinal", label: "STT", kind: "number" },
    { key: "courseCode", label: "Mã lớp học phần", required: true },
    { key: "className", label: "Lớp" },
    { key: "title", label: "Tên môn học", required: true },
    { key: "classSize", label: "Sĩ số", kind: "number" },
    { key: "weekday", label: "Thứ" },
    { key: "fromPeriod", label: "Từ tiết", kind: "number" },
    { key: "toPeriod", label: "Đến tiết", kind: "number" },
    { key: "lessonPattern", label: "Tiết học", hidden: true },
    { key: "room", label: "Tên phòng" },
    { key: "weekPattern", label: "Tuần học", hidden: true },
    date("startDate", "Ngày bắt đầu"),
    { key: "weekNumbers", label: "Tuần trong học kỳ" },
    { key: "round", label: "Đợt" },
    { key: "lecturer", label: "Giảng viên" },
  ] },
  { key: "grades", path: "/grades", title: "Sổ điểm", description: "Theo dõi điểm sinh viên theo lớp học phần và học kỳ.", group: "Học vụ", fields: [
    title,
    { key: "ordinal", label: "STT", kind: "number" },
    { key: "studentCode", label: "Mã sinh viên", required: true },
      { key: "studentMiddleName", label: "Họ đệm", required: true },
      { key: "studentGivenName", label: "Tên", required: true },
      { key: "studentName", label: "Họ và tên", hidden: true },
    { key: "courseCode", label: "Mã lớp học phần", required: true },
    { key: "courseName", label: "Tên học phần" },
    { key: "className", label: "Lớp" },
    { key: "semesterName", label: "Đợt / Học kỳ" },
    { key: "academicYear", label: "Năm học" },
    { key: "credits", label: "Số tín chỉ", kind: "number" },
    { key: "midtermScore", label: "Điểm giữa kỳ (30%)", kind: "number" },
    { key: "essayScore", label: "Điểm tiểu luận (20%)", kind: "number" },
    { key: "examEligible", label: "Được dự thi" },
    { key: "finalExamScore", label: "Điểm cuối kỳ (50%)", kind: "number" },
    { key: "absent", label: "Vắng thi" },
    { key: "totalScore10", label: "Điểm tổng kết hệ 10", kind: "number" },
    { key: "totalScore4", label: "Điểm tín chỉ hệ 4", kind: "number" },
    { key: "letterGrade", label: "Điểm chữ" },
    { key: "classification", label: "Xếp loại" },
    notes,
    { key: "lecturer", label: "Giảng viên" },
  ] },
  { key: "assignments", path: "/assignments", title: "Bài tập", description: "Giao bài, hạn nộp và ghi nhận kết quả.", group: "Học vụ", fields: [title, { key: "className", label: "Lớp" }, dueDate, priorityField, statusField, notes] },
  { key: "tasks", path: "/tasks", title: "Công việc", description: "Theo dõi việc cần làm và thời hạn.", group: "Đào tạo", fields: [title, dueDate, priorityField, statusField, notes] },
  { key: "student-support", path: "/student-support", title: "Hỗ trợ sinh viên", description: "Tạo phiếu hỗ trợ và theo dõi tiến độ xử lý.", group: "Hỗ trợ", fields: [title, { key: "studentCode", label: "Mã sinh viên" }, { key: "studentName", label: "Họ và tên sinh viên" }, { key: "category", label: "Loại hỗ trợ", kind: "select", options: ["Học vụ", "Đăng ký học phần", "Điểm / kết quả học tập", "Học phí", "Lịch học / thời khóa biểu", "Tài khoản / kỹ thuật", "Thủ tục / giấy tờ", "Khác"] }, priorityField, statusField, notes] },
  { key: "supports", path: "/supports", title: "Quản lý phiếu hỗ trợ", description: "Tiếp nhận, phân công và theo dõi tiến độ xử lý yêu cầu hỗ trợ.", group: "Hỗ trợ", fields: [title, { key: "category", label: "Danh mục" }, priorityField, statusField, notes] },
  { key: "documents", path: "/documents", title: "Tài liệu", description: "Lưu thông tin và liên kết tài liệu môn học.", group: "Hỗ trợ", fields: [title, { key: "url", label: "Liên kết", kind: "url" }, { key: "category", label: "Danh mục" }, { key: "subject", label: "Môn học" }, notes] },
  { key: "survey-participation", path: "/survey-participation", title: "Tham gia khảo sát", description: "Thực hiện và theo dõi khảo sát học phần.", group: "Học vụ", fields: [], system: true },
  { key: "surveys", path: "/surveys", title: "Quản lý khảo sát", description: "Theo dõi khảo sát, phản hồi và thời hạn.", group: "Học vụ", fields: [title, { key: "courseName", label: "Học phần", required: true }, { key: "semesterName", label: "Học kỳ áp dụng", required: true }, dueDate, { key: "audience", label: "Đối tượng" }, statusField, { key: "notes", label: "Nội dung khảo sát / hướng dẫn", kind: "textarea" }] },
  { key: "notifications", path: "/notifications", title: "Thông báo", description: "Soạn và lưu thông tin thông báo cá nhân.", group: "Quản trị", fields: [title, dueDate, { key: "audience", label: "Người nhận" }, statusField, notes] },
  { key: "announcements", path: "/announcements", title: "Thông báo hệ thống", description: "Quản lý nội dung thông báo trong phạm vi tài khoản.", group: "Quản trị", fields: [title, dueDate, statusField, notes] },
  { key: "academic-ai", path: "/academic-ai", title: "Học vụ AI", description: "Hỏi đáp học vụ dựa trên tài liệu nội bộ và thông tin tham khảo từ web.", group: "Học vụ", fields: [], system: true },
  { key: "forms-templates", path: "/forms-templates", title: "Biểu mẫu", description: "Kho mẫu đơn hành chính và biểu mẫu sử dụng trong lớp.", group: "Hỗ trợ", fields: [title, { key: "url", label: "Liên kết tệp mẫu", kind: "url" }, { key: "category", label: "Loại biểu mẫu" }, statusField, notes] },
  { key: "random-picker", path: "/random-picker", title: "Random", description: "Quay số gọi tên, chia nhóm, xếp thứ tự, bốc câu hỏi và ghép cặp học tập.", group: "Học vụ", fields: [{ key: "listName", label: "Tên danh sách", required: true }, { key: "items", label: "Các lựa chọn (mỗi dòng một mục)", kind: "textarea", required: true }, notes], system: true },
  { key: "my-profile", path: "/my-profile", title: "Hồ sơ của tôi", description: "Thông tin tài khoản đang đăng nhập.", group: "Chung", fields: [], system: true },
  { key: "accounts", path: "/accounts", title: "Quản lý tài khoản", description: "Mời và quản lý người dùng qua Supabase Auth.", group: "Quản trị", fields: [], system: true },
  { key: "permissions", path: "/permissions", title: "Phân quyền hệ thống", description: "Ma trận quyền đọc, ghi, sửa, xóa, khôi phục và sao lưu.", group: "Quản trị", fields: [], system: true },
  { key: "audit-logs", path: "/audit-logs", title: "Nhật ký hệ thống", description: "Tra cứu hoạt động theo người dùng, module, loại thao tác và thời gian.", group: "Quản trị", fields: [], system: true },
  { key: "backup", path: "/backup", title: "Sao lưu", description: "Xuất và nhập bản sao lưu các dữ liệu cá nhân.", group: "Quản trị", fields: [], system: true },
  { key: "trash", path: "/trash", title: "Thùng rác", description: "Khôi phục hoặc xóa vĩnh viễn hồ sơ đã xóa mềm.", group: "Quản trị", fields: [], system: true },
  { key: "settings", path: "/settings", title: "Cài đặt hệ thống", description: "Thông tin trường, khoa, học kỳ hiện tại và giảng viên phụ trách.", group: "Quản trị", fields: [], system: true },
];

export const moduleByKey = Object.fromEntries(moduleDefinitions.map((module) => [module.key, module]));
