import { KeywordError, parseKeywordFile, parseKeywordMapping, suggestKeywordMapping } from "@/lib/blog-keywords/import";
import { previewKeywordImport, importKeywordRows } from "@/lib/blog-keywords/store";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const diagnose = process.env.NODE_ENV === "development"
    ? (stage: string, details: Record<string, number | string>) => console.info("keyword import", { stage, ...details })
    : undefined;
  try {
    const form = await request.formData();
    const productId = Number(form.get("productId")), file = form.get("file"), action = form.get("action");
    if (!Number.isSafeInteger(productId) || productId <= 0 || !(file instanceof File) || !["inspect", "preview", "import"].includes(String(action))) throw new KeywordError("Product·파일·작업을 확인하세요.");
    const sheet = await parseKeywordFile(file);
    diagnose?.("file_parsed", { action: String(action), rows: sheet.rows.length, columns: sheet.columns.length });
    if (action === "inspect") return Response.json({ columns: sheet.columns, totalRows: sheet.rows.length, mapping: suggestKeywordMapping(sheet) });
    let raw: unknown;
    try { raw = JSON.parse(String(form.get("mapping"))); } catch { throw new KeywordError("열 매핑 형식을 확인하세요."); }
    const mapping = parseKeywordMapping(raw, sheet.columns.length);
    diagnose?.("mapping_applied", { fields: Object.keys(mapping).length });
    const { prepared, summary } = await previewKeywordImport(productId, sheet, mapping, diagnose);
    if (action === "preview") {
      const response = Response.json(summary);
      diagnose?.("response_ready", { totalRows: summary.totalRows, samples: summary.samples.length, bytes: Buffer.byteLength(JSON.stringify(summary)) });
      return response;
    }
    const source = String(form.get("source") ?? "").trim();
    if (source.length > 200) throw new KeywordError("출처는 200자 이하로 입력하세요.");
    const imported = await importKeywordRows(productId, prepared.rows, source || null, file.name);
    return Response.json({ ...summary, imported });
  } catch (error) { return Response.json({ error: error instanceof KeywordError ? error.message : "키워드 import에 실패했습니다." }, { status: error instanceof KeywordError ? error.status : 500 }); }
}
