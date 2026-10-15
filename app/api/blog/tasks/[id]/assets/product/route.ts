import { supabase } from "@/lib/supabase";
import { listProductPhotos, parseAssetIds, reuseProductPhotos } from "@/lib/blog-task-assets/manage";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) return Response.json({ error: "작업 ID가 올바르지 않습니다." }, { status: 400 });
  try {
    const photos = await listProductPhotos(id);
    const { data: existing, error } = await supabase.from("blog_task_assets").select("source_product_asset_id").eq("blog_task_id", id);
    if (error) throw new Error("기존 사진 조회 실패");
    const images = await Promise.all(photos.map(async photo => {
      const { data, error: signError } = await supabase.storage.from("product-assets").createSignedUrl(photo.storage_path, 600);
      if (signError || !data) throw new Error("제품 사진 미리보기 실패");
      return { id: photo.id, file_name: photo.file_name, previewUrl: data.signedUrl, added: (existing ?? []).some(asset => String(asset.source_product_asset_id) === String(photo.id)) };
    }));
    return Response.json({ images }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) { return Response.json({ error: cause instanceof Error ? cause.message : "제품 사진 조회 실패" }, { status: 409 }); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) return Response.json({ error: "작업 ID가 올바르지 않습니다." }, { status: 400 });
  let ids: string[];
  try { ids = parseAssetIds((await request.json()).assetIds); }
  catch { return Response.json({ error: "제품 사진 선택을 확인해 주세요." }, { status: 400 }); }
  try { return Response.json({ added: await reuseProductPhotos(id, ids) }); }
  catch (cause) { return Response.json({ error: cause instanceof Error ? cause.message : "제품 사진 추가 실패" }, { status: 409 }); }
}
