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
Task + selected Preset + Product
  → prompt assembly → 공통 provider → 응답 JSON 검증
  → Draft + generation snapshot 저장 → Task 상태 갱신 → 편집 → 승인
```

| 단계 | 핵심 코드 | 입력 / 결과 |
|---|---|---|
| Task 생성·수정 | `app/content/blog/new/page.tsx`, `[id]/EditBlogTask.tsx` | 제품과 keyword/topic/instructions 저장 |
| 프리셋 UI | `[id]/BlogPresetControl.tsx` | 프리셋 선택·생성·편집·복제·삭제. 편집 시 4개 prompt와 분량·소제목·키워드 범위를 표시 |
| 프리셋 관리 | `app/api/blog/presets/`, `lib/blog-generation/presets.ts` | KIN과 같은 CRUD 패턴, 입력 검증, updated_at 갱신 |
| 생성 요청 | `[id]/GenerateBlogDraft.tsx` | taskId/presetId/provider/model만 전송. 제품이나 prompt는 클라이언트에서 받지 않음 |
| 생성·저장 | `app/api/blog/generate/route.ts` | Task·제품·프리셋 조회, 선택 저장, AI 호출, draft·snapshot 저장, Task를 generated로 갱신 |
| Prompt 조립 | `lib/blog-generation/prompts.ts` | system_prompt 원문과 preset 설정/Product/Task JSON만 전달. 숨은 자연어 안내를 덧붙이지 않음 |
| 생성 기록 | `lib/blog-generation/snapshot.ts`, `[id]/BlogGenerationDetails.tsx` | 생성 당시 prompt 4개·숫자 설정·Task·제품·provider·요청/응답 model의 독립 복사 및 이력 표시 |
| 출력 계약 | `lib/blog-generation/schema.ts` | title/intro/sections/closing과 section imageAssetId=null. 모든 필수 문자열은 trim 후 비어 있으면 실패 |
| 모델·분량 | `models.ts`, `body.ts` | 모델 허용 목록·기본값, 프리셋 min/max를 그대로 사용한 본문 분량 판정 |
| AI 호출 | `lib/ai/provider.ts` | OpenAI Responses / Anthropic Messages / xAI Chat Completions → outputText/provider/model |
| 편집·승인 | `[id]/GenerateBlogDraft.tsx` | 기존 draft 수정, draft/approved/rejected 상태 저장 |

presetId를 생략하면 Task의 preset_id, 그다음 is_default 프리셋을 사용한다. 기본 프리셋도 없으면
409로 중단하고 사용자가 프리셋을 선택·생성하도록 안내한다. 지정한 프리셋이 없으면 400이다.
선택한 프리셋은 AI 호출 전에 Task에 저장하며, 프리셋 관리와 초안 생성은 별도 동작이다.

`blog_prompt_presets`에는 후기형·정보형·비교형·문제 해결형·제품 소개형 초기 데이터가 있다.
기존 공통 규칙·전략·카피라이팅·natural tone·각 template·medium 제품 노출·CTA none 원문을 옮긴 값이다.
정보형만 기본값이다. 이후 글쓰기 규칙은 DB 프리셋에서 편집하며 Markdown이나 코드 상수를 추가 로딩하지 않는다.
키워드는 Task의 keyword, 이번 글 지시는 Task의 instructions 한 곳만 사용한다. 역사적 purpose는 생성에 사용하지 않는다.

새 생성에는 `202610150001_create_blog_prompt_presets.sql` 적용이 필요하다. migration은 자동 실행하지 않는다.
기존 `blog_tasks.generation_settings` 컬럼과 값은 호환성·롤백을 위해 보존하지만 앱에서는 읽거나 쓰지 않는다.
구형 Settings UI와 전용 API는 제거했다. 롤백 시 코드를 이전 버전으로 되돌리고 새 테이블/컬럼은 보존한다.
기존 행을 재작성하거나 컬럼을 DROP하지 않는다.

새 draft의 generation_snapshot은 생성 당시 값을 저장하며 이후 프리셋 수정·삭제나 draft 내용 편집으로 갱신하지 않는다.
Draft 편집 저장은 내용과 status=draft를 한 번에 UPDATE한다. draft 상태는 유지하고 approved/rejected는 재검수 대상으로 되돌린다.
승인·반려된 Draft의 편집 폼에 재승인 안내를 표시한다. provider/model/created_at과 generation_snapshot은 변경하지 않는다.
기존 Publication Job의 snapshot·상태·연결은 그대로 유지하며, 재승인 전 수정 Draft의 Queue 등록은 거부한다.
이것은 사진·Naver 실행 snapshot과 다르며 사진 목록을 고정하지 않는다. provider와 실제 응답 model도 draft에 저장한다.
Task 상세는 같은 blog_task_id의 draft를 최신순으로 조회한다. 과거 draft를 선택하면 해당 snapshot의 이름·모델·분량·
소제목/키워드 수와 read-only prompt를 보여준다. snapshot 없는 기존 행은 “기존 생성본 · 생성 설정 기록 없음”으로 표시한다.
재생성은 현재 선택한 프리셋과 현재 Task/Product로 새 draft를 추가하며 과거 기록을 바꾸지 않는다.

본문 분량은 제목·줄바꿈·필드 앞뒤 공백을 제외하고 내부 공백을 포함한 Unicode 문자 수다.
프리셋 min/max를 그대로 판정하며 숨은 비율 계산은 없다. 범위를 벗어나도 초안은 저장하고 경고한다.
소제목·키워드 수는 생성 목표이며 의미적 준수를 강제하는 schema 변경은 없다.
Draft 저장과 Task 상태 변경은 별도 DB 요청이다. Draft 편집 저장은 승인·반려를 무효화하고 draft 상태로 되돌린다. 기존 Publication Job snapshot은 유지한다.

## Blog 이미지 흐름

```text
사진 선택 → 기본 축소/압축 후보 → Storage + blog_task_assets
         → sort_order / id 정렬
         → image-layout → preparation → blocks
