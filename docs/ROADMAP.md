# ANGEL AGENT Roadmap

## Current Focus

기준: 2026-10-13, main ffcca198 이후의 Chrome Extension 기반 구조를 chore/blog-cleanup에서 문서화한다. [x]는 명시한 범위의 구현 완료를 뜻한다. 실검증 완료는 별도로 표시하며 모든 상황의 운영 품질 보장을 뜻하지 않는다. (partial)은 미완료로 유지한다. V3 사진 10장 검증은 사용자가 실제 운영 환경에서 확인한 사실이며 이번 문서 작업에서 API/Naver를 재실행하지 않았다.

- Blog v1: 실제 윗잠베개 Product 정보 입력, prompt 강하게 튜닝, CONTENT_STRATEGY / COPYWRITING 자료 정리, 실제 사진 asset 확보.
- Blog: Chrome Extension + CDP + content script의 V3 Block 순차 입력을 사용한다. 실제 저장 draft의 사진 10장, text/image 순서, 마지막 본문과 입력 완료 안내까지 사용자 실검증 완료.
- /prepare는 수동 복사·검수·fallback 경로다. legacy 최대 3장 입력도 fallback으로 유지한다. 최종 네이버 발행 버튼은 사람이 직접 클릭한다.
- KIN: prompt tuning 마무리, 실제 답변 품질 검수, 완료 후 main merge.
- Blog v1 운영 가능 전까지 자동 발행 / 다계정 / OpenClaw는 우선순위가 아니다.

## 1. Product Management

- [x] Product List
- [x] Product Creation
- [x] Product Detail Page
- [x] Product Edit
- [x] Product Delete
- [x] USP Management
- [x] Target Customer Management
- [x] Customer Problem Management
- [x] Product Notes
- [ ] Product Image / Asset Management — (partial) DB / Storage, 여러 이미지 업로드·목록·미리보기 UI 구현; 삭제·수정·재정렬 등 전체 관리 UI 미완료.
- [ ] Product Asset Categories / Descriptions — (partial) file_name / alt_text 기반만 존재; 카테고리·설명 편집 미완료.
- [ ] Product Knowledge Base — (partial) products 필드 저장·조회 구현; 문서 기반 지식베이스 / RAG 미구현.
- [ ] Cost / Price / Margin Calculator
- [ ] Import Cost / Exchange Rate / Fee Calculation
- [ ] Product MAP Management

---

## 2. AI Blog Content Generator

구현 근거: app/content/blog/, app/api/blog/generate/route.ts, app/api/extension/, lib/blog-generation/, lib/blog-publishing/, extension/, blog_task_assets migration. 상품 사진 관리(product_assets)는 블로그 작업 사진(blog_task_assets)과 별개다.

### Product & Content Input

- [x] Product Selection
- [x] Product Knowledge Retrieval
- [x] Keyword Input
- [x] Topic Input
- [ ] Content Purpose Input — 역사적 purpose 컬럼은 목록에서만 표시하며 현재 생성/편집/prompt 입력에는 사용하지 않음.
- [x] Writing Instructions
- [ ] Brand Rules Integration

### Blog Task Management

- [x] Blog Task Database
- [x] Blog Task Creation
- [x] Task Status Management
- [x] Product-to-Blog Task Mapping
- [x] Blog Task List
- [ ] Blog Task Queue — (partial) task 목록·상태 구현; 생성용 background queue 없음. 발행 큐와 별개.

### AI Draft Generation

- [x] OpenAI API Integration
- [x] Claude / Anthropic API Integration
- [x] Grok / xAI API Integration
- [x] OpenAI / Claude / Grok Provider Selection UI (선택 유지, 결과 provider / model 표시)
- [x] Shared AI Provider Layer (lib/ai/provider.ts)
- [x] Structured Output
- [x] Blog Title Generation
- [x] Introduction Generation
- [x] Section Structure Generation
- [x] Section Body Generation
- [x] Closing Generation
- [ ] Image Placement Suggestions — (partial) imageAssetId는 항상 null; AI 배치 제안 미구현.
- [x] Product Fact Grounding
- [x] Hallucination Prevention Rules
- [x] Fake Review / Experience Prevention
- [x] Exaggerated Claim Prevention

### Prompt Structure & Actual API Verification

