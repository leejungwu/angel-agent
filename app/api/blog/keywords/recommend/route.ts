import { recommendKeywords } from "@/lib/blog-keywords/recommendation";
import { KeywordError } from "@/lib/blog-keywords/shared";

export async function POST(request: Request) {
  let productId: number, count: 5 | 10;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body) || !("productId" in body) ||
        typeof body.productId !== "number" || !Number.isSafeInteger(body.productId) || body.productId <= 0) throw new Error();
    const requested = "count" in body ? body.count : 5;
    if (requested !== 5 && requested !== 10) throw new Error();
    productId = body.productId; count = requested;
  } catch {
    return Response.json({ error: "Product와 추천 개수(5 또는 10)를 확인하세요." }, { status: 400 });
  }
  try {
    return Response.json(await recommendKeywords(productId, count));
  } catch (error) {
    return Response.json({ error: error instanceof KeywordError ? error.message : "추천 요청 처리에 실패했습니다." }, { status: error instanceof KeywordError ? error.status : 500 });
  }
}
