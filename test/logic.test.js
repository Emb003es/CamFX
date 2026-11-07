// node --test test/logic.test.js
const test = require('node:test');
const assert = require('node:assert');
const { findBlobs, matchTracks, stepTracks, seeHands, stepHands, trackSwipe, seqFrame, coverScale, hexToRgb, seeMarks, stepMarks, readHand, scaleNote, midiFreq, noteName, TTL, MAX_TRACKS, SCENE_MS, SWIPE_REST } = require('../web/logic.js');

// One wrist moving by dx every 33 ms; returns the direction of each swipe it fired.
function moveHand(sw, from, dx, frames, t0 = 0) {
  const fired = [];
  for (let i = 0; i < frames; i++) {
    const d = trackSwipe(sw, [from + dx * i], t0 + i * 33);
    if (d) fired.push(d);
  }
  return fired;
}

test('a fast hand fires one swipe with its direction, a slow one none', () => {
  assert.deepStrictEqual(moveHand({}, 0.2, 0.05, 12), [1]);
  assert.deepStrictEqual(moveHand({}, 0.8, -0.05, 12), [-1]);
  assert.deepStrictEqual(moveHand({}, 0.1, 0.01, 40), [], 'slow gestures are not swipes');
  assert.deepStrictEqual(moveHand({}, 0.5, 0.05, 2), [], 'too short a move is not a swipe');
});

test('a swipe survives the detector losing the hand for a moment, not for long', () => {
  const sw = {};
  trackSwipe(sw, [0.2], 0);
  trackSwipe(sw, [0.26], 33);
  trackSwipe(sw, [], 200);
  assert.strictEqual(trackSwipe(sw, [0.45], 330), 1, 'came back further along after 300 ms');
  const gap = {};
  trackSwipe(gap, [0.2], 0);
  trackSwipe(gap, [0.3], 33);
  trackSwipe(gap, [], 500);
  assert.strictEqual(trackSwipe(gap, [0.45], 533), 0, 'half a second away ends it');
});

test('sensitivity scales the swipe, and zero turns it off', () => {
  const slow = (s) => { const sw = {}, fired = []; for (let i = 0; i < 12; i++) { const d = trackSwipe(sw, [0.1 + 0.015 * i], i * 33, s); if (d) fired.push(d); } return fired; };
  assert.deepStrictEqual(slow(0.6), [], 'about 0.45 widths per second is under the default');
  assert.deepStrictEqual(slow(1), [1]);
  assert.deepStrictEqual(moveHand({ }, 0.1, 0.05, 12).length, 1);
  const off = {};
  for (let i = 0; i < 12; i++) assert.strictEqual(trackSwipe(off, [0.1 + 0.05 * i], i * 33, 0), 0);
});

test('swipes rest before firing again, and the other hand does not count as movement', () => {
  const sw = {};
  assert.deepStrictEqual(moveHand(sw, 0.1, 0.05, 8), [1]);
  assert.deepStrictEqual(moveHand(sw, 0.5, -0.05, 8, 300), [], 'too soon after the last one');
  assert.deepStrictEqual(moveHand(sw, 0.9, -0.05, 8, 300 + SWIPE_REST), [-1]);
  const two = {};
  trackSwipe(two, [0.1], 0);
  assert.strictEqual(trackSwipe(two, [0.1, 0.9], 33), 0, 'a second hand appearing is not a jump');
});

test('the anime sequence loops, shakes at its cuts and is still in between', () => {
  const a = seqFrame('anime', 0), b = seqFrame('anime', SCENE_MS);
  assert.notStrictEqual(a.bg, b.bg);
  assert.strictEqual(seqFrame('anime', SCENE_MS * 6).bg, a.bg);
  assert.strictEqual(a.glitch, 1);
  assert.ok(seqFrame('anime', SCENE_MS / 2).glitch <= 0);
  const c = seqFrame('collage', 0);
  assert.notStrictEqual(seqFrame('collage', 125).front, c.front, 'the pile churns');
  assert.strictEqual(seqFrame('collage', 500).front, c.front);
});