- [x] Fixed Instructions (lib/blog-generation/prompts.ts)
- [x] Reference Writing Guide (내부 상수; 세 provider 공통, 고정 규칙 및 task 지시보다 낮은 우선순위)
- [x] Per-task Additional Instructions (instructions: 이번 글 추가 지시)
- [x] Blog Structured Output Schema (lib/blog-generation/schema.ts)
- [ ] CONTENT_STRATEGY Reference Document (docs/CONTENT_STRATEGY.md) — 파일만 존재, 실질 내용 미작성.
- [ ] COPYWRITING_SKILLS Reference Document (docs/COPYWRITING_SKILLS.md) — 파일만 존재, 실질 내용 미작성.
- [x] OpenAI Actual API Generation & Draft Save — task #7, Draft #11, gpt-5-mini-2025-08-07.
- [x] Claude Actual API Generation & Draft Save — task #7, Draft #12, claude-sonnet-5-5.
- [x] Grok Actual API Generation & Draft Save — task #7, Draft #13, grok-4.7.

이전 실테스트에서 응답·저장 Schema, 원문 일치, task generated 확인. 사실성/경험/효능 방지는 프롬프트 규칙 구현이며 허위 생성 완전 차단 보장은 아님. 참고 상수는 요청사항 기반이며 두 Markdown 파일 자동 로딩은 아니다.

### Draft Management

- [x] Blog Draft Database
- [x] Draft Storage
- [x] Draft Detail Page
- [x] Draft Editing
- [x] Draft Regeneration
- [ ] Section Regeneration
- [ ] Draft Version History — (partial) 재생성 시 새 Draft row 저장; 버전 조회·비교·복원 UI 미구현.
- [x] Draft Status Management
- [x] Human Review
- [x] Approved / Rejected Status

### Product Asset Integration

아래는 상품 단위 asset 관리 현황이다. 현재 Blog 입력/발행 준비는 상품 asset 자동 연결 대신 작업별 blog_task_assets를 사용한다.

- [x] Supabase Storage Integration
- [x] Product Asset Database
- [ ] Manual Asset Categories
- [ ] Manual Asset Descriptions
- [x] Product-to-Asset Mapping
- [ ] AI Asset Selection
- [x] Image Placement Guidance — 순수 image layout을 재사용한 번호순 사진 위치 표시.
- [x] Image Preview (제품 상세 UI; Draft별 이미지 선택 UI는 아님)
- [ ] Asset Selection Review

### Naver Blog Publishing Preparation

- [x] Approved Draft Preparation List
- [x] Title / Plain-text Body Copy
- [x] Ordered Photo Insertion Markers
- [x] Individual Photo Preview / Download
- [x] Numbered Image ZIP Download
- [x] Blog Task Photo Upload / Compression / Storage

현재 /prepare는 특정 draftId와 작업 사진을 읽어 수동 복사·검수·fallback 자료를 제공한다. Extension을 직접 실행하는 화면은 아니다. 준비 및 Extension 입력은 DB 발행 status를 변경하지 않으며 기존 queued/publishing/ready_for_review 등은 역사적 값으로 보존한다.

### Naver Chrome Extension Input

- [x] Chrome Extension + CDP + content script 입력 구조
- [x] Side Panel 연결 설정 저장 / 자동 복원 / 자동 연결
- [x] Extension 전용 token 인증
- [x] 특정 draftId 조회 및 Side Panel / background / API 전달
- [x] 전체 사진 blocks 직렬화 — 기존 planBlogImages 배치 및 사진 순서 유지, 임의 3장 제한 없음
- [x] V3 Block 순차 입력 — 앞에서 뒤로 text → image → text 반복, 과거 위치 재탐색 없음
- [x] 서버 temp image 생성 / CDP DOM.setFileInputFiles / cleanup 및 retry
- [x] V3 실제 저장 draft + 사진 10장 Naver SmartEditor 입력 실검증 완료 — 사용자 확인
- [x] text/image 순서 및 마지막 본문 입력 실검증 완료 — 사용자 확인
- [x] "입력 완료 - 네이버에서 직접 확인 후 발행하세요" 안내 확인 — 사용자 확인
- [x] legacy 최대 3장 입력 fallback 유지 — 아직 제거하지 않음
- [ ] 최종 Naver 발행 / 예약 버튼 자동 클릭 — 현재 사용자가 직접 수행, 별도 후속 단계
- [ ] 최종 발행 결과 / URL / 시간 기록 — 별도 후속 단계

