import Link from "next/link";
import { readBlogSettings } from "@/lib/blog-generation/settings";
import SettingsForm from "./SettingsForm";
export const dynamic = "force-dynamic";
export default async function BlogSettingsPage() {
  let settings, error = "";
  try { settings = await readBlogSettings(); } catch (cause) { error = cause instanceof Error ? cause.message : "설정 조회 실패"; }
  return <main className="mx-auto max-w-4xl p-10">
    <Link href="/content/blog" className="underline">Blog 작업</Link>
    <h1 className="my-5 text-3xl font-bold">Blog AI 설정</h1>
    {settings ? <SettingsForm initial={settings} /> : <p role="alert">{error}</p>}
  </main>;
}
