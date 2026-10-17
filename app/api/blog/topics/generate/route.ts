import { supabase } from "@/lib/supabase";
import { generateBlogTopic, TopicError } from "@/lib/blog-generation/topic";

export const maxDuration = 60;
export async function POST(request: Request) {
  let productId: number, keyword: string, instructions: string;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["productId", "keyword", "instructions"].includes(key)) ||
      !("productId" in body) || typeof body.productId !== "number" || !Number.isSafeInteger(body.productId) || body.productId <= 0 ||
      !("keyword" in body) || typeof body.keyword !== "string" || !body.keyword.trim() ||
      ("instructions" in body && typeof body.instructions !== "string")) throw new Error();
    productId = body.productId; keyword = body.keyword.trim(); instructions = "instructions" in body ? body.instructions as string : "";
  } catch { return Response.json({ error: "상품과 키워드를 확인하세요." }, { status: 400 }); }
  try {
    const { data, error } = await supabase.from("products").select("name,brand,usp,target_customer,customer_problem,notes").eq("id", productId).maybeSingle();
    if (error) throw new TopicError("상품 조회에 실패했습니다.", 500);
    if (!data) throw new TopicError("상품을 찾을 수 없습니다.", 404);
    return Response.json(await generateBlogTopic(data, keyword, instructions));
  } catch (error) {
    return Response.json({ error: error instanceof TopicError ? error.message : "AI 주제 생성에 실패했습니다." }, { status: error instanceof TopicError ? error.status : 500 });
  }
}
