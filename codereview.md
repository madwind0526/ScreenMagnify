# ScreenMagnify 코드 리뷰

- 리뷰 기준: 2026-11-14, 현재 디스크 소스
- 대상: `electron/`, `public/`, `package.json`, `start.bat`, `stop.bat`
- 방법: 정적 분석 + 현재 `cpu-scaler.js` Node 벤치마크 + 기존 CDP 실측 기록
- 이번 리뷰 중 앱은 실행하지 않았습니다. AI 관련 실측은 이전 빌드 기록이며, 현재 소스에서 재검증이 필요합니다.

## 결론

기능 구조는 잘 갖춰져 있고, 특히 AI 추론을 worker로 분리한 점, 정지 이미지에서 AI를 view당 1회만 실행하는 점, crop 데이터를 캐시하는 점은 좋습니다.

성능상 가장 큰 문제는 **기본 설정이 CPU 연산이고, 이 설정이 AI 장치와 WebGL 렌더러를 동시에 제어한다는 점**입니다. 기본값 그대로 3패널을 사용하면 pan/zoom 중 프레임당 수십~수백 ms가 소요되어 60fps는 사실상 불가능합니다. 다음으로 selection overlay의 전체 화면 재드로우, result의 상시 rAF, freeze 캡처 비용이 큽니다.

기능상 가장 위험한 항목은 **비정사각형 AI 입력을 정사각형으로 늘린 뒤 일부만 잘라 표시하는 문제**입니다. 이전에 관찰된 AI 패널의 어두운/잘못된 출력과 일치하는 방향입니다.

## 성능 우선순위

| 우선순위 | 항목 | 핵심 위치 | 기대 효과 |
|---|---|---|---|
| P0 | 기본 CPU 모드 + AI 장치와 렌더러 결합 | `main.js:16-27`, `result.js:85-99`, `settings.html:24` | 기본 경로를 GPU로 돌려 pan/zoom 체감 속도 대폭 개선 |
| P0 | CPU resampler가 매 프레임 weights/대형 버퍼 재생성 | `cpu-scaler.js:21-48`, `cpu-scaler.js:68-123`, `result.js:349-351` | CPU 모드의 프레임 시간과 GC 압력 감소 |
| P0 | result가 항상 rAF 실행 + 숨김 창에서도 계속 실행 | `result.js:576-602`, `main.js:800` | idle CPU/GPU 사용량 감소, 배터리/발열 개선 |
| P1 | selection overlay가 pointermove마다 전체 화면 재드로우 | `overlay.js:107-120`, `overlay.js:168-184`, `overlay.js:205-218` | 고해상도/고주기 마우스에서 선택 끊김 제거 |
| P1 | freeze 캡처가 display마다 전체 화면을 다시 캡처 | `main.js:568-593` | 멀티모니터/4K에서 선택 시작 지연과 메모리 감소 |
| P1 | 정지 캡처에 30fps 전체 화면 스트림 사용 | `result.js:678-702`, `result.js:738-742` | 선택 후 결과 표시 지연 감소 |
| P1 | 패널별 WebGL 컨텍스트/텍스처 업로드 중복 | `result.js:593-595`, `upscaler.js:566-580`, `upscaler.js:617-665` | 3패널/고해상도에서 GPU 업로드 비용 감소 |
| P2 | NIS가 1x 근처에서도 36탭 edge 연산 수행 | `upscaler.js:281-326` | 불필요한 고비용 shader 실행 방지 |
| P2 | save preview/폴더 목록/설정 저장의 동기 작업 | `result.js:957-977`, `main.js:310-334`, `main.js:111-119` | 모달 열기/큰 폴더에서 UI 멈춤 감소 |

## CPU resampler 측정

Node v24.14에서 현재 `public/js/cpu-scaler.js`를 그대로 로드해 합성 RGBA 이미지를 변환했습니다. canvas `putImageData`, 브라우저 compositing, 패널 3개 합산은 제외한 순수 resample 시간입니다.