```

- `app/content/blog/[id]/BlogTaskAssets.tsx`: 파일 선택, Storage 업로드, Task 사진 미리보기·개별/전체 삭제·위/아래 이동·Product 사진 선택.
- `/api/blog/tasks/[id]/assets/[assetId]`는 기존 Job 참조 검사와 Storage 백업·복구 절차를 재사용한다.
  참조가 있어도 Task asset row는 제거하며, 참조된 Storage 파일은 의도적으로 보존한다.
  참조가 없는 파일만 백업 후 삭제하고 DB 삭제 실패 시 복구한다. 전체 삭제도 같은 정책이다.
  기존 정렬 RPC로 대상을 마지막에 배치한 후 row를 삭제하여 나머지 순서를 0..N-1로 유지한다.
  삭제 실패 시 이전 상대 순서로 복원한다. 참조 사진을 거부하는 과거 삭제 RPC는 이 경로에서 사용하지 않는다.
  API는 제거 수와 보존 파일 수를 반환하며 UI는 보존 안내와 요청 실패 메시지를 표시한다.
- `/api/blog/tasks/[id]/assets/order`는 전체 asset ID 순서를 검증한 뒤 RPC로 0..N-1을 한 번에 저장한다.
  정렬 기준은 계속 sort_order ASC / id ASC이며 기존 Job은 재계산하지 않는다.
  위/아래 이동은 클라이언트 목록에 즉시 반영한다. 저장은 한 번에 한 요청만 보내며 연속 클릭은 최신 순서로 합친다.
  실패하면 마지막 저장 확인 순서로 되돌리고 오류를 표시한다. 순서 저장 성공은 refresh하지 않으며,
  저장 중에는 삭제·업로드·Product 추가만 잠시 막는다. 목록이 바뀌는 동작의 기존 refresh는 유지한다.
- `/api/blog/tasks/[id]/assets/product`는 연결된 Product 사진만 조회·선택하며 product-assets에서 blog-task-assets로 독립 복사한다.
  `lib/blog-task-assets/manage.ts`가 복사와 metadata 저장을 담당한다. nullable `source_product_asset_id`와
  Task별 unique index로 같은 원본의 중복 추가를 막고, Product 삭제와 관계없이 복사본을 유지한다.
  Blog 사진 삭제는 Product 원본을 삭제하지 않는다. Product 선택 순서 대신 기존 Product sort_order / id 순서로 뒤에 추가한다.
  복사 후 DB 저장 실패 시 미참조 복사본만 정리하며, 저장 여부를 확인할 수 없으면 파일을 보존하고 오류를 표시한다.
- `lib/blog-task-assets/compact.ts`, `lib/blog-task-assets.ts`: 크기 계산·WebP 압축 후보와 경로/형식 규칙.
- `BlogImageEditor.tsx`는 같은 Task 화면 안의 편집 패널이다. 원본에서 crop을 선택하고, 잘린 결과에서 사각 Blur 영역을 지정한다.
  crop 좌표는 원본 크기의 비율, Blur 좌표는 crop 결과 크기의 비율이다. Crop 변경 시 기존 Blur 영역을 초기화한다.
  `lib/blog-task-assets/edit.ts`의 한 Canvas 렌더러가 crop·기본 resize·밝기·대비·채도·색온도·선명도·Blur·테두리·워터마크 순서로 결과를 만든다.
  기존 v1 결과를 보존하기 위해 보정 전 최대 1800px 크기를 먼저 확정한다. 새 필드가 없는 metadata는 대비/채도 100,
  색온도/선명도 0, 필터 none, 테두리 끄기로 해석하며 neutral filter를 추가 적용하지 않는다.
  색온도는 R/B 채널을 반대 방향으로 조정하고, 선명도는 강도를 제한한 5점 convolution을 사용한다.
  필터 6종은 보정값만 설정하며 이후 수동 조정을 허용한다. 별도의 숨은 필터 효과는 없다.
  테두리는 캔버스 안쪽에 그려 크기를 바꾸지 않는다. 미리보기는 최대 900px이며 Blur/테두리/워터마크 크기도 비례 축소한다.
  파일 용량은 마지막 조작 450ms 뒤 최종 해상도 WebP Blob으로 계산한다. 오래된 계산 결과는 버리고 저장 시 동일 설정 Blob을 재사용한다.
  슬라이더 조작은 Storage/DB 요청을 하지 않는다. 결과 영역은 실제 저장 크기·WebP·예상 KB를 표시한다.
  긴 변 최대 1800px·WebP 품질 0.82를 직접 업로드 압축과 공유한다. 재편집은 항상 Task 원본에서 시작해 반복 압축을 피한다.
- `/api/blog/tasks/[id]/assets/[assetId]/edit`는 원본 URL 조회, 새 편집본 저장, 원본 복원을 담당한다.
  `edit-server.ts`는 현재 경로 조건부 UPDATE로 동시 편집을 거부하며 asset ID·순서·Product 출처를 바꾸지 않는다.
  nullable `original_storage_path`가 없으면 현재 경로가 원본이다. 첫 편집부터 원본 경로를 보존하고 `edit_metadata`를 저장한다.
  원본 복원은 현재 경로를 원본으로 바꾸고 metadata만 null로 지운다. Storage overwrite는 사용하지 않는다.
  원본과 이전 편집본은 기존 Job을 위해 보존하며, 별도의 버전 목록·자동 정리 시스템은 만들지 않는다.
  `/prepare`와 새 Job은 현재 storage_path를 사용하고, 기존 Job·Extension은 고정 snapshot 경로를 계속 사용한다.
- `lib/blog-publishing/downloads.ts`: Task 경로 검사·순서 정리·번호 파일명·수동 ZIP.
- `lib/blog-publishing/image-layout.ts`: prose가 부족하면 문단을 나누고 사진을 넣을 경계를 계획한다.
  기존 even 선택식은 `chooseImagePositions()`에서 유지한다.
- `blog_tasks.image_placement_settings`는 nullable JSONB다. Task 사진 영역에서 도입 뒤 첫 사진 고정,
  마무리 앞 마지막 사진 고정, 문단 자동 분할을 저장한다. 기본값은 각각 false / false / true다.
  `image-placement-settings.ts`는 누락·잘못된 필드를 기본값으로 해석하고 API 저장값을 검증한다.
  사진 1장은 고정을 무시하며, 안전한 도입·마무리 경계가 없으면 해당 고정을 적용하지 않는다.
  나머지 사진은 순서를 유지해 균등 배치하며, 자동 분할을 끄면 기존 경계를 공유할 수 있다.
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

`/prepare`, 호환용 Extension Task API, Publication Job 등록은 모두 현재 Task의 같은 배치 설정을 사용한다.
Job 등록 시 최종 bodyText와 blocks만 기존 execution_snapshot에 고정한다. 설정 자체는 snapshot에 추가하지 않는다.
Task 설정 변경은 Draft 내용·상태와 기존 Job에 영향을 주지 않으며 새 Job에만 반영된다.
배포 전 `202610150004_add_blog_image_placement_settings.sql`을 별도로 적용해야 한다.
이전 코드로 되돌려도 nullable 컬럼과 기존 데이터는 유지할 수 있다.
사진 관리에는 `202610150005_blog_image_management.sql`을 별도로 적용해야 한다.
이 migration은 출처 컬럼·unique index·순서 저장 RPC와 기존 내부 도구 방식의 sort_order UPDATE 권한을 추가한다.
기존 직접 업로드는 출처가 null이며 그대로 동작한다. 이전 앱으로 되돌릴 때 추가 컬럼·함수는 유지할 수 있다.
이미지 편집에는 `202610150006_blog_image_editor.sql`을 별도로 적용해야 한다.
이 migration은 원본 경로·편집 metadata와 필요한 컬럼 UPDATE 권한만 추가하며 기존 행을 backfill하지 않는다.
이전 앱으로 되돌리더라도 원본/편집 파일과 nullable 컬럼은 유지한다.

## Blog 발행 흐름

```text
approved draft + 현재 Task 사진 → 웹 Queue 등록 시 execution_snapshot 고정
  → Side Panel queued/failed Job 조회·같은 Job 재조회 (queued만 실행)
  → background가 Job 선점·attempt 증가·실행 직전 signed URL 발급 요청
  → snapshot adapter (고정 본문 / 사진 / Blocks)
  → background: 현재 Naver tab/frame 확정·debugger attach
  → 제목 입력·검증 → text/image Blocks 순차 실행
  ↔ content: DOM 위치/문서 끝 selection/본문·이미지 검증
  → scheduled는 예약 날짜/시간 설정
  → scheduled+auto는 safety validation 후 최종 예약 등록 버튼 CDP 클릭
  → 임시 파일 정리·debugger detach
  → 해당 attempt의 inserted 또는 failed 기록
  → review는 사용자 검수·최종 발행 / scheduled+auto도 성공 시 inserted 유지
