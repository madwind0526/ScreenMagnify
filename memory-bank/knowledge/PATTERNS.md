# Patterns

> 검증된 코드 패턴. 복붙 바로 가능한 형태로 유지.

## 정지 이미지 확대: 한 프레임 캡처 후 선택 영역만 보관

**사용 시점:** 화면을 한 번만 캡처해서 확대/보간하고, 선택 밖 화면에는 접근할 수 없어야 할 때.

```js
// Wait for a real frame (clear the fallback timer), crop to the selection, then stop the stream.
await new Promise((resolve) => {
  const timer = setTimeout(resolve, 1500);
  if (target.requestVideoFrameCallback) target.requestVideoFrameCallback(() => { clearTimeout(timer); resolve(); });
});
const snap = document.createElement('canvas');          // selection size only
const ctx = snap.getContext('2d');
ctx.beginPath(); /* ellipse or polygon path */ ctx.clip(); // shape baked in as transparency
ctx.drawImage(target, sx, sy, sw, sh, 0, 0, sw, sh);
snap.videoWidth = sw; snap.videoHeight = sh; snap.readyState = 4; // mimic the video fields
for (const track of media.getTracks()) track.stop();
```

## 보이는 영역 계산 (줌 < 1 포함)

**사용 시점:** 줌 아웃 시 이미지가 창보다 작아지고 나머지는 검게 둘 때.

`getView()`는 이미지 밖으로 나가는 view도 허용하고(중심 고정), `visibleOf(view)`가 이미지와의 교집합을, `destRectFor()`가 그 교집합이 그려질 목적지 사각형을 계산한다. AI/크롭/저장 모두 `visibleOf`를 쓴다.

## 변경이 있을 때만 다시 그리기

**사용 시점:** 정지 이미지를 상시 rAF로 그릴 때.

패널마다 `view|dest|canvas size|method|useAI|aiStamp|device` 키를 만들어 `lastKey`와 같으면 `continue`. AI는 view가 바뀔 때만 1회 추론(`sameView(panel.aiView, view)`).

## CPU 리샘플러 (분리형 커널)

**사용 시점:** WebGL 없이 Bilinear/Bicubic/Lanczos를 계산할 때.

가로 → 세로 두 번의 1D 패스, 축소 시 커널 폭을 `max(1, src/dst)`배로 넓힘. weights는 `(method, srcLen, dstLen)` 키로 LRU(16) 캐시하고, 중간 버퍼는 모듈 변수로 재사용한다. CPU 모드에서는 devicePixelRatio를 1.25로 제한.

## 장치 실시간 전환 (WebGL ↔ 2D canvas)

**사용 시점:** 한 canvas에는 하나의 context만 만들 수 있어 런타임에 GPU/CPU 그리기를 바꿔야 할 때.

패널마다 `canvasGl`, `canvasCpu` 두 개를 겹쳐 두고 `display`만 전환한다. `Upscaler`(WebGL)는 처음 GPU가 필요할 때 지연 생성. 설정 변경 이벤트에서 모든 패널에 `applyPanelDevice()`.

## 투명 창 + 둥근 모서리

**사용 시점:** 프레임 없는 창의 모서리를 둥글게 할 때.

`BrowserWindow({ transparent: true, backgroundColor: '#00000000', resizable: false })` + `body { background: transparent } .app { border-radius: 16px; overflow: hidden; border: 1px solid ... }`.

## 항목 일부만 스타일링되는 드롭다운

**사용 시점:** `<option>` 안의 글자 일부(예: "(GPU 전용)")만 작게/흐리게 보이고 싶을 때.

```css
.select, .select::picker(select) { appearance: base-select; }
.select option small { font-size: 10px; }
```

옵션 안에 `<small>`을 넣고, 세로 가운데 정렬은 `.select { display: inline-flex; align-items: center; }`. 목록 위치는 `position-area` + `position-try-fallbacks: flip-block`.

## 스토어/홍보 이미지: 실제 창 + 가짜 데스크톱

**사용 시점:** 개인 화면 없이 발표용 스크린샷을 만들 때.

`app.setPath('userData', tmp)` 후 실제 `main.js`를 `require`, 결과 창에서 `navigator.mediaDevices.getDisplayMedia`를 canvas `captureStream()`으로 대체하고 PointerEvent/WheelEvent를 dispatch. 창을 `setZoomFactor(2)`로 키우면 선명한 캡처가 된다(`scripts/capture-docs.cjs`).
