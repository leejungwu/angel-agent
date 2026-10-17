import { evaluateProductRelevance } from "@/lib/blog-keywords/relevance";
import { KeywordError } from "@/lib/blog-keywords/shared";

import { isRelevanceTarget, type RelevanceTarget } from "@/lib/blog-keywords/relevance-filter";

export const maxDuration = 300;
export async function POST(request: Request) {
  let productId: number, batchSize: number, reevaluate: boolean, target: RelevanceTarget;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["productId", "batchSize", "reevaluate", "target"].includes(key)) || !("productId" in body) ||
        typeof body.productId !== "number" || !Number.isSafeInteger(body.productId) || body.productId <= 0) throw new Error();
    const size = "batchSize" in body ? body.batchSize : 50;
    if (typeof size !== "number" || ![50, 100, 200].includes(size)) throw new Error();
    const repeat = "reevaluate" in body ? body.reevaluate : false;
    if (typeof repeat !== "boolean") throw new Error();
    const requestedTarget = "target" in body ? body.target : "unevaluated";
    if (!isRelevanceTarget(requestedTarget)) throw new Error();
    target = requestedTarget;
    productId = body.productId; batchSize = size; reevaluate = repeat;
  } catch {
    return Response.json({ error: "Product, 평가 대상, 평가 개수(50, 100, 200)를 확인하세요." }, { status: 400 });
  }
  try {
    const result = await evaluateProductRelevance(productId, batchSize, reevaluate, target);
    return Response.json(result, { status: result.error ? 502 : 200 });
  } catch (error) {
    return Response.json({ error: error instanceof KeywordError ? error.message : "연관도 평가 요청에 실패했습니다." }, { status: error instanceof KeywordError ? error.status : 500 });
  }
}
