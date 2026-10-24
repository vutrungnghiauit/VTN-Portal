import type { ModuleField } from "../workspace/module-definitions";
import { moduleDefinitions } from "../workspace/module-definitions";

export type SourceDataSection = {
  key: string;
  moduleKey: string;
  title: string;
  description: string;
  fields: ModuleField[];
  requiredKeys: string[];
  acceptsPdf?: boolean;
};

const fieldsFor = (key: string) => moduleDefinitions.find((module) => module.key === key)?.fields ?? [];
const timetableFields: ModuleField[] = [
  { key: "academicYear", label: "Năm học" }, { key: "semesterName", label: "Học kỳ", required: true },
  { key: "courseCode", label: "Mã LHP", required: true }, { key: "subjectName", label: "Tên môn học", required: true },
  { key: "credits", label: "Số TC", kind: "number" }, { key: "classCode", label: "Lớp dự kiến", required: true },
  { key: "mergedClassCode", label: "Mã lớp ghép" }, { key: "weekday", label: "Thứ" }, { key: "periods", label: "Tiết" },
  { key: "scheduleType", label: "Loại lịch" }, { key: "periodCount", label: "Số tiết", kind: "number" },
  { key: "classSize", label: "Sĩ số", kind: "number" }, { key: "startDate", label: "Ngày bắt đầu", kind: "date" },
  { key: "endDate", label: "Ngày kết thúc", kind: "date" }, { key: "weekNumbers", label: "Tuần học" },
  { key: "totalPeriods", label: "Tổng số tiết", kind: "number" }, { key: "room", label: "Phòng" },
  { key: "lecturer", label: "Giảng viên" }, { key: "notes", label: "Ghi chú" },
];
const ticketFields: ModuleField[] = [
  { key: "title", label: "Tiêu đề", required: true }, { key: "description", label: "Nội dung", required: true },
  { key: "category", label: "Loại yêu cầu" }, { key: "status", label: "Trạng thái" },
];
const teachingPlanFields: ModuleField[] = [
  { key: "rowType", label: "Loại dữ liệu" },
  { key: "academicYear", label: "Năm học", required: true },
  { key: "semester", label: "Học kỳ", required: true },
  { key: "startDate", label: "Ngày bắt đầu", kind: "date" },
  { key: "weeks", label: "Số tuần", kind: "number" },
  { key: "examWeeks", label: "Tuần thi" },
  { key: "marks", label: "Ngày nghỉ / ghi chú", kind: "textarea" },
  { key: "week", label: "Tuần", kind: "number" },
  { key: "date", label: "Ngày thực hiện", kind: "date" },
  { key: "subject", label: "Môn học" },
  { key: "className", label: "Lớp học phần" },
  { key: "title", label: "Chủ đề / nội dung" },
  { key: "status", label: "Trạng thái" },
  { key: "notes", label: "Ghi chú", kind: "textarea" },
];

export const sourceDataSections: SourceDataSection[] = [
  { key: "academic-years", moduleKey: "academic-years", title: "Năm học", description: "Danh sách năm học và ngày bắt đầu, kết thúc.", fields: fieldsFor("academic-years"), requiredKeys: ["title"] },
  { key: "semesters", moduleKey: "semesters", title: "Học kỳ - năm học", description: "Danh sách học kỳ, năm học áp dụng, thời gian và số tuần.", fields: fieldsFor("semesters"), requiredKeys: ["title", "academicYear"] },
  { key: "timetables", moduleKey: "timetables", title: "Thời khóa biểu học kỳ", description: "Lịch học theo học kỳ, học phần và lớp dự kiến.", fields: timetableFields, requiredKeys: ["semesterName", "courseCode", "subjectName", "classCode"], acceptsPdf: true },
  { key: "course-sections", moduleKey: "course-sections", title: "Danh sách lớp học phần", description: "Dữ liệu sinh viên đăng ký lớp học phần theo học kỳ.", fields: fieldsFor("course-sections"), requiredKeys: ["studentCode", "courseClassCode", "semesterName"] },
  { key: "calendar", moduleKey: "calendar", title: "Lịch giảng dạy", description: "Lịch học phần, tuần học và tiến độ giảng dạy.", fields: [{ key: "semesterName", label: "Học kỳ áp dụng" }, ...fieldsFor("calendar")], requiredKeys: ["courseCode", "title"] },
  { key: "teaching-plans", moduleKey: "teaching-plans", title: "Tiến độ đào tạo", description: "Tiến độ đào tạo theo học kỳ hoặc kế hoạch giảng dạy theo tuần. PDF/ảnh lịch tiến độ sẽ được nhận diện theo năm học trên tiêu đề.", fields: teachingPlanFields, requiredKeys: ["academicYear", "semester"] },
  { key: "grades", moduleKey: "grades", title: "Sổ điểm", description: "Bảng điểm sinh viên theo lớp học phần và học kỳ.", fields: fieldsFor("grades"), requiredKeys: ["studentCode", "courseCode"] },
  { key: "tasks", moduleKey: "tasks", title: "Công việc", description: "Danh sách công việc và thời hạn.", fields: fieldsFor("tasks"), requiredKeys: ["title"] },
  { key: "student-support", moduleKey: "student-support", title: "Hỗ trợ sinh viên", description: "Thông tin và trạng thái các trường hợp hỗ trợ.", fields: fieldsFor("student-support"), requiredKeys: ["title"] },
  { key: "documents", moduleKey: "documents", title: "Tài liệu", description: "Danh mục tài liệu, môn học và liên kết tệp.", fields: fieldsFor("documents"), requiredKeys: ["title"] },
  { key: "surveys", moduleKey: "surveys", title: "Quản lý khảo sát", description: "Danh sách khảo sát, học phần, học kỳ, đối tượng và thời hạn.", fields: fieldsFor("surveys"), requiredKeys: ["title", "courseName", "semesterName"] },
  { key: "announcements", moduleKey: "announcements", title: "Thông báo hệ thống", description: "Nội dung và trạng thái thông báo hệ thống.", fields: fieldsFor("announcements"), requiredKeys: ["title"] },
  { key: "supports", moduleKey: "supports", title: "Quản lý phiếu hỗ trợ", description: "Tiêu đề, nội dung và loại yêu cầu hỗ trợ.", fields: ticketFields, requiredKeys: ["title", "description"] },
  { key: "forms-templates", moduleKey: "forms-templates", title: "Biểu mẫu", description: "Danh mục biểu mẫu và liên kết tệp mẫu.", fields: fieldsFor("forms-templates"), requiredKeys: ["title"] },
];

export function getSourceDataSection(moduleKey: string) {
  return sourceDataSections.find((section) => section.moduleKey === moduleKey);
}