```

`/api/extension/publication-jobs`는 queued/failed Job 목록을 반환한다.
상세 GET은 snapshot parser와 adapter로 미리보기 데이터를 만들며 signed URL을 발급하지 않는다.
`POST .../[id]/claim`은 queued와 현재 attempt_no를 조건으로 inserting을 선점한 뒤 고정 사진 경로를 새로 서명한다.
`lib/blog-publishing/publication-extension.ts`가 snapshot을 기존 ExtensionTask로 변환하며 현재 Draft/Task 사진이나 배치 계획을 다시 읽지 않는다.
Side Panel은 선택 sequence·Job ID·Draft ID를 검증한다. background는 client의 실행 payload를 신뢰하지 않고 선점 응답만 입력한다.
구형 `/api/extension/blog-tasks` API는 호환용으로 남아 있지만 현재 Side Panel에서는 사용하지 않는다.

기본 V3는 text block을 CDP `Input.insertText`, image block을 `DOM.setFileInputFiles`로 처리한다.
현재 끝 위치에서 앞에서 뒤로 입력하고 문단·사진 사이 위치는 content script가 준비/검증한다.
최대 3장 legacy 경로는 전체 본문을 먼저 넣고 과거 offset을 찾아 사진을 넣는 별도 fallback이다.

이미지는 `/api/extension/temp-image → lib/blog-publishing/temp-image.ts`가 signed URL로 내려받아
서버 임시 파일로 준비한다. Chrome이 그 absolutePath를 읽으므로 현재 사진 입력은 앱 서버와 Chrome이
같은 머신에서 실행되는 환경이 기준이다. 임시 파일 cleanup과 debugger detach는 종료 정리 경로에 있다.

`/content/blog/[id]/prepare`는 본문 복사·사진 다운로드/ZIP의 수동 fallback이며 Extension 실행 화면이 아니다.
`/content/blog/publishing`은 고정 snapshot을 가진 Publication Job 목록이다.
등록 시 일반/예약 발행을 선택하며 예약 날짜·시간은 명시적인 Asia/Seoul 기준으로 UTC timestamptz로 변환한다.
`publish_mode`와 `scheduled_at`은 content snapshot과 분리한 불변 Job metadata다. 기존 행은 manual/null이며, 신규 예약은 미래 10분 단위만 허용하고 초/밀리초를 0으로 정규화한다. 기본값은 KST 현재 시각 +20분을 다음 10분 경계로 올림한다.
Extension 목록·상세·claim 응답은 `publishMode`와 `scheduledAt`을 전달한다. scheduled Job은 입력 전 예약시간을 검증하고, V3/legacy 입력 검증 완료 후 editor iframe의 발행 설정 패널을 연다.
`extension/schedule.ts`는 공통 예약 검증·KST 표시·예약 DOM 설정을 담당하며 빌드에서 background/content/Side Panel에 포함된다.
예약 radio 선택, datepicker의 최대 24회 다음달 이동·날짜 선택, 시/분 change 이벤트 후 값을 다시 확인한다.
예약값 불일치·timeout·Naver 시간 오류는 failed 처리한다. review는 예약 설정 완료 후, auto는 추가 안전 검증과 최종 버튼 클릭까지 완료한 뒤 기존 inserted 결과로 기록한다.
예약시간에 자동 실행하는 cron은 없다. `finalize_mode`는 review(기본)/auto이며 Job 생성 시 고정된다. manual+auto는 API/DB/Extension에서 거부한다.
review는 최종 버튼을 누르지 않는다. scheduled+auto만 예약 상태·미래 시간·Naver 오류·최종 버튼 유일성/표시/활성 상태를 재검증한다.
content script는 `[data-testid="seOnePublishBtn"]`의 검증된 좌표만 반환하고 background가 CDP trusted 클릭 1회를 보낸다. 상단 `tpb.publish` trigger와 구분하며 최종 클릭을 재시도하지 않는다.
scheduled+auto는 실제 Chrome/Naver에서 V3 입력, 예약 날짜/시간 설정, 안전 검증, 최종 버튼 자동 클릭 후 예약 발행 글 목록 등록까지 사용자 검증을 완료했다.
예약 등록 성공을 확인하는 DOM/URL 신호는 아직 없으므로 클릭 후에도 inserted만 기록하고 예약 목록에서 확인하도록 안내한다. 자동으로 published 처리하지 않는다.
상세에서 승인된 Draft를 등록하고 queued Job만 제거할 수 있다.
Extension 입력 성공은 Job을 inserted로 기록한다. scheduled-auto도 실제 예약 등록 성공이나 공개 여부를 자동 판정하지 않으며 published로 변경하지 않는다.

## Extension의 역할 구분

| 구성 | 책임 | 경계 |
|---|---|---|
| `extension/sidepanel/index.ts` + HTML/CSS | 사용자 조작, 앱 연결 설정, Publication Job 선택, 진단 표시, 실행 확인 | CDP/DB를 직접 처리하지 않음 |
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
│  ├─ blog_drafts (generation_snapshot)
│  └─ blog_task_assets → Storage: blog-task-assets
├─ reviews ← review_import_batches
├─ voc_analysis_runs
└─ kin_tasks (preset 지시·설정 snapshot) → kin_drafts (provider / question_intent)

blog_prompt_presets → blog_tasks.preset_id → 새 Blog Draft의 generation_snapshot
kin_prompt_presets → 새 KIN Task 생성 시 snapshot으로 복사
kin_prompt_settings → 모든 KIN 생성의 공통 prompt
```