V3는 현재 task의 image block 전부를 순서대로 처리하며 사진 수 상한을 별도로 두지 않는다. 실제 운영 검증 범위는 사진 10장이다. native dialog는 차단하고 사진 버튼 클릭 후 file input을 DOM에서 조회해 파일을 지정한다. localhost 서버와 Chrome은 같은 PC에서 실행한다.

과거 Playwright publisher, persistent profile, /api/blog/publish, PublishingStatusControl 및 Naver live test script는 현재 main에서 제거된 상태다. 현재 자동입력은 Extension 방식이며 삭제된 Playwright 코드를 복원하지 않는다. 최종 검수·발행은 사람의 책임이다.

### Blog Input Technical Debt — Priority Order

1. [x] Extension에서 approved draft만 사용하도록 승인 정책 통일 — 목록은 작업별 최신 승인 draft, 상세는 명시 draftId도 승인 검사, 입력 클릭 시 같은 draftId 재조회. 코드/fixture 완료이며 실제 Chrome 재검증은 이번 작업에서 수행하지 않음.
2. [x] Side Panel 작업 선택 race 수정 — 조회 요청 번호 및 taskId/draftId 일치 검사, 오래된 응답/오류 무시, 실행 중 선택 잠금 및 재조회/실행 ID 대조. mock/fixture 완료; 이번 작업에서 Chrome 실테스트는 수행하지 않음.
3. [ ] 이미지 업로드 완료 / 순서 검증 강화 — 현재 component 수 증가 검증을 보완
4. [ ] 실행 snapshot 및 실패 이력 — draft별 사진 snapshot은 현재 없음
5. [ ] 중간 실패 재개
6. [ ] signed URL 갱신 — 현재 생성 시 600초, 자동 갱신 없음
7. [ ] 비정상 종료 후 temp cleanup — 현재 정상 종료 finally / retry 경로만 있음
8. [ ] V3 충분히 안정화 후 legacy 제거 검토 — 10장 성공만으로 즉시 제거하지 않음
9. [ ] 최종 발행 / 예약 및 발행 결과 기록 — 별도 후속 단계

10장 실제 입력 성공은 완료 사실이다. 승인 정책 통일은 코드/fixture에서 완료했다. 나머지 검증 강화, 복구 및 이력 항목은 미완료 기술 부채다. 승인 후 편집 시 approved 유지 문제도 별도 후속 작업으로 남는다.

### Future Intelligence

- [ ] VOC Integration
- [ ] Customer Language Integration
- [ ] Pain Point Integration
- [ ] Purchase Motivation Integration
- [ ] Search Intent Integration
- [ ] Content Performance Feedback Loop
- [ ] Next Blog Topic Recommendation
- [ ] Existing Blog Content Analysis

---

## 3. Knowledge iN (KIN) Answer Generator

Prompt tuning 진행 중. 코드 구현 완료는 실제 답변의 최종 품질 검수나 네이버 등록 완료를 뜻하지 않는다.

### Question & Task Input

- [x] Question Input
- [x] Product Selection (선택 사항)
- [x] Question URL
- [x] Category
- [ ] Purpose — (partial) API / DB는 helpful / product_relevant 지원; UI는 helpful 고정, 선택 UI 없음.
- [x] Product Mention Level (none / relevant / direct)
- [x] Per-question Additional Instructions
- [x] KIN Task Database
- [x] KIN Draft Database
- [x] Recent Task List

### AI Generation & Context

- [x] OpenAI Integration
- [x] Claude / Anthropic Integration
- [x] Grok / xAI Integration
- [x] Provider Selection
- [x] Structured Output (answer / questionIntent / productMentioned; 저장 전 검증)
- [x] Shared AI Provider (lib/ai/provider.ts)
- [x] KIN Provider Wrapper (lib/kin/provider.ts: KIN_PROVIDER_MODELS / ANSWER_SCHEMA 연결)
- [x] KIN Generation Rules & Schema (lib/kin/generate.ts)
- [x] Product Information Retrieval
- [x] Latest VOC Retrieval (선택 제품의 최신 completed 분석 요약)
- [x] Answer Regeneration & Copy
- [ ] Actual Answer Quality Review — 운영 품질 최종 검수 필요; Blog 실호출 검증과 별개.

