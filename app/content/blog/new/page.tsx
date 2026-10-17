"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { KEYWORD_ID } from "@/lib/blog-keywords/shared";

type Product = {
  id: string | number;
  name: string;
  brand: string | null;
};

export default function NewBlogTaskPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [productId, setProductId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [topic, setTopic] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [sourceKeywordId, setSourceKeywordId] = useState("");
  const [sourceKeywordLoading, setSourceKeywordLoading] = useState(true);
  const [sourceKeywordError, setSourceKeywordError] = useState("");

  useEffect(() => {
    let active = true;
    const params = new URL(window.location.href).searchParams;
    const id = params.get("blogKeywordId") ?? params.get("keywordId");
    void Promise.resolve().then(async () => {
      try {
        if (!active || !id) return;
        if (!KEYWORD_ID.test(id)) throw new Error("Keyword ID를 확인하세요.");
        const { data, error } = await supabase.from("blog_keywords").select("id,product_id,keyword,status").eq("id", id).maybeSingle();
        if (!active) return;
        if (error || !data || data.status !== "unused") throw new Error("사용 가능한 키워드를 찾지 못했습니다. Keyword Pool에서 다시 선택하세요.");
        setSourceKeywordId(data.id); setProductId(String(data.product_id)); setKeyword(data.keyword);
        setTopic((params.get("topic") ?? "").trim().slice(0, 300));
      } catch (error) { if (active) setSourceKeywordError(error instanceof Error ? error.message : "키워드 조회 실패"); }
      finally { if (active) setSourceKeywordLoading(false); }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadProducts() {
      try {
        const { data, error } = await supabase
          .from("products")
          .select("id, name, brand")
          .order("id", { ascending: true })
          .returns<Product[]>();

        if (!active) return;
        if (error) {
          setProductsError(error.message);
          return;
        }
        setProducts(data ?? []);
      } catch (error) {
        if (active) {
          setProductsError(error instanceof Error ? error.message : "상품 목록을 불러오지 못했습니다.");
        }
      } finally {
        if (active) setProductsLoading(false);
      }
    }

    void loadProducts();
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || sourceKeywordLoading || sourceKeywordError) return;

    const product = products.find((item) => String(item.id) === productId);
    if (!product || !topic.trim()) {
      alert("상품과 주제를 입력해 주세요.");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from("blog_tasks").insert({
        product_id: product.id,
        keyword: keyword.trim(),
        topic: topic.trim(),
        instructions: instructions.trim(),
        status: "pending",
        ...(sourceKeywordId ? { blog_keyword_id: sourceKeywordId } : {}),
      });

      if (error) {
        alert(error.message);
        return;
      }

      router.push("/content/blog");
      router.refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : "작업을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="p-10">
      <h1 className="text-3xl font-bold">새 블로그 작업</h1>

      <form onSubmit={handleSubmit} className="mt-8 max-w-2xl rounded-xl border bg-white p-6">
        <fieldset disabled={saving || sourceKeywordLoading || !!sourceKeywordError} className="flex flex-col gap-5">
          {sourceKeywordLoading && <p role="status">키워드 출처 확인 중…</p>}
          {sourceKeywordId && <p className="text-sm text-zinc-500">Keyword Pool의 Product·키워드를 사용합니다. 작업 저장 성공 시 사용완료로 변경됩니다.</p>}
          <select
            aria-label="상품 선택"
            required
            disabled={!!sourceKeywordId || productsLoading || !!productsError || !products.length}
            className="rounded-lg border px-4 py-3"
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
          >
            <option value="">{productsLoading ? "상품 목록 불러오는 중..." : "상품 선택"}</option>
            {products.map((product) => (
              <option key={product.id} value={String(product.id)}>
                {product.name}{product.brand ? ` (${product.brand})` : ""}
              </option>
            ))}
          </select>

          {productsError && <p role="alert" className="text-red-600">DB 오류: {productsError}</p>}
          {!productsLoading && !productsError && !products.length && (
            <p className="text-zinc-500">등록된 상품이 없습니다.</p>
          )}

          <input
            aria-label="키워드"
            className="rounded-lg border px-4 py-3"
            placeholder="키워드"
            readOnly={!!sourceKeywordId}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <input
            aria-label="주제"
            required
            className="rounded-lg border px-4 py-3"
            placeholder="주제"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
          />
          <textarea
            aria-label="이번 글 추가 지시"
            className="min-h-24 rounded-lg border px-4 py-3"
            placeholder="이번 글 추가 지시"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
          <button
            type="submit"
            disabled={saving || productsLoading || !!productsError || !products.length}
            className="rounded-lg bg-black px-5 py-3 text-white disabled:opacity-50"
          >
            {saving ? "저장 중..." : "작업 저장"}
          </button>
        </fieldset>
      </form>
      {sourceKeywordError && <p role="alert" className="mt-4 text-red-600">{sourceKeywordError} <Link href="/content/blog/keywords" className="underline">Keyword Pool</Link></p>}
    </main>
  );
}
