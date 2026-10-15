import { authorizeExtension } from "@/lib/blog-publishing/extension-api";
import { recordPublicationResult } from "@/lib/blog-publishing/publication-extension";
import { PublicationJobError } from "@/lib/blog-publishing/publication-jobs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = authorizeExtension(request);
  if (denied) return denied;
  let input;
  try {
    input = await request.json();
    if (!input || !["inserted", "failed"].includes(input.outcome) || (input.errorMessage != null && typeof input.errorMessage !== "string")) throw new Error();
  } catch { return Response.json({ error: "실행 결과를 확인해 주세요." }, { status: 400 }); }
  try { return Response.json(await recordPublicationResult((await params).id, input.attemptNo, input.outcome, input.errorMessage)); }
  catch (error) {
    return Response.json({ error: error instanceof PublicationJobError ? error.message : "Job 결과를 기록하지 못했습니다." }, { status: error instanceof PublicationJobError ? error.status : 500 });
  }
}
