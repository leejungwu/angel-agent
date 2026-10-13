# Angel Agent Blog Extension

1. `npm.cmd run build:extension` 후 `extension/dist`를 Chrome에 압축해제된 확장프로그램으로 로드합니다.
2. 최초 1회 앱 주소와 전용 `ANGEL_EXTENSION_TOKEN`을 입력하고 연결 저장합니다. 설정은 `chrome.storage.local`의 `appUrl`, `extensionToken`에 보관하며 TRUSTED_CONTEXTS로 제한합니다. 재열기/reload 시 자동 연결합니다.
3. 직접 로그인한 새 Naver 글쓰기 탭을 열고 초안을 선택해 입력합니다. 제목/본문은 기존 V1 CDP 입력·검증을 유지합니다. 사진이 이미 있는 글에는 입력하지 않습니다.

## V2: 첫 사진만

- Extension API는 깨끗한 `bodyText`와 각 이미지의 `insertOffset`, `insertPrefix = bodyText.slice(0, insertOffset)`을 반환합니다. offset은 해당 bodyText의 0-based UTF-16 문자 위치이며 index도 기존 0-based 값을 유지합니다.
- 위치 선택은 기존 `planBlogImages()`를 그대로 사용합니다. 계획된 문단을 직렬화하고 앞 문단 끝 위치를 offset으로 계산합니다. 수동 /prepare의 사진 위치 미리보기는 별도로 유지합니다.
- visible text node를 TreeWalker로 수집합니다. `normalizeForPosition()` 하나로 expected body, 실제 본문, insertPrefix, caret, 최종 본문을 비교합니다. PHOTO_POSITION은 insertPrefix 범위의 문자와 순서만 검증합니다. prefix 끝을 DOM text node/local offset에 대응시키며 raw offset을 DOM에 직접 적용하지 않습니다. 전체 본문 차이는 사진 삽입 후 PHOTO_VERIFY에서 차단합니다. 추가 suffix는 길이와 최대 40자 preview만 기록하며, 위치 실패 시 길이와 최초 불일치 index를 표시합니다.
- collapsed Range 좌표를 trusted CDP로 클릭하고 실제 caret의 본문 위치를 확인합니다. Enter 두 번 뒤 문단·빈 문단 수 증가와 해당 offset의 빈 문단만 확인하고 그 문단을 클릭합니다. 중간 suffix/DOM identity 검증은 하지 않습니다.
- Side Panel 입력 버튼 클릭 후 첫 signed URL을 fetch하고 Blob을 준비하며 JPEG/WebP를 canvas로 PNG Blob으로 변환하고 `ClipboardItem`으로 기록합니다(PNG는 그대로 사용). `clipboardWrite` 권한을 사용합니다. Clipboard API 확인 후 document.hasFocus()가 true일 때만 쓰며 성공 후 clipboardReady=true로 background 입력을 요청합니다. 실패는 PHOTO_FETCH / PHOTO_CONVERT / PHOTO_CLIPBOARD_API / PHOTO_CLIPBOARD_FOCUS / PHOTO_CLIPBOARD_WRITE로 구분하며 signed URL/이미지 데이터는 진단에 출력하지 않습니다. 서버/로컬 파일 저장은 하지 않습니다.
- 검증된 offset의 빈 문단을 다시 DOM에서 찾고 trusted click 후 caret을 확인합니다. CDP Ctrl+V로 paste하며 사진 버튼·native 파일 창·file input은 사용하지 않습니다. paste 직전 이미지 컴포넌트 개수를 기록하고 정확히 1개 증가하면 본문 문자를 비교합니다. 본문 수집은 `.se-component.se-text .se-text-paragraph`만 대상으로 하며 컴포넌트 선택 UI/toolbar/사진 캡션은 제외합니다. 최종 발행은 실행하지 않습니다.
- JPEG/PNG/WebP, 최대 10MB. URL 만료/권한 실패 시 작업을 다시 선택합니다. 오류는 PHOTO_POSITION / PHOTO_CARET / PHOTO_EMPTY_PARAGRAPH / PHOTO_UPLOAD / PHOTO_VERIFY 단계로 표시합니다. 본문·토큰·signed URL은 로그에 출력하지 않습니다.
- 개발 중 Chrome/Naver는 실행하지 않았습니다. Enter 후 SmartEditor가 caret을 이동하면 두 번의 Enter가 다른 위치에 빈 문단을 만들 수 있으며, 해당 경우 PHOTO_EMPTY_PARAGRAPH에서 중단합니다. 실제 Chrome의 Side Panel clipboard 쓰기 및 SmartEditor image paste 수락은 사용자 Chrome에서 검증해야 합니다. OS clipboard 내용은 첫 이미지로 바뀝니다. 실패 시 일부 입력이 남을 수 있습니다.
- 여러 사진 자동 입력은 미구현입니다. 확장할 때는 큰 offset부터 작은 offset 순으로 처리해야 기존 문자 위치를 유지할 수 있습니다.

## 검사

`npm.cmd run test:blog-body`
`node scripts/test-extension-offset.mjs`
`node scripts/test-extension-photo.mjs`
`node scripts/test-extension-settings.mjs`
`node scripts/test-extension-clipboard.mjs`

`node scripts/test-extension-panel-clipboard.mjs`
`npm.cmd run build:extension`

API 인증·signed URL 생성은 기존 방식이며 DB 상태를 변경하지 않습니다. Chrome 로그인·발행·예약은 사용자가 수행합니다. 디버깅 권한 안내가 표시될 수 있으며 DevTools/다른 debugger가 연결돼 있으면 강제로 해제하지 않습니다.
