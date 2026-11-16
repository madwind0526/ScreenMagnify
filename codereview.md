# ScreenMagnify 코드 리뷰

- 리뷰 기준: 2026-11-17, 현재 디스크 소스 `ScreenMagnify 1.2.0`
- 대상: `electron/`, `public/`, `package.json`, `start.bat`, `stop.bat`
- 방법: 정적 분석, `npm run check`, 현재 `cpu-scaler.js` Node 벤치마크, AI worker 단독 추론, `v1.1.0..v1.2.0` diff 검토
- 한계: 리뷰 중 실제 앱 창은 띄우지 않았습니다. AI 품질/이음매/GPU DirectML 경로는 worker 단독 CPU 추론과 이전 실측 기록까지만 확인했습니다.

## 결론

구조는 전반적으로 좋습니다. AI를 `worker_threads`로 분리했고, 정지 이미지에서는 view당 AI를 한 번만 실행하며, crop과 CPU weights를 캐시하고, overlay redraw와 freeze 캡처도 이전 리뷰보다 개선됐습니다. v1.2.0의 타일 입력은 실제 worker에서 정상적으로 x4 출력을 만들었습니다.

가장 큰 위험은 **AI 최대 처리 크기의 기본값이 "선택영역"이고 출력은 입력의 x4 양변**이라는 점입니다. 1080p 선택만 해도 출력 RGBA가 약 127 MiB이고, 4K 선택은 약 506 MiB입니다. worker 버퍼, renderer 버퍼, GPU 텍스처가 겹치면 메모리 사용량이 매우 커지며, 기본값에서는 `aiTooBig`도 발생하지 않습니다.

다음으로 **표시 배율의 기준 DPR과 실제 backing DPR이 다를 때 배율 숫자와 줌 동작이 틀어지는 문제**가 있습니다. CPU 모드의 DPR 상한 1.25, GPU 모드의 상한 2.0과 `fitFactor()`의 raw `devicePixelRatio`가 맞지 않습니다. 그 외에는 AI timeout 후 worker 큐 적체, AI worker 종료 후 자동 복구 부재, GPU context loss 미처리, 넓은 fs IPC 노출이 주요 항목입니다.

## 우선순위

| 우선순위 | 항목 | 핵심 위치 | 영향 |
|---|---|---|---|
| P0 | AI 전체 선택 시 x4 출력 메모리/시간 폭증 | `electron/main.js:26`, `result.js:268-273`, `ai-worker.js:134-136` | 4K/8K 선택에서 수백 MiB~2 GiB 할당, 정지/OOM |
| P1 | CPU/고배율 DPR에서 표시 배율과 줌이 틀어짐 | `result.js:121-126`, `result.js:361-367` | 핵심 기능인 배율 숫자와 휠/버튼 줌이 실제와 불일치 |
| P1 | AI 60초 timeout 후 worker 추론이 계속되고 큐가 막힘 | `main.js:450`, `main.js:907-927`, `ai-worker.js:205-208` | timeout 이후 다음 AI 요청도 연쇄 timeout |
| P1 | AI worker 종료/오류 후 자동 복구 없음 | `result.js:835-860`, `result.js:882-889`, `result.js:1380-1397` | 배지 클릭 전까지 AI가 계속 Bilinear |
| P1 | GPU context loss 처리 없음 | `upscaler.js:389-451`, `result.js:593-620` | GPU reset/드라이버 복구 후 패널이 빈 화면으로 남음 |
| P2 | AI 타일 이음매는 overlap-add 없이 hard copy | `ai-worker.js:127-160` | 큰 이미지/큰 receptive field 모델에서 경계 아티팩트 가능 |
| P2 | 열린 결과 창에서 panelCount/method 변경 미반영 | `result.js:1360-1378` | 설정 변경이 현재 결과 창에는 적용되지 않음 |
| P2 | display id 조회 실패 시 첫 화면으로 fallback | `main.js:241-242`, `main.js:772` | 멀티모니터에서 잘못된 화면을 캡처할 수 있음 |
| P2 | NIS shader 실패 시 조용히 pass로 fallback | `upscaler.js:546-554` | UI에는 NIS, 실제로는 단순 통과 |
| P2 | `sandbox:false` + 넓은 fs IPC, CSP 없음 | `main.js:174,221,654,814`, `preload.js:36-44` | renderer compromise 시 파일 접근 범위가 넓음 |
| P2 | 설정 창이 화면 아래로 나갈 수 있음 | `main.js:200-205` | 작업 표시줄/화면 밖에 설정 창이 열릴 수 있음 |
| P2 | 결과 창 일부 UI가 직각 정책과 불일치 | `public/css/result.css:448,463,479,540,634` | 메인/설정과 결과 창의 시각적 일관성 저하 |
| P2 | 결과 창 rAF/AI timer 상시 실행 | `result.js:593-594`, `result.js:824-825` | 유휴 시 불필요한 60 Hz/10 Hz wakeup |
| P2 | `fs:listDir`가 전체 항목을 먼저 읽고 정렬 | `main.js:324-336` | 매우 큰 폴더에서 IPC/메모리 비용 |
| P2 | Windows 예약 파일명 미처리 | `main.js:363-389` | `CON.png` 등 저장 실패 가능 |
| P2 | `start.bat`/`stop.bat`는 dev `electron.exe` 전용 | `start.bat:6`, `stop.bat:6` | 패키지 앱은 자동 종료되지 않음 |