| 변환 | Bilinear | Bicubic | Lanczos3 |
|---|---:|---:|---:|
| 1040×760 → 1040×760 (DPR 1x) | 24.2 ms | 28.0 ms | 36.2 ms |
| 1040×760 → 2080×1520 (DPR 2x) | 46.2 ms | - | 96.6 ms |

참고: nearest는 1040×760 → 1040×760에서 약 5.4ms였습니다.

60fps 예산은 16.7ms입니다. CPU 모드에서 Lanczos3 1패널만으로도 예산을 초과하며, DPR 2x에서는 1패널이 96.6ms입니다. 3패널이면 단순 합산으로 1x 약 73~109ms, 2x 약 139~290ms 수준입니다. 실제로는 canvas clear/putImageData와 브라우저 작업이 추가됩니다.

## 상세 성능 이슈

### P0-1. CPU 기본값이 모든 패널의 WebGL을 끈다

- `electron/main.js:20`의 기본값이 `aiDevice: 'cpu'`입니다.
- `public/js/result.js:85-99`의 `useGpu()`는 `settings.aiDevice === 'gpu'`일 때만 true이고, `applyPanelDevice()`는 이 값으로 GPU/CPU canvas를 전환합니다.
- 따라서 사용자가 AI만 CPU로 두려 해도 Bilinear/Lanczos3/NIS까지 전부 JS resampler로 실행됩니다.
- `settings.html:24`의 "연산 장치" 라벨도 실제로는 renderer와 AI를 동시에 바꾸므로 의미가 모호합니다.
- `methods.js:47`은 Real-ESRGAN을 "CPU AI"로 설명하지만 실제로는 DML GPU 경로가 있습니다.

권장:

1. `renderDevice`와 `aiDevice`를 분리합니다. non-AI 보간은 GPU 가능 시 항상 WebGL을 사용합니다.
2. 새 설치 기본값은 GPU로 두고, WebGL2 초기화 실패 시에만 CPU로 fallback합니다.
3. GPU가 없는 환경에서만 CPU를 기본으로 선택합니다.
4. CPU 모드를 유지해야 한다면 DPR을 1.0~1.25로 제한하고, CPU 모드 선택 시 경고를 표시합니다.

### P0-2. CPU resampler가 매 호출마다 weights와 대형 버퍼를 새로 만든다

- `public/js/cpu-scaler.js:21-48`에서 `buildWeights()`를 매 호출마다 실행합니다.
- `public/js/cpu-scaler.js:74`의 `tmp`는 `dw * sh * 4` Float32Array입니다. DPR 2x의 2080×1520 패널이면 약 50MB입니다.
- `cpu-scaler.js:98`의 출력 버퍼도 매 호출마다 새로 할당합니다.
- `result.js:607-623`은 crop ImageData는 캐시하지만 resample weights와 scratch buffer는 캐시하지 않습니다.
- `result.js:349-351`은 DPR을 그대로 backing store 크기에 반영합니다. 200% Windows 배율에서 픽셀 수가 4배가 됩니다.

권장:

1. `buildWeights()` 결과를 `(sw, sh, dw, dh, method)` 키로 LRU 캐시합니다. pan은 view 크기를 바꾸지 않으므로 같은 weights를 재사용할 수 있습니다.
2. `tmp`와 출력 버퍼를 panel별 scratch buffer로 재사용합니다.
3. CPU 모드에서는 `devicePixelRatio`를 1.0~1.25로 cap합니다. 특히 4K/200% 환경에서 효과가 큽니다.
4. CPU 경로를 OffscreenCanvas worker로 옮길 수 있는지 검토합니다. 최소한 drag 중에는 저해상도 preview를 그리고 drag 종료 후 고품질 결과를 그리는 방식이 좋습니다.

### P0-3. result가 변경이 없어도 매 프레임 render를 예약한다

