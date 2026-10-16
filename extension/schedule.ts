// Shared by background, content script and Side Panel; prepended by the extension build.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Consumed by the concatenated extension entry scripts.
const NaverSchedule = (() => {
  const finalButton = '[data-testid="seOnePublishBtn"]';
  const radioSelector = 'input[data-testid="preTimeRadioBtn"],#radio_time2';
  const dateSelector = "input.input_date__UwKAB";
  const hourSelector = 'select[title="예약 발행 시간 선택"]';
  const minuteSelector = 'select[title="예약 발행 분 선택"]';
  const pad = (value: number) => String(value).padStart(2, "0");
  type ScheduleTask = Pick<ExtensionTask, "publishMode" | "scheduledAt" | "finalizeMode">;
  function finalizeMode(task: ScheduleTask) {
    if (task.finalizeMode === undefined || task.finalizeMode === "review") return "review";
    if (task.finalizeMode !== "auto" || task.publishMode !== "scheduled") throw new Error("자동 최종 동작은 명시적으로 선택한 예약 Job에서만 허용됩니다.");
    return "auto";
  }

  function parts(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("예약시간 형식을 확인해주세요.");
    const seoul = new Date(Date.parse(value) + 9 * 3600000);
    return { year: seoul.getUTCFullYear(), month: seoul.getUTCMonth() + 1, day: seoul.getUTCDate(), hour: seoul.getUTCHours(), minute: seoul.getUTCMinutes() };
  }
  function target(task: ScheduleTask, now = Date.now()) {
    finalizeMode(task);
    if (task.publishMode === undefined || task.publishMode === "manual") return null;
    if (task.publishMode !== "scheduled" || !task.scheduledAt) throw new Error("예약시간이 없습니다. 새 예약 작업을 생성해주세요.");
    const result = parts(task.scheduledAt);
    if (Date.parse(task.scheduledAt) <= now) throw new Error("예약시간이 이미 지났습니다. 새 예약 작업을 생성해주세요.");
    if (result.minute % 10 !== 0) throw new Error(`네이버 예약 발행은 10분 단위만 지원합니다. 이 작업의 예약시간은 ${pad(result.hour)}:${pad(result.minute)}입니다.`);
    if (Date.parse(task.scheduledAt) % 60000 !== 0) throw new Error("예약시간의 초/밀리초는 0이어야 합니다. 새 예약 작업을 생성해주세요.");
    return result;
  }
  function label(task: ScheduleTask) {
    if (task.publishMode !== "scheduled") return "";
    if (!task.scheduledAt) return "예약 발행 · 예약시간 확인 필요";
    const p = parts(task.scheduledAt);
    return `예약 발행 · ${p.year}.${pad(p.month)}.${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)} (한국 시간) · ${finalizeMode(task) === "auto" ? "자동 예약 등록" : "직접 확인"}`;
  }

  function assertNoTimeError() {
    const radio = document.querySelector(radioSelector);
    const panel = document.querySelector('[data-focus-lock="publishLayer"]') ?? radio?.closest("li");
    const errors = Array.from((panel ?? document).querySelectorAll<HTMLElement>("span,p,div"))
      .filter(element => element.textContent?.trim() === "현재 시간 이후로 설정해주세요.");
    if (errors.some(element => {
      for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden" || parent.hidden) return false;
      }
      return true;
    })) throw new Error("네이버 오류: 현재 시간 이후로 설정해주세요.");
  }

  // Authorize a trusted CDP click only. Never invoke final button.click() here.
  function finalTarget(task: ScheduleTask) {
    if (finalizeMode(task) !== "auto") throw new Error("직접 확인 Job은 최종 발행 버튼을 클릭할 수 없습니다.");
    const expected = target(task);
    if (!expected) throw new Error("예약 Job만 자동 최종 동작을 실행할 수 있습니다.");
    const one = <T extends HTMLElement>(selector: string): T => {
      const elements = document.querySelectorAll<T>(selector);
      if (elements.length !== 1) throw new Error(`최종 클릭 검증: ${selector} 요소 ${elements.length}개`);
      return elements[0];
    };
    const date = `${expected.year}. ${pad(expected.month)}. ${pad(expected.day)}`;
    if (!one<HTMLInputElement>(radioSelector).checked || one<HTMLInputElement>(dateSelector).value.replace(/\s+/g, " ").trim() !== date ||
      one<HTMLSelectElement>(hourSelector).value !== pad(expected.hour) || one<HTMLSelectElement>(minuteSelector).value !== pad(expected.minute)) throw new Error("최종 클릭 검증: 예약 radio/날짜/시/분 불일치");
    assertNoTimeError();
    const button = one<HTMLButtonElement>(finalButton);
    if (button.tagName !== "BUTTON" || button.matches('[data-click-area="tpb.publish"]') || button.disabled || button.closest(':disabled,[aria-disabled="true"]')) throw new Error("최종 발행 버튼이 비활성 상태이거나 올바르지 않습니다.");
    for (let element: HTMLElement | null = button; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (element.hidden || element.hasAttribute("inert") || element.getAttribute("aria-hidden") === "true" || style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.pointerEvents === "none" || style.opacity === "0") throw new Error("최종 발행 버튼이 표시되거나 클릭 가능한 상태가 아닙니다.");
    }
    const rect = button.getBoundingClientRect();
    if (!button.getClientRects().length || rect.width <= 0 || rect.height <= 0) throw new Error("최종 발행 버튼의 화면 영역을 확인하지 못했습니다.");
    return button;
  }

  async function configure(task: ScheduleTask) {
    const expected = target(task);
    if (!expected) return { scheduleReady: false }; // Manual Jobs never query schedule DOM.
    let stage = "SCHEDULE_TRIGGER";
    const one = <T extends HTMLElement>(selector: string): T => {
      const elements = Array.from(document.querySelectorAll<T>(selector));
      if (elements.length !== 1) throw new Error(`${selector} 요소를 확정하지 못했습니다 (${elements.length}개).`);
      return elements[0];
    };
    const click = (element: HTMLElement) => {
      // FINAL PUBLISH BUTTON MUST NOT BE CLICKED, including descendants/ancestors.
      if (element.matches(finalButton) || element.closest(finalButton) || element.querySelector(finalButton)) throw new Error("최종 발행 버튼 클릭은 금지됩니다.");
      if (element.matches(":disabled,[aria-disabled=true]") || element.closest(".ui-state-disabled") || getComputedStyle(element).pointerEvents === "none") throw new Error("비활성 예약 컨트롤입니다.");
      element.click();
    };
    const until = async (condition: () => boolean, reason: string) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (condition()) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(`TIMEOUT: ${reason}`);
    };
    const month = () => {
      const root = one<HTMLElement>(".ui-datepicker");
      const value = (selector: string) => {
        const element = root.querySelector(selector);
        return element instanceof HTMLSelectElement ? element.selectedOptions[0]?.textContent ?? "" : element?.textContent ?? "";
      };
      const year = Number(value(".ui-datepicker-year").match(/\d{4}/)?.[0]);
      const month = Number(value(".ui-datepicker-month").match(/\d{1,2}/)?.[0]);
      if (!Number.isInteger(year) || year < 2000 || !Number.isInteger(month) || month < 1 || month > 12) throw new Error("달력 연/월을 읽지 못했습니다.");
      return year * 12 + month - 1;
    };
    const expectedDate = `${expected.year}. ${pad(expected.month)}. ${pad(expected.day)}`;
    const dateMatches = () => one<HTMLInputElement>(dateSelector).value.replace(/\s+/g, " ").trim() === expectedDate;
    const setSelect = async (selector: string, value: string) => {
      const select = one<HTMLSelectElement>(selector);
      if (!Array.from(select.options).some(option => option.value === value && !option.disabled)) throw new Error(`지원하지 않는 예약 선택값: ${value}`);
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      if (!setter) throw new Error("예약 select 값 설정 불가");
      setter.call(select, value);
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 100));
      await until(() => one<HTMLSelectElement>(selector).value === value, "예약 선택값 반영 실패");
    };
    try {
      const triggers = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .filter(button => button.textContent?.replace(/\s+/g, " ").trim() === "발행" && !button.matches(finalButton) && !button.closest(finalButton) && !button.querySelector(finalButton));
      if (triggers.length !== 1) throw new Error(`상단 발행 설정 버튼을 확정하지 못했습니다 (${triggers.length}개).`);
      click(triggers[0]);
      await until(() => document.querySelectorAll(radioSelector).length === 1, "예약 radio 대기");
      stage = "SCHEDULE_RADIO";
      click(one<HTMLInputElement>(radioSelector));
      await until(() => one<HTMLInputElement>(radioSelector).checked, "예약 radio 선택 반영 실패");
      await until(() => !!document.querySelector(dateSelector) && !!document.querySelector(hourSelector) && !!document.querySelector(minuteSelector), "예약 날짜/시간 컨트롤 대기");
      stage = "SCHEDULE_DATE";
      click(one<HTMLInputElement>(dateSelector));
      await until(() => document.querySelectorAll(".ui-datepicker").length === 1, "달력 대기");
      const targetMonth = expected.year * 12 + expected.month - 1;
      const delta = targetMonth - month();
      if (delta < 0 || delta > 24) throw new Error("예약 달 이동 범위는 현재 달부터 24개월까지입니다.");
      stage = "SCHEDULE_MONTH";
      for (let step = 0; step < delta; step++) {
        const previous = month();
        const root = one<HTMLElement>(".ui-datepicker");
        const next = Array.from(root.querySelectorAll<HTMLButtonElement>('button.ui-datepicker-next,button[title="다음달"]'));
        if (next.length !== 1) throw new Error("다음달 버튼을 확정하지 못했습니다.");
        click(next[0]);
        await until(() => month() !== previous, "달 이동 반영 실패");
        if (month() !== previous + 1) throw new Error("예상과 다른 달로 이동했습니다.");
      }
      if (month() !== targetMonth) throw new Error("목표 달이 아닙니다.");
      stage = "SCHEDULE_DATE";
      const days = Array.from(one<HTMLElement>(".ui-datepicker").querySelectorAll<HTMLButtonElement>("table tbody td > button"))
        .filter(button => button.textContent?.trim() === String(expected.day) && !button.closest(".ui-state-disabled") && !button.disabled && getComputedStyle(button).pointerEvents !== "none" && getComputedStyle(button.parentElement!).pointerEvents !== "none");
      if (days.length !== 1) throw new Error(`선택 가능한 목표 날짜가 유일하지 않습니다 (${days.length}개).`);
      click(days[0]);
      await until(dateMatches, "예약 날짜 반영 실패");
      stage = "SCHEDULE_HOUR";
      await setSelect(hourSelector, pad(expected.hour));
      stage = "SCHEDULE_MINUTE";
      await setSelect(minuteSelector, pad(expected.minute));
      stage = "SCHEDULE_VERIFY";
      target(task); // Time may have elapsed while the article was being inserted.
      await new Promise(resolve => setTimeout(resolve, 200));
      if (!one<HTMLInputElement>(radioSelector).checked || !dateMatches() || one<HTMLSelectElement>(hourSelector).value !== pad(expected.hour) || one<HTMLSelectElement>(minuteSelector).value !== pad(expected.minute)) throw new Error("예약 날짜/시/분이 요청값과 일치하지 않습니다.");
      assertNoTimeError();
      return { scheduleReady: true };
    } catch (error) { throw new Error(`${stage}: ${error instanceof Error ? error.message : "예약 설정 실패"}`); }
  }
  function reservationTime(value: string) {
    const p = parts(value);
    return `${p.year}.${pad(p.month)}.${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
  }
  function reservationState(task: ScheduleTask & { title: string }, openList = false, positionForTrigger?: (element: HTMLElement) => EditorTargetPosition): NonNullable<ExtensionReply["reservation"]> {
    const diagnostic: ReservationDiagnostic = { stage: "ELIGIBILITY", listAlreadyVisible: false, listTriggerFound: false, listTriggerCount: 0,
      listTriggerClicked: false, listVisibleAfterClick: false, listHeadingFound: false, entryCount: 0, matchingEntryCount: 0,
      expectedTitle: task.title, expectedDateTime: "", frameId: null,
      frameUrl: typeof location === "undefined" ? null : `${location.origin}${location.pathname}`, reason: "자동 예약 Job이 아닙니다." };
    const empty = { listFound: false, matchingEntries: 0, openedList: false, diagnostic };
    if (task.publishMode !== "scheduled" || task.finalizeMode !== "auto" || !task.scheduledAt) return empty;
    const expectedTime = reservationTime(task.scheduledAt);
    diagnostic.expectedDateTime = expectedTime;
    const normalize = (text: string) => text.replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();
    const shown = (element: Element) => {
      for (let node: Element | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true" || style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") return false;
      }
      return [...element.getClientRects()].some(rect => rect.width > 0 && rect.height > 0);
    };
    const isHeading = (element: Element) => /^예약\s*발행\s*글(?:\s*총\s*\d+\s*개)?$/.test(normalize(element.textContent ?? "")) && !element.closest("li");
    const lists = new Set<Element>();
    // Reservation views may be portals or another Naver document, outside the editor's publishLayer.
    const headings = [...document.querySelectorAll<HTMLElement>('h1,h2,h3,h4,[role="heading"],span,div,p,button')]
        .filter(element => shown(element) && isHeading(element) && ![...element.children].some(isHeading));
    diagnostic.listHeadingFound = headings.length > 0;
    for (const heading of headings) {
        for (let container = heading.parentElement; container; container = container.parentElement) {
          const candidates = [...container.querySelectorAll('ul,ol,[role="list"]')].filter(shown);
          if (candidates.length === 1) { lists.add(candidates[0]); break; }
          if (candidates.length > 1 || container.matches("body,html")) break;
        }
    }
    const triggerName = /^예약\s*발행\s*\d+\s*건$/;
    const findButtons = () => [...document.querySelectorAll<HTMLElement>('button,[role="button"]')].filter(button =>
      button.tagName === "BUTTON" && shown(button) && !button.closest("li") && !button.matches(':disabled,[aria-disabled="true"],[type="submit"],[role="radio"]') &&
      !button.closest('[data-testid="seOnePublishBtn"],[data-click-area="tpb.publish"],[data-testid="preTimeRadioBtn"],[data-testid="nowTimeRadioBtn"]') &&
      [button.getAttribute("aria-label"), button.getAttribute("title"), button.textContent].some(name => !!name && triggerName.test(normalize(name))));
    const buttons = findButtons();
    const trigger = buttons.length === 1 ? buttons[0] : null;
    diagnostic.ariaExpanded = trigger?.getAttribute("aria-expanded") ?? null;
    diagnostic.ariaPressed = trigger?.getAttribute("aria-pressed") ?? null;
    diagnostic.triggerClass = trigger?.getAttribute("class") ?? null;
    diagnostic.triggerFocused = trigger ? trigger.contains(document.activeElement) : null;
    diagnostic.listAlreadyVisible = lists.size > 0;
    diagnostic.listTriggerCount = buttons.length;
    diagnostic.listTriggerFound = buttons.length > 0;
    diagnostic.listTriggerCandidates = [...document.querySelectorAll<HTMLElement>('button,[role="button"],a,[role="tab"]')]
      .filter(element => !element.closest("li") && /예약/.test(`${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("title") ?? ""} ${element.textContent ?? ""}`))
      .slice(0, 8).map(element => ({ tag: element.tagName, name: normalize(element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "").slice(0, 80),
        role: element.getAttribute("role"), testId: element.getAttribute("data-testid"), visible: shown(element), allowed: buttons.includes(element) }));
    if (!lists.size && openList && buttons.length === 1) {
        // Authorize coordinates only. Background owns the one trusted click; content never clicks this trigger.
        const triggerPosition = positionForTrigger?.(buttons[0]);
        const current = findButtons();
        if (current.length !== 1 || current[0] !== buttons[0]) throw new Error("예약 목록 조회 버튼이 변경되었습니다.");
        return { ...empty, triggerPosition, diagnostic: { ...diagnostic, stage: "LIST_TRIGGER_TARGET", clickMode: "trusted-cdp",
          triggerX: triggerPosition?.x ?? null, triggerY: triggerPosition?.y ?? null, reason: "예약 목록 조회 버튼의 trusted 클릭 좌표를 확인했습니다." } };
    }
    let matchingEntries = 0;
    for (const list of lists) {
      for (const entry of list.querySelectorAll("li")) {
        if (!shown(entry) || entry.querySelectorAll("li").length) continue;
        diagnostic.entryCount++;
        const buttons = [...entry.querySelectorAll("button")].filter(button => button.closest("li") === entry && shown(button));
        if (buttons.length !== 1) continue;
        const text = normalize(buttons[0].textContent ?? "");
        const dates = [...text.matchAll(/\b(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})\s+(\d{1,2}):(\d{2})(?!\d)/g)];
        if (dates.length !== 1) continue;
        const date = dates[0];
        const actualTime = `${date[1]}.${pad(Number(date[2]))}.${pad(Number(date[3]))} ${pad(Number(date[4]))}:${date[5]}`;
        const actualTitle = normalize(text.slice(0, date.index) + text.slice(date.index! + date[0].length));
        if (actualTitle === normalize(task.title) && actualTime === expectedTime) matchingEntries++;
      }
    }
    diagnostic.matchingEntryCount = matchingEntries;
    diagnostic.stage = !lists.size ? buttons.length === 0 ? "LIST_TRIGGER_MISSING" : buttons.length > 1 ? "LIST_TRIGGER_AMBIGUOUS" : "LIST_CLOSED"
      : diagnostic.entryCount === 0 ? "ENTRIES_EMPTY" : matchingEntries === 1 ? "MATCHED" : matchingEntries > 1 ? "MATCH_AMBIGUOUS" : "MATCH_MISSING";
    diagnostic.reason = !lists.size ? buttons.length === 0 ? "예약 목록 열기 버튼을 찾지 못했습니다." : buttons.length > 1 ? "예약 목록 열기 버튼 후보가 여러 개입니다." : "예약 목록이 아직 열리지 않았습니다."
      : diagnostic.entryCount === 0 ? "예약 목록은 열렸지만 예약 entry를 읽지 못했습니다." : matchingEntries === 1 ? "동일 entry의 제목과 예약시간을 확인했습니다."
        : matchingEntries > 1 ? "동일 제목·예약시간 entry가 여러 개라 확정하지 않았습니다." : "예약 목록에서 동일 제목·예약시간 entry를 찾지 못했습니다.";
    if (!lists.size && headings.length > 0 && buttons.length === 0) {
      diagnostic.stage = "LIST_CONTAINER_MISSING";
      diagnostic.reason = "예약 목록 제목은 찾았지만 entry 컨테이너를 확정하지 못했습니다.";
    }
    return { listFound: lists.size > 0, matchingEntries, openedList: false, diagnostic };
  }
  return { target, label, configure, finalizeMode, finalTarget, reservationState, reservationTime };
})();
