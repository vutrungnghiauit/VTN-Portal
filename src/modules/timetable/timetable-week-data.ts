import seedRows from "./semester-schedules.json";
import { normalizeLecturer } from "../../lib/lecturer-format";
import type { WorkspaceRecord } from "../workspace/workspace.service";

export type TimetableEntry = (typeof seedRows)[number];

function toEntry(record: WorkspaceRecord): TimetableEntry | null {
  const data = record.data;
  if (!data.courseCode || !data.classCode || !data.semesterName) return null;
  return {
    id: String(data.sourceId ?? record.external_id ?? record.id), sourceFile: String(data.sourceFile ?? ""),
    academicYear: String(data.academicYear ?? ""), semesterNumber: Number(data.semesterNumber ?? 0), semesterName: String(data.semesterName),
    courseCode: String(data.courseCode), subjectName: String(data.subjectName ?? ""), credits: Number(data.credits ?? 0), classCode: String(data.classCode), mergedClassCode: String(data.mergedClassCode ?? ""), sourceSemesterCode: String(data.sourceSemesterCode ?? ""), sourceWeekdayCode: String(data.sourceWeekdayCode ?? ""), weekday: String(data.weekday ?? ""), periods: String(data.periods ?? ""), scheduleType: String(data.scheduleType ?? ""), periodCount: Number(data.periodCount ?? 0), group: String(data.group ?? ""), classSize: Number(data.classSize ?? 0), startDate: String(data.startDate ?? ""), endDate: String(data.endDate ?? ""), weekNumbers: String(data.weekNumbers ?? "").split(",").filter(Boolean).map(Number), totalPeriods: Number(data.totalPeriods ?? 0), room: String(data.room ?? ""), lecturer: normalizeLecturer(data.lecturer), notes: String(data.notes ?? ""),
  } as TimetableEntry;
}

export function buildTimetableRows(storedRows: WorkspaceRecord[]): TimetableEntry[] {
  const activeRows = storedRows.filter((record) => !record.deleted_at);
  const saved = new Map(activeRows.map((record) => [record.external_id || String(record.data.sourceId ?? ""), record]));
  const deletedIds = new Set(storedRows.filter((record) => record.deleted_at).map((record) => record.external_id || String(record.data.sourceId ?? "")));
  const merged = seedRows.filter((source) => !deletedIds.has(source.id)).map((source) => {
    const record = saved.get(source.id);
    return record ? toEntry(record) ?? source : source;
  });
  const known = new Set(seedRows.map((row) => row.id));
  for (const record of activeRows) {
    const parsed = toEntry(record);
    if (parsed && !known.has(parsed.id)) merged.push(parsed);
  }
  return merged.sort((a, b) => a.startDate.localeCompare(b.startDate) || Number(a.weekday) - Number(b.weekday) || a.periods.localeCompare(b.periods));
}

export function toTimetableWeekRecords(rows: TimetableEntry[]): WorkspaceRecord[] {
  return rows.map((row) => ({
    id: row.id,
    module_key: "timetables",
    external_id: row.id,
    data: { ...row, title: row.subjectName, className: row.classCode, lessonPattern: row.periods, weekNumbers: row.weekNumbers.join(",") },
    created_at: "",
    updated_at: "",
    deleted_at: null,
    purge_at: null,
  }));
}
