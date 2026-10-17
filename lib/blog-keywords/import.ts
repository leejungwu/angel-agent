import { parse } from "csv-parse/sync";
import { readSheet } from "read-excel-file/node";
import { createHash } from "node:crypto";

import { KEYWORD_FIELDS, KeywordError, normalizeKeyword, type KeywordField, type KeywordMapping, type KeywordSheet } from "./shared";
export { KeywordError } from "./shared";
export type { KeywordMapping, KeywordSheet } from "./shared";
export const MAX_KEYWORD_FILE_SIZE = 10 * 1024 * 1024;
function columnName(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : columnName(Math.floor(index / 26) - 1) + columnName(index % 26);
}
export function keywordSheet(matrix: unknown[][]): KeywordSheet {
  if (matrix.length < 2 || matrix.length > 10001) throw new KeywordError("헤더와 데이터가 필요합니다. 최대 10,000행입니다.");
  const width = Math.max(...matrix.map(row => row.length));
  if (!width || width > 100) throw new KeywordError("최대 100열까지 지원합니다.");
  const cell = (value: unknown) => value == null ? null : value instanceof Date ? value.toISOString() : typeof value === "number" ? value : String(value);
  const rows = matrix.slice(1).map(row => Array.from({ length: width }, (_, i) => cell(row[i])));
  return { columns: Array.from({ length: width }, (_, index) => ({ index, header: String(matrix[0][index] ?? "").trim(),
    label: `열 ${columnName(index)}${matrix[0][index] ? ` · ${String(matrix[0][index]).trim()}` : " (헤더 없음)"}`,
    samples: rows.map(row => row[index]).filter(value => value != null && String(value).trim()).slice(0, 3).map(String),
  })), rows };
}
export function keywordHeaderSignature(sheet: KeywordSheet) {
  return createHash("sha256").update(JSON.stringify(["v1", sheet.columns.map(column => [column.index, column.header])])).digest("hex");
}
export async function parseKeywordFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!["xlsx", "csv"].includes(extension ?? "") || !file.size || file.size > MAX_KEYWORD_FILE_SIZE) throw new KeywordError("10MB 이하 XLSX 또는 CSV 파일을 선택하세요.");
  const buffer = Buffer.from(await file.arrayBuffer());
  let matrix: unknown[][];
  try {
    if (extension === "xlsx") matrix = await readSheet(buffer, { trim: false });
    else {
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
      catch { text = new TextDecoder("euc-kr", { fatal: true }).decode(buffer); }
      matrix = parse(text, { bom: true, relax_column_count: true, skip_empty_lines: false, to: 10002, max_record_size: MAX_KEYWORD_FILE_SIZE });
    }
  } catch { throw new KeywordError("파일을 읽지 못했습니다. CSV 인코딩 또는 XLSX 형식을 확인하세요."); }
  return keywordSheet(matrix);
}
const aliases: Record<KeywordField, string[]> = {
  keyword: ["키워드", "keyword"], search_volume: ["월간총검색량", "총검색량", "검색수합계", "search_volume"],
  pc_search_volume: ["월간pc검색량", "월간검색수pc", "pc검색량", "pc_search_volume"], mobile_search_volume: ["월간모바일검색량", "월간검색수모바일", "모바일검색량", "mobile_search_volume"],
  pc_clicks: ["월평균클릭수pc", "pc클릭", "pc_clicks"], mobile_clicks: ["월평균클릭수모바일", "모바일클릭", "mobile_clicks"],
  pc_ctr: ["월평균클릭률pc", "pc클릭률", "pc_ctr"], mobile_ctr: ["월평균클릭률모바일", "모바일클릭률", "mobile_ctr"],
  competition: ["경쟁정도", "경쟁도", "competition"],
};
export function suggestKeywordMapping(sheet: KeywordSheet): KeywordMapping {
  const clean = (value: string) => value.toLowerCase().replace(/[\s()\[\]]/g, "");
  const mapping: KeywordMapping = {};
  for (const [field, names] of Object.entries(aliases)) {
    const matches = sheet.columns.filter(column => names.some(name => clean(column.label.split(" · ").slice(1).join(" · ")) === clean(name)));
    if (matches.length === 1) mapping[field as KeywordField] = matches[0].index;
  }
  return mapping;
}
export function parseKeywordMapping(value: unknown, width: number): KeywordMapping {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new KeywordError("열 매핑을 확인하세요.");
  // Old presets and open browser tabs can still contain the retired metric.
  const mapping = Object.fromEntries(Object.entries(value).filter(([field]) => field !== "ad_count")) as KeywordMapping;
  if (mapping.keyword === undefined) throw new KeywordError("키워드 열을 선택하세요.");
  const indexes = Object.values(mapping);
  if (Object.keys(mapping).some(key => !Object.hasOwn(KEYWORD_FIELDS, key)) || indexes.some(index => !Number.isInteger(index) || index < 0 || index >= width) || new Set(indexes).size !== indexes.length) throw new KeywordError("열은 중복 없이 유효한 열에 연결하세요.");
  return mapping;
}
export function keywordNumber(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim().replace(/,/g, "").replace(/%$/, "");
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) && number <= Number.MAX_SAFE_INTEGER ? number : null;
}
export function prepareKeywordRows(sheet: KeywordSheet, mapping: KeywordMapping) {
  const unique = new Map<string, Record<string, unknown>>();
  let validRows = 0, skippedRows = 0, invalidMetricCells = 0;
  for (const row of sheet.rows) {
    const keyword = String(row[mapping.keyword!] ?? "").trim();
    if (!normalizeKeyword(keyword) || keyword.length > 500) { skippedRows++; continue; }
    validRows++;
    const result: Record<string, unknown> = { keyword, normalized_keyword: normalizeKeyword(keyword), raw_data: Object.fromEntries(sheet.columns.map(column => [column.label, row[column.index]])) };
    for (const [field, index] of Object.entries(mapping)) {
      if (field === "keyword") continue;
      if (field === "competition") result[field] = String(row[index!] ?? "").trim() || null;
      else {
        result[field] = keywordNumber(row[index!]);
        if (result[field] === null && String(row[index!] ?? "").trim()) invalidMetricCells++;
      }
    }
    unique.set(result.normalized_keyword as string, result);
  }
  return { rows: [...unique.values()], totalRows: sheet.rows.length, validRows, skippedRows, fileDuplicateRows: validRows - unique.size, invalidMetricCells };
}