### Prompt & Presets

- [x] Fixed KIN Instructions
- [x] Common Style Instructions
- [x] Preset Instructions
- [x] Per-question Instructions
- [x] Prompt Preset Database
- [x] Preset UI
- [x] Preset Create / Edit / Delete / Duplicate
- [x] Default Preset (SQL seed·초기 선택; 기본값 변경 UI는 아님)
- [x] Paragraph Count
- [x] Min / Max Characters
- [x] Keywords
- [x] Keyword Repetition Limit
- [x] Banned Phrases
- [x] Preset Product Mention Level
- [x] Preset Snapshot (재생성 시 원래 지침·설정 유지)

### Quality Check

- [x] Length Check
- [x] Banned Phrase Check
- [x] Paragraph Count Check
- [x] Keyword Repetition Check
- [x] Product Mention Check
- [x] Fake Personal Experience Check
- [x] Advertising Tone Check
- [x] Medical / Health Overclaim Check

lib/kin/quality-check.ts의 문구·횟수 기반 heuristic 경고와 결과 UI 구현. 사실 검증 엔진이나 모든 위반 자동 차단은 아님; 사람이 검수한다.

### Naver Knowledge iN Publishing

- [ ] Automatic Login
- [ ] Automatic Answer Submission

구현 근거: app/content/kin/, app/api/kin/generate/route.ts, app/api/kin/presets/, lib/kin/, 202610060002_create_kin_content.sql, 202610060003_create_kin_prompt_presets.sql.

---

## 4. VOC Intelligence

- [x] CSV / XLSX Review Import
- [x] Review Database
- [x] Product-to-Review Mapping
- [x] AI VOC Analysis
- [x] Pain Point Extraction
- [x] Desire Extraction
- [x] Purchase Motivation Analysis
- [x] Customer Language Extraction
- [x] Objection Analysis
- [x] Product Improvement Insights
- [x] FAQ Generation (분석 결과의 faq_candidates: FAQ 후보; 완성 FAQ 답변 생성기는 아님)
- [x] Ad Hook Generation from VOC (분석 결과의 ad_hooks; 별도 광고 제작기는 아님)
- [x] Recurring Keyword Extraction
- [x] VOC Dashboard (app/voc/page.tsx: 리뷰 수·분석 상태·인사이트)
- [x] VOC Analysis UI (제품 상세: 실행·결과·오류 표시)
- [ ] Blog Content Generation from VOC — Blog generate는 VOC를 직접 조회하지 않음.

구현 근거: lib/reviews/import.ts, app/api/products/[id]/reviews/import/route.ts, lib/voc/analyze.ts, app/api/products/[id]/voc/analyze/route.ts, app/products/[id]/UploadReviews.tsx 및 VocAnalysisControl.tsx, 202610060001_create_voc_intelligence.sql. OpenAI chunk 분석·통합 및 9개 카테고리 저장 구현. KIN은 최신 completed VOC를 조회하지만 Blog는 미연결.

---

## 5. Company Knowledge Base

- [ ] Product Documents
- [ ] Supplier Quotes
- [ ] Brand Guidelines
- [ ] Brand Tone Rules
- [ ] Content Writing Rules
- [ ] Historical Ad Creatives
- [ ] Historical Content
- [ ] Sales / Advertising Reports
- [ ] Internal SOP Documents
- [ ] Handover Documents
- [ ] Past Decisions / Project History
- [ ] PDF / XLSX / CSV / Image Import
- [ ] Quote / Contract Data Extraction
- [ ] AI Search across Company Knowledge
- [ ] RAG / Knowledge Retrieval

---

## 6. Product Sourcing

- [ ] Sourcing Candidate Database
- [ ] Supplier Database
- [ ] Supplier Management
- [ ] Supplier Quote Comparison
- [ ] Cost / MOQ / Lead Time Management
- [ ] Competitor Product Analysis
- [ ] Review Analysis
- [ ] Market Opportunity Analysis
- [ ] AI Product Evaluation
- [ ] Supplier Monitoring
- [ ] Product Research Automation

---

## 7. Advertising Intelligence

