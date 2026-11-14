# State

## Current Wave

- **Wave:** 3
- **Status:** Complete (v1.1.0 released)
- **Cache Status:** CLEAN
- **Last Checkpoint:** 2026-11-14 v1.1.0 커밋/푸시/릴리스, README/todo/revision/progress/memory-bank 갱신

## Wave History

| Wave | 작업 내용 | 상태 |
|------|-----------|------|
| 1 | 프로젝트 초기화, OpenCode 초기 구현 검토 | Done |
| 3 | 기본 AI를 general-x4v3로 교체 + NomosUni SPAN 추가, 실제 배율 표시, 코드 리뷰 반영, v1.1.0 릴리스 | Done |
| 2 | UI 개편(아이콘 한 줄, 독립 설정 창), 선택 모양 버그, 정지 이미지 + 선택 영역 crop, CPU/GPU 실시간 전환, 스토어 이미지, 코드 리뷰 반영, 패키징 | Done |

## Session Notes

- 릴리스: GitHub `madwind0526/ScreenMagnify` v1.0.0, v1.1.0 (`ScreenMagnify-<버전>.zip`, 폴더형, 서명 없음)
- 모델 파일(`models/*.onnx`: general-x4v3, NomosUni SPAN, x4plus)은 git과 릴리스 zip 모두에 포함
- 2026-11-14: 기본 AI를 general-x4v3(4.9 MB)로 교체, NomosUni SPAN(1.6 MB) 추가, x4plus는 목록에 유지. v1.1.0으로 배포.
- 보류된 리뷰 항목: WebGL 컨텍스트/텍스처 공유, NIS 1x 우회, overlay dim 구조 변경, fs API 최소화/CSP
