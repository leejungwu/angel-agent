import { removeBlogTaskAsset } from "@/lib/blog-task-assets/delete";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id, assetId } = await params;
  if (![id, assetId].every(value => /^[1-9]\d*$/.test(value))) return Response.json({ error: "사진 ID가 올바르지 않습니다." }, { status: 400 });
  try { return Response.json(await removeBlogTaskAsset(id, assetId)); }
  catch (cause) { return Response.json({ error: cause instanceof Error ? cause.message : "사진 삭제 실패" }, { status: 409 }); }
}
