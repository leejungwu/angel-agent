"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KEYWORD_FIELDS, KEYWORD_IMPORT_PREFERENCE, keywordImportPreference, type KeywordMapping, type KeywordField, type KeywordColumn, type KeywordImportRun } from "@/lib/blog-keywords/shared";

type Summary = { totalRows: number; validRows: number; skippedRows: number; fileDuplicateRows: number; existingRows: number; inserts: number; updates: number; invalidMetricCells: number; samples: { keyword: string; search_volume?: number | null; competition?: string | null }[] };
async function readHistory(): Promise<KeywordImportRun[]> {
  const response = await fetch("/api/blog/keywords/import", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Import 이력 조회 실패");
  return data.runs;
}
function remember(productId: string, source: string) {
  try { window.localStorage.setItem(KEYWORD_IMPORT_PREFERENCE, JSON.stringify({ productId, source })); }
  catch { /* Storage can be disabled; importing still works. */ }
}
export default function KeywordImport({ products }: { products: { id: number; name: string }[] }) {
  const router = useRouter(), inFlight = useRef(false);
  const [productId, setProductId] = useState(""), [source, setSource] = useState("");
  const [file, setFile] = useState<File | null>(null), [columns, setColumns] = useState<KeywordColumn[]>([]);
  const [mapping, setMapping] = useState<KeywordMapping>({}), [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [runs, setRuns] = useState<KeywordImportRun[]>([]), [historyError, setHistoryError] = useState("");
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      try {
        const preference = keywordImportPreference(window.localStorage.getItem(KEYWORD_IMPORT_PREFERENCE), products);
        setProductId(preference.productId); setSource(preference.source);
      } catch { /* Preferences are optional. */ }
      try { const recent = await readHistory(); if (active) { setRuns(recent); setHistoryError(""); } }
      catch (cause) { if (active) setHistoryError(cause instanceof Error ? cause.message : "Import 이력 조회 실패"); }
    });
    return () => { active = false; };
  }, [products]);
  async function run(action: "inspect" | "preview" | "import") {
    if (inFlight.current) return;
    if (!productId || !file) { setError("Product와 파일을 선택하세요."); return; }
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    let stage = "FETCH";
    try {
      const body = new FormData(); body.set("file", file); body.set("productId", productId); body.set("action", action);
      body.set("source", source); body.set("mapping", JSON.stringify(mapping));
      const response = await fetch("/api/blog/keywords/import", { method: "POST", body });
      if (process.env.NODE_ENV === "development") console.info("keyword import response", { action, status: response.status, ok: response.ok, contentType: response.headers.get("content-type") });
      stage = "BODY_READ";
      const text = await response.text();
      stage = "JSON_PARSE";
      const result = JSON.parse(text);
      stage = `HTTP ${response.status}`;
      if (!response.ok) throw new Error(result.error ?? "Import 처리 실패");
      stage = "RESULT";
      if (action === "inspect") {
        setColumns(result.columns); setMapping(result.mapping); setSummary(null);
        if (result.presetApplied) { setSource(result.sourceLabel ?? ""); remember(productId, result.sourceLabel ?? ""); }
        setMessage(`${result.presetApplied ? "이전에 저장한 매핑을 적용했습니다." : "기본 자동 매핑을 적용했습니다."} ${result.totalRows}행 읽음. 실제 keyword가 있는 열을 선택하고 Preview를 확인하세요. ${result.warning ?? ""}`);
      }
      else if (action === "preview") setSummary(result);
      else {
        setSummary(null); remember(productId, source);
        setMessage(`${result.imported}개 키워드를 저장했습니다. 신규 ${result.inserted}개 · 업데이트 ${result.updated}개. 기존 사용·제외 상태는 유지됩니다. ${result.warning ?? ""}`);
        try { setRuns(await readHistory()); setHistoryError(""); }
        catch (cause) { setHistoryError(cause instanceof Error ? cause.message : "Import 이력 조회 실패"); }
        router.refresh();
      }
    } catch (cause) {
      if (process.env.NODE_ENV === "development") console.error("keyword import failed", { action, stage, exceptionName: cause instanceof Error ? cause.name : "Unknown" });
      const reason = stage === "FETCH" ? "서버 응답을 받지 못했습니다. 네트워크 요청을 확인하세요."
        : stage === "BODY_READ" ? "응답 본문을 읽는 중 연결이 중단됐습니다."
        : stage === "JSON_PARSE" ? "서버 응답을 JSON으로 해석하지 못했습니다."
        : cause instanceof Error ? cause.message : "Import 처리 실패";
      setError(`${action} ${stage}: ${reason}`);
    }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <details className="my-6 rounded-xl border bg-white p-5"><summary className="cursor-pointer text-lg font-semibold">Excel / CSV 가져오기</summary>
    <fieldset disabled={busy} className="mt-4 space-y-4">
      <p className="text-sm text-zinc-600">파일의 키워드를 Keyword Pool에 추가합니다. 매핑과 Preview를 확인한 뒤 Import하세요.</p>
      <label className="block">대상 Product *<select aria-label="Import Product" value={productId} onChange={event => { setProductId(event.target.value); remember(event.target.value, source); setSummary(null); }} className="ml-3 rounded border p-2"><option value="">선택</option>{products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
      <label className="block">파일<input aria-label="Import 파일" type="file" accept=".xlsx,.csv" className="ml-3" onChange={event => { setFile(event.target.files?.[0] ?? null); setColumns([]); setMapping({}); setSummary(null); setError(""); setMessage(""); }} /></label>
      <p className="text-sm text-zinc-500">첫 sheet·첫 행은 헤더. 빈 헤더 열도 선택 가능. 10MB / 10,000행 / 100열까지 지원합니다.</p>
      <label className="block">출처<input aria-label="Import 출처" maxLength={200} value={source} onChange={event => { setSource(event.target.value); remember(productId, event.target.value); setSummary(null); }} className="ml-3 rounded border p-2" placeholder="선택 입력" /></label>
      <button type="button" onClick={() => void run("inspect")} disabled={!productId || !file} className="rounded border px-3 py-2 disabled:opacity-50">파일 읽기 / 자동 매핑</button>
      {columns.length > 0 && <div className="overflow-auto"><table className="w-full text-sm"><thead><tr><th>원본 열</th><th>샘플</th><th>표준 필드</th></tr></thead><tbody>{columns.map(column => <tr key={column.index}>
        <td className="p-2">{column.label}</td><td className="max-w-xs break-words p-2">{column.samples.join(" / ")}</td><td><select aria-label={`${column.label} 매핑`} value={Object.entries(mapping).find(([, index]) => index === column.index)?.[0] ?? ""} onChange={event => {
          const next = { ...mapping }; for (const field of Object.keys(next) as KeywordField[]) if (next[field] === column.index) delete next[field];
          if (event.target.value) next[event.target.value as KeywordField] = column.index;
          setMapping(next); setSummary(null);
        }} className="rounded border p-2"><option value="">매핑 안 함 (raw 보존)</option>{Object.entries(KEYWORD_FIELDS).map(([field, label]) => <option key={field} value={field}>{label} · {field}</option>)}</select></td>
      </tr>)}</tbody></table><button type="button" onClick={() => void run("preview")} disabled={mapping.keyword === undefined} className="mt-3 rounded border px-3 py-2 disabled:opacity-50">Preview</button></div>}
      {summary && <div className="space-y-3">
        <p>전체 {summary.totalRows}행 · 유효 {summary.validRows}행 · 빈/초과길이 keyword 제외 {summary.skippedRows}행</p>
        <p>파일 내 중복 {summary.fileDuplicateRows}행 · 기존 중복 {summary.existingRows}개 · 신규 예정 {summary.inserts}개 · update 예정 {summary.updates}개</p>
        <p className="text-sm">잘못된 숫자 {summary.invalidMetricCells}개는 빈 값으로 처리합니다. 중복은 파일의 마지막 행을 사용합니다. 빈 metric은 기존 값을 덮어쓰지 않습니다. 동시 import 시 예정 수는 달라질 수 있습니다.</p>
        <div className="overflow-auto"><table className="text-sm"><thead><tr><th>선택된 키워드</th><th>총 검색량</th><th>경쟁도</th></tr></thead><tbody>{summary.samples.map((row, index) => <tr key={index}><td className="p-2">{row.keyword}</td><td>{row.search_volume ?? "-"}</td><td>{row.competition ?? "-"}</td></tr>)}</tbody></table></div>
        <button type="button" onClick={() => void run("import")} disabled={!summary.validRows} className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">Import</button>
      </div>}
    </fieldset>
    {busy && <p role="status" className="mt-3">처리 중…</p>}{error && <p role="alert" className="mt-3 text-red-600">{error}</p>}{message && <p role="status" className="mt-3">{message}</p>}
    <section aria-label="최근 Import" className="mt-5 border-t pt-4"><h3 className="font-semibold">최근 Import</h3>
      {historyError && <p role="alert" className="text-sm text-red-600">{historyError}</p>}
      {!historyError && !runs.length && <p className="text-sm text-zinc-500">저장된 Import 이력이 없습니다.</p>}
      <ul className="mt-2 space-y-3 text-sm">{runs.map(run => <li key={run.id}>
        <p>{new Date(run.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>
        <p>{products.find(product => product.id === run.product_id)?.name ?? "삭제된 Product"} · {run.source_filename} · {run.source || "출처 없음"}</p>
        <p>{run.total_rows.toLocaleString("ko-KR")}행 / 신규 {run.inserted_count.toLocaleString("ko-KR")} / 업데이트 {run.updated_count.toLocaleString("ko-KR")}</p>
      </li>)}</ul>
    </section>
  </details>;
}