- `public/js/result.js:576-602`는 `requestAnimationFrame(render)`를 함수 시작에서 항상 다시 예약합니다.
- `panel.lastKey` 비교로 실제 draw는 생략하지만, 60fps로 `getView()`, `prepareCrop()`, key 문자열 생성, panel loop가 계속 실행됩니다.
- `electron/main.js:800`의 result 창은 `backgroundThrottling: false`라서 창이 가려지거나 최소화되어도 이 루프가 계속될 수 있습니다.
- `result.js:801-803`의 `setInterval(aiTick, 100)`도 AI 패널이 없거나 창이 숨겨진 상태에서도 계속 깨어납니다.

권장:

1. `needsRender` dirty flag를 두고, view/method/device/AI data/resize가 바뀔 때만 `requestAnimationFrame(renderOnce)`를 예약합니다.
2. `document.hidden` 또는 `visibilitychange`에서 루프를 중지합니다.
3. AI tick은 상시 interval 대신 view 변경 후 한 번, 또는 AI가 실제로 활성일 때만 timer로 예약합니다.
4. result 창의 `backgroundThrottling:false`를 제거하거나, AI 장시간 추론이 백그라운드 throttle에 영향을 받지 않는 구조로 바꿉니다.

### P1-1. overlay가 pointermove마다 전체 화면을 다시 그린다

- `public/js/overlay.js:205-218`은 pointermove마다 `draw()`를 직접 호출합니다.
- `overlay.js:168-184`의 `draw()`는 전체 `stage`를 clear하고, freeze 이미지를 그리고, `dimCanvas` 전체를 다시 그린 뒤 stage에 복사합니다.
- `overlay.js:107-120`의 `drawDim()`은 매번 전체 화면 clear + 전체 fill + `destination-out` cutout을 수행합니다.
- `overlay.js:149-166`의 outline은 shadowBlur를 사용합니다.
- rAF coalescing이 없어 1000Hz 마우스에서는 이벤트 빈도만큼 전체 화면 작업이 발생할 수 있습니다.

권장:

1. pointermove에서는 좌표만 갱신하고 `requestAnimationFrame`에서 한 번만 그립니다.
2. freeze 이미지는 최초 1회 별도 canvas에 그려두고, 선택 영역은 CSS `box-shadow: 0 0 0 9999px rgba(0,0,0,.56)` 또는 SVG/clip-path로 처리합니다.
3. 전체 화면 dim canvas 대신 selection 요소만 갱신하거나, 이전/새 영역만 clear/redraw합니다.
4. 고해상도 freehand는 path를 매번 전체 재구성하지 말고 point 추가분만 이어 그리는 방식이 좋습니다.

### P1-2. freeze 캡처가 display 수만큼 전체 화면을 중복 캡처한다

- `electron/main.js:568-593`은 `screen.getAllDisplays()`를 돌면서 각 display마다 `desktopCapturer.getSources()`를 호출합니다.
- 이 호출은 매번 **모든 화면 소스**를 요청하고, 각 소스에 대해 해당 display의 전체 물리 해상도 thumbnail을 생성합니다.
- 모니터 2대면 2번 호출 × 2개 소스 = 4개의 전체 화면 캡처가 됩니다. 4K 2대면 매우 큰 비용입니다.
- 결과를 JPEG 92 base64 문자열로 만들어 IPC로 overlay에 전달하므로 메모리와 복사 비용도 큽니다.

권장:

1. `desktopCapturer.getSources()`를 한 번만 호출하고, 모든 display 중 가장 큰 thumbnail 크기를 사용한 뒤 display별로 resize합니다.
2. freeze는 기본적으로 현재 커서가 있는 display만 캡처하고, 필요할 때만 전체 display를 캡처합니다.
3. preview용 freeze는 낮은 해상도/품질로 만들고, 실제 결과 캡처는 별도 고품질 경로를 유지합니다.
4. `freeze`가 꺼져 있을 때 이 경로를 완전히 건너뛰는지 확인합니다. 현재 기본값은 `true`입니다.

### P1-3. 결과 캡처가 한 프레임 때문에 30fps 전체 화면 스트림을 시작한다

