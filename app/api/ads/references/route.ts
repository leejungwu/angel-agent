import { saveAdReference } from "@/lib/ads/reference-store";
import { AdReferenceError } from "@/lib/ads/references";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const raw = form.get("data");
    if (typeof raw !== "string") throw new AdReferenceError("광고 정보를 확인하세요.");
    let input: unknown;
    try { input = JSON.parse(raw); } catch { throw new AdReferenceError("광고 정보 형식이 잘못됐습니다."); }
    const file = form.get("file");
    if (file !== null && !(file instanceof File)) throw new AdReferenceError("파일을 확인하세요.");
    return Response.json(await saveAdReference(input, file), { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof AdReferenceError ? error.message : "광고 Reference 저장에 실패했습니다." }, { status: error instanceof AdReferenceError ? error.status : 500 });
  }
}
