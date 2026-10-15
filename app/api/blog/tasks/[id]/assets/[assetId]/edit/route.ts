import { supabase } from "@/lib/supabase";
import { BLOG_TASK_ASSET_BUCKET } from "@/lib/blog-task-assets";
import { getEditableAsset, saveEditedAsset } from "@/lib/blog-task-assets/edit-server";

type Context = { params: Promise<{ id: string; assetId: string }> };
async function ids(context: Context) {
  const { id, assetId } = await context.params;
  if (![id, assetId].every(value => /^[1-9]\d*$/.test(value))) throw new Error("작업·사진 ID를 확인해 주세요.");
  return { id, assetId };
}
const failure = (cause: unknown) => Response.json({ error: cause instanceof Error ? cause.message : "사진 편집 요청 실패" }, { status: 409 });

export async function GET(_request: Request, context: Context) {
  try {
    const { id, assetId } = await ids(context), asset = await getEditableAsset(id, assetId);
    const { data, error } = await supabase.storage.from(BLOG_TASK_ASSET_BUCKET).createSignedUrl(asset.original_storage_path || asset.storage_path, 600);
    if (error || !data) throw new Error("원본 미리보기 URL 발급 실패");
    return Response.json({ asset, originalUrl: data.signedUrl }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) { return failure(cause); }
}

export async function POST(request: Request, context: Context) {
  try {
    const { id, assetId } = await ids(context), form = await request.formData();
    const file = form.get("file"), expectedPath = form.get("expectedPath"), metadata = form.get("metadata");
    if (!(file instanceof File) || typeof expectedPath !== "string" || typeof metadata !== "string") throw new Error("편집 이미지와 설정을 확인해 주세요.");
    const asset = await saveEditedAsset(id, assetId, expectedPath, file, JSON.parse(metadata));
    return Response.json({ asset });
  } catch (cause) { return failure(cause); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id, assetId } = await ids(context), body = await request.json();
    if (body?.action !== "restore" || typeof body.expectedPath !== "string") throw new Error("원본 복원 요청을 확인해 주세요.");
    return Response.json({ asset: await saveEditedAsset(id, assetId, body.expectedPath, null, null) });
  } catch (cause) { return failure(cause); }
}
