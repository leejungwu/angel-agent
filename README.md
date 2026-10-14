# Angel Agent

## 프로젝트 소개

Angel Agent는 상품 정보와 고객 리뷰를 콘텐츠 제작·운영에 연결하는 내부 이커머스 운영 도구입니다.
현재 상품 관리, VOC 분석, AI 블로그 초안과 지식인 답변 생성을 하나의 시스템에서 다룹니다.
승인된 블로그 글과 사진은 Chrome Extension으로 네이버 에디터에 입력하며, 최종 검수와 발행은 사람이 수행합니다.

## 주요 기능

- Blog Task 관리와 AI draft 생성 / 재생성 / 편집 / 승인
- Chrome Extension 기반 Naver 제목·본문·사진 순차 입력
- Task 사진 업로드·기본 압축, 수동 발행 준비·복사·사진 다운로드
- CSV/XLSX 리뷰 가져오기와 AI VOC 분석·인사이트 화면
- KIN 답변 생성, 작성 preset, 품질 경고와 결과 복사
- 상품 기본 관리, 제품 정보·제품 사진 관리

## 현재 Blog 흐름

```text
Task → AI Draft → 편집 / 승인 → Task 이미지
     → text/image Blocks → Chrome Extension → Naver SmartEditor
```

사용자가 현재 열어둔 네이버 글쓰기 탭을 사용합니다. 최종 발행·예약은 사람이 직접 합니다.

## 기술 스택

- Next.js App Router / React / TypeScript
- Tailwind CSS
- Supabase PostgreSQL / Storage
- Chrome Extension Manifest V3 / chrome.debugger / CDP
- OpenAI / Anthropic Claude / xAI Grok

## 로컬 실행

`.env.local`에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`와
사용할 AI의 `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` 또는 `XAI_API_KEY`를 설정합니다.

```sh
npm install
npm run dev
```

Extension 빌드:

```sh
npm run build:extension
```

Extension 연결에는 `ANGEL_EXTENSION_TOKEN`도 필요합니다.
사진 입력은 현재 앱 서버와 Chrome이 같은 PC에서 실행되는 환경을 기준으로 합니다.
설치·연결 방법은 아래 Extension 문서를 참고하세요.

## Documentation

- [ROADMAP](docs/ROADMAP.md): 전체 기능 지도 / 개발 우선순위 / 계획 / 제외 범위
- [ARCHITECTURE](docs/ARCHITECTURE.md): 현재 시스템 구조 / 데이터 연결 / 코드 흐름 / 수정 위치
- [AI_GENERATION](docs/AI_GENERATION.md): AI 콘텐츠 생성 상세
- [Chrome Extension](extension/README.md): 설치 / 연결 / 입력 방식 상세
