# Roadmap

Angel Agent의 전체 기능 지도. `[x]`는 명시한 범위의 구현 완료, `[ ]`는 미구현 또는 부분 구현이다.
부분 구현은 항목에 범위를 표시한다. 현재 우선 개발 영역은 Blog이며, 코드가 없는 장기 영역은 계획으로 구분한다.

## Blog 개발 우선순위

1. 사진 배치 설정 migration 적용 / 실제 운영 검증
2. 사진 관리 migration 적용 / 운영 검증 및 이미지 전처리·최적화 확장
3. VOC → Blog 연결
4. 키워드 관리 / 검색 의도 / 검색량
5. 실제 운영 데이터 축적
6. 발행 이력 / 검색 순위
7. 예약 발행
8. 중간 실패 재개
9. 최종 자동 발행
10. 경쟁글 / 블로그 분석 / AI 이미지 / 다중 플랫폼

## Blog

### 작업 / 콘텐츠 생성

- [x] 제품 기반 Task 생성 / 목록 / 수정 / 삭제 보호
- [x] keyword / topic / 추가 지시 입력
- [x] 제품 정보 기반 AI draft 생성 / 재생성 / 저장
- [x] OpenAI / Claude / Grok 제공자 및 모델 선택
- [x] 구조화된 제목 / 도입 / 섹션 / 마무리 생성
- [x] 사용자 편집 Blog Prompt Preset 4영역 / Task별 keyword·instructions 분리
- [x] 기존 사실성·문체 규칙을 초기 프리셋으로 보존 / 명시적인 최소·목표·최대 분량
- [x] Draft 편집 / 승인 / 반려
- [x] 최신 생성 결과 식별 / 같은 Task의 생성 이력·이전 draft 선택
- [x] Blog 프리셋 생성 / 편집 / 삭제 / 복제 / Task별 선택
- [x] 후기형·정보형·비교형·문제 해결형·제품 소개형 초기 프리셋 seed
- [x] Draft별 생성 snapshot / 당시 프리셋·설정·provider/model 이력 조회
- [x] Blog 프리셋 migration 적용 / 실제 저장·생성 운영 검증
- [ ] 콘텐츠 목적 선택 UI와 생성 반영 — 역사적 purpose 값은 목록 표시만 사용
- [x] 편집 저장 시 draft 재검수 — 승인·반려 무효화 / 기존 Job snapshot 유지
- [ ] VOC / 고객 표현 / pain point / 구매 동기 / 검색 의도 반영
- [ ] 성과 피드백 기반 다음 주제 추천

### 이미지

- [x] Task 사진 업로드 / 정렬 저장 / 전체 삭제
- [x] Blog 사진 개별 삭제 / 위·아래 순서 변경 / 작은 미리보기
- [x] 사진 순서 즉시 반영 / 연속 클릭 직렬 저장 / 저장 실패 시 복원
- [x] Task 사진 제거와 Job 원본 보존 분리 — 개별/전체 제거 시 참조 Storage 유지
- [x] Product 사진의 Blog Task 독립 복사·재사용 / Task별 원본 중복 방지
- [x] Blog 이미지 crop / 밝기 / 텍스트 워터마크 / 사각 영역 Blur
- [x] Blog 이미지 기본 보정 — 밝기 / 대비 / 채도 / 색온도 / 선명도
- [x] Blog 이미지 필터 preset / 안쪽 테두리 / 결과 크기·형식·예상 용량 표시
- [x] Blog 원본 / 편집본 상태 표시 / 원본 복원 — 새 경로 저장·기존 Job 파일 보존
- [ ] 이미지 편집 migration 적용 / 실제 사진 편집·복원 운영 검증
- [ ] 사진 관리 migration 적용 / 실제 저장·삭제·재사용 운영 검증
- [x] 업로드 시 기본 축소 / WebP 압축 후보
- [x] 문단 경계 기반 사진 배치 / 필요 시 prose 분할
- [x] 전체 사진 text/image Block 순차 입력
- [x] V3 사진 10장 Naver 실검증 — 사용자 확인 범위
- [x] 이미지 증가 / 로딩 / 본문 경계·순서 검증
- [x] Task 사진 배치 설정 UI — 도입 뒤 첫 사진 / 마무리 앞 마지막 사진 / 문단 자동 분할
- [ ] 사진 배치 설정 migration 적용 / 실제 운영 검증
- [ ] 이미지 전처리 / 최적화 / 재사용 확장 — Product 복사 외 관리 기능
- [ ] 이미지 워터마크 확장
- [ ] 모자이크 / 자유형 Blur 확장
- [ ] 원본 / 파생본 관리 확장 — 버전 이력·안전한 파일 정리
- [ ] 업로드 완료·이미지 동일성·다양한 규모 검증 강화
- [ ] AI 이미지 생성 / 제품 사진 연결 확장

