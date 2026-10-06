import type { MentionLevel, PresetConfig } from "./presets";

type CheckStatus = "pass" | "warning";
export type QualityCheck = {
  status: CheckStatus;
  warningCount: number;
  checks: { id: string; label: string; status: CheckStatus; detail: string }[];
};

function occurrences(text: string, phrase: string) {
  return phrase ? text.split(phrase).length - 1 : 0;
}
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

export function checkKinAnswer({ answer, question, instructions, productName, mentionLevel, config }: {
  answer: string;
  question: string;
  instructions: string | null;
  productName: string | null;
  mentionLevel: MentionLevel;
  config: PresetConfig | null;
}): QualityCheck {
  const checks: QualityCheck["checks"] = [];
  function add(id: string, label: string, warning: boolean, detail: string) {
    checks.push({ id, label, status: warning ? "warning" : "pass", detail });
  }
  const length = [...answer].length;
  const min = config?.min_chars ?? null;
  const max = config?.max_chars ?? null;
  const range = min !== null && max !== null ? `${min}~${max}자`
    : min !== null ? `${min}자 이상` : max !== null ? `${max}자 이하` : "별도 기준 없음";
  add("length", "글자 수", (min !== null && length < min) || (max !== null && length > max), `현재 ${length}자 / 권장 ${range}`);

  const banned = (config?.banned_phrases ?? []).filter((phrase) => answer.includes(phrase));
  add("banned_phrases", "금지 표현", banned.length > 0, banned.length ? `발견: ${banned.join(", ")}` : "설정된 금지 표현 없음 또는 미발견");

  const paragraphs = answer.replace(/\r/g, "").split(/\n\s*\n/).map((text) => text.trim()).filter(Boolean);
  const limit = config?.max_keyword_mentions_per_paragraph ?? 2;
  const keywords = [...new Set([...(config?.keywords ?? []), productName ?? ""].map((text) => text.trim()).filter(Boolean))];
  const repeated: string[] = [];
  paragraphs.forEach((paragraph, index) => keywords.forEach((keyword) => {
    const count = occurrences(paragraph, keyword);
    if (count > limit) repeated.push(`${index + 1}문단 ‘${keyword}’ ${count}회`);
  }));
  add("keyword_repetition", "키워드 반복", repeated.length > 0,
    repeated.length ? `${repeated.join(" / ")} (문단별 최대 ${limit}회)` : `문단별 최대 ${limit}회 기준 내`);

  const productCount = productName ? occurrences(answer, productName) : 0;
  const productParagraphs = productName ? paragraphs.filter((text) => text.includes(productName)).length : 0;
  const position = productName ? answer.indexOf(productName) : -1;
  const percent = position >= 0 ? Math.round([...answer.slice(0, position)].length / Math.max(length, 1) * 100) : null;
  // Relevance cannot be established by string matching; flag dispersed repetition for human review.
  const dispersed = productCount >= 3 && productParagraphs >= 2;
  add("product_mention", "제품 언급", mentionLevel === "none" ? productCount > 0 : dispersed,
    productCount ? `상품명 첫 등장: 답변의 약 ${percent}% 지점 · ${productCount}회 / ${productParagraphs}개 문단${mentionLevel === "none" ? " · 언급 금지 설정" : dispersed ? " · 여러 문단 반복, 질문 관련성 확인 권장" : ""}`
      : "선택 상품명 미발견 또는 상품 미선택");

  const experiencePhrases = ["제가 써봤는데", "제가 사용해봤는데", "저도 이 증상으로", "제가 직접", "저는 이 제품을"];
  const provided = normalize(instructions ?? "");
  const experience = answer.split(/(?<=[.!?。])\s*|\n+/).map((text) => text.trim()).filter(Boolean)
    .filter((sentence) => experiencePhrases.some((phrase) => sentence.includes(phrase)));
  // Exempt only the actual claim supplied by the user, never every claim because of a generic permission.
  const unsupported = experience.filter((sentence) => !provided.includes(normalize(sentence)));
  add("fake_experience", "개인 경험 표현", unsupported.length > 0,
    unsupported.length ? `확인 필요: ${experiencePhrases.filter((phrase) => unsupported.some((sentence) => sentence.includes(phrase))).join(", ")}`
      : experience.length ? "추가 지침에 제공된 동일 경험 문장만 확인됨" : "검사 대상 개인 경험 표현 미발견");

  const ad = ["강력 추천", "무조건 사세요", "꼭 구매", "최고입니다", "완벽합니다"].filter((phrase) => answer.includes(phrase));
  add("ad_tone", "광고성 문체", ad.length > 0, ad.length ? `확인 필요: ${ad.join(", ")}` : "검사 대상 광고 표현 미발견");

  const healthQuestion = /건강|의료|치료|질환|증상|통증|염증|혈액|혈압|피부|주름|수면|불면|병원|약물|복용|회복|완치/.test(question);
  const claims = ["치료됩니다", "완치됩니다", "확실히 낫습니다", "회복됩니다", "염증이 없어집니다", "혈액순환이 원활해져 치료"]
    .filter((phrase) => answer.includes(phrase));
  add("medical_overclaim", "건강 효과 단정", healthQuestion && claims.length > 0,
    !healthQuestion ? "건강 관련 질문으로 식별되지 않음" : claims.length ? `단정 표현 확인 필요: ${claims.join(", ")}` : "검사 대상 단정 표현 미발견");
  const warningCount = checks.filter((check) => check.status === "warning").length;
  return { status: warningCount ? "warning" : "pass", warningCount, checks };
}
