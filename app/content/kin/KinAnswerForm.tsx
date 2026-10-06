"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { KinAnswer } from "@/lib/kin/generate";

export type KinProduct = { id: number; name: string; brand: string | null };
type Result = { taskId: string; draftId: string; draft: KinAnswer; model: string; inputKey: string };

export default function KinAnswerForm({ products }: { products: KinProduct[] }) {
  const router = useRouter();
  const busy = useRef(false);
  const [generating, setGenerating] = useState(false);
  const [productId, setProductId] = useState("");
  const [question, setQuestion] = useState("");
  const [questionUrl, setQuestionUrl] = useState("");
  const [category, setCategory] = useState("");
  const [productMentionLevel, setProductMentionLevel] = useState("relevant");
  const [instructions, setInstructions] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const input = { productId: productId ? Number(productId) : null, question: question.trim(),
    questionUrl: questionUrl.trim() || null, category: category.trim() || null, purpose: "helpful",
    productMentionLevel, instructions: instructions.trim() || null };
  const inputKey = JSON.stringify(input);
  const sameInput = result?.inputKey === inputKey;

  async function generate(regenerate: boolean) {
    if (busy.current) return;
    busy.current = true;
    setGenerating(true);
    setError("");
    setFeedback("");
    try {
      const response = await fetch("/api/kin/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(regenerate && result ? { taskId: result.taskId } : input),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "답변 생성에 실패했습니다.");
      setResult({ taskId: data.taskId, draftId: data.draftId, draft: data.draft, model: data.model, inputKey });
    } catch (err) {
      setError(err instanceof Error ? err.message : "답변 생성에 실패했습니다.");
    } finally {
      busy.current = false;
      setGenerating(false);
      router.refresh();
    }
  }

  async function copyAnswer() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.draft.answer);
      setFeedback("답변을 복사했습니다.");
    } catch {
      setFeedback("복사하지 못했습니다. 아래 답변을 선택해서 직접 복사해 주세요.");
    }
  }

  const fieldClass = "mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2";
  const secondaryClass = "rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm disabled:opacity-50";
  return (
    <div className="mt-8 space-y-6">
      <form onSubmit={(event) => { event.preventDefault(); void generate(Boolean(result && sameInput)); }}
        className="rounded-lg border bg-white p-6">
        <fieldset disabled={generating} className="space-y-5 disabled:opacity-60">
          <label className="block text-sm font-medium">상품 선택
            <select className={fieldClass} value={productId} onChange={(event) => setProductId(event.target.value)}>
              <option value="">상품 없이 일반 답변</option>
              {products.map((product) => <option key={product.id} value={product.id}>
                {product.name}{product.brand ? ` (${product.brand})` : ""}
              </option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">지식인 질문
            <textarea required maxLength={10000} rows={6} className={fieldClass} value={question}
              onChange={(event) => setQuestion(event.target.value)} />
          </label>
          <div className="grid gap-5 md:grid-cols-2">
            <label className="block text-sm font-medium">질문 URL (선택)
              <input type="url" maxLength={2000} className={fieldClass} value={questionUrl}
                onChange={(event) => setQuestionUrl(event.target.value)} />
            </label>
            <label className="block text-sm font-medium">카테고리 (선택)
              <input maxLength={200} className={fieldClass} value={category} onChange={(event) => setCategory(event.target.value)} />
            </label>
          </div>
          <label className="block text-sm font-medium">제품 언급 수준
            <select className={fieldClass} value={productMentionLevel} onChange={(event) => setProductMentionLevel(event.target.value)}>
              <option value="none">언급 안 함</option>
              <option value="relevant">관련 있을 때만 언급</option>
              <option value="direct">직접 소개</option>
            </select>
          </label>
          <label className="block text-sm font-medium">추가 지침 (선택)
            <textarea rows={3} maxLength={3000} className={fieldClass} value={instructions}
              onChange={(event) => setInstructions(event.target.value)} />
          </label>
          <button type="submit" disabled={generating || !question.trim()}
            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {generating ? "답변 생성 중..." : "답변 생성"}
          </button>
        </fieldset>
        {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
      </form>
      {result && <section className="rounded-lg border bg-white p-6">
        <h2 className="text-xl font-semibold">생성 답변</h2>
        <p className="mt-3 text-sm text-zinc-600">질문 의도: {result.draft.questionIntent}</p>
        <p className="mt-2 text-xs text-zinc-500">모델: {result.model} · 제품 언급: {result.draft.productMentioned ? "있음" : "없음"}</p>
        <textarea aria-label="생성된 지식인 답변" readOnly value={result.draft.answer} rows={14}
          className="mt-4 w-full rounded-lg border bg-zinc-50 p-4 text-sm leading-7" />
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={secondaryClass} onClick={() => void copyAnswer()}>답변 복사</button>
          <button type="button" className={secondaryClass} disabled={generating || !sameInput} onClick={() => void generate(true)}>
            {generating ? "답변 생성 중..." : "다시 생성"}
          </button>
        </div>
        {!sameInput && <p className="mt-2 text-xs text-zinc-500">입력이 변경되었습니다. 답변 생성으로 새 작업을 만들 수 있습니다.</p>}
        {feedback && <p role="status" className="mt-3 text-sm text-zinc-600">{feedback}</p>}
      </section>}
    </div>
  );
}