test('sheets need both hands, ease towards them and go when the hands go', () => {
  const web = {};
  seeHands(web, [[0, 0]], 0);
  assert.strictEqual(web.pts, undefined, 'one hand is not enough');
  seeHands(web, [[0, 0], [1, 1]], 0);
  assert.deepStrictEqual(web.pts, [0, 0, 1, 1], 'starts on the hands, not flying in');
  seeHands(web, [[0.5, 0]], 1);
  assert.deepStrictEqual(web.target, [0, 0, 1, 1], 'losing one hand keeps the last pair');
  seeHands(web, [[0.5, 0], [1, 1]], 1);
  stepHands(web, 1, 0.5);
  assert.deepStrictEqual(web.pts, [0.25, 0, 1, 1]);
  stepHands(web, TTL + 2, 0.5);
  assert.strictEqual(web.pts, null);
  stepHands(web, TTL + 3, 0.5); // and nothing to do afterwards
});

test('a background covers the frame and only crops the axis that overflows', () => {
  assert.deepStrictEqual(coverScale(1920, 1080, 1920, 1080), [1, 1]);
  assert.deepStrictEqual(coverScale(1920, 1080, 1080, 1920).map(v => +v.toFixed(4)), [1, 0.3164]); // tall photo: crop height
  assert.deepStrictEqual(coverScale(1080, 1080, 1920, 1080), [0.5625, 1]);                         // wide photo: crop width
});

test('hex colours become 0..1 channels', () => {
  assert.deepStrictEqual(hexToRgb('#ff0033'), [1, 0, 0.2]);
});

function mask(W, H, rects) {
  const m = new Uint8Array(W * H);
  for (const [x, y, w, h] of rects) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) m[j * W + i] = 1;
  }
  return m;
}

test('separate blobs give separate tight boxes', () => {
  const boxes = findBlobs(mask(20, 20, [[1, 1, 3, 2], [10, 5, 2, 4]]), 20, 20, 2);
  assert.deepStrictEqual(boxes, [[1 / 20, 1 / 20, 3 / 20, 2 / 20], [10 / 20, 5 / 20, 2 / 20, 4 / 20]]);
});

test('blobs under the minimum size are dropped', () => {
  assert.deepStrictEqual(findBlobs(mask(20, 10, [[1, 1, 1, 1], [5, 5, 3, 3]]), 20, 10, 4).length, 1);
});

test('a huge blob is split, keeping every cell covered and inside the size limit', () => {
  const W = 40, H = 20, boxes = findBlobs(mask(W, H, [[0, 0, W, H]]), W, H, 1, 0.3);
  assert.ok(boxes.length > 1);
  let area = 0;
  for (const [, , w, h] of boxes) {
    assert.ok(w <= 0.3 + 1 / W && h <= 0.3 + 1 / H);
    area += w * h;
  }
  assert.ok(Math.abs(area - 1) < 1e-9);
});

test('an empty mask gives nothing', () => {
  assert.deepStrictEqual(findBlobs(new Uint8Array(100), 10, 10, 1), []);
});

test('a detection continues the nearest track of its kind and opens new ones elsewhere', () => {
  const tracks = [];
  matchTracks(tracks, 'motion', [[0.1, 0.1, 0.1, 0.1]], 0);
  matchTracks(tracks, 'motion', [[0.12, 0.1, 0.1, 0.1], [0.7, 0.7, 0.1, 0.1]], 10);
  assert.strictEqual(tracks.length, 2);
  assert.strictEqual(tracks[0].tx, 0.12);
  assert.strictEqual(tracks[0].x, 0.1);
  matchTracks(tracks, 'face', [[0.12, 0.1, 0.1, 0.1]], 20);
  assert.strictEqual(tracks.length, 3);
  assert.strictEqual(tracks[2].kind, 'face', 'faces are drawn over motion');
});