- `public/js/result.js:678-702`의 `getDisplayMedia()`가 `frameRate: { ideal: 30, max: 30 }`으로 전체 화면 스트림을 엽니다.
- `result.js:738-742`는 `requestVideoFrameCallback`을 기다리지만, fallback `setTimeout(resolve, 1500)`을 취소하지 않습니다.
- 한 장만 필요한데 30fps 스트림을 생성/중지하므로 시작 지연과 GPU 자원 사용이 큽니다.

권장:

1. `frameRate`를 1~5로 낮춥니다.
2. freeze가 켜져 있으면 이미 캡처한 화면을 재사용할 수 있는지 검토합니다. 단, freeze JPEG 품질이 결과 품질에 영향을 주므로 lossless 경로 또는 별도 캡처와 비교해야 합니다.
3. `requestVideoFrameCallback`과 timeout을 race시키고, 성공 시 timeout을 clear합니다.
4. 결과 창을 먼저 표시하고 캡처 준비 상태를 보여주는 방식으로 체감 지연을 줄일 수 있습니다.

### P1-4. GPU 경로가 패널마다 같은 crop을 다시 업로드한다

- `public/js/result.js:593-595`에서 각 panel이 자기 `Upscaler.drawCrop(crop, viewRect)`를 호출합니다.
- `upscaler.js:566-580`은 각 panel의 WebGL 컨텍스트에 crop canvas를 업로드합니다.
- `upscaler.js:392-400`은 panel마다 WebGL2 context를 만들고 `preserveDrawingBuffer: true`를 사용합니다.
- `upscaler.js:533-555`는 panel마다 shader program을 별도로 컴파일합니다.

권장:

1. 가능하면 하나의 WebGL context + 하나의 source texture를 공유하고, panel별 viewport/scissor로 렌더링합니다.
2. 최소한 crop이 바뀔 때만 texture를 갱신하고, 동일 crop을 3패널이 공유할 수 있는 구조를 검토합니다.
3. `preserveDrawingBuffer`는 저장 직전에 명시적으로 다시 그리는 구조로 바꾸고 false를 검토합니다.
4. DPR을 2.0으로 cap합니다. 3패널 4K/200%에서는 1.5도 충분할 수 있습니다.
5. NIS는 `zoom`이 1x 근처거나 실제 출력 배율이 1.0에 가까울 때 pass/bilinear로 우회합니다. 현재는 `upscaler.js:281-326`의 36탭 edge 연산이 1x에서도 실행됩니다.

### P2. 기타 성능 개선

- `result.js:957-977`: save modal preview에서 전체 크기 `composePanel()` 후 208px PNG `toDataURL()`을 수행합니다. 기존 panel canvas를 직접 축소하거나 `toBlob`/`createImageBitmap`을 사용하면 모달 열기 지연을 줄일 수 있습니다.
- `main.js:310-334`: `fs:listDir`가 폴더의 모든 entry를 읽고 정렬한 뒤 IPC로 전송합니다. UI는 `result.js:1033`에서 600개만 표시하므로, 정렬/전송 전에 cap하거나 pagination을 적용합니다.
- `main.js:111-119`, `main.js:250-267`: shape/theme 변경마다 settings.json을 동기 write하고 모든 창에 broadcast합니다. 빈도는 낮지만 debounce가 가능합니다.
- `main.js:814`: `openResult()`가 `findScreenSource()`를 await한 뒤 result를 load합니다. `loadFile`을 먼저 시작하고 source 조회를 병렬화하면 결과 창 표시가 빨라집니다.
- `main.js:368-371`: 중복 파일 검사가 `fs.existsSync()` 동기 루프입니다. 저장 빈도는 낮지만 `fs.promises.access` 또는 단일 scan으로 바꿀 수 있습니다.
- `result.js:618`: `drawCpu`가 매 draw마다 `getContext('2d', ...)`를 호출합니다. context를 panel 생성 시 한 번만 얻어 저장합니다.
- `result.js:590`: 매 프레임 긴 key 문자열을 생성합니다. dirty flag로 대체하면 GC와 문자열 비용이 줄어듭니다.

## 기능/정확성 이슈