### 발행

- [x] Chrome Extension 기반 현재 Naver 글쓰기 탭 입력
- [x] 제목 입력 / V3 text-image 순차 입력 / 최대 3장 legacy fallback
- [x] approved draft 강제 / 선택 draft 고정 / 입력 전 재조회
- [x] Side Panel selection race 방지 / 연결 설정 저장
- [x] 수동 발행 준비 / 본문 복사 / 사진 미리보기·번호순 다운로드·ZIP
- [x] 서버 임시 사진 준비 / 종료 cleanup / 실패 단계 표시
- [x] Publication Job 기반 — 테이블 migration / 승인 Draft 등록 함수 / immutable 실행 snapshot / runtime parser / 중복 등록 방지
- [x] 웹 Queue — 승인 Draft 등록 / Job 목록·snapshot 사진 수 / queued 제거
- [x] 모든 상태 Job의 Storage 원본 보존 / Job이 있는 Task 전체 삭제 차단
- [x] Publication Job migration 적용 / 실제 웹 운영 검증
- [ ] 등록·사진 삭제 동시 요청의 원자성 / DB·Storage 직접 삭제 보호
- [x] Publication Job의 Extension 입력 연결 / snapshot adapter / 실행 직전 사진 URL 발급
- [x] queued 조건부 선점 / attempt_no / inserted·failed 결과 기록 / 늦은 결과 차단
- [x] snapshot 기반 V3 payload / legacy 3장 초과 차단 — mock 검증
- [x] 새 Job 실행 연결의 실제 Chrome/Naver 운영 검증
- [ ] 실행별 상세 실패 이력
- [x] 10분 이상 지난 inserting 수동 복구 / 시작 시각·attempt 조건부 보호 / 자동 재실행 없음
- [x] 웹 수동 발행 완료 기록 / 선택 http·https URL / published_at 기록
- [x] failed Job 동일 snapshot 재대기 / 다음 claim에서만 attempt 증가
- [ ] 예약 발행
- [ ] 중간 실패 재개
- [ ] 장시간 signed URL 갱신 / 비정상 종료 cleanup
- [ ] 최종 자동 발행 / 예약 확인 자동화
- [ ] Naver 실제 발행 결과 자동 확인

현재 입력 완료 뒤 최종 검수·발행·예약은 사람이 직접 수행한다. Extension은 queued Job의 고정 snapshot을 실행한다. 웹에서 사용자가 발행 완료를 기록하고 failed Job을 같은 자료로 재대기할 수 있다. 실제 발행 여부는 자동 검증하지 않는다.

### 키워드 / 운영 분석

- [x] Task별 keyword 입력
- [ ] 키워드 목록 관리 / 검색량 / 연관 키워드 / 경쟁도
- [ ] 검색 순위 추적 / 발행 이력 기반 성과 분석
- [ ] 경쟁글 / 기존 콘텐츠 분석
- [ ] 블로그 분석 / 다음 콘텐츠 추천
- [ ] 콘텐츠 캘린더 / 업로드 계획 / 키워드 기반 기획

## Product

### 기본 운영

- [x] 상품 목록 / 등록 / 상세 / 편집 / 삭제
- [x] 브랜드 / USP / 타깃 고객 / 고객 문제 / 메모 관리
- [x] 제품 사진 업로드 / 목록 / 미리보기 / DB·Storage 연결
- [ ] 제품 사진 개별 삭제 / 편집 / 재정렬 등 전체 관리
- [ ] 제품 정보·사진의 채널별 재사용 / 동기화

### 소싱 — 계획

- [ ] 소싱 후보 / 공급사 DB 및 관리
- [ ] 견적 비교 / 원가 / MOQ / 리드타임 관리
- [ ] 경쟁 제품·리뷰·시장 기회 분석 / AI 제품 평가
- [ ] 공급사 모니터링 / 제품 조사 자동화

## VOC

### 리뷰 / 분석

