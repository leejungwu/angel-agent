import { authorizeExtension } from "@/lib/blog-publishing/extension-api";
import { claimPublicationJob } from "@/lib/blog-publishing/publication-extension";
import { PublicationJobError } from "@/lib/blog-publishing/publication-jobs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = authorizeExtension(request);
  if (denied) return denied;
  let input;
  try {
    input = await request.json();
    if (input?.publisher !== "blocks" && input?.publisher !== "legacy") throw new Error();
  } catch { return Response.json({ error: "입력 방식을 확인해 주세요." }, { status: 400 }); }
  try { return Response.json(await claimPublicationJob((await params).id, input.publisher), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    return Response.json({ error: error instanceof PublicationJobError ? error.message : "Job 선점 상태를 확인하지 못했습니다. 재실행 전에 대기열을 확인하세요." }, { status: error instanceof PublicationJobError ? error.status : 500 });
  }
}