### F-01 높음: 비정사각형 AI 입력이 늘어난 뒤 일부만 잘린다

위치: `electron/ai-worker.js:83-105`, `electron/ai-worker.js:116-134`

현재 로직은 다음과 같습니다.

1. 원본 crop의 최대 변을 256 이하로 줄입니다.
2. `bucketFor()`로 정사각형 bucket을 고릅니다.
3. 입력을 `size × size`로 **stretch**합니다. 종횡비를 유지하지 않습니다.
4. 출력에서 `outW = inW * 4`, `outHeight = inH * 4`만큼만 **좌상단에서** 복사합니다.

예: 1040×760 crop이면 `inW=256`, `inH=187`, 출력은 1024×748이고, 1024×1024 AI 결과의 상단 748행만 사용됩니다. 원본의 아래쪽 일부가 잘리고, 늘어난 이미지의 일부만 표시됩니다. 결과가 어둡거나 일부만 보이는 현상과 일치합니다.

권장:

1. 정사각형 입력이 필요하면 **stretch 대신 letterbox padding**을 사용합니다.
2. padding offset을 기억하고 출력에서 원본 영역에 해당하는 부분만 crop합니다.
3. 또는 모델 출력 전체(1024×1024)를 받아 원본 aspect로 명시적으로 resize합니다. 품질을 위해 padding + crop이 우선입니다.
4. 수정 후 16:9, 4:3, 1:1, 세로 crop으로 AI 출력 평균/경계를 비교합니다.

### F-02 중간: AI 오류 후 자동 재시도가 없다

위치: `public/js/result.js:812-837`, `public/js/result.js:1340-1355`

- `ensureAI()`는 `aiError`가 있으면 즉시 return합니다.
- 실패 시 `aiLoaded`를 그대로 두므로 모델을 다시 로드하지 않습니다.
- worker exit 이벤트는 `aiReady=false`로만 만들고 `aiError`/`aiLoaded`를 초기화하지 않습니다.
- 결과 창을 닫았다 다시 열기 전까지 AI 복구가 어렵습니다.

권장: 오류/worker exit 시 `aiLoaded=null`, `aiError`를 정리하고, 사용자가 재시도할 수 있는 버튼 또는 자동 1회 재시도를 추가합니다.

### F-03 중간: 저장 파일명 정규화가 `..`를 허용한다

위치: `electron/main.js:354-372`

`name`에 `.png`를 붙인 뒤 다시 `.png`를 제거해 `path.join()`하는 구조라, `name='..'` 또는 `name='...png'` 같은 값이 선택 폴더의 부모를 가리킬 수 있습니다. 예를 들어 `dir='C:\Users\me\Pictures'`, `name='..'`이면 base가 `C:\Users\me`가 되어 `C:\Users\me.png`에 쓰려고 합니다. 임의의 깊은 경로 탈출은 아니지만, 선택한 폴더 밖으로 나가는 것은 의도와 다릅니다.

권장:

1. `path.basename(name) === name`을 검증합니다.
2. 정규화 결과가 `.` 또는 `..`인 이름을 거부합니다.
3. 가능하면 `fs.open` 시 선택한 dir 기준으로 realpath containment를 검사합니다.
4. 중복 파일 검사도 같은 정규화 결과를 사용합니다.

### F-04 중간: renderer에 넓은 fs API가 노출되어 있다

위치: `electron/preload.js:36-44`, `electron/main.js:163-168`

- `listDir`, `mkdir`, `savePng`, `shell.reveal`이 renderer에 그대로 노출됩니다.
- `sandbox:false`이고 preload가 Node 권한을 가집니다.
- 현재는 로컬 파일만 로드하므로 원격 공격면은 작지만, 렌더러 XSS/악성 데이터가 생기면 파일 시스템 접근으로 이어질 수 있습니다.

권장: 가능한 API를 최소화하고, `dir` allowlist/realpath 검증, 입력 크기 제한, CSP 추가를 검토합니다. `nodeIntegration:false`와 `contextIsolation:true`는 유지합니다.

