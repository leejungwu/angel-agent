import { authorizeExtension, getExtensionBlogTask } from "@/lib/blog-publishing/extension-api";

export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = authorizeExtension(request);
  if (denied) return denied;
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) return Response.json({ error: "잘못된 Task ID입니다." }, { status: 400 });
  const draftId = new URL(request.url).searchParams.get("draftId") ?? undefined;
  if (draftId !== undefined && !/^[1-9]\d*$/.test(draftId)) return Response.json({ error: "잘못된 Draft ID입니다." }, { status: 400 });
  try {
    const task = await getExtensionBlogTask(id, draftId);
    return task ? Response.json(task, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "Task 또는 초안이 없습니다." }, { status: 404 });
  } catch {
    return Response.json({ error: "초안 형식 또는 사진 접근 권한을 확인해 주세요." }, { status: 500 });
  }
}
