import { isBlogTaskAssetPath, type BlogTaskAsset } from "../blog-task-assets";

export function numberedImageFilename(storagePath: string, index: number) {
  const extension = storagePath.match(/\.(jpe?g|png|webp)$/i)?.[1].toLowerCase();
  if (!extension || !Number.isSafeInteger(index) || index < 0) throw new Error("Invalid image filename");
  return `${String(index + 1).padStart(2, "0")}.${extension}`;
}

export function orderedTaskImages(taskId: string | number, assets: BlogTaskAsset[]) {
  if (assets.some((asset) => !isBlogTaskAssetPath(taskId, asset.storage_path))) throw new Error("다른 작업 또는 올바르지 않은 사진 경로입니다.");
  return [...assets].sort((a, b) => a.sort_order - b.sort_order || String(a.id).localeCompare(String(b.id), "en", { numeric: true }));
}

// ZIP STORE format: images are already compressed; no additional dependency.
export function createImageZip(files: { name: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  if (files.length > 65535) throw new Error("Too many ZIP entries");
  const locals: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    if (!/^\d+\.(jpe?g|png|webp)$/i.test(file.name)) throw new Error("Invalid ZIP image name");
    let crc = 0xffffffff;
    for (const byte of file.data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = new Uint8Array(30 + name.length + file.data.length), view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(12, 33, true);
    view.setUint32(14, crc, true); view.setUint32(18, file.data.length, true); view.setUint32(22, file.data.length, true);
    view.setUint16(26, name.length, true); local.set(name, 30); local.set(file.data, 30 + name.length);
    const entry = new Uint8Array(46 + name.length), record = new DataView(entry.buffer);
    record.setUint32(0, 0x02014b50, true); record.setUint16(4, 20, true); record.setUint16(6, 20, true); record.setUint16(14, 33, true);
    record.setUint32(16, crc, true); record.setUint32(20, file.data.length, true); record.setUint32(24, file.data.length, true);
    record.setUint16(28, name.length, true); record.setUint32(42, offset, true); entry.set(name, 46);
    locals.push(local); central.push(entry); offset += local.length;
  }
  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
  if (offset + centralSize + 22 > 0xffffffff) throw new Error("ZIP exceeds supported size");
  const result = new Uint8Array(offset + centralSize + 22);
  let position = 0;
  for (const part of [...locals, ...central]) { result.set(part, position); position += part.length; }
  const end = new DataView(result.buffer, position);
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
  return result;
}
