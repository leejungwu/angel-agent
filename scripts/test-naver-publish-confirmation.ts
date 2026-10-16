/**
 * Read-only: npx.cmd tsx scripts/test-naver-publish-confirmation.ts
 * Open the Naver reservation list yourself before running. Requires local Chrome CDP.
 * FINAL PUBLISH BUTTON MUST NOT BE CLICKED. No navigation, clicks, input or DB access.
 */
import assert from "node:assert/strict";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

type Expected = { title: string; date: string; time: string };
type Context = { id: number; auxData?: { isDefault?: boolean; frameId?: string } };

// Runs inside each default document context. Never return article body or arbitrary HTML.
function inspectConfirmation(expected: Expected) {
  const normalize = (value: string) => value.replace(/[\s\u200B-\u200D\uFEFF]+/g, "");
  const short = (value: string | null) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const visible = (element: Element) => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hasAttribute("hidden") || style.display === "none" || style.visibility === "hidden") return false;
    }
    return element.getClientRects().length > 0;
  };
  const describe = (element: Element) => {
    const selectors: string[] = [];
    for (const name of ["data-testid", "aria-label", "title", "role"]) {
      const value = element.getAttribute(name);
      if (value) selectors.push(`${element.tagName.toLowerCase()}[${name}=${JSON.stringify(value)}]`);
    }
    if (element.id) selectors.push(`#${CSS.escape(element.id)}`);
    return { tag: element.tagName, text: short(element.textContent), id: element.id,
      role: element.getAttribute("role"), ariaLabel: element.getAttribute("aria-label"),
      title: element.getAttribute("title"), testId: element.getAttribute("data-testid"),
      className: element.getAttribute("class"), selectors, visible: visible(element) };
  };
  const elements = Array.from(document.querySelectorAll("body *"));
  const leafMatches = (pattern: RegExp) => elements.filter(element =>
    !element.closest(".se-text-paragraph,script,style") && pattern.test(element.textContent ?? "") &&
    !Array.from(element.children).some(child => pattern.test(child.textContent ?? "")));
  const heading = leafMatches(/예약\s*발행\s*글/);
  const counts = leafMatches(/총\s*\d+\s*개/);
  const dates = leafMatches(/20\d{2}\s*[.년/-]\s*\d{1,2}\s*[.월/-]\s*\d{1,2}/);
  const times = leafMatches(/\b\d{1,2}:\d{2}\b/);
  const titleLeaves = elements.filter(element => !element.closest(".se-text-paragraph,script,style") &&
    normalize(element.textContent ?? "") === normalize(expected.title) &&
    !Array.from(element.children).some(child => normalize(child.textContent ?? "") === normalize(expected.title)));
  const [year, month, day] = expected.date.split("-").map(Number);
  const [hour, minute] = expected.time.split(":").map(Number);
  const dateMatches = (text: string) => Array.from(text.matchAll(/(20\d{2})\s*[.년/-]\s*(\d{1,2})\s*[.월/-]\s*(\d{1,2})/g))
    .some(match => Number(match[1]) === year && Number(match[2]) === month && Number(match[3]) === day);
  const timeMatches = (text: string) => Array.from(text.matchAll(/(?:(오전|오후|AM|PM)\s*)?(\d{1,2}):(\d{2})/gi)).some(match => {
    let actualHour = Number(match[2]);
    if (match[1]) actualHour = actualHour % 12 + (/오후|PM/i.test(match[1]) ? 12 : 0);
    return actualHour === hour && Number(match[3]) === minute;
  });
  const entries = titleLeaves.slice(0, 30).map(title => {
    const ancestors: ReturnType<typeof describe>[] = [];
    let candidate: Element | null = null;
    // Smallest common ancestor containing all three values is only a candidate, not proven entry identity.
    for (let node = title.parentElement, depth = 0; node && !node.matches("body,html") && depth < 7; node = node.parentElement, depth++) {
      const text = node.textContent ?? "";
      if (text.length > 4000 || node.querySelector(".se-text-paragraph")) break;
      ancestors.push(describe(node));
      if (!candidate && dateMatches(text) && timeMatches(text)) candidate = node;
    }
    const text = candidate?.textContent ?? "";
    const dateCount = Array.from(text.matchAll(/20\d{2}\s*[.년/-]\s*\d{1,2}\s*[.월/-]\s*\d{1,2}/g)).length;
    return { title: describe(title), ancestors, matchingContainer: candidate ? describe(candidate) : null,
      sameContainerTitleDateTime: !!candidate, dateCount,
      entryBoundaryConfirmed: false,
      limitation: "공통 조상이 여러 entry를 포함할 수 있음. 실제 row 경계와 중복 entry를 사람이 확인해야 함." };
  });
  const success = elements.filter(element => element.matches('[role="alert"],[role="status"],dialog,[role="dialog"]') &&
    /예약|발행/.test(element.textContent ?? "") && /완료|성공|등록되었|등록됐/.test(element.textContent ?? ""));
  return { url: location.href, documentTitle: document.title,
    editor: { editorFramePresent: !!document.querySelector(".se-text-paragraph"),
      titleFieldPresent: !!document.querySelector(".se-documentTitle"), bodyPresent: !!document.querySelector(".se-text-paragraph"),
      publishSettingsPanelPresent: !!document.querySelector('[data-focus-lock="publishLayer"]'),
      finalPublishButtonPresent: !!document.querySelector('[data-testid="seOnePublishBtn"]') },
    reservationUI: { headings: heading.slice(0, 20).map(describe), counts: counts.slice(0, 20).map(describe),
      dates: dates.slice(0, 50).map(describe), times: times.slice(0, 50).map(describe), entries,
      matchingContainerCount: entries.filter(entry => entry.sameContainerTitleDateTime).length },
    successMessages: success.slice(0, 20).map(describe) };
}

