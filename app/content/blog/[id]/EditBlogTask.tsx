"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { resolveTaskTopic } from "@/lib/blog-generation/topic-request";

type TaskFields = {
  keyword: string | null;
  topic: string | null;
  instructions: string | null;
};

function formValues(fields: TaskFields) {
  return {
    keyword: fields.keyword ?? "",
    topic: fields.topic ?? "",
    instructions: fields.instructions ?? "",
  };
}

export default function EditBlogTask({
  taskId,
  productId,
  initialFields,
}: {
  taskId: string | number;
  productId: string | number | null;
  initialFields: TaskFields;
}) {
  const router = useRouter();
  const [fields, setFields] = useState(initialFields);
  const [form, setForm] = useState(() => formValues(initialFields));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const inFlight = useRef(false);

  function startEditing() {
    if (inFlight.current) return;
    setForm(formValues(fields));
    setSaved(false);
    setEditing(true);
  }

  function cancelEditing() {
    if (inFlight.current) return;
    setForm(formValues(fields));
    setEditing(false);
  }

  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    if (!form.keyword.trim() && !form.topic.trim()) {
      alert("키워드 또는 주제를 입력해 주세요.");
      return;
    }
    inFlight.current = true;
    setSaving(true);
    try {
      const topic = await resolveTaskTopic(productId, form.keyword, form.topic, form.instructions);
      setForm({ ...form, topic });
      const changes = { keyword: form.keyword.trim(), topic, instructions: form.instructions.trim() };
      // Update this task only. Product, task status and all drafts remain unchanged.
      const { data, error } = await supabase
        .from("blog_tasks")
        .update(changes)
        .eq("id", taskId)
        .select("keyword, topic, instructions")
        .single()
        .returns<TaskFields>();
      if (error || !data) {
        alert(error?.message || "작업을 저장하지 못했습니다.");
        return;
      }
      setFields(data);
      setForm(formValues(data));
      setEditing(false);
      setSaved(true);
      router.refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : "작업을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="mt-4">
      {editing ? (
        <form onSubmit={saveTask}>
          <fieldset disabled={saving} className="flex flex-col gap-4">
            <label className="flex flex-col gap-2">
              키워드
              <input
                className="rounded-lg border px-4 py-3"
                value={form.keyword}
                onChange={(event) => setForm({ ...form, keyword: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-2">
              주제
              <input
                maxLength={300}
                className="rounded-lg border px-4 py-3"
                value={form.topic}
                onChange={(event) => setForm({ ...form, topic: event.target.value })}
              />
            </label>
            <p className="text-sm text-zinc-500">주제를 비워두고 저장하면 현재 키워드를 기준으로 AI가 새 주제를 생성합니다.</p>
            <label className="flex flex-col gap-2">
              이번 글 추가 지시
              <textarea
                className="min-h-24 rounded-lg border px-4 py-3"
                value={form.instructions}
                onChange={(event) => setForm({ ...form, instructions: event.target.value })}
              />
            </label>
            <p className="text-sm text-zinc-500">
              작업 정보를 수정해도 기존 초안은 유지됩니다. 필요하면 저장 후 AI 초안을 재생성하세요.
            </p>
            <div className="flex gap-2">
              <button type="submit" className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {saving ? "저장 중..." : "저장"}
              </button>
              <button type="button" onClick={cancelEditing} className="rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-50">
                취소
              </button>
            </div>
          </fieldset>
        </form>
      ) : (
        <>
          <p className="whitespace-pre-wrap">키워드: {fields.keyword || "-"}</p>
          <p className="mt-2 whitespace-pre-wrap">주제: {fields.topic || "-"}</p>
          <p className="mt-2 whitespace-pre-wrap">이번 글 추가 지시: {fields.instructions || "-"}</p>
          <button type="button" onClick={startEditing} className="mt-4 rounded-lg border px-4 py-2 text-sm font-medium">
            작업 수정
          </button>
        </>
      )}
      {saved && <p role="status" className="mt-2 text-sm text-green-700">작업 정보를 저장했습니다.</p>}
    </div>
  );
}
