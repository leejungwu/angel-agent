import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(await readFile("extension/schedule.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
function fixture(options = {}) {
  let clock = Date.parse("2026-10-15T00:00:00Z"), calendarOpen = false, year = 2026, month = 10;
  const clicks = [], events = [], queries = [];
  class Element {
    constructor(text = "", kind = "") { this.textContent = text; this.kind = kind; this.disabled = false; this.style = { pointerEvents: "auto", display: "block", visibility: "visible" }; this.parentElement = newParent(); }
    matches(selector) { return selector.includes('data-testid="seOnePublishBtn"') ? this.kind === "final" : selector.includes(":disabled") ? this.disabled : false; }
    closest(selector) { if (selector === ".ui-state-disabled") return this.disabled ? this : null; if (selector === "li") return panel; return null; }
    querySelector() { return null; }
    click() {
      clicks.push(this.kind);
      assert.notEqual(this.kind, "final", "FINAL PUBLISH BUTTON MUST NOT BE CLICKED");
      if (this.kind === "radio" && !options.radioFailure) this.checked = true;
      if (this.kind === "date") calendarOpen = true;
      if (this.kind === "next" && !options.monthTimeout) { month += options.wrongMonth ? 2 : 1; if (month > 12) { month -= 12; year++; } }
      if (this.kind.startsWith("day")) {
        date.value = `${year}. ${String(month).padStart(2, "0")}. ${this.textContent.padStart(2, "0")}`;
        if (options.badDate) date.value = "2026. 01. 01";
        calendarOpen = false;
      }
    }
    dispatchEvent(event) {
      events.push([this.kind, event.type]);
      if (options.resetMinute && this.kind === "minute") this._value = "00";
      if (options.corruptHour && this.kind === "minute") hour._value = "00";
      return true;
    }
  }
  function newParent() { return { style: { pointerEvents: "auto", display: "block", visibility: "visible" }, parentElement: null, hidden: false }; }
  class Input extends Element { constructor(kind) { super("", kind); this.value = ""; this.checked = false; } }
  class Select extends Element {
    constructor(kind, values) { super("", kind); this.options = values.map(value => ({ value, disabled: false })); this._value = values[0]; }
    get value() { return this._value; } set value(value) { this._value = value; }
  }
  const trigger = new Element("발행", "trigger"), final = new Element("발행", "final"), radio = new Input("radio"), date = new Input("date");
  const hour = new Select("hour", Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")));
  const minute = new Select("minute", ["00", "10", "20", "30", "40", "50"]);
  const error = new Element("현재 시간 이후로 설정해주세요.", "error");
  if (options.hiddenError) error.style.display = "none";
  const panel = { querySelectorAll: () => options.timeError || options.hiddenError ? [error] : [] };
  const next = new Element("다음 달", "next");
  const days = Array.from({ length: 31 }, (_, index) => new Element(String(index + 1), `day${index + 1}`));
  if (options.disabledDay) days[15].disabled = true;
  if (options.pointerDisabled) days[15].parentElement.style.pointerEvents = "none";
  if (options.finalDay) days[15].kind = "final";
  const calendar = {
    querySelector: selector => selector === ".ui-datepicker-year" ? new Element(`${year}년`) : selector === ".ui-datepicker-month" ? new Element(`${month}월`) : null,
    querySelectorAll: selector => selector.includes("datepicker-next") ? [next] : selector === "table tbody td > button" ? days : [],
  };
  const document = {
    querySelectorAll(selector) {
      queries.push(selector);
      if (options.noDom) throw new Error("Manual/invalid Job must not query DOM");
      if (selector === "button") return [trigger, final];
      if (selector.includes('data-testid="preTimeRadioBtn"')) return [radio];
      if (selector === "input.input_date__UwKAB") return [date];
      if (selector.includes("예약 발행 시간 선택")) return [hour];
      if (selector.includes("예약 발행 분 선택")) return [minute];
      if (selector === ".ui-datepicker") return calendarOpen ? [calendar] : [];
      return [];
    },
    querySelector(selector) { return selector.includes("publishLayer") ? panel : this.querySelectorAll(selector)[0] ?? null; },
  };
  const context = { document, HTMLInputElement: Input, HTMLSelectElement: Select,
    Event: class { constructor(type) { this.type = type; } },
    Date: class extends Date { static now() { return clock; } },
    setTimeout: resolve => { clock += 100; resolve(); }, getComputedStyle: element => element.style,
  };
  vm.createContext(context);
  vm.runInContext(code + "\nglobalThis.schedule = NaverSchedule;", context);
  return { schedule: context.schedule, clicks, events, queries, hour, minute, date, context };
}
const scheduled = iso => ({ publishMode: "scheduled", scheduledAt: iso });
const plain = fixture({ noDom: true });
assert.equal((await plain.schedule.configure({ publishMode: "manual" })).scheduleReady, false);
assert.equal(plain.queries.length, 0);
const parts = plain.schedule.target(scheduled("2026-10-15T20:10:00.000Z"));
assert.equal(JSON.stringify(parts), JSON.stringify({ year: 2026, month: 10, day: 16, hour: 5, minute: 10 }));
for (const [task, message] of [[scheduled(null), /없습니다/], [scheduled("2026-10-14T00:00:00Z"), /이미 지났/], [scheduled("2026-10-16T20:43:00Z"), /05:43/], [scheduled("2026-10-16T20:40:01Z"), /밀리초/]]) {
  await assert.rejects(plain.schedule.configure(task), message);
  assert.equal(plain.queries.length, 0);
}
for (const [iso, expectedDate, nextCount] of [
  ["2026-10-15T20:10:00Z", "2026. 10. 16", 0],
  ["2026-11-15T20:10:00Z", "2026. 11. 16", 1],
  ["2026-12-31T20:10:00Z", "2027. 01. 01", 3],
]) {
  const f = fixture();
  assert.equal((await f.schedule.configure(scheduled(iso))).scheduleReady, true);
  assert.equal(f.date.value, expectedDate); assert.equal(f.hour.value, "05"); assert.equal(f.minute.value, "10");
  assert.equal(f.clicks.filter(click => click === "next").length, nextCount);
  assert.equal(f.clicks.includes("final"), false);
  assert.equal(f.clicks[0], "trigger"); assert.equal(f.clicks[1], "radio");
  assert.ok(f.events.some(([kind, type]) => kind === "hour" && type === "change"));
  assert.ok(f.events.some(([kind, type]) => kind === "minute" && type === "change"));
}
for (const hour of [0, 5, 23]) for (const minute of [0, 10, 20, 30, 40, 50]) {
  const f = fixture();
  const iso = new Date(Date.UTC(2026, 9, 16, hour - 9, minute)).toISOString();
  await f.schedule.configure(scheduled(iso));
  assert.equal(f.hour.value, String(hour).padStart(2, "0")); assert.equal(f.minute.value, String(minute).padStart(2, "0"));
}
for (const [options, iso, error] of [
  [{ disabledDay: true }, "2026-10-15T20:10:00Z", /목표 날짜/],
  [{ pointerDisabled: true }, "2026-10-15T20:10:00Z", /목표 날짜/],
  [{ radioFailure: true }, "2026-10-15T20:10:00Z", /SCHEDULE_RADIO.*TIMEOUT/],
  [{ monthTimeout: true }, "2026-11-15T20:10:00Z", /SCHEDULE_MONTH.*TIMEOUT/],
  [{ wrongMonth: true }, "2026-11-15T20:10:00Z", /예상과 다른 달/],
  [{ badDate: true }, "2026-10-15T20:10:00Z", /SCHEDULE_DATE.*TIMEOUT/],
  [{ resetMinute: true }, "2026-10-15T20:10:00Z", /SCHEDULE_MINUTE.*TIMEOUT/],
  [{ timeError: true }, "2026-10-15T20:10:00Z", /SCHEDULE_VERIFY.*현재 시간 이후/],
  [{ corruptHour: true }, "2026-10-15T20:10:00Z", /SCHEDULE_VERIFY.*일치하지/],
  [{ finalDay: true }, "2026-10-15T20:10:00Z", /최종 발행 버튼 클릭은 금지/],
  [{}, "2029-10-15T20:10:00Z", /24개월/],
]) {
  const f = fixture(options);
  await assert.rejects(f.schedule.configure(scheduled(iso)), error);
  assert.equal(f.clicks.includes("final"), false);
  if (options.disabledDay || options.pointerDisabled) assert.equal(f.clicks.some(click => click.startsWith("day")), false);
}
assert.equal((await fixture({ hiddenError: true }).schedule.configure(scheduled("2026-10-15T20:10:00Z"))).scheduleReady, true);
const routed = fixture();
let listener;
routed.context.chrome = { runtime: { id: "fixture", onMessage: { addListener(handler) { listener = handler; } } } };
const contentCode = ts.transpileModule(await readFile("extension/content.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
vm.runInContext(contentCode, routed.context);
const reply = await new Promise(resolve => listener({ type: "EDITOR_SCHEDULE", task: scheduled("2026-10-15T20:10:00Z") }, { id: "fixture" }, resolve));
assert.equal(reply.scheduleReady, true);
assert.equal(listener({ type: "EDITOR_SCHEDULE", task: scheduled("2026-10-15T20:10:00Z") }, { id: "other" }, () => assert.fail("Foreign sender")), undefined);
console.log("PASS: manual/invalid preflight, KST, radio, date/month/year navigation, disabled days, all hour/minute options, DOM final verification/time error, zero final publication clicks.");