async function main() {
  const terminal = createInterface({ input: stdin, output: stdout });
  let socket: WebSocket | undefined;
  try {
    const option = process.argv.indexOf("--cdp");
    const endpoint = new URL(option < 0 ? "http://127.0.0.1:9222" : process.argv[option + 1]);
    assert.ok(endpoint.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname), "Local CDP only");
    const expected = { title: (await terminal.question("확인할 예약 글 제목: ")).trim(),
      date: (await terminal.question("예약 날짜 YYYY-MM-DD (KST): ")).trim(),
      time: (await terminal.question("예약 시간 HH:mm (24시간 KST): ")).trim() };
    assert.ok(expected.title && /^\d{4}-\d{2}-\d{2}$/.test(expected.date) && /^([01]\d|2[0-3]):[0-5]\d$/.test(expected.time), "제목/날짜/시간 형식 오류");
    assert.equal(new Date(`${expected.date}T00:00:00Z`).toISOString().slice(0, 10), expected.date, "유효하지 않은 날짜");
    await terminal.question("네이버 예약 목록을 직접 열어둔 뒤 Enter. 스크립트는 클릭하지 않습니다: ");
    const response = await fetch(new URL("/json/list", endpoint), { signal: AbortSignal.timeout(5000) });
    assert.ok(response.ok, "Chrome CDP target lookup failed");
    const targets = (await response.json() as { type: string; url: string; title: string; webSocketDebuggerUrl: string }[])
      .filter(target => target.type === "page" && /^https:\/\/blog\.naver\.com\//.test(target.url));
    assert.ok(targets.length, "네이버 탭이 없습니다. localhost CDP 포트를 확인하세요.");
    targets.forEach((target, index) => console.log(JSON.stringify({ index, url: target.url, title: target.title })));
    const choice = (await terminal.question("읽을 탭 번호: ")).trim();
    assert.ok(/^\d+$/.test(choice) && targets[Number(choice)], "Invalid tab");
    socket = new WebSocket(targets[Number(choice)].webSocketDebuggerUrl);
    const connection = socket;
    await new Promise<void>((resolve, reject) => {
      connection.addEventListener("open", () => resolve(), { once: true });
      connection.addEventListener("error", () => reject(new Error("CDP connection failed")), { once: true });
    });
    let sequence = 0;
    const contexts = new Map<number, Context>();
    const pending = new Map<number, { resolve: (result: Record<string, unknown>) => void; reject: (error: Error) => void }>();
    connection.addEventListener("message", event => {
      const message = JSON.parse(String(event.data));
      if (message.method === "Runtime.executionContextCreated") {
        const context = message.params.context as Context;
        if (context.auxData?.isDefault) contexts.set(context.id, context);
      }
      if (message.method === "Runtime.executionContextDestroyed") contexts.delete(message.params.executionContextId);
      if (message.method === "Runtime.executionContextsCleared") contexts.clear();
      const request = pending.get(message.id);
      if (request) {
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
      }
    });
    // Read-only CDP allowlist. FINAL PUBLISH BUTTON MUST NOT BE CLICKED.
    async function send(method: "Runtime.enable" | "Page.getFrameTree" | "Runtime.evaluate", params: Record<string, unknown> = {}) {
      const id = ++sequence;
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)); }, 10000);
        pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
        connection.send(JSON.stringify({ id, method, params }));
      });
    }
    assert.ok(!/\.click\s*\(|dispatchEvent\s*\(|\.value\s*=/.test(inspectConfirmation.toString()), "DOM inspection must remain read-only");
    await send("Runtime.enable");
    type FrameTree = { frame: { id: string; url: string }; childFrames?: FrameTree[] };
    const tree = (await send("Page.getFrameTree")).frameTree as FrameTree;
    const frames: { id: string; url: string }[] = [];
    const collect = (node: FrameTree) => { frames.push(node.frame); node.childFrames?.forEach(collect); };
    collect(tree);
    const reports = [];
    const errors = [];
    for (const context of contexts.values()) {
      try {
        const result = await send("Runtime.evaluate", { contextId: context.id, returnByValue: true,
          expression: `(() => { const __name = value => value; return (${inspectConfirmation.toString()})(${JSON.stringify(expected)}); })()` });
        assert.ok(!result.exceptionDetails, "Document context changed or inspection failed");
        reports.push({ frameId: context.auxData?.frameId, contextId: context.id,
          ...(result.result as { value: ReturnType<typeof inspectConfirmation> }).value });
      } catch { errors.push({ contextId: context.id, error: "DOM scan failed; context may have navigated" }); }
    }
    const writing = (url: string) => /PostWriteForm\.naver|\/postwrite(?:\?|$|\/)/i.test(url);
    const top = reports.find(report => report.frameId === tree.frame.id);
    const signals = [
      { signal: "PostWriteForm URL에서 벗어남", observed: !frames.some(frame => writing(frame.url)), reliability: "low", reason: "현재 상태만 관찰. 이전 URL·성공 인과관계는 모름." },
      { signal: "editor frame 없음", observed: !reports.some(report => report.editor.editorFramePresent), reliability: "low", reason: "읽지 못한 iframe·다른 탭·오류 전환도 가능." },
      { signal: "예약 목록 제목 일치", observed: reports.some(report => report.reservationUI.entries.length > 0), reliability: "low", reason: "중복 제목 또는 목록 외 제목일 수 있음." },
      { signal: "같은 container의 제목+날짜+시간 일치", observed: reports.some(report => report.reservationUI.matchingContainerCount > 0), reliability: "medium", reason: "entry 경계·목록 소속·단일 일치를 실측 확인해야 함. 동일 조합의 기존 예약도 가능." },
      { signal: "예약 성공 alert/status/dialog", observed: reports.some(report => report.successMessages.some(item => item.visible)), reliability: "medium", reason: "일반 문구 후보일 뿐. 해당 Job과의 연관·실제 성공 문구 실측 필요." },
      { signal: "final publish layer 없음", observed: !reports.some(report => report.editor.publishSettingsPanelPresent), reliability: "low", reason: "닫힘·취소·다른 화면도 동일. 이전 상태 없으므로 닫힘 전이는 입증하지 못함." },
    ];
    console.log(JSON.stringify({ diagnostic: "NAVER PUBLISH CONFIRMATION — READ ONLY", expected,
      topPage: { url: tree.frame.url, title: top?.documentTitle ?? null, frameCount: frames.length,
        postWriteFormFramePresent: frames.some(frame => writing(frame.url)) }, frames, reports, errors, signals,
      decision: "확인 필요 — 진단 후보만 출력하며 Job 성공/DB 상태는 변경하지 않음",
      limitations: ["실행 시점 snapshot만 수집. 최종 클릭 전후 변화는 입증하지 못함.",
        "별도 프로세스 iframe은 이 page session에 없을 수 있음. frame/context 대응 확인 필요.",
        "목록 페이지네이션·가상화로 DOM에 없는 entry는 미등록 증거가 아님.",
        "같은 제목+날짜+시간도 중복 가능. pre-click baseline 또는 예약 고유 ID가 필요."] }, null, 2));
  } finally { socket?.close(); terminal.close(); }
}

main().catch(error => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : "진단 실패", finalPublishClicked: false }));
  process.exitCode = 1;
});
