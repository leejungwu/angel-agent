# Architecture

Angel Agent의 현재 실행 구조와 기능 변경 위치를 설명한다. 기능 계획은 [ROADMAP](ROADMAP.md),
설치와 프로젝트 소개는 [루트 README](../README.md), Extension 사용 상세는 [Extension 안내](../extension/README.md)를 참고한다.

## 전체 시스템 지도

```text
사용자
  ↓
Next.js UI (app/)
  ├─ 일부 client UI → Supabase 직접 조회/저장
  ↓
API Routes (app/api/)
  ↓
lib business logic
  ├─ Supabase DB / Storage
  ├─ AI Provider → AI 응답 → 검증 / 저장
  └─ Blog Publishing → 본문 / 사진 / 실행 Blocks
                         ↑ Extension API로 조회
사용자 → Chrome Extension Side Panel
           ↓ background ↔ content script
           ↓ Chrome/CDP    ↓ Naver DOM 탐색·selection·검증
           └──────────→ 현재 열린 Naver SmartEditor
                         ↓
                    사용자 최종 검수 / 발행
```

Extension은 웹 앱이 새 Chrome을 띄우는 방식이 아니라, 사용자가 열고 로그인한 Naver 탭에서 실행한다.
앱 API에서 실행 자료를 가져온 뒤 Chrome debugger/CDP로 입력하며, content script가 DOM 위치와 결과를 확인한다.
작업 생성, draft 편집/승인, 사진 업로드 등은 UI가 Supabase를 직접 호출하므로 모든 기능이 API를 거치는 것은 아니다.

## 주요 폴더와 큰 모듈

| 위치 | 무엇을 담당하는가 | 시작점 |
|---|---|---|
| `app/` | Next.js 화면. server page는 조회/렌더링, client component는 사용자 이벤트를 처리 | `app/layout.tsx`, `app/content/blog/[id]/page.tsx` |
| `app/api/` | HTTP 요청 검사, lib 호출, 외부 서비스/DB 처리, 결과 반환 | `app/api/blog/generate/route.ts` |
| `lib/` | prompt/schema, AI transport, 사진 배치·블록 변환, 리뷰/VOC/KIN 업무 규칙 | `lib/blog-generation/`, `lib/blog-publishing/`, `lib/ai/provider.ts` |
| `extension/` | 앱과 별도로 빌드되는 Chrome MV3 Side Panel/service worker/content script | `manifest.json`, `sidepanel/index.ts`, `background.ts`, `content.ts` |
| `supabase/migrations/` | 테이블·정책·Storage bucket 등 SQL 변경 기록. 전체 DB의 완전한 schema dump는 아님 | Blog 사진, VOC, KIN 관련 migration |
| `scripts/` | 회귀 검사와 Extension 빌드. 사용자 요청 처리 경로와 분리 | `build-extension.mjs`, `test-blog-body.ts`, `test-extension-api.mjs` |
| `docs/` | 전체 기능 지도, 시스템 설명, 기능별 상세 안내 | `ROADMAP.md`, `ARCHITECTURE.md`, `AI_GENERATION.md` |

실제 주요 모듈은 Product, 리뷰/VOC, Blog, KIN이다. `app/layout.tsx`의 Sourcing/Ads/Sales/Settings 표시는
현재 기능 페이지 연결과 구분한다. 루트 Dashboard도 매출 분석 화면이 아니다.
`.next/`, `node_modules/`, `extension/dist/`는 생성물이며 기능 수정은 원본 코드에서 한다.

## Blog 생성 흐름

```text
Task + 선택적 Generation Settings → generate API → Settings 검증·기본값
     → settings-prompts / prompts / schema / models → 공통 provider → AI
     → 응답 JSON 검사 → blog_drafts 저장 → Task 상태 갱신 → 편집 → 승인
```

| 단계 | 핵심 코드 | 입력 / 결과 |
|---|---|---|
| Task 생성·수정 | `app/content/blog/new/page.tsx`, `[id]/EditBlogTask.tsx` | 제품과 keyword/topic/instructions 저장 |
| 요청 UI | `[id]/GenerateBlogDraft.tsx` | taskId/provider/model을 `/api/blog/generate`에 전송 |
| 생성·저장 | `app/api/blog/generate/route.ts` | Task·제품 조회, AI 호출, 결과 검증, draft 저장, Task를 generated로 갱신 |
| 작성 규칙 | `lib/blog-generation/prompts.ts` | 고정 규칙 / 참고 글쓰기 가이드 / 작업별 지시 / 제품 사실 분리 |
| 생성 설정 | `lib/blog-generation/settings.ts` | template/tone/분량/section 수/keyword/제품 노출/CTA/추가 지시의 stable key·표시명·검증·기본값 |
| 설정 변환 | `lib/blog-generation/settings-prompts.ts` | template skeleton과 설정을 사용자 계층의 안내문으로 변환. 고정 사실성 규칙·출력 schema보다 우선하지 않음 |
| 출력 계약 | `lib/blog-generation/schema.ts` | title/intro/sections/closing과 section imageAssetId=null |
| 모델·분량 | `models.ts`, `body.ts` (같은 폴더) | 모델 허용 목록·기본값, 제목/줄바꿈 제외 본문 분량 안내 |
| AI 호출 | `lib/ai/provider.ts` | OpenAI Responses / Anthropic Messages / xAI Chat Completions → outputText/provider/model |
| 편집·승인 | `[id]/GenerateBlogDraft.tsx` | 기존 draft 수정, draft/approved/rejected 상태 저장 |

