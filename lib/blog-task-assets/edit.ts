import { scaledBlogImageSize } from "../blog-task-assets";

export type ImageRect = { x: number; y: number; width: number; height: number };
export type ImageEdit = {
  crop: ImageRect;
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  sharpness: number;
  filter: "none" | "vivid" | "warm" | "cool" | "grayscale" | "high-contrast";
  border: { enabled: boolean; width: number; color: string };
  watermark: { text: string; position: "top-left" | "top-right" | "center" | "bottom-left" | "bottom-right"; opacity: number; fontSize: number };
  blurRegions: ImageRect[];
};
export const BLOG_IMAGE_WEBP_QUALITY = 0.82;
export const DEFAULT_IMAGE_EDIT: ImageEdit = {
  crop: { x: 0, y: 0, width: 1, height: 1 }, brightness: 100,
  contrast: 100, saturation: 100, temperature: 0, sharpness: 0, filter: "none",
  border: { enabled: false, width: 0, color: "#000000" },
  watermark: { text: "", position: "bottom-right", opacity: 0.5, fontSize: 32 }, blurRegions: [],
};

// Rectangles are fractions: crop uses the original; blur uses the cropped output.
export function parseImageEdit(value: unknown): ImageEdit {
  if (!value || typeof value !== "object") throw new Error("이미지 편집 설정을 확인해 주세요.");
  const supplied = value as Partial<ImageEdit>;
  if (!supplied.crop || supplied.brightness === undefined || !supplied.watermark || !supplied.blurRegions) throw new Error("기존 Crop·밝기·워터마크·Blur 설정을 확인해 주세요.");
  const input = { ...DEFAULT_IMAGE_EDIT, ...supplied, border: { ...DEFAULT_IMAGE_EDIT.border, ...supplied.border } };
  const range = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max;
  const validRect = (rect: ImageRect) => rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0 && rect.x + rect.width <= 1.000001 && rect.y + rect.height <= 1.000001;
  const watermark = input.watermark;
  if (!validRect(input.crop) || !Number.isFinite(input.brightness) || input.brightness < 50 || input.brightness > 150 ||
    !range(input.contrast, 50, 150) || !range(input.saturation, 0, 200) || !range(input.temperature, -100, 100) || !range(input.sharpness, 0, 100) ||
    !["none", "vivid", "warm", "cool", "grayscale", "high-contrast"].includes(input.filter) ||
    (supplied.border !== undefined && (!supplied.border || typeof supplied.border !== "object" || Array.isArray(supplied.border))) ||
    typeof input.border.enabled !== "boolean" || !range(input.border.width, 0, 30) || !/^#[0-9a-f]{6}$/i.test(input.border.color) ||
    !watermark || typeof watermark.text !== "string" || watermark.text.length > 100 ||
    !["top-left", "top-right", "center", "bottom-left", "bottom-right"].includes(watermark.position) ||
    !Number.isFinite(watermark.opacity) || watermark.opacity < 0 || watermark.opacity > 1 ||
    !Number.isFinite(watermark.fontSize) || watermark.fontSize < 8 || watermark.fontSize > 128 ||
    !Array.isArray(input.blurRegions) || input.blurRegions.length > 20 || !input.blurRegions.every(validRect)) {
    throw new Error("Crop·밝기·워터마크·Blur 설정 범위를 확인해 주세요.");
  }
  const rect = ({ x, y, width, height }: ImageRect) => ({ x, y, width, height });
  return { crop: rect(input.crop), brightness: input.brightness, contrast: input.contrast, saturation: input.saturation, temperature: input.temperature, sharpness: input.sharpness, filter: input.filter,
    border: { enabled: input.border.enabled, width: input.border.width, color: input.border.color },
    watermark: { text: watermark.text, position: watermark.position, opacity: watermark.opacity, fontSize: watermark.fontSize }, blurRegions: input.blurRegions.map(rect) };
}

export function applyImagePreset(settings: ImageEdit, filter: ImageEdit["filter"]): ImageEdit {
  const adjustments = { brightness: 100, contrast: 100, saturation: 100, temperature: 0, sharpness: 0 };
  const presets = {
    none: {}, vivid: { contrast: 110, saturation: 115, sharpness: 25 }, warm: { temperature: 25, saturation: 105 },
    cool: { temperature: -25, saturation: 105 }, grayscale: { saturation: 0 }, "high-contrast": { contrast: 130 },
  };
  return { ...settings, ...adjustments, ...presets[filter], filter };
}

