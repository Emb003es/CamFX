// node --test test/logic.test.js
const test = require('node:test');
const assert = require('node:assert');
const { findBlobs, matchTracks, stepTracks, seeHands, stepHands, coverScale, hexToRgb, TTL, MAX_TRACKS } = require('../web/logic.js');

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
