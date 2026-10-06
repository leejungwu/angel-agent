import { parse } from "csv-parse/sync";
import { readSheet } from "read-excel-file/node";

export const MAX_REVIEW_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_REVIEW_ROWS = 10_000;
const aliases = {
  review_date: ["작성일", "리뷰일", "review_date", "date"],
  reviewer_name: ["작성자", "구매자", "reviewer", "reviewer_name"],
  rating: ["별점", "평점", "rating", "score"],
  title: ["제목", "review_title", "title"],
  content: ["내용", "리뷰내용", "리뷰", "content", "review_content"],
  external_id: ["external_id", "review_id", "리뷰번호"],
  source: ["source", "출처"],
} as const;
type Field = keyof typeof aliases;
type Value = string | number | boolean | null;
export type ReviewRow = {
  content: string;
  source: string | null;
  external_id: string | null;
  reviewer_name: string | null;
  title: string | null;
  rating: number | null;
  review_date: string | null;
  metadata: Record<string, Value>;
};
export class ReviewImportValidationError extends Error {}

function cellValue(value: unknown): Value {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  throw new ReviewImportValidationError("지원하지 않는 XLSX 셀 값입니다.");
}

function dateValue(value: string | null): string | null {
  if (!value) return null;
  // Only unambiguous year-first dates; reject rollover dates such as February 30.
  const match = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(.*)$/);
  if (!match) return null;
  const [, year, month, day, suffix] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  const isoDate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  // Dates without a zone are Korean local time; ISO offsets are retained.
  const time = suffix.trim();
  const normalized = time ? `${isoDate}T${time.replace(/^T/, "")}` : `${isoDate}T00:00:00`;
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}+09:00`;
  const date = new Date(zoned);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function parseReviewFile(buffer: Buffer, extension: "csv" | "xlsx") {
  let matrix: Value[][];
  if (extension === "csv") {
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
    catch { text = new TextDecoder("euc-kr", { fatal: true }).decode(buffer); }
    matrix = parse(text, { bom: true, skip_empty_lines: true, to: MAX_REVIEW_ROWS + 2,
      max_record_size: MAX_REVIEW_FILE_SIZE }) as string[][];
  } else {
    // Node Buffer is passed directly; the default worksheet is the first one.
    // Keep original cell strings intact for the existing normalization/metadata.
    const sheet = await readSheet(buffer, { trim: false });
    if (!sheet.length) throw new ReviewImportValidationError("첫 번째 워크시트가 비어 있습니다.");
    if (sheet.length > MAX_REVIEW_ROWS + 1) throw new ReviewImportValidationError("최대 10,000행까지 가져올 수 있습니다.");
    matrix = sheet.map((row) => row.map(cellValue));
  }
  if (!matrix.length) throw new ReviewImportValidationError("헤더가 없는 빈 파일입니다.");
  const [rawHeaders, ...data] = matrix;
  if (data.length > MAX_REVIEW_ROWS) throw new ReviewImportValidationError("최대 10,000행까지 가져올 수 있습니다.");
  const headers = rawHeaders.map((value) => String(value ?? "").trim());
  if (new Set(headers).size !== headers.length || headers.some((header) => !header)) {
    throw new ReviewImportValidationError("헤더는 비어 있거나 중복될 수 없습니다.");
  }
  const fields = headers.map((header) => (Object.keys(aliases) as Field[])
    .find((field) => (aliases[field] as readonly string[]).includes(header.toLowerCase())));
  if (!fields.includes("content")) throw new ReviewImportValidationError("내용/content 컬럼이 필요합니다.");
  const recognized = fields.filter(Boolean);
  if (new Set(recognized).size !== recognized.length) throw new ReviewImportValidationError("같은 필드를 가리키는 헤더가 중복되었습니다.");
  const rows: ReviewRow[] = [];
  let skippedRows = 0;
  for (const values of data) {
    const normalized: Partial<Record<Field, string | null>> = {};
    const metadata: Record<string, Value> = Object.create(null);
    headers.forEach((header, index) => {
      const value = values[index] ?? null;
      const field = fields[index];
      if (field) normalized[field] = String(value ?? "").trim() || null;
      else metadata[header] = value;
    });
    if (!normalized.content) { skippedRows++; continue; }
    const rating = normalized.rating ? Number(normalized.rating) : NaN;
    rows.push({ content: normalized.content, source: normalized.source ?? null,
      external_id: normalized.external_id ?? null, reviewer_name: normalized.reviewer_name ?? null,
      title: normalized.title ?? null, rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
      review_date: dateValue(normalized.review_date ?? null), metadata });
  }
  return { rows, totalRows: data.length, skippedRows };
}
