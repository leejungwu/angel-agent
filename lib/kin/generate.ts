export const KIN_MODEL = "gpt-5-mini";

export type KinAnswer = {
  answer: string;
  questionIntent: string;
  productMentioned: boolean;
};

export const ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "questionIntent", "productMentioned"],
  properties: {
    answer: { type: "string", minLength: 200, maxLength: 1500,
      description: "사용자의 질문에 실제로 답하는 완성된 네이버 지식인 한국어 답변 본문. 한 글자, 단어 하나, 제목만 반환하지 말고 여러 문장으로 충분히 작성한다." },
    questionIntent: { type: "string", minLength: 8, maxLength: 250,
      description: "사용자가 무엇을 묻고 있는지 한국어 한 문장으로 요약한 질문 의도." },
    productMentioned: { type: "boolean",
      description: "실제 answer 본문에 선택된 상품명 또는 브랜드명이 등장하면 true, 등장하지 않거나 상품 미선택이면 false." },
  },
};

export function isKinAnswer(value: unknown): value is KinAnswer {
  return kinAnswerValidationErrors(value).length === 0;
}

export function kinAnswerValidationErrors(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["output_not_object"];
  const item = value as Record<string, unknown>;
  const errors: string[] = [];
  // JSON Schema string lengths count Unicode code points, not UTF-16 units.
  for (const key of ["answer", "questionIntent"] as const) {
    const text = item[key];
    const limit = ANSWER_SCHEMA.properties[key].maxLength;
    if (typeof text !== "string") errors.push(`${key}_not_string`);
    else {
      if (!/\S/u.test(text)) errors.push(`${key}_empty`);
      if ([...text].length < ANSWER_SCHEMA.properties[key].minLength) errors.push(`${key}_too_short`);
      if ([...text].length > limit) errors.push(`${key}_too_long`);
    }
  }
  if (typeof item.productMentioned !== "boolean") errors.push("productMentioned_not_boolean");
  if (Object.keys(item).some((key) => !ANSWER_SCHEMA.required.includes(key))) errors.push("unexpected_keys");
  return errors;
}

// Only a few insights, never the complete analysis JSON or review evidence.
export function compactVoc(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const categories = ["pain_points", "desires", "purchase_motivations", "customer_language", "objections", "faq_candidates"];
  const data = result as Record<string, unknown>;
  return Object.fromEntries(categories.map((key) => {
    const items = Array.isArray(data[key]) ? data[key] : [];
    const valid = items.filter((item): item is { text: string; estimated_mentions?: number | null } =>
      !!item && typeof item === "object" && typeof item.text === "string");
    return [key, valid.slice().sort((a, b) =>
      (typeof b.estimated_mentions === "number" ? b.estimated_mentions : -1) -
      (typeof a.estimated_mentions === "number" ? a.estimated_mentions : -1)
    ).slice(0, 3).map((item) => item.text.slice(0, 300))];
  }));
}
