import { authorizeExtension } from "@/lib/blog-publishing/extension-api";
import { listExtensionPublicationJobs, listReservationRechecks } from "@/lib/blog-publishing/publication-extension";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const denied = authorizeExtension(request);
  if (denied) return denied;
  try { return Response.json({ jobs: new URL(request.url).searchParams.get("confirmation") === "needed" ? await listReservationRechecks() : await listExtensionPublicationJobs() }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "발행 Job 목록을 조회하지 못했습니다." }, { status: 500 }); }
}
