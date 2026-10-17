import { supabase } from "@/lib/supabase";
import { KeywordError, type KeywordMapping, type KeywordSheet, prepareKeywordRows } from "./import";

type ImportDiagnostic = (stage: string, details: Record<string, number | string>) => void;
export async function previewKeywordImport(productId: number, sheet: KeywordSheet, mapping: KeywordMapping, diagnose?: ImportDiagnostic) {
  const { data: product, error } = await supabase.from("products").select("id").eq("id", productId).maybeSingle();
  if (error) throw new KeywordError("Product 조회에 실패했습니다.", 500);
  if (!product) throw new KeywordError("Product를 찾지 못했습니다.", 404);
  const prepared = prepareKeywordRows(sheet, mapping);
  diagnose?.("rows_prepared", { rows: prepared.rows.length });
  const existing = new Set<string>();
  // Korean keywords expand when URL-encoded. Bound both count and encoded filter length, leaving room for URL/query overhead.
  for (let start = 0, batch = 1; start < prepared.rows.length; batch++) {
    const keywords: string[] = [];
    let encodedLength = 0;
    while (start < prepared.rows.length && keywords.length < 100) {
      const keyword = String(prepared.rows[start].normalized_keyword);
      const length = encodeURIComponent(keyword).length + 6;
      if (keywords.length && encodedLength + length > 5500) break;
      keywords.push(keyword); encodedLength += length; start++;
    }
    diagnose?.("existing_query_start", { batch, keywords: keywords.length, encodedFilterLength: encodedLength });
    const { data, error } = await supabase.from("blog_keywords").select("normalized_keyword").eq("product_id", productId)
      .in("normalized_keyword", keywords);
    if (error) {
      diagnose?.("existing_query_failed", { batch });
      throw new KeywordError("기존 키워드 중복 조회에 실패했습니다.", 500);
    }
    diagnose?.("existing_query_complete", { batch, rows: data?.length ?? 0 });
    for (const row of data ?? []) existing.add(row.normalized_keyword);
  }
  return { prepared, summary: { totalRows: prepared.totalRows, validRows: prepared.validRows, skippedRows: prepared.skippedRows,
    fileDuplicateRows: prepared.fileDuplicateRows, existingRows: prepared.rows.filter(row => existing.has(row.normalized_keyword as string)).length,
    inserts: prepared.rows.length - existing.size, updates: existing.size, invalidMetricCells: prepared.invalidMetricCells, samples: prepared.rows.slice(0, 20) } };
}
export async function importKeywordRows(productId: number, rows: Record<string, unknown>[], source: string | null, filename: string) {
  let imported = 0;
  for (let start = 0; start < rows.length; start += 500) {
    const { error } = await supabase.rpc("import_blog_keywords", { p_product_id: productId, p_rows: rows.slice(start, start + 500).map(row => ({ ...row, source, source_filename: filename })) });
    if (error) throw new KeywordError(`${imported}/${rows.length}개 저장 후 중단했습니다. 상태는 유지됩니다. 같은 파일을 재import할 수 있습니다.`, 500);
    imported += Math.min(500, rows.length - start);
  }
  return imported;
}
