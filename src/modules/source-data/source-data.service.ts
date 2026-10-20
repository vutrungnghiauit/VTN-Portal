import { supabase } from "../../lib/supabase";
import { workspaceService, type WorkspaceRecord } from "../workspace/workspace.service";
import { bundledTeachingProgressRows } from "../workspace/teaching-plan-progress-data";

export type SourceDataValue = string | number | null;
export type SourceDataRow = Record<string, SourceDataValue>;
export type StoredSourceRow = WorkspaceRecord & { data: SourceDataRow };
export type SourceDataScope = { academicYear: string; semesterName: string };
export type SourceDataClassification = { categoryKey: string; academicYear: string; semesterName: string; rowCount: number };
export type StoredSourceFile = WorkspaceRecord & { data: Record<string, string | number | null> };

const SOURCE_MODULE_KEY = "source-data";
const SOURCE_FILES_MODULE_KEY = "source-data-files";
const SOURCE_FILES_BUCKET = "vtn-source-files";
const sourceCategory = (record: WorkspaceRecord) => String(record.data._sourceCategory ?? "");
const sourceBatch = (record: WorkspaceRecord) => String(record.data._sourceBatchId ?? "");
const sourceScope = (record: WorkspaceRecord) => String(record.data._sourceScopeId ?? "legacy");
const bundledFile = "Tien do dao tao nam hoc 2025-2026.pdf";
const bundledPublishedAt = "2024-11-25T00:00:00.000Z";

function bundledTeachingProgressRecords(): StoredSourceRow[] {
  return bundledTeachingProgressRows.map((row, index) => ({
    id: `bundled-teaching-progress-2025-2026-${index + 1}`,
    module_key: SOURCE_MODULE_KEY,
    external_id: `bundled-teaching-progress-2025-2026-${index + 1}`,
    data: { ...row, _sourceCategory: "teaching-plans", _sourceBatchId: "bundled-teaching-progress-2025-2026", _sourceScopeId: "2025-2026::", _sourceAcademicYear: "2025-2026", _sourceFile: bundledFile, _sourceImportedAt: bundledPublishedAt, _sourceRowNumber: index + 1 },
    created_at: bundledPublishedAt,
    updated_at: bundledPublishedAt,
    deleted_at: null,
    purge_at: null,
  }));
}

function latestBatchByCategoryAndScope(records: WorkspaceRecord[]) {
  const latest = new Map<string, string>();
  for (const record of records) {
    if (record.deleted_at) continue;
    const category = sourceCategory(record);
    if (category) {
      const key = `${category}::${sourceScope(record)}`;
      if (!latest.has(key)) latest.set(key, sourceBatch(record));
    }
  }
  return latest;
}

function scopeKey(scope: SourceDataScope) {
  return `${scope.academicYear.trim()}::${scope.semesterName.trim()}`;
}

function safeFileName(fileName: string) {
  return fileName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-140) || "source-file";
}

function bucketError(message: string) {
  if (/bucket|object|storage|row-level security|permission/i.test(message)) {
    return `${message} Hãy tạo bucket riêng tư vtn-source-files bằng script supabase/source-data-files.sql.`;
  }
  return message;
}

