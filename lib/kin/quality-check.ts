import type { MentionLevel, PresetConfig } from "./presets";

/**
 * 개별 Quality Check 결과 상태
 *
 * pass    = 문제 없음
 * warning = 사람이 확인하거나 수정할 필요가 있음
 */
type CheckStatus = "pass" | "warning";

/**
 * KIN 답변 전체 Quality Check 결과
 */
export type QualityCheck = {
  // 하나라도 warning이 있으면 전체 상태도 warning
  status: CheckStatus;

  // 발생한 warning 개수
  warningCount: number;

  // 개별 검사 결과
  checks: {
    id: string;
    label: string;
    status: CheckStatus;
    detail: string;
  }[];
};

/**
 * 특정 문자열이 text 안에 몇 번 등장하는지 계산한다.
 *
 * 예:
 * occurrences("윗잠베개 윗잠베개", "윗잠베개") => 2
 */
function occurrences(text: string, phrase: string) {
  return phrase ? text.split(phrase).length - 1 : 0;
}

/**
 * 문자열의 연속 공백 / 줄바꿈을 하나의 공백으로 정리한다.
 *
 * 주로 추가 지침에 실제 경험이 입력됐는지 검사할 때 사용한다.
 */
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * KIN 생성 답변을 규칙에 따라 검사한다.
 */
