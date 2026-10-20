import type { ReactNode } from "react";
import "./sortable-table-header.css";

export type TableSortState = { key: string; direction: "asc" | "desc" };

type SortableTableHeaderProps = {
  label: ReactNode;
  sortKey: string;
  sortState: TableSortState;
  onSort: (key: string) => void;
  className?: string;
  rowSpan?: number;
  colSpan?: number;
};

export function SortableTableHeader({ label, sortKey, sortState, onSort, className, rowSpan, colSpan }: SortableTableHeaderProps) {
  const active = sortState.key === sortKey;
  const nextDirection = active && sortState.direction === "asc" ? "desc" : "asc";
  return <th className={className} rowSpan={rowSpan} colSpan={colSpan} aria-sort={active ? sortState.direction === "asc" ? "ascending" : "descending" : "none"}>
    <button type="button" className="table-sort-header" title={`Sắp xếp ${label} ${nextDirection === "asc" ? "A–Z" : "Z–A"}`} onClick={() => onSort(sortKey)}>
      {label}<span aria-hidden="true">{active ? sortState.direction === "asc" ? "↑" : "↓" : "↕"}</span>
    </button>
  </th>;
}