export function adjustImagePixels(pixels: Uint8ClampedArray, width: number, height: number, temperature: number, sharpness: number): Uint8ClampedArray {
  if (!temperature && !sharpness) return pixels;
  const adjusted = pixels.slice();
  if (temperature) for (let i = 0; i < adjusted.length; i += 4) {
    adjusted[i] += temperature * 0.25;
    adjusted[i + 2] -= temperature * 0.25;
  }
  if (!sharpness) return adjusted;
  const output = adjusted.slice(), strength = sharpness / 100 * 0.35;
  // Bounded five-point kernel; clamp edge samples and preserve alpha.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    const left = (y * width + Math.max(0, x - 1)) * 4, right = (y * width + Math.min(width - 1, x + 1)) * 4;
    const top = (Math.max(0, y - 1) * width + x) * 4, bottom = (Math.min(height - 1, y + 1) * width + x) * 4;
    for (let channel = 0; channel < 3; channel++) output[offset + channel] = adjusted[offset + channel] + strength *
      (4 * adjusted[offset + channel] - adjusted[left + channel] - adjusted[right + channel] - adjusted[top + channel] - adjusted[bottom + channel]);
  }
  return output;
}

export function dragImageRect(start: { x: number; y: number }, end: { x: number; y: number }): ImageRect {
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const x = clamp(Math.min(start.x, end.x)), y = clamp(Math.min(start.y, end.y));
  return { x, y, width: clamp(Math.max(start.x, end.x)) - x, height: clamp(Math.max(start.y, end.y)) - y };
}

export function renderEditedImage(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, value: ImageEdit, previewMaxEdge?: number): HTMLCanvasElement {
  const settings = parseImageEdit(value), { crop, watermark } = settings;
  const canvas = document.createElement("canvas");
  const size = scaledBlogImageSize(sourceWidth * crop.width, sourceHeight * crop.height);
  const ratio = previewMaxEdge ? Math.min(1, previewMaxEdge / Math.max(size.width, size.height)) : 1;
  canvas.width = Math.max(1, Math.round(size.width * ratio)); canvas.height = Math.max(1, Math.round(size.height * ratio));
  const scale = canvas.width / size.width;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("이미지 편집 Canvas를 시작하지 못했습니다.");
  // Omit neutral filters to preserve the v1 rendering path exactly for old metadata.
  context.filter = [`brightness(${settings.brightness}%)`, ...(settings.contrast === 100 ? [] : [`contrast(${settings.contrast}%)`]), ...(settings.saturation === 100 ? [] : [`saturate(${settings.saturation}%)`])].join(" ");
  context.drawImage(source, sourceWidth * crop.x, sourceHeight * crop.y, sourceWidth * crop.width, sourceHeight * crop.height, 0, 0, canvas.width, canvas.height);
  context.filter = "none";
  if (settings.temperature || settings.sharpness) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    pixels.data.set(adjustImagePixels(pixels.data, canvas.width, canvas.height, settings.temperature, settings.sharpness));
    context.putImageData(pixels, 0, 0);
  }
  if (settings.blurRegions.length) {
    const snapshot = document.createElement("canvas"); snapshot.width = canvas.width; snapshot.height = canvas.height;
    const snapshotContext = snapshot.getContext("2d");
    if (!snapshotContext) throw new Error("Blur Canvas를 시작하지 못했습니다.");
    snapshotContext.drawImage(canvas, 0, 0);
    for (const region of settings.blurRegions) {
      context.save(); context.beginPath();
      context.rect(region.x * canvas.width, region.y * canvas.height, region.width * canvas.width, region.height * canvas.height);
      context.clip(); context.filter = `blur(${12 * scale}px)`; context.drawImage(snapshot, 0, 0); context.restore();
    }
  }
  if (settings.border.enabled && settings.border.width > 0) {
    const thickness = Math.min(settings.border.width * scale, canvas.width / 2, canvas.height / 2);
    context.strokeStyle = settings.border.color; context.lineWidth = thickness;
    context.strokeRect(thickness / 2, thickness / 2, canvas.width - thickness, canvas.height - thickness);
  }
  if (watermark.text.trim()) {
    context.filter = "none"; context.globalAlpha = watermark.opacity;
    context.font = `${watermark.fontSize * scale}px sans-serif`; context.fillStyle = "white";
    context.shadowColor = "rgba(0,0,0,0.8)"; context.shadowBlur = 3 * scale;
    const center = watermark.position === "center", right = watermark.position.endsWith("right");
    context.textAlign = center ? "center" : right ? "right" : "left";
    context.textBaseline = center ? "middle" : watermark.position.startsWith("top") ? "top" : "bottom";
    context.fillText(watermark.text, center ? canvas.width / 2 : right ? canvas.width - 12 * scale : 12 * scale, center ? canvas.height / 2 : watermark.position.startsWith("top") ? 12 * scale : canvas.height - 12 * scale, Math.max(1, canvas.width - 24 * scale));
  }
  return canvas;
}

export function editedImageBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob?.size && blob.type === "image/webp" ? resolve(blob) : reject(new Error("WebP 저장 이미지 생성 실패")), "image/webp", BLOG_IMAGE_WEBP_QUALITY));
}
