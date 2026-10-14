# Architecture

## 전체

```text
Next.js UI → API → lib → Supabase DB/Storage 또는 AI Provider
Chrome Extension → 앱의 Extension API → 실행 자료
Chrome Extension → 현재 열린 Naver SmartEditor → 사용자 최종 발행
```

작업 생성·draft 편집/승인·사진 업로드는 일부 client UI가 Supabase를 직접 호출한다.
Blog/KIN은 `lib/ai/provider.ts`를 공유하며 VOC 분석은 별도 OpenAI 호출을 사용한다.

| 폴더 | 역할 |
|---|---|
| `app/` | 화면과 API routes |
| `lib/` | 업무 규칙·AI 호출·데이터 변환 |
| `extension/` | Side Panel·Chrome/CDP·Naver DOM 접근 |
| `supabase/migrations/` | DB/Storage 변경 SQL |
| `scripts/` | 로컬 테스트·Extension 빌드 |
| `docs/` | 현재 구조·개발 우선순위·사용 안내 |

`.next/`, `node_modules/`, `extension/dist/`는 생성물이다. 원본 코드에서 수정한다.

## Blog 생성

Task → AI generate → Draft 저장 → 편집/승인 → Task 사진 연결

- `app/content/blog/new/page.tsx`: 작업 생성
- `app/content/blog/[id]/GenerateBlogDraft.tsx`: 생성 요청·편집·승인·모델 선택
- `app/api/blog/generate/route.ts`: Task/제품 조회·AI 호출·검증·저장
- `lib/blog-generation/prompts.ts`: 고정 규칙·참고 가이드·작업별 지시
- `lib/blog-generation/schema.ts`: AI JSON 출력 구조
- `lib/blog-generation/models.ts`, `body.ts`: 모델 목록·기본값·본문 분량 안내
- `app/content/blog/[id]/BlogTaskAssets.tsx`: 사진 업로드·전체 삭제

사진은 생성 전에도 등록할 수 있다. 현재 생성 입력은 keyword/topic/instructions이며,
목록에 표시되는 역사적 purpose 값은 생성 prompt에 사용하지 않는다.

## Blog 발행

승인 Draft + Task 사진 → image-layout → preparation → blocks → extension-api
→ Side Panel → background ↔ content → Naver → 사용자 최종 발행

- `lib/blog-publishing/image-layout.ts`: 문단 분할과 사진 위치 정책
- `lib/blog-publishing/preparation.ts`: 본문·배치 offset·수동 사진 마커 준비
- `lib/blog-publishing/blocks.ts`: offset 기준 text/image 실행 배열 생성
- `lib/blog-publishing/extension-api.ts`: 승인 draft 검사·정렬된 사진·signed URL·blocks 응답
- `app/api/extension/blog-tasks/`: 승인 목록 및 taskId/draftId 상세 API
- `extension/sidepanel/index.ts`: 연결 설정·작업 선택·입력 직전 동일 draft 재조회
- `extension/background.ts`: 현재 Naver 탭에 debugger 연결·CDP text/file 입력·종료 정리
- `extension/content.ts`: SmartEditor DOM 탐색·좌표/selection 준비·본문/이미지 검증
- `extension/types.d.ts`: Extension 데이터와 메시지 타입 계약

기본 V3는 text/image blocks를 순서대로 처리한다. 최대 3장 legacy 경로도 유지된다.
사진은 `temp-image.ts`와 `/api/extension/temp-image`에서 서버 임시 파일로 준비한다.
이 파일 경로를 Chrome이 읽어야 하므로 현재 사진 입력은 같은 머신의 앱/Chrome 환경이 기준이다.

`/content/blog/[id]/prepare`는 수동 복사·사진 다운로드 fallback이다.
사진 마커는 이 수동 화면용이며 Extension 실행 본문에는 포함하지 않는다.
`/content/blog/publishing`은 승인 목록이며 실행 Queue는 아니다.
Extension 입력 성공은 DB 발행 상태를 자동 갱신하지 않고 최종 발행 버튼도 누르지 않는다.

## 데이터

```text
blog_tasks
├─ blog_drafts
└─ blog_task_assets → Storage: blog-task-assets
```

- `blog_tasks`: 제품과 keyword/topic/instructions 등 작업 조건. 하나의 작업에 여러 draft가 연결된다.
- `blog_drafts`: 제목·intro·sections·closing·검수 status·model. Extension은 approved만 사용한다.
- `blog_task_assets`: Task 사진의 storage_path·file_name·sort_order. draft별 snapshot이 아니며 sort_order → id 순으로 사용한다.

## 어디를 수정해야 하나

| 변경할 것 | 파일/위치 |
|---|---|
| 글 스타일·작성 규칙 | `lib/blog-generation/prompts.ts` |
| AI 출력 구조 | `lib/blog-generation/schema.ts` |
| 생성/저장 | `app/api/blog/generate/route.ts` |
| 모델·분량 기준 | `lib/blog-generation/models.ts`, `body.ts` |
| Task 입력·draft 승인 UI | `app/content/blog/new/`, `[id]/EditBlogTask.tsx`, `[id]/GenerateBlogDraft.tsx` |
| 사진 위치 | `lib/blog-publishing/image-layout.ts`의 `chooseImagePositions()` |
| 본문·offset·수동 마커 | `lib/blog-publishing/preparation.ts` |
| Block 구조 | `lib/blog-publishing/blocks.ts` |
| Extension API | `lib/blog-publishing/extension-api.ts`, `app/api/extension/` |
| Side Panel | `extension/sidepanel/` |
| Naver 실제 입력·검증 | `extension/background.ts`, `extension/content.ts` |
| 사진 압축·파일 준비 | `lib/blog-task-assets/compact.ts`, `lib/blog-publishing/temp-image.ts` |
| AI provider | `lib/ai/provider.ts` |
| DB 연결·정책 | `lib/supabase.ts`, `supabase/migrations/` |
