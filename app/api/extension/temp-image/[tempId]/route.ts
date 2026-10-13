import { authorizeExtension } from "@/lib/blog-publishing/extension-api";
import { deleteTempImage, TempImageError } from "@/lib/blog-publishing/temp-image";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ tempId: string }> }) {
  const denied = authorizeExtension(request);
  if (denied) return denied;
  const { tempId } = await params;
  try {
    await deleteTempImage(tempId);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Extension temp image cleanup failed", { type: error instanceof Error ? error.name : "Unknown", code: (error as NodeJS.ErrnoException)?.code });
    return Response.json({ error: error instanceof TempImageError ? error.message : "임시 사진 정리에 실패했습니다." }, { status: error instanceof TempImageError ? error.status : 500 });
  }
}