### F-05 낮음: AI 설명과 실제 동작 불일치

- `public/js/methods.js:47`은 Real-ESRGAN을 CPU 전용처럼 설명합니다.
- 현재 worker는 `dml` GPU를 우선 시도하고 CPU로 fallback합니다. (`ai-worker.js:53-69`)
- 설정 라벨 "연산 장치"도 renderer와 AI를 동시에 바꿉니다.

문서/UI 문구를 실제 동작과 맞추거나, P0-1처럼 설정을 분리해야 합니다.

### F-06 낮음: `openResult` source 조회가 창 로드 앞에서 직렬 실행된다

위치: `electron/main.js:814-827`

`findScreenSource()`가 끝난 뒤 `loadFile()`을 호출합니다. source 조회는 `desktopCapturer` 호출이라 수십~수백 ms가 걸릴 수 있습니다. `loadFile`을 먼저 시작하고 source 결과를 init payload에 합치는 방식으로 결과 표시를 앞당길 수 있습니다.

## 안정성/유지보수

- `public/js/result.js:249-256`의 `applyMask()`는 `clipPath='none'`만 수행하는 사실상 no-op입니다. shape masking이 capture 단계에서 끝났다면 함수와 호출을 제거하거나, 실제 mask 책임 위치를 명확히 해야 합니다.
- AI provider 이벤트는 모든 창에 broadcast되지만 main/settings는 수신하지 않습니다. 불필요한 IPC를 줄이려면 result 창에만 보내는 편이 좋습니다.
- `aiBadge` 클릭은 새 device를 낙관적으로 표시한 뒤 IPC를 보냅니다. 실제 전환 실패 시 표시가 잠시 틀릴 수 있으므로 결과 이벤트 기준으로만 갱신하는 편이 안전합니다.
- `package.json`에 test/lint script가 없습니다. 최소한 `node --check`와 CPU resampler benchmark를 CI 또는 로컬 script로 추가하는 것을 권장합니다.
- `start.bat`/`stop.bat`은 dev `electron.exe`와 window title 기반이라 패키징된 `ScreenMagnify.exe`에는 적용되지 않습니다. 배포용 종료 스크립트는 별도로 두는 것이 좋습니다.

## 긍정적인 부분

- AI 추론을 `worker_threads`로 분리해 renderer main thread를 막지 않습니다.
- 정지 이미지에서는 view당 AI를 1회만 실행하도록 바뀌어 연속 추론 비용이 제거되었습니다. (`result.js:867-874`)
- `cropData()`가 crop ImageData를 캐시합니다. (`result.js:607-615`)
- `render()`가 `lastKey`로 동일 상태 draw를 생략합니다. (`result.js:589-592`)
- AI 입력 crop을 최대 256으로 제한해 추론 비용을 상한화했습니다.
- `contextIsolation:true`, `nodeIntegration:false`를 사용합니다.
- AI 모델 세션을 device/model 변경 시에만 재생성합니다. (`ai-worker.js:36-76`)

## 권장 실행 순서

1. `renderDevice`와 `aiDevice`를 분리하고 GPU 기본값/fallback을 도입합니다.
2. CPU resampler에 weight cache + scratch buffer + DPR cap을 적용합니다.
3. result를 dirty-driven rendering으로 바꾸고 hidden 상태에서 rAF/AI interval을 멈춥니다.
4. overlay를 rAF coalescing + CSS/SVG dim으로 바꿉니다.
5. freeze/result 캡처를 1회 캡처 또는 저프레임 경로로 최적화합니다.
6. AI worker의 비정사각 aspect/padding/crop을 수정하고 16:9/4:3/1:1로 검증합니다.
7. 3패널 WebGL texture 공유, NIS 1x bypass, save preview 최적화를 검토합니다.
8. 파일명 정규화, AI 재시도, CSP/fs API 최소화를 정리합니다.

## 검증 메모

