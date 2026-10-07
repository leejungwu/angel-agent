# ANGEL AGENT Roadmap

## Current Focus

기준: 2026-10-08, feat/kin-prompt-tuning (최신 main 병합 완료). [x]는 명시한 범위의 코드 구현을 뜻하며 운영 품질 보장을 뜻하지 않는다. (partial)은 미완료로 유지한다. 실테스트 표시는 이전 실제 테스트 기록이며 이번 문서 작업에서 API를 재호출하지 않았다.

- Blog v1: 실제 윗잠베개 Product 정보 입력, prompt 강하게 튜닝, CONTENT_STRATEGY / COPYWRITING 자료 정리, 실제 사진 asset 확보.
- Blog v1: 글 1개 + 사진 2장 inline insertion 최종 검증, 실제 블로그 1개 semi-auto 발행. 최종 발행 / 예약 발행 버튼은 사람이 직접 처리.
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

구현 근거: app/products/, app/content/blog/, app/api/blog/generate/route.ts, lib/blog-generation/, lib/naver-blog/, app/api/blog/publish/, product_assets migrations.

### Product & Content Input

- [x] Product Selection
- [x] Product Knowledge Retrieval
- [x] Keyword Input
- [x] Topic Input
- [x] Content Purpose Input
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

- [x] Supabase Storage Integration
- [x] Product Asset Database
- [ ] Manual Asset Categories
- [ ] Manual Asset Descriptions
- [x] Product-to-Asset Mapping
- [ ] AI Asset Selection
- [ ] Section-to-Image Mapping — (partial) 정렬된 사진을 section 순서로 매칭하는 publisher 코드 구현; 사용자 선택 / AI 매핑 없음.
- [x] Image Preview (제품 상세 UI; Draft별 이미지 선택 UI는 아님)
- [ ] Asset Selection Review

### Naver Blog Publishing

- [x] Publishing Queue
- [x] Approved Draft Filtering
- [x] Naver Blog Editor Research
- [x] Playwright Integration
- [x] Automatic Editor Input
- [x] Image Upload
- [ ] Image Placement — (partial) section body 뒤 inline insertion 및 본문·DOM 순서 검증 코드 구현; 실제 글 1개 + 사진 2장 E2E 최종 검증 미완료.
- [ ] Category Selection
- [ ] Tag Input
- [ ] Draft Save — (partial) 앱 Draft DB 저장 구현; Naver 임시저장 자동화 미구현.
- [x] Semi-automatic Publishing (입력 후 ready_for_review 정지; 최종 발행 클릭·로그인 자동화 없음)
- [ ] Automatic Publishing
- [ ] Scheduled Publishing — Naver UI에서 사람이 직접 예약; 앱의 자동 예약 실행 미구현.
- [x] Publishing Failure Detection
- [ ] Published URL Storage — (partial) result API에 저장 분기 존재; ready_for_review 이후 발행 확인·URL 저장 연결 미완료.
- [ ] Publishing Result History — (partial) Draft별 현재 상태·오류 저장만 존재; 별도 실행 이력 없음.

approved → queued → publishing → ready_for_review 상태 흐름 구현. 이미지 수 검증, Naver 실제 업로드 완료 대기, 작성 중인 글 모달 취소, 실패 오류 저장, 다운로드 임시파일 finally 정리 구현. 자산 순서는 sort_order ASC → id ASC. result API는 publishing 상태만 받아 현재 종료 상태와 발행 결과 기록 연결이 남아 있다.

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
- [x] Content Publishing Queue (Blog DB 상태 기반 수동 실행 큐; scheduler / worker 아님)
- [ ] Publishing Retry Workflow — (partial) 실패 후 수동 재등록·실행 가능; 자동 재시도 workflow 없음.

---

자동화는 Blog 큐 범위에 한정된다. Cron / OpenClaw / 자동 스케줄 실행 / 완전 자동 발행 미구현.

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
Product Retrieval
→ Product Asset Retrieval
→ VOC Retrieval
→ Brand Rule Retrieval
→ Blog Task Analysis
→ Structured Draft Generation
→ Draft Save
→ Human Approval
→ Publishing Queue
→ Playwright / OpenClaw
→ Naver Blog
→ Save Published URL
```

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
- [ ] Approval before Publishing — (partial) Blog approved 검사 구현; 전체 채널 승인 체계 미완료.
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
- [ ] Publishing History — (partial) Draft별 현재 상태·오류만 존재; 감사/실행 이력 미구현.

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