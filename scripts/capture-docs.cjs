// Captures the cut-outs for the store images (store/cutouts/*.png) from the real windows.
// Runs the real electron/main.js with a throw-away profile (your settings are not
// touched) and a fake desktop as the "screen". Compose the store images afterwards with `python scripts/store-mockup.py`.
// Usage: npx electron scripts/capture-docs.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CUT = path.join(ROOT, 'store', 'cutouts');
const GEN = path.join(ROOT, 'store', 'gen');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SCENE = fs.readFileSync(path.join(__dirname, 'demo-scene.js'), 'utf8');
const { SCENE_INFO } = require('./demo-scene.js');
const dataUrl = (file) => `data:image/jpeg;base64,${fs.readFileSync(path.join(ROOT, 'store', 'gen', file)).toString('base64')}`;
const IMAGES = { pic: dataUrl('halong-card.jpg'), sky: dataUrl('sky-d.jpg') };

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'sm-docs-')));
fs.mkdirSync(CUT, { recursive: true });
fs.mkdirSync(GEN, { recursive: true });
require(path.join(ROOT, 'electron', 'main.js'));

const preload = path.join(ROOT, 'electron', 'preload.js');
const prefs = { preload, contextIsolation: true, nodeIntegration: false, sandbox: false };
const display = { id: '1', label: '', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 };

async function shot(win, name) {
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(CUT, name), image.toPNG());
  console.log('wrote', name, image.getSize());
}

// A window of logical size w x h, drawn at `zoom` times the pixels so the capture is crisp.
async function open(page, w, h, zoom, transparent) {
  const win = new BrowserWindow({
    width: Math.round(w * zoom), height: Math.round(h * zoom), useContentSize: true, frame: false, show: true, resizable: false,
    transparent: !!transparent, backgroundColor: transparent ? '#00000000' : '#0b0c10', webPreferences: prefs
  });
  await win.loadFile(path.join(ROOT, 'public', page));
  win.webContents.setZoomFactor(zoom);
  return win;
}

// Opens the result window on the fake desktop and magnifies like a user would (wheel zoom on an anchor point).
async function result({ name, w, h, zoom, rect, shape, polygon, panelCount, methods, wheels, anchor }) {
  const win = await open('result.html', w, h, zoom, false);
  await win.webContents.executeJavaScript(`${SCENE}
    (async () => {
      const load = (src) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.src = src; });
      const imgs = { pic: await load(${JSON.stringify(IMAGES.pic)}), sky: await load(${JSON.stringify(IMAGES.sky)}) };
      const c = document.createElement('canvas');
      c.width = 1920; c.height = 1080;
      const ctx = c.getContext('2d');
      drawScene(ctx, 1920, 1080, imgs);
      window.__scene = c;
      setInterval(() => { ctx.fillStyle = 'rgba(255,255,255,0.004)'; ctx.fillRect(0, 0, 1, 1); }, 100);
      const stream = c.captureStream(10);
      navigator.mediaDevices.getDisplayMedia = async () => stream;
    })()`);
  win.webContents.send('result:init', {
    selection: { shape: shape || 'rect', rect, polygon: polygon || null, display },
    settings: { panelCount, method: methods[0], theme: 'dark', aiDevice: 'gpu', customPaths: [] },
    sourceId: null
  });
  await sleep(3500);
  const act = (body) => win.webContents.executeJavaScript(`(() => { ${body} })()`);
  const last = methods.length - 1;
  await act(`
    const panels = [...document.querySelectorAll('.panel')];
    const methods = ${JSON.stringify(methods)};
    const sel = document.getElementById('method-select');
    methods.forEach((m, i) => {
      panels[i].dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, bubbles: true }));
      panels[i].dispatchEvent(new PointerEvent('pointerup', { button: 0, pointerId: 1, bubbles: true }));
      sel.value = m; sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
  `);
  const wheel = async (count) => {
    for (let i = 0; i < count; i += 1) {
      await act(`
        const panel = document.querySelectorAll('.panel')[${last}];
        const r = panel.querySelector('canvas:not([style*="none"])').getBoundingClientRect();
        const aspect = ${rect.w} / ${rect.h};
        const cw = Math.min(r.width, r.height * aspect);
        const ch = cw / aspect;
        const x = r.left + (r.width - cw) / 2 + cw * (${anchor.x} / ${rect.w});
        const y = r.top + (r.height - ch) / 2 + ch * (${anchor.y} / ${rect.h});
        panel.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      `);
      await sleep(80);
    }
  };
  if (wheels > 1) await wheel(wheels - 1);
  await sleep(4000);
  if (wheels > 0) await wheel(1);
  await sleep(1100);
  await shot(win, name);
  return win;
}

