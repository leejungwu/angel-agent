import type { BlogGenerationSettings } from "./settings";

export const BLOG_TEMPLATE_INSTRUCTIONS: Record<BlogGenerationSettings["template"], string> = {
  review: "사용 계기 또는 고민 → 제공된 사용 과정·경험 → 장단점 → 마무리. 실제 경험이 없으면 경험·변화를 만들지 말고 선택 기준과 제공된 사실을 중심으로 후기형 흐름만 참고한다.",
  informational: "문제 정의 → 핵심 정보 → 원리·판단 기준 → 적용 방법 → 정리. 독자의 궁금증을 해결하는 정보형 흐름을 사용한다.",
  comparison: "비교 대상 → 공통 기준 → 차이점 → 상황별 선택 → 결론. 제공되지 않은 경쟁 제품 사실·수치·우열은 만들지 않는다. 비교 정보가 없으면 확인 가능한 선택 기준을 설명한다.",
  problem_solution: "문제 → 원인·맥락 → 알려진 해결법 → 대안 → 실행·정리. 제공되지 않은 원인이나 제품의 해결 효능을 단정하지 않는다.",
  product_intro: "필요·문제 → 제품 개념 → 특징 → 제공된 사용 방법 → 적합한 대상 → 마무리. 확인된 제품 정보만 사용하고 정보가 없는 단계는 생략한다.",
};
export const BLOG_TONE_INSTRUCTIONS: Record<BlogGenerationSettings["tone"], string> = {
  natural: "자연스러운 한국어 존댓말로 설명하듯 쓴다. 후기처럼 읽히는 문장 리듬을 참고하되 실제 경험을 지어내지 않는다.",
  polite: "친절한 해요체를 중심으로 쓴다. 과도한 친근함·감탄·반복 질문을 피한다.",
  formal: "차분한 합니다체를 중심으로 쓴다. 보고서식 나열이나 불필요한 전문 표현을 피한다.",
};
const EXPOSURE_INSTRUCTIONS: Record<BlogGenerationSettings["productExposure"], string> = {
  low: "제품 언급을 최소화하고 주제의 정보·판단 기준을 중심으로 쓴다.",
  medium: "주제와 관련 있는 지점에서 제품과 확인된 특징을 자연스럽게 연결한다.",
  high: "확인된 제품 개념·특징·적합한 상황을 더 자세히 설명한다. 제품명 반복·구매 압박·근거 없는 효능은 허용하지 않는다.",
};
const CTA_INSTRUCTIONS: Record<BlogGenerationSettings["cta"], string> = {
  none: "추가 CTA나 구매 권유를 넣지 않는다. 자연스럽게 글을 마무리한다.",
  closing: "마무리에서 독자가 확인하거나 실행할 다음 행동을 부드럽게 안내한다. 구매를 강요하거나 제공되지 않은 링크·혜택을 만들지 않는다.",
};

export function buildBlogGenerationInstructions(settings: BlogGenerationSettings) {
  return {
    template: BLOG_TEMPLATE_INSTRUCTIONS[settings.template], tone: BLOG_TONE_INSTRUCTIONS[settings.tone],
    length: `제목 제외·공백 포함·줄바꿈 제외 본문 약 ${settings.targetLength}자를 목표로 한다. 사실을 창작하거나 설명을 반복해 분량을 채우지 않는다.`,
    sections: `sections 배열의 소제목/본문을 약 ${settings.sectionCount}개 목표로 구성한다. template skeleton은 흐름 참고이며 단계별로 반드시 section을 하나씩 만들 필요는 없다.`,
    keyword: settings.mainKeyword ? `메인 키워드 ${JSON.stringify(settings.mainKeyword)}를 문맥에 맞게 사용한다. 제목 제외 본문에서 ${settings.keywordUsage.min}~${settings.keywordUsage.max}회 사용을 목표로 하되 자연스러운 문장과 사실성을 우선한다.` : null,
    productExposure: EXPOSURE_INSTRUCTIONS[settings.productExposure], cta: CTA_INSTRUCTIONS[settings.cta],
    additionalInstructions: settings.additionalInstructions ?? null,
  };
}
