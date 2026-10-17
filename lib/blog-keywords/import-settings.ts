import { supabase } from "@/lib/supabase";
import { keywordHeaderSignature, parseKeywordMapping, suggestKeywordMapping, KeywordError, type KeywordMapping, type KeywordSheet } from "./import";
import type { KeywordImportRun } from "./shared";

export async function inspectKeywordMapping(sheet: KeywordSheet) {
  const fallback = { mapping: suggestKeywordMapping(sheet), presetApplied: false, sourceLabel: null as string | null };
  try {
    const { data, error } = await supabase.from("blog_keyword_import_presets").select("id,mapping,source_label")
      .eq("header_signature", keywordHeaderSignature(sheet)).maybeSingle();
    if (error) throw error;
    if (!data) return fallback;
    return { mapping: parseKeywordMapping(data.mapping, sheet.columns.length), presetApplied: true, sourceLabel: data.source_label as string | null };
  } catch {
    return { ...fallback, warning: "저장 매핑을 읽지 못해 기본 자동 매핑을 적용했습니다. migration과 연결 상태를 확인하세요." };
  }
}

type ImportSummary = { totalRows: number; validRows: number; skippedRows: number; fileDuplicateRows: number; invalidMetricCells: number };
type ActualImport = { imported: number; inserted: number; updated: number };
export async function recordKeywordImport(productId: number, sheet: KeywordSheet, mapping: KeywordMapping, source: string | null, filename: string, summary: ImportSummary, actual: ActualImport) {
  const warnings: string[] = [];
  let presetId: string | null = null;
  try {
    const { data, error } = await supabase.from("blog_keyword_import_presets").upsert({
      header_signature: keywordHeaderSignature(sheet), mapping, source_label: source, updated_at: new Date().toISOString(),
    }, { onConflict: "header_signature" }).select("id").single();
    if (error || !data) throw error ?? new Error();
    presetId = data.id;
  } catch { warnings.push("키워드는 저장됐지만 매핑 저장에 실패했습니다."); }
  try {
    const { error } = await supabase.from("blog_keyword_import_runs").insert({
      product_id: productId, preset_id: presetId, source, source_filename: filename,
      total_rows: summary.totalRows, valid_rows: summary.validRows, skipped_rows: summary.skippedRows,
      file_duplicate_rows: summary.fileDuplicateRows, invalid_metric_cells: summary.invalidMetricCells,
      inserted_count: actual.inserted, updated_count: actual.updated,
    });
    if (error) throw error;
  } catch { warnings.push("키워드는 저장됐지만 Import 이력 기록에 실패했습니다."); }
  return warnings.length ? warnings.join(" ") : undefined;
}

export async function recentKeywordImports() {
  const { data, error } = await supabase.from("blog_keyword_import_runs")
    .select("id,product_id,preset_id,source,source_filename,total_rows,valid_rows,skipped_rows,file_duplicate_rows,inserted_count,updated_count,invalid_metric_cells,created_at")
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(5).returns<KeywordImportRun[]>();
  if (error) throw new KeywordError("최근 Import 이력을 읽지 못했습니다. migration과 연결 상태를 확인하세요.", 500);
  return data ?? [];
}
