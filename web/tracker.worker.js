// Detection thread. Gets small frames from the overlay and answers with rects. Frames never
// queue up: the overlay only sends one after the previous answer arrived.
// vendor/vision_bundle.js is the package's vision_bundle.cjs wrapped in (function(exports){...})(self.exports):
// loaded bare, its minified top-level names land in the worker's global scope and it dies on load.
self.exports = {};
importScripts('logic.js', 'vendor/vision_bundle.js');
const { FaceDetector, PoseLandmarker, HandLandmarker, ImageSegmenter } = self.exports;

// The MediaPipe bundle reports usage stats to Google. In a camera app nothing leaves the PC.
const realFetch = self.fetch;
self.fetch = (input, init) => new URL(input.url ?? input, location.href).origin === location.origin
  ? realFetch(input, init)
  : Promise.reject(new TypeError('blocked'));

const abs = path => new URL(path, location.href).href;
const fileset = {
  wasmLoaderPath: abs('vendor/wasm/vision_wasm_internal.js'),
  wasmBinaryPath: abs('vendor/wasm/vision_wasm_internal.wasm'),
};

const detectors = {};

// Returns the detector, or undefined while it is still loading.
function detector(name, cls, model, delegate, options) {
  if (!detectors[name]) {
    detectors[name] = 'loading';
    const load = d => cls.createFromOptions(fileset, { baseOptions: { modelAssetPath: abs(model), delegate: d }, runningMode: 'VIDEO', ...options });
    load(delegate).catch(() => load('CPU'))
      .then(d => { detectors[name] = d; })
      .catch(e => { postMessage({ error: `${name}: ${e.message}` }); });
  }
  return detectors[name] === 'loading' ? undefined : detectors[name];
}

const around = (p, w, h) => [p.x - w / 2, p.y - h / 2, w, h];

function detectFace(bitmap, ts, o, out) {
  // CPU: on this tiny model it is as fast as the GPU delegate and leaves the GPU to the render.
  const det = detector('face', FaceDetector, 'vendor/blaze_face_short_range.tflite', 'CPU');
  if (!det) return;
  out.face = []; out.eyes = []; out.mouth = []; out.kp = [];
  for (const { boundingBox: b, keypoints: k } of det.detectForVideo(bitmap, ts).detections) {
    const w = b.width / bitmap.width, h = b.height / bitmap.height;
    out.kp.push(k.flatMap(p => [p.x, p.y])); // eyes, nose, mouth and ears, for whoever needs more than boxes
    // BlazeFace boxes are tight; the window in the reel takes in the whole head.
    if (o.face) out.face.push(around({ x: b.originX / bitmap.width + w / 2, y: b.originY / bitmap.height + h * 0.42 }, w * 1.55, h * 1.9));
    if (o.eyes) out.eyes.push(around(k[0], w * 0.34, h * 0.2), around(k[1], w * 0.34, h * 0.2));
    if (o.mouth) out.mouth.push(around(k[3], w * 0.55, h * 0.24));
  }
}

