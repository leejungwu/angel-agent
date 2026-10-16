import { deleteAdReference, saveAdReference } from "@/lib/ads/reference-store";
import { AdReferenceError } from "@/lib/ads/references";

type Context = { params: Promise<{ id: string }> };
function failure(error: unknown) {
  return Response.json({ error: error instanceof AdReferenceError ? error.message : "광고 Reference 처리에 실패했습니다." }, { status: error instanceof AdReferenceError ? error.status : 500 });
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id } = await params, form = await request.formData();
    const raw = form.get("data"), updatedAt = form.get("updatedAt"), file = form.get("file");
    if (typeof raw !== "string" || typeof updatedAt !== "string" || (file !== null && !(file instanceof File))) throw new AdReferenceError("수정 정보를 확인하세요.");
    let input: unknown;
    try { input = JSON.parse(raw); } catch { throw new AdReferenceError("광고 정보 형식이 잘못됐습니다."); }
    return Response.json(await saveAdReference(input, file, { id, updatedAt, removeAsset: form.get("removeAsset") === "true" }));
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    let input: unknown;
    try { input = await request.json(); } catch { throw new AdReferenceError("삭제 정보를 확인하세요."); }
    if (!input || typeof input !== "object" || !("updatedAt" in input) || typeof input.updatedAt !== "string") throw new AdReferenceError("삭제 정보를 확인하세요.");
    return Response.json(await deleteAdReference(id, input.updatedAt));
  } catch (error) { return failure(error); }
}