- [ ] Ad Reference Library
- [ ] Competitor Ad Database
- [ ] Product-to-Ad Mapping
- [ ] Hook Analysis
- [ ] Problem / Desire Analysis
- [ ] Proof Analysis
- [ ] CTA Analysis
- [ ] Ad Structure Analysis
- [ ] Creative Tone Analysis
- [ ] Viral Ad Structure Extraction

---

## 8. Competitor Monitoring

- [ ] Meta Ad Library Monitoring
- [ ] New Competitor Ad Detection
- [ ] Competitor Hook Extraction
- [ ] Copy / CTA Extraction
- [ ] Creative Tone Change Detection
- [ ] Competitor Price Monitoring
- [ ] Promotion Change Detection
- [ ] New Product Detection
- [ ] Market Gap Discovery
- [ ] Keyword Opportunity Discovery
- [ ] Daily Competitor Report
- [ ] Weekly Competitor Report

---

## 9. AI Content Generation

- [ ] Ad Hook Generation
- [ ] Ad Copy Generation
- [ ] Copy Variations
- [ ] Short-form Video Scripts
- [ ] 15 / 30 / 60 Second Scripts
- [ ] Shot List Generation
- [ ] Subtitle Timing
- [ ] CTA Generation
- [ ] Target-specific Script Variations
- [ ] Script Conversion Diagnosis
- [ ] Series Content Planning
- [ ] Seasonal / Trend-based Content
- [ ] Threads Content
- [ ] Instagram Content
- [ ] Blog Content — (partial) Blog 생성기는 구현; 범용 콘텐츠 플랫폼 미완료.
- [ ] Product-based Content Generation — (partial) Blog / KIN 한정 구현; 범용 채널 확장 미완료.
- [ ] Brand Rule Application
- [ ] Content Draft Storage — (partial) Blog / KIN DB 저장 구현; 범용 저장 체계 미완료.
- [ ] Content Approval Workflow — (partial) Blog draft / approved / rejected 구현; 범용 workflow 미완료.

---

## 10. Viral Ad Recreation

- [ ] Viral Ad Reference Import
- [ ] Ad Structure Recreation
- [ ] Product Replacement Workflow
- [ ] Model / Background Replacement
- [ ] Korean Localization
- [ ] Voice / Subtitle Generation
- [ ] Creative Variant Generation
- [ ] A/B Creative Generation
- [ ] Topview Integration
- [ ] Higgsfield / Video Tool Integration

---

## 11. AI Detail Page

- [ ] Detail Page Strategy
- [ ] Section Structure Generation
- [ ] Hero Section
- [ ] Problem Section
- [ ] Solution Section
- [ ] USP Section
- [ ] Benefit Section
- [ ] Proof Section
- [ ] FAQ Section
- [ ] CTA Section
- [ ] Sales Copy Generation
- [ ] Competitor Gap Analysis
- [ ] Brand Tone Application
- [ ] Image Prompt Generation
- [ ] Product Image Generation
- [ ] Figma Integration
- [ ] AI-to-Figma Detail Page Workflow
- [ ] Figma Design Handoff
- [ ] React Template Rendering
- [ ] Detail Page Preview
- [ ] AI-assisted Editing
- [ ] SVG / Motion Components
- [ ] GIF / Motion Banner Workflow

---

## 12. Commerce Intelligence

- [ ] Sales Dashboard
- [ ] Order Analytics
- [ ] Product Profitability
- [ ] Margin Analysis
- [ ] Inventory Management
- [ ] KPI Monitoring
- [ ] Sales Performance Analysis
- [ ] Period-over-Period Comparison
- [ ] Weekly / Monthly Trends

### Integrations

- [ ] Cafe24 API
- [ ] Naver Commerce API
- [ ] Coupang API

---

## 13. Advertising Analytics

- [ ] Meta Ads API Integration
- [ ] Google Ads API Integration
- [ ] Account Analytics
- [ ] Campaign Analytics
- [ ] Ad Set Analytics
- [ ] Ad Analytics
- [ ] Creative Analytics
- [ ] Spend
- [ ] CTR
- [ ] CVR
- [ ] CPA
- [ ] CPR
- [ ] ROAS
- [ ] Period-over-Period Comparison
- [ ] Weekly / Monthly Trends
- [ ] Creative Thumbnail Dashboard
- [ ] Winning Creative Detection
- [ ] Losing Creative Detection
- [ ] AI Action Plan Recommendation
- [ ] New Hook Suggestions
- [ ] New Creative Suggestions