- `node --check`는 현재 `electron/*.js`, `public/js/*.js` 전체 통과했습니다.
- CPU 벤치마크는 Node v24.14, 합성 RGBA 입력, canvas/브라우저 compositing 제외입니다. 실제 Electron 수치는 더 높을 수 있습니다.
- 성능 개선 후에는 1패널/3패널, DPR 1.0/1.5/2.0, 1920×1080/3840×2160, CPU/GPU 조합으로 아래를 측정하는 것을 권장합니다.
  - selection 시작부터 overlay 표시까지
  - 결과 창 표시까지
  - pan/zoom 중 프레임 시간과 dropped frame
  - idle 10초 CPU/GPU 사용률
  - AI 1회 추론 시간과 출력 평균/기하 왜곡

## 처리 결과 (2026-11-14)

| 항목 | 상태 | 비고 |
|---|---|---|
| F-01 비정사각 AI 입력 | **수정 불필요** | 렌더러가 이미 입력을 256 이하로 줄여 보내고, worker의 `x*width/inW`는 항등 매핑이라 stretch가 아니라 우하단 edge 복제 패딩입니다. 출력은 좌상단 `inW*4 × inH*4`만 사용하므로 올바릅니다. 200×100, 100×200, 256×144 입력에 가로(R)/세로(G) 그라데이션을 넣어 출력의 네 모서리 값이 0~255 전 범위로 나오는 것을 확인했습니다. |
| F-02 AI 재시도 | 수정 | 로드 실패·worker 종료 시 `aiLoaded`를 비워 다시 로드할 수 있게 했습니다. 배지 클릭(장치 전환)이 오류를 해제하고 재시도합니다. |
| F-03 파일명 `..` | 수정 | 정규화 후 `.png` 제거, 끝의 점/공백 제거, 빈 이름 거부. `..`, `...png` → 거부. |
| F-05 AI 설명 | 수정 | Real-ESRGAN 설명을 GPU/CPU 모두 맞게 고쳤습니다. |
| P0-1 기본 CPU / 장치 결합 | **유지 (의도된 설계)** | "CPU를 고르면 모든 모델이 CPU", 기본 CPU는 사용자 요청입니다. 분리는 별도 결정이 필요합니다. |
| P0-2 CPU resampler | 부분 수정 | weights LRU 캐시(16)와 scratch buffer 재사용, CPU 모드 DPR 상한 1.25(GPU 2.0). 같은 조건에서 Bilinear 24→17 ms. 출력 버퍼는 ImageData가 정확한 크기를 요구해 그대로 새로 할당합니다. |
| P0-3 숨김 창 rAF | 부분 수정 | result 창의 `backgroundThrottling:false` 제거(가려지면 rAF/타이머 중지). dirty-flag 방식으로의 전환은 하지 않았습니다. |
| P1-1 overlay 재드로우 | 부분 수정 | pointermove 재드로우를 프레임당 1회로 합쳤습니다. dim 캔버스 구조 변경은 하지 않았습니다. |
| P1-2 freeze 중복 캡처 | 수정 | `getSources()`를 한 번만 호출하고 display별로 resize합니다. |
| P1-3 30fps 스트림 | 수정 | 캡처 frameRate 5로 낮추고, 프레임 콜백과 fallback 타이머를 정리했습니다. |
| P1-4 WebGL 공유, NIS 1x 우회 | 보류 | 구조 변경이 커서 이번에는 하지 않았습니다. |
| P2 `listDir` 상한 | 수정 | IPC로 601개까지만 보냅니다(UI 표시 600개 + 안내). |
| P2 `drawCpu` context 캐시 | 수정 | panel에 한 번만 얻어 저장합니다. |
| P2 save preview / 설정 debounce / `openResult` 병렬화 / `existsSync` | 보류 | 효과가 작습니다. |
| 안정성 `applyMask` no-op | 수정 | 함수와 호출을 제거했습니다. |
| 안정성 test script | 수정 | `npm run check`(전체 스크립트 `node --check`)를 추가했습니다. |
| F-04 fs API 최소화 / CSP | 보류 | 로컬 파일만 로드하므로 위험이 낮아 후속 과제입니다. |
