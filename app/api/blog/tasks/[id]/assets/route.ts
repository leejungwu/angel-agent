import { removeAllBlogTaskAssets } from "@/lib/blog-task-assets/delete";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) return Response.json({ error: "작업 ID가 올바르지 않습니다." }, { status: 400 });
  try {
    const deleted = await removeAllBlogTaskAssets(id);
    return Response.json({ ok: true, deleted });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "사진을 삭제하지 못했습니다." }, { status: 409 });
  }
}
