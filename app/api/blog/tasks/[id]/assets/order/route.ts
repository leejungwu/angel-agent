import { parseAssetIds, reorderBlogTaskAssets } from "@/lib/blog-task-assets/manage";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) return Response.json({ error: "작업 ID가 올바르지 않습니다." }, { status: 400 });
  let ids: string[];
  try { ids = parseAssetIds((await request.json()).assetIds); }
  catch { return Response.json({ error: "사진 순서 목록을 확인해 주세요." }, { status: 400 }); }
  try { await reorderBlogTaskAssets(id, ids); return Response.json({ ok: true }); }
  catch (cause) { return Response.json({ error: cause instanceof Error ? cause.message : "사진 순서 저장 실패" }, { status: 409 }); }
}