그림은 코드의 조회/연결 관계이며 모든 실제 DB constraint를 표현한 ERD는 아니다.

| 데이터 | 역할 |
|---|---|
| `products` / `product_assets` | 상품 사실과 제품 사진. Blog Task 사진과 별개 |
| `blog_tasks` | 제품·keyword/topic/instructions·preset_id. 같은 Task에서 여러 draft 생성 가능 |
| `blog_drafts` | 제목·intro·sections·closing·검수 상태·provider/model·generation_snapshot. Extension은 approved만 사용 |
| `blog_prompt_presets` | 사용자 편집 prompt 4개와 분량·소제목·키워드 범위 |
| `blog_task_assets` | Task 사진 경로·파일명·sort_order. 실제 bytes는 Storage에 저장 |
| `blog_publication_jobs` | 승인 Draft 실행 snapshot, 웹 Queue, Extension 선점·attempt·입력 성공/실패 기록 |
| `reviews` / `review_import_batches` | 제품 리뷰와 가져오기 결과/상태 |
| `voc_analysis_runs` | 제품별 VOC 결과·분석 상태·오류·모델 |
| `kin_tasks` / `kin_drafts` | 질문·제품·언급 수준·추가 지시 및 생성 답변. Task에 preset 지시/설정 snapshot 저장 |
| `kin_prompt_presets` | 선택 스타일과 문단·분량·키워드·금칙어 설정. 글자 수는 answer schema의 200~1500 범위 |
| `kin_prompt_settings` | singleton 공통 시스템/사실성 prompt와 공통 스타일 prompt |

