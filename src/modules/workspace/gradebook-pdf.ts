import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type ParsedGradeRow = Record<string, string | number | null>;

type PdfTextItem = { str: string; transform: number[] };
type PositionedText = { text: string; x: number; y: number };

const normalizeText = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").replace(/\s+/g, " ").trim();
const parseScore = (value: string) => {
  const normalized = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

function getHeader(text: string) {
  const term = text.match(/Đợt\s*:\s*(HK\s*\d+\s*NH\s*\d{4}\s*[-–]\s*\d{4})/i)?.[1]?.replace(/\s+/g, " ").trim();
  const course = text.match(/Lớp học phần\s*:\s*\[?([\w.-]+)\]?\s*[-–]\s*(.+?)\s*\(([^()]*)\)/i);
  const academicYear = text.match(/Năm học\s*:\s*(\d{4}\s*[-–]\s*\d{4})/i)?.[1]?.replace(/\s+/g, "");
  const credits = text.match(/Số tín chỉ\s*:\s*(\d+(?:[,.]\d+)?)/i)?.[1];
  if (!term || !course) throw new Error("Không nhận diện được Đợt hoặc Lớp học phần ở phần đầu PDF.");
  return {
    courseCode: course[1].trim(),
    courseName: course[2].trim(),
    className: course[3].trim(),
    semesterName: term,
    academicYear: academicYear ?? term.match(/\d{4}\s*[-–]\s*(\d{4})/)?.[0]?.replace(/\s+/g, "") ?? "",
    credits: credits ? parseScore(credits) : null,
  };
}

function groupRows(items: PositionedText[]) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PositionedText[][] = [];
  for (const item of sorted) {
    let line = lines.find((candidate) => Math.abs(candidate[0].y - item.y) <= 2.5);
    if (!line) { line = []; lines.push(line); }
    line.push(item);
  }
  return lines.map((line) => line.sort((a, b) => a.x - b.x));
}

function parsePageRows(items: PositionedText[], pageWidth: number, header: ReturnType<typeof getHeader>, pageOrdinal: number) {
  return groupRows(items).flatMap((line) => {
    const codeItem = line.find((item) => /^\d{8,13}$/.test(item.text.trim()));
    if (!codeItem) return [];
    const fraction = (x: number) => x / pageWidth;
    const cell = (min: number, max: number) => line.filter((item) => fraction(item.x) >= min && fraction(item.x) < max).map((item) => item.text.trim()).filter(Boolean).join(" ");
    const score = (min: number, max: number) => {
      const raw = cell(min, max);
      return raw ? parseScore(raw) : null;
    };
    const nameItems = line.filter((item) => fraction(item.x) >= 0.17 && fraction(item.x) < 0.45 && item.text.trim() !== codeItem.text.trim()).sort((a, b) => a.x - b.x);
    const studentMiddleName = nameItems.filter((item) => fraction(item.x) < 0.32).map((item) => item.text.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    const studentGivenName = nameItems.filter((item) => fraction(item.x) >= 0.32).map((item) => item.text.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    const studentName = [studentMiddleName, studentGivenName].filter(Boolean).join(" ");
    const ordinalText = line.find((item) => fraction(item.x) < 0.09)?.text.trim();
    const ordinal = Number(ordinalText);
    const eligibility = cell(0.56, 0.605);
    const absence = cell(0.645, 0.675);
    return [{
      ordinal: Number.isFinite(ordinal) && ordinal > 0 ? ordinal : pageOrdinal,
      studentCode: codeItem.text.trim(),
      studentMiddleName,
      studentGivenName,
      studentName,
      ...header,
      midtermScore: score(0.475, 0.52),
      essayScore: score(0.52, 0.565),
      examEligible: eligibility || null,
      finalExamScore: score(0.59, 0.635),
      absent: absence || null,
      totalScore10: score(0.67, 0.71),
      totalScore4: score(0.71, 0.75),
      letterGrade: cell(0.75, 0.80) || null,
      classification: cell(0.80, 0.875) || null,
      notes: cell(0.875, 0.99) || null,
    } satisfies ParsedGradeRow];
  });
}

export async function extractGradebookPdf(file: File): Promise<ParsedGradeRow[]> {
  if (!file.name.toLocaleLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    throw new Error("Hãy chọn tệp có định dạng PDF.");
  }
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const document = await loadingTask.promise;
  try {
    const pageTexts: Array<{ text: string; items: PositionedText[]; width: number }> = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = (content.items as unknown as PdfTextItem[]).flatMap((item) => {
        const text = item.str?.trim();
        if (!text || !item.transform) return [];
        return [{ text, x: item.transform[4], y: item.transform[5] }];
      });
      pageTexts.push({ text: items.map((item) => item.text).join(" "), items, width: page.getViewport({ scale: 1 }).width });
    }
    const fullText = pageTexts.map((page) => page.text).join(" ");
    if (!normalizeText(fullText).includes("ma so sinh vien") && !/\b\d{8,13}\b/.test(fullText)) {
      throw new Error("PDF không có lớp văn bản để trích xuất. Nếu đây là bản scan, hãy OCR hoặc nhập từ tệp Excel/CSV.");
    }
    const header = getHeader(fullText);
    const rows = pageTexts.flatMap((page, index) => parsePageRows(page.items, page.width, header, index * 1000 + 1));
    if (!rows.length) throw new Error("Không tìm thấy dòng sinh viên trong PDF. Hãy dùng PDF bảng điểm có mã số sinh viên và các cột điểm dạng văn bản.");
    const unique = new Map<string, ParsedGradeRow>();
    for (const row of rows) unique.set(`${row.studentCode}|${row.courseCode}|${row.semesterName}`, row);
    return [...unique.values()].map((row, index) => ({ ...row, ordinal: index + 1 }));
  } finally {
    await loadingTask.destroy();
  }
}