export const sourceDataService = {
  async listAll() {
    const records = await workspaceService.list(SOURCE_MODULE_KEY);
    const latest = latestBatchByCategoryAndScope(records);
    const active = records.filter((record) => !record.deleted_at && latest.get(`${sourceCategory(record)}::${sourceScope(record)}`) === sourceBatch(record))
      .sort((a, b) => String(b.data._sourceImportedAt ?? b.updated_at).localeCompare(String(a.data._sourceImportedAt ?? a.updated_at))
        || Number(a.data._sourceRowNumber ?? 0) - Number(b.data._sourceRowNumber ?? 0)) as StoredSourceRow[];
    const hasImported2025Progress = active.some((record) => sourceCategory(record) === "teaching-plans" && String(record.data._sourceAcademicYear ?? "").replace(/[–—−]/g, "-") === "2025-2026");
    return hasImported2025Progress ? active : [...active, ...bundledTeachingProgressRecords()];
  },

  async list(category: string) {
    return (await this.listAll()).filter((record) => sourceCategory(record) === category);
  },

  async replace(category: string, fileNames: string[], rows: SourceDataRow[], scope: SourceDataScope) {
    if (!rows.length) throw new Error("Tệp không có dòng dữ liệu hợp lệ.");
    const batchId = crypto.randomUUID();
    const importedAt = new Date().toISOString();
    const sourceFile = fileNames.join(", ");
    const key = scopeKey(scope);
    const saved = await workspaceService.saveMany(SOURCE_MODULE_KEY, rows.map((row, index) => ({
      externalId: `source-data:${category}:${encodeURIComponent(key)}:${index + 1}`,
      values: {
        ...row,
        _sourceCategory: category,
        _sourceBatchId: batchId,
        _sourceScopeId: key,
        _sourceAcademicYear: scope.academicYear,
        _sourceSemesterName: scope.semesterName,
        _sourceFile: sourceFile,
        _sourceImportedAt: importedAt,
        _sourceRowNumber: index + 1,
      },
    })));
    return saved as StoredSourceRow[];
  },

  async saveOriginalFile(file: File, scope: SourceDataScope, extractedCounts: Record<string, number>, classifications: SourceDataClassification[] = []) {
    if (!supabase) throw new Error("Chưa cấu hình Supabase để lưu tệp nguồn.");
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw new Error(authError.message);
    if (!authData.user) throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");

    const fileId = crypto.randomUUID();
    const storagePath = `${authData.user.id}/${fileId}-${safeFileName(file.name)}`;
    const contentType = file.type || "application/octet-stream";
    const { error: uploadError } = await supabase.storage.from(SOURCE_FILES_BUCKET).upload(storagePath, file, { contentType, upsert: false });
    if (uploadError) throw new Error(bucketError(uploadError.message));

    try {
      return await workspaceService.save(SOURCE_FILES_MODULE_KEY, {
        academicYear: scope.academicYear,
        semesterName: scope.semesterName,
        fileName: file.name,
        storagePath,
        contentType,
        size: file.size,
        extractedCategories: JSON.stringify(extractedCounts),
        extractedClassifications: JSON.stringify(classifications),
        privateOwnerOnly: classifications.some((item) => item.categoryKey === "surveys") ? "true" : "false",
        uploadedAt: new Date().toISOString(),
        uploadedBy: authData.user.email ?? "",
        uploadedById: authData.user.id,
      }, undefined, `source-file:${fileId}`) as StoredSourceFile;
    } catch (cause) {
      await supabase.storage.from(SOURCE_FILES_BUCKET).remove([storagePath]);
      throw cause;
    }
  },

  async archiveImportedFile(file: File, categoryKey: string, rows: Array<Record<string, unknown>> = [], fallbackScope: SourceDataScope = { academicYear: "", semesterName: "" }) {
    const groups = new Map<string, SourceDataClassification>();
    const readValue = (row: Record<string, unknown>, ...keys: string[]) => {
      for (const key of keys) {
        const value = String(row[key] ?? "").trim();
        if (value) return value;
      }
      return "";
    };
    for (const row of rows) {
      const rowTerm = categoryKey === "academic-years" ? "" : readValue(row, "semesterName", "semester", "term", ...(categoryKey === "semesters" ? ["title"] : []));
      const embeddedYear = rowTerm.match(/\d{4}\s*[–—-]\s*\d{4}/)?.[0].replace(/[–—]/g, "-").replace(/\s+/g, "");
      const academicYear = (categoryKey === "academic-years" ? readValue(row, "title", "academicYear") : readValue(row, "academicYear", "schoolYear", "year")) || embeddedYear || fallbackScope.academicYear;
      const semesterName = categoryKey === "academic-years" ? "" : rowTerm || fallbackScope.semesterName;
      const key = `${academicYear}::${semesterName}`;
      const existing = groups.get(key);
      groups.set(key, {
        categoryKey,
        academicYear,
        semesterName: categoryKey === "academic-years" ? "" : semesterName || "Tất cả học kỳ",
        rowCount: (existing?.rowCount ?? 0) + 1,
      });
    }
    if (!groups.size) {
      groups.set("empty", {
        categoryKey,
        academicYear: categoryKey === "academic-years" ? fallbackScope.academicYear : fallbackScope.academicYear,
        semesterName: categoryKey === "academic-years" ? "" : fallbackScope.semesterName || "Tất cả học kỳ",
        rowCount: 0,
      });
    }
    const classifications = [...groups.values()];
    const first = classifications[0];
    const scope = { academicYear: first.academicYear, semesterName: first.semesterName === "Tất cả học kỳ" ? "" : first.semesterName };
    return this.saveOriginalFile(file, scope, { [categoryKey]: classifications.reduce((total, item) => total + item.rowCount, 0) }, classifications);
  },

  async replaceOriginalFile(existing: StoredSourceFile, file: File, scope: SourceDataScope, extractedCounts: Record<string, number>, classifications: SourceDataClassification[] = []) {
    if (!supabase) throw new Error("Chưa cấu hình Supabase để lưu tệp nguồn.");
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw new Error(authError.message);
    if (!authData.user) throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");

    const fileId = crypto.randomUUID();
    const storedOwnerId = String(existing.data.uploadedById ?? "").trim();
    const pathOwnerId = String(existing.data.storagePath ?? "").split("/")[0] ?? "";
    const originalOwnerId = storedOwnerId || pathOwnerId || authData.user.id;
    const storagePath = `${originalOwnerId}/${fileId}-${safeFileName(file.name)}`;
    const contentType = file.type || "application/octet-stream";
    const { error: uploadError } = await supabase.storage.from(SOURCE_FILES_BUCKET).upload(storagePath, file, { contentType, upsert: false });
    if (uploadError) throw new Error(bucketError(uploadError.message));

    const replacedAt = new Date().toISOString();
    let saved: StoredSourceFile;
    try {
      saved = await workspaceService.save(SOURCE_FILES_MODULE_KEY, {
        ...existing.data,
        academicYear: scope.academicYear,
        semesterName: scope.semesterName,
        fileName: file.name,
        storagePath,
        contentType,
        size: file.size,
        extractedCategories: JSON.stringify(extractedCounts),
        extractedClassifications: JSON.stringify(classifications),
        privateOwnerOnly: String(existing.data.privateOwnerOnly ?? "false") === "true" || classifications.some((item) => item.categoryKey === "surveys") ? "true" : "false",
        uploadedAt: replacedAt,
        uploadedById: originalOwnerId,
        modifiedAt: replacedAt,
        modifiedBy: authData.user.email ?? "",
        modifiedById: authData.user.id,
      }, undefined, `source-file:${fileId}`) as StoredSourceFile;
    } catch (cause) {
      await supabase.storage.from(SOURCE_FILES_BUCKET).remove([storagePath]);
      throw cause;
    }
    try { await workspaceService.moveToTrash(existing.id); }
    catch (cause) { await workspaceService.moveToTrash(saved.id); throw cause; }
    return saved;
  },

  async updateFileClassification(file: StoredSourceFile, categoryKey: string, scope: SourceDataScope, rowCount: number) {
    if (!supabase) throw new Error("Chưa cấu hình Supabase để cập nhật phân loại tệp nguồn.");
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw new Error(authError.message);
    if (!authData.user) throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");

    const semesterName = categoryKey === "academic-years" ? "" : scope.semesterName.trim();
    const classification: SourceDataClassification = {
      categoryKey,
      academicYear: scope.academicYear.trim(),
      semesterName: categoryKey === "academic-years" ? "" : semesterName || "Tất cả học kỳ",
      rowCount: Math.max(0, Math.floor(rowCount)),
    };
    const updatedAt = new Date().toISOString();
    return await workspaceService.save(SOURCE_FILES_MODULE_KEY, {
      ...file.data,
      academicYear: classification.academicYear,
      semesterName,
      extractedCategories: JSON.stringify({ [categoryKey]: classification.rowCount }),
      extractedClassifications: JSON.stringify([classification]),
      privateOwnerOnly: String(file.data.privateOwnerOnly ?? "false") === "true" || categoryKey === "surveys" ? "true" : "false",
      modifiedAt: updatedAt,
      modifiedBy: authData.user.email ?? "",
      modifiedById: authData.user.id,
    }, file.id, file.external_id ?? undefined) as StoredSourceFile;
  },

  async deleteOriginalFile(file: StoredSourceFile) {
    if (!supabase) throw new Error("Chưa cấu hình Supabase để xóa tệp nguồn.");
    await workspaceService.moveToTrash(file.id);
  },

  async deleteOriginalFilePermanently(file: StoredSourceFile, expiredOnly = false) {
    if (!supabase) throw new Error("Chưa cấu hình Supabase để xóa tệp nguồn.");
    const supportTicketId = String(file.data.supportTicketId ?? "").trim();
    const { data, error } = await supabase.functions.invoke("swift-api", {
      body: supportTicketId
        ? { action: "purge-support-attachment", userId: supportTicketId, workspaceRecordId: file.id, expiredOnly }
        : { action: "purge-source-file", workspaceRecordId: file.id, expiredOnly },
    });
    if (error) throw error;
    if (data?.error) throw new Error(String(data.error));
  },

  async listFiles() {
    return (await workspaceService.list(SOURCE_FILES_MODULE_KEY)).sort((a, b) => String(b.data.uploadedAt ?? b.updated_at).localeCompare(String(a.data.uploadedAt ?? a.updated_at))) as StoredSourceFile[];
  },

  async downloadOriginalFile(storagePath: string) {
    if (!supabase) throw new Error("Chưa cấu hình Supabase để tải tệp nguồn.");
    const { data, error } = await supabase.storage.from(SOURCE_FILES_BUCKET).download(storagePath);
    if (error) throw new Error(bucketError(error.message));
    return data;
  },

  async currentUserId() {
    if (!supabase) throw new Error("Chưa cấu hình Supabase để tải người dùng.");
    const { data, error } = await supabase.auth.getUser();
    if (error) throw new Error(error.message);
    return data.user?.id ?? "";
  },

  async fileDownloadUrl(storagePath: string, fileName?: string) {
    if (!supabase) throw new Error("Chưa cấu hình Supabase để tải tệp nguồn.");
    const { data, error } = await supabase.storage.from(SOURCE_FILES_BUCKET).createSignedUrl(storagePath, 60, { download: fileName || true });
    if (error) throw new Error(bucketError(error.message));
    return data.signedUrl;
  },

  async filePreviewUrl(storagePath: string) {
    if (!supabase) throw new Error("Chưa cấu hình Supabase để xem trước tệp nguồn.");
    const { data, error } = await supabase.storage.from(SOURCE_FILES_BUCKET).createSignedUrl(storagePath, 300, { download: false });
    if (error) throw new Error(bucketError(error.message));
    return data.signedUrl;
  },
};

export function sourceValues(row: StoredSourceRow): SourceDataRow {
  return Object.fromEntries(Object.entries(row.data).filter(([key]) => !key.startsWith("_source")));
}