- [x] 제품별 CSV / XLSX 리뷰 가져오기 / 중복 처리 / import 결과 기록
- [x] 리뷰 DB / 제품 연결 / 분석 실행 상태·결과 저장
- [x] OpenAI VOC 분석 / 긴 입력의 분할 분석·통합
- [x] pain point / 욕구 / 구매 동기 / 고객 표현 / 반론 추출
- [x] 반복 키워드 / 제품 개선 인사이트 / FAQ 후보 / 광고 hook 후보
- [x] 제품 상세 분석 UI / VOC dashboard
- [x] KIN에서 최신 완료 VOC 참고
- [ ] Blog 생성에 VOC 직접 연결
- [ ] 리뷰 자동 동기화 / 분석 결과의 콘텐츠·광고 성과 피드백

FAQ와 광고 hook은 분석 결과의 후보이며 별도 완성 FAQ·광고 제작기가 아니다.

## KIN

### 질문 / 답변 생성

- [x] 질문 / URL / 카테고리 / 추가 지시 / 선택적 제품 연결
- [x] 제품 언급 수준 none / relevant / direct
- [x] OpenAI / Claude / Grok 선택 / 구조화된 답변 저장
- [x] 최근 작업 / 과거 Task별 Draft 조회·선택 / 답변 재생성 / 복사
- [x] 신규 답변의 질문 의도·provider/model 기록 / 기존 답변의 기록 없음 표시
- [x] 제품 정보 / 최신 완료 VOC 참고
- [ ] purpose 선택 UI — API/DB는 지원하지만 현재 UI는 helpful 고정
- [ ] 운영 답변 품질의 지속 검수 / 네이버 답변 등록 지원

### 프롬프트 / 품질

- [x] DB 공통 Prompt / 선택 preset snapshot / 질문별 추가 지시 분리
- [x] 공통 시스템·스타일 prompt 조회·편집·저장 UI / 명시적 우선순위
- [x] schema 범위 내 preset 글자 수 검증 / direct·none·실제 제품 언급 hard validation
- [x] KIN 공통 Prompt migration 적용 / 실제 생성·답변 이력 운영 검증
- [x] preset 생성 / 편집 / 삭제 / 복제 / 기본 preset 초기 선택
- [x] 문단 수 / 글자 수 / 키워드 / 반복 제한 / 금칙어 / 제품 언급 설정
- [x] 재생성용 preset snapshot
- [x] 길이·문단·금칙어·키워드·제품 언급 검사
- [x] 허위 경험·광고 문체·건강 과장 표현 경고
- [ ] 기본 preset 변경 UI / 채널 등록·승인 정책

품질 검사는 heuristic 경고이며 사실 검증 엔진이나 모든 위반의 자동 차단은 아니다.

## Ecommerce — 운영 데이터 확장 계획

- [ ] 매출 dashboard / 주문 분석 / 상품 수익성 / 원가·가격·마진 분석
- [ ] 재고 관리 / KPI / 기간 비교 / 주간·월간 추세
- [ ] Cafe24 / Naver Commerce / Coupang API 연결
- [ ] 매출·주문·재고 동기화 / 재고 알림

현재 구현된 상품 CRUD와 위 운영 분석 계획은 구분한다. Dashboard 메뉴만으로 매출 분석이 구현된 것은 아니다.

## 광고 / 경쟁사 — 계획

### 레퍼런스 / 모니터링

- [ ] 광고 레퍼런스·경쟁 광고 DB / 제품 연결
- [ ] hook / 문제·욕구 / proof / CTA / 구조 / tone 분석
- [ ] Meta Ad Library / 신규 광고 / 카피·소재 변화 모니터링
- [ ] 경쟁사 가격·프로모션·신제품 / 시장 gap·키워드 기회 / 일간·주간 보고

### 광고 성과

- [ ] Meta Ads / Google Ads API
- [ ] 계정·캠페인·광고세트·광고·소재 분석
- [ ] 지출 / CTR / CVR / CPA / CPR / ROAS / 기간별 추세
- [ ] 소재 thumbnail dashboard / 성과 우수·부진 소재 탐지
- [ ] AI 액션 계획 / 신규 hook·소재 추천

## 콘텐츠 / 상세페이지 / 소셜 — 채널 확장 계획

