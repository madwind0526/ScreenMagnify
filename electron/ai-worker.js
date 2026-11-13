const { parentPort, workerData } = require('worker_threads');

let ort = null;
let session = null;
let currentModel = null;
let currentDevice = null;
let provider = null;
let queue = Promise.resolve();

const BUCKETS = [64, 128, 192, 256];

function loadOrt() {
  if (!ort) {
    ort = require('onnxruntime-node');
    try {
      ort.env.logLevel = 'error';
    } catch {
      // Ignore.
    }
  }
  return ort;
}

function modelPath(model) {
  const file = workerData.files[model] || workerData.files.realesrgan;
  return require('path').join(workerData.modelDir, file);
}

function bucketFor(maxSize) {
  for (const size of BUCKETS) {
    if (maxSize <= size) return size;
  }
  return BUCKETS[BUCKETS.length - 1];
}

async function ensureSession(model, device) {
  const targetModel = model || 'realesrgan';
  const targetDevice = device === 'gpu' ? 'gpu' : 'cpu';
  if (session && currentModel === targetModel && currentDevice === targetDevice) return;
  if (session) {
    try {
      await session.release();
    } catch {
      // Ignore.
    }
    session = null;
  }

  const runtime = loadOrt();
  const file = modelPath(targetModel);
  let next = null;
  let nextProvider = 'cpu';
  if (targetDevice === 'gpu') {
    try {
      next = await runtime.InferenceSession.create(file, {
        executionProviders: ['dml'],
        graphOptimizationLevel: 'all'
      });
      nextProvider = 'dml';
    } catch (error) {
      console.error('DML session failed, falling back to CPU:', error.message);
    }
  }
  if (!next) {
    next = await runtime.InferenceSession.create(file, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all'
    });
  }

  session = next;
  currentModel = targetModel;
  currentDevice = targetDevice;
  provider = nextProvider;
  parentPort.postMessage({ type: 'provider', provider });
}

function inferRgba(rgba, width, height) {
  const runtime = loadOrt();
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];

  let inW = width;
  let inH = height;
  if (Math.max(inW, inH) > 256) {
    const scale = 256 / Math.max(inW, inH);
    inW = Math.max(1, Math.round(width * scale));
    inH = Math.max(1, Math.round(height * scale));
  }

  const size = bucketFor(Math.max(inW, inH));
  const plane = size * size;
  const data = new Float32Array(plane * 3);

  for (let y = 0; y < size; y += 1) {
    const sy = Math.min(height - 1, Math.floor((y * height) / inH));
    for (let x = 0; x < size; x += 1) {
      const sx = Math.min(width - 1, Math.floor((x * width) / inW));
      const sourceIndex = (sy * width + sx) * 4;
      const targetIndex = y * size + x;
      data[targetIndex] = rgba[sourceIndex] / 255;
      data[plane + targetIndex] = rgba[sourceIndex + 1] / 255;
      data[plane * 2 + targetIndex] = rgba[sourceIndex + 2] / 255;
    }
  }

  const input = new runtime.Tensor('float32', data, [1, 3, size, size]);
  return session.run({ [inputName]: input }).then((outputs) => {
    const output = outputs[outputName];
    const dims = output.dims;
    const outSize = dims[dims.length - 1];
    const outH = dims[dims.length - 2];
    const outPlane = outSize * outH;
    const source = output.data;

    const outW = Math.max(1, Math.round(inW * 4));
    const outHeight = Math.max(1, Math.round(inH * 4));
    const result = new Uint8ClampedArray(outW * outHeight * 4);

    for (let y = 0; y < outHeight; y += 1) {
      for (let x = 0; x < outW; x += 1) {
        const sourceIndex = y * outSize + x;
        const targetIndex = (y * outW + x) * 4;
        const r = source[sourceIndex];
        const g = source[outPlane + sourceIndex];
        const b = source[outPlane * 2 + sourceIndex];
        result[targetIndex] = Math.max(0, Math.min(255, Math.round(r * 255)));
        result[targetIndex + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
        result[targetIndex + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
        result[targetIndex + 3] = 255;
      }
    }

    return { data: result, width: outW, height: outHeight };
  });
}

async function handle(message) {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'init') {
    try {
      await ensureSession(message.model, message.device);
      parentPort.postMessage({ type: 'ready', id: message.id, provider });
    } catch (error) {
      parentPort.postMessage({
        type: 'error',
        id: message.id,
        message: `AI 모델을 불러오지 못했습니다: ${error.message}`
      });
    }
    return;
  }

  if (message.type === 'infer') {
    try {
      await ensureSession(message.model, message.device);
      const bytes = message.data instanceof Uint8Array
        ? message.data
        : new Uint8Array(message.data);
      const output = await inferRgba(bytes, message.width, message.height);
      parentPort.postMessage({
        type: 'result',
        id: message.id,
        width: output.width,
        height: output.height,
        data: output.data.buffer,
        provider
      }, [output.data.buffer]);
    } catch (error) {
      parentPort.postMessage({
        type: 'error',
        id: message.id,
        message: error.message || 'AI 처리에 실패했습니다.'
      });
    }
  }
}

parentPort.on('message', (message) => {
  queue = queue.then(() => handle(message)).catch((error) => {
    parentPort.postMessage({ type: 'worker-error', message: error.message || 'AI 워커 오류' });
  });
});

process.on('uncaughtException', (error) => {
  parentPort.postMessage({ type: 'worker-error', message: error.message || 'AI 워커 오류' });
});

process.on('unhandledRejection', (error) => {
  const message = error && error.message ? error.message : 'AI 워커 오류';
  parentPort.postMessage({ type: 'worker-error', message });
});