현재 Extension은 Job의 고정 image snapshot을 사용한다. `/prepare`와 구형 Task API는 여전히 현재 Task 사진을 읽는다.
AI section의 imageAssetId=null과 실제 Task 사진 배치도 구분한다.
Draft 검수 status·역사적 publishing_status·Job 실행 status는 별개다. Extension은 Job 입력 결과만 기록한다.
기존 migrations는 일부 테이블·정책 변경 기록이므로 실제 DB 전체 schema를 대체하지 않는다.

### Publication Job 웹 Queue / Extension 실행

`lib/blog-publishing/publication-jobs.ts`의 `createPublicationJob`은 특정 승인 Draft와 현재 Task 사진을 읽어
`orderedTaskImages`, `prepareBlogPost`, `createBlogExecutionBlocks`로 실행 데이터를 한 번 만든다.
같은 Draft 재등록은 기존 Job을 반환하며 동시 등록은 DB UNIQUE 충돌 뒤 기존 Job을 조회한다.
이미 등록된 Job은 원본 Draft의 내용·승인 상태 또는 Task 사진이 변경돼도 다시 계산하지 않는다.
DB snapshot을 읽을 때 version·본문·block 순서·사진 대응·metadata를 runtime parser로 검증한다.

상세의 `AddPublicationJob`은 현재 선택한 승인 Draft ID를 `POST /api/blog/publication-jobs`에 전달한다.
API는 현재 승인·Task 소속을 확인한 뒤 등록 함수를 호출하고, 중복이면 기존 Job을 안내한다.
Queue 화면은 snapshot의 제목·사진 수와 Job의 상태·시간·오류를 최신 등록순으로 보여준다.
`DELETE /api/blog/publication-jobs/[id]`는 DELETE 자체에 queued 조건을 걸며 Draft·사진을 삭제하지 않는다.
Extension의 Job 선점·입력 결과 API와 웹의 수동 완료 기록·재대기 API를 제공한다. `/prepare`는 기존 동작 그대로다.
`PATCH /api/blog/publication-jobs/[id]`는 `transitionPublicationJob`에서 inserted→published, failed→queued 및 10분 이상 지난 inserting→queued만 조건부 UPDATE한다.
발행 완료는 사용자가 네이버 발행을 직접 확인한 기록이며 자동 검증이 아니다. URL은 선택이며 입력 시 http/https만 허용한다.
published_at은 기록 시각으로 저장한다. 재대기는 동일 snapshot·원본 연결·attempt_no를 유지하고 오류·started_at·inserted_at만 초기화한다.
queued는 제거, inserted는 발행 완료 기록, failed는 다시 대기열로 표시한다. 정상 inserting/published는 액션이 없다.
`isStalePublicationInserting`은 started_at 기준 10분 경과를 판단한다. 시각이 없거나 유효하지 않으면 복구하지 않는다.
Queue를 새로 조회하면 오래된 inserting에 중단 추정 안내와 수동 복구 버튼을 표시한다. 서버는 클라이언트 시각 대신 DB의 시작 시각을 검사한다.
복구 UPDATE에는 inserting·읽은 started_at·attempt_no 조건을 함께 걸어 완료 결과나 새 claim을 덮어쓰지 않는다.
복구는 snapshot·원본 연결·attempt_no를 유지하고 started_at·inserted_at·오류를 초기화한다. 자동 실행이나 Extension 종료는 수행하지 않는다.