현재 purpose는 목록에서만 읽는 역사적 필드이며 생성 prompt 입력은 keyword/topic/instructions다.
참고 Markdown 문서가 자동으로 prompt에 로딩되지는 않고 `prompts.ts`의 상수가 사용된다.
재생성은 새 draft를 저장한다. draft 저장과 Task 상태 변경은 별도 DB 요청이다.
generate API의 선택적 `settings`는 요청에만 적용되며 DB에 저장하지 않는다. 미전달/부분 전달은 기본값으로 보완한다.
기본 분량은 기존 1,500자(1,200~1,800자 안내)를 유지하고, template은 informational, tone은 natural, 목표 section은 3개다.
기존 Task 명시적 지시는 고정 규칙 범위 안에서 설정보다 우선한다. mainKeyword가 없으면 keywordUsage는 강제하지 않는다.
template/section/keyword 수는 생성 목표이며 결과의 의미적 준수를 강제 검사하는 schema 확장은 아니다.
현재 승인된 draft를 편집해도 자동으로 승인이 해제되지는 않는다.

## Blog 이미지 흐름

```text
사진 선택 → 기본 축소/압축 후보 → Storage + blog_task_assets
         → sort_order / id 정렬
         → image-layout → preparation → blocks
```

- `app/content/blog/[id]/BlogTaskAssets.tsx`: 파일 선택, Storage 업로드, Task 사진 metadata 저장·전체 삭제.
- `lib/blog-task-assets/compact.ts`, `lib/blog-task-assets.ts`: 크기 계산·WebP 압축 후보와 경로/형식 규칙.
- `lib/blog-publishing/downloads.ts`: Task 경로 검사·순서 정리·번호 파일명·수동 ZIP.
- `lib/blog-publishing/image-layout.ts`: prose가 부족하면 문단을 나누고 사진을 넣을 경계를 계획한다.
  배치 규칙은 `chooseImagePositions()`, 정책 설정은 `IMAGE_PLACEMENT_RULE`에 모인다.
- `lib/blog-publishing/preparation.ts`: 계획된 문단으로 실행 본문과 사진 insertOffset을 만든다.
  수동 화면용 text/image 표시 및 `[사진 01 삽입]` 마커 본문도 별도로 만든다.
- `lib/blog-publishing/blocks.ts`: 이미 정해진 offset으로 본문을 잘라 사진 metadata와 번갈아 배열한다.
  여기서 사진 위치를 다시 계산하지 않는다.

예를 들어 실행 본문이 `AAA\n\nBBB`이고 사진 offset이 3이면 다음처럼 된다.

```text
text("AAA") → image(index=0, signedUrl=...) → text("\n\nBBB")
```

모든 text block을 이어 붙이면 실행 bodyText와 같아야 한다. 같은 위치에 사진 여러 장이 배정되면 image block이 연속된다.
Extension에는 마커 없는 본문과 실제 image blocks가 전달되고, 마커 문자열은 수동 준비 화면에 사용된다.
사진 등록은 글 생성 전에도 가능하다.

## Blog 발행 흐름

```text
approved draft + 현재 Task 사진
  → extension-api (본문 / 정렬 사진 / signed URL / Blocks)
  → Side Panel 작업 선택·같은 draftId 재조회
  → background: 현재 Naver tab/frame 확정·debugger attach
  → 제목 입력·검증 → text/image Blocks 순차 실행
  ↔ content: DOM 위치/문서 끝 selection/본문·이미지 검증
  → 임시 파일 정리·debugger detach
  → Naver SmartEditor에서 사용자가 검수·최종 발행
```

`app/api/extension/blog-tasks/route.ts`는 작업별 최신 승인 draft 목록을 반환한다.
상세 `/api/extension/blog-tasks/[id]?draftId=...`는 `lib/blog-publishing/extension-api.ts`에서
Task와 명시 draftId의 연결·approved 상태를 검사하고, 현재 Task 사진과 실행 자료를 만든다.
Side Panel은 입력 직전 동일 draftId를 다시 조회하고 선택 변경/오래된 응답을 차단한다.