export function checkKinAnswer({
  answer,
  question,
  instructions,
  productName,
  mentionLevel,
  config,
}: {
  // LLM이 생성한 최종 지식인 답변
  answer: string;

  // 사용자가 입력한 지식인 질문
  question: string;

  // 이번 질문에만 입력한 추가 지침
  instructions: string | null;

  // 선택된 상품명
  productName: string | null;

  // none / relevant / direct
  mentionLevel: MentionLevel;

  // 선택한 프리셋의 구조화 설정
  config: PresetConfig | null;
}): QualityCheck {
  /**
   * 모든 검사 결과를 여기에 차례대로 저장한다.
   */
  const checks: QualityCheck["checks"] = [];

  /**
   * 검사 결과를 checks 배열에 추가하는 공통 함수
   */
  function add(
    id: string,
    label: string,
    warning: boolean,
    detail: string,
  ) {
    checks.push({
      id,
      label,
      status: warning ? "warning" : "pass",
      detail,
    });
  }

  // ------------------------------------------------------------
  // 1. 글자 수 검사
  // ------------------------------------------------------------

  /**
   * 생성 답변의 실제 문자 수
   *
   * [...answer]를 사용하는 이유:
   * JavaScript의 단순 length보다 유니코드 문자를 조금 더 자연스럽게 센다.
   */
  const answerLength = [...answer].length;

  /**
   * 프리셋에 설정된 최소 글자 수
   *
   * 프리셋에 값이 없다면 별도의 최소 기준을 강제하지 않는다.
   */
  const minChars = config?.min_chars ?? null;

  /**
   * 프리셋에 설정된 최대 글자 수
   *
   * 프리셋에 값이 없다면 별도의 최대 기준을 강제하지 않는다.
   */
  const maxChars = config?.max_chars ?? null;

  /**
   * UI에 보여줄 권장 글자 수 문자열
   */
  const lengthRange =
    minChars !== null && maxChars !== null
      ? `${minChars}~${maxChars}자`
      : minChars !== null
        ? `${minChars}자 이상`
        : maxChars !== null
          ? `${maxChars}자 이하`
          : "별도 기준 없음";

  /**
   * 최소 또는 최대 글자 수를 벗어났는지 여부
   */
  const lengthWarning =
    (minChars !== null && answerLength < minChars) ||
    (maxChars !== null && answerLength > maxChars);

  add(
    "length",
    "글자 수",
    lengthWarning,
    `현재 ${answerLength}자 / 권장 ${lengthRange}`,
  );

  // ------------------------------------------------------------
  // 2. 금지 표현 검사
  // ------------------------------------------------------------

  /**
   * 프리셋에 등록된 금지 표현 중
   * 실제 답변에 등장한 표현만 추출한다.
   *
   * 예:
   * 핵심은
   * 정리하면
   * 다음과 같습니다
   */
  const foundBannedPhrases = (config?.banned_phrases ?? []).filter(
    (phrase) => answer.includes(phrase),
  );

  add(
    "banned_phrases",
    "금지 표현",
    foundBannedPhrases.length > 0,
    foundBannedPhrases.length > 0
      ? `발견: ${foundBannedPhrases.join(", ")}`
      : "설정된 금지 표현 없음 또는 미발견",
  );

  // ------------------------------------------------------------
  // 3. 문단 분리
  // ------------------------------------------------------------

  /**
   * 빈 줄을 기준으로 답변을 실제 문단 배열로 분리한다.
   *
   * 예:
   *
   * 문단1
   *
   * 문단2
   *
   * => ["문단1", "문단2"]
   */
  const paragraphs = answer
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((text) => text.trim())
    .filter(Boolean);

  // ------------------------------------------------------------
  // 4. 문단 수 검사
  // ------------------------------------------------------------

  /**
   * 프리셋에서 원하는 문단 수
   *
   * null이면 문단 수를 강제하지 않는다.
   */
  const expectedParagraphCount = config?.paragraph_count ?? null;

  /**
   * 현재 문단 수가 프리셋의 목표 문단 수와 다른지 검사한다.
   */
  const paragraphCountWarning =
    expectedParagraphCount !== null &&
    paragraphs.length !== expectedParagraphCount;

  add(
    "paragraph_count",
    "문단 수",
    paragraphCountWarning,
    expectedParagraphCount !== null
      ? `현재 ${paragraphs.length}문단 / 설정 ${expectedParagraphCount}문단`
      : `현재 ${paragraphs.length}문단 / 별도 기준 없음`,
  );

  // ------------------------------------------------------------
  // 5. 키워드 반복 검사
  // ------------------------------------------------------------

  /**
   * 프리셋에 설정된
   * "문단별 키워드 최대 사용 횟수"
   *
   * 값이 없으면 반복 횟수를 임의로 하드코딩해서 판단하지 않는다.
   */
  const keywordLimit =
    config?.max_keyword_mentions_per_paragraph ?? null;

  /**
   * 검사할 키워드 목록
   *
   * - 프리셋 추천 키워드
   * - 선택된 상품명
   *
   * 중복된 키워드는 Set으로 제거한다.
   */
  const keywords = [
    ...new Set(
      [
        ...(config?.keywords ?? []),
        productName ?? "",
      ]
        .map((text) => text.trim())
        .filter(Boolean),
    ),
  ];

  /**
   * 반복 기준을 초과한 문단 정보를 저장한다.
   *
   * 예:
   * 3문단 '윗잠베개' 3회
   */
  const repeatedKeywords: string[] = [];

  /**
   * 프리셋에 반복 횟수 제한이 설정된 경우에만 검사한다.
   */
  if (keywordLimit !== null) {
    paragraphs.forEach((paragraph, paragraphIndex) => {
      keywords.forEach((keyword) => {
        const count = occurrences(paragraph, keyword);

        if (count > keywordLimit) {
          repeatedKeywords.push(
            `${paragraphIndex + 1}문단 ‘${keyword}’ ${count}회`,
          );
        }
      });
    });
  }

  add(
    "keyword_repetition",
    "키워드 반복",
    repeatedKeywords.length > 0,
    repeatedKeywords.length > 0
      ? `${repeatedKeywords.join(" / ")} (문단별 최대 ${keywordLimit}회)`
      : keywordLimit !== null
        ? `문단별 최대 ${keywordLimit}회 기준 내`
        : "프리셋에 반복 횟수 기준 없음",
  );

  // ------------------------------------------------------------
  // 6. 제품 언급 검사
  // ------------------------------------------------------------

  /**
   * 답변 전체에서 상품명이 등장한 총 횟수
   */
  const productCount = productName
    ? occurrences(answer, productName)
    : 0;

  /**
   * 상품명이 등장한 문단 개수
   */
  const productParagraphCount = productName
    ? paragraphs.filter((paragraph) =>
        paragraph.includes(productName),
      ).length
    : 0;

  /**
   * 상품명이 처음 등장하는 문자열 위치
   *
   * 등장하지 않으면 -1
   */
  const productPosition = productName
    ? answer.indexOf(productName)
    : -1;

  /**
   * 상품명이 답변 전체의 몇 % 지점에서 처음 등장했는지 계산한다.
   *
   * 이 값은 경고 판단용이 아니라
   * 사람이 제품 등장 타이밍을 확인할 수 있게 보여주는 정보다.
   */
  const productPositionPercent =
    productPosition >= 0
      ? Math.round(
          ([...answer.slice(0, productPosition)].length /
            Math.max(answerLength, 1)) *
            100,
        )
      : null;

  /**
   * 제품 언급 관련 경고
   *
   * 현재는 절대 규칙만 검사한다.
   *
   * mentionLevel=none인데 상품명이 등장한 경우만 warning.
   *
   * "제품이 몇 % 이후에 나와야 한다"
   * "3번 이상 나오면 무조건 경고"
   * 같은 스타일 규칙은 여기서 하드코딩하지 않는다.
   */
  const productMentionWarning =
    mentionLevel === "none" && productCount > 0;

  add(
    "product_mention",
    "제품 언급",
    productMentionWarning,
    productCount > 0
      ? `상품명 첫 등장: 답변의 약 ${productPositionPercent}% 지점 · ${productCount}회 / ${productParagraphCount}개 문단${
          mentionLevel === "none"
            ? " · 언급 금지 설정"
            : ""
        }`
      : "선택 상품명 미발견 또는 상품 미선택",
  );

  // ------------------------------------------------------------
  // 7. 허위 개인 경험 검사
  // ------------------------------------------------------------

  /**
   * AI가 임의로 만들어낼 가능성이 높은
   * 대표적인 1인칭 경험 표현
   *
   * 이 목록은 스타일 규칙이 아니라
   * 모든 프리셋에 적용되는 사실성 검사이므로 코드에 유지한다.
   */
  const experiencePhrases = [
    "제가 써봤는데",
    "제가 사용해봤는데",
    "저도 이 증상으로",
    "제가 직접",
    "저는 이 제품을",
    "저도 써봤는데",
    "제가 써보니",
    "제가 사용해보니",
  ];

  /**
   * 이번 질문에서 사용자가 입력한 추가 지침
   *
   * 실제 경험 정보가 제공됐는지 판단하기 위해 정규화한다.
   */
  const providedInstructions = normalize(
    instructions ?? "",
  );

  /**
   * 추가 지침에 실제 개인 경험 내용이 포함돼 있을 가능성을
   * 판단하기 위한 패턴
   *
   * 단순히 "경험담처럼 써줘"라고 적은 것을
   * 실제 경험 제공으로 인정하면 안 되기 때문에
   * 1인칭 + 구체적인 서술 형태를 우선 감지한다.
   */
  const providedExperiencePatterns = [
    /제가 .{2,}/,
    /저는 .{2,}/,
    /저도 .{2,}/,
    /직접 .{2,}/,
    /사용해봤/,
    /사용했/,
    /써봤/,
    /썼었/,
    /겪었/,
    /고생했/,
    /해봤/,
  ];

  /**
   * 사용자의 추가 지침에 실제 경험 정보가 존재하는지 여부
   */
  const hasProvidedExperience =
    providedExperiencePatterns.some((pattern) =>
      pattern.test(providedInstructions),
    );

  /**
   * 생성 답변을 문장 단위로 나눈 뒤
   * 1인칭 경험 표현이 포함된 문장만 추출한다.
   */
  const experienceSentences = answer
    .split(/(?<=[.!?。])\s*|\n+/)
    .map((text) => text.trim())
    .filter(Boolean)
    .filter((sentence) =>
      experiencePhrases.some((phrase) =>
        sentence.includes(phrase),
      ),
    );

  /**
   * 생성 답변에 개인 경험 표현이 있는데
   * 사용자가 실제 경험을 추가 지침으로 제공하지 않았다면 warning.
   *
   * 실제 경험이 제공됐으면 자동 통과시키되,
   * UI detail에서 최종 내용 확인을 권장한다.
   */
  const fakeExperienceWarning =
    experienceSentences.length > 0 &&
    !hasProvidedExperience;

  /**
   * 답변에서 실제로 발견된 경험 표현 목록
   */
  const foundExperiencePhrases =
    experiencePhrases.filter((phrase) =>
      experienceSentences.some((sentence) =>
        sentence.includes(phrase),
      ),
    );

  add(
    "fake_experience",
    "개인 경험 표현",
    fakeExperienceWarning,
    experienceSentences.length === 0
      ? "검사 대상 개인 경험 표현 미발견"
      : hasProvidedExperience
        ? "추가 지침에 실제 경험 정보가 제공됨 · 생성된 경험 내용이 입력 범위와 일치하는지 최종 확인 권장"
        : `제공되지 않은 개인 경험 가능성 확인: ${foundExperiencePhrases.join(", ")}`,
  );

  // ------------------------------------------------------------
  // 8. 과도한 광고성 문체 검사
  // ------------------------------------------------------------

  /**
   * 모든 프리셋에서 공통으로 피해야 할
   * 대표적인 과도한 광고성 표현
   */
  const adTonePhrases = [
    "강력 추천",
    "무조건 사세요",
    "꼭 구매",
    "최고입니다",
    "완벽합니다",
  ];

  /**
   * 실제 답변에서 발견된 광고성 표현
   */
  const foundAdTonePhrases =
    adTonePhrases.filter((phrase) =>
      answer.includes(phrase),
    );

  add(
    "ad_tone",
    "광고성 문체",
    foundAdTonePhrases.length > 0,
    foundAdTonePhrases.length > 0
      ? `확인 필요: ${foundAdTonePhrases.join(", ")}`
      : "검사 대상 광고 표현 미발견",
  );

  // ------------------------------------------------------------
  // 9. 의료 / 건강 효과 단정 검사
  // ------------------------------------------------------------

  /**
   * 건강 질문 여부와 상관없이
   * 답변에 등장하면 확인해야 할 강한 의료 효과 단정 표현
   *
   * 질문 분류를 먼저 하지 않는 이유:
   * 어떤 질문이든 이런 표현이 생성됐다면 검토하는 편이 안전하다.
   */
  const medicalOverclaimPhrases = [
    "치료됩니다",
    "완치됩니다",
    "확실히 낫습니다",
    "회복됩니다",
    "염증이 없어집니다",
    "혈액순환이 원활해져 치료",
  ];

  /**
   * 실제 답변에서 발견된 의료 효과 단정 표현
   */
  const foundMedicalClaims =
    medicalOverclaimPhrases.filter((phrase) =>
      answer.includes(phrase),
    );

  add(
    "medical_overclaim",
    "건강 효과 단정",
    foundMedicalClaims.length > 0,
    foundMedicalClaims.length > 0
      ? `단정 표현 확인 필요: ${foundMedicalClaims.join(", ")}`
      : "검사 대상 단정 표현 미발견",
  );

  // ------------------------------------------------------------
  // 10. 전체 결과 계산
  // ------------------------------------------------------------

  /**
   * warning 상태인 검사 개수
   */
  const warningCount = checks.filter(
    (check) => check.status === "warning",
  ).length;

  /**
   * warning이 하나라도 있으면
   * 전체 Quality Check 상태도 warning으로 반환한다.
   */
  return {
    status: warningCount > 0 ? "warning" : "pass",
    warningCount,
    checks,
  };
}