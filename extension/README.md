# Angel Agent Blog Extension V1

1. `.env.local`에 `ANGEL_EXTENSION_TOKEN`을 32자 이상의 임의 비밀값으로 설정하고 Angel Agent 서버를 재시작합니다. Supabase 환경변수는 기존 앱 설정을 사용합니다.
2. `npm.cmd run build:extension`을 실행합니다. Chrome의 확장프로그램 관리에서 개발자 모드를 켜고 `C:\dev\angel-agent\extension\dist`를 압축해제된 확장프로그램으로 로드합니다.
3. 확장 아이콘으로 사이드패널을 열고 Angel Agent 주소(기본 `http://localhost:3000`)와 같은 연결 토큰을 입력합니다. 토큰은 Chrome session storage에만 보관하며 Chrome 재시작 후 다시 입력합니다. HTTPS 배포 주소는 연결 버튼에서 해당 origin 권한만 추가 요청합니다.
4. Blog Task를 선택하고, 직접 로그인한 **새 빈** Naver 글쓰기 탭을 현재 탭으로 엽니다. `현재 글쓰기 DOM 진단`을 눌러 frameReady/titleFound/bodyFound를 확인합니다. contenteditable 여부로 입력 가능성을 판단하지 않습니다.
5. `현재 글쓰기 화면에 넣기`를 누릅니다. 기존 텍스트는 덮어쓰기 확인이 필요하고, 사진이 있는 글은 안전상 입력하지 않습니다. 사진 마커를 보고 사진을 직접 추가한 뒤 최종 발행합니다.

## 구조와 한계

- `background.ts`: API 연결, 현재 Naver 탭과 프레임 조회, `chrome.debugger` attach → 영역 중앙 CDP mouse click → `Input.insertText` → DOM 검증 → finally detach. 제목과 본문을 각각 한 번에 입력합니다. 탭 전환 시 중단하고 중복 입력도 차단합니다. Chrome 실행·로그인·발행 기능 없음.
- `content.ts`: 프레임/제목/본문을 탐색하고 scrollIntoView, rect 조회, DOM 텍스트 검증만 수행합니다. contenteditable 탐색, DOM 대입, synthetic input, Range 편집은 하지 않습니다. 같은 origin의 iframe 좌표를 최상위 탭 CSS pixel로 변환하며 가려진/변형된/접근 불가능한 위치는 클릭하지 않습니다.
- debugger 권한 때문에 Chrome에 디버깅 안내가 표시될 수 있습니다. DevTools나 다른 debugger가 이미 연결되어 attach가 실패하면 기존 debugger를 강제로 해제하지 않습니다. 작업 도중 탭을 전환하거나 Chrome 디버깅 연결을 취소하면 입력을 중단합니다.
- 기존 글은 사용자 확인 후 Windows Ctrl+A를 해당 클릭 영역에 전달하여 대체합니다. 선택 범위 처리와 긴 한국어 본문의 `Input.insertText` 수락 여부는 실제 SmartEditor에서 사용자가 확인해야 합니다. Clipboard paste는 아직 비교 검증되지 않아 구현하지 않았습니다.
- V2의 이미지 입력/마커 교체는 background의 CDP 입력과 content의 위치/검증 메시지로 분리해 붙일 수 있습니다. API `images`에는 정렬된 index와 10분 signed URL이 준비됩니다. 만료 시 작업을 다시 선택합니다.
- 실제 Naver 페이지는 개발 중 열거나 입력하지 않았습니다. 사용자가 확인한 `.se-title-text`, `.se-component.se-text .se-text-paragraph` 구조를 사용합니다. 실제 입력 수락 및 네이버 내부 저장 상태는 사용자의 Chrome 테스트로 확인해야 합니다.
- DOM 입력 후 텍스트 일치 검증은 수행하지만 네이버 서버 저장/발행은 확인하거나 실행하지 않습니다. 입력 오류 시 일부 텍스트가 남을 수 있으므로 화면을 직접 확인합니다.
- Extension API는 읽기 전용이며 최신 초안을 가져옵니다(검수 전 초안 포함). DB 상태 변경이나 공개 CORS 허용 없음. 토큰을 외부에 공유하지 마세요.

Chrome 공식 문서: [Content scripts / all_frames](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Side Panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).
CDP 전송: [chrome.debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger). Extension을 다시 빌드/새로고침하고 새 debugger 권한을 허용한 뒤 테스트합니다.
