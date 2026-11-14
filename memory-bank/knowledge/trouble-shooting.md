# Trouble Shooting

> 발생했던 버그와 해결 방법. 같은 문제를 두 번 겪지 않기 위한 기록.

## 원형/자유 선택이 항상 사각형으로 동작

### 증상
선택 방법을 원형/자유로 바꿔도 사각형만 동작.

### 원인
렌더러가 `selection.start({ shape })`를 호출했는데 preload가 한 번 더 `{ shape }`로 감싸서 main에는 `{ shape: { shape } }`가 전달되어 항상 `'rect'`로 처리됨.

### 해결
렌더러에서 문자열만 넘긴다: `window.api.selection.start(current.shape)`.

## Electron이 `app` undefined로 죽음

### 증상
`TypeError: Cannot read properties of undefined (reading 'requestSingleInstanceLock')` — 셸에서 `electron .` 실행 시.

### 원인
Claude Code/VS Code 셸에 `ELECTRON_RUN_AS_NODE`가 설정되어 Electron이 Node로 실행됨.

### 해결
`env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron .` (패키지된 exe를 Node처럼 쓰려면 반대로 `ELECTRON_RUN_AS_NODE=1`).

## 저장 파일명 `..`가 선택 폴더 밖을 가리킴

### 증상
이름이 `..` 또는 `...png`이면 `dir`의 부모에 `.png`로 쓰려고 함.

### 원인
`.png`를 붙였다가 다시 떼고 `path.join`해서 점만 남은 이름이 그대로 쓰임.

### 해결
금지 문자 치환 후 `.png` 제거 → 끝의 점/공백 제거 → 비면 거부. 중복 번호 검사도 같은 이름 사용.

## AI 오류/worker 종료 후 복구 불가

### 증상
한 번 실패하면 결과 창을 닫았다 열 때까지 AI가 다시 로드되지 않음.

### 원인
`ensureAI()`가 `aiLoaded === key`이면 반환하는데 실패 시에도 `aiLoaded`가 남음.

### 해결
실패(`catch`)와 provider 해제(worker exit) 시 `aiLoaded = null`. AI 배지 클릭이 `aiError`를 해제해 재시도.

## 코드 리뷰 오탐: 비정사각 AI 입력

### 증상
리뷰가 "비정사각 입력을 stretch한 뒤 일부만 잘라 표시"한다고 지적.

### 원인
오탐. 렌더러가 이미 입력을 256 이하로 줄여 보내고, worker의 `x*width/inW`는 항등 매핑이라 우하단 edge 복제 패딩일 뿐이며 출력은 좌상단 `inW*4 × inH*4`만 사용한다.

### 해결
수정 없음. 200×100, 100×200, 256×144 입력의 가로/세로 그라데이션이 출력 네 모서리에서 0~255 전 범위로 나오는지로 검증. 리뷰 지적은 실측으로 재확인할 것.

## 드롭다운 글자가 위쪽에 붙음 (base-select)

### 증상
`appearance: base-select` 적용 후 선택 상자 안 글자/화살표가 세로 가운데가 아님.

### 원인
기본 배치가 위쪽 정렬.

### 해결
`.select { display: inline-flex; align-items: center; } .select::picker-icon { margin-left: auto; }`.

## 패키징: 네이티브 모듈/워커

### 증상
asar 안에서 `onnxruntime-node`와 worker 스크립트 로딩 위험.

### 원인
네이티브 `.node`/DLL과 `new Worker(path)`는 asar 안에서 문제가 되기 쉬움.

### 해결
`"asar": false`, `files`에서 darwin/linux/win32-arm64 바이너리를 제외, 모델은 `extraResources`로 `resources/models`에 복사하고 `process.resourcesPath`에서 읽는다. 패키지된 exe를 `ELECTRON_RUN_AS_NODE=1`로 실행해 worker 추론을 검증.

## OmniSR ONNX가 DirectML에서 실패

### 증상
pth를 spandrel + torch로 ONNX 변환(`torch.onnx.export`, opset 17, 동적 H/W)한 OmniSR 4x DF2K가 CPU에서는 동작하지만 DirectML에서 `FusedMatMul ... 80070057`으로 실패.

### 원인
OmniSR의 attention MatMul 패턴이 DML 확장 연산(FusedMatMul)에서 지원되지 않는 입력 형태를 만든다. 또한 spandrel의 패딩 분기가 트레이싱 시 상수로 고정되어, 입력은 8의 배수여야 안전하다.

### 해결
OmniSR은 앱에 채택하지 않았다(품질도 글씨에는 부적합). 새 모델은 CPU와 DML을 모두 돌려 보고 채택한다. 변환이 필요하면 별도 venv(`python -m venv` + CPU torch + spandrel + onnx)에서 하고 시스템 파이썬은 건드리지 않는다.

## 모델 벤치마크 시간이 들쭉날쭉함

### 증상
같은 모델의 CPU 시간이 실행마다 4~5배 차이(x4plus 256px: 3.6초 vs 13.5초).

### 원인
다른 프로세스가 CPU를 쓰는 동안 측정하면 크게 왜곡된다.

### 해결
같은 실행 안에서 모델끼리 상대 비교하고, 이상하면 몇 초 쉬었다 다시 측정한다.

## 배율 표시가 실제 배율과 다름 (x1.0인데 화면에 꽉 차게 확대됨)

### 증상
선택 영역이 창에 꽉 차게 확대되어 있어도 배율이 `x1.0`으로 표시됨.

### 원인
내부 `zoom`은 "선택 영역이 패널을 채운 상태 = 1"인 상대값이었고, 그대로 화면에 표시했다. 요구사항의 x0.5~x64, 0.5 단위는 원본 화면 대비 실제 배율이다.

### 해결
표시 배율 = `zoom * fitFactor()`, `fitFactor = 패널 내용 폭(CSS px) * devicePixelRatio / base.w`(물리 px 기준이라 페이지 줌과 화면 배율에 무관). 휠/버튼/키는 배율 기준으로 0.5 격자에 스냅해 단계를 밟고 `fitFactor`로 나눠 `zoom`을 구한다. 창 크기가 바뀌면 `fitFactor`가 바뀌므로 `resizePanel`에서 라벨을 갱신.
검증: 1px 줄무늬 화면을 nearest로 확대해 줄 폭의 평균 픽셀 수를 재면 표시 배율과 일치(x2.2→2.23, x2.5→2.50, x3.0→2.99). 표시되는 숫자는 이런 독립 측정으로 확인할 것.
