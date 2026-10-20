export type SemesterGroup = { academicYear: string; semesters: string[] };

const normalizeLabel = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/đ/g, "d");

export function normalizeSemesterName(value: string) {
  const cleaned = String(value ?? "").trim().replace(/\s+/g, " ");
  const normalized = normalizeLabel(cleaned).replace(/[\u2013\u2014\u2212]/g, "-");
  const semesterNumber = normalized.match(/(?:hk|hoc ky|hoc ki)\s*(\d+)/i)?.[1];
  const academicYear = normalized.match(/(\d{4})\s*-\s*(\d{4})/);
  if (semesterNumber && academicYear) return `Học kỳ ${Number(semesterNumber)} - ${academicYear[1]}–${academicYear[2]}`;
  return cleaned;
}

export function semesterIdentity(value: string) {
  const normalized = normalizeLabel(value).replace(/[\u2013\u2014\u2212]/g, "-");
  const semesterNumber = normalized.match(/(?:hk|hoc ky|hoc ki)\s*(\d+)/i)?.[1];
  const academicYear = normalized.match(/(\d{4})\s*-\s*(\d{4})/);
  return semesterNumber && academicYear
    ? `${academicYear[1]}-${academicYear[2]}:hk${Number(semesterNumber)}`
    : normalizeSemesterName(value).toLocaleLowerCase("vi");
}

function semesterParts(value: string) {
  const year = value.match(/(\d{4})\s*[-–]\s*(\d{4})/);
  const number = value.match(/(?:HK|Học kỳ|Học kì)\s*(\d+)/i);
  return { yearStart: year ? Number(year[1]) : null, semesterNumber: number ? Number(number[1]) : null };
}

export function groupSemestersByAcademicYear(names: string[]): SemesterGroup[] {
  const grouped = new Map<string, string[]>();
  for (const name of [...new Set(names.map((value) => value.trim()).filter(Boolean))]) {
    const year = name.match(/\d{4}\s*[-–]\s*\d{4}/)?.[0].replace(/\s/g, "") ?? "Khác";
    const group = grouped.get(year) ?? [];
    group.push(name);
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
