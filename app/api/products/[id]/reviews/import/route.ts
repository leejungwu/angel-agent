import { supabase } from "@/lib/supabase";
import { MAX_REVIEW_FILE_SIZE, parseReviewFile, ReviewImportValidationError, type ReviewRow } from "@/lib/reviews/import";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const productId = Number(id);
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(productId) || productId <= 0) {
    return Response.json({ error: "유효한 상품 ID가 필요합니다." }, { status: 400 });
  }
  const { data: product, error: productError } = await supabase.from("products").select("id").eq("id", productId).maybeSingle();
  if (productError) {
    console.error("Review import product lookup:", productError);
    return Response.json({ error: "상품을 조회하지 못했습니다." }, { status: 500 });
  }
  if (!product) return Response.json({ error: "상품을 찾을 수 없습니다." }, { status: 404 });
  let file: File;
  try {
    const form = await request.formData();
    const files = [...form.values()].filter((value) => value instanceof File);
    if (files.length !== 1 || !(form.get("file") instanceof File)) throw new Error();
    file = files[0] as File;
  } catch {
    return Response.json({ error: "multipart/form-data의 file 필드에 파일 1개를 전달해주세요." }, { status: 400 });
  }
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension !== "csv" && extension !== "xlsx") return Response.json({ error: "CSV/XLSX 파일만 지원합니다." }, { status: 400 });
  if (file.size === 0 || file.size > MAX_REVIEW_FILE_SIZE) return Response.json({ error: "파일은 0바이트보다 크고 10MB 이하여야 합니다." }, { status: 400 });
  const { data: batch, error: batchError } = await supabase.from("review_import_batches").insert({
    product_id: productId, file_name: file.name, source: extension, status: "pending",
  }).select("id").single();
  if (batchError || !batch) {
    console.error("Review import batch creation:", batchError);
    return Response.json({ error: "Import batch를 생성하지 못했습니다." }, { status: 500 });
  }
  let totalRows = 0, importedRows = 0, skippedRows = 0;
  const updateBatch = async (status: string, errorMessage: string | null = null) => {
    const { error } = await supabase.from("review_import_batches").update({ status, error_message: errorMessage,
      total_rows: totalRows, imported_rows: importedRows, skipped_rows: skippedRows,
      updated_at: new Date().toISOString() }).eq("id", batch.id);
    if (error) throw error;
  };
  // Plain insert supports the actual partial unique indexes. A conflicting chunk
  // is split recursively; only a single row with SQLSTATE 23505 is skipped.
  const insertChunk = async (rows: ReviewRow[]): Promise<void> => {
    const { error } = await supabase.from("reviews").insert(rows.map((row) => ({
      ...row, product_id: productId, import_batch_id: batch.id,
    })));
    if (!error) { importedRows += rows.length; return; }
    if (error.code !== "23505") throw error;
    if (rows.length === 1) { skippedRows++; return; }
    const middle = Math.floor(rows.length / 2);
    await insertChunk(rows.slice(0, middle));
    await insertChunk(rows.slice(middle));
  };
  try {
    await updateBatch("processing");
    let parsed;
    try { parsed = await parseReviewFile(Buffer.from(await file.arrayBuffer()), extension); }
    catch (error) {
      if (error instanceof ReviewImportValidationError) throw error;
      console.error("Review file parse failed:", error);
      throw new ReviewImportValidationError("파일 형식 또는 인코딩을 확인해주세요. XLSX는 첫 번째 시트를 읽습니다.");
    }
    totalRows = parsed.totalRows;
    skippedRows = parsed.skippedRows;
    await updateBatch("processing");
    for (let start = 0; start < parsed.rows.length; start += 500) {
      await insertChunk(parsed.rows.slice(start, start + 500));
      await updateBatch("processing");
    }
    await updateBatch("completed");
    return Response.json({ ok: true, batchId: batch.id, totalRows, importedRows, skippedRows });
  } catch (error) {
    console.error("Review import failed:", { batchId: batch.id, error });
    const message = error instanceof ReviewImportValidationError ? error.message : "리뷰 저장에 실패했습니다. 일부 행은 저장되었을 수 있습니다.";
    try { await updateBatch("failed", message); }
    catch (batchUpdateError) { console.error("Failed review batch update:", batchUpdateError); }
    return Response.json({ error: message, batchId: batch.id, totalRows, importedRows, skippedRows },
      { status: error instanceof ReviewImportValidationError ? 400 : 500 });
  }
}
