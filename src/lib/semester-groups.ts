export type SemesterGroup = { academicYear: string; semesters: string[] };
export type AcademicPeriodOption = { academicYear: string; semesterName: string };

export function normalizeAcademicYear(value: string) {
  const cleaned = String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
  const match = cleaned.match(/(\d{4})\s*[-\u2010-\u2015\u2212]\s*(\d{4})/);
  return match ? `${match[1]}-${match[2]}` : cleaned;
}

export function uniqueAcademicYears(values: string[]) {
  const years = new Map<string, string>();
  for (const value of values) {
    const year = normalizeAcademicYear(value);
    const identity = year.toLocaleLowerCase("vi-VN");
    if (year && !years.has(identity)) years.set(identity, year);
  }
  return [...years.values()].sort((a, b) => b.localeCompare(a, "vi", { numeric: true, sensitivity: "base" }));
}

export function academicYearFromSemester(value: unknown) {
  const match = String(value ?? "").normalize("NFKC").match(/(\d{4})\s*[-\u2010-\u2015\u2212]\s*(\d{4})/);
  return match ? `${match[1]}-${match[2]}` : "";
}

export function semesterLabelIdentity(value: unknown) {
  const normalized = normalizeLabel(String(value ?? "").normalize("NFKC"))
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\d{4}\s*-\s*\d{4}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const number = normalized.match(/(?:hk|hoc ky|hoc ki)\s*(\d+)/i)?.[1];
  return number ? `hk${Number(number)}` : normalized.replace(/^[\s-]+|[\s-]+$/g, "");
}

export function groupAcademicPeriods(periods: Array<{ academicYear?: unknown; semesterName?: unknown }>): SemesterGroup[] {
  const grouped = new Map<string, { academicYear: string; semesters: Map<string, string> }>();
  for (const period of periods) {
    const rawSemesterName = String(period.semesterName ?? "").replace(/\s+/g, " ").trim();
    if (!rawSemesterName) continue;
    const year = normalizeAcademicYear(String(period.academicYear ?? "")) || academicYearFromSemester(rawSemesterName) || "Khác";
    const semesterName = formatSemesterLabel(rawSemesterName, year === "Khác" ? "" : year);
    const yearKey = year.toLocaleLowerCase("vi-VN");
    const group = grouped.get(yearKey) ?? { academicYear: year, semesters: new Map<string, string>() };
    const semesterKey = semesterIdentity(semesterName);
    if (!group.semesters.has(semesterKey)) group.semesters.set(semesterKey, semesterName);
    grouped.set(yearKey, group);
  }
  return [...grouped.values()]
    .map(({ academicYear, semesters }) => ({ academicYear, semesters: [...semesters.values()] }))
    .sort((left, right) => {
      if (left.academicYear === "Khác") return 1;
      if (right.academicYear === "Khác") return -1;
      return right.academicYear.localeCompare(left.academicYear, "vi", { numeric: true, sensitivity: "base" });
    })
    .map((group) => ({
      ...group,
      semesters: group.semesters.sort((left, right) => left.localeCompare(right, "vi", { numeric: true, sensitivity: "base" })),
    }));
}

export function academicPeriodMatchesYear(semesterName: unknown, academicYear: unknown, selectedYear: string, periods: AcademicPeriodOption[]) {
  const targetYear = normalizeAcademicYear(selectedYear);
  const rowSemester = String(semesterName ?? "").trim();
  const rowYear = normalizeAcademicYear(String(academicYear ?? "")) || academicYearFromSemester(rowSemester);
  if (rowYear) return rowYear === targetYear;
  const rowSemesterKey = semesterLabelIdentity(rowSemester);
  return Boolean(rowSemesterKey && periods.some((period) => normalizeAcademicYear(period.academicYear) === targetYear && semesterLabelIdentity(period.semesterName) === rowSemesterKey));
}

export function semesterMatchesSelection(semesterName: unknown, academicYear: unknown, selectedSemester: string) {
  const rowSemester = String(semesterName ?? "").trim();
  if (semesterLabelIdentity(rowSemester) !== semesterLabelIdentity(selectedSemester)) return false;
  const selectedYear = academicYearFromSemester(selectedSemester);
  if (!selectedYear) return true;
  const rowYear = normalizeAcademicYear(String(academicYear ?? "")) || academicYearFromSemester(rowSemester);
  return !rowYear || rowYear === selectedYear;
}

const normalizeLabel = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/đ/g, "d");

export function normalizeSemesterName(value: string) {
  return formatSemesterLabel(value);
}

export function formatSemesterLabel(value: unknown, academicYear?: unknown) {
  const cleaned = String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!cleaned) return "";
  const normalized = normalizeLabel(cleaned).replace(/[\u2010-\u2015\u2212]/g, "-");
  const semesterNumber = normalized.match(/(?:hk|hoc ky|hoc ki)\s*(\d+)/i)?.[1];
  const suppliedYear = normalizeAcademicYear(String(academicYear ?? ""));
  const year = /^\d{4}-\d{4}$/.test(suppliedYear) ? suppliedYear : academicYearFromSemester(cleaned);
  if (semesterNumber && year) return `HK ${Number(semesterNumber)} NH ${year}`;
  if (semesterNumber) return `HK ${Number(semesterNumber)}`;
  return cleaned;
}

export function semesterIdentity(value: string) {
  const normalized = normalizeLabel(value).replace(/[\u2010-\u2015\u2212]/g, "-");
  const semesterNumber = normalized.match(/(?:hk|hoc ky|hoc ki)\s*(\d+)/i)?.[1];
  const academicYear = normalized.match(/(\d{4})\s*-\s*(\d{4})/);
  return semesterNumber && academicYear
    ? `${academicYear[1]}-${academicYear[2]}:hk${Number(semesterNumber)}`
    : normalizeSemesterName(value).toLocaleLowerCase("vi");
}

function semesterParts(value: string) {
  const normalized = normalizeLabel(value).replace(/[\u2010-\u2015\u2212]/g, "-");
  const year = normalized.match(/(\d{4})\s*-\s*(\d{4})/);
  const number = normalized.match(/(?:hk|hoc ky|hoc ki)\s*(\d+)/i);
  return { yearStart: year ? Number(year[1]) : null, semesterNumber: number ? Number(number[1]) : null };
}

export function groupSemestersByAcademicYear(names: string[]): SemesterGroup[] {
  const grouped = new Map<string, string[]>();
  for (const rawName of [...new Set(names.map((value) => value.trim()).filter(Boolean))]) {
    const year = academicYearFromSemester(rawName) || "Khác";
    const name = formatSemesterLabel(rawName, year === "Khác" ? "" : year);
    const group = grouped.get(year) ?? [];
    if (!group.includes(name)) group.push(name);
    grouped.set(year, group);
  }
  return [...grouped.entries()]
    .sort(([yearA], [yearB]) => {
      if (yearA === "Khác") return 1;
      if (yearB === "Khác") return -1;
      return Number(yearB.slice(0, 4)) - Number(yearA.slice(0, 4));
    })
    .map(([academicYear, semesters]) => ({
      academicYear,
      semesters: semesters.sort((a, b) => {
        const partsA = semesterParts(a);
        const partsB = semesterParts(b);
        if (partsA.semesterNumber !== null && partsB.semesterNumber !== null) return partsA.semesterNumber - partsB.semesterNumber;
        return a.localeCompare(b, "vi", { numeric: true });
      }),
    }));
}
