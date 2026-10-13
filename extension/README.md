# Angel Agent Blog Extension

## V3 순차 입력 — 실제 draft / 사진 10장 검증 완료

- Side Panel의 `V3 순차 입력`은 API의 `blocks`를 앞에서 뒤로 처리합니다. text block은 `Input.insertText`, image block은 서버 temp API와 CDP `DOM.setFileInputFiles`를 사용합니다. 사진 수 제한은 없으며 현재 task의 모든 image block을 처리합니다. 실제 운영 검증 범위는 사진 10장입니다.
- 기존 데이터와 최대 3장 입력 경로는 유지합니다. `기존 안정 버전 · 최대 3장`을 선택하면 해당 경로로 실행합니다. 실패한 V3를 같은 글에서 자동 재실행하지 않습니다.
- 사용자가 최신 V3로 실제 저장 draft를 사용해 Naver SmartEditor 사진 10장 전체 입력을 확인했습니다. text → image → text 순서, 마지막 본문 입력 및 "입력 완료 - 네이버에서 직접 확인 후 발행하세요" 안내까지 실검증 완료입니다. 이번 문서 작업에서 Naver를 재실행하지 않았습니다. 최종 검수·발행·예약 버튼 클릭은 사용자가 직접 합니다.
- V3는 사진 버튼 클릭 후 `DOM.getDocument`로 현재 file input을 조회하고 `DOM.setFileInputFiles`로 지정합니다. chooser 이벤트를 기다리지 않습니다. native dialog 차단은 전체 loop 동안 유지하며 종료 시 해제합니다. 실패 단계와 image block 번호를 표시합니다. 기존 3장 경로의 chooser 방식은 유지합니다.

## 설치 / 연결 / 실행

1. `npm.cmd run build:extension` 후 `extension/dist`를 Chrome에 압축해제된 확장프로그램으로 로드합니다.
2. 최초 1회 앱 주소와 전용 `ANGEL_EXTENSION_TOKEN`을 입력하고 연결 저장합니다. 설정은 `chrome.storage.local`의 `appUrl`, `extensionToken`에 보관하며 TRUSTED_CONTEXTS로 제한합니다. 재열기/reload 시 자동 연결합니다.
3. 직접 로그인한 새 Naver 글쓰기 탭을 열고 초안을 선택해 입력합니다. 제목은 기존 V1 CDP 입력·검증을 사용하고, V3 본문은 text/image block을 순차 입력합니다. 사진이 이미 있는 글에는 입력하지 않습니다.
4. Side Panel 기본 입력 방식은 V3입니다. 목록은 작업별 최신 승인 draft만 표시합니다. 선택한 draftId를 /api/extension/blog-tasks/{taskId}?draftId={draftId}로 전달하며, 서버는 명시 draftId도 승인 여부를 검사합니다. 입력 버튼 클릭 시 같은 draftId를 다시 조회하고 승인된 응답에만 입력을 시작합니다. 승인 draft가 없는 작업은 목록에서 제외됩니다.
5. /prepare는 앱의 수동 복사·검수·fallback 화면이며 Extension을 직접 실행하지 않습니다.

## Legacy V2: 최대 3장 fallback — 현재 유지

- Extension API는 깨끗한 `bodyText`와 각 이미지의 `insertOffset`, `insertPrefix = bodyText.slice(0, insertOffset)`을 반환합니다. offset은 해당 bodyText의 0-based UTF-16 문자 위치이며 index도 기존 0-based 값을 유지합니다.
- 위치 선택은 기존 `planBlogImages()`를 그대로 사용합니다. 계획된 문단을 직렬화하고 앞 문단 끝 위치를 offset으로 계산합니다. 수동 /prepare의 사진 위치 미리보기는 별도로 유지합니다.
- visible text node를 TreeWalker로 수집합니다. `normalizeForPosition()` 하나로 expected body, 실제 본문, insertPrefix, caret, 최종 본문을 비교합니다. PHOTO_POSITION은 insertPrefix 범위의 문자와 순서만 검증합니다. prefix 끝을 DOM text node/local offset에 대응시키며 raw offset을 DOM에 직접 적용하지 않습니다. 전체 본문 차이는 사진 삽입 후 PHOTO_VERIFY에서 차단합니다. 추가 suffix는 길이와 최대 40자 preview만 기록하며, 위치 실패 시 길이와 최초 불일치 index를 표시합니다.
- collapsed Range 좌표를 trusted CDP로 클릭하고 실제 caret의 본문 위치를 확인합니다. Enter 두 번 뒤 문단·빈 문단 수 증가와 해당 offset의 빈 문단만 확인하고 그 문단을 클릭합니다. 중간 suffix/DOM identity 검증은 하지 않습니다.
- localhost Angel Agent와 Chrome은 같은 PC에서 실행해야 합니다. background가 첫 3장을 insertOffset 내림차순으로 처리하며 기존 Bearer 인증으로 POST /api/extension/temp-image에 signedUrl을 보냅니다. 서버는 현재 Supabase 작업 이미지 URL만 fetch하고 파일 형식/10MB 제한을 확인한 뒤 OS TEMP/angel-agent/naver-upload/<uuid>.<png|jpg|webp>에 저장합니다. 반환된 absolutePath를 기존 CDP에 전달합니다. Extension에는 downloads 권한/호출이 없습니다.
- 빈 문단 caret 확인 후 Page.setInterceptFileChooserDialog(enabled=true)를 활성화하고 검증된 .se-image-toolbar-button을 trusted click합니다. Page.fileChooserOpened의 backendNodeId로 DOM.setFileInputFiles(files=[absolute filename])를 호출합니다. 각 사진 image component가 1 증가했는지 확인한 뒤 interception/listener/timer를 정리합니다.
- JPEG/PNG/WebP, 최대 10MB. 오류는 PHOTO_TEMP_CREATE / PHOTO_POSITION / PHOTO_EMPTY_PARAGRAPH / PHOTO_FILE_CHOOSER / PHOTO_UPLOAD / PHOTO_TEMP_CLEANUP / PHOTO_VERIFY로 구분합니다. 본문·토큰·signed URL은 로그에 출력하지 않습니다.
- 과거 검증 기록: CDP file chooser / DOM.setFileInputFiles와 서버 temp 연결로 실제 사진 3장 및 최종 입력 완료를 사용자가 확인했습니다. 이는 legacy 경로의 검증이며 현재 V3 10장 성공과 구분합니다. 실패하면 일부 입력이 남을 수 있습니다. V3의 추가 운영 안정화 후에만 legacy 제거 여부를 검토합니다.

## 검사

`npm.cmd run test:blog-body`
`node scripts/test-extension-offset.mjs`
`node scripts/test-extension-photo.mjs`
`node scripts/test-extension-temp-image.mjs`
`node scripts/test-extension-settings.mjs`
`node scripts/test-extension-api.mjs`
`node scripts/test-extension-blocks.mjs`

`npm.cmd run build:extension`

API 인증·signed URL 생성은 기존 방식이며 DB 상태를 변경하지 않습니다. Chrome 로그인·발행·예약은 사용자가 수행합니다. 디버깅 권한 안내가 표시될 수 있으며 DevTools/다른 debugger가 연결돼 있으면 강제로 해제하지 않습니다.

- 사진별 업로드 직후에는 삭제하지 않습니다. 전체 사진 처리/본문 검증 뒤 finally에서 모은 tempId들을 DELETE /api/extension/temp-image/<tempId>로 일괄 정리합니다. 실패한 ID만 즉시 시도 후 500ms, 1500ms, 3000ms 간격으로 재시도하며 성공한 ID는 큐에서 제거합니다. 서버는 client path를 받지 않고 UUID와 지원 확장자로 전용 temp 경로만 계산합니다. 파일이 없어도 성공합니다. 최종 cleanup 실패는 입력 완료 메시지에 PHOTO_TEMP_CLEANUP 경고로 표시하며 성공한 사진을 되돌리거나 다음 사진을 중단하지 않습니다. 브라우저/서버 강제 종료 때의 잔여 파일 자동 청소 작업은 추가하지 않았습니다. 모든 사진 후 본문 문자/순서를 한 번 검증합니다.

## 전환 이력 / 남은 작업

과거 Playwright publisher, /api/blog/publish, PublishingStatusControl, Naver live test script는 현재 main에 없습니다. 현재 방식은 Chrome Extension + CDP + content script입니다. Playwright 코드를 복원하거나 최종 발행을 자동 실행하지 않습니다.

V3 10장 실검증은 완료입니다. approved-only 정책은 목록/상세 API와 입력 전 재조회에 구현했습니다. Side Panel은 최신 선택 요청만 반영하며 taskId/draftId를 조회·실행 시 대조하고 실행 중 선택을 잠급니다. 선택 race 수정은 mock으로 검증했습니다. 향후 작업은 승인 후 편집의 재승인 정책, 업로드 완료/순서 검증 강화, 실행 snapshot/실패 이력, 중간 재개, signed URL 갱신, 비정상 종료 cleanup, 충분한 안정화 후 legacy 제거 검토입니다. 최종 발행/예약 자동화와 결과 기록은 별도 단계입니다.
