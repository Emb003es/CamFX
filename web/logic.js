// Logic shared by the tracker worker, the overlay, the panel and test/logic.test.js.
// All rects are [x, y, w, h] normalized to the camera frame.

const DEFAULTS = {
  effect: 'windows', // windows or webs
  deviceId: '', micId: '', mirror: true, labels: true, trail: 4,
  bg: 'color', bgColor: '#101014', bgName: '', bgStamp: 0, // bg: color, camera, file or desktop
  face: true, body: false, eyes: false, mouth: false,
  motion: true, sensitivity: 0.6, minSize: 0.25,
  threshold: false, level: 0.75,
};

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('camfx')) }; }
  catch { return { ...DEFAULTS }; }
}

// Reads the chosen background file or, given one, stores it. Kept here so it survives a restart.
function bgStore(mode, file) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('camfx', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('files');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const store = open.result.transaction('files', mode).objectStore('files');
      const req = file ? store.put(file, 'bg') : store.get('bg');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    };
  });
}

// UV scale that makes an iw*ih image cover a cw*ch frame, cropping whatever overflows.
function coverScale(cw, ch, iw, ih) {
  const r = (cw / ch) / (iw / ih);
  return r < 1 ? [r, 1] : [1, 1 / r];
}

// '#rrggbb' to 0..1 channels.
function hexToRgb(hex) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
}

// Bottom to top; later kinds are drawn over earlier ones.
const KINDS = ['motion', 'threshold', 'body', 'face', 'mouth', 'eyes'];
const HIST = 16;       // past positions per window, also the number of stored frames
const TTL = 350;       // ms a window survives without being detected
const MAX_TRACKS = 48;

// Bounding boxes of the connected active cells of a W*H mask. A box bigger than maxFrac of the
// frame is halved until it fits, so a big moving area becomes several windows as in the reel.
function findBlobs(mask, W, H, minCells, maxFrac = 0.18) {
  const out = [], seen = new Uint8Array(W * H), stack = [];
  const maxW = Math.ceil(W * maxFrac), maxH = Math.ceil(H * maxFrac);
  const split = (x0, y0, x1, y1) => {
    let a = x1 + 1, b = y1 + 1, c = x0 - 1, d = y0 - 1, n = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!mask[y * W + x]) continue;
      n++;
      if (x < a) a = x;
      if (x > c) c = x;
      if (y < b) b = y;
      if (y > d) d = y;
    }
    if (n < minCells) return;
    const w = c - a + 1, h = d - b + 1;
    if (w <= maxW && h <= maxH) out.push([a / W, b / H, w / W, h / H]);
    else if (w / maxW >= h / maxH) { const m = a + (w >> 1); split(a, b, m - 1, d); split(m, b, c, d); }
    else { const m = b + (h >> 1); split(a, b, c, m - 1); split(a, m, c, d); }
  };
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i / W) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j >= 0 && mask[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    split(x0, y0, x1, y1);
  }
  return out;
}

// Gives each detection of one kind the nearest live track of that kind, or opens a new track.
function matchTracks(tracks, kind, dets, now) {
  const free = tracks.filter(t => t.kind === kind);
  let opened = false;
  for (const [x, y, w, h] of dets) {
    let best = -1, bestDist = 0.15 * 0.15;
    free.forEach((t, i) => {
      const dx = t.tx + t.tw / 2 - x - w / 2, dy = t.ty + t.th / 2 - y - h / 2, dist = dx * dx + dy * dy;
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    let t;
    if (best >= 0) t = free.splice(best, 1)[0];
    else if (tracks.length < MAX_TRACKS) {
      t = { kind, x, y, w, h, hist: new Float32Array(HIST * 4), n: 0 };
      tracks.push(t);
      opened = true;
    } else continue;
    t.tx = x; t.ty = y; t.tw = w; t.th = h; t.seen = now;
  }
  if (opened) tracks.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
}

// Eases tracks towards their last detection and drops the expired ones.
function stepTracks(tracks, now, ease) {
  for (let i = tracks.length - 1; i >= 0; i--) {
    const t = tracks[i];
    if (now - t.seen > TTL) { tracks.splice(i, 1); continue; }
    t.x += (t.tx - t.x) * ease;
    t.y += (t.ty - t.y) * ease;
    t.w += (t.tw - t.w) * ease;
    t.h += (t.th - t.h) * ease;
  }
}

// The sheets stretch between the same fingertips of two hands (MediaPipe ids): thumb, index, middle, pinky.
const WEB_TIPS = [4, 8, 12, 20];

// dets: one flat [x, y, ...] per hand. A sheet needs both ends, so a lone hand changes nothing.
function seeHands(web, dets, now) {
  if (dets.length < 2) return;
  web.target = [...dets[0], ...dets[1]];
  web.seen = now;
  web.pts ??= web.target.slice();
}

// Eases the fingertips towards their last detection and drops them once the hands are gone.
function stepHands(web, now, ease) {
  if (!web.pts) return;
  if (now - web.seen > TTL) { web.pts = null; return; }
  for (let i = 0; i < web.pts.length; i++) web.pts[i] += (web.target[i] - web.pts[i]) * ease;
}

if (typeof module === 'object') module.exports = { findBlobs, matchTracks, stepTracks, seeHands, stepHands, coverScale, hexToRgb, TTL, MAX_TRACKS };
