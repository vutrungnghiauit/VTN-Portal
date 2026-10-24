import { moduleDefinitions } from "../workspace/module-definitions";

export type PermissionAction = "read" | "create" | "update" | "delete" | "restore" | "export";
export type PermissionResource = {
  key: string;
  title: string;
  detail: string;
  group: string;
  kind: "module" | "tab";
  parentKey?: string;
  actions: Array<PermissionAction | "import">;
  permissionKeys?: Partial<Record<PermissionAction, string[]>>;
};

export const permissionGroups = [
  { key: "group:chung", name: "Chung" },
  { key: "group:dao-tao", name: "Đào tạo" },
  { key: "group:hoc-vu", name: "Học vụ" },
  { key: "group:ho-tro", name: "Hỗ trợ" },
  { key: "group:khac", name: "Mục khác" },
  { key: "group:quan-tri", name: "Quản trị" },
] as const;

const tabCatalog: Record<string, Array<{ key: string; title: string; detail: string }>> = {
  "student-records": [
    { key: "student-profile", title: "Thông tin sinh viên", detail: "Tab hồ sơ cá nhân trong popup sinh viên." },
    { key: "academic-results", title: "Bảng kết quả học tập", detail: "Kết quả các học phần của sinh viên." },
    { key: "study-history", title: "Lịch sử theo học", detail: "Lịch sử học phần và giảng viên phụ trách." },
  ],
  grades: [
    { key: "student-profile", title: "Thông tin sinh viên", detail: "Tab hồ sơ trong popup mã sinh viên." },
    { key: "academic-results", title: "Bảng kết quả học tập", detail: "Chi tiết kết quả theo học phần." },
    { key: "study-history", title: "Lịch sử theo học", detail: "Lịch sử học phần của sinh viên." },
  ],
  timetables: [
    { key: "list", title: "Danh sách thời khóa biểu", detail: "Danh sách dữ liệu thời khóa biểu học kỳ." },
    { key: "week", title: "Xem theo tuần", detail: "Lịch tuần đồng bộ với module Lịch giảng dạy." },
  ],
  calendar: [
    { key: "list", title: "Danh sách lịch giảng dạy", detail: "Danh sách lịch giảng dạy đã nhập." },
    { key: "week", title: "Xem theo tuần", detail: "Lịch giảng dạy theo từng tuần." },
  ],
  "academic-ai": [
    { key: "chat", title: "Hỏi đáp học vụ", detail: "Tra cứu học vụ bằng trợ lý AI." },
    { key: "sources", title: "Nguồn dữ liệu AI", detail: "Quản lý tài liệu dùng cho trợ lý AI." },
  ],
};

const groupKeyByName: Record<string, string> = {
  Chung: "group:chung",
  "Đào tạo": "group:dao-tao",
  "Học vụ": "group:hoc-vu",
  "Hỗ trợ": "group:ho-tro",
  "Quản trị": "group:quan-tri",
};

export function permissionGroupKeyForName(name: string) {
  return groupKeyByName[name] ?? "group:khac";
}

const resourceActions: Record<string, PermissionResource["actions"]> = {
  dashboard: ["read"],
  "source-data": ["read", "create", "update", "delete", "import", "export"],
  "academic-years": ["read", "create", "update", "delete", "restore", "import", "export"],
  semesters: ["read", "create", "update", "delete", "restore", "import", "export"],
  timetables: ["read", "create", "update", "delete", "restore", "import", "export"],
  "student-records": ["read", "create", "update", "delete", "restore", "import", "export"],
  "course-sections": ["read", "create", "update", "delete", "restore", "import", "export"],
  groups: ["read", "create"],
  "teaching-plans": ["read", "create", "update", "delete", "restore", "import", "export"],
  calendar: ["read", "create", "update", "delete", "restore", "import", "export"],
  grades: ["read", "create", "update", "delete", "restore", "import", "export"],
  assignments: ["read", "create", "update", "delete", "restore"],
  tasks: ["read", "create", "update", "delete", "restore"],
  "student-support": ["read", "create", "update"],
  supports: ["read", "create", "update", "delete", "restore"],
  documents: ["read", "create", "update", "delete", "restore"],
  "survey-participation": ["read", "create", "update"],
  surveys: ["read", "create", "update", "delete", "restore", "import"],
  notifications: ["read", "create"],
  announcements: ["read", "create", "update", "delete", "restore"],
  "academic-ai": ["read", "create", "update", "delete", "import"],
  "forms-templates": ["read", "create", "update", "delete", "restore"],
  "random-picker": ["read", "create", "update", "delete", "export"],
  "my-profile": ["read", "update"],
  accounts: ["read", "create", "update", "delete"],
  permissions: ["read", "update"],
  "audit-logs": ["read", "delete", "export"],
  backup: ["read", "create", "update", "restore", "import", "export"],
  trash: ["read", "restore", "delete"],
  settings: ["read", "update"],
};