기본 V3는 text block을 CDP `Input.insertText`, image block을 `DOM.setFileInputFiles`로 처리한다.
현재 끝 위치에서 앞에서 뒤로 입력하고 문단·사진 사이 위치는 content script가 준비/검증한다.
최대 3장 legacy 경로는 전체 본문을 먼저 넣고 과거 offset을 찾아 사진을 넣는 별도 fallback이다.

이미지는 `/api/extension/temp-image → lib/blog-publishing/temp-image.ts`가 signed URL로 내려받아
서버 임시 파일로 준비한다. Chrome이 그 absolutePath를 읽으므로 현재 사진 입력은 앱 서버와 Chrome이
같은 머신에서 실행되는 환경이 기준이다. 임시 파일 cleanup과 debugger detach는 종료 정리 경로에 있다.

`/content/blog/[id]/prepare`는 본문 복사·사진 다운로드/ZIP의 수동 fallback이며 Extension 실행 화면이 아니다.
`/content/blog/publishing`은 승인 자료 목록이지 실제 실행 Queue가 아니다.
Extension 입력 성공은 DB를 published로 바꾸거나 Naver 최종 발행 버튼을 클릭하지 않는다.

## Extension의 역할 구분

| 구성 | 책임 | 경계 |
|---|---|---|
| `extension/sidepanel/index.ts` + HTML/CSS | 사용자 조작, 앱 연결 설정, 승인 Task/draft 선택, 진단 표시, 실행 확인 | CDP/DB를 직접 처리하지 않음 |
| `extension/background.ts` | 앱 API 통신, active tab/frame 선택, CDP mouse/key/text/file 입력, 실행 stage·정리 | 글 작성 규칙·사진 배치 계산을 중복 구현하지 않음 |
| `extension/content.ts` | Naver DOM 탐색, iframe 좌표, 현재 tail Range/Selection, 텍스트·사진 위치/count 검증 | AI 호출/파일 다운로드/CDP 전송 대신 DOM 측 실행 보조 |
| `extension/types.d.ts` | Task/Block/message/reply/diagnostic/Chrome API 타입 계약 | runtime 실행 및 검증 자체는 아님 |
| `extension/manifest.json` | MV3 권한, service worker, side panel, Naver all_frames content scripts | 새 Chrome/profile이나 자동 로그인 기능 없음 |

ready 기준은 올바른 글쓰기 frame과 제목·본문의 발견 여부다. contenteditable 여부를 입력 필수 조건으로 삼지 않는다.
본문을 DOM에 직접 대입하지 않으며 실제 입력은 background의 CDP가 한다.
앱 주소·연결 토큰은 Chrome local storage에 보관하고 trusted extension context로 접근을 제한한다.
Extension API는 `ANGEL_EXTENSION_TOKEN` Bearer 인증을 사용한다.

## 데이터 모델

```text
products
├─ product_assets → Storage: product-assets
├─ blog_tasks
│  ├─ blog_drafts
│  └─ blog_task_assets → Storage: blog-task-assets
├─ reviews ← review_import_batches
├─ voc_analysis_runs
└─ kin_tasks (preset 지시·설정 snapshot) → kin_drafts

kin_prompt_presets → 새 KIN Task 생성 시 snapshot으로 복사
```

그림은 코드의 조회/연결 관계이며 모든 실제 DB constraint를 표현한 ERD는 아니다.

| 데이터 | 역할 |
|---|---|
| `products` / `product_assets` | 상품 사실과 제품 사진. Blog Task 사진과 별개 |
| `blog_tasks` | 제품에 연결된 생성 조건. 같은 Task에서 여러 draft 생성 가능 |
| `blog_drafts` | 제목·intro·sections·closing·검수 상태·model. Extension은 approved만 사용 |
| `blog_task_assets` | Task 사진 경로·파일명·sort_order. 실제 bytes는 Storage에 저장 |
| `reviews` / `review_import_batches` | 제품 리뷰와 가져오기 결과/상태 |
| `voc_analysis_runs` | 제품별 VOC 결과·분석 상태·오류·모델 |
| `kin_tasks` / `kin_drafts` | 질문·제품·언급 수준·추가 지시 및 생성 답변. Task에 preset 지시/설정 snapshot 저장 |
| `kin_prompt_presets` | 지식인 작성 지시와 문단·분량·키워드·금칙어 설정 |

Blog에는 **draft별 image snapshot이 아직 없다.** 특정 draftId를 고정해도 사진은 현재 Task의 목록을 읽는다.
AI section의 imageAssetId=null과 실제 Task 사진 배치도 구분한다.
검수 status와 역사적 publishing_status는 별개이며 Extension은 현재 발행 상태를 DB에 기록하지 않는다.
기존 migrations는 일부 테이블·정책 변경 기록이므로 실제 DB 전체 schema를 대체하지 않는다.

