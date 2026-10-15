import { authorizeExtension } from "@/lib/blog-publishing/extension-api";
import { getPublicationJob, publicationJobToExtensionTask } from "@/lib/blog-publishing/publication-extension";
import { PublicationJobError } from "@/lib/blog-publishing/publication-jobs";

export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = authorizeExtension(request);
  if (denied) return denied;
  try {
    const job = await getPublicationJob((await params).id);
    return Response.json(await publicationJobToExtensionTask(job), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof PublicationJobError ? error.message : "Job snapshot을 확인하지 못했습니다." }, { status: error instanceof PublicationJobError ? error.status : 500 });
  }
}
