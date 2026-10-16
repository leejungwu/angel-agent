import { supabase } from "@/lib/supabase";
import AdReferenceForm from "../AdReferenceForm";
export const dynamic = "force-dynamic";
export default async function NewAdReferencePage() {
  const { data, error } = await supabase.from("products").select("id,name").order("name");
  return <main className="p-10"><h1 className="text-3xl font-bold">광고 Reference 등록</h1>
    {error ? <p role="alert">Product 목록 조회에 실패했습니다.</p> : <AdReferenceForm products={data ?? []} />}</main>;
}
