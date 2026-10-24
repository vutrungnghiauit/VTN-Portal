import { useEffect, useState } from "react";
import { academicYearFromSemester, formatSemesterLabel, normalizeAcademicYear } from "./semester-groups";
import { workspaceService } from "../modules/workspace/workspace.service";

export type CurrentAcademicPeriod = { academicYear: string; semesterName: string };

const selectionKey = (scope: string) => `vtn-academic-period-selected-by-user:${scope}`;

export function hasUserSelectedAcademicPeriod(scope = "global") {
  return sessionStorage.getItem(selectionKey(scope)) === "true";
}

export function markAcademicPeriodSelectedByUser(scope = "global") {
  sessionStorage.setItem(selectionKey(scope), "true");
}

export function resetAcademicPeriodSelection(scope = "global") {
  sessionStorage.removeItem(selectionKey(scope));
}

function todayInVietnam() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
}

function periodFromRows(rows: Awaited<ReturnType<typeof workspaceService.list>>, today: string): CurrentAcademicPeriod | null {
  const periods = rows.map((row) => {
    const title = String(row.data.title ?? row.data.semesterName ?? "").trim();
    const academicYear = normalizeAcademicYear(String(row.data.academicYear ?? "")) || academicYearFromSemester(title);
    return {
      academicYear,
      semesterName: formatSemesterLabel(title, academicYear),
      startDate: String(row.data.startDate ?? "").slice(0, 10),
      endDate: String(row.data.endDate ?? "").slice(0, 10),
      isCurrent: ["có", "true", "1", "yes"].includes(String(row.data.current ?? "").trim().toLocaleLowerCase("vi-VN")),
    };
  }).filter((period) => period.semesterName);

  const datedPeriods = periods.filter((period) => period.startDate && period.endDate);
  const current = datedPeriods.filter((period) => period.startDate <= today && period.endDate >= today)
    .sort((left, right) => right.startDate.localeCompare(left.startDate))[0]
    ?? periods.find((period) => period.isCurrent);
  return current ? { academicYear: current.academicYear, semesterName: current.semesterName } : null;
}

export function useCurrentAcademicPeriod() {
  const [period, setPeriod] = useState<CurrentAcademicPeriod | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const rows = await workspaceService.list("semesters");
        if (active) setPeriod(periodFromRows(rows, todayInVietnam()));
      } catch {
        if (active) setPeriod(null);
      }
    };
    void refresh();
    window.addEventListener("vtn-semester-list-updated", refresh);
    return () => {
      active = false;
      window.removeEventListener("vtn-semester-list-updated", refresh);
    };
  }, []);
  return period;
}
