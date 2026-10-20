import * as XLSX from "xlsx";
import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type ImportedSurveyQuestion = {
  id: string;
  text: string;
  type: "likert" | "text";
  required: boolean;
  responseCount: number;
  answers: Array<{ value: string; count: number }>;
};

export type SurveyImportDraft = {
  fileName: string;
  responseCount: number;
  questions: ImportedSurveyQuestion[];
};

type Accumulator = { text: string; answers: Map<string, number>; responseCount: number };
const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const normalize = (value: unknown) => clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLocaleLowerCase("vi-VN");
const questionHeaders = ["cau hoi", "noi dung cau hoi", "question", "question text", "prompt", "statement", "item"];
const answerHeaders = ["cau tra loi", "tra loi", "phan hoi", "y kien", "dap an", "phan bo cau tra loi", "answer", "answers", "answer text", "answer choice", "response", "response text", "lua chon", "phuong an", "option"];
const countHeaders = ["so luong", "luot chon", "so phan hoi", "response count", "count", "frequency", "total"];
const metadataHeaders = ["timestamp", "thoi gian", "email", "ho ten", "ma sv", "mssv", "student id", "student code", "lop sinh hoat", "response id", "start date", "end date", "submit date", "nguoi tra loi", "ten sinh vien"];

function findHeader(headers: string[], aliases: string[]) {
  return headers.findIndex((header) => aliases.some((alias) => header === alias || header.startsWith(`${alias} `)));
}

function addAnswer(accumulator: Accumulator, answer: unknown, count = 1) {
  const value = clean(answer);
  if (!value || (Number.isFinite(count) && count <= 0)) return;
  const key = value.slice(0, 300);
  const amount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;
  accumulator.answers.set(key, (accumulator.answers.get(key) ?? 0) + amount);
  accumulator.responseCount += amount;
}

function createAccumulator(text: string): Accumulator {
  return { text: clean(text), answers: new Map(), responseCount: 0 };
}

function typeForAnswers(values: string[]): "likert" | "text" {
  if (!values.length) return "likert";
  const likertWords = /^(?:[1-5](?:\s*[-–.:]\s*.+)?|hoàn toàn không đồng ý|rất không đồng ý|không đồng ý|bình thường|trung lập|đồng ý|rất đồng ý|hoàn toàn đồng ý|rất hài lòng|không hài lòng|hài lòng|rất kém|kém|trung bình|tốt|rất tốt)$/i;
  return values.every((value) => likertWords.test(value.trim())) ? "likert" : "text";
}

function finalize(accumulators: Accumulator[], fileName: string): SurveyImportDraft {
  const seen = new Map<string, Accumulator>();
  for (const item of accumulators) {
    const text = item.text.replace(/^[\d\s.)-]+/, "").trim();
    const key = normalize(text);
    if (key.length < 4) continue;
    const current = seen.get(key);
    if (!current) { seen.set(key, { ...item, text }); continue; }
    for (const [answer, count] of item.answers) current.answers.set(answer, (current.answers.get(answer) ?? 0) + count);
    current.responseCount += item.responseCount;
  }
  const questions = [...seen.values()].map((item) => {
    const answers = [...item.answers.entries()].sort((left, right) => right[1] - left[1]).slice(0, 8).map(([value, count]) => ({ value, count }));
    return {
      id: crypto.randomUUID(), text: item.text.slice(0, 500), type: typeForAnswers([...item.answers.keys()]), required: true,
      responseCount: item.responseCount, answers,
    } satisfies ImportedSurveyQuestion;
  });
  return { fileName, responseCount: questions.reduce((sum, question) => sum + question.responseCount, 0), questions };
}