app.whenReady().then(async () => {
  await sleep(2500);
  const boot = BrowserWindow.getAllWindows()[0];
  const R = SCENE_INFO.rect;

  // Main and settings windows (transparent, like the real ones), at 2x.
  const main = await open('index.html', 380, 132, 2, true);
  await main.webContents.executeJavaScript('window.api.settings.set({ shape: "ellipse" })');
  await sleep(500);
  await shot(main, 'main.png');
  const settings = await open('settings.html', 280, 330, 2, true);
  await sleep(500);
  await shot(settings, 'settings.png');
  main.close();
  settings.close();
  await boot.webContents.executeJavaScript('window.api.settings.set({ aiDevice: "gpu", panelCount: 3, method: "nearest" })');

  // Three methods side by side at x4 on the cottage roof and window.
  const compare = await result({
    name: 'compare.png', w: 1180, h: 540, zoom: 1.5, rect: R, panelCount: 3,
    methods: ['nearest', 'lanczos3', 'realesrgan'], wheels: 6, anchor: SCENE_INFO.anchor
  });

  // Nearest against Real-ESRGAN at x8 on the window frame.
  await result({
    name: 'zoom.png', w: 1180, h: 540, zoom: 1.5, rect: SCENE_INFO.zoomRect, panelCount: 2,
    methods: ['nearest', 'realesrgan'], wheels: 10, anchor: SCENE_INFO.zoomAnchor
  });

  // A freehand selection around the flowers, shown through its shape.
  const blob = [];
  for (let i = 0; i < 48; i += 1) {
    const a = (i / 48) * Math.PI * 2;
    const r = 0.46 + 0.08 * Math.sin(a * 3) + 0.04 * Math.cos(a * 5);
    blob.push({ x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a) });
  }
  await result({
    name: 'shape.png', w: 1000, h: 500, zoom: 1.5, rect: SCENE_INFO.shapeRect, shape: 'free', polygon: blob,
    panelCount: 1, methods: ['realesrgan'], wheels: 0, anchor: { x: 165, y: 125 }
  });

  // The demo picture and the selection overlay (ellipse) over the frozen fake desktop, at 1:1.
  const freeze = await compare.webContents.executeJavaScript('window.__scene.toDataURL("image/jpeg", 0.92)');
  BrowserWindow.getAllWindows().forEach((win) => { if (win !== boot) win.hide(); });
  const overlay = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, frame: false, show: true, backgroundColor: '#000000', webPreferences: prefs });
  await overlay.loadFile(path.join(ROOT, 'public', 'overlay.html'));
  overlay.focus();
  overlay.webContents.focus();
  overlay.webContents.send('overlay:init', {
    displayId: '1', bounds: display.bounds, size: display.size, workArea: display.workArea, scaleFactor: 1, shape: 'ellipse', freeze
  });
  await sleep(1000);
  await overlay.webContents.executeJavaScript(`(() => {
    const fire = (type, x, y) => window.dispatchEvent(new PointerEvent(type, { pointerType: 'mouse', button: 0, pointerId: 1, clientX: x, clientY: y, bubbles: true }));
    const pad = 16, x0 = ${R.x} - pad, y0 = ${R.y} - pad, x1 = ${R.x + R.w} + pad, y1 = ${R.y + R.h} + pad;
    fire('pointerdown', x0, y0);
    for (let i = 1; i <= 12; i += 1) fire('pointermove', x0 + ((x1 - x0) * i) / 12, y0 + ((y1 - y0) * i) / 12);
  })()`);
  await sleep(500);
  await shot(overlay, 'select.png');

  app.exit(0);
});
