(() => {
  const normalize = (value: string) => value.replace(/[\u200b\ufeff]/g, "").replace(/\s+/g, " ").trim();
  const visible = (element: HTMLElement) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
  const describe = (element: HTMLElement | undefined) => element ? { tag: element.tagName, class: element.getAttribute("class") ?? "" } : null;

  function inspect() {
    const writing = /PostWriteForm\.naver|\/postwrite(?:\?|$|\/)/i.test(location.href);
    const titles = [...document.querySelectorAll<HTMLElement>(".se-title-text")].filter(visible);
    const paragraphs = [...document.querySelectorAll<HTMLElement>(".se-component.se-text .se-text-paragraph")].filter(visible);
    const title = titles.length === 1 ? titles[0] : undefined;
    const body = paragraphs[0];
    const frameReady = writing && !!title && !!body;
    const diagnostic: EditorDiagnostic = {
      url: `${location.origin}${location.pathname}`, writing, ready: frameReady, frameReady,
      titleFound: !!title, bodyFound: !!body,
      existing: !!normalize(title?.innerText ?? "") || paragraphs.some((p) => !!normalize(p.innerText)) || !!document.querySelector(".se-component.se-image"),
      iframeCount: document.querySelectorAll("iframe").length, paragraphs: paragraphs.length,
      titleTag: title?.tagName, bodyTag: body?.tagName,
      title: { matchedSelector: ".se-title-text", target: describe(title) },
      body: { matchedSelector: ".se-component.se-text .se-text-paragraph", target: describe(body) },
      reason: frameReady ? "SmartEditor 글쓰기 화면 확인 완료" : `글쓰기=${writing}, 제목=${titles.length}, 본문 문단=${paragraphs.length}`,
    };
    return { title, body, paragraphs, diagnostic };
  }

  function assertSafeEditor() {
    const current = inspect();
    if (current.diagnostic.ready !== true) throw new Error(current.diagnostic.reason);
    if (document.querySelector(".se-component.se-image")) throw new Error("이미 사진이 있는 글에는 입력하지 않습니다. 새 글을 열어 주세요.");
    if ([...document.querySelectorAll<HTMLElement>('[role="dialog"]')].some(visible)) throw new Error("열린 모달을 직접 처리한 뒤 다시 시도해 주세요.");
    return current;
  }

  // CDP 좌표는 최상위 탭 viewport의 CSS pixel입니다. iframe 로컬 좌표를 그대로 반환하지 않습니다.
  function targetPosition(element: HTMLElement): EditorTargetPosition {
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    let current: Window = window;
    while (current !== current.top) {
      const iframe = current.frameElement as HTMLElement | null;
      if (!iframe) throw new Error("iframe 좌표에 접근할 수 없습니다. 같은 origin의 Naver 글쓰기 화면을 사용해 주세요.");
      iframe.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      current = current.parent;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) throw new Error("입력 대상 크기가 유효하지 않습니다.");
    let x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !(hit === element || element.contains(hit))) throw new Error("입력 대상이 다른 요소에 가려져 있습니다.");
    current = window;
    while (current !== current.top) {
      const iframe = current.frameElement as HTMLElement | null;
      if (!iframe) throw new Error("iframe 좌표 변환 실패");
      if (current.parent.getComputedStyle(iframe).transform !== "none") throw new Error("변형된 iframe 좌표는 지원하지 않습니다.");
      const frameRect = iframe.getBoundingClientRect();
      const scaleX = frameRect.width / iframe.offsetWidth, scaleY = frameRect.height / iframe.offsetHeight;
      x = frameRect.left + (iframe.clientLeft + x) * scaleX;
      y = frameRect.top + (iframe.clientTop + y) * scaleY;
      const parentHit = current.parent.document.elementFromPoint(x, y);
      if (parentHit !== iframe) throw new Error("글쓰기 iframe이 다른 요소에 가려져 있습니다.");
      current = current.parent;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= current.innerWidth || y >= current.innerHeight) throw new Error("입력 위치가 탭 viewport 밖에 있습니다.");
    return { x, y, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
  }

  function compareBody(bodyText: string, paragraphs: HTMLElement[]) {
    const normalizeBody = (value: string) => value.replace(/\r/g, "").replace(/\u00a0/g, " ")
      .replace(/[\u200b-\u200d\u2060\ufeff]/g, "").replace(/\s+/g, " ").trim();
    const expectedParagraphs = bodyText.split(/\r?\n+/).map(normalizeBody).filter(Boolean);
    const actualParagraphs = paragraphs.map((p) => normalizeBody(p.textContent ?? "")).filter(Boolean);
    // 수집 단계에서는 문단 경계를 보존합니다. separator 없는 DOM text 합침은 하지 않습니다.
    const expected = normalizeBody(bodyText);
    const actual = normalizeBody(actualParagraphs.join("\n"));
    // 비교 전용 키: DOM 문단 분할/합침으로 생기는 공백 차이만 허용합니다.
    // 전체 키를 정확히 비교하므로 실제 문자 누락/추가/순서 변경은 통과하지 않습니다.
    const textKey = (value: string) => value.replace(/\s/g, "");
    const expectedKey = textKey(expected), actualKey = textKey(actual);
    const markers = [...bodyText.matchAll(/\[사진\s+\d+\s+삽입\]/g)].map((match) => match[0]);
    const missingMarker = markers.filter((marker) => !actualKey.includes(textKey(normalizeBody(marker))));
    let consumed = 0;
    const fragmentsInOrder = expectedParagraphs.every((paragraph) => {
      const fragment = textKey(paragraph);
      if (!actualKey.startsWith(fragment, consumed)) return false;
      consumed += fragment.length;
      return true;
    });
    const equivalent = expectedKey.length > 0 && expectedKey === actualKey;
    let mismatch = 0;
    while (mismatch < Math.min(expectedKey.length, actualKey.length) && expectedKey[mismatch] === actualKey[mismatch]) mismatch++;
    return {
      matches: equivalent && fragmentsInOrder && missingMarker.length === 0,
      actualLength: actual.length, expectedLength: expected.length,
      diagnostic: {
        expectedNormalizedLength: expected.length, actualNormalizedLength: actual.length,
        expectedParagraphCount: expectedParagraphs.length, actualParagraphCount: actualParagraphs.length,
        expectedTextLength: expectedKey.length, actualTextLength: actualKey.length,
        missingMarker, fragmentsInOrder, whitespaceOnlyDifference: expected !== actual && equivalent,
        // 본문/개인정보를 출력하지 않고 최초 불일치 위치와 문자 코드만 제공합니다.
        firstMismatch: equivalent ? null : { index: mismatch, expectedCodePoint: expectedKey.codePointAt(mismatch) ?? null, actualCodePoint: actualKey.codePointAt(mismatch) ?? null },
      },
    };
  }

  async function verifyInput(task: ExtensionTask, field: "title" | "body") {
    const deadline = Date.now() + 5000;
    let titleMatches = false;
    let comparison = compareBody(task.bodyText, []);
    while (Date.now() < deadline) {
      const current = inspect();
      comparison = compareBody(task.bodyText, current.paragraphs);
      titleMatches = normalize(current.title?.innerText ?? "") === normalize(task.title);
      if (current.diagnostic.ready === true && titleMatches && (field === "title" || comparison.matches)) {
        if (field === "body" && comparison.diagnostic.whitespaceOnlyDifference) console.info("본문 DOM 경계/공백 차이 equivalent", comparison.diagnostic);
        return { titleMatches, bodyMatches: comparison.matches, actualLength: comparison.actualLength, expectedLength: comparison.expectedLength };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (field === "body") {
      console.warn("본문 DOM 검증 실패", comparison.diagnostic);
      throw new Error(`본문 DOM 검증 실패: ${JSON.stringify(comparison.diagnostic)}. 일부 입력되었을 수 있으니 직접 확인하세요.`);
    }
    throw new Error(`제목 DOM 검증 실패 (titleMatch=${titleMatches}). 일부 입력되었을 수 있으니 직접 확인하세요.`);
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !["EDITOR_DIAGNOSE", "EDITOR_TARGET", "EDITOR_VERIFY"].includes(message.type)) return;
    void (async (): Promise<ExtensionReply> => {
      if (message.type === "EDITOR_DIAGNOSE") return { diagnostic: inspect().diagnostic };
      if (message.field !== "title" && message.field !== "body") throw new Error("입력 대상이 올바르지 않습니다.");
      if (message.type === "EDITOR_VERIFY") {
        if (!message.task) throw new Error("검증할 초안이 없습니다.");
        return { verification: await verifyInput(message.task, message.field) };
      }
      const current = assertSafeEditor();
      const target = message.field === "title" ? current.title : current.body;
      if (!target) throw new Error("입력 대상이 없습니다.");
      const existing = message.field === "title" ? !!normalize(current.title?.innerText ?? "") : current.paragraphs.some((p) => !!normalize(p.innerText));
      if (existing && !message.overwrite) throw new Error("기존 글 덮어쓰기 확인이 필요합니다.");
      return { position: targetPosition(target), existing };
    })().then(respond, (error: unknown) => respond({ error: error instanceof Error ? error.message : "DOM 조회 실패" }));
    return true;
  });
})();