function extractStructuredRows(matrix: unknown[][]): Accumulator[] {
  const candidates = matrix.slice(0, 20).map((row, index) => ({ index, headers: row.map(normalize) }));
  const accumulators: Accumulator[] = [];
  for (const { index, headers } of candidates) {
    const questionColumn = findHeader(headers, questionHeaders);
    const answerColumn = findHeader(headers, answerHeaders);
    const countColumn = findHeader(headers, countHeaders);
    if (questionColumn < 0 || answerColumn < 0 || questionColumn === answerColumn) continue;
    const byQuestion = new Map<string, Accumulator>();
    for (const row of matrix.slice(index + 1)) {
      const question = clean(row[questionColumn]);
      const answer = clean(row[answerColumn]);
      if (!question || !answer) continue;
      const key = normalize(question);
      let accumulator = byQuestion.get(key);
      if (!accumulator) { accumulator = createAccumulator(question); byQuestion.set(key, accumulator); }
      const count = countColumn >= 0 ? Number(String(row[countColumn] ?? "").replace(/[^\d.-]/g, "")) : 1;
      addAnswer(accumulator, answer, Number.isFinite(count) && count > 0 ? count : 1);
    }
    if (byQuestion.size) return [...byQuestion.values()];
  }

  // Some exports contain a question per row and one column per Likert answer.
  for (const { index, headers } of candidates) {
    const questionColumn = findHeader(headers, questionHeaders);
    if (questionColumn < 0) continue;
    const answerColumns = headers.map((header, column) => ({ header, column })).filter(({ header, column }) => column !== questionColumn && /^(?:[1-5](?: sao)?|rat khong dong y|khong dong y|binh thuong|trung lap|dong y|rat dong y|rat hai long|hai long)$/.test(header));
    if (!answerColumns.length) continue;
    const result: Accumulator[] = [];
    for (const row of matrix.slice(index + 1)) {
      const question = clean(row[questionColumn]);
      if (!question) continue;
      const accumulator = createAccumulator(question);
      for (const { header, column } of answerColumns) addAnswer(accumulator, header, Number(String(row[column] ?? "").replace(/[^\d.-]/g, "")) || 0);
      if (accumulator.responseCount) result.push(accumulator);
    }
    if (result.length) return result;
  }
  return accumulators;
}

function extractQuestionColumns(matrix: unknown[][]): Accumulator[] {
  const candidates = matrix.slice(0, Math.min(15, matrix.length)).map((row, index) => {
    const headers = row.map(clean);
    const questionColumns = headers.map((header, column) => ({ header, column, normalized: normalize(header) })).filter(({ header, normalized }) => {
      if (!header || normalized.length < 4 || metadataHeaders.some((alias) => normalized === alias || normalized.startsWith(`${alias} `))) return false;
      if (/^(?:cau|question|q)\s*\d+$/.test(normalized)) return true;
      return header.length >= 8 || /[?？]/.test(header);
    });
    return { index, headers, questionColumns };
  }).sort((left, right) => right.questionColumns.length - left.questionColumns.length);
  const best = candidates[0];
  if (!best?.questionColumns.length) return [];
  return best.questionColumns.map(({ header, column }) => {
    const accumulator = createAccumulator(header);
    for (const row of matrix.slice(best.index + 1)) addAnswer(accumulator, row[column]);
    return accumulator;
  }).filter((item) => item.text && (item.responseCount > 0 || best.index === 0));
}

function extractFromMatrix(matrix: unknown[][]) {
  const structured = extractStructuredRows(matrix);
  return structured.length ? structured : extractQuestionColumns(matrix);
}

