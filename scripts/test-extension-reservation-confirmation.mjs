import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(await readFile("extension/schedule.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
class Element {
  constructor(tag, text = "", children = [], attributes = {}) {
    this.tagName = tag.toUpperCase(); this.text = text; this.children = children; this.attributes = attributes;
    this.style = { display: "block", visibility: "visible" }; this.parentElement = null;
    for (const child of children) child.parentElement = this;
  }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(""); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasAttribute(name) { return name in this.attributes; }
  matches(selector) {
    return selector.split(",").some(part => {
      const attr = part.match(/^\[([^=]+)="([^"]+)"\]$/);
      return attr ? this.getAttribute(attr[1]) === attr[2] : part.toUpperCase() === this.tagName;
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  getClientRects() { return [{ width: 200, height: 30 }]; }
  click() { assert.fail("Synthetic reservation trigger clicks are forbidden"); }
}
const task = { title: "고정 제목", publishMode: "scheduled", finalizeMode: "auto", scheduledAt: "2026-10-16T02:30:00.000Z" };
const triggerPosition = () => ({ x: 444, y: 33, rect: { x: 400, y: 20, width: 88, height: 26 } });
const entry = (title, time) => new Element("li", "", [new Element("button", "", [new Element("span", title + " "), new Element("span", time)])]);
function fixture(entries = [], options = {}) {
  const heading = new Element(options.viewButton ? "button" : "h2", options.triggerText ?? (options.viewButton ? "예약 발행 3건" : "예약 발행 글"), [], options.attributes);
  const list = new Element("ul", "", entries);
  const root = new Element("div", "", options.closed ? [heading] : [heading, list], options.portal ? {} : { "data-focus-lock": "publishLayer" });
  let clicks = 0;
  const reveal = () => {
    const listHeading = new Element("h2", "예약 발행 글"); listHeading.parentElement = root;
    root.children.push(listHeading, list); list.parentElement = root;
  };
  heading.onClick = () => { clicks++; if (!options.delay) reveal(); };
  if (options.hidden) root.style.display = "none";
  const context = { document: { querySelectorAll: selector => [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)] },
    getComputedStyle: node => node.style };
  vm.runInNewContext(code + "\nglobalThis.schedule = NaverSchedule;", context);
  return { schedule: context.schedule, root, list, reveal, clicks: () => clicks };
}
for (const [entries, count] of [
  [[entry(task.title, "2026.10.16 11:30")], 1],
  [[entry(task.title, "2026.10.16 12:30")], 0],
  [[entry("다른 제목", "2026.10.16 11:30")], 0],
  [[entry(task.title, "2026.10.17 11:30")], 0],
  [[entry(task.title, ""), entry("다른 제목", "2026.10.16 11:30")], 0],
  [[entry(task.title, "2026.10.16 11:30"), entry(task.title, "2026.10.16 11:30")], 2],
  [[entry(task.title + " 추가", "2026.10.16 11:30")], 0],
  [[], 0],
]) {
  const f = fixture(entries);
  const result = f.schedule.reservationState(task, true);
  assert.equal(result.listFound, true); assert.equal(result.matchingEntries, count);
  assert.equal(f.clicks(), 0, "Already rendered list needs no click");
}
assert.equal(fixture([entry(task.title, "2026.10.16 11:30")], { hidden: true }).schedule.reservationState(task).listFound, false);
const view = fixture([entry(task.title, "2026.10.16 11:30")], { closed: true, viewButton: true });
assert.equal(view.schedule.reservationState(task, true, triggerPosition).triggerPosition.x, 444);
assert.equal(view.clicks(), 0);
view.reveal(); // Simulate the background's trusted click effect, never HTMLElement.click().
assert.equal(view.schedule.reservationState(task, true).matchingEntries, 1);
assert.equal(view.clicks(), 0);
const uncertain = fixture([], { closed: true });
assert.equal(uncertain.schedule.reservationState(task, true).openedList, false, "Non-button heading is never clicked");
assert.equal(uncertain.schedule.reservationState(task).diagnostic.stage, "LIST_CONTAINER_MISSING");
assert.equal(uncertain.schedule.reservationState(task).diagnostic.listTriggerCount, 0);
const portal = fixture([entry(task.title, "2026.10.16 11:30")], { portal: true });
assert.equal(portal.schedule.reservationState(task).matchingEntries, 1, "Reservation portal need not be inside publishLayer");
const semanticView = fixture([entry(task.title, "2026.10.16 11:30")], { closed: true, viewButton: true, triggerText: "예약 발행 1건", portal: true, delay: true });
const opened = semanticView.schedule.reservationState(task, true, triggerPosition);
assert.equal(opened.matchingEntries, 0, "Do not run matcher synchronously after clicking the trigger");
assert.equal(opened.diagnostic.listTriggerClicked, false);
assert.equal(opened.triggerPosition.x, 444);
assert.equal(opened.diagnostic.listVisibleAfterClick, false);
assert.equal(semanticView.schedule.reservationState(task).listFound, false);
semanticView.reveal();
assert.equal(semanticView.schedule.reservationState(task).matchingEntries, 1);
const ambiguousView = fixture([], { closed: true, viewButton: true });
const duplicateButton = new Element("button", "예약 발행 12건"); duplicateButton.parentElement = ambiguousView.root;
ambiguousView.root.children.push(duplicateButton);
const ambiguous = ambiguousView.schedule.reservationState(task, true);
assert.equal(ambiguous.diagnostic.listTriggerCount, 2);
assert.equal(ambiguous.diagnostic.stage, "LIST_TRIGGER_AMBIGUOUS");
assert.equal(ambiguousView.clicks(), 0);
assert.equal(fixture().schedule.reservationState(task).diagnostic.stage, "ENTRIES_EMPTY");
for (const name of ["예약 발행 1건", "예약 발행 3건", "예약 발행 12건", "예약  발행\n3 건"]) {
  const f = fixture([], { closed: true, viewButton: true, triggerText: name });
  const result = f.schedule.reservationState(task);
  assert.equal(result.diagnostic.listTriggerCount, 1, name);
  assert.equal(result.diagnostic.listTriggerCandidates[0].allowed, true);
}
for (const options of [
  { triggerText: "발행" }, { triggerText: "예약 발행 글" },
  { triggerText: "예약 발행 3건", attributes: { "data-testid": "seOnePublishBtn" } },
  { triggerText: "예약 발행 3건", attributes: { "data-click-area": "tpb.publish" } },
  { triggerText: "삭제" }, { triggerText: "수정" },
]) {
  const f = fixture([], { ...options, closed: true, viewButton: true });
  assert.equal(f.schedule.reservationState(task, true, () => assert.fail("Forbidden button must not request coordinates")).triggerPosition, undefined);
  assert.equal(f.clicks(), 0);
}
const named = fixture([], { closed: true, viewButton: true, triggerText: "목록", attributes: { "aria-label": "예약 발행 3건" } });
assert.equal(named.schedule.reservationState(task).diagnostic.listTriggerCount, 1);
const entryView = fixture([], { closed: true });
const articleButton = new Element("li", "", [new Element("button", "예약 발행 3건")]);
articleButton.parentElement = entryView.root; entryView.root.children.push(articleButton);
assert.equal(entryView.schedule.reservationState(task, true).diagnostic.listTriggerCount, 0);
assert.equal(entryView.clicks(), 0);
for (const override of [{ finalizeMode: "review" }, { publishMode: "manual" }]) {
  const f = fixture();
  assert.equal(f.schedule.reservationState({ ...task, ...override }, true).listFound, false);
  assert.equal(f.clicks(), 0);
}
console.log("PASS: same LI/BUTTON exact title+KST date/time, split-entry rejection, duplicates, no matches, hidden list, viewing-only click, no entry/final clicks, review/manual exclusions.");

const contentSource = await readFile("extension/content.ts", "utf8");
const positionSource = contentSource.slice(contentSource.indexOf("  function targetPosition("), contentSource.indexOf("  function compareBody("));
const positionCode = ts.transpileModule(positionSource, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
function hitFixture(inFrame, wrongHit = false) {
  const button = { tagName: "BUTTON", textContent: "예약 발행 3건", scrollIntoView() {},
    getBoundingClientRect: () => ({ left: 100, top: 20, width: 80, height: 20, x: 100, y: 20 }),
    contains: node => node === button };
  button.closest = () => button;
  const other = { tagName: "BUTTON", textContent: "발행", closest() { return this; } };
  const document = { elementFromPoint: () => wrongHit ? other : button };
  const top = { innerWidth: 1600, innerHeight: 1000, getComputedStyle: () => ({ transform: "none" }) };
  const iframe = { scrollIntoView() {}, offsetWidth: 800, offsetHeight: 600, clientLeft: 2, clientTop: 3,
    getBoundingClientRect: () => ({ left: 40, top: 70, width: 800, height: 600 }) };
  top.document = inFrame ? { elementFromPoint: () => iframe } : document;
  top.top = top;
  const window = inFrame ? { top, parent: top, frameElement: iframe, innerWidth: 800, innerHeight: 600, devicePixelRatio: 2 } : top;
  window.devicePixelRatio = 2;
  const context = { window, document };
  vm.runInNewContext(positionCode + "\nglobalThis.inspect = reservationTriggerPosition;", context);
  return context.inspect(button);
}
for (const inFrame of [false, true]) {
  const result = hitFixture(inFrame);
  assert.equal(result.details.hitClosestButtonMatchesTrigger, true);
  assert.equal(result.position.x, inFrame ? 182 : 140);
  assert.equal(result.position.y, inFrame ? 103 : 30);
  assert.equal(result.details.topLevel, !inFrame);
  assert.equal(result.details.iframeOffsetRequired, inFrame);
  assert.equal(result.details.devicePixelRatio, 2, "CSS coordinates must not be multiplied by DPR");
}
const wrongHit = hitFixture(true, true);
assert.equal(wrongHit.position, undefined);
assert.equal(wrongHit.details.hitClosestButtonMatchesTrigger, false);
assert.equal(wrongHit.details.hitClosestButtonText, "발행");
console.log("PASS: exact trigger hit, wrong-button rejection, top-level zero offset, iframe border/offset conversion, CSS pixels independent of DPR.");
