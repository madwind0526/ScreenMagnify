# ScreenMagnify

> Working directory: `E:\Claude\ScreenMagnify`

## Project Overview

A Windows screen magnifier built with Electron. The user drags a rectangle, ellipse or freehand shape; the screen is captured once, the selected region is kept as a still picture, and a result window magnifies it (x0.5 to x64) with up to three scaling methods side by side (None, Bilinear, Bicubic, Lanczos3, NIS, Real-ESRGAN AI). The UI text is Korean; code comments are English. See `README.md` for the user-facing description and `codereview.md` for the latest review.

## Tech Stack

Plain HTML/CSS/JS (no bundler, no TypeScript), Electron (frameless and transparent windows), WebGL2 shaders, a JS CPU resampler, ONNX Runtime (`onnxruntime-node`, DirectML or CPU) in a worker thread, electron-builder (`dir` target with `asar: false`, zipped by `scripts/zip-release.mjs`).

## Commands

```bash
npm start              # run in Electron
npm run check          # node --check on every script (electron, public/js, scripts)
npm run dist           # build + release/ScreenMagnify-<version>.zip (unsigned)
npm run screenshots    # store/cutouts/*.png from the real windows
python scripts/store-mockup.py   # store/promo + store/feature-1024x500.png
start.bat / stop.bat   # start, and stop only the "ScreenMagnify" Electron windows
```

When launching Electron from the Claude shell, unset `ELECTRON_RUN_AS_NODE` first (`env -u ELECTRON_RUN_AS_NODE npx electron .`). The dev app keeps its settings in `%APPDATA%\screenmagnify`; the packaged app uses `%APPDATA%\ScreenMagnify`.

## Map of the code

| Path | What |
|---|---|
| `electron/main.js` | settings (`settings.json`, validated, broadcast to all windows), main/settings/result windows, selection overlays, freeze capture, save/list-folder IPC, AI worker control |
| `electron/ai-worker.js` | Real-ESRGAN session (model or device change recreates it), input padded to a 64/128/192/256 square, output cropped back |
| `electron/preload.js` | `window.api` (settings, window, selection, overlay, result, fs, ai) |
| `public/js/result.js` | result window: single-frame capture (`getDisplayMedia`), crop to the selection, view maths (`getView`, `visibleOf`, `destRectFor`), panels, AI ticks, save dialog |
| `public/js/upscaler.js` | WebGL2 programs; `drawCrop` and `drawAI` take a destination rectangle |
| `public/js/cpu-scaler.js` | separable CPU resampling with a weight cache |
| `public/js/methods.js` | method list; `gpuOnly` marks NIS; `applyDevice` rewrites the dropdown |
| `public/js/overlay.js` | selection overlay (rectangle, ellipse, freehand, Shift = 1:1) |
| `scripts/` | `zip-release.mjs`, `capture-docs.cjs` + `demo-scene.js` (real windows on a fake desktop), `store-mockup.py`, `check.cjs` |

## Key decisions

- **One device switch.** `aiDevice` ('cpu' default, 'gpu') controls both the AI session and the filter path: GPU uses WebGL/DirectML, CPU uses the JS resampler and the CPU ONNX provider. It switches live (no restart). NIS is GPU-only (disabled on CPU; a saved NIS falls back to Lanczos3).
- **A still picture, cropped.** The result captures one frame, then stops the stream and keeps only the selection (shape baked in as transparency). Zoom below x1 shrinks the picture; the aspect ratio is always the selection's.
- **Redraw only on change.** `render()` keeps a key per panel; the AI runs once per view, not continuously.
- **Save = active panel.** Transparent outside the shape and outside the picture.

## Testing notes

- `scripts/capture-docs.cjs` runs the real `main.js` with a throw-away profile (`app.setPath('userData', tmp)`) and drives the windows by dispatching events; it is the closest thing to an end-to-end check.
- The packaged app is checked from `release/win-unpacked/ScreenMagnify.exe`; the AI worker can be exercised with `ELECTRON_RUN_AS_NODE=1 ScreenMagnify.exe <script>`.
- `models/realesrgan_x4plus.onnx` (64 MB, committed) must exist for the AI method and for `npm run dist` (it is copied to `resources/models`).

## Global requirements

- Code comments in English only; UI strings in Korean.
- Ports: this app has no server and uses none (see `C:\Claude\PORTS.md`).

## Memory Bank

This project uses the `memory-bank/` system.

| File | Purpose |
|------|---------|
| `memory-bank/active-context.md` | current focus |
| `memory-bank/STATE.md` | wave state |
| `memory-bank/CACHE.md` | findings during a session |
| `memory-bank/knowledge/PATTERNS.md` | reusable code patterns |
| `memory-bank/knowledge/RULES.md` | project rules |
| `memory-bank/knowledge/trouble-shooting.md` | bugs and fixes |

At session start read `active-context.md`, then `STATE.md`.
