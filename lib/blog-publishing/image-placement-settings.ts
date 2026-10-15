export type BlogImagePlacementSettings = {
  pinFirstAfterIntro: boolean;
  pinLastBeforeClosing: boolean;
  allowParagraphSplit: boolean;
};

export const DEFAULT_BLOG_IMAGE_PLACEMENT_SETTINGS: Readonly<BlogImagePlacementSettings> = Object.freeze({
  pinFirstAfterIntro: false,
  pinLastBeforeClosing: false,
  allowParagraphSplit: true,
});

export function resolveBlogImagePlacementSettings(value: unknown): BlogImagePlacementSettings {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const result = { ...DEFAULT_BLOG_IMAGE_PLACEMENT_SETTINGS };
  for (const key of Object.keys(result) as (keyof BlogImagePlacementSettings)[]) {
    if (Object.hasOwn(source, key) && typeof source[key] === "boolean") result[key] = source[key];
  }
  return result;
}

// DB reads tolerate historical values; writes reject misspelled or non-boolean settings.
export function parseBlogImagePlacementSettings(value: unknown): BlogImagePlacementSettings {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.entries(value).some(([key, setting]) =>
    !Object.hasOwn(DEFAULT_BLOG_IMAGE_PLACEMENT_SETTINGS, key) || typeof setting !== "boolean")) {
    throw new Error("사진 배치 설정은 세 가지 체크박스의 참/거짓 값만 저장할 수 있습니다.");
  }
  return resolveBlogImagePlacementSettings(value);
}
