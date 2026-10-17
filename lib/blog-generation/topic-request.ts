// Shared by new/edit forms; supplied topics never incur an AI request.
export async function resolveTaskTopic(productId: string | number | null, keyword: string, topic: string, instructions: string) {
  const entered = topic.trim();
  if (entered) {
    if (entered.length > 300) throw new Error("주제는 300자 이하여야 합니다.");
    return entered;
  }
  if (!keyword.trim()) throw new Error("키워드 또는 주제를 입력해 주세요.");
  if (productId == null) throw new Error("연결된 상품을 찾을 수 없습니다.");
  const response = await fetch("/api/blog/topics/generate", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId: Number(productId), keyword: keyword.trim(), instructions: instructions.trim() }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "AI 주제 생성에 실패했습니다.");
  const generated = typeof data.topic === "string" ? data.topic.trim() : "";
  if (!generated || generated.length > 300) throw new Error("AI 주제 응답이 올바르지 않습니다. 작업을 저장하지 않았습니다.");
  return generated;
}