## P0-1. AI 전체 선택 시 x4 출력 메모리/시간 폭증

위치: `electron/main.js:26`, `public/js/result.js:268-273`, `public/js/result.js:863-880`, `electron/ai-worker.js:131-160`

- 기본 `aiMaxSize`는 `-1`이며 "선택영역 전체"입니다.
- `activeAiLimit()`은 `-1`일 때 `Math.max(video.videoWidth, video.videoHeight)`를 반환합니다.
- `aiTick()`의 `tooBig` 검사는 `Math.max(vis.w, vis.h) > activeAiLimit()`이므로 기본값에서는 사실상 항상 false입니다.
- `inferRgba()`는 입력 크기와 무관하게 `new Uint8ClampedArray(width * 4 * height * 4 * 4)`를 할당합니다.

출력 크기:

| 선택 영역 | AI 출력 | RGBA 크기 |
|---|---:|---:|
| 1920×1080 | 7680×4320 | 126.6 MiB |
| 2560×1440 | 10240×5760 | 225.0 MiB |
| 3840×2160 | 15360×8640 | 506.3 MiB |
| 7680×4320 | 30720×17280 | 1.98 GiB |

여기에 worker의 session/tile 버퍼, renderer로 transfer된 `Uint8ClampedArray`, GPU 모드의 `uploadAI()` 텍스처가 추가됩니다. `aiMaxSize=1536`도 정사각형이면 출력이 6144×6144로 약 144 MiB입니다. 즉 "AI 최대 처리 크기"는 입력 한 변만 제한하고 출력 바이트는 제한하지 않습니다.

재현:

1. 4K 모니터에서 화면 전체 또는 1920×1080 이상을 선택한다.
2. 기본 설정(`CPU`, `AI 최대 처리 크기 = 선택영역`, `Real-ESRGAN-x4v3`)으로 결과 창을 연다.
3. AI가 끝날 때까지 기다리거나 pan/zoom한다.

영향:

- CPU에서는 면적에 비례해 수십 초가 걸릴 수 있습니다.
- 4K/8K에서는 renderer/GPU 메모리가 급증하고, 창이 멈추거나 프로세스가 종료될 수 있습니다.
- `aiTooBig` 경고 없이 "AI 처리 중" 상태가 오래 지속됩니다.

권장:

1. 입력 한 변이 아니라 **출력 픽셀 수/바이트 상한**을 둡니다. 예: `outW * outH * 4 <= MAX_AI_OUTPUT_BYTES`.
2. `aiMaxSize=-1` 기본값을 유지하려면 상한 초과 시 AI를 건너뛰고 그 이유를 status/toast에 표시합니다.
3. 큰 영역은 tile 결과를 renderer로 점진적으로 보내 화면에 먼저 표시하고, 최종 합성은 마지막에 합니다.
4. CPU/GPU별 상한을 분리하고, GPU fallback으로 실제 CPU가 된 경우 CPU 상한을 적용합니다.
5. `aiMaxSize` UI에 "최대 입력 한 변"임을 명시하거나, 면적 기준 옵션으로 바꿉니다.

## P1-1. CPU/고배율 DPR에서 표시 배율과 줌이 틀어짐

위치: `public/js/result.js:121-126`, `public/js/result.js:243-251`, `public/js/result.js:361-374`, `public/js/result.js:518-543`

- `fitFactor()`는 `contentRectCss(panel).w * window.devicePixelRatio / base.w`를 사용합니다.
- `resizePanel()`은 실제 backing store를 `min(devicePixelRatio, useGpu() ? 2 : 1.25)`로 만듭니다.
- 따라서 CPU 모드에서 Windows 배율 200%면 실제 backing은 1.25인데 label 계산은 2.0을 사용합니다. 표시 배율은 약 1.6배 과대해집니다.
- GPU 모드에서 Windows 배율 300%면 실제는 2.0인데 label은 3.0을 사용합니다. 역시 1.5배 과대해집니다.
- `setZoom()`과 휠은 `magnification()`으로 목표 배율을 계산한 뒤 `fitFactor()`로 나누므로, label뿐 아니라 실제 줌 목표도 함께 틀어집니다.
- `resetView()`는 `zoom=1`로 맞추므로 리셋 직후 label이 실제 화면 배율과 다를 수 있습니다.

재현:

1. Windows 디스플레이 배율을 200%로 설정한다.
2. 설정에서 CPU를 선택한다.
3. 결과 창에서 배율 HUD를 확인하고 휠로 한 단계씩 줌한다.

권장:

1. `fitFactor()`를 `contentRectBacking(panel).w / base.w`로 바꿉니다. 이미 `contentRectBacking()`이 `result.js:188-190`에 있습니다.
2. `resizePanel()`과 `fitFactor()`가 같은 DPR 계산을 공유하도록 helper를 만듭니다.
3. device 전환 시 `resizePanel()` 후 `updateZoomUI()`가 반드시 실행되는지 확인합니다.
4. DPR 1.25/1.5/2.0/3.0, CPU/GPU 조합으로 label과 실제 픽셀 비율을 비교하는 테스트를 추가합니다.

## P1-2. AI 60초 timeout 후 worker 추론이 계속되고 큐가 막힘

위치: `electron/main.js:450`, `electron/main.js:907-927`, `electron/ai-worker.js:205-208`

- `ai:infer`는 `sendToAI(message, 60000, [data])`로 60초 제한을 둡니다.
- timeout 시 `aiPending`에서 요청만 제거하고 reject합니다.
- worker의 `queue = queue.then(...)`는 계속 실행 중인 `inferRgba()`를 취소하지 못합니다.
- 늦게 도착한 결과는 `aiPending`에 id가 없으므로 main에서 무시되지만, worker는 이미 다음 요청을 처리 중이거나 큐에 쌓인 상태입니다.
- 결과 창은 timeout 후 `aiBusy=false`가 되어 새 요청을 보낼 수 있고, 그 요청은 이전 추론 뒤에 줄을 서서 다시 60초 timeout이 될 수 있습니다.

재현:

1. CPU에서 큰 선택 영역 + 느린 AI 모델을 선택한다.
2. 60초 이상 기다린다.
3. pan/zoom으로 새 AI 요청을 발생시킨다.

권장:

1. worker protocol에 request id 기반 cancel을 추가하거나, timeout 시 worker를 종료하고 새로 만듭니다.
2. `aiBusy`를 timeout 시점에 해제하지 말고 worker가 실제 idle이 될 때까지 유지합니다.
3. 새 capture/새 view가 들어오면 이전 요청의 결과를 폐기하는 것과 별개로, 이전 작업도 취소합니다.
4. timeout 값을 모델/장치/영역 크기에 맞춰 조정하거나, timeout 후 "AI 중단" 상태를 명확히 표시합니다.

## P1-3. AI worker 종료/오류 후 자동 복구 없음

위치: `public/js/result.js:835-860`, `public/js/result.js:882-889`, `public/js/result.js:1380-1397`

- worker가 종료되면 main이 `provider: null`을 broadcast하고 result는 `aiReady=false`, `aiLoaded=null`로 만듭니다.
- 하지만 `aiTick()`은 `!aiReady`에서 즉시 return합니다.
- `ensureAI()`는 `aiLoaded !== model`일 때만 호출되지만, `aiTick()`이 그 지점에 도달하지 못합니다.
- 따라서 AI badge를 클릭해 device를 바꾸기 전까지 AI가 다시 로드되지 않습니다.
- `ensureAI()`의 catch는 이전 요청의 실패가 새 요청의 `aiLoaded`를 `null`로 덮어쓸 수 있는 race도 있습니다. (`if (aiLoaded !== key)` guard가 success에만 있고 catch에는 없음)

권장:

1. `aiTick()`에서 `!aiReady && !aiError`이면 `ensureAI()`를 호출한 뒤 return합니다.
2. worker exit/provider null 시 자동 1회 재시도와 backoff를 둡니다.
3. `ensureAI()` catch에서 `if (aiLoaded === key)`일 때만 상태를 초기화합니다.
4. 오류 상태에서도 badge 클릭 외에 "AI 다시 시도" 동작을 제공합니다.

## P1-4. GPU context loss 처리 없음

위치: `public/js/upscaler.js:389-451`, `public/js/result.js:593-620`

- `Upscaler`는 WebGL2 context를 만들고 shader/texture를 보관하지만 `webglcontextlost`/`webglcontextrestored`를 등록하지 않습니다.
- GPU reset, 드라이버 업데이트, 절전 복귀 후 context가 lost되면 `render()`의 key가 그대로라 다시 그리지 않고 빈 패널이 남을 수 있습니다.
- `todo.md`에도 "GPU 화면 내용 손실 복구" 항목이 미완료로 남아 있습니다.

권장:

1. `webglcontextlost`에서 `preventDefault()` 후 panel key를 무효화합니다.
2. `webglcontextrestored`에서 shader/texture를 다시 만들고 source/AI texture를 재업로드합니다.
3. 복구 실패 시 CPU 경로로 전환하거나 명확한 오류를 표시합니다.

## P2-1. AI 타일 이음매는 overlap-add 없이 hard copy

위치: `electron/ai-worker.js:127-160`

- `TILE_CORE=192`, `TILE_PAD=32` 문맥을 넣지만, 결과는 각 tile의 core만 hard copy합니다.
- 현재 `progress.md`에는 640×400 CPU에서 "이음매 단차 없음"으로 기록되어 있으나, 이번 리뷰에서는 300×200 합성 입력의 x4 출력 크기만 확인했고 고주파 경계/모델별 이음매를 재검증하지 않았습니다.
- 큰 receptive field 모델(x4plus)이나 32px보다 큰 문맥이 필요한 경계에서는 seam이 보일 수 있습니다.

권장:

1. pad를 늘리거나 tile 경계에 feathering/alpha blend를 적용합니다.
2. x4v3, Nomos, x4plus 각각 16:9/4:3/1:1 입력의 192px 경계에서 edge continuity를 비교합니다.
3. AI 타일 경계가 지나는 텍스트/직선 패턴을 포함한 회귀 이미지를 둡니다.

## P2-2. 열린 결과 창에서 panelCount/method 변경 미반영

위치: `public/js/result.js:409-455`, `public/js/result.js:1360-1378`

- `onSettingsChanged()`는 `aiDevice`, `aiMaxSize`, theme를 갱신합니다.
- `panelCount`가 바뀌어도 `setupPanels()`를 다시 호출하지 않습니다.
- `method`가 바뀌어도 현재 패널의 방법을 바꾸지 않습니다.

의도적으로 "다음 선택부터 적용"하는 것이라면 문서화가 필요하고, 실시간 반영이 의도라면 `prevPanelCount`/`prevMethod`를 비교해 `setupPanels()` 또는 `applyPanelMethod()`를 호출해야 합니다.

## P2-3. display id 조회 실패 시 첫 화면으로 fallback

위치: `electron/main.js:241-242`, `electron/main.js:765-775`, `public/js/result.js:696-719`

- `setupDisplayMediaHandler()`는 `pendingCaptureDisplayId`로 화면을 찾고, 실패하면 `sources[0]`을 사용합니다.
- `findScreenSource()`도 같은 fallback을 합니다.
- `openStream()`은 `getDisplayMedia()`를 먼저 사용하고 `sourceId` getUserMedia는 실패 시에만 사용합니다.
- 현재 Electron handler가 `pendingCaptureDisplayId`를 사용하므로 정상 경로는 올바르지만, display id가 비어 있거나 바뀐 경우 조용히 첫 화면을 캡처할 수 있습니다.

권장:

1. display id를 찾지 못하면 fallback하지 말고 사용자에게 "선택한 화면을 찾을 수 없습니다"를 표시합니다.
2. `result:init`에 sourceId와 display id를 함께 넘기고 capture 후 실제 display를 검증합니다.
3. 멀티모니터 테스트를 추가합니다.

## P2-4. NIS shader 실패 시 조용히 pass로 fallback

위치: `public/js/upscaler.js:533-555`

- NIS shader 생성이 실패하면 `createProgram(PASS_SOURCE)`로 대체하고 console.error만 남깁니다.
- panel label은 계속 NIS로 표시됩니다.
- GPU 기능이 없는 환경이나 shader compile 오류에서 사용자는 NIS 결과를 보고 있다고 오해합니다.

권장:

1. `getProgram()`이 fallback 여부를 반환하게 하고 result에 상태를 표시합니다.
2. NIS를 사용할 수 없으면 `methods.js`의 `gpuOnly` 처리처럼 disabled/fallback합니다.
3. shader compile 실패를 UI toast로 surface합니다.

## P2-5. 보안: sandbox 비활성, 넓은 fs IPC, CSP 없음

위치: `electron/main.js:174,221,654,814`, `electron/preload.js:36-44`, `electron/main.js:318-404`

- 모든 BrowserWindow가 `sandbox:false`이고 `contextIsolation:true`/`nodeIntegration:false`만 사용합니다.
- preload가 `fs.listDir`, `fs.mkdir`, `fs.savePng`, `shell.reveal`을 renderer에 노출합니다.
- `fs.listDir`는 임의 디렉터리를 읽을 수 있고, `shell.reveal`은 존재하는 경로를 연습니다.
- HTML에 CSP가 없습니다.

현재 로컬 파일만 로드하므로 원격 공격면은 작지만, renderer XSS/악성 이미지/잘못된 경로 처리와 결합하면 파일 시스템 접근으로 이어질 수 있습니다.

권장:

1. `fs:listDir`에 허용 root(사진/사용자 선택 폴더)를 두고 realpath containment를 검사합니다.
2. `shell:reveal`도 허용 경로만 엽니다.
3. CSP를 추가하고, `sandbox:true` 전환 가능성을 검토합니다.
4. IPC payload 크기 제한과 오류 메시지 정규화를 적용합니다.

## P2-6. 설정 창이 화면 아래로 나갈 수 있음

위치: `electron/main.js:195-205`

- 설정 창은 `mainWindow`의 `y + height + 8`에 바로 배치합니다.
- 메인 창이 화면 하단에 있으면 설정 창(높이 390)이 작업 영역 밖으로 나갑니다.
- 결과 창은 `main.js:784-793`에서 clamp하지만 설정 창은 clamp가 없습니다.

권장: `workArea` 기준으로 x/y를 clamp하고, 공간이 부족하면 메인 창 위/옆으로 flip합니다.

## P2-7. 결과 창 일부 UI가 직각 정책과 불일치

위치: `public/css/result.css:448,463,479,540,634`

- v1.2.0에서 메인/설정 UI는 `--radius: 0`으로 직각화했습니다.
- 결과 창의 `panel-head`, `index`, `panel-status`, `error-card`, `save-card`는 여전히 4~18px radius를 사용합니다.
- 사용자가 확인한 UI 취향(직각, 컴팩트)과 어긋납니다.

권장: 결과 창의 radius를 0으로 통일하거나, 결과 창만의 예외라면 `CLAUDE.md`에 명시합니다.

## P2-8. 결과 창 rAF/AI timer 상시 실행

위치: `public/js/result.js:593-594`, `public/js/result.js:824-825`

- `render()`는 함수 시작에서 항상 `requestAnimationFrame(render)`를 예약합니다.
- `lastKey` 덕분에 draw는 생략되지만, 매 프레임 `getView()`, key 문자열 생성, panel loop는 실행됩니다.
- `aiTimer`는 AI 패널이 없거나 창이 idle이어도 100ms마다 `aiTick()`을 호출합니다.
- result 창의 `backgroundThrottling:false`는 제거되어 숨김 시 throttle되지만, 보이는 idle 상태의 wakeup은 남습니다.

권장: `needsRender` dirty flag와 view 변경 시 1회 예약으로 바꾸고, AI timer는 AI가 활성일 때만 켭니다.

## P2-9. `fs:listDir`가 전체 항목을 먼저 읽고 정렬

위치: `electron/main.js:318-347`

- `readdir`로 모든 entry를 읽고 map/sort한 뒤 601개로 자릅니다.
- UI 표시 상한은 있지만, 매우 큰 폴더에서는 정렬/문자열 생성 비용이 먼저 발생합니다.
- 폴더 목록은 사용자 작업을 막지 않도록 pagination 또는 상한 후 정렬이 좋습니다.

## P2-10. Windows 예약 파일명 미처리

위치: `electron/main.js:363-389`

- 경로 구분자, trailing dot/space, `.png`은 정리합니다.
- `CON`, `PRN`, `AUX`, `NUL`, `COM1`~`COM9`, `LPT1`~`LPT9` 같은 Windows 예약 이름은 처리하지 않습니다.
- 사용자가 `CON`을 입력하면 저장이 실패할 수 있습니다.

권장: 예약 이름이면 suffix를 붙이거나 오류를 표시합니다.

## P2-11. `start.bat`/`stop.bat`는 dev `electron.exe` 전용

위치: `start.bat:6`, `stop.bat:6`

- `taskkill /IM electron.exe`와 window title filter를 사용합니다.
- 패키지 앱은 `ScreenMagnify.exe`이므로 이 스크립트로 종료되지 않습니다.
- `todo.md`에도 배포용 종료 스크립트가 미완료로 남아 있습니다.

## 성능

### CPU resampler

Node v24.14, 현재 `cpu-scaler.js`, 합성 RGBA 입력, canvas/compositing 제외, 4회 중 중앙값입니다.

| 변환 | Bilinear | Bicubic | Lanczos3 |
|---|---:|---:|---:|
| 1040×760 → 1040×760 | 17.8 ms | 25.5 ms | 33.1 ms |
| 1040×760 → 2080×1520 | 41.3 ms | - | 88.4 ms |

Nearest는 1040×760 → 1040×760에서 3.4 ms였습니다. CPU weights LRU 캐시와 scratch buffer 재사용으로 이전 리뷰보다 Bilinear가 24.2 ms → 17.8 ms로 개선됐습니다. 다만 CPU 모드에서 Lanczos3 3패널은 1x에서도 약 99 ms, 2x에서는 약 265 ms가 순수 resample에 필요합니다. DPR 상한 1.25 덕분에 실제 backing은 줄지만, 60fps 예산에는 여전히 부족합니다.

### AI worker

현재 `ai-worker.js`를 `onnxruntime-node` CPU로 단독 실행했습니다.

| 입력 | 출력 | 시간 |
|---|---:|---:|
| 64×48 | 256×192 | 22 ms |
| 200×150 | 800×600 | 243 ms |
| 300×200 (tile 4개) | 1200×800 | 843 ms |

타일 경로는 정상적으로 x4 출력을 만들고, 출력 버퍼 크기도 예상과 일치했습니다. 이 수치는 worker 단독이며 renderer 전송/GPU 업로드/compositing은 제외입니다. 큰 선택 영역의 실제 시간과 메모리는 P0-1의 상한이 필요합니다.

## v1.2.0 변경 검증

- `v1.1.0..v1.2.0` diff에서 AI 원본 해상도 tile 처리, `aiMaxSize`, `BUCKETS`, x4plus GPU 전용, 직각 UI, HUD 배경이 추가된 것을 확인했습니다.
- `npm run check`는 `14/14 files OK`로 통과했습니다.
- `fs:savePng`의 `..`/경로 구분자 traversal은 현재 정규화로 완화됐습니다. (`main.js:366-380`)
- `fs:mkdir`은 경로 구분자와 Windows 금지 문자를 거부합니다. (`main.js:349-360`)
- `fs:listDir`는 601개로 제한됩니다. (`main.js:324-336`)
- freeze 캡처는 display별 중복 `getSources()` 호출 대신 한 번의 source 조회로 바뀌었습니다.
- result 캡처는 `frameRate` 5로 낮아졌고, overlay pointermove는 rAF로 합쳐졌습니다.
- CPU resampler는 weights LRU와 scratch buffer를 재사용하며 CPU DPR 상한 1.25를 적용합니다.
- `backgroundThrottling:false`는 result 창에서 제거됐습니다.

## 이전 리뷰 항목 처리

| 이전 항목 | 현재 상태 | 비고 |
|---|---|---|
| 비정사각 AI 입력 stretch | 수정 | v1.2.0 tile 입력으로 대체. 단, tile seam 검증은 별도 |
| AI 오류 후 재시도 | 부분 | badge 클릭으로만 복구. worker exit 자동 복구는 없음 |
| 저장 파일명 `..` | 수정 | path 정규화 확인 |
| 넓은 fs API / CSP | 미수정 | P2-5로 유지 |
| 기본 CPU + renderer 결합 | 의도된 설계 | 사용자 요청. 대신 DPR/배율 정확성 문제가 남음 |
| CPU resampler weights/버퍼 | 부분 수정 | weight cache/scratch 적용, 출력 버퍼는 매번 할당 |
| 숨김 창 rAF | 부분 수정 | `backgroundThrottling:false` 제거, dirty render는 미적용 |
| overlay 전체 재드로우 | 부분 수정 | rAF coalescing 적용, dim canvas 구조는 유지 |
| freeze 중복 캡처 | 수정 | source 조회 1회 |
| 30fps 전체 화면 스트림 | 수정 | frameRate 5 |
| WebGL 공유 / NIS 1x 우회 | 보류 | 구조 변경 필요 |
| `drawCpu` context 캐시 | 수정 | panel별 context 저장 |
| NIS shader fallback 표시 | 미수정 | P2-4 |
| settings 창 위치 clamp | 미수정 | P2-6 |

## 권장 실행 순서

1. AI 출력 픽셀/바이트 상한을 추가하고 기본 `aiMaxSize` 정책을 재검토한다. (P0-1)
2. `fitFactor()`를 `contentRectBacking()` 기준으로 바꾸고 DPR 조합을 검증한다. (P1-1)
3. AI timeout 시 worker 취소/재생성과 `aiBusy` 상태를 정리한다. (P1-2)
4. AI worker exit 자동 복구와 ensureAI race를 수정한다. (P1-3)
5. GPU context loss/restored 처리를 추가한다. (P1-4)
6. tile seam, display fallback, NIS fallback, 설정 창 clamp, UI radius를 정리한다. (P2)
7. CSP/fs IPC 최소화와 저장 예약 이름 처리를 검토한다. (P2)

## 검증 메모

- `npm run check` 통과: `14/14 files OK`
- CPU benchmark: Node v24.14.0, `public/js/cpu-scaler.js`, 합성 RGBA, 4회 중앙값
- AI worker: Node worker 단독, `provider=cpu`, `realesrgan`, 64×48/200×150/300×200
- 실제 앱에서 확인하지 못한 항목: 4K/8K OOM, 60초 timeout 후 큐 적체, GPU DirectML x4plus, tile seam, GPU context loss, 멀티모니터 capture, 설정 창 off-screen
- 후속 자동화 후보: DPR별 `fitFactor` 검증, AI 출력 바이트 상한, worker timeout 취소, 멀티모니터 source 선택, GPU context loss 시나리오

## 처리 결과 (2026-11-17)

실제 창으로 확인한 항목은 "확인" 열에 적었습니다. 확인 스크립트는 임시 프로필에서 실제 `main.js`와 결과 창을 띄워 실행했습니다.

| 항목 | 처리 | 내용 | 확인 |
|---|---|---|---|
| P0-1 AI 출력 메모리 | 수정 | 입력 면적 상한 250만 화소 (`SM.AI_MAX_PIXELS`, 출력 약 150 MiB). 넘으면 Bilinear로 보여 주고 상태에 이유 표시. 메인 프로세스(`AI_MAX_INPUT_PIXELS`)도 같은 상한으로 거부 | 300만 화소 입력이 거부됨 |
| P1-1 표시 배율과 DPR | **오탐, 수정 없음** | 배율은 화면에 보이는 물리 픽셀 기준이라 CSS 너비 x 실제 DPR이 맞습니다. DPR 상한(1.25 / 2.0)은 캔버스의 내부 해상도만 줄이고, 브라우저가 CSS 크기로 늘려 그립니다. 보이는 크기와 확대 범위는 DPR 상한과 무관합니다. `contentRectBacking`으로 바꾸면 오히려 CPU 모드에서 배율이 실제보다 작게 표시됩니다 | 코드 검토 |
| P1-2 timeout 후 worker 적체 | 수정 | timeout 때 worker를 종료합니다. 종료 이벤트로 결과 창이 모델을 다시 불러옵니다 | 종료 이벤트 경로만 확인 (60초 대기는 재현 안 함) |
| P1-3 worker 종료 후 복구 | 수정 | `aiTick`이 `aiReady` 검사보다 먼저 모델 로드를 확인합니다. `ensureAI` 실패 처리는 최신 요청일 때만 상태를 바꿉니다 | 종료 이벤트 후 배지가 "AI 준비 중" → "AI · GPU"로 돌아옴 |
| P1-4 GPU context loss | 수정 | `webglcontextlost`/`restored` 처리. 복구 때 셰이더, 텍스처, AI 프레임을 다시 만들고 다시 그립니다 | 손실 후 복구, 패널 내용이 손실 전과 같음 |
| P2-4 NIS 셰이더 실패 | 수정 | 실패하면 토스트로 알립니다 | 코드 검토 |
| P2-6 설정 창 위치 | 수정 | 작업 영역 아래로 나가면 메인 창 위에 열고, x도 화면 안으로 제한합니다 | 코드 검토 |
| P2-10 예약 파일명 | 수정 | `CON`, `NUL`, `COM1` 등은 `_`를 붙입니다 | 코드 검토 |
| P2-1 타일 이음매 | 보류 | 모델별 경계 비교가 필요합니다 | - |
| P2-2 열린 결과 창의 설정 변경 | 보류 | 의도 확인이 필요합니다 (다음 선택부터 적용인지) | - |
| P2-3 display fallback | 보류 | 멀티모니터 실기 확인이 필요합니다 | - |
| P2-5 보안 (fs IPC, CSP) | 보류 | 저장 창이 임의 폴더를 탐색하는 기능과 충돌합니다 | - |
| P2-7 결과 창 직각 | 보류 | 디자인 결정입니다 | - |
| P2-8 렌더 루프 / P2-9 listDir / P2-11 stop.bat | 보류 | 효과가 작거나 별도 작업입니다 | - |
