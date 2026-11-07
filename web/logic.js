// Logic shared by the tracker worker, the overlay, the panel and test/logic.test.js.
// All rects are [x, y, w, h] normalized to the camera frame.

const DEFAULTS = {
  effect: 'windows', gesture: 0.6, // effect: windows, webs, anime, collage, or one of FINGER_EFFECTS
  title: 'EMBO', subtitle: 'SEQUENCE', // the anime sequence's lettering
  instrument: 'piano', scale: 'mayor', // music: piano, synth, bells or drums; a key of SCALES
  name: 'EMBO',                        // life: the character's name
  ink: 6, kaleido: false,              // paint: seconds a stroke lasts (INK_FOREVER: for good), six-fold mirror
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

// At the default sensitivity. Measured on a real arm crossing the frame: about 0.5 widths/s, lost for 300 ms on the way.
const SWIPE_SPEED = 0.5;  // frame widths per second
const SWIPE_TRAVEL = 0.15; // frame widths
const SWIPE_GAP = 400;    // ms a fast hand may go undetected, blurred, without ending the swipe
const SWIPE_REST = 1000;  // ms before another swipe counts

// A hand crossing the frame fast. xs: x of each hand's wrist. Returns +1 or -1 (towards larger x) once per swipe, else 0.
// Sensitivity 0 turns it off.
function trackSwipe(sw, xs, now, sensitivity = 0.6) {
  if (!xs.length) {
    if (now - sw.t > SWIPE_GAP) { sw.xs = null; sw.run = 0; }
    return 0;
  }
  const k = 0.6 / sensitivity, dt = (now - sw.t) / 1000;
  let step = 0;
  if (sw.xs && dt > 0) for (const x of xs) {
    const near = sw.xs.reduce((a, b) => Math.abs(b - x) < Math.abs(a - x) ? b : a, Infinity), dx = x - near;
    // Further than a hand can go in dt is another hand showing up, not a move.
    if (Math.abs(dx) < Math.min(0.05 + dt * 3, 0.35) && Math.abs(dx) / dt >= SWIPE_SPEED * k && Math.abs(dx) > Math.abs(step)) step = dx;
  }
  sw.run = step && Math.sign(step) === Math.sign(sw.run) ? sw.run + step : step;
  sw.xs = xs;
  sw.t = now;
  if (Math.abs(sw.run) < SWIPE_TRAVEL * k || now < (sw.rest ?? 0)) return 0;
  const dir = Math.sign(sw.run);
  sw.run = 0;
  sw.rest = now + SWIPE_REST;
  return dir;
}

// The anime sequence, a cut every SCENE_MS. Layers are the ones painted in seq.js; move(t) animates the front layer.
const SCENE_MS = 1700;
const pop = t => 1 - (1 - Math.min(t * 2.5, 1)) ** 3;
const ANIME = [
  { bg: 0, person: 0, front: 1, move: t => ({ scale: 0.5 + 0.5 * pop(t) + 0.05 * t, ang: 0.35 * (1 - pop(t)) }) },
  { bg: 2, person: 1, front: 3 },
  { bg: 4, person: 0, front: -1, rough: 0.2 },
  { bg: 5, person: 2, front: 9, onFace: true },
  { bg: 6, person: 0, front: 7 },
  { bg: 8, person: 0, front: 10, move: t => ({ scale: 0.95 + 0.2 * t, ang: -0.05 + 0.08 * t }) },
];

// What to draw ms after the scene started.
function seqFrame(effect, ms) {
  if (effect === 'collage') return { bg: 0, person: 3, front: 1 + Math.floor(ms / 125) % 4, scale: 1, ang: 0, glitch: 0 };
  const scene = ANIME[Math.floor(ms / SCENE_MS) % ANIME.length], t = ms % SCENE_MS / SCENE_MS;
  const shake = Math.max(1 - t / 0.1, (t - 0.94) / 0.06, scene.rough ?? 0);
  return { scale: 1, ang: 0, ...scene, ...scene.move?.(t), glitch: shake };
}

// The effects played with the fingers, drawn by fingers.js. They all need every landmark of the hands.
const FINGER_EFFECTS = ['music', 'life', 'paint', 'energy'];
const INK_FOREVER = 30;

// Every landmark of each hand (dets: one flat [x, y, ...] of 21 points per hand), eased like the fingertips.
// A hand keeps its id while it moves: it is matched by the wrist to the nearest hand of the last detection.
function seeMarks(hs, dets, now) {
  hs.list ??= [];
  hs.ids ??= 0;
  const free = hs.list.slice();
  for (const target of dets) {
    let best = -1, bestDist = 0.25;
    free.forEach((h, i) => {
      const d = Math.hypot(h.target[0] - target[0], h.target[1] - target[1]);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    if (best >= 0) Object.assign(free.splice(best, 1)[0], { target, seen: now });
    else hs.list.push({ id: ++hs.ids, target, pts: target.slice(), seen: now });
  }
}

function stepMarks(hs, now, ease) {
  if (!hs.list) return;
  hs.list = hs.list.filter(h => now - h.seen <= TTL);
  for (const h of hs.list) for (let i = 0; i < h.pts.length; i++) h.pts[i] += (h.target[i] - h.pts[i]) * ease;
}

// Fingertips (MediaPipe ids) of the index, middle, ring and pinky, and the joint below each.
const TIPS = [8, 12, 16, 20], PIPS = [6, 10, 14, 18], KNUCKLES = [5, 9, 13, 17];

// What a hand is doing, from its 21 landmarks in px ([x, y] each). was: the last answer for this hand, so
// that a pinch or a touch needs to open further to end than to start, and does not flicker at the edge.
function readHand(p, was = {}) {
  const d = (a, b) => Math.hypot(p[a][0] - p[b][0], p[a][1] - p[b][1]);
  const size = Math.max(d(0, 9), 1); // wrist to the middle finger's knuckle: the scale of everything else
  const up = TIPS.map((t, i) => d(0, t) > d(0, PIPS[i]) * 1.12);
  const curled = TIPS.map((t, i) => d(0, t) < d(0, KNUCKLES[i]) * 1.05);
  const count = up.filter(Boolean).length;
  // In a pinch the index still reaches past its knuckle; in a fist the thumb lies on curled fingers.
  const pinch = d(4, 8) / size < (was.pinch ? 0.45 : 0.3) && !curled[0];
  const ratios = TIPS.map(t => d(4, t) / size);
  let touch = was.touch >= 0 && ratios[was.touch] < 0.42 ? was.touch : -1;
  if (touch < 0) {
    const m = Math.min(...ratios);
    if (m < 0.26) touch = ratios.indexOf(m);
  }
  const palm = [0, 5, 9, 13, 17].reduce((a, i) => [a[0] + p[i][0] / 5, a[1] + p[i][1] / 5], [0, 0]);
  return {
    size, up, count, pinch, touch, palm,
    open: count === 4 && !pinch,
    fist: curled.every(Boolean),
    at: [(p[4][0] + p[8][0]) / 2, (p[4][1] + p[8][1]) / 2], // where a pinch holds things
  };
}

// Semitones above the root of each five- or six-note scale.
const SCALES = { mayor: [0, 2, 4, 7, 9], menor: [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10], japonesa: [0, 1, 5, 7, 8] };
const NOTE_NAMES = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];

// MIDI number of the n-th step (any integer) of a scale starting at root.
function scaleNote(scale, n, root = 60) {
  const s = SCALES[scale] ?? SCALES.mayor, len = s.length;
  return root + 12 * Math.floor(n / len) + s[((n % len) + len) % len];
}

const midiFreq = m => 440 * 2 ** ((m - 69) / 12);
const noteName = m => NOTE_NAMES[((m % 12) + 12) % 12];

if (typeof module === 'object') module.exports = { findBlobs, matchTracks, stepTracks, seeHands, stepHands, trackSwipe, seqFrame, coverScale, hexToRgb, seeMarks, stepMarks, readHand, scaleNote, midiFreq, noteName, TTL, MAX_TRACKS, SCENE_MS, SWIPE_REST };