function parseText(text: string): Accumulator[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const result: Accumulator[] = [];
  let active: Accumulator | null = null;
  const questionPattern = /^(?:(?:câu|cau)\s*(?:hỏi\s*)?\d{0,3}|(?:question|q)\s*\d{1,3})\s*[.):：\-–—]?\s*(.+)$/i;
  const numberedPattern = /^\d{1,3}[.)]\s+(.+)$/;
  for (const line of lines) {
    const questionMatch = line.match(questionPattern) ?? line.match(numberedPattern);
    if (questionMatch && questionMatch[1].trim().length >= 4) {
      const rest = questionMatch[1].trim();
      const split = rest.match(/^(.{6,}?)[\t|]\s*(.+)$/);
      active = createAccumulator(split?.[1] ?? rest);
      result.push(active);
      if (split?.[2]) addAnswer(active, split[2]);
      continue;
    }
    const explicitPair = line.match(/^(.{8,}?)[\t|]\s*(.+)$/);
    if (!active && explicitPair) {
      active = createAccumulator(explicitPair[1]); result.push(active); addAnswer(active, explicitPair[2]); continue;
    }
    if (active) {
      const labeledAnswer = line.match(/^(?:câu trả lời|trả lời|đáp án|phản hồi|answer|response)\s*[:：]\s*(.+)$/i);
      if (labeledAnswer) { addAnswer(active, labeledAnswer[1]); continue; }
      const answer = line.match(/^(?:[-*•]\s*)?(.{1,180}?)\s*[:：|]\s*(\d{1,6})(?:\s*(?:lượt|phản hồi|câu trả lời))?$/i);
      if (answer) { addAnswer(active, answer[1], Number(answer[2])); continue; }
      const numberedAnswer = line.match(/^[1-5]\s*[-.)]\s*(.{2,180})$/);
      if (numberedAnswer) { addAnswer(active, numberedAnswer[1]); continue; }
      const frequency = line.match(/^(.{2,140}?)\s+(\d{1,6})$/);
      if (frequency) { addAnswer(active, frequency[1], Number(frequency[2])); continue; }
      if (/^[-*•]\s+/.test(line)) { addAnswer(active, line.replace(/^[-*•]\s+/, "")); continue; }
    }
    if (/[?？]$/.test(line) && line.length >= 10 && line.length <= 500) {
      active = createAccumulator(line); result.push(active);
    }
  }
  return result;
}

function parseJsonResults(value: unknown): Accumulator[] {
  const results: Accumulator[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const entries = Object.entries(record);
    const questionEntry = entries.find(([key]) => questionHeaders.some((alias) => normalize(key) === alias || normalize(key).startsWith(`${alias} `)));
    const answerEntry = entries.find(([key]) => answerHeaders.some((alias) => normalize(key) === alias || normalize(key).startsWith(`${alias} `)));
    if (questionEntry && answerEntry) {
      const accumulator = createAccumulator(String(questionEntry[1] ?? ""));
      const answerValue = answerEntry[1];
      if (Array.isArray(answerValue)) answerValue.forEach((answer) => addAnswer(accumulator, typeof answer === "object" && answer ? (answer as Record<string, unknown>).value ?? (answer as Record<string, unknown>).answer : answer));
      else if (answerValue && typeof answerValue === "object") Object.entries(answerValue as Record<string, unknown>).forEach(([answer, count]) => addAnswer(accumulator, answer, Number(count)));
      else addAnswer(accumulator, answerValue);
      if (accumulator.text) results.push(accumulator);
      return;
    }
    // Some exports represent each survey item as a key whose value is a response list.
    for (const [key, item] of entries) {
      const normalizedKey = normalize(key);
      if (metadataHeaders.some((header) => normalizedKey === header || normalizedKey.startsWith(`${header} `))) continue;
      if (item && (normalizedKey.length >= 8 || /[?？]/.test(key)) && (Array.isArray(item) || typeof item === "object")) {
        const accumulator = createAccumulator(key);
        if (Array.isArray(item)) item.forEach((answer) => addAnswer(accumulator, answer));
        else Object.entries(item as Record<string, unknown>).forEach(([answer, count]) => addAnswer(accumulator, answer, Number(count)));
        if (accumulator.text) results.push(accumulator);
      } else visit(item);
    }
  };
  visit(value);
  return results;
}

function decodeEntities(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code))).replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

