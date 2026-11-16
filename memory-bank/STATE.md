# State

## Current Wave

- **Wave:** 4
- **Status:** Complete (v1.2.0 released)
- **Cache Status:** CLEAN
- **Last Checkpoint:** 2026-11-16 AI 타일 처리/한도 설정/모델 전환 버그/UI 정리, README/CLAUDE.md/revision/progress/todo/memory-bank 갱신

## Wave History

| Wave | 작업 내용 | 상태 |
|------|-----------|------|
| 1 | 프로젝트 초기화, OpenCode 초기 구현 검토 | Done |
| 4 | AI 입력 축소 제거(타일 처리), AI 최대 처리 크기 설정, 모델 전환 늦은 결과 폐기, x4plus GPU 전용, 모델 목록 크기 순, 직각·컴팩트 UI, 배율 HUD 어두운 판 | Done |
| 3 | 기본 AI를 general-x4v3로 교체 + NomosUni SPAN 추가, 실제 배율 표시, 코드 리뷰 반영, v1.1.0 릴리스 | Done |
| 2 | UI 개편(아이콘 한 줄, 독립 설정 창), 선택 모양 버그, 정지 이미지 + 선택 영역 crop, CPU/GPU 실시간 전환, 스토어 이미지, 코드 리뷰 반영, 패키징 | Done |

## Session Notes

- 릴리스: GitHub `madwind0526/ScreenMagnify` v1.0.0, v1.1.0, v1.2.0 (`ScreenMagnify-<버전>.zip`, 폴더형, 서명 없음)
- 모델 파일(`models/*.onnx`: general-x4v3, NomosUni SPAN, x4plus)은 git과 릴리스 zip 모두에 포함
- 2026-11-14: 기본 AI를 general-x4v3(4.9 MB)로 교체, NomosUni SPAN(1.6 MB) 추가, x4plus는 목록에 유지. v1.1.0으로 배포.
- 보류된 리뷰 항목: WebGL 컨텍스트/텍스처 공유, NIS 1x 우회, overlay dim 구조 변경, fs API 최소화/CSP
- 2026-11-16: ScreenMagnify2(돋보기 앱, `E:\Claude\ScreenMagnify2`)를 이 프로젝트에서 갈라냈다. `models/`, `upscaler.js`, `cpu-scaler.js`, `methods.js`를 공유하므로 같아야 하는 동작(배율 단계, 한도, GPU 전용 규칙)은 양쪽을 맞춘다.
- 사용자 환경: 회사 PC는 CPU만 쓰고 이 PC보다 느리다. 회사에서는 같은 모델이 1.0배에서도 깨끗했다(입력을 줄이지 않았기 때문으로 보인다).
