import { useRef, useState, type ReactNode } from "react";
import { Clipboard, Download, FileUp } from "lucide-react";
import * as XLSX from "xlsx";
import type { ModuleField } from "./module-definitions";

export type SpreadsheetValue = string | number | null;
export type ParsedSpreadsheetImportFile = { file: File; rows: Array<Record<string, SpreadsheetValue>> };
export type SpreadsheetActionContext = { busy: boolean; openFilePicker: () => void; exportFile: (format: "csv" | "xls") => void; togglePaste: () => void; copyRows: () => Promise<void> };
const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").trim().toLocaleLowerCase("vi-VN");

export default function SpreadsheetTransferPanel({ title, description = "Nhận tệp Excel .xls/.xlsx, CSV hoặc dữ liệu dán từ bảng tính.", fields, exportFields = fields, rows, canImport, canExport, onImport, onPdfImport, onArchiveFiles, customActionsOnly = false, fiveColumnActions = false, extraActions }: {
  title: string; fields: ModuleField[]; rows: Array<Record<string, unknown>>; canImport: boolean; canExport: boolean;
  description?: string;
  exportFields?: ModuleField[];
  onImport: (rows: Array<Record<string, SpreadsheetValue>>) => Promise<void>;
  onPdfImport?: (file: File) => Promise<Array<Record<string, SpreadsheetValue>>>;
  onArchiveFiles?: (files: ParsedSpreadsheetImportFile[]) => Promise<void>;
  customActionsOnly?: boolean;
  fiveColumnActions?: boolean;
  extraActions?: (context: SpreadsheetActionContext) => ReactNode;
}) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [pasteOpen, setPasteOpen] = useState(false); const [paste, setPaste] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const aliases: Record<string, string[]> = { title: ["ten mon hoc", "mon hoc", "ten hoc ky", "nam hoc", "ten lop", "su kien", "tieu de"], semesterName: ["hk", "hoc ky", "term", "dot"], studentCode: ["mssv", "ma sv", "ma so sinh vien"], studentMiddleName: ["ho dem", "ho va ten", "ho ten", "ho ten sinh vien", "ten sinh vien"], studentGivenName: ["ten"], studentName: ["ho va ten", "ho ten", "ho ten sinh vien", "ten sinh vien"], courseCode: ["ma hoc phan", "ma lhp", "ma lop hoc phan"], courseName: ["ten hoc phan", "ten mon hoc"], midtermScore: ["diem giua ky", "diem chuyen can"], essayScore: ["diem tieu luan"], finalExamScore: ["diem cuoi ky", "diem thi"], totalScore10: ["diem tong ket he 10", "diem tong ket"], totalScore4: ["diem tin chi", "diem he 4"], letterGrade: ["diem chu"], classification: ["xep loai"], credits: ["so tin chi", "tin chi"], classSize: ["si so", "sĩ số"], classCode: ["lop du kien", "ma lop"] };
  const headers = fields.map((field) => ({ key: field.key, label: field.label, aliases: new Set([normalize(field.key), normalize(field.label), ...(aliases[field.key] ?? []).map(normalize)]) }));
  const readRows = async (source: string | ArrayBuffer, type: "string" | "array") => {
    const workbook = type === "string" ? XLSX.read(source as string, { type: "string", raw: false, cellDates: false }) : XLSX.read(source as ArrayBuffer, { type: "array", raw: false, cellDates: false }); const parsed: Array<Record<string, SpreadsheetValue>> = [];
    for (const sheetName of workbook.SheetNames) {
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false });
      const headerIndex = matrix.findIndex((row) => row.filter((cell) => headers.some((field) => field.aliases.has(normalize(cell))) || /^t\d+$/.test(normalize(cell))).length >= 2);
      if (headerIndex < 0) continue;
      const sourceHeaders = matrix[headerIndex].map(normalize);
      const matches = headers.map((field) => ({ key: field.key, index: sourceHeaders.findIndex((value) => field.aliases.has(value)) })).filter((field) => field.index >= 0);
      const weekColumns = sourceHeaders.map((value, index) => ({ week: Number(value.slice(1)), index })).filter((item) => /^t\d+$/.test(sourceHeaders[item.index]));
      for (const cells of matrix.slice(headerIndex + 1)) {
        const values: Record<string, SpreadsheetValue> = {};
        for (const field of matches) {
          const cell = cells[field.index]; if (cell === undefined || cell === null || String(cell).trim() === "") continue;
          const definition = fields.find((item) => item.key === field.key)!;
          const rawValue = String(cell).trim();
          if (definition.kind === "number") { const number = Number(rawValue.replace(/,/g, "")); if (Number.isFinite(number)) values[field.key] = number; }
          else if (definition.kind === "date" && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(rawValue)) { const [, day, month, year] = rawValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)!; values[field.key] = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`; }
          else values[field.key] = rawValue;
        }
        if (fields.some((field) => field.key === "weekNumbers") && weekColumns.length) {
          const weeks = weekColumns.filter(({ index }) => ["x", "1", "true", "✓"].includes(normalize(cells[index]))).map(({ week }) => week);
          if (weeks.length) values.weekNumbers = weeks.join(",");
        }
        if (Object.values(values).some((value) => value !== "" && value !== null)) parsed.push(values);
      }
    }
    if (!parsed.length) throw new Error("Không tìm thấy dữ liệu. Hãy dùng hàng tiêu đề có ít nhất hai cột trùng với tên trường trong module.");
    return parsed;
  };
  const importRows = async (items: Array<Record<string, SpreadsheetValue>>) => { setBusy(true); setError(""); try { await onImport(items); } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể nhập dữ liệu."); } finally { setBusy(false); } };
  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return; setBusy(true); setError("");
    try {
      const parsed: Array<Record<string, SpreadsheetValue>> = [];
      const parsedFiles: ParsedSpreadsheetImportFile[] = [];
      for (const file of Array.from(files)) {
        let fileRows: Array<Record<string, SpreadsheetValue>>;
        if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
          if (!onPdfImport) throw new Error("Không hỗ trợ nhập PDF trong module này.");
          fileRows = await onPdfImport(file);
        } else {
          const isCsv = /\.csv$/i.test(file.name);
          fileRows = await readRows(isCsv ? await file.text() : await file.arrayBuffer(), isCsv ? "string" : "array");
        }
        parsed.push(...fileRows);
        parsedFiles.push({ file, rows: fileRows });
      }
      if (onArchiveFiles) await onArchiveFiles(parsedFiles);
      await onImport(parsed);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể đọc tệp bảng tính."); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  };
  const exportFile = (format: "csv" | "xls") => {
    const data = rows.map((row) => Object.fromEntries(exportFields.map((field) => [field.label, row[field.key] ?? ""])));
    const worksheet = XLSX.utils.json_to_sheet(data); const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, worksheet, "Du lieu");
    XLSX.writeFile(workbook, `${title.toLocaleLowerCase("vi-VN").replace(/[^\p{L}\p{N}]+/gu, "-")}.${format}`, { bookType: format === "xls" ? "biff8" : "csv" });
  };
  const copyRows = async () => {
    const lines = [exportFields.map((field) => field.label), ...rows.map((row) => exportFields.map((field) => row[field.key] ?? ""))];
    await navigator.clipboard.writeText(lines.map((line) => line.map((value) => String(value).replace(/[\t\r\n]/g, " ")).join("\t")).join("\r\n"));
  };
  return <section className={`spreadsheet-transfer workspace-panel${fiveColumnActions ? " spreadsheet-transfer-five-columns" : ""}`}><div><strong>Nhập / xuất {title.toLocaleLowerCase("vi-VN")}</strong><p>{description}</p>{error && <small role="alert">{error}</small>}</div><div className={`spreadsheet-transfer-actions${fiveColumnActions ? " spreadsheet-transfer-actions-five" : ""}`}>
    {canImport && <input ref={inputRef} hidden multiple type="file" accept={onPdfImport ? ".xls,.xlsx,.csv,.pdf" : ".xls,.xlsx,.csv"} onChange={(event) => void importFiles(event.target.files)} />}
    {!customActionsOnly && canImport && <><button type="button" disabled={busy} onClick={() => inputRef.current?.click()}><FileUp size={15} /> Nhập .xls / .csv</button><button type="button" disabled={busy} onClick={() => setPasteOpen((value) => !value)}><Clipboard size={15} /> Dán dữ liệu</button></>}
    {!customActionsOnly && canExport && <><button type="button" disabled={!rows.length} onClick={() => exportFile("xls")}><Download size={15} /> Xuất .xls</button><button type="button" disabled={!rows.length} onClick={() => exportFile("csv")}><Download size={15} /> Xuất .csv</button><button type="button" disabled={!rows.length} onClick={() => void copyRows().catch(() => setError("Không thể ghi vào clipboard. Hãy xuất CSV."))}><Clipboard size={15} /> Sao chép</button></>}
    {extraActions?.({ busy, openFilePicker: () => inputRef.current?.click(), exportFile, togglePaste: () => setPasteOpen((value) => !value), copyRows: () => copyRows().catch(() => setError("Không thể ghi vào clipboard. Hãy xuất CSV.")) })}
  </div>{pasteOpen && canImport && <div className="spreadsheet-paste"><textarea rows={5} value={paste} onChange={(event) => setPaste(event.target.value)} placeholder="Dán dữ liệu từ Excel/Sheets (gồm hàng tiêu đề)" /><button className="workspace-primary" type="button" disabled={busy || !paste.trim()} onClick={() => { void readRows(paste, "string").then(importRows).catch((cause) => setError(cause instanceof Error ? cause.message : "Không đọc được dữ liệu dán.")); }}>Nhập dữ liệu dán</button></div>}</section>;
}
