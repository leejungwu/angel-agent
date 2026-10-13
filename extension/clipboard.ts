window.prepareImageClipboard = async (signedUrl: string | undefined): Promise<ExtensionReply> => {
  let stage: NonNullable<ExtensionReply["clipboardStage"]> = "PHOTO_FETCH";
  let status: number | null = null, contentType = "", blobSize = 0;
  let originalMime = "", originalSize = 0, convertedMime = "", convertedSize = 0;
  try {
    const url = new URL(signedUrl ?? "");
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("사진 URL 형식 오류");
    const response = await fetch(url.href, { credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30000) });
    status = response.status;
    contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!response.ok) throw new Error("사진 다운로드 실패");
    let blob = await response.blob();
    blobSize = blob.size;
    if (!blobSize || blobSize > 10 * 1024 * 1024) throw new Error("사진 크기 오류: 0 초과 10MB 이하 필요");
    if (!["image/png", "image/jpeg", "image/webp"].includes(contentType)) throw new Error("사진 MIME 오류: PNG/JPEG/WebP 필요");
    stage = "PHOTO_CONVERT";
    originalMime = blob.type; originalSize = blob.size;
    if (contentType !== "image/png") {
      const bitmap = await createImageBitmap(blob);
      try {
        if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 24_000_000) throw new Error("사진 해상도 오류");
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("PNG 변환 준비 실패");
        context.drawImage(bitmap, 0, 0);
        blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((png) => png ? resolve(png) : reject(new Error("PNG 변환 실패")), "image/png"));
      } finally { bitmap.close(); }
    }
    convertedMime = blob.type; convertedSize = blob.size;
    if (convertedMime !== "image/png" || !convertedSize) throw new Error("유효한 PNG Blob이 아닙니다.");
    stage = "PHOTO_CLIPBOARD_API";
    if (typeof navigator.clipboard?.write !== "function" || typeof ClipboardItem === "undefined") throw new Error("Clipboard API 또는 ClipboardItem 없음");
    stage = "PHOTO_CLIPBOARD_FOCUS";
    const documentHasFocus = document.hasFocus();
    if (!documentHasFocus) return { clipboardStage: stage, error: JSON.stringify({ documentHasFocus, originalMime, pngBlobSize: blob.size, clipboardApiAvailable: true }) };
    stage = "PHOTO_CLIPBOARD_WRITE";
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return { clipboardWritten: true };
  } catch (error) {
    // 브라우저 오류에 포함될 수 있는 signed URL과 토큰을 진단에서 제외합니다.
    const safe = (value: string) => value.replace(/https?:\/\/\S+/gi, "[URL]").replace(/(?:token|authorization|signature|apikey)\s*[:=]\s*\S+/gi, "[redacted]").slice(0, 200);
    const exceptionName = safe(error && typeof error === "object" && "name" in error ? String(error.name) : "Error");
    const exceptionMessage = safe(error && typeof error === "object" && "message" in error ? String(error.message) : "처리 실패");
    const diagnostic = stage === "PHOTO_FETCH" ? { stage, status, contentType: safe(contentType), blobSize }
      : stage === "PHOTO_CONVERT" ? { originalMime, originalSize, convertedMime, convertedSize, exceptionName, exceptionMessage }
      : { exceptionName, exceptionMessage };
    return { clipboardStage: stage, error: JSON.stringify(diagnostic) };
  }
};
