(() => {
  const normalize = (value: string) => value.replace(/[\u200b\ufeff]/g, "").replace(/\s+/g, " ").trim();
  const visible = (element: HTMLElement) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
  const describe = (element: HTMLElement | undefined) => element ? { tag: element.tagName, class: element.getAttribute("class") ?? "" } : null;

  // Presence checks only; leave insertion/verification normalization unchanged.
  const normalizeEditorText = (value: string) => value.replace(/[\s\u00a0\u200b-\u200d\u2060\ufeff]/g, "");
  const helperSelector = '.se-placeholder, .se-blind, .se-toolbar, [hidden], [aria-hidden="true"], script, style';
  function editorText(root: HTMLElement | undefined) {
    if (!root) return "";
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const fragments: string[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.parentElement && !node.parentElement.closest(helperSelector)) fragments.push(node.textContent ?? "");
    }
    return normalizeEditorText(fragments.join(""));
  }
  function existingImageCount() {
    // Same image-component scope as upload verification; pending real images also count.
    return [...document.querySelectorAll<HTMLElement>(".se-component.se-image")].filter(component =>
      [...component.querySelectorAll<HTMLImageElement>("img")].some(img =>
        !img.closest(helperSelector) && /^(https?:\/\/|blob:|data:image\/)/i.test(img.currentSrc || img.getAttribute("src") || ""))).length;
  }

  function displayed(element: HTMLElement) {
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || node.getAttribute("aria-hidden") === "true" || style.display === "none" ||
        style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") return false;
    }
    return [...element.getClientRects()].some(rect => rect.width > 0 && rect.height > 0);
  }

  let activeEditorReason = "";
  function activeFrame() {
    activeEditorReason = "active";
    try {
      if (document.visibilityState !== "visible") { activeEditorReason = "document_hidden"; return false; }
      let current: Window = window;
      while (current !== current.top) {
        const frame = current.frameElement as HTMLElement | null;
        if (!frame) { activeEditorReason = "parent_frame_inaccessible"; return false; }
        for (let node: HTMLElement | null = frame; node; node = node.parentElement) {
          const style = current.parent.getComputedStyle(node);
          if (node.hidden || node.getAttribute("aria-hidden") === "true" || style.display === "none" ||
            style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") { activeEditorReason = "parent_frame_hidden"; return false; }
        }
        const rect = frame.getBoundingClientRect();
        const left = Math.max(0, rect.left), right = Math.min(current.parent.innerWidth, rect.right);
        const top = Math.max(0, rect.top), bottom = Math.min(current.parent.innerHeight, rect.bottom);
        if (right <= left || bottom <= top) { activeEditorReason = "parent_frame_outside_viewport"; return false; }
        if (current.parent.document.elementFromPoint((left + right) / 2, (top + bottom) / 2) !== frame) { activeEditorReason = "parent_frame_center_obscured"; return false; }
        current = current.parent;
      }
      return true;
    } catch { activeEditorReason = "parent_frame_access_error"; return false; } // Inaccessible parent cannot prove an active editor.
  }

  const editorSession = `${Date.now()}-${Math.random()}`;
  let editorRevision = 0;
  let editorNodes: (HTMLElement | undefined)[] = [];
  // Callers supply only the queried SmartEditor title/paragraph targets. Naver manages their editing host after trusted focus.
  const writable = (element: HTMLElement | undefined) => !!element &&
    !element.closest('[disabled],[inert],[aria-disabled="true"],[aria-hidden="true"]') && getComputedStyle(element).pointerEvents !== "none" && displayed(element);
  const editableHost = (element: HTMLElement) => element.isContentEditable ? element :
    element.closest<HTMLElement>('[contenteditable="true"],[contenteditable="plaintext-only"]') ??
    [...element.querySelectorAll<HTMLElement>('[contenteditable="true"],[contenteditable="plaintext-only"]')].find(writable) ?? null;
  function onScreen(element: HTMLElement) {
    return displayed(element) && [...element.getClientRects()].some(rect =>
      rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight);
  }
  function inspect() {
    const writing = /PostWriteForm\.naver|\/postwrite(?:\?|$|\/)/i.test(location.href);
    const allTitles = [...document.querySelectorAll<HTMLElement>(".se-title-text")];
    const allParagraphs = [...document.querySelectorAll<HTMLElement>(".se-component.se-text .se-text-paragraph")];
    const titles = allTitles.filter(visible);
    const paragraphs = allParagraphs.filter(visible);
    const title = titles.length === 1 ? titles[0] : undefined;
    const body = paragraphs[0];
    const frameReady = writing && document.readyState === "complete" && !!title && !!body;
    const visibleEditor = !!title && !!body && displayed(title) && displayed(body);
    const frameActive = activeFrame();
    const activeEditor = visibleEditor && frameActive;
    const writableEditor = writable(title) && writable(body);
    if (editorNodes[0] !== title || editorNodes[1] !== body) { editorNodes = [title, body]; editorRevision++; }
    const publishRootSelector = '[data-focus-lock="publishLayer"]';
    const publishRoots = [...document.querySelectorAll<HTMLElement>(publishRootSelector)];
    // The root is normally rendered even when settings are closed. Only its visible semantic controls prove open state.
    const publishControls = ['[data-testid="nowTimeRadioBtn"]', '[data-testid="preTimeRadioBtn"]', '[data-testid="seOnePublishBtn"]'];
    const publishPanelCandidates = [publishRootSelector, '[role="dialog"]', '[aria-modal="true"]'].flatMap(selector =>
      [...document.querySelectorAll<HTMLElement>(selector)].map(element => ({ selector, tag: element.tagName, displayed: displayed(element), onScreen: onScreen(element), isPublishPanel: false })));
    const controlCandidates = publishRoots.flatMap(root => publishControls.flatMap(selector =>
      [...root.querySelectorAll<HTMLElement>(selector)].map(element => ({ selector, tag: element.tagName, displayed: displayed(element),
        onScreen: element.getAttribute("data-click-area") !== "tpb.publish" && onScreen(element), isPublishPanel: true }))));
    publishPanelCandidates.push(...controlCandidates);
    const publishPanelOpen = controlCandidates.some(candidate => candidate.onScreen);
    const publishPanelState = { rootFound: publishRoots.length > 0, rootDisplayed: publishRoots.some(displayed),
      nowRadioVisible: controlCandidates.some(candidate => candidate.selector === publishControls[0] && candidate.onScreen),
      preRadioVisible: controlCandidates.some(candidate => candidate.selector === publishControls[1] && candidate.onScreen),
      finalButtonVisible: controlCandidates.some(candidate => candidate.selector === publishControls[2] && candidate.onScreen), publishPanelOpen };
    // A generic role=dialog is not necessarily an open modal or the publish layer.
    const blockingDialogOpen = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"],dialog[open]')].some(onScreen);
    const baseReady = frameReady && visibleEditor && activeEditor && writableEditor && !publishPanelOpen && !blockingDialogOpen;
    const ready = baseReady && activeEditor;
    const fieldState = (element: HTMLElement | undefined): EditorFieldState | null => element ? {
      rects: [...element.getClientRects()].map(rect => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })),
      contenteditable: element.getAttribute("contenteditable"), isContentEditable: element.isContentEditable,
      parentContenteditable: element.parentElement?.getAttribute("contenteditable") ?? null,
      editableDescendants: element.querySelectorAll('[contenteditable="true"],[contenteditable="plaintext-only"]').length,
      editableHostTag: editableHost(element)?.tagName ?? null,
      editableHostContenteditable: editableHost(element)?.getAttribute("contenteditable") ?? null,
      displayed: displayed(element),
    } : null;
    const existingTitle = editorText(title).length > 0;
    const existingBody = paragraphs.some(paragraph => editorText(paragraph).length > 0);
    const imageCount = existingImageCount();
    const diagnostic: EditorDiagnostic = {
      url: `${location.origin}${location.pathname}`, writing, ready, frameReady, visibleEditor, activeEditor,
      publishPanelOpen, publishPanelCandidates, publishPanelState, blockingDialogOpen, writableEditor, stableEditor: false, editorId: `${editorSession}-${editorRevision}`,
      baseReady, documentReadyState: document.readyState, activeEditorReason,
      titleState: fieldState(title ?? allTitles[0]), bodyState: fieldState(body ?? allParagraphs[0]),
      titleFound: allTitles.length > 0, bodyFound: allParagraphs.length > 0,
      existing: existingTitle || existingBody || imageCount > 0,
      iframeCount: document.querySelectorAll("iframe").length, paragraphs: paragraphs.length,
      titleTag: title?.tagName, bodyTag: body?.tagName,
      title: { matchedSelector: ".se-title-text", target: describe(title) },
      body: { matchedSelector: ".se-component.se-text .se-text-paragraph", target: describe(body) },
      reason: ready ? "활성 SmartEditor 글쓰기 화면 확인 완료" : `writing=${writing}, document=${document.readyState}, frameReady=${frameReady}, visible=${visibleEditor}, active=${activeEditor}(${activeEditorReason}), writable=${writableEditor}, publishPanel=${publishPanelOpen}, modal=${blockingDialogOpen}`,
    };
    return { title, body, paragraphs, diagnostic, existingTitle, existingBody, imageCount };
  }

  function assertSafeEditor(allowImages = false) {
    const current = inspect();
    if (current.diagnostic.ready !== true) throw new Error(current.diagnostic.reason);
    if (!allowImages && current.imageCount > 0) throw new Error("이미 사진이 있는 글에는 입력하지 않습니다. 새 글을 열어 주세요.");
    if (current.diagnostic.blockingDialogOpen) throw new Error("열린 모달을 직접 처리한 뒤 다시 시도해 주세요.");
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
    const deadline = Date.now() + (field === "title" ? 2000 : 5000);
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
  type BlockImageSnapshot = { components: HTMLElement[]; textBefore: string; blockNumber: number; imageNumber: number };
  let photoState: { characterOffset: number; paragraphCount: number; emptyCount: number; imageCount: number; block?: BlockImageSnapshot } | undefined;

  function checkBlockImage(snapshot: BlockImageSnapshot) {
    const components = [...document.querySelectorAll<HTMLElement>(".se-component.se-image")];
    const expected = snapshot.components.length + 1;
    const result = { ready: false, invalid: false, reason: "component_pending", expected, actual: components.length };
    if (components.length > expected) return { ...result, invalid: true, reason: "component_count" };
    if (components.length !== expected) return result;
    const image = components[components.length - 1];
    // Existing components may be rebuilt. Compare surviving components without requiring node identity.
    if (snapshot.components.some((previous) => components.includes(previous) &&
      !(previous.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING))) {
      return { ...result, invalid: true, reason: "append_order" };
    }
    const precedingText = normalizeForPosition(photoTextNodes().filter((node) =>
      !!(node.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING))
      .map((node) => node.textContent ?? "").join(""));
    if (precedingText !== snapshot.textBefore) return { ...result, invalid: true, reason: "text_boundary" };
    const ready = [...image.querySelectorAll<HTMLImageElement>("img")].some((img) => {
      const source = img.currentSrc || img.getAttribute("src") || "";
      return /^(https?:\/\/|blob:|data:image\/)/i.test(source) && visible(img) &&
        !img.closest('.se-blind, [hidden], [aria-hidden="true"]') &&
        img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
    });
    return { ...result, ready, reason: ready ? "ready" : "image_pending" };
  }

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
          imageCount: document.querySelectorAll(".se-component.se-image").length,
          block: { components: [...document.querySelectorAll<HTMLElement>(".se-component.se-image")],
            textBefore: blockBodyText(), blockNumber: message.blockNumber ?? 0, imageNumber: message.imageNumber ?? 0 } };
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
      let lastResult;
      while (Date.now() < deadline) {
        if (state.block) {
          lastResult = checkBlockImage(state.block);
          if (lastResult.invalid) throw new Error(`DOM_VALIDATION block=${state.block.blockNumber} image=${state.block.imageNumber} expected=${lastResult.expected} actual=${lastResult.actual} reason=${lastResult.reason}`);
          if (lastResult.ready) {
            photoState = undefined;
            return { imageReady: true };
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
          continue;
        }
        const count = document.querySelectorAll(".se-component.se-image").length;
        if (count > state.imageCount + 1) throw new Error("사진이 1장보다 많이 추가됐습니다.");
        if (count === state.imageCount + 1) {
          photoState = undefined;
          return { imageReady: true };
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (state.block && lastResult) throw new Error(`TIMEOUT block=${state.block.blockNumber} image=${state.block.imageNumber} expected=${lastResult.expected} actual=${lastResult.actual} reason=${lastResult.reason}`);
      throw new Error("이미지 컴포넌트 생성 시간 초과");
    }
    throw new Error("지원하지 않는 사진 요청");
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !["EDITOR_TITLE_FOCUS", "EDITOR_SCHEDULE_FINAL_TARGET", "EDITOR_SCHEDULE", "EDITOR_DIAGNOSE", "EDITOR_TARGET", "EDITOR_VERIFY", "EDITOR_PHOTO_TARGET", "EDITOR_PHOTO_CARET", "EDITOR_PHOTO_EMPTY", "EDITOR_PHOTO_UPLOAD_CARET", "EDITOR_PHOTO_BUTTON", "EDITOR_PHOTO_VERIFY", "EDITOR_PHOTO_BODY_VERIFY", "EDITOR_BLOCK_START", "EDITOR_BLOCK_CARET", "EDITOR_BLOCK_TEXT_VERIFY", "EDITOR_BLOCK_VERIFY", "EDITOR_BLOCK_NEXT_TEXT", "EDITOR_BLOCK_IMAGE_TARGET", "EDITOR_BLOCK_TEXT_END"].includes(message.type)) return;
    void (async (): Promise<ExtensionReply> => {
      if (message.type === "EDITOR_TITLE_FOCUS") {
        const deadline = Date.now() + 1500;
        while (Date.now() < deadline) {
          const current = inspect(), title = current.title, selection = window.getSelection();
          if (current.diagnostic.ready && title && writable(title) &&
            (title.contains(document.activeElement) || (!!selection?.rangeCount && title.contains(selection.anchorNode) && title.contains(selection.focusNode)))) return {};
          await new Promise(resolve => setTimeout(resolve, 75));
        }
        throw new Error("제목 입력 focus를 확인하지 못했습니다.");
      }
      if (message.type === "EDITOR_SCHEDULE_FINAL_TARGET") {
        if (!message.task) throw new Error("예약 Job이 없습니다.");
        const button = NaverSchedule.finalTarget(message.task);
        const position = targetPosition(button);
        if (NaverSchedule.finalTarget(message.task) !== button) throw new Error("최종 발행 버튼이 변경되었습니다.");
        return { position };
      }
      if (message.type === "EDITOR_SCHEDULE") {
        if (!message.task) throw new Error("예약 Job이 없습니다.");
        return NaverSchedule.configure(message.task);
      }
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
      const existing = message.field === "title" ? current.existingTitle : current.existingBody;
      if (existing && !message.overwrite) throw new Error("기존 글 덮어쓰기 확인이 필요합니다.");
      return { position: targetPosition(target), existing };
    })().then(respond, (error: unknown) => respond({ error: error instanceof Error ? error.message : "DOM 조회 실패" }));
    return true;
  });
})();
