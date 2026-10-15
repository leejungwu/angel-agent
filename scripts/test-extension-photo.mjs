import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
const code = ts.transpileModule((await readFile("extension/schedule.ts", "utf8")) + "\n" + (await readFile("extension/background.ts", "utf8")), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const task = { id: 1, title: "제목", bodyText: "abcdefghij", images: [2, 6, 8].map((insertOffset, index) => ({ id: index, index, insertOffset, insertPrefix: "abcdefghij".slice(0, insertOffset), signedUrl: `https://fixture.test/${index}.png` })) };
const jobId = "00000000-0000-4000-8000-000000000001";
async function scenario(input = task, failure = "", publisher = "legacy") {
  let listener, intercepted = false, sequence = 0, uploadVerified = 0;
  const deleteAttempts = new Map(), cleanupDelays = [], cleanupUploadCounts = [];
  const handlers = new Set(), commands = [], messages = [], downloads = [], removed = [], erased = [];
  const timeline = [], outcomes = [];
  const expectedUploads = publisher === "blocks" ? input.images.length : Math.min(input.images.length, 3);
  const logs = [];

  const chrome = {
    storage: { local: { setAccessLevel: async () => {}, get: async () => ({ appUrl: "http://localhost:3000", extensionToken: "fixture-secret" }) } }, sidePanel: { setPanelBehavior: async () => {} },
    tabs: { query: async () => [{ id: 1, url: "https://blog.naver.com/postwrite" }], sendMessage: async (_tab, message) => {
      messages.push(message);
      timeline.push(message.type);
      if (failure === "nextParagraph" && message.type === "EDITOR_BLOCK_NEXT_TEXT" && !messages.some((m) => m.type === "EDITOR_BLOCK_NEXT_TEXT" && m !== message)) return { needsParagraph: true, position: { x: 10, y: 20 } };
      if (message.type === failure) return { error: "fixture failure" };
      if (message.type === "EDITOR_DIAGNOSE") return { diagnostic: { frameReady: true, ready: true, titleFound: true, bodyFound: true } };
      if (message.type === "EDITOR_SCHEDULE") return { scheduleReady: true };
      if (message.type === "EDITOR_PHOTO_VERIFY") uploadVerified++;
      if (message.type === "EDITOR_VERIFY") return { verification: { titleMatches: true, bodyMatches: true } };
      return { position: { x: message.type === "EDITOR_PHOTO_BUTTON" ? 99 : 10, y: 20 }, imageReady: true };
    } },
    webNavigation: { getAllFrames: async () => [{ frameId: 2, url: "https://blog.naver.com/PostWriteForm.naver" }] },
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
      assert.equal(commands.length, 0, "claim must precede CDP input");
      if (publisher === "legacy" && input.images.length > 3) return { ok: false, json: async () => ({ error: "사진 3장 초과 Job은 V3 순차 입력을 사용하세요." }) };
      return { ok: true, json: async () => ({ ...input, jobId, attemptNo: 1 }) };
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
  const reply = await new Promise((resolve) => listener({ type: "INSERT", jobId, publisher, task: { title: "untrusted" } }, { id: "fixture" }, resolve));
  assert.equal(handlers.size, 0); assert.equal(intercepted, false);
  if (["", "cleanup", "cleanupRetry", "cleanupOne"].includes(failure)) assert.ok(cleanupUploadCounts.every((count) => count === expectedUploads));
  return { reply, commands, messages, downloads, removed, erased, cleanupDelays, timeline, logs, outcomes };
}
const success = await scenario();
assert.equal(success.reply.error, undefined);
assert.equal(success.outcomes[0].outcome, "inserted");
assert.equal(success.outcomes[0].attemptNo, 1);
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
