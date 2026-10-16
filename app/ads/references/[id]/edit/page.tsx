import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getAdReference } from "@/lib/ads/reference-store";
import { AdReferenceError } from "@/lib/ads/references";
import AdReferenceForm from "../../AdReferenceForm";
export const dynamic = "force-dynamic";
export default async function EditAdReferencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let reference;
  try { reference = await getAdReference(id); }
  catch (error) { if (error instanceof AdReferenceError && [400, 404].includes(error.status)) notFound(); return <main className="p-10"><p role="alert">광고 Reference 조회에 실패했습니다.</p></main>; }
  const { data, error } = await supabase.from("products").select("id,name").order("name");
  return <main className="p-10"><h1 className="text-3xl font-bold">광고 Reference 수정</h1>
    {error ? <p role="alert">Product 목록 조회에 실패했습니다.</p> : <AdReferenceForm reference={reference} products={data ?? []} />}</main>;
}
