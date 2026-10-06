import { supabase } from "@/lib/supabase";
import KinAnswerForm, { type KinProduct } from "./KinAnswerForm";
import { PRESET_FIELDS, type KinPreset } from "@/lib/kin/presets";
import RecentKinTasks from "./RecentKinTasks";

export const dynamic = "force-dynamic";

type RecentTask = {
  id: string; question: string; product_id: number | null; created_at: string; status: string;
};

export default async function KinPage() {
  const [{ data: products, error: productError }, { data: tasks, error: taskError }, { data: presets, error: presetError }] = await Promise.all([
    supabase.from("products").select("id, name, brand").order("id").returns<KinProduct[]>(),
    supabase.from("kin_tasks").select("id, question, product_id, status, created_at")
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(10).returns<RecentTask[]>(),
    supabase.from("kin_prompt_presets").select(PRESET_FIELDS).order("is_default", { ascending: false })
      .order("created_at").order("id").returns<KinPreset[]>(),
  ]);
  const productNames = new Map((products ?? []).map((product) => [product.id, product.name]));
  return (
    <main className="p-6 md:p-10">
      <h1 className="text-3xl font-bold">지식인 답변 작성</h1>
      <p className="mt-2 text-sm text-zinc-500">질문을 붙여넣어 답변 초안을 만들고, 검토한 뒤 직접 복사해 등록하세요.</p>
      {productError ? <p role="alert" className="mt-6 text-sm text-red-600">상품 목록을 불러오지 못했습니다.</p>
        : <KinAnswerForm products={products ?? []} presets={presets ?? []} />}
      {presetError && <p role="alert" className="mt-3 text-sm text-red-600">프리셋 목록을 불러오지 못했습니다. migration 적용 여부를 확인해 주세요.</p>}
      <RecentKinTasks count={taskError ? 0 : tasks?.length ?? 0}>
        {taskError ? <p role="alert" className="mt-4 text-sm text-red-600">최근 작업을 불러오지 못했습니다. 지식인 migration 적용 여부를 확인해 주세요.</p>
          : !tasks?.length ? <p className="mt-4 text-sm text-zinc-500">아직 생성된 지식인 작업이 없습니다.</p>
          : <div className="mt-4 space-y-3">{tasks.map((task) => <article key={task.id} className="rounded-lg border bg-white p-4">
            <p className="line-clamp-2 text-sm font-medium">{task.question}</p>
            <p className="mt-2 text-xs text-zinc-500">
              {task.product_id === null ? "일반 답변" : productNames.get(task.product_id) ?? "상품 정보 없음"}
              {" · "}{task.status}{" · "}{new Date(task.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
            </p>
          </article>)}</div>}
      </RecentKinTasks>
    </main>
  );
}