function detectBody(bitmap, ts, out) {
  const det = detector('pose', PoseLandmarker, 'vendor/pose_landmarker_lite.task', 'GPU');
  if (!det) return;
  out.body = [];
  for (const marks of det.detectForVideo(bitmap, ts).landmarks) {
    const seen = marks.filter(m => m.visibility > 0.5);
    if (!seen.length) continue;
    const xs = seen.map(m => m.x), ys = seen.map(m => m.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    out.body.push([x, y, Math.max(...xs) - x, Math.max(...ys) - y]);
  }
}

function detectHands(bitmap, ts, out) {
  const det = detector('hands', HandLandmarker, 'vendor/hand_landmarker.task', 'GPU', { numHands: 2 });
  if (!det) return;
  // Left to right by the wrist, so each hand keeps its place from one frame to the next.
  const hands = det.detectForVideo(bitmap, ts).landmarks.sort((a, b) => a[0].x - b[0].x);
  out.hands = hands.map(marks => WEB_TIPS.flatMap(i => [marks[i].x, marks[i].y]));
  out.wrists = hands.map(marks => marks[0].x);
  out.marks = hands.map(marks => marks.flatMap(m => [m.x, m.y]));
}

const SEG = 256; // the model's own input size: anything bigger is only scaled down and the answer scaled back up
const segCtx = new OffscreenCanvas(SEG, SEG).getContext('2d');

function detectPerson(bitmap, ts, o, out) {
  // GPU: the whole detection pass takes 24 ms against 38 ms on the CPU.
  const det = detector('person', ImageSegmenter, 'vendor/selfie_segmenter.tflite', 'GPU', { outputConfidenceMasks: true, outputCategoryMask: false });
  // Asked for even outside a scene, so that it is loaded before the first one needs it.
  if (!det || !o.scene) return;
  segCtx.drawImage(bitmap, 0, 0, SEG, SEG);
  const small = segCtx.canvas.transferToImageBitmap();
  const res = det.segmentForVideo(small, ts), m = res.confidenceMasks.at(-1), conf = m.getAsFloat32Array();
  const data = new Uint8Array(conf.length);
  for (let i = 0; i < conf.length; i++) data[i] = conf[i] * 255;
  out.mask = { data, w: m.width, h: m.height };
  res.close();
  small.close();
}

const GRID_W = 96;
let grid, gridH, prev;

function scanPixels(bitmap, o, out) {
  const H = Math.round(GRID_W * bitmap.height / bitmap.width);
  if (H !== gridH) {
    gridH = H;
    grid = new OffscreenCanvas(GRID_W, H).getContext('2d', { willReadFrequently: true });
    prev = null;
  }
  grid.drawImage(bitmap, 0, 0, GRID_W, H);
  const px = grid.getImageData(0, 0, GRID_W, H).data, n = GRID_W * H;
  const moved = new Uint8Array(n), bright = new Uint8Array(n);
  const diffMin = 40 - 34 * o.sensitivity, brightMin = o.level * 255;
  const first = !prev;
  prev ??= new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const g = 0.3 * px[i * 4] + 0.59 * px[i * 4 + 1] + 0.11 * px[i * 4 + 2];
    if (!first && Math.abs(g - prev[i]) > diffMin) moved[i] = 1;
    if (g > brightMin) bright[i] = 1;
    prev[i] = first ? g : prev[i] + (g - prev[i]) * 0.5;
  }
  const minCells = 2 + (o.minSize * 40 | 0);
  const blobs = mask => findBlobs(dilate(mask, GRID_W, H), GRID_W, H, minCells)
    .sort((a, b) => b[2] * b[3] - a[2] * a[3]).slice(0, 24);
  if (o.motion) out.motion = blobs(moved);
  if (o.threshold) out.threshold = blobs(bright);
}

// Grows active cells by one, so that nearby specks join into one blob.
function dilate(mask, W, H) {
  const out = mask.slice();
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    if (i % W > 0) out[i - 1] = 1;
    if (i % W < W - 1) out[i + 1] = 1;
    if (i >= W) out[i - W] = 1;
    if (i < W * (H - 1)) out[i + W] = 1;
  }
  return out;
}

let ts = 0;

self.onmessage = ({ data: { bitmap, opts: o } }) => {
  const t0 = performance.now(), out = {};
  ts = Math.max(ts + 1, t0); // MediaPipe needs strictly increasing timestamps
  try {
    if (o.effect === 'webs') detectHands(bitmap, ts, out);
    else if (o.effect === 'anime' || o.effect === 'collage') {
      detectHands(bitmap, ts, out);
      detectPerson(bitmap, ts, o, out);
      if (o.effect === 'anime' && o.scene) detectFace(bitmap, ts, { face: true }, out);
    } else if (FINGER_EFFECTS.includes(o.effect)) {
      detectHands(bitmap, ts, out);
      if (o.effect === 'life') detectFace(bitmap, ts, { face: true }, out);
    } else {
      if (o.motion || o.threshold) scanPixels(bitmap, o, out);
      if (o.face || o.eyes || o.mouth) detectFace(bitmap, ts, o, out);
      if (o.body) detectBody(bitmap, ts, out);
    }
  } catch (e) {
    out.error = e.message;
  }
  bitmap.close();
  out.ms = performance.now() - t0;
  postMessage(out, out.mask ? [out.mask.data.buffer] : []);
};
