import type { TableSortState } from "../components/SortableTableHeader";

function dateValue(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const dmy = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])).getTime();
  if (!/^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(text)) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (/^[-+]?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(text)) {
    const parsed = Number(text.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (/^[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text)) {
    const parsed = Number(text.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (!/^[-+]?\d+(?:[.,]\d+)?$/.test(text)) return null;
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  const leftDate = dateValue(left);
  const rightDate = dateValue(right);
  if (leftDate !== null && rightDate !== null) return leftDate - rightDate;
  const leftNumber = numericValue(left);
  const rightNumber = numericValue(right);
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  return String(left ?? "").localeCompare(String(right ?? ""), "vi", { numeric: true, sensitivity: "base" });
}

export function sortTableRows<T>(rows: readonly T[], state: TableSortState, getValue: (row: T, key: string, index: number) => unknown): T[] {
  return rows.map((row, index) => ({ row, index, value: getValue(row, state.key, index) }))
    .sort((left, right) => {
      const leftEmpty = left.value === null || left.value === undefined || left.value === "";
      const rightEmpty = right.value === null || right.value === undefined || right.value === "";
      if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
      const compared = compareValues(left.value, right.value);
      return (state.direction === "asc" ? compared : -compared) || left.index - right.index;
    })
    .map(({ row }) => row);
}
