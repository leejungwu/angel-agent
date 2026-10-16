import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
const code = ts.transpileModule((await readFile("extension/schedule.ts", "utf8")) + "\n" + (await readFile("extension/background.ts", "utf8")), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const task = { id: 1, title: "제목", bodyText: "abcdefghij", images: [2, 6, 8].map((insertOffset, index) => ({ id: index, index, insertOffset, insertPrefix: "abcdefghij".slice(0, insertOffset), signedUrl: `https://fixture.test/${index}.png` })) };
const jobId = "00000000-0000-4000-8000-000000000001";
async function scenario(input = task, failure = "", publisher = "legacy", diagnoseOnly = false) {
  let listener, intercepted = false, sequence = 0, uploadVerified = 0, navigated = false, freshPolls = 0;
  const navigations = [];
  const deleteAttempts = new Map(), cleanupDelays = [], cleanupUploadCounts = [];
  const handlers = new Set(), commands = [], messages = [], downloads = [], removed = [], erased = [];
  const timeline = [], outcomes = [];
  const expectedUploads = publisher === "blocks" ? input.images.length : Math.min(input.images.length, 3);
  const logs = [];

  const chrome = {
    storage: { local: { setAccessLevel: async () => {}, get: async () => ({ appUrl: "http://localhost:3000", extensionToken: "fixture-secret" }) } }, sidePanel: { setPanelBehavior: async () => {} },
    tabs: { update: async (_tab, options) => { navigations.push(options.url); if (failure === "freshNavigation") throw new Error("navigation failure"); navigated = true; },
      query: async () => [{ id: 1, url: "https://blog.naver.com/postwrite" }], sendMessage: async (_tab, message) => {
      messages.push(message);
      timeline.push(message.type);
      if (failure === "nextParagraph" && message.type === "EDITOR_BLOCK_NEXT_TEXT" && !messages.some((m) => m.type === "EDITOR_BLOCK_NEXT_TEXT" && m !== message)) return { needsParagraph: true, position: { x: 10, y: 20 } };
      if (message.type === failure) return { error: "fixture failure" };
      if (message.type === "EDITOR_DIAGNOSE") {
        if (navigated) freshPolls++;
        return { diagnostic: { baseReady: !["inactive", "notWritable"].includes(failure), editorId: failure === "unstable" ? String(messages.length) : navigated ? "fresh" : "original", writableEditor: failure !== "notWritable" && !(failure === "delayedInitialization" && navigated && freshPolls <= 2), writing: true, activeEditor: failure !== "inactive", visibleEditor: failure !== "inactive", frameReady: true, ready: failure !== "inactive" && !(navigated && failure === "freshTimeout"), titleFound: true, bodyFound: true, existing: false, publishPanelOpen: failure === "transitionTimeout" && outcomes.length > 0, reason: `raw:${failure || "ready"}` } };
      }
      if (message.type === "EDITOR_SCHEDULE") return { scheduleReady: true };
      if (message.type === "EDITOR_SCHEDULE_FINAL_TARGET") return failure.startsWith("final:") ? { error: failure } : { position: { x: 777, y: 55 } };
      if (message.type === "EDITOR_PHOTO_VERIFY") uploadVerified++;
      if (message.type === "EDITOR_VERIFY") return { verification: { titleMatches: true, bodyMatches: true } };
      return { position: { x: message.type === "EDITOR_PHOTO_BUTTON" ? 99 : 10, y: 20 }, imageReady: true };
    } },
    webNavigation: { getAllFrames: async () => [{ frameId: 2, url: "https://blog.naver.com/PostWriteForm.naver?blogId=fixture_blog&postNo=123" }] },
    debugger: { attach: async () => {}, detach: async () => {}, onDetach: { addListener() {}, removeListener() {} },
      onEvent: { addListener: (handler) => handlers.add(handler), removeListener: (handler) => handlers.delete(handler) },
      sendCommand: async (_target, method, params) => {
        commands.push({ method, params });
        if (method === "Input.insertText") timeline.push(params.text);
        if (method === "DOM.setFileInputFiles") timeline.push("image upload");
        if (method === "DOM.getDocument") {
          assert.equal(intercepted, true);
          assert.equal(handlers.size, 0, "V3 must not register chooser listeners");
          assert.equal(uploadVerified, sequence - 1, "Previous image must be verified before next input lookup");
          if (failure === "missingInput" || (failure === "seventhInput" && sequence === 7)) return { root: { nodeName: "#document", documentURL: "https://blog.naver.com/postwrite", children: [] } };
          const inputNode = { nodeName: "INPUT", backendNodeId: failure === "replacedInput" ? 123 + sequence : 123, attributes: ["type", "file", "accept", "image/*"] };
          if (failure === "ambiguousInput") return { root: { nodeName: "#document", documentURL: "https://blog.naver.com/postwrite", children: [inputNode, { ...inputNode, backendNodeId: 999 }] } };
          if (failure === "iframeInput") return { root: { nodeName: "#document", documentURL: "https://blog.naver.com/", children: [{ nodeName: "IFRAME", contentDocument: { nodeName: "#document", documentURL: "https://blog.naver.com/PostWriteForm.naver", children: [inputNode] } }] } };
          return { root: { nodeName: "#document", documentURL: "https://blog.naver.com/postwrite", children: [
            inputNode,
          ] } };
        }
        if (method === "Page.setInterceptFileChooserDialog") intercepted = params.enabled;
        if (method === "Input.dispatchMouseEvent" && params.type === "mouseReleased" && params.x === 99 && failure !== "timeout") {
          assert.equal(intercepted, true);
          for (const handler of handlers) handler({ tabId: 1 }, "Page.fileChooserOpened", { backendNodeId: failure === "chooser" ? undefined : 123, frameId: "main", mode: "selectMultiple" });
        }
        if (method === "DOM.setFileInputFiles" && failure === "upload") throw new Error("fixture error");
      },
    }, runtime: { id: "fixture", onMessage: { addListener: (handler) => { listener = handler; } } },
  };
  vm.runInNewContext(code, { chrome, URL, AbortSignal, fetch: async (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer fixture-secret");
    assert.equal(url.origin, "http://localhost:3000");
    if (url.pathname.endsWith("/claim")) {
      timeline.push("claim");
      if (timeline.filter(item => item === "claim").length === 1) assert.equal(commands.length, 0, "claim must precede CDP input");
      if (publisher === "legacy" && input.images.length > 3) return { ok: false, json: async () => ({ error: "사진 3장 초과 Job은 V3 순차 입력을 사용하세요." }) };
      return { ok: true, json: async () => ({ ...input, jobId: url.pathname.split("/").at(-2), attemptNo: 1 }) };
    }
    if (url.pathname.endsWith("/result")) {
      outcomes.push(JSON.parse(options.body));
      if (failure === "result") return { ok: false, json: async () => ({ error: "fixture result write error" }) };
      return { ok: true, json: async () => ({ applied: true }) };
    }
    if (options.method === "POST") {
      const body = JSON.parse(options.body); downloads.push(body);
      if (failure === "create") return { ok: false, status: 500, json: async () => ({ error: "fixture create failure" }) };
      const tempId = `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
      return { ok: true, json: async () => ({ tempId, absolutePath: `C:\\Temp\\angel-agent\\naver-upload\\${tempId}.png` }) };
    }
    assert.equal(options.method, "DELETE");
    cleanupUploadCounts.push(uploadVerified);
    if (["", "cleanup", "cleanupRetry", "cleanupOne"].includes(failure)) assert.equal(uploadVerified, expectedUploads, "cleanup must follow all uploads");
    const tempId = url.pathname.split("/").at(-1);
    deleteAttempts.set(tempId, (deleteAttempts.get(tempId) ?? 0) + 1);
    erased.push(tempId);
    if (failure === "cleanup" || (failure === "cleanupOne" && tempId.endsWith("001")) || (failure === "cleanupRetry" && tempId.endsWith("001") && deleteAttempts.get(tempId) < 4)) return { ok: false, status: 500, json: async () => ({ error: "fixture cleanup failure" }) };
    removed.push(url.pathname.split("/").at(-1));
    return { ok: true, json: async () => ({ ok: true }) };
  }, setTimeout: (fn, ms) => { if ([500, 1500, 3000].includes(ms)) { cleanupDelays.push(ms); return setTimeout(fn, 0); } return setTimeout(fn, ms === 250 ? 0 : failure === "timeout" && ms === 15000 ? 5 : ms); }, clearTimeout, Date,
    console: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) } });
  const reply = await new Promise((resolve) => listener({ type: diagnoseOnly ? "DIAGNOSE" : "INSERT", jobId, publisher, task: { title: "untrusted", finalizeMode: "auto" } }, { id: "fixture" }, resolve));
  let nextReply;
  if (["consecutive", "delayedInitialization"].includes(failure)) nextReply = await new Promise(resolve => listener({ type: "INSERT", jobId: "00000000-0000-4000-8000-000000000002", publisher }, { id: "fixture" }, resolve));
  assert.equal(handlers.size, 0); assert.equal(intercepted, false);
  if (["", "cleanup", "cleanupRetry", "cleanupOne"].includes(failure)) assert.ok(cleanupUploadCounts.every((count) => count === expectedUploads));
  return { reply, nextReply, commands, messages, downloads, removed, erased, cleanupDelays, timeline, logs, outcomes, navigations, freshPolls };
}
const success = await scenario();
assert.equal(success.reply.error, undefined);
assert.equal(success.outcomes[0].outcome, "inserted");
assert.equal(success.outcomes[0].attemptNo, 1);
assert.ok(success.timeline.indexOf("EDITOR_TITLE_FOCUS") < success.timeline.indexOf(task.title), "Verify title focus before a single title insertion");
assert.equal(success.commands.filter(command => command.method === "Input.insertText" && command.params.text === task.title).length, 1);
const tooMany = await scenario({ ...task, images: [...task.images, task.images[0]] });
assert.match(tooMany.reply.error, /3장 초과/); assert.equal(tooMany.commands.length, 0);
const lostResult = await scenario(task, "result");
assert.equal(lostResult.reply.error, undefined); assert.match(lostResult.reply.message, /JOB_RESULT/);
assert.deepEqual(lostResult.outcomes.map(item => item.outcome), ["inserted"], "result write failure must never mark successful input failed");
assert.deepEqual(success.downloads.map((d) => d.signedUrl), [task.images[2].signedUrl, task.images[1].signedUrl, task.images[0].signedUrl]);
assert.equal(code.includes("chrome.downloads"), false);
assert.equal(success.commands.filter((c) => c.method === "DOM.setFileInputFiles").length, 3);
assert.ok(success.commands.filter((c) => c.method === "DOM.setFileInputFiles").every((c) => c.params.backendNodeId === 123 && c.params.files.length === 1 && c.params.files[0].startsWith("C:\\")));
assert.equal(success.messages.filter((m) => m.type === "EDITOR_PHOTO_BODY_VERIFY").length, 1);
assert.deepEqual(success.messages.filter((m) => m.type === "EDITOR_PHOTO_TARGET").map((m) => m.task.images[0].index), [2, 1, 0]);
assert.equal(success.removed.length, 3); assert.equal(success.erased.length, 3);
assert.equal(success.commands.some((c) => c.params?.key === "v"), false);
assert.deepEqual(success.commands.filter((c) => c.method === "Input.insertText").map((c) => c.params.text), [task.title, task.bodyText]);
for (const failure of ["create", "chooser", "timeout", "upload", "EDITOR_PHOTO_VERIFY", "EDITOR_PHOTO_CARET", "EDITOR_PHOTO_EMPTY"]) {
  const failed = await scenario(task, failure);
  assert.ok(failed.reply.error);
  assert.equal(failed.outcomes[0].outcome, "failed");
  assert.match(failed.reply.error, /PHOTO_(TEMP_CREATE|FILE_CHOOSER|UPLOAD|POSITION|EMPTY_PARAGRAPH)/);
  assert.equal(failed.downloads.length, 1); assert.equal(failed.erased.length, failure === "create" ? 0 : 1);
  if (failure !== "create") assert.equal(failed.removed.length, 1);
}
const cleanupFailed = await scenario(task, "cleanup");
assert.equal(cleanupFailed.reply.error, undefined);
assert.match(cleanupFailed.reply.message, /PHOTO_TEMP_CLEANUP/);
assert.equal(cleanupFailed.commands.filter((c) => c.method === "DOM.setFileInputFiles").length, 3);
assert.equal(cleanupFailed.erased.length, 12);
assert.deepEqual(cleanupFailed.cleanupDelays, [500, 1500, 3000]);
const cleanupRecovered = await scenario(task, "cleanupRetry");
assert.equal(cleanupRecovered.reply.error, undefined);
assert.equal(cleanupRecovered.reply.message.includes("PHOTO_TEMP_CLEANUP"), false);
assert.equal(cleanupRecovered.erased.length, 6);
assert.deepEqual(cleanupRecovered.cleanupDelays, [500, 1500, 3000]);
const cleanupOne = await scenario(task, "cleanupOne");
assert.match(cleanupOne.reply.message, /임시 사진 1개 정리 실패/);
assert.equal(cleanupOne.reply.error, undefined);
assert.equal(cleanupOne.erased.length, 6);
const plain = await scenario({ ...task, images: [] });
assert.equal(plain.reply.error, undefined); assert.equal(plain.downloads.length, 0);
console.log("Multi-photo checks passed: 3-image cap, reverse offsets, intercepted chooser, absolute paths, server temp cleanup/warning, failure gating, final body verify, unchanged V1.");
for (const count of [0, 1, 2, 8, 10]) {
  const images = Array.from({ length: count }, (_, index) => ({ index, signedUrl: `https://fixture.test/${index}.png` }));
  const blocks = images.flatMap((image, index) => [{ type: "text", text: `text${index + 1}` }, { type: "image", ...image }]);
  blocks.push({ type: "text", text: `text${count + 1}` });
  const blockTask = { ...task, images, blocks, bodyText: blocks.filter((b) => b.type === "text").map((b) => b.text).join("") };
  const result = await scenario(blockTask, "", "blocks");
  assert.equal(result.reply.error, undefined);
  assert.deepEqual(result.downloads.map((d) => d.signedUrl), images.map((image) => image.signedUrl));
  assert.deepEqual(result.timeline.filter((item) => item === "image upload" || /^text\d+$/.test(item)), blocks.map((block) => block.type === "text" ? block.text : "image upload"));
  assert.equal(result.messages.some((m) => ["EDITOR_PHOTO_TARGET", "EDITOR_PHOTO_CARET", "EDITOR_PHOTO_EMPTY"].includes(m.type)), false);
  assert.equal(result.messages.filter((m) => m.type === "EDITOR_BLOCK_VERIFY").length, 1);
  assert.equal(result.commands.filter((c) => c.method === "DOM.getDocument").length, count, "Each block must rediscover the current file input");
  assert.equal(result.commands.filter((c) => c.method === "Page.setInterceptFileChooserDialog" && c.params.enabled).length, count ? 1 : 0, "Block interception must remain enabled across uploads");
  assert.equal(result.removed.length, count);
  if (count === 2) {
    for (const failure of ["iframeInput", "replacedInput"]) {
      const direct = await scenario(blockTask, failure, "blocks");
      assert.equal(direct.reply.error, undefined);
      if (failure === "replacedInput") assert.deepEqual(direct.commands.filter((c) => c.method === "DOM.setFileInputFiles").map((c) => c.params.backendNodeId), [124, 125]);
    }
    for (const failure of ["missingInput", "ambiguousInput"]) {
      const failed = await scenario(blockTask, failure, "blocks");
      assert.match(failed.reply.error, /PHOTO_FILE_INPUT \(image block 1\/2\)/);
      assert.equal(failed.commands.some((c) => c.method === "DOM.setFileInputFiles"), false);
      assert.equal(failed.removed.length, 1);
    }
    const eventMissing = await scenario(blockTask, "timeout", "blocks");
    assert.equal(eventMissing.reply.error, undefined, "No chooser event is required in V3");
    const missingParagraph = await scenario(blockTask, "nextParagraph", "blocks");
    assert.equal(missingParagraph.reply.error, undefined);
    assert.equal(missingParagraph.commands.filter((c) => c.params?.type === "rawKeyDown" && c.params?.key === "ArrowDown").length, 0);
    assert.equal(missingParagraph.commands.filter((c) => c.method === "Input.dispatchMouseEvent" && c.params.type === "mousePressed" && c.params.x !== 99).length, 2, "Only initial title/body clicks; block caret must not use coordinates");
    for (const failure of ["EDITOR_BLOCK_TEXT_VERIFY", "EDITOR_BLOCK_CARET", "EDITOR_BLOCK_NEXT_TEXT", "EDITOR_BLOCK_VERIFY", "upload"]) {
      const failed = await scenario(blockTask, failure, "blocks");
      assert.ok(failed.reply.error);
      assert.equal(failed.removed.length, failed.downloads.length);
    }
    const invalid = await scenario({ ...blockTask, blocks: blocks.slice(1) }, "", "blocks");
    assert.match(invalid.reply.error, /BLOCK_DATA/);
    assert.equal(invalid.downloads.length, 0);
  }
  if (count === 10) {
    const seventh = await scenario(blockTask, "seventhInput", "blocks");
    assert.match(seventh.reply.error, /PHOTO_FILE_INPUT \(image block 7\/10\)/);
    assert.equal(seventh.commands.filter((c) => c.method === "DOM.setFileInputFiles").length, 6);
    assert.equal(seventh.removed.length, 7);
    assert.equal(seventh.logs.find(([name]) => name === "V3 input failed")[1].imageBlockNumber, 7);
  }
}
console.log("Block loop checks passed: 0/1/2/8/10 images, forward text/image order, next paragraph recovery, failure gating, cleanup, no position remapping.");

const scheduledInput = { ...task, images: [], blocks: [{ type: "text", text: task.bodyText }], publishMode: "scheduled", scheduledAt: "2099-10-20T05:30:00.000Z" };
const scheduledSuccess = await scenario(scheduledInput, "", "blocks");
assert.equal(scheduledSuccess.reply.error, undefined);
assert.match(scheduledSuccess.reply.message, /예약 설정이 완료/);
assert.equal(scheduledSuccess.outcomes[0].outcome, "inserted");
assert.ok(scheduledSuccess.timeline.indexOf("EDITOR_BLOCK_VERIFY") < scheduledSuccess.timeline.indexOf("EDITOR_SCHEDULE"));
const scheduledFailure = await scenario(scheduledInput, "EDITOR_SCHEDULE", "blocks");
assert.match(scheduledFailure.reply.error, /SCHEDULE_SETUP/);
assert.equal(scheduledFailure.outcomes[0].outcome, "failed");
for (const scheduledAt of [null, "2000-01-01T00:00:00Z", "2099-10-20T05:43:00Z"]) {
  const invalid = await scenario({ ...scheduledInput, scheduledAt }, "", "blocks");
  assert.ok(invalid.reply.error); assert.equal(invalid.commands.length, 0);
  assert.equal(invalid.messages.some(message => message.type === "EDITOR_TARGET" || message.type === "EDITOR_SCHEDULE"), false);
  assert.equal(invalid.outcomes[0].outcome, "failed");
}
assert.equal(success.messages.some(message => message.type === "EDITOR_SCHEDULE"), false);
console.log("PASS: scheduled preflight before Naver writes, setup after V3 verification, inserted/failed results, unchanged manual path.");
const finalClicks = result => result.commands.filter(command => command.method === "Input.dispatchMouseEvent" && command.params.type === "mouseReleased" && command.params.x === 777).length;
assert.equal(finalClicks(scheduledSuccess), 0, "Missing finalizeMode defaults to review despite client-provided auto");
assert.equal(scheduledSuccess.messages.some(message => message.type === "EDITOR_SCHEDULE_FINAL_TARGET"), false);
const autoInput = { ...scheduledInput, finalizeMode: "auto" };
const autoSuccess = await scenario(autoInput, "", "blocks");
assert.deepEqual(autoSuccess.navigations, ["https://blog.naver.com/PostWriteForm.naver?blogId=fixture_blog"]);
assert.match(autoSuccess.reply.message, /다음 글쓰기 화면을 준비/);
const consecutive = await scenario(autoInput, "consecutive", "blocks");
assert.equal(consecutive.nextReply.error, undefined);
assert.equal(consecutive.timeline.filter(item => item === "claim").length, 2);
assert.deepEqual(consecutive.outcomes.map(result => result.outcome), ["inserted", "inserted"]);
assert.equal(consecutive.navigations.length, 2);
const delayed = await scenario(autoInput, "delayedInitialization", "blocks");
assert.equal(delayed.nextReply.error, undefined);
assert.ok(delayed.freshPolls >= 11, "Two unready polls, three stable polls, next claim preflight and second fresh preparation");
assert.deepEqual(delayed.outcomes.map(result => result.outcome), ["inserted", "inserted"]);
const notWritable = await scenario(autoInput, "notWritable", "blocks");
assert.equal(notWritable.timeline.includes("claim"), false);
assert.match(notWritable.reply.error, /아직 준비되지/);
for (const failure of ["freshNavigation", "freshTimeout", "transitionTimeout"]) {
  const recovered = await scenario(autoInput, failure, "blocks");
  assert.equal(recovered.reply.error, undefined);
  assert.match(recovered.reply.message, /새 글쓰기를 직접/);
  assert.deepEqual(recovered.outcomes.map(result => result.outcome), ["inserted"]);
  if (failure === "transitionTimeout") assert.equal(recovered.navigations.length, 0);
}
const inactive = await scenario(autoInput, "inactive", "blocks");
assert.match(inactive.reply.error, /새 글쓰기/);
assert.equal(inactive.outcomes.length, 0);
assert.equal(inactive.commands.length, 0);
assert.equal(inactive.timeline.includes("claim"), false, "Inactive editor must leave Job queued without claim/result");
assert.equal(scheduledSuccess.navigations.length, 0);
assert.equal(success.navigations.length, 0);
assert.equal(autoSuccess.reply.error, undefined); assert.equal(finalClicks(autoSuccess), 1);
assert.equal(autoSuccess.outcomes[0].outcome, "inserted");
assert.match(autoSuccess.reply.message, /予約|예약 발행 등록을 요청/);
assert.ok(autoSuccess.timeline.indexOf("EDITOR_BLOCK_VERIFY") < autoSuccess.timeline.indexOf("EDITOR_SCHEDULE"));
assert.ok(autoSuccess.timeline.indexOf("EDITOR_SCHEDULE") < autoSuccess.timeline.indexOf("EDITOR_SCHEDULE_FINAL_TARGET"));
for (const failure of ["EDITOR_SCHEDULE", "final:radio", "final:date", "final:hour", "final:minute", "final:past", "final:naverError", "final:missing", "final:disabled"]) {
  const rejected = await scenario(autoInput, failure, "blocks");
  assert.ok(rejected.reply.error, failure); assert.equal(finalClicks(rejected), 0, failure);
  assert.equal(rejected.outcomes[0].outcome, "failed");
}
const manualAuto = await scenario({ ...autoInput, publishMode: "manual" }, "", "blocks");
assert.ok(manualAuto.reply.error); assert.equal(manualAuto.commands.length, 0);
assert.equal(manualAuto.outcomes[0].outcome, "failed");
const resultMissing = await scenario(autoInput, "result", "blocks");
assert.equal(finalClicks(resultMissing), 1); assert.match(resultMissing.reply.message, /JOB_RESULT/);
assert.ok(resultMissing.outcomes.every(outcome => outcome.outcome !== "published"));
console.log("PASS: review=0 final clicks, scheduled-auto=1 trusted click, all guard/setup failures=0, manual-auto rejected, inserted only, no final-click retry.");

const manualReview = await scenario({ ...task, publishMode: "manual", finalizeMode: "review" });
assert.equal(manualReview.reply.error, undefined); assert.equal(finalClicks(manualReview), 0);
assert.equal(manualReview.messages.some(message => message.type === "EDITOR_SCHEDULE"), false);
const explicitReview = await scenario({ ...scheduledInput, finalizeMode: "review" }, "", "blocks");
assert.equal(explicitReview.reply.error, undefined); assert.equal(finalClicks(explicitReview), 0);

for (const failure of ["inactive", "notWritable", "unstable", ""]) {
  const diagnosed = await scenario(task, failure, "legacy", true);
  assert.equal(diagnosed.reply.error, undefined, "DIAGNOSE never requires execution readiness");
  const raw = diagnosed.reply.diagnostics[0].diagnostic;
  assert.ok(raw);
  assert.equal(raw.reason, `raw:${failure || "ready"}`, "Raw reason must not be overwritten");
  assert.equal(raw.stableEditor, failure === "");
  assert.equal(diagnosed.timeline.includes("claim"), false);
  if (failure) {
    const blocked = await scenario(task, failure);
    assert.equal(blocked.timeline.includes("claim"), false);
    assert.equal(blocked.outcomes.length, 0);
  }
}
const unavailable = await scenario(task, "EDITOR_DIAGNOSE", "legacy", true);
assert.equal(unavailable.reply.error, undefined);
assert.match(unavailable.reply.diagnostics[0].reason, /fixture failure/);
console.log("PASS: raw diagnostics survive hidden/unwritable/unstable/missing content replies; stable observation only; INSERT alone gates claim.");