snapshot에는 version=1, title, bodyText, text/image blocks, assetId/storagePath/fileName/sortOrder만 저장한다.
signed URL·temp 파일·AI 생성 설정은 포함하지 않는다. 이미지 block의 index는 images 배열 위치다.
migration은 DB catalog에서 Task/Draft ID 타입을 확인해 FK를 만들고, RESTRICT로 원본 삭제를 막는다.
UPDATE trigger는 snapshot과 원본 연결·식별자·등록 시간을 고정하며, 실행 상태 필드만 갱신한다.
Task 삭제 API는 모든 상태의 Job을 먼저 확인해 삭제를 거부하며, FK 충돌도 안내한다.

사진 전체 삭제는 `DELETE /api/blog/tasks/[id]/assets`에서 기존 삭제 helper를 호출한다.
helper는 Storage를 건드리기 전에 모든 사진의 asset ID 또는 경로를 모든 상태의 Job과 대조한다.
조회 실패 시 삭제를 중단한다. 참조 사진은 Task row만 제거하고 Storage 원본을 보존한다.
미참조 사진은 Storage와 row를 제거하며 기존 백업·복구 방식을 유지한다.
Extension은 snapshot의 경로로 signed URL을 발급하므로 제거된 Task row를 다시 조회하지 않는다.
이 보호는 앱 삭제 경로에 적용되며, 기존 anon 권한으로 DB/Storage에 직접 접근하는 경우까지 막는 DB 정책 변경은 아니다.
등록/삭제 동시 요청 사이의 경쟁 조건은 DB transaction·Storage를 아우르는 별도 보호가 필요하다.
현재 생성 함수의 여러 조회는 하나의 DB transaction이 아니므로 등록 도중 원본이 바뀌는 경우의 원자성은 보장하지 않는다.
V3·legacy 입력 loop·temp image·content DOM 검증은 유지하며 Job 실행 전후만 연결한다. migration은 자동 적용하지 않는다.
웹 Queue·사진/Task 삭제 보호를 사용하려면 1단계 migration 적용이 필요하다. 미적용 시 조회·등록·삭제 확인은 오류로 중단한다.
롤백은 먼저 웹 호출·삭제 보호 의존성을 되돌리고, Job 데이터를 보존한 뒤 새 테이블·전용 trigger function만 제거한다.
Job 데이터가 생긴 뒤에는 먼저 보존해야 하며 기존 Blog 테이블은 롤백 대상이 아니다.

