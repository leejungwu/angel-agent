# Angel Agent Blog Extension

## V3 순차 입력 (Chrome 검증 대기)

- Side Panel의 `V3 순차 입력`은 API의 `blocks`를 앞에서 뒤로 처리합니다. text block은 `Input.insertText`, image block은 기존 temp API와 CDP file chooser 업로드를 사용합니다. 사진 수 제한은 없습니다.
- 기존 데이터와 최대 3장 입력 경로는 유지합니다. `기존 안정 버전 · 최대 3장`을 선택하면 해당 경로로 실행합니다. 실패한 V3를 같은 글에서 자동 재실행하지 않습니다.
- 첫 실제 검증은 사진 2장 작업으로 진행합니다. 사진 업로드 후 다음 빈 본문 문단에서 텍스트가 이어지는지 확인해야 합니다. 최종 발행은 실행하지 않습니다.
- V3는 사진 버튼 클릭 후 `DOM.getDocument`로 현재 file input을 조회하고 `DOM.setFileInputFiles`로 지정합니다. chooser 이벤트를 기다리지 않습니다. native dialog 차단은 전체 loop 동안 유지하며 종료 시 해제합니다. 실패 단계와 image block 번호를 표시합니다. 기존 3장 경로의 chooser 방식은 유지합니다.

## 기존 안정 경로

1. `npm.cmd run build:extension` 후 `extension/dist`를 Chrome에 압축해제된 확장프로그램으로 로드합니다.
2. 최초 1회 앱 주소와 전용 `ANGEL_EXTENSION_TOKEN`을 입력하고 연결 저장합니다. 설정은 `chrome.storage.local`의 `appUrl`, `extensionToken`에 보관하며 TRUSTED_CONTEXTS로 제한합니다. 재열기/reload 시 자동 연결합니다.
3. 직접 로그인한 새 Naver 글쓰기 탭을 열고 초안을 선택해 입력합니다. 제목/본문은 기존 V1 CDP 입력·검증을 유지합니다. 사진이 이미 있는 글에는 입력하지 않습니다.

## V2: 최대 3장

- Extension API는 깨끗한 `bodyText`와 각 이미지의 `insertOffset`, `insertPrefix = bodyText.slice(0, insertOffset)`을 반환합니다. offset은 해당 bodyText의 0-based UTF-16 문자 위치이며 index도 기존 0-based 값을 유지합니다.
- 위치 선택은 기존 `planBlogImages()`를 그대로 사용합니다. 계획된 문단을 직렬화하고 앞 문단 끝 위치를 offset으로 계산합니다. 수동 /prepare의 사진 위치 미리보기는 별도로 유지합니다.
- visible text node를 TreeWalker로 수집합니다. `normalizeForPosition()` 하나로 expected body, 실제 본문, insertPrefix, caret, 최종 본문을 비교합니다. PHOTO_POSITION은 insertPrefix 범위의 문자와 순서만 검증합니다. prefix 끝을 DOM text node/local offset에 대응시키며 raw offset을 DOM에 직접 적용하지 않습니다. 전체 본문 차이는 사진 삽입 후 PHOTO_VERIFY에서 차단합니다. 추가 suffix는 길이와 최대 40자 preview만 기록하며, 위치 실패 시 길이와 최초 불일치 index를 표시합니다.
- collapsed Range 좌표를 trusted CDP로 클릭하고 실제 caret의 본문 위치를 확인합니다. Enter 두 번 뒤 문단·빈 문단 수 증가와 해당 offset의 빈 문단만 확인하고 그 문단을 클릭합니다. 중간 suffix/DOM identity 검증은 하지 않습니다.
- localhost Angel Agent와 Chrome은 같은 PC에서 실행해야 합니다. background가 첫 3장을 insertOffset 내림차순으로 처리하며 기존 Bearer 인증으로 POST /api/extension/temp-image에 signedUrl을 보냅니다. 서버는 현재 Supabase 작업 이미지 URL만 fetch하고 파일 형식/10MB 제한을 확인한 뒤 OS TEMP/angel-agent/naver-upload/<uuid>.<png|jpg|webp>에 저장합니다. 반환된 absolutePath를 기존 CDP에 전달합니다. Extension에는 downloads 권한/호출이 없습니다.
- 빈 문단 caret 확인 후 Page.setInterceptFileChooserDialog(enabled=true)를 활성화하고 검증된 .se-image-toolbar-button을 trusted click합니다. Page.fileChooserOpened의 backendNodeId로 DOM.setFileInputFiles(files=[absolute filename])를 호출합니다. 각 사진 image component가 1 증가했는지 확인한 뒤 interception/listener/timer를 정리합니다.
- JPEG/PNG/WebP, 최대 10MB. 오류는 PHOTO_TEMP_CREATE / PHOTO_POSITION / PHOTO_EMPTY_PARAGRAPH / PHOTO_FILE_CHOOSER / PHOTO_UPLOAD / PHOTO_TEMP_CLEANUP / PHOTO_VERIFY로 구분합니다. 본문·토큰·signed URL은 로그에 출력하지 않습니다.
- 이번 다중 업로드 경로는 Chrome/Naver에서 실행하지 않았습니다. 사용자가 확인한 V1 입력과 기존 1장 위치/caret 구조를 재사용합니다. 다음 Chrome 검증은 native file dialog 없이 사진 3장이 계획된 위치/순서에 들어가는지 확인하는 것입니다. 실패 시 일부 입력이 남을 수 있습니다.

## 검사

`npm.cmd run test:blog-body`
`node scripts/test-extension-offset.mjs`
`node scripts/test-extension-photo.mjs`
`node scripts/test-extension-temp-image.mjs`
`node scripts/test-extension-settings.mjs`

`npm.cmd run build:extension`

API 인증·signed URL 생성은 기존 방식이며 DB 상태를 변경하지 않습니다. Chrome 로그인·발행·예약은 사용자가 수행합니다. 디버깅 권한 안내가 표시될 수 있으며 DevTools/다른 debugger가 연결돼 있으면 강제로 해제하지 않습니다.

- 사진별 업로드 직후에는 삭제하지 않습니다. 전체 사진 처리/본문 검증 뒤 finally에서 모은 tempId들을 DELETE /api/extension/temp-image/<tempId>로 일괄 정리합니다. 실패한 ID만 즉시 시도 후 500ms, 1500ms, 3000ms 간격으로 재시도하며 성공한 ID는 큐에서 제거합니다. 서버는 client path를 받지 않고 UUID와 지원 확장자로 전용 temp 경로만 계산합니다. 파일이 없어도 성공합니다. 최종 cleanup 실패는 입력 완료 메시지에 PHOTO_TEMP_CLEANUP 경고로 표시하며 성공한 사진을 되돌리거나 다음 사진을 중단하지 않습니다. 브라우저/서버 강제 종료 때의 잔여 파일 자동 청소 작업은 추가하지 않았습니다. 모든 사진 후 본문 문자/순서를 한 번 검증합니다.
- CDP file chooser / DOM.setFileInputFiles와 서버 temp 연결로 실제 사진 3장 및 최종 입력 완료를 사용자가 확인했습니다. 이번 cleanup 지연/재시도 변경은 mock 및 빌드만 검증했습니다. 다음 Chrome 테스트는 다운로드 UI 없이 사진 3장 삽입과 서버 temp 파일 정리를 확인합니다.
