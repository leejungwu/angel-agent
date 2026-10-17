export const KEYWORD_FIELDS = {
  keyword: "키워드", search_volume: "총 검색량", pc_search_volume: "PC 검색량", mobile_search_volume: "모바일 검색량",
  pc_clicks: "PC 클릭", mobile_clicks: "모바일 클릭", pc_ctr: "PC CTR", mobile_ctr: "모바일 CTR", competition: "경쟁도",
};
export type KeywordField = keyof typeof KEYWORD_FIELDS;
export type KeywordMapping = Partial<Record<KeywordField, number>>;
export type KeywordColumn = { index: number; header: string; label: string; samples: string[] };
export type KeywordSheet = { columns: KeywordColumn[]; rows: (string | number | null)[][] };
export const KEYWORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class KeywordError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function normalizeKeyword(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/[ \t\r\n\f\v]+/g, " ").replace(/^ +| +$/g, "").toLowerCase();
}
export function recommendationTaskUrl(productId: string | number, item: { keywordId: string; keyword: string; suggestedTopic: string }) {
  return `/content/blog/new?${new URLSearchParams({ productId: String(productId), blogKeywordId: item.keywordId, keyword: item.keyword, topic: item.suggestedTopic })}`;
}
export type KeywordImportRun = {
  id: string; product_id: number | null; preset_id: string | null; source: string | null; source_filename: string;
  total_rows: number; valid_rows: number; skipped_rows: number; file_duplicate_rows: number;
  inserted_count: number; updated_count: number; invalid_metric_cells: number; created_at: string;
};
export const KEYWORD_IMPORT_PREFERENCE = "blog-keyword-import-preference-v1";
export function keywordImportPreference(raw: string | null, products: { id: string | number }[]) {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      return { productId: typeof record.productId === "string" && products.some(product => String(product.id) === record.productId) ? record.productId : "",
        source: typeof record.source === "string" ? record.source.slice(0, 200) : "" };
    }
  } catch { /* Invalid browser preferences are ignored. */ }
  return { productId: "", source: "" };
}
