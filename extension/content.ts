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

  function assertSafeEditor(allowImages = false) {
    const current = inspect();
    if (current.diagnostic.ready !== true) throw new Error(current.diagnostic.reason);
    if (!allowImages && document.querySelector(".se-component.se-image")) throw new Error("이미 사진이 있는 글에는 입력하지 않습니다. 새 글을 열어 주세요.");
    if ([...document.querySelectorAll<HTMLElement>('[role="dialog"]')].some(visible)) throw new Error("열린 모달을 직접 처리한 뒤 다시 시도해 주세요.");
    return current;
  }

  // CDP 좌표는 최상위 탭 viewport의 CSS pixel입니다. iframe 로컬 좌표를 그대로 반환하지 않습니다.
  function targetPosition(element: HTMLElement, range?: Range, atEnd = false, atStart = false): EditorTargetPosition {
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    let current: Window = window;
    while (current !== current.top) {
      const iframe = current.frameElement as HTMLElement | null;
      if (!iframe) throw new Error("iframe 좌표에 접근할 수 없습니다. 같은 origin의 Naver 글쓰기 화면을 사용해 주세요.");
      iframe.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      current = current.parent;
    }
    const rangeRects = range ? [...range.getClientRects()].filter((r) => r.width >= 0 && r.height > 0) : [];
    const rect = range ? (atEnd ? rangeRects[rangeRects.length - 1] : rangeRects[0]) : element.getBoundingClientRect();
    if (!rect) throw new Error("사진 위치의 화면 좌표를 확인하지 못했습니다.");
    if ((!range && rect.width <= 0) || rect.width < 0 || rect.height <= 0) throw new Error("입력 대상 크기가 유효하지 않습니다.");
    let x = atStart ? rect.left : atEnd ? rect.left + rect.width : rect.left + rect.width / 2, y = rect.top + rect.height / 2;
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
      matches: equivalent && fragmentsInOrder,
      actualLength: actual.length, expectedLength: expected.length,
      diagnostic: {
        expectedNormalizedLength: expected.length, actualNormalizedLength: actual.length,
        expectedParagraphCount: expectedParagraphs.length, actualParagraphCount: actualParagraphs.length,
        expectedTextLength: expectedKey.length, actualTextLength: actualKey.length,
        fragmentsInOrder, whitespaceOnlyDifference: expected !== actual && equivalent,
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

  const normalizeForPosition = (text: string) => text.replace(/\r/g, "").replace(/\u00a0/g, " ").replace(/[\u200b-\u200f\u2060\ufeff]/g, "").replace(/\s/g, "");
  let photoState: { characterOffset: number; paragraphCount: number; emptyCount: number; imageCount: number } | undefined;

  function photoTextNodes(): Text[] {
    const roots = [...document.querySelectorAll<HTMLElement>(".se-component.se-text .se-text-paragraph")];
    const nodes = new Set<Text>();
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (parent && visible(parent) && !parent.closest('.se-documentTitle, .se-title-text, .se-toolbar, .se-placeholder, .se-component.se-image, [hidden], [aria-hidden="true"], script, style')) nodes.add(node as Text);
      }
    }
    return [...nodes];
  }

  function photoLocation(task: ExtensionTask) {
    const offset = task.images[0]?.insertOffset;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > task.bodyText.length ||
      (offset > 0 && /[\uD800-\uDBFF]/.test(task.bodyText[offset - 1]) && /[\uDC00-\uDFFF]/.test(task.bodyText[offset] ?? ""))) throw new Error("유효하지 않은 insertOffset");
    const nodes = photoTextNodes();
    const expected = normalizeForPosition(task.bodyText);
    const actual = normalizeForPosition(nodes.map((node) => node.textContent ?? "").join(""));
    const rawPrefix = task.images[0]?.insertPrefix;
    const prefix = typeof rawPrefix === "string" ? normalizeForPosition(rawPrefix) : "";
    let mismatch = 0;
    while (mismatch < Math.min(expected.length, actual.length) && expected[mismatch] === actual[mismatch]) mismatch++;
    const extraSuffixLength = Math.max(0, actual.length - expected.length);
    const suffixDiagnostic = extraSuffixLength ? { extraSuffixLength, extraSuffixPreview: actual.slice(expected.length, expected.length + 40) } : {};
    if (extraSuffixLength) console.info("PHOTO_POSITION extra suffix", suffixDiagnostic);
    const fail = (reason: string): never => { throw new Error(`${reason}: ${JSON.stringify({ expectedNormalizedLength: expected.length,
      actualNormalizedLength: actual.length, insertPrefixNormalizedLength: prefix.length, positionMapped: false,
      firstMismatchIndex: expected === actual ? null : mismatch, ...suffixDiagnostic })}`); };
    if (typeof rawPrefix !== "string" || !actual.startsWith(prefix) || mismatch < prefix.length) fail("insertPrefix 범위에서 본문이 일치하지 않습니다.");
    // prefix는 본문 시작에 고정됩니다. 반복 문장이 있어도 부분 문자열 검색은 하지 않습니다.
    const characterOffset = prefix.length;
    let consumed = 0;
    for (const node of nodes) {
      const text = node.textContent ?? "";
      for (let i = 0; i < text.length; i++) {
        if (!normalizeForPosition(text[i])) continue;
        if (characterOffset === 0) return { node, offset: i, characterOffset };
        consumed++;
        if (consumed === characterOffset) return { node, offset: i + 1, characterOffset };
      }
    }
    return fail("insertPrefix 끝에 대응하는 본문 text node 없음");
  }

  function actualPhotoOffset(allowEmptyParagraph = false) {
    const selection = window.getSelection();
    if (!selection?.isCollapsed || selection.rangeCount !== 1 || !selection.focusNode) throw new Error("collapsed caret 없음");
    const caret = selection.getRangeAt(0);
    const nodes = photoTextNodes();
    if (!nodes.some((node) => node.parentElement?.closest(".se-text-paragraph")?.contains(selection.focusNode)) &&
      !(allowEmptyParagraph && inspect().paragraphs.some((p) => p.contains(selection.focusNode)))) throw new Error("본문 밖 caret");
    let consumed = 0;
    for (const node of nodes) {
      const text = node.textContent ?? "";
      if (caret.comparePoint(node, text.length) <= 0) { consumed += normalizeForPosition(text).length; continue; }
      if (caret.comparePoint(node, 0) >= 0) break;
      if (node !== selection.focusNode) throw new Error("caret offset을 확인하지 못했습니다.");
      consumed += normalizeForPosition(text.slice(0, selection.focusOffset)).length;
      break;
    }
    return consumed;
  }

  let blockInitialImages = 0;

  function blockBodyText() {
    return normalizeForPosition(photoTextNodes().map((node) => node.textContent ?? "").join(""));
  }

  function blockTailParagraph() {
    const paragraphs = inspect().paragraphs;
    const images = [...document.querySelectorAll<HTMLElement>(".se-component.se-image")];
    const lastImage = images[images.length - 1];
    const following = paragraphs.filter((paragraph) => !lastImage || !!(lastImage.compareDocumentPosition(paragraph) & Node.DOCUMENT_POSITION_FOLLOWING));
    return following[following.length - 1];
  }

  function setBlockSelection(element: HTMLElement, range: Range) {
    const editable = element.closest<HTMLElement>('[contenteditable="true"]') ?? element;
    editable.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection) throw new Error("본문 selection 없음");
    selection.removeAllRanges();
    selection.addRange(range);
  }

  async function blockRequest(message: ExtensionMessage): Promise<ExtensionReply> {
    if (message.type === "EDITOR_BLOCK_START") {
      assertSafeEditor();
      if (blockBodyText()) throw new Error("V3는 빈 본문에서 시작해야 합니다.");
      blockInitialImages = document.querySelectorAll(".se-component.se-image").length;
      return {};
    }
    if (message.type === "EDITOR_BLOCK_TEXT_VERIFY" || message.type === "EDITOR_BLOCK_VERIFY") {
      if (!message.task) throw new Error("본문 검증 데이터 없음");
      const expected = normalizeForPosition(message.task.bodyText);
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (blockBodyText() === expected) {
          if (message.type === "EDITOR_BLOCK_VERIFY" && document.querySelectorAll(".se-component.se-image").length - blockInitialImages !== message.task.images.length) throw new Error("사진 block 수와 실제 사진 수 불일치");
          return {};
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("순차 입력 본문 문자/순서 불일치");
    }
    const paragraph = blockTailParagraph();
    if (message.type === "EDITOR_BLOCK_CARET") {
      const selection = window.getSelection();
      const node = selection?.anchorNode;
      const element = node?.nodeType === 1 ? node as Element : node?.parentElement;
      if (!paragraph || !selection?.isCollapsed || !node || !paragraph.contains(node) ||
        element?.closest('.se-blind, [hidden], [aria-hidden="true"]')) throw new Error("마지막 본문 문단 caret 없음");
      const remainder = document.createRange();
      remainder.selectNodeContents(paragraph);
      remainder.setStart(node, selection.anchorOffset);
      if (normalizeForPosition(remainder.toString())) throw new Error("본문 끝 caret이 아닙니다.");
      return {};
    }
    if (message.type === "EDITOR_BLOCK_NEXT_TEXT" && !paragraph) {
      const images = [...document.querySelectorAll<HTMLElement>(".se-component.se-image")];
      const image = images[images.length - 1];
      if (!image) throw new Error("다음 문단을 만들 사진 없음");
      const range = document.createRange();
      range.setStartAfter(image); range.collapse(true);
      setBlockSelection(image, range);
      return { needsParagraph: true };
    }
    if (!paragraph) throw new Error("다음 본문 문단 없음");
    if (message.type === "EDITOR_BLOCK_IMAGE_TARGET" || message.type === "EDITOR_BLOCK_NEXT_TEXT") {
      if (normalizeForPosition(paragraph.textContent ?? "")) throw new Error("사진 뒤/사진 입력 문단이 비어 있지 않습니다.");
      if (message.type === "EDITOR_BLOCK_IMAGE_TARGET") {
        const current = inspect();
        photoState = { characterOffset: 0, paragraphCount: current.paragraphs.length, emptyCount: 0,
          imageCount: document.querySelectorAll(".se-component.se-image").length };
      }
      const range = document.createRange();
      range.selectNodeContents(paragraph); range.collapse(true);
      setBlockSelection(paragraph, range);
      return {};
    }
    if (message.type === "EDITOR_BLOCK_TEXT_END") {
      const range = document.createRange();
      range.selectNodeContents(paragraph); range.collapse(false);
      setBlockSelection(paragraph, range);
      return {};
    }
    throw new Error("지원하지 않는 block 요청");
  }

  async function photoRequest(message: ExtensionMessage): Promise<ExtensionReply> {
    if (message.type === "EDITOR_PHOTO_BODY_VERIFY") {
      if (!message.task) throw new Error("본문 검증할 초안 없음");
      const expected = normalizeForPosition(message.task.bodyText);
      const actual = normalizeForPosition(photoTextNodes().map((node) => node.textContent ?? "").join(""));
      if (actual !== expected) throw new Error("사진 삽입 후 본문 문자/순서 불일치");
      return {};
    }
    if (message.type === "EDITOR_PHOTO_TARGET") {
      if (!message.task) throw new Error("초안 없음");
      const current = assertSafeEditor(true);
      const point = photoLocation(message.task);
      const paragraph = point.node.parentElement?.closest<HTMLElement>(".se-text-paragraph") ?? point.node.parentElement;
      if (!paragraph) throw new Error("삽입 text node의 부모 요소 없음");
      photoState = { characterOffset: point.characterOffset, paragraphCount: current.paragraphs.length,
        emptyCount: current.paragraphs.filter((p) => !normalizeForPosition(p.innerText ?? "")).length,
        imageCount: document.querySelectorAll(".se-component.se-image").length };
      const range = document.createRange();
      range.setStart(point.node, point.offset); range.collapse(true);
      if ([...range.getClientRects()].some((rect) => rect.height > 0)) return { position: targetPosition(paragraph, range) };
      const text = point.node.textContent ?? "";
      range.setStart(point.node, point.offset > 0 ? point.offset - 1 : 0);
      range.setEnd(point.node, point.offset > 0 ? point.offset : Math.min(1, text.length));
      return { position: targetPosition(paragraph, range, point.offset > 0, point.offset === 0) };
    }
    if (!photoState) throw new Error("사진 삽입 상태 없음");
    const state = photoState;
    if (message.type === "EDITOR_PHOTO_CARET") {
      if (actualPhotoOffset() !== state.characterOffset) throw new Error("caret이 insertOffset과 다릅니다.");
      return {};
    }
    if (message.type === "EDITOR_PHOTO_EMPTY") {
      const paragraphs = inspect().paragraphs;
      const emptyCount = paragraphs.filter((p) => !normalizeForPosition(p.innerText ?? "")).length;
      if (paragraphs.length <= state.paragraphCount || emptyCount <= state.emptyCount) throw new Error("새 빈 문단 없음");
      let preceding = 0;
      for (const paragraph of paragraphs) {
        const text = normalizeForPosition(paragraph.innerText ?? "");
        if (!text && preceding === state.characterOffset) return { position: targetPosition(paragraph) };
        preceding += text.length;
      }
      throw new Error("insertOffset 위치의 빈 문단 없음");
    }
    if (message.type === "EDITOR_PHOTO_UPLOAD_CARET") {
      const selection = window.getSelection();
      const node = selection?.focusNode;
      const parent = node?.nodeType === 1 ? node as Element : node?.parentElement;
      const paragraph = parent?.closest<HTMLElement>(".se-text-paragraph");
      if (!selection?.isCollapsed || !paragraph || normalizeForPosition(paragraph.innerText ?? "") || actualPhotoOffset(true) !== state.characterOffset) throw new Error("사진 upload target caret이 빈 문단 위치와 다릅니다.");
      state.imageCount = document.querySelectorAll(".se-component.se-image").length;
      return {};
    }
    if (message.type === "EDITOR_PHOTO_BUTTON") {
      const buttons = [...document.querySelectorAll<HTMLElement>(".se-image-toolbar-button")].filter(visible);
      if (buttons.length !== 1) throw new Error("사진 버튼을 확인하지 못했습니다.");
      return { position: targetPosition(buttons[0]) };
    }
    if (message.type === "EDITOR_PHOTO_VERIFY") {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const count = document.querySelectorAll(".se-component.se-image").length;
        if (count > state.imageCount + 1) throw new Error("사진이 1장보다 많이 추가됐습니다.");
        if (count === state.imageCount + 1) {
          photoState = undefined;
          return { imageReady: true };
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error("이미지 컴포넌트 생성 시간 초과");
    }
    throw new Error("지원하지 않는 사진 요청");
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !["EDITOR_DIAGNOSE", "EDITOR_TARGET", "EDITOR_VERIFY", "EDITOR_PHOTO_TARGET", "EDITOR_PHOTO_CARET", "EDITOR_PHOTO_EMPTY", "EDITOR_PHOTO_UPLOAD_CARET", "EDITOR_PHOTO_BUTTON", "EDITOR_PHOTO_VERIFY", "EDITOR_PHOTO_BODY_VERIFY", "EDITOR_BLOCK_START", "EDITOR_BLOCK_CARET", "EDITOR_BLOCK_TEXT_VERIFY", "EDITOR_BLOCK_VERIFY", "EDITOR_BLOCK_NEXT_TEXT", "EDITOR_BLOCK_IMAGE_TARGET", "EDITOR_BLOCK_TEXT_END"].includes(message.type)) return;
    void (async (): Promise<ExtensionReply> => {
      if (message.type.startsWith("EDITOR_PHOTO_")) return photoRequest(message);
      if (message.type.startsWith("EDITOR_BLOCK_")) return blockRequest(message);
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
