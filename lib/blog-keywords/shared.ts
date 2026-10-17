export const KEYWORD_FIELDS = {
  keyword: "키워드", search_volume: "총 검색량", pc_search_volume: "PC 검색량", mobile_search_volume: "모바일 검색량",
  pc_clicks: "PC 클릭", mobile_clicks: "모바일 클릭", pc_ctr: "PC CTR", mobile_ctr: "모바일 CTR", competition: "경쟁도", ad_count: "광고수",
};
export type KeywordField = keyof typeof KEYWORD_FIELDS;
export type KeywordMapping = Partial<Record<KeywordField, number>>;
export type KeywordColumn = { index: number; label: string; samples: string[] };
export type KeywordSheet = { columns: KeywordColumn[]; rows: (string | number | null)[][] };
export const KEYWORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class KeywordError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function normalizeKeyword(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/[ \t\r\n\f\v]+/g, " ").replace(/^ +| +$/g, "").toLowerCase();
}