export const permissionResources: PermissionResource[] = moduleDefinitions.map((module) => {
  const resource: PermissionResource = {
    key: module.key,
    title: module.title,
    detail: module.description,
    group: permissionGroupKeyForName(module.group),
    kind: "module",
    actions: resourceActions[module.key] ?? ["read", "create", "update", "delete", "restore"],
  };
  if (module.key === "student-records") {
    resource.permissionKeys = {
      read: ["student-records", "students"],
      create: ["students"], update: ["students"], delete: ["students"], export: ["student-records", "students"], restore: ["students"],
    };
  }
  return resource;
}).flatMap((module) => [
  module,
  ...(tabCatalog[module.key] ?? []).map((tab) => ({
    key: `tab:${module.key}:${tab.key}`,
    title: tab.title,
    detail: tab.detail,
    group: module.group,
    kind: "tab" as const,
    parentKey: module.key,
    actions: ["read"] as PermissionAction[],
  })),
]);

export const permissionRoles = [
  { key: "super_admin", label: "SUPER ADMIN", name: "Quản trị viên toàn quyền", description: "Toàn quyền quản lý hệ thống và ma trận quyền. Vai trò này luôn được bảo vệ." },
  { key: "system_admin", label: "SYSTEM ADMIN", name: "Quản trị hệ thống", description: "Quản lý cấu hình và vận hành các phân hệ được cấp." },
  { key: "sub_admin", label: "SUB ADMIN", name: "Quản trị viên phụ", description: "Hỗ trợ quản trị các phân hệ theo quyền được giao." },
  { key: "teacher", label: "GIẢNG VIÊN", name: "Giảng viên", description: "Quản lý học phần, lớp, điểm và khảo sát phụ trách." },
  { key: "assistant", label: "TRỢ GIẢNG", name: "Trợ giảng", description: "Hỗ trợ giảng dạy và xử lý các nghiệp vụ được phân công." },
  { key: "class_president", label: "LỚP TRƯỞNG", name: "Lớp trưởng", description: "Hỗ trợ thông tin và hoạt động của lớp học." },
  { key: "class_vice", label: "LỚP PHÓ", name: "Lớp phó", description: "Hỗ trợ hoạt động lớp theo phạm vi được cấp." },
  { key: "student", label: "SINH VIÊN", name: "Sinh viên", description: "Truy cập thông tin học tập và các dịch vụ dành cho sinh viên." },
] as const;

export const permissionActions: Array<{ key: PermissionAction | "import"; label: string; keys: PermissionAction[] }> = [
  { key: "read", label: "Đọc / xem", keys: ["read"] },
  { key: "create", label: "Ghi / tạo", keys: ["create"] },
  { key: "update", label: "Chỉnh sửa", keys: ["update"] },
  { key: "import", label: "Nhập dữ liệu", keys: ["create", "update"] },
  { key: "export", label: "Xuất dữ liệu", keys: ["export"] },
  { key: "delete", label: "Xóa", keys: ["delete"] },
  { key: "restore", label: "Khôi phục", keys: ["restore"] },
];

export function resourcePermissionKeys(resource: PermissionResource, action: PermissionAction) {
  return resource.permissionKeys?.[action] ?? [resource.key];
}

export function resourceGroupKey(resource: PermissionResource) {
  return permissionGroups.find((group) => group.key === resource.group)?.key ?? resource.group;
}
