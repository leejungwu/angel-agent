import { authorizeExtension } from "@/lib/blog-publishing/extension-api";
import { recordReservationConfirmation } from "@/lib/blog-publishing/publication-extension";
import { PublicationJobError } from "@/lib/blog-publishing/publication-jobs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = authorizeExtension(request);
  if (denied) return denied;
  let input;
  try {
    input = await request.json();
    if (!input || Object.keys(input).length !== 1 || !Number.isSafeInteger(input.attemptNo) || input.attemptNo < 1) throw new Error();
  } catch { return Response.json({ error: "실행 번호를 확인해 주세요." }, { status: 400 }); }
  try { return Response.json(await recordReservationConfirmation((await params).id, input.attemptNo)); }
  catch (error) {
    return Response.json({ error: error instanceof PublicationJobError ? error.message : "예약 등록 확인을 기록하지 못했습니다." }, { status: error instanceof PublicationJobError ? error.status : 500 });
  }
}
