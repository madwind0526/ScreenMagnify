# State

## Current Wave

- **Wave:** 2
- **Status:** Complete (v1.0.0 released)
- **Cache Status:** CLEAN
- **Last Checkpoint:** 2026-11-14 v1.0.0 커밋/푸시/릴리스, 문서 갱신 완료

## Wave History

| Wave | 작업 내용 | 상태 |
|------|-----------|------|
| 1 | 프로젝트 초기화, OpenCode 초기 구현 검토 | Done |
| 2 | UI 개편(아이콘 한 줄, 독립 설정 창), 선택 모양 버그, 정지 이미지 + 선택 영역 crop, CPU/GPU 실시간 전환, 스토어 이미지, 코드 리뷰 반영, 패키징 | Done |

## Session Notes

- 릴리스: GitHub `madwind0526/ScreenMagnify` v1.0.0 (`ScreenMagnify-1.0.0.zip`, 폴더형, 서명 없음)
- 모델 파일(`models/realesrgan_x4plus.onnx`, 64 MB)은 git과 릴리스 zip 모두에 포함
- 보류된 리뷰 항목: WebGL 컨텍스트/텍스처 공유, NIS 1x 우회, overlay dim 구조 변경, fs API 최소화/CSP