## Product / VOC / KIN 흐름

### Product

`app/products/`의 등록·편집·삭제 UI → `lib/supabase.ts` → products.
제품 상세 `UploadProductAssets.tsx` → product-assets Storage + product_assets.
상품 사실은 Blog와 KIN 생성 API가 읽고, 리뷰/VOC는 같은 제품 ID로 연결된다.

### 리뷰 / VOC

`app/products/[id]/UploadReviews.tsx → /api/products/[id]/reviews/import → lib/reviews/import.ts`
→ CSV/XLSX 파싱·리뷰 저장·import 결과 기록.

`VocAnalysisControl.tsx → /api/products/[id]/voc/analyze → lib/voc/analyze.ts → OpenAI`
→ pain point/고객 표현/구매 동기/반론/개선점/FAQ·hook 후보 등 저장 → 제품 상세와 `app/voc/page.tsx`에 표시.
VOC는 자체 OpenAI 호출을 사용한다. 현재 Blog generate는 VOC를 직접 읽지 않는다.

### KIN

`app/content/kin/KinAnswerForm.tsx → /api/kin/generate`
→ 질문·preset snapshot·선택 제품·최신 완료 VOC → `lib/kin/provider.ts → lib/ai/provider.ts`
→ 구조화 답변 → `lib/kin/quality-check.ts` 경고 → kin_drafts/Task 상태 저장·결과 UI.

`KinPresetControl.tsx → /api/kin/presets/ → lib/kin/presets.ts`는 preset 관리/설정 검증 경로다.
KIN의 schema·고정/스타일 지시는 `lib/kin/generate.ts`에 있으며, 품질 경고는 사람이 검수한다.
현재 네이버 지식인 답변의 최종 자동 등록 경로는 없다. 매출·주문·재고 분석도 현재 실행 모듈이 아니다.

## 어디를 수정해야 하나

| 변경할 것 | 먼저 볼 파일 |
|---|---|
| 글쓰기 규칙·문체 | `lib/blog-generation/prompts.ts` |
| 생성 설정 모델·범위·기본값 / template·tone 안내 | `lib/blog-generation/settings.ts`, `settings-prompts.ts` |
| AI 응답 구조 | `lib/blog-generation/schema.ts` |
| AI provider transport | `lib/ai/provider.ts` (Blog/KIN 공통) |
| Blog 모델·분량 | `lib/blog-generation/models.ts`, `body.ts` |
| Blog 생성·저장 | `app/api/blog/generate/route.ts` |
| Task 조건·draft 편집/승인 | `app/content/blog/new/page.tsx`, `[id]/EditBlogTask.tsx`, `[id]/GenerateBlogDraft.tsx` |
| 사진 위치 정책 | `lib/blog-publishing/image-layout.ts` |
| 본문 조립·사진 offset·수동 마커 | `lib/blog-publishing/preparation.ts` |
| 실행 Block 계약 | `lib/blog-publishing/blocks.ts` |
| Extension 데이터·승인 draft 선택 | `lib/blog-publishing/extension-api.ts`, `app/api/extension/blog-tasks/` |
| Side Panel·선택 상태 | `extension/sidepanel/` |
| Naver 실제 입력·DOM 검증 | `extension/background.ts`, `extension/content.ts` |
| Task 사진 업로드·전체 삭제·압축 | `[id]/BlogTaskAssets.tsx`, `lib/blog-task-assets/` |
| 서버 임시 사진 | `lib/blog-publishing/temp-image.ts`, `app/api/extension/temp-image/` |
| 수동 발행 준비·ZIP | `[id]/prepare/PreparationPanel.tsx`, `lib/blog-publishing/downloads.ts` |
| 제품 UI·사진 | `app/products/`, `[id]/UploadProductAssets.tsx` |
| 리뷰 import | `lib/reviews/import.ts`, `app/api/products/[id]/reviews/import/route.ts` |
| VOC 분석·결과 화면 | `lib/voc/analyze.ts`, 관련 analyze route, `app/voc/page.tsx` |
| KIN 규칙·preset·품질 | `lib/kin/`, `app/api/kin/`, `app/content/kin/` |
| DB 연결·권한 | `lib/supabase.ts`, `supabase/migrations/` |
| 메뉴·공통 화면 | `app/layout.tsx`, `app/globals.css` |
| Extension 빌드·권한 | `scripts/build-extension.mjs`, `extension/manifest.json` |

표의 `[id]/...`는 해당 기능의 동적 상세 화면 경로다. Blog 항목은 `app/content/blog/[id]/`,
Product 항목은 `app/products/[id]/`를 기준으로 읽는다.