async function unzipOfficeText(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: string[] = [];
  const targets = /(?:word\/document\.xml|ppt\/slides\/slide\d+\.xml|content\.xml)$/i;
  for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (offset + 46 + nameLength + extraLength + commentLength > bytes.length) break;
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (targets.test(name) && !(flags & 1) && localOffset + 30 <= bytes.length) {
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(start, start + compressedSize);
      let xml: Uint8Array;
      if (method === 0) xml = compressed;
      else if (method === 8 && typeof DecompressionStream !== "undefined") {
        const stream = new Blob([compressed.buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        xml = new Uint8Array(await new Response(stream).arrayBuffer());
      } else { offset += 46 + nameLength + extraLength + commentLength - 1; continue; }
      const source = new TextDecoder().decode(xml).replace(/<(?:w|a|text):(?:tab|line-break)\s*\/?\s*>/g, "\t").replace(/<w:br\s*\/?\s*>|<a:br\s*\/?\s*>|<\/(?:w|a|text):p>/g, "\n").replace(/<[^>]+>/g, " ");
      entries.push(decodeEntities(source));
    }
    offset += 46 + nameLength + extraLength + commentLength - 1;
  }
  return entries.join("\n");
}

async function readPdf(file: File) {
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const document = await task.promise;
  try {
    const pageTexts: string[] = [];
    const canvases: HTMLCanvasElement[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const positioned = content.items.flatMap((item) => {
        if (!("str" in item) || !("transform" in item) || !item.str.trim()) return [];
        const transform = item.transform as number[];
        return [{ text: item.str.trim(), x: transform[4], y: transform[5] }];
      });
      const lines = new Map<number, Array<{ text: string; x: number }>>();
      for (const item of positioned) {
        const key = Math.round(item.y / 3) * 3;
        lines.set(key, [...(lines.get(key) ?? []), { text: item.text, x: item.x }]);
      }
      const text = [...lines.entries()].sort((left, right) => right[0] - left[0]).map(([, line]) => line.sort((left, right) => left.x - right.x).map((item) => item.text).join(" ")).join("\n");
      pageTexts.push(text);
      if (text.trim().length < 15) {
        const viewport = page.getViewport({ scale: 2 });
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        if (context) { await page.render({ canvas, canvasContext: context, viewport }).promise; canvases.push(canvas); }
      }
    }
    let extracted = parseText(pageTexts.join("\n"));
    if (!extracted.length || canvases.length > 0) {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker(["vie", "eng"]);
      try {
        const ocrText: string[] = [];
        for (const canvas of canvases) ocrText.push((await worker.recognize(canvas)).data.text);
        if (!ocrText.length && !extracted.length) {
          for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
            const page = await document.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 2 });
            const canvas = window.document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
            const context = canvas.getContext("2d");
            if (!context) continue;
            await page.render({ canvas, canvasContext: context, viewport }).promise;
            ocrText.push((await worker.recognize(canvas)).data.text);
          }
        }
        extracted = [...extracted, ...parseText(ocrText.join("\n"))];
      } finally { await worker.terminate(); }
    }
    return extracted;
  } finally { await task.destroy(); }
}

async function readImage(file: File) {
  let image: CanvasImageSource;
  let width: number;
  let height: number;
  let release = () => {};
  try {
    const bitmap = await createImageBitmap(file);
    image = bitmap; width = bitmap.width; height = bitmap.height; release = () => bitmap.close();
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const element = await new Promise<HTMLImageElement>((resolve, reject) => {
        const candidate = new Image(); candidate.onload = () => resolve(candidate); candidate.onerror = () => reject(new Error("Không giải mã được ảnh.")); candidate.src = url;
      });
      image = element; width = element.naturalWidth; height = element.naturalHeight; release = () => URL.revokeObjectURL(url);
    } catch { URL.revokeObjectURL(url); throw new Error("Trình duyệt không đọc được định dạng ảnh này."); }
  }
  try {
    const scale = Math.min(2, 2600 / width);
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Không thể xử lý ảnh trong trình duyệt này.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker(["vie", "eng"]);
    try { return parseText((await worker.recognize(canvas)).data.text); }
    finally { await worker.terminate(); }
  } finally { release(); }
}