- [ ] 광고 hook·copy·변형 / CTA / 타깃별 카피
- [ ] 15·30·60초 숏폼 대본 / shot list / 자막 timing / 전환 진단
- [ ] 시리즈·시즌·트렌드 콘텐츠 / Threads / Instagram / 다중 플랫폼
- [ ] 범용 draft 저장·승인 workflow — 현재 Blog/KIN 범위만 구현
- [ ] 바이럴 광고 구조 재현 / 제품·모델·배경 교체 / 한국어 현지화 / A/B 소재
- [ ] Topview / Higgsfield 등 영상 도구 연결
- [ ] 상세페이지 전략 / 섹션 구성 / USP·benefit·proof·FAQ·CTA / sales copy
- [ ] 상세페이지 경쟁 gap·브랜드 tone / 이미지 prompt / Figma handoff
- [ ] React template preview·AI 편집 / SVG·motion / GIF·배너
- [ ] 소셜 콘텐츠 수집 / 바이럴·hook·구조·트렌드 분석 / 자동 게시·성과 추적

## 사내 지식 / Prompt / Skills

- [x] Blog/KIN/VOC 구조화 출력 schema
- [x] Blog/KIN 공통 AI provider transport
- [x] Blog/KIN 사용자 편집 프리셋 및 생성 조건 기록
- [ ] 제품 문서·공급사 견적 / 브랜드·문체 규칙 / SOP·인수인계·의사결정 자료 관리
- [ ] 기존 광고·콘텐츠 / 매출·광고 보고서 / 계약 데이터 수집·추출
- [ ] 전사 문서 검색 / RAG / 회사 지식 조회
- [ ] Google Drive / 로컬·공유 폴더 / 문서·제품 asset·브랜드 자료 동기화
- [ ] Prompt template library / 제품·브랜드별 prompt / version 관리
- [ ] 재사용 Agent Skills / workflow templates / 장기 콘텐츠 규칙 관리

## 데이터 / 파일 / 생성 미디어

### 범용 파일 운영 — 계획

- [ ] 범용 CSV/XLSX 가져오기·mapping — 현재 제품 리뷰 전용 import만 구현
- [ ] PDF / spreadsheet / 이미지 데이터 추출 / MAP 자동 입력
- [ ] 파일 분류 / 일괄 이름 변경·변환 / 폴더 정리
- [ ] 제품 이미지 batch processing / resize·압축·WebP·파일명 규칙 확장

### 생성 미디어 — 계획

- [ ] Gemini 등 AI 이미지 / 제품·광고·상세페이지·Blog 이미지 / prompt 생성
- [ ] Kling / Veo / Seedance 등 AI 영상 / 제품·광고 영상 / 영상 prompt
- [ ] upscaling / Magnific / Photoshop / CapCut 후처리 연계

## Automation / Agent / 운영 관리 — 확장 계획

### 자동화 / Agent

- [ ] 예약 수집 / Cron / webhook / 조건부·background workflow
- [ ] 매출·광고·재고·리뷰 sync / 공급사·경쟁사 감시 / 파일 처리
- [ ] 이상 탐지 / 일간·주간 보고 / 작업·workflow 이력
- [ ] 자연어 명령 / tool 선택·호출 / 다단계 실행 / 중요 작업 사람 승인
- [ ] 제품·VOC·시장·공급사·원가·광고·콘텐츠·매출·재고 업무의 Agent Skills 연결
- [ ] MCP / OpenClaw / Codex / Claude Code의 제품 내 실행 연계

### 성장 / 승인 / 접근 관리

- [ ] 매출 목표 / 콘텐츠 calendar / 일정·성과 피드백 / 다음 액션 추천
- [ ] 소재 테스트 계획 / A/B 관리
- [ ] Slack / 이메일 / 중요 변경·발행 실패 알림
- [ ] 범용 사람 승인 큐 / 광고 변경 승인 / 채널별 발행 전 승인
- [ ] 사용자 인증 / 내부 역할·권한 / 감사 로그 / credential 관리
- [ ] Blog/KIN 관리용 설정 API의 anon write 제거
- [ ] 관리용 설정 API를 위한 서버 전용 Supabase client 도입
- [ ] Blog/KIN 관리용 설정 API의 관리자 인증 경계 추가
- [ ] Agent·자동화 실행 이력 / 전사 발행 이력

Blog의 사용자 시작형 Extension과 승인 목록은 구현되어 있지만 범용 Agent 실행·스케줄 플랫폼은 아니다.

## Out of Scope

- 대량 ID/PW 관리
- 프록시 / IP 순환
- 테더링 자동화
- 대량 계정 랜덤 포스팅
- Playwright 기반 Naver publisher로 복귀