---

## 14. Social Intelligence

- [ ] Threads Content Collection
- [ ] Viral Content Analysis
- [ ] High-performing Hook Analysis
- [ ] Content Structure Analysis
- [ ] Trend Detection
- [ ] Content Generation
- [ ] Automated Social Publishing
- [ ] Content Performance Tracking

---

## 15. Data & File Operations

- [ ] CSV / XLSX Import — (partial) 제품 리뷰 가져오기 한정 구현; 범용 파일 도구 미완료.
- [ ] PDF Data Extraction
- [ ] Spreadsheet Data Extraction
- [ ] Image Data Extraction
- [ ] Structured Data Mapping
- [ ] MAP Automatic Input
- [ ] Automatic File Classification
- [ ] Bulk File Rename
- [ ] Bulk File Conversion
- [ ] Folder Reorganization
- [ ] Product Image Batch Processing
- [ ] Image Resize
- [ ] Image Compression
- [ ] WebP Conversion
- [ ] File Naming Rules

---

## 16. Automation

- [ ] Scheduled Data Collection
- [ ] Cron Jobs
- [ ] Webhooks
- [ ] Background Workflows
- [ ] Sales Data Sync
- [ ] Advertising Data Sync
- [ ] Inventory Sync
- [ ] Review Sync
- [ ] Supplier Monitoring
- [ ] Competitor Monitoring
- [ ] File Processing
- [ ] Inventory Alerts
- [ ] Anomaly Detection
- [ ] Daily Reports
- [ ] Weekly Reports
- [ ] Automated Work Logs
- [ ] Task / Workflow History
- [x] Blog Publishing Preparation List (승인 초안의 수동 발행 자료 준비)
- [ ] Publishing Retry Workflow — Extension은 실패 단계/사진 번호를 표시하나 중간 실패 재개·영속 실행 이력은 미구현.

---

Blog는 수동 발행 준비와 사용자 시작형 Extension 자동입력을 제공한다. Cron / OpenClaw / 자동 스케줄 실행 / 최종 발행·예약 버튼 자동 클릭은 미구현.

## 17. Generative Media

### Image

- [ ] Gemini Image Integration
- [ ] Image Prompt Generation
- [ ] Product Image Generation
- [ ] Ad Creative Generation
- [ ] Detail Page Image Generation
- [ ] Blog Image Generation

### Video

- [ ] Kling Integration
- [ ] Veo Integration
- [ ] Seedance Integration
- [ ] Video Prompt Generation
- [ ] Product Video Generation
- [ ] Ad Video Generation

### Post-processing

- [ ] Magnific / Upscaling Workflow
- [ ] Photoshop Workflow
- [ ] CapCut Workflow

---

## 18. AI Agent Skills

- [ ] Product Analysis
- [ ] Product Knowledge Retrieval
- [ ] VOC Analysis
- [ ] Competitor Research
- [ ] Market Research
- [ ] Supplier Comparison
- [ ] Cost / Margin Calculation
- [ ] Ad Search
- [ ] Ad Analysis
- [ ] Ad Dashboard Generation
- [ ] Ad Performance Analysis
- [ ] Hook Generation
- [ ] Script Generation
- [ ] Content Generation
- [ ] Blog Generation
- [ ] Detail Page Generation
- [ ] Sales Analysis
- [ ] Inventory Analysis
- [ ] Automated Reporting
- [ ] Content Publishing

---

## 19. Autonomous Agent

- [ ] Natural Language Commands
- [ ] Tool Selection
- [ ] Tool Calling
- [ ] Multi-step Workflow Execution
- [ ] Structured Output
- [ ] MCP Server
- [ ] Scheduled Execution
- [ ] Conditional Execution
- [ ] Human Approval for Critical Actions
- [ ] OpenClaw Integration
- [ ] Codex Integration
- [ ] Claude Code Integration

Example:

```text
"경추베개 최근 리뷰와 광고 성과를 분석해서
고객 불만 기준으로 새 Hook 10개 만들고
쇼츠 대본 3개 생성해줘."
```

Agent workflow:

```text
Product Retrieval
→ VOC Retrieval
→ Ad Performance Retrieval
→ Competitor Ad Search
→ Analysis
→ Hook Generation
→ Script Generation
→ Save Results
```

Blog workflow:

```text
Product / Blog Task Retrieval
→ Structured Draft Generation
→ Draft Save / Edit / Human Approval
→ Selected draftId + Ordered Blog Task Assets
→ Clean Body / V3 Blocks / Signed URLs
→ Side Panel / Extension API
→ Chrome CDP + Content Script Sequential Input
→ User Reviews and Publishes in Naver Blog

Fallback: /prepare Copy Text / Download Ordered Photos
Legacy fallback: Full Body Input + Maximum 3 Images
```

앱 승인 workflow와 Extension의 approved-only 목록/상세 검사 및 입력 직전 재조회가 구현되어 있다. VOC / Brand Rule / Product Asset 자동 조회·연결은 현재 Blog 생성/입력 경로에 포함되지 않는다.

---

## 20. Prompt & Skill Management

- [ ] Prompt Template Library
- [ ] Reusable Agent Skills
- [ ] Prompt / Skill Version Management
- [ ] Product-specific Prompts
- [ ] Brand-specific Rules
- [x] Blog Writing Rules (lib/blog-generation/prompts.ts 고정·참고 규칙; 운영 튜닝 진행 중)
- [ ] Content Strategy Rules — (partial) Blog 내부 참고 상수만 구현; 장기 문서·전사 규칙 체계 미완료.
- [ ] Workflow Templates
- [x] Structured Output Schemas (Blog / KIN / VOC)
- [x] Shared GPT / Claude / Grok Provider Layer (lib/ai/provider.ts; Blog / KIN 재사용)
- [x] Structured Output Provider Adapter
- [x] Blog Prompt Separation (Fixed / Reference / Per-task)
- [x] KIN Prompt Separation (Fixed / Style / Preset / Per-question)

---

## 21. Notifications & Approval

- [ ] Slack Notifications
- [ ] Email Notifications
- [ ] Important Change Alerts
- [ ] Human Approval Queue — (partial) Blog 승인 목록만 구현; 전사 승인 큐 미완료.
- [ ] Draft Approval Queue — (partial) Blog 승인·발행 목록 구현; 범용 승인 큐 미완료.
- [ ] Approval before Publishing — (partial) Blog 앱 준비 목록 및 Extension은 approved만 사용. 명시 draftId 승인 검사와 입력 직전 재조회 구현; 승인 후 편집의 재승인 정책 및 전체 채널 승인 체계는 미완료.
- [ ] Approval before Ad Changes
- [ ] Publishing Failure Alerts

---

## 22. External Knowledge Sources

- [ ] Google Drive Integration
- [ ] Local / Shared Folder Integration
- [ ] Company Document Sync
- [ ] Automatic Knowledge Base Update
- [ ] Product Asset Sync
- [ ] Brand Document Sync

---

## 23. Growth & Content Operations

- [ ] Revenue Goal Planning
- [ ] Content Calendar
- [ ] Blog Content Calendar
- [ ] Upload Schedule Planning
- [ ] Content Performance Feedback Loop
- [ ] Next Content Recommendation
- [ ] Keyword-based Content Planning
- [ ] Creative Testing Plan
- [ ] A/B Test Management

---

## 24. System & Access Management

- [ ] User Authentication
- [ ] Internal User Roles
- [ ] Permissions
- [ ] Activity / Audit Logs
- [ ] API Credential Management
- [ ] Agent Execution History
- [ ] Automation Execution History
- [ ] Publishing History — 과거 DB 발행 상태/오류는 보존하지만 Extension 입력 완료·실패 및 실제 최종 발행을 기록하지 않음. 실행/실패/발행 결과 이력 미구현.

---

## 25. Long-term Goal

ANGEL AGENT evolves from an internal commerce tool into a company-specific AI operating system that can:

- Understand company data
- Retrieve internal knowledge
- Understand products and product assets
- Analyze customers and competitors
- Generate marketing assets
- Generate structured content drafts
- Manage human approval workflows
- Publish approved content
- Monitor commerce operations
- Execute repetitive workflows
- Select and call tools autonomously
- Recommend next actions based on real business performance
