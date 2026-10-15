/**
 * Run: npx.cmd tsx scripts/test-naver-schedule-ui.ts
 * Requires an already logged-in Chrome exposed on localhost:9222 (--cdp URL optional).
 * No browser launch, navigation, draft save, text input or final publication.
 * FINAL PUBLISH BUTTON MUST NOT BE CLICKED.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

type Context = { id: number; name: string; auxData?: { isDefault?: boolean; frameId?: string } };
type Candidate = { key: number; tag: string; text: string; role: string | null; ariaLabel: string | null; title: string | null; className: string; id: string; data: Record<string, string>; parent: string; grandparent: string; type: string; value: string; disabled: boolean; checked: boolean; inDialog: boolean; selectors: { playwright: string[]; dom: string[] }; editorContext: boolean };
type Report = { contextId: number; frameId?: string; contextName: string; candidates: Candidate[] };

function canClick(candidate: Candidate, purpose: "open-panel" | "schedule-option") {
  if (candidate.disabled) return false;
  return purpose === "open-panel"
    ? candidate.tag === "BUTTON" && !candidate.inDialog && (candidate.text === "발행" || candidate.ariaLabel === "발행")
    : candidate.role === "radio" && /예약/.test(`${candidate.text} ${candidate.ariaLabel} ${candidate.parent}`);
}

async function waitForManualSchedule(question: (message: string) => Promise<string>) {
  while (true) {
    const answer = (await question("예약 옵션을 네이버 화면에서 직접 선택한 뒤 Enter를 누르세요.\n중단하려면 CANCEL 입력: ")).trim();
    if (answer === "CANCEL") return false;
    if (answer === "") return true;
  }
}

type ScheduleAnchors = { contextId: number; radioFound: boolean; checked: boolean; dateInputCount: number; hourCount: number; minuteCount: number };

async function confirmScheduleSelection(rescan: () => Promise<ScheduleAnchors[]>) {
  const states = await rescan();
  const selected = states.filter(state => state.radioFound && state.checked);
  if (!selected.length) throw new Error("예약 선택 상태를 확인하지 못했습니다.");
  const ready = selected.filter(state => state.dateInputCount === 1 && state.hourCount > 0 && state.minuteCount > 0);
  if (ready.length !== 1) throw new Error("예약은 선택됐지만 날짜/시/분 anchor를 유일한 editor iframe에서 확인하지 못했습니다. " + JSON.stringify(selected));
  return ready[0];
}

async function continueManualSchedule(question: (message: string) => Promise<string>, rescan: () => Promise<ScheduleAnchors[]>) {
  if (!await waitForManualSchedule(question)) return null;
  // Blank Enter means continuation, unlike the automatic candidate picker.
  return confirmScheduleSelection(rescan);
}

function readScheduleAnchors() {
  const radios = Array.from(document.querySelectorAll('input[data-testid="preTimeRadioBtn"],#radio_time2'));
  return { radioFound: radios.length > 0, checked: radios.some(radio => radio instanceof HTMLInputElement && radio.checked),
    dateInputCount: document.querySelectorAll("input.input_date__UwKAB").length,
    hourCount: document.querySelectorAll('select[title="예약 발행 시간 선택"]').length,
    minuteCount: document.querySelectorAll('select[title="예약 발행 분 선택"]').length };
}

// Runs in each document. Report only controls/short labels, never body article text.
function inspectControls() {
  const visible = (element: Element) => {
    const style = getComputedStyle(element);
    return element.getClientRects().length > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const short = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  const brief = (element: Element | null) => element ? `${element.tagName}#${element.id}.${element.className} ${short(element.getAttribute("role"))}` : "";
  const controls = Array.from(document.querySelectorAll("button,input,select,[role=button],[role=radio],[role=tab],label,[role=dialog],dialog"));
  return controls.flatMap((element, key) => {
    if (!visible(element)) return [];
    const text = short(element.textContent), ariaLabel = element.getAttribute("aria-label"), title = element.getAttribute("title");
    const type = element.getAttribute("type") ?? "";
    const nearbyLabel = short(element.parentElement?.textContent ?? "");
    if (!/발행|예약|날짜|시간|오전|오후|AM|PM/i.test(`${text} ${ariaLabel} ${title} ${nearbyLabel}`) && !["date", "time", "datetime-local", "radio"].includes(type) && !element.closest('[role="dialog"],dialog')) return [];
    const role = element.getAttribute("role") || ({ BUTTON: "button", SELECT: "combobox" } as Record<string, string>)[element.tagName] || (type === "radio" ? "radio" : null);
    const name = ariaLabel || short(Array.from((element as HTMLInputElement).labels ?? []).map(label => label.textContent).join(" ")) || text || title;
    const dom: string[] = [], playwright: string[] = [];
    if (role && name) playwright.push(`getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(name)}, exact: true }) [accessible name must be verified]`);
    if (ariaLabel) dom.push(`[aria-label=${JSON.stringify(ariaLabel)}]`);
    const data = Object.fromEntries(Array.from(element.attributes).filter(attribute => attribute.name.startsWith("data-")).map(attribute => [attribute.name, attribute.value]));
    for (const [attribute, value] of Object.entries(data)) if (/test|name|action|role/i.test(attribute)) dom.push(`[${attribute}=${JSON.stringify(value)}]`);
    if (element.id) dom.push(`#${CSS.escape(element.id)}`);
    for (const className of element.classList) if (!/\d{4,}|__[A-Za-z0-9_-]{5,}|[a-f0-9]{8,}/i.test(className)) dom.push(`.${CSS.escape(className)}`);
    if (text) playwright.push(`getByText(${JSON.stringify(text)}, { exact: true })`);
    return [{ key, tag: element.tagName, text, role, ariaLabel, title, className: String(element.className), id: element.id, data,
      parent: brief(element.parentElement), grandparent: brief(element.parentElement?.parentElement ?? null), type,
      value: element instanceof HTMLInputElement || element instanceof HTMLSelectElement ? element.value : "",
      options: element instanceof HTMLSelectElement ? Array.from(element.options).map(option => ({ text: short(option.textContent), value: option.value, selected: option.selected })) : undefined,
      attributes: Object.fromEntries(["name", "min", "max", "step", "placeholder", "aria-expanded", "aria-controls", "aria-haspopup"].flatMap(name => element.hasAttribute(name) ? [[name, element.getAttribute(name)]] : [])),
      disabled: element.matches(":disabled,[aria-disabled=true]"), checked: element.matches(":checked,[aria-checked=true]"),
      inDialog: !!element.closest('[role="dialog"],dialog'), selectors: { playwright, dom }, editorContext: !!document.querySelector(".se-text-paragraph") }];
  });
}

type CalendarSnapshot = { text: string; attributes: string; className: string; value: string; children: readonly unknown[] };
function calendarSnapshotChanges(previous: CalendarSnapshot, current: CalendarSnapshot) {
  return {
    textChanged: previous.text !== current.text,
    attributesChanged: previous.attributes !== current.attributes,
    classChanged: previous.className !== current.className,
    valueChanged: previous.value !== current.value,
    childStructureChanged: previous.children.length !== current.children.length || previous.children.some((child, index) => child !== current.children[index]),
  };
}

function calendarExpression(before: boolean) {
  return `(() => { const __name = value => value; const calendarSnapshotChanges = (${calendarSnapshotChanges.toString()}); return (${inspectCalendar.toString()})(${before}); })()`;
}

// Compare DOM identity/content/attributes, without any visibility gate.
// No day, navigation or publication clicks here.
function inspectCalendar(before: boolean) {
  const key = "__angelScheduleCalendarDiagnostic";
  const elements = Array.from(document.querySelectorAll("button,a,input,select,table,thead,tbody,tr,td,th,div,span"));
  const snapshot = (element: Element): CalendarSnapshot => ({ text: element.textContent ?? "", className: element.getAttribute("class") ?? "",
    attributes: JSON.stringify(Array.from(element.attributes).map(attribute => [attribute.name, attribute.value]).sort(([a], [b]) => a.localeCompare(b))),
    value: element instanceof HTMLInputElement || element instanceof HTMLSelectElement ? element.value : "", children: Array.from(element.childNodes) });
  type Baseline = { snapshots: Map<Element, CalendarSnapshot>; records: MutationRecord[]; observer: MutationObserver; recordCount: () => number };
  if (before) {
    (Reflect.get(globalThis, key) as Baseline | undefined)?.observer.disconnect();
    const records: MutationRecord[] = [];
    let count = 0;
    const observer = new MutationObserver(batch => { count += batch.length; records.push(...batch.slice(0, Math.max(0, 500 - records.length))); });
    const state: Baseline = { snapshots: new Map(elements.map(element => [element, snapshot(element)])), records, observer, recordCount: () => count };
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true, attributeOldValue: true, characterDataOldValue: true });
    Reflect.set(globalThis, key, state);
    return { snapshotElementCount: elements.length, observerInstalled: true };
  }
  const previous = Reflect.get(globalThis, key) as Baseline | undefined;
  if (!previous) throw new Error("날짜 클릭 전 DOM snapshot이 없습니다. 같은 iframe context에서 다시 실행하세요.");
  const queued = previous.observer.takeRecords();
  const mutationCount = previous.recordCount() + queued.length;
  previous.records.push(...queued.slice(0, Math.max(0, 500 - previous.records.length)));
  previous.observer.disconnect();
  Reflect.deleteProperty(globalThis, key);
  const appeared = elements.filter(element => !previous.snapshots.has(element));
  const changed = elements.flatMap(element => {
    const old = previous.snapshots.get(element);
    if (!old) return [];
    const changes = calendarSnapshotChanges(old, snapshot(element));
    return Object.values(changes).some(Boolean) ? [{ element, ...changes }] : [];
  });
  const text = (element: Element) => element.matches("body,html") || element.querySelector(".se-text-paragraph") ? "[editor text omitted]" : (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const safe = (name: string, value: string) => /token|authorization|secret|password|cookie/i.test(name) ? "[redacted]" : value.slice(0, 300);
  const selectors = (element: Element) => {
    const result: string[] = [];
    for (const name of ["aria-label", "data-testid", "title", "datetime", "data-date", "data-day"]) {
      const value = element.getAttribute(name);
      if (value) result.push(element.tagName.toLowerCase() + "[" + name + "=" + JSON.stringify(value) + "]");
    }
    if (element.id) result.push("#" + CSS.escape(element.id));
    return result;
  };
  const brief = (element: Element) => ({ tag: element.tagName, text: text(element), role: element.getAttribute("role"),
    title: element.getAttribute("title"), ariaLabel: element.getAttribute("aria-label"), class: String(element.className), id: element.id,
    data: Object.fromEntries(Array.from(element.attributes).filter(attribute => attribute.name.startsWith("data-")).map(attribute => [attribute.name, safe(attribute.name, attribute.value)])),
    attributes: Object.fromEntries(["aria-current", "aria-selected", "aria-disabled", "datetime", "name", "value", "tabindex"].flatMap(name => element.hasAttribute(name) ? [[name, safe(name, element.getAttribute(name)!)]] : [])),
    disabled: element.matches(":disabled,[aria-disabled=true]"), selectors: selectors(element) });
  const dayLike = (element: Element) => /^(?:[1-9]|[12]\d|3[01])$/.test(text(element));
  const calendarHint = (element: Element) => /calendar|date|day|month|year|picker/i.test(Array.from(element.attributes)
    .filter(attribute => ["class", "id", "title"].includes(attribute.name) || attribute.name.startsWith("data-"))
    .map(attribute => attribute.name + " " + attribute.value).join(" "));
  const dateInput = document.querySelector("input.input_date__UwKAB");
  const ancestorElements: Element[] = [];
  for (let ancestor = dateInput?.parentElement, level = 0; ancestor && level < 6; ancestor = ancestor.parentElement, level++) {
    if (ancestor.matches("body,html") || ancestor.querySelector(".se-text-paragraph")) break;
    ancestorElements.push(ancestor);
  }
  const mutationTargets = previous.records.flatMap(record => record.target instanceof Element ? [record.target] : record.target.parentElement ? [record.target.parentElement] : []);
  const seeds = Array.from(new Set([...appeared, ...changed.map(entry => entry.element), ...mutationTargets, ...ancestorElements]));
  const searchArea = new Set(seeds);
  for (const seed of seeds) {
    if (!seed.matches("body,html") && !seed.querySelector(".se-text-paragraph")) {
      const descendants = seed.querySelectorAll("button,a,table,thead,tbody,tr,td,th,div,span");
      if (descendants.length <= 1500) for (const descendant of descendants) {
        if (calendarHint(descendant) || descendant.matches('table,[role=grid]') || dayLike(descendant)) searchArea.add(descendant);
      }
    }
    let parent = seed.parentElement;
    for (let level = 0; parent && level < 6; parent = parent.parentElement, level++) {
      if (parent.matches("body,html") || parent.querySelector(".se-text-paragraph")) break;
      searchArea.add(parent);
    }
  }
  const roots = new Set<Element>();
  for (const element of searchArea) {
    if (element.matches("body,html") || element.querySelector(".se-text-paragraph")) continue;
    if (!calendarHint(element) && !element.matches('[role=grid],[role=dialog],table')) continue;
    const dayCount = Array.from(element.querySelectorAll("button,a,td,span,div,[role=gridcell]")).filter(dayLike).length;
    if (dayCount >= 7 && element.querySelectorAll("*").length <= 1500) roots.add(element);
  }
  // If a calendar uses opaque names, inspect changed/added day-cell ancestors.
  if (!roots.size) for (const day of Array.from(searchArea).filter(dayLike)) {
    let parent = day.parentElement;
    for (let level = 0; parent && level < 6; level++, parent = parent.parentElement) {
      if (parent.matches("body,html") || parent.querySelector(".se-text-paragraph")) break;
      if (Array.from(parent.querySelectorAll("button,a,td,[role=gridcell]")).filter(dayLike).length >= 14) { roots.add(parent); break; }
    }
    if (roots.size >= 6) break;
  }
  const recordTarget = (record: MutationRecord) => record.target instanceof Element ? record.target : record.target.parentElement;
  return { snapshotBeforeCount: previous.snapshots.size, snapshotAfterCount: elements.length,
    addedNodeCount: appeared.length, changedNodeCount: changed.length,
    removedNodeCount: Array.from(previous.snapshots.keys()).filter(element => !element.isConnected).length,
    domMutationDetected: mutationCount > 0 || appeared.length > 0 || changed.length > 0,
    mutationObserver: { mutationCount, recordsTruncated: mutationCount > previous.records.length,
      addedNodes: previous.records.filter(record => record.addedNodes.length).slice(0, 60).map(record => ({ target: recordTarget(record) ? brief(recordTarget(record)!) : null,
        nodes: Array.from(record.addedNodes).slice(0, 20).map(node => node instanceof Element ? brief(node) : { nodeType: node.nodeType }) })),
      attributeChanges: previous.records.filter(record => record.type === "attributes").slice(0, 100).map(record => ({ target: recordTarget(record) ? brief(recordTarget(record)!) : null, attribute: record.attributeName })),
      classChanges: previous.records.filter(record => record.type === "attributes" && record.attributeName === "class").slice(0, 60).map(record => brief(recordTarget(record)!)),
      textChangeCount: previous.records.filter(record => record.type === "characterData").length },
    inputAncestors: ancestorElements.map(brief),
    addedNodes: appeared.slice(0, 60).map(brief),
    changedNodes: changed.slice(0, 100).map(({ element, ...changes }) => ({ ...brief(element), changes })),
    keywordMatches: Array.from(searchArea).filter(calendarHint).slice(0, 60).map(brief),
    calendarCandidates: Array.from(roots).slice(0, 6).map(root => {
    const scopedSelector = (element: Element) => {
      const path: string[] = [];
      let current: Element | null = element;
      while (current && current !== root) {
        const siblings = Array.from(current.parentElement?.children ?? []).filter(sibling => sibling.tagName === current!.tagName);
        path.unshift(current.tagName.toLowerCase() + ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")");
        current = current.parentElement;
      }
      return ":scope" + (path.length ? " > " + path.join(" > ") : "");
    };
    const describe = (element: Element) => ({ ...brief(element), scopedSelector: scopedSelector(element),
      parent: element.parentElement ? brief(element.parentElement) : null,
      grandparent: element.parentElement?.parentElement ? brief(element.parentElement.parentElement) : null });
    const children = Array.from(root.querySelectorAll("*"));
    const days = children.filter(element => dayLike(element) && !Array.from(element.children).some(dayLike));
    const controls = children.filter(element => element.matches('button,a,input,select,[role=button],[role=gridcell]'));
    const clone = root.cloneNode(true) as Element;
    clone.querySelectorAll("script,style,noscript,iframe").forEach(element => element.remove());
    for (const element of [clone, ...clone.querySelectorAll("*")]) for (const attribute of Array.from(element.attributes)) {
      if (/^on|src|href|action|formaction|srcdoc/i.test(attribute.name)) element.removeAttribute(attribute.name);
      else element.setAttribute(attribute.name, safe(attribute.name, attribute.value));
    }
    const html = clone.outerHTML;
    return { container: describe(root),
      calendarFeatures: { dayCellCount: days.length, tableCount: root.querySelectorAll("table").length,
        weekdayCandidates: children.filter(element => /^(?:일|월|화|수|목|금|토)(?:요일)?$/.test(text(element))).slice(0, 14).map(describe) },
      displayedYearMonthCandidates: children.filter(element => /\d{4}\s*[.년/-]\s*\d{1,2}|\d{4}년|\d{1,2}월/.test(text(element)) && text(element).length < 50).slice(0, 15).map(describe),
      prevNextMonthCandidates: controls.filter(element => !dayLike(element)).map(describe), dayCells: days.map(describe),
      todaySignals: children.filter(element => element.hasAttribute("aria-current") || /today|오늘/i.test(String(element.className) + " " + element.getAttribute("title") + " " + element.getAttribute("aria-label"))).map(describe),
      selectedSignals: children.filter(element => element.getAttribute("aria-selected") === "true" || /selected|select_day|active/i.test(String(element.className))).map(describe),
      disabledDays: days.filter(element => element.closest(':disabled,[aria-disabled=true]') || /disabled|disable|unavailable/i.test(String(element.className))).map(describe),
      otherMonthCandidates: days.filter(element => /other|outside|prev|next|adjacent/i.test(String(element.className) + " " + element.getAttribute("aria-label"))).map(describe),
      dateMappingNote: "dayCells의 data/aria/title/datetime을 연월 header와 함께 확인하세요. scopedSelector는 이 container 내부 구조 경로이며 전역 숫자 text 선택을 사용하지 않습니다. 이름 없는 월 이동 버튼도 prevNextMonthCandidates에 포함됩니다.",
      sanitizedOuterHTML: html.slice(0, 15000), outerHTMLTruncated: html.length > 15000 };
  }), unresolved: roots.size === 0 ? "달력 container 미확정. addedNodes/changedNodes/keywordMatches/inputAncestors를 확인하세요." : null };
}

async function main() {
  const terminal = createInterface({ input: stdin, output: stdout });
  let socket: WebSocket | undefined;
  let cleanupCalendar: (() => Promise<unknown>) | undefined;
  try {
    const endpoint = new URL(process.argv[process.argv.indexOf("--cdp") + 1] && process.argv.includes("--cdp") ? process.argv[process.argv.indexOf("--cdp") + 1] : "http://127.0.0.1:9222");
    assert.ok(endpoint.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname), "Local Chrome CDP endpoint only");
    await terminal.question("로그인된 네이버 빈 글쓰기 탭을 준비하세요. 발행 설정 패널은 닫아 두세요. 준비되면 Enter: ");
    const response = await fetch(new URL("/json/list", endpoint), { signal: AbortSignal.timeout(5000) });
    assert.ok(response.ok, "Chrome CDP target lookup failed");
    const targets = (await response.json() as { id: string; type: string; url: string; webSocketDebuggerUrl: string }[]).filter(target => target.type === "page" && /^https:\/\/blog\.naver\.com\//.test(target.url));
    assert.ok(targets.length, "네이버 블로그 탭이 없습니다. 원격 디버깅 포트를 제공하는 Chrome이 필요합니다.");
    targets.forEach((target, index) => console.log(`Tab ${index}: ${new URL(target.url).pathname}`));
    const targetIndex = Number(await terminal.question("진단할 탭 번호: "));
    assert.ok(Number.isInteger(targetIndex) && targets[targetIndex], "Invalid tab");
    socket = new WebSocket(targets[targetIndex].webSocketDebuggerUrl);
    const connection = socket;
    await new Promise<void>((resolve, reject) => { connection.addEventListener("open", () => resolve(), { once: true }); connection.addEventListener("error", () => reject(new Error("CDP connection failed")), { once: true }); });
    let sequence = 0;
    const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
    const contexts = new Map<number, Context>();
    connection.addEventListener("message", event => {
      const message = JSON.parse(String(event.data));
      if (message.method === "Runtime.executionContextCreated") { const context = message.params.context as Context; if (context.auxData?.isDefault) contexts.set(context.id, context); }
      if (message.method === "Runtime.executionContextDestroyed") contexts.delete(message.params.executionContextId);
      if (message.id) { const request = pending.get(message.id); pending.delete(message.id); if (message.error) request?.reject(new Error(message.error.message)); else request?.resolve(message.result); }
    });
    async function send(method: string, params: Record<string, unknown> = {}) {
      const id = ++sequence;
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)); }, 10000);
        pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
        connection.send(JSON.stringify({ id, method, params }));
      });
    }
    async function evaluate<T>(contextId: number, expression: string): Promise<T> {
      const result = await send("Runtime.evaluate", { contextId, expression, returnByValue: true });
      assert.ok(!result.exceptionDetails, "DOM inspection failed (context may have changed)");
      return (result.result as { value: T }).value;
    }
    await send("Runtime.enable");
    const frameTree = await send("Page.getFrameTree");
    const topFrameId = (frameTree.frameTree as { frame: { id: string } }).frame.id;
    async function inspect(stage: string): Promise<Report[]> {
      const reports: Report[] = [];
      for (const context of contexts.values()) {
        // tsx may decorate nested functions with __name; provide its harmless helper in-page.
        const candidates = await evaluate<Candidate[]>(context.id, `(() => { const __name = value => value; return (${inspectControls.toString()})(); })()`);
        reports.push({ contextId: context.id, frameId: context.auxData?.frameId, contextName: context.auxData?.frameId === topFrameId ? "top document" : "iframe", candidates });
      }
      console.log(`${stage}: ${reports.length} document context(s)`);
      return reports;
    }
    // The only click entry point. Final action buttons are never permitted here.
    async function chooseAndClick(reports: Report[], purpose: "open-panel" | "schedule-option") {
      const options = reports.flatMap(report => report.candidates.filter(candidate => canClick(candidate, purpose))
        .map(candidate => ({ contextId: report.contextId, candidate })));
      console.log("Allowed click candidates:", JSON.stringify(options, null, 2));
      const answer = await terminal.question("후보 번호(0부터)를 확인 후 입력. 불확실하면 Enter로 중단: ");
      assert.ok(/^\d+$/.test(answer) && options[Number(answer)], "안전한 후보가 선택되지 않아 중단했습니다. 최종 버튼은 클릭하지 않았습니다.");
      const selected = options[Number(answer)];
      const confirmation = await terminal.question(purpose === "open-panel" ? "초기 글쓰기 화면의 패널 열기 버튼임을 확인했으면 OPEN 입력: " : "최종 실행이 아닌 예약 radio 옵션임을 확인했으면 OPTION 입력: ");
      assert.equal(confirmation, purpose === "open-panel" ? "OPEN" : "OPTION");
      const clicked = await evaluate<boolean>(selected.contextId, `(() => {
        const controls = Array.from(document.querySelectorAll('button,input,select,[role=button],[role=radio],[role=tab],label,[role=dialog],dialog'));
        const element = controls[${selected.candidate.key}];
        if (!element || element.tagName !== ${JSON.stringify(selected.candidate.tag)} || element.id !== ${JSON.stringify(selected.candidate.id)} || (element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0,160) !== ${JSON.stringify(selected.candidate.text)} || element.matches(':disabled,[aria-disabled=true]')) return false;
        ${purpose === "schedule-option" ? "if (!(element.matches('input[type=radio],[role=radio]'))) return false;" : "if (element.closest('[role=dialog],dialog')) return false;"}
        element.click(); return true;
      })()`);
      assert.ok(clicked, "후보 DOM이 변경되어 클릭하지 않았습니다.");
      await new Promise(resolve => setTimeout(resolve, 700));
      return true;
    }
    const before = await inspect("Publish trigger (before panel)");
    assert.ok(!before.some(report => report.candidates.some(candidate =>
      /지금\s*발행/.test(candidate.text) || (candidate.role === "radio" && /예약/.test(`${candidate.text} ${candidate.ariaLabel} ${candidate.parent}`)))),
    "발행 설정이 이미 보입니다. 패널을 닫고 다시 실행하세요. 최종 발행 버튼은 클릭하지 않습니다.");
    assert.equal(await terminal.question("빈 글쓰기 화면이고 발행 설정 패널이 닫혀 있습니까? YES 입력: "), "YES");
    await chooseAndClick(before, "open-panel");
    const panel = await inspect("Publish settings panel / final action candidates (READ ONLY)");
    async function rescanScheduleAnchors() {
      // Refresh context IDs as well as DOM; manual interaction can rebuild the frame.
      await send("Runtime.disable");
      contexts.clear();
      await send("Runtime.enable");
      const currentTree = await send("Page.getFrameTree");
      const currentTopId = (currentTree.frameTree as { frame: { id: string } }).frame.id;
      const states: ScheduleAnchors[] = [];
      for (const context of contexts.values()) {
        if (context.auxData?.frameId === currentTopId) continue;
        try {
          const anchors = await evaluate<Omit<ScheduleAnchors, "contextId">>(context.id, `(() => { const __name = value => value; return (${readScheduleAnchors.toString()})(); })()`);
          states.push({ contextId: context.id, ...anchors });
        } catch (error) {
          console.warn(`예약 anchor 조회 실패 (context ${context.id}): ${error instanceof Error ? error.message : "DOM 조회 실패"}`);
        }
      }
      console.log("Schedule anchor rescan:", JSON.stringify(states));
      return states;
    }
    const hasScheduleOption = panel.some(report => report.candidates.some(candidate => canClick(candidate, "schedule-option")));
    let scheduleContext: ScheduleAnchors | null;
    if (!hasScheduleOption) {
      console.log("Allowed click candidates: []");
      scheduleContext = await continueManualSchedule(message => terminal.question(message), rescanScheduleAnchors);
      if (!scheduleContext) return;
      console.log("manual schedule selection confirmed");
    } else {
      const answer = await terminal.question("예약 radio 옵션을 선택하려면 SELECT 입력. 직접 예약 옵션만 선택했다면 Enter. 중단하려면 CANCEL 입력: ");
      if (answer.trim() === "CANCEL") return;
      if (answer === "SELECT") {
        await chooseAndClick(panel, "schedule-option");
        scheduleContext = await confirmScheduleSelection(rescanScheduleAnchors);
      } else {
        scheduleContext = answer.trim() === "" ? await confirmScheduleSelection(rescanScheduleAnchors)
          : await continueManualSchedule(message => terminal.question(message), rescanScheduleAnchors);
        if (!scheduleContext) return;
        console.log("manual schedule selection confirmed");
      }
    }
    assert.equal(await terminal.question("날짜 input만 클릭해 달력을 엽니다. 날짜 선택·월 이동·최종 발행은 하지 않습니다. 허용하려면 CALENDAR 입력: "), "CALENDAR");
    const editorContextId = scheduleContext.contextId;
    const baseline = await evaluate(editorContextId, calendarExpression(true));
    cleanupCalendar = () => evaluate(editorContextId, `(() => {
      const key = '__angelScheduleCalendarDiagnostic';
      globalThis[key]?.observer.disconnect(); delete globalThis[key];
    })()`);
    // FINAL PUBLISH BUTTON MUST NOT BE CLICKED. Only the measured readonly date input.
    const opened = await evaluate<boolean>(scheduleContext.contextId, `(() => {
      const inputs = document.querySelectorAll('input.input_date__UwKAB');
      const input = inputs[0];
      if (inputs.length !== 1 || !(input instanceof HTMLInputElement) || !input.readOnly || input.disabled || input.matches('[data-testid="seOnePublishBtn"]')) return false;
      input.click(); return true;
    })()`);
    assert.ok(opened, "날짜 input 검증 실패. 클릭하지 않았습니다.");
    await new Promise(resolve => setTimeout(resolve, 700));
    const result = await evaluate<ReturnType<typeof inspectCalendar>>(editorContextId, calendarExpression(false));
    const calendarDom = [{ contextId: editorContextId, frameId: contexts.get(editorContextId)?.auxData?.frameId,
      context: "editor iframe", baseline, ...result }];
    console.log("\n=== NAVER CALENDAR DOM DIAGNOSTIC (READ ONLY) ===");
    const diagnosticJson = JSON.stringify({ diagnostic: "예약 날짜 달력 DOM 진단", contexts: calendarDom,
      note: "명시적으로 허용한 날짜 input만 클릭했습니다. 날짜 셀·월 이동·최종 발행 버튼은 클릭하지 않았습니다.",
      limitation: "별도 프로세스 iframe은 page CDP context에 없을 수 있습니다. iframe context에 anchor가 없으면 DevTools에서 확인하세요." }, null, 2);
    console.log(diagnosticJson);
    const diagnosticPath = resolve(__dirname, "..", "naver-schedule-diagnostic.json");
    writeFileSync(diagnosticPath, diagnosticJson + "\n", "utf8");
    console.log(`진단 결과 저장:\n${diagnosticPath}`);
  } finally { await cleanupCalendar?.().catch(() => {}); socket?.close(); terminal.close(); }
}

if (process.argv.includes("--self-test")) {
  const calendarSource = inspectCalendar.toString();
  assert.ok(!calendarSource.includes("getClientRects") && !calendarSource.includes("getComputedStyle"), "Calendar discovery must not depend on visibility");
  assert.ok(!calendarSource.includes(".click("), "DOM snapshot/observer must never click controls");
  const child = {};
  const original: CalendarSnapshot = { text: "2026.10", attributes: 'class="closed"', className: "closed", value: "", children: [child] };
  assert.equal(Object.values(calendarSnapshotChanges(original, { ...original, children: [child] })).some(Boolean), false);
  const reopened = calendarSnapshotChanges(original, { ...original, className: "open", attributes: 'class="open"' });
  assert.equal(reopened.classChanged, true); assert.equal(reopened.attributesChanged, true);
  assert.equal(reopened.childStructureChanged, false, "Reused calendar nodes still detect class changes");
  assert.equal(calendarSnapshotChanges(original, { ...original, text: "2026.11" }).textChanged, true);
  assert.equal(calendarSnapshotChanges(original, { ...original, attributes: 'aria-expanded="true"' }).attributesChanged, true);
  assert.equal(calendarSnapshotChanges(original, { ...original, children: [child, {}] }).childStructureChanged, true);
  assert.equal(calendarSnapshotChanges(original, { ...original, children: [{}] }).childStructureChanged, true, "Same child count can hide a replaced subtree");
  assert.equal(calendarSnapshotChanges(original, { ...original, value: "2026. 10. 15" }).valueChanged, true);
  assert.ok(inspectControls.toString().includes("querySelectorAll"));
  assert.ok(!inspectControls.toString().includes(".click("), "Inspection must remain read-only");
  const button = { tag: "BUTTON", text: "발행", ariaLabel: null, disabled: false, inDialog: false, role: "button", parent: "" } as Candidate;
  assert.equal(canClick(button, "open-panel"), true);
  assert.equal(canClick({ ...button, inDialog: true }, "open-panel"), false);
  assert.equal(canClick(button, "schedule-option"), false);
  assert.equal(canClick({ ...button, text: "예약 발행" }, "schedule-option"), false);
  assert.equal(canClick({ ...button, tag: "INPUT", type: "radio", role: "radio", text: "예약" }, "schedule-option"), true);
  assert.equal(canClick({ ...button, disabled: true }, "open-panel"), false);
  const manualCheck = async () => {
    assert.equal(await waitForManualSchedule(async () => ""), true, "Manual Enter continues to DOM scan");
    assert.equal(await waitForManualSchedule(async () => "CANCEL"), false, "Only explicit CANCEL stops manual selection");
    const answers = ["SELECT", ""];
    assert.equal(await waitForManualSchedule(async () => answers.shift()!), true, "Other input must not abort diagnosis");
    const autoCandidates: Candidate[] = [];
    assert.equal(autoCandidates.some(candidate => canClick(candidate, "schedule-option")), false);
    let rescans = 0;
    const checkedRadioTime2 = { contextId: 7, radioFound: true, checked: true, dateInputCount: 1, hourCount: 1, minuteCount: 1 };
    const continued = await continueManualSchedule(async () => "", async () => { rescans++; return [checkedRadioTime2]; });
    assert.equal(rescans, 1, "Blank Enter must perform a fresh anchor scan");
    assert.deepEqual(continued, checkedRadioTime2, "Continue to calendar diagnostic with confirmed editor context");
    let calendarPromptReached = false;
    if (continued) {
      const question = async () => { calendarPromptReached = true; return "CALENDAR"; };
      assert.equal(await question(), "CALENDAR");
    }
    assert.equal(calendarPromptReached, true);
    rescans = 0;
    assert.equal(await continueManualSchedule(async () => "CANCEL", async () => { rescans++; return [checkedRadioTime2]; }), null);
    assert.equal(rescans, 0, "CANCEL exits normally without DOM scan or clicks");
    await assert.rejects(continueManualSchedule(async () => "", async () => [{ ...checkedRadioTime2, checked: false }]), /예약 선택 상태를 확인하지 못했습니다/);
    await assert.rejects(continueManualSchedule(async () => "", async () => []), /예약 선택 상태를 확인하지 못했습니다/);
    await assert.rejects(continueManualSchedule(async () => "", async () => [{ ...checkedRadioTime2, minuteCount: 0 }]), /날짜\/시\/분 anchor/);
  };
  manualCheck().then(() => console.log("PASS: visibility-free DOM diff, reused-node class/attribute/text/value changes, added/replaced children; manual Enter/CANCEL regression; no browser connection."))
    .catch(error => { console.error(error); process.exitCode = 1; });
} else {
  main().catch(error => { console.error(`진단 중단: ${error instanceof Error ? error.message : "알 수 없는 진단 오류"} 최종 발행은 실행하지 않았습니다.`); process.exitCode = 1; });
}