선점은 조건부 UPDATE로 한 요청만 성공한다. 결과는 inserting 및 attempt_no가 일치할 때만 반영하며 동일 완료 응답은 중복 수신해도 안전하다.
입력 성공은 inserted_at 기록·오류 초기화, 실패는 failed·최근 오류 기록으로 구분한다. 사진 3장 초과 Job은 legacy 실행 전에 차단한다.
failed는 웹에서 부분 입력 확인·정리 후 같은 Job을 queued로 되돌릴 수 있다. 다음 claim에서만 attempt_no가 증가한다.
중간 재개는 제공하지 않으며 처음부터 입력한다. service worker 종료·선점 응답 유실로 inserting이 남으면 10분 이후 수동 복구한다.
10분 경과는 실제 종료의 증명이 아니다. 사용자가 기존 Extension 입력 종료와 부분 입력 정리를 확인해야 하며, 자동 재실행하지 않는다.
입력 성공 뒤 결과 저장만 실패하면 완료 안내와 상태 기록 미확인 경고를 표시하며 failed로 덮어쓰지 않는다.
V3 10장 입력 엔진의 기존 실검증과 새 Job 연결의 mock 검증을 구분한다. 새 연결의 Chrome/Naver 실검증은 별도로 필요하다.

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
→ DB 공통 Prompt + 선택 preset snapshot + 이번 질문/추가 지시 + 제품·최신 완료 VOC
→ `lib/kin/prompts.ts → lib/kin/provider.ts → lib/ai/provider.ts`
→ 구조화 답변 검증 → 제품 언급 hard validation → quality-check 경고 → kin_drafts/Task 상태 저장.

`KinPromptSettings.tsx → /api/kin/prompt-settings`는 기본 접힘 상태의 공통 prompt 편집기다.
`kin_prompt_settings`는 단일 행이며 기존 시스템/공통 스타일 문구를 원문 그대로 seed한다.
공통 문구가 없으면 생성은 중단하며 코드 기본 prompt로 조용히 대체하지 않는다.
`KinPresetControl.tsx → /api/kin/presets/ → lib/kin/presets.ts`는 선택 스타일 CRUD를 유지한다.
이번 질문의 추가 지시는 기존 textarea를 사용하며 프리셋과 별개다.

