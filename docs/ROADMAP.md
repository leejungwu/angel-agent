# Roadmap

Angel Agent의 전체 기능 지도. `[x]`는 명시한 범위의 구현 완료, `[ ]`는 미구현 또는 부분 구현이다.
부분 구현은 항목에 범위를 표시한다. 현재 우선 개발 영역은 Blog이며, 코드가 없는 장기 영역은 계획으로 구분한다.

## Blog 개발 우선순위

1. 콘텐츠 설정 + 템플릿
2. 사진 배치 설정
3. 이미지 전처리 / 재사용
4. execution snapshot + 실패 이력
5. 키워드 관리 / 분석
6. Publishing Queue + 예약
7. 중간 실패 재개
8. 최종 자동 발행
9. 발행 이력 + 검색 순위
10. 경쟁글 / 블로그 분석, AI 이미지, 다중 플랫폼

## Blog

### 작업 / 콘텐츠 생성

- [x] 제품 기반 Task 생성 / 목록 / 수정 / 삭제 보호
- [x] keyword / topic / 추가 지시 입력
- [x] 제품 정보 기반 AI draft 생성 / 재생성 / 저장
- [x] OpenAI / Claude / Grok 제공자 및 모델 선택
- [x] 구조화된 제목 / 도입 / 섹션 / 마무리 생성
- [x] 고정 규칙 / 참고 글쓰기 가이드 / 작업별 지시 분리
- [x] 허위 경험·후기·효능 방지 규칙 / 분량 안내
- [x] Draft 편집 / 승인 / 반려
- [ ] 콘텐츠 설정 + 템플릿 — 부분 구현: Settings 모델·검증·초기 skeleton·Task 설정 패널·JSONB 저장/복원·생성 연결 구현. migration 적용 및 실제 저장 흐름 확인 필요; 프리셋·템플릿 고도화 미구현
- [ ] 콘텐츠 목적 선택 UI와 생성 반영 — 역사적 purpose 값은 목록 표시만 사용
- [ ] 승인 후 편집의 재승인 정책
- [ ] VOC / 고객 표현 / pain point / 구매 동기 / 검색 의도 반영
- [ ] 성과 피드백 기반 다음 주제 추천

### 이미지

- [x] Task 사진 업로드 / 정렬 저장 / 전체 삭제
- [x] 업로드 시 기본 축소 / WebP 압축 후보
- [x] 문단 경계 기반 사진 배치 / 필요 시 prose 분할
- [x] 전체 사진 text/image Block 순차 입력
- [x] V3 사진 10장 Naver 실검증 — 사용자 확인 범위
- [x] 이미지 증가 / 로딩 / 본문 경계·순서 검증
- [ ] 사진 배치 설정 UI
- [ ] 이미지 전처리 / 최적화 / 재사용 확장
- [ ] crop / 밝기 / 테두리 / 워터마크
- [ ] 모자이크 / blur
- [ ] 원본 / 파생본 관리
- [ ] 업로드 완료·이미지 동일성·다양한 규모 검증 강화
- [ ] AI 이미지 생성 / 제품 사진 연결 확장

### 발행

- [x] Chrome Extension 기반 현재 Naver 글쓰기 탭 입력
- [x] 제목 입력 / V3 text-image 순차 입력 / 최대 3장 legacy fallback
- [x] approved draft 강제 / 선택 draft 고정 / 입력 전 재조회
- [x] Side Panel selection race 방지 / 연결 설정 저장
- [x] 수동 발행 준비 / 본문 복사 / 사진 미리보기·번호순 다운로드·ZIP
- [x] 서버 임시 사진 준비 / 종료 cleanup / 실패 단계 표시
- [ ] execution snapshot — draft 내용·사진·배치 설정 고정
- [ ] 영속 실행 / 실패 이력
- [ ] Publishing Queue / 예약
- [ ] 중간 실패 재개 / 재시도 workflow
- [ ] 장시간 signed URL 갱신 / 비정상 종료 cleanup
- [ ] 최종 자동 발행 / 예약 확인 자동화
- [ ] 발행 URL / 시간 / 결과 저장

현재 입력 완료 뒤 최종 검수·발행·예약은 사람이 직접 수행한다. 승인 목록 화면은 실행 Queue가 아니다.

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
- [x] 최근 작업 / 답변 재생성 / 복사
- [x] 제품 정보 / 최신 완료 VOC 참고
- [ ] purpose 선택 UI — API/DB는 지원하지만 현재 UI는 helpful 고정
- [ ] 운영 답변 품질의 지속 검수 / 네이버 답변 등록 지원

### 프롬프트 / 품질

- [x] 고정 규칙 / 공통 스타일 / preset / 질문별 지시 분리
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
- [x] Blog 작성 규칙 및 KIN preset 규칙
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
- [ ] Agent·자동화 실행 이력 / 전사 발행 이력

Blog의 사용자 시작형 Extension과 승인 목록은 구현되어 있지만 범용 Agent 실행·스케줄 플랫폼은 아니다.

## Out of Scope

- 대량 ID/PW 관리
- 프록시 / IP 순환
- 테더링 자동화
- 대량 계정 랜덤 포스팅
- Playwright 기반 Naver publisher로 복귀