function isImageFile(file: File) {
  return file.type.startsWith("image/") || /\.(?:png|jpe?g|gif|bmp|webp|tiff?|avif|heic|heif)$/i.test(file.name);
}

export async function extractSurveyResults(file: File): Promise<SurveyImportDraft> {
  let accumulators: Accumulator[] = [];
  const extension = file.name.split(".").pop()?.toLocaleLowerCase("en-US") ?? "";
  if (extension === "pdf" || file.type === "application/pdf") {
    accumulators = await readPdf(file);
  } else if (isImageFile(file)) {
    accumulators = await readImage(file);
  } else if (["xlsx", "xls", "xlsm", "xlsb", "ods", "csv", "tsv"].includes(extension) || /spreadsheet|excel|csv|tab-separated/.test(file.type)) {
    const workbook = XLSX.read(["csv", "tsv"].includes(extension) || file.type.startsWith("text/") ? await file.text() : await file.arrayBuffer(), { type: ["csv", "tsv"].includes(extension) || file.type.startsWith("text/") ? "string" : "array", raw: false, cellDates: true });
    accumulators = workbook.SheetNames.flatMap((name) => extractFromMatrix(XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: "", raw: false })));
  } else if (["docx", "pptx", "odt", "odp"].includes(extension)) {
    accumulators = parseText(await unzipOfficeText(file));
  } else {
    let text = "";
    try { text = await file.text(); } catch { /* Binary files still get an extraction attempt below. */ }
    const readable = text.replace(/[\u0000-\u0008\u000e-\u001f]/g, " ");
    const printable = readable.length ? (readable.match(/[\p{L}\p{N}\s.,;:!?()[\]{}%#@/+\-]/gu) ?? []).length / readable.length : 0;
    if (extension === "json" && printable > 0.5) {
      try { accumulators = parseJsonResults(JSON.parse(readable) as unknown); } catch { /* Continue with readable text extraction. */ }
    }
    if (!accumulators.length && printable > 0.72) {
      const normalizedText = readable
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<\/(?:p|tr|li|h[1-6]|div|br|td|th)>/gi, "\n").replace(/<[^>]+>/g, " ")
        .replace(/\\'[\da-f]{2}/gi, " ").replace(/\\[a-z]+-?\d* ?/gi, " ").replace(/[{}]/g, " ");
      accumulators = parseText(decodeEntities(normalizedText));
    }
    if (!accumulators.length && file.size) {
      try {
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", raw: false, cellDates: true });
        accumulators = workbook.SheetNames.flatMap((name) => extractFromMatrix(XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: "", raw: false })));
      } catch { /* Unsupported binary formats still remain archived by the caller. */ }
    }
    if (!accumulators.length && /\u0000/.test(text)) {
      try { accumulators = parseText(await unzipOfficeText(file)); } catch { /* Not an Office Open XML file. */ }
    }
    if (!accumulators.length && file.size) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const runs: string[] = [];
      let ascii = "";
      let unicode = "";
      for (let index = 0; index < bytes.length; index += 1) {
        const byte = bytes[index];
        ascii = byte >= 32 && byte < 127 ? ascii + String.fromCharCode(byte) : (ascii.length >= 8 ? (runs.push(ascii), "") : "");
        if (index + 1 < bytes.length && bytes[index + 1] === 0 && byte >= 32 && byte < 127) unicode += String.fromCharCode(byte);
        else if (unicode.length >= 8) { runs.push(unicode); unicode = ""; }
      }
      if (ascii.length >= 8) runs.push(ascii);
      if (unicode.length >= 8) runs.push(unicode);
      accumulators = parseText(runs.join("\n"));
    }
  }
  return finalize(accumulators, file.name);
}