test('tracks ease towards their target and expire', () => {
  const tracks = [];
  matchTracks(tracks, 'face', [[0, 0, 0.2, 0.2]], 0);
  matchTracks(tracks, 'face', [[0.1, 0, 0.2, 0.2]], 0);
  stepTracks(tracks, 1, 0.5);
  assert.strictEqual(tracks[0].x, 0.05);
  stepTracks(tracks, TTL + 1, 0.5);
  assert.strictEqual(tracks.length, 0);
});

test('the number of tracks is capped', () => {
  const tracks = [], dets = [];
  for (let i = 0; i < MAX_TRACKS + 5; i++) dets.push([(i % 8) / 8, (i >> 3) / 8, 0.01, 0.01]);
  matchTracks(tracks, 'motion', dets, 0);
  assert.strictEqual(tracks.length, MAX_TRACKS);
});

// A right hand facing the camera, wrist at the bottom, in px. Each finger is [knuckle, pip, dip, tip].
function hand({ curl = [false, false, false, false], thumbOn = -1 } = {}) {
  const p = [[0, 0], [-25, -20], [-45, -40], [-60, -60], [-75, -75]];
  [-30, -10, 10, 30].forEach((x, i) => {
    p.push([x, -90], [x, -120]);
    p.push(...(curl[i] ? [[x, -95], [x, -70]] : [[x, -140], [x, -160]]));
  });
  if (thumbOn >= 0) { p[4] = p[[8, 12, 16, 20][thumbOn]].slice(); p[4][0] -= 4; p[3] = [p[4][0] - 15, p[4][1] + 20]; }
  return p;
}

test('a hand reads as open, as a fist, as a pinch or as a thumb on one finger', () => {
  const open = readHand(hand());
  assert.ok(open.open && !open.fist && !open.pinch);
  assert.strictEqual(open.count, 4);
  assert.strictEqual(open.touch, -1);
  const fist = readHand(hand({ curl: [true, true, true, true] }));
  assert.ok(fist.fist && !fist.open && !fist.pinch && fist.count === 0);
  const pinch = readHand(hand({ thumbOn: 0 }));
  assert.ok(pinch.pinch && !pinch.open);
  assert.strictEqual(pinch.touch, 0);
  assert.strictEqual(readHand(hand({ thumbOn: 2 })).touch, 2, 'the ring finger');
  assert.ok(!readHand(hand({ thumbOn: 2 })).pinch, 'only the index pinches');
});

test('a pinch needs to open wider to end than to start', () => {
  const p = hand();
  p[4] = [p[8][0] - 0.38 * 90, p[8][1]]; // between the two thresholds
  assert.ok(!readHand(p).pinch, 'not yet a pinch');
  assert.ok(readHand(p, { pinch: true }).pinch, 'still a pinch');
  assert.strictEqual(readHand(p, { touch: 0 }).touch, 0);
  assert.strictEqual(readHand(p).touch, -1);
});

test('hands keep their id while they move, and go after a while unseen', () => {
  const hs = {}, at = (x) => Array.from({ length: 42 }, (_, i) => i % 2 ? 0.5 : x);
  seeMarks(hs, [at(0.2), at(0.8)], 0);
  const [a, b] = hs.list.map(h => h.id);
  seeMarks(hs, [at(0.78), at(0.25)], 30);
  assert.deepStrictEqual(hs.list.map(h => h.id), [a, b]);
  assert.strictEqual(hs.list[0].target[0], 0.25);
  stepMarks(hs, 31, 0.5);
  assert.strictEqual(hs.list[0].pts[0], 0.225);
  seeMarks(hs, [at(0.25)], 200);
  stepMarks(hs, 30 + TTL + 1, 0.5);
  assert.deepStrictEqual(hs.list.map(h => h.id), [a], 'the unseen hand went');
});

test('scale steps wrap into octaves', () => {
  assert.strictEqual(scaleNote('mayor', 0), 60);
  assert.strictEqual(scaleNote('mayor', 5), 72);
  assert.strictEqual(scaleNote('mayor', -1), 57);
  assert.strictEqual(scaleNote('blues', 6), 72, 'six notes');
  assert.strictEqual(midiFreq(69), 440);
  assert.strictEqual(noteName(scaleNote('mayor', 3)), 'Sol');
});