우선순위는 출력 schema/프로그램 계약, 이번 질문 추가 지시, 선택 preset, 공통 Prompt 순이다.
이 순서와 none/relevant/direct 정책을 system 역할의 JSON 계약으로 전달하고, 모든 글쓰기 자연어는
공통 Prompt·preset·추가 지시 데이터에 둔다. 코드에서 자연어 안내를 append하지 않는다.
구조화된 preset 설정도 자연어 template로 변환하지 않고 JSON 그대로 전달한다.
초기 공통 prompt의 문구도 사용자가 편집할 수 있으며 프로그램 계약을 무효화하지 않는다.

`lib/kin/generate.ts`는 answer schema·모델 기본값·응답 검증·VOC 압축을 담당한다.
answer 허용 범위 200~1500자를 preset UI/parser/API에서도 그대로 사용한다.
범위를 벗어난 기존 preset/Task snapshot을 자동 수정하지 않으며 새 생성 또는 재생성 시 명확히 중단한다.
`lib/kin/mention-validation.ts`는 direct의 상품명 최소 1회, none의 상품명·브랜드 금지,
productMentioned와 실제 문자열 등장 여부의 일치를 강제한다. 실패 답변은 저장하지 않는다.
이 검사는 이름/브랜드 문자열 등장 검사이며 관련성·사실성의 의미 분석은 아니다.
`lib/kin/quality-check.ts`의 기존 경고 검사는 별도로 유지한다.

최근 작업 영역은 기본 접힘을 유지한다. `KinTaskHistory.tsx → /api/kin/tasks/[id]/drafts`는
선택한 Task의 Draft만 최신순으로 조회하고 선택·질문 의도·provider/model·생성 시간·답변·복사를 제공한다.
새 Draft는 provider/question_intent를 저장한다. 기존 행의 누락 정보는 “기록 없음”으로 표시한다.
`202610150002_kin_common_prompts.sql`은 공통 prompt 테이블과 nullable Draft 컬럼 두 개만 추가한다.
기존 Task/preset snapshot·답변은 보존하며 migration은 자동 적용하지 않는다.
KIN은 생성·확인·복사 도구다. Draft 편집, 승인/반려, Queue, 자동 등록은 제공하지 않는다.
현재 네이버 지식인 답변의 최종 자동 등록 경로는 없다. 매출·주문·재고 분석도 현재 실행 모듈이 아니다.

## 어디를 수정해야 하나

| 변경할 것 | 먼저 볼 파일 |
|---|---|
| 글쓰기 규칙·문체 | BlogPresetControl과 DB blog_prompt_presets (코드는 문구를 추가하지 않음) |
| 프리셋 검증·prompt 조립·생성 기록 | `lib/blog-generation/presets.ts`, `prompts.ts`, `snapshot.ts` |
| AI 응답 구조 | `lib/blog-generation/schema.ts` |
| AI provider transport | `lib/ai/provider.ts` (Blog/KIN 공통) |
| Blog 모델·분량 | `lib/blog-generation/models.ts`, `body.ts` |
| Blog 생성·저장 | `app/api/blog/generate/route.ts` |
| Task 조건·draft 편집/승인 | `app/content/blog/new/page.tsx`, `[id]/EditBlogTask.tsx`, `[id]/GenerateBlogDraft.tsx` |
| Blog 프리셋 화면·저장 | `app/content/blog/[id]/BlogPresetControl.tsx`, `app/api/blog/presets/` |
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
| KIN 공통 prompt·선택 스타일 | `KinPromptSettings.tsx`, `KinPresetControl.tsx`, `lib/kin/prompts.ts`, `presets.ts` |
| KIN 출력·제품 언급·품질 검사 | `lib/kin/generate.ts`, `mention-validation.ts`, `quality-check.ts` |
| KIN 과거 답변 조회·복사 | `KinTaskHistory.tsx`, `app/api/kin/tasks/[id]/drafts/route.ts` |
| DB 연결·권한 | `lib/supabase.ts`, `supabase/migrations/` |
| 메뉴·공통 화면 | `app/layout.tsx`, `app/globals.css` |
| Extension 빌드·권한 | `scripts/build-extension.mjs`, `extension/manifest.json` |

표의 `[id]/...`는 해당 기능의 동적 상세 화면 경로다. Blog 항목은 `app/content/blog/[id]/`,
Product 항목은 `app/products/[id]/`를 기준으로 읽는다.
