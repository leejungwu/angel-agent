import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getAdReference } from "@/lib/ads/reference-store";
import { AD_ASSET_BUCKET, AD_PLATFORMS, AD_MEDIA_TYPES, AdReferenceError } from "@/lib/ads/references";
import DeleteAdReference from "./DeleteAdReference";
/* eslint-disable @next/next/no-img-element -- Private Storage signed URLs are generated per request. */
export const dynamic = "force-dynamic";
export default async function AdReferencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let reference;
  try { reference = await getAdReference(id); }
  catch (error) { if (error instanceof AdReferenceError && [400, 404].includes(error.status)) notFound(); return <main className="p-10"><p role="alert">광고 Reference 조회에 실패했습니다.</p></main>; }
  const { data: product, error: productError } = reference.product_id ? await supabase.from("products").select("id,name").eq("id", reference.product_id).maybeSingle() : { data: null, error: null };
  const { data: asset, error: assetError } = reference.asset_storage_path ? await supabase.storage.from(AD_ASSET_BUCKET).createSignedUrl(reference.asset_storage_path, 3600) : { data: null, error: null };
  return <main className="p-10"><Link href="/ads/references" className="underline">광고 Reference 목록</Link>
    <h1 className="mt-5 text-3xl font-bold">{reference.title}</h1><p>{reference.brand_name} · {AD_PLATFORMS[reference.platform]} · {AD_MEDIA_TYPES[reference.media_type]}</p>
    <p className="mt-3">Product: {productError ? "조회 실패" : product ? <Link href={`/products/${product.id}`} className="underline">{product.name}</Link> : "연결 없음"}</p>
    <p>태그: {reference.tags.join(", ") || "없음"}</p>
    {([ ["광고 원본", reference.source_url], ["랜딩", reference.landing_url] ] as const).map(([label, url]) => url && <p key={label}>{label}: <a href={/^https?:\/\//i.test(url) ? url : undefined} target="_blank" rel="noopener noreferrer" className="break-all underline">{url}</a></p>)}
    {assetError && <p role="alert">첨부 파일 URL을 만들지 못했습니다. 새로고침하세요.</p>}
    {asset && <div className="my-5">
      {reference.media_type === "image" && <a href={asset.signedUrl} target="_blank" rel="noopener noreferrer"><img src={asset.signedUrl} alt={reference.title} className="max-h-96 max-w-full object-contain" /></a>}
      <a href={asset.signedUrl} target="_blank" rel="noopener noreferrer" className="underline">첨부 파일 열기 · {reference.original_file_name}</a>
    </div>}
    <p className="mt-4 whitespace-pre-wrap break-words">{reference.notes || "메모 없음"}</p>
    <p className="mt-4 text-sm text-zinc-500">등록 {new Date(reference.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · 수정 {new Date(reference.updated_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>
    <div className="mt-6 flex gap-4"><Link href={`/ads/references/${id}/edit`} className="rounded-lg border px-4 py-2">수정</Link><DeleteAdReference id={id} updatedAt={reference.updated_at} /></div>
  </main>;
}
