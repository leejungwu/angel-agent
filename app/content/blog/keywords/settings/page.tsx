import Link from "next/link";
import SettingsForm from "./SettingsForm";
import { readKeywordAISettings } from "@/lib/blog-keywords/ai-settings";
export const dynamic = "force-dynamic";
export default async function KeywordAISettingsPage() {
  let settings, error = "";
  try { settings = await readKeywordAISettings(); }
  catch (cause) { error = cause instanceof Error ? cause.message : "AI 기준 조회 실패"; }
  return <main className="mx-auto max-w-4xl p-10">
    <Link href="/content/blog/keywords" className="underline">Keyword Pool</Link>
    <h1 className="my-5 text-3xl font-bold">AI 기준 설정</h1>
    {settings ? <SettingsForm initial={settings} /> : <p role="alert">{error}</p>}
  </main>;
}
