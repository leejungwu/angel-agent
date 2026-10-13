import { authorizeExtension } from "@/lib/blog-publishing/extension-api";
import { createTempImage, TempImageError } from "@/lib/blog-publishing/temp-image";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const denied = authorizeExtension(request);
  if (denied) return denied;
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "JSON 요청을 확인하세요." }, { status: 400 }); }
  try {
    const signedUrl = body && typeof body === "object" && "signedUrl" in body ? body.signedUrl : undefined;
    return Response.json(await createTempImage(signedUrl), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Extension temp image create failed", { type: error instanceof Error ? error.name : "Unknown", code: (error as NodeJS.ErrnoException)?.code });
    return Response.json({ error: error instanceof TempImageError ? error.message : "임시 사진 생성에 실패했습니다." }, { status: error instanceof TempImageError ? error.status : 500 });
  }
}
