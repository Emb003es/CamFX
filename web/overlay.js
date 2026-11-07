// Draws every floating window in one instanced draw call, once per camera frame.
const S = loadSettings();
const chan = new BroadcastChannel('camfx');
const video = document.getElementById('v'), canvas = document.getElementById('c');
const isStage = top !== self; // in the app's preview: a fixed output size, whatever the window measures
const OUT_W = 1920, OUT_H = 1080;
if (isStage) document.documentElement.style.background = '#000'; // or the letterbox bars show up white
const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });

const VS = `#version 300 es
layout(location=0) in vec2 corner;
layout(location=1) in vec4 rect;   // whole window in px: x, y, w, h
layout(location=2) in vec2 info;   // stored frame (-1 = live), title row (-1 = none)
uniform vec2 screen;
uniform float margin;
out vec2 p;
flat out vec4 r;
flat out vec2 i;
void main() {
  p = rect.xy - margin + corner * (rect.zw + 2. * margin);
  r = rect;
  i = info;
  gl_Position = vec4(p / screen * vec2(2., -2.) + vec2(-1., 1.), 0., 1.);
}`;

const FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 p;
flat in vec4 r;
flat in vec2 i;
uniform sampler2D live, titles;
uniform sampler2DArray ring;
uniform vec4 cam;   // camera frame on screen in px: x, y, w, h
uniform float mirror, bar, unit, titleW, rows, lightsEnd;
out vec4 o;
float rbox(vec2 q, vec2 h, float rad) {
  vec2 d = abs(q) - h + rad;
  return length(max(d, 0.)) + min(max(d.x, d.y), 0.) - rad;
}
void main() {
  vec2 h = r.zw * .5, c = r.xy + h;
  float rad = 8. * unit, d = rbox(p - c, h, rad);
  if (d > .5) {
    float s = max(rbox(p - c - vec2(0., 5. * unit), h, rad), 0.) / (14. * unit);
    o = vec4(0., 0., 0., .5 * exp(-2. * s * s));
    return;
  }
  vec2 q = p - r.xy;
  vec3 col;
  if (q.y < bar) {
    col = vec3(.2, .2, .22);
    for (int k = 0; k < 3; k++) {
      float l = length(q - vec2((15. + float(k) * 18.) * unit, bar * .5));
      col = mix(col, vec3(.43, .43, .46), clamp(5.5 * unit - l + .5, 0., 1.));
    }
    if (i.y >= 0. && q.x > lightsEnd) {
      vec2 t = vec2((q.x - (lightsEnd + r.z) * .5) / titleW + .5, (i.y + q.y / bar) / rows);
      col = mix(col, vec3(.82), texture(titles, t).r);
    }
  } else {
    vec2 uv = (p - cam.xy) / cam.zw;
    if (mirror > .5) uv.x = 1. - uv.x;
    col = i.x < 0. ? texture(live, uv).rgb : texture(ring, vec3(uv, i.x)).rgb;
  }
  col = mix(col, vec3(.45), smoothstep(-1.5 * unit, -.5 * unit, d));
  float a = clamp(.5 - d, 0., 1.);
  o = vec4(col * a, a);
}`;

const BG_VS = `#version 300 es
uniform vec2 scale;
out vec2 uv;
void main() {
  vec2 s = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 4. - 1.; // one triangle over the whole frame
  uv = vec2(s.x, -s.y) * .5 * scale + .5;
  gl_Position = vec4(s, 0., 1.);
}`;

const BG_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D bg;
out vec4 o;
void main() { o = vec4(texture(bg, uv).rgb, 1.); }`;

function compile(vs, fs) {
  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  return prog;
}

const bgProg = compile(BG_VS, BG_FS);
gl.useProgram(bgProg);
const bgSampler = gl.getUniformLocation(bgProg, 'bg'), bgScale = gl.getUniformLocation(bgProg, 'scale');
gl.uniform1i(bgSampler, 3);
const webProg = compile(BG_VS, WEB_FS);
gl.useProgram(webProg);
const WU = {};
for (const name of ['scale', 'live', 'screen', 'tips', 'cam', 'mirror', 'unit']) WU[name] = gl.getUniformLocation(webProg, name);
gl.uniform1i(WU.live, 0);
gl.uniform2f(WU.scale, 1, 1);
const seqProg = compile(BG_VS, SEQ_FS);
gl.useProgram(seqProg);
const SU = {};
for (const name of ['scale', 'live', 'mask', 'art', 'screen', 'frontPos', 'cam', 'mirror', 'unit', 'time', 'cut', 'dir', 'glitch', 'frontAng', 'frontScale', 'entering', 'style', 'bgLayer', 'frontLayer', 'personMode']) {
  SU[name] = gl.getUniformLocation(seqProg, name);
}
gl.uniform1i(SU.live, 0);
gl.uniform1i(SU.art, 4);
gl.uniform1i(SU.mask, 5);
gl.uniform2f(SU.scale, 1, 1);
const hudProg = compile(BG_VS, `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D hud;
out vec4 o;
void main() { o = texture(hud, uv); }`);
gl.useProgram(hudProg);
gl.uniform1i(gl.getUniformLocation(hudProg, 'hud'), 6);
gl.uniform2f(gl.getUniformLocation(hudProg, 'scale'), 1, 1);
const prog = compile(VS, FS);
gl.useProgram(prog);
const U = {};
for (const name of ['screen', 'margin', 'live', 'titles', 'ring', 'cam', 'mirror', 'bar', 'unit', 'titleW', 'rows', 'lightsEnd']) {
  U[name] = gl.getUniformLocation(prog, name);
}

function texture(unit, target) {
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(target, tex);
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

const RING_W = 960, RING_H = 540;
const live = texture(0, gl.TEXTURE_2D);
const ring = texture(1, gl.TEXTURE_2D_ARRAY);
gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, RING_W, RING_H, HIST);
texture(3, gl.TEXTURE_2D); // background image or video
texture(5, gl.TEXTURE_2D); // the person's silhouette; its mipmaps tell how deep inside the body a pixel is
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
const hudTex = texture(6, gl.TEXTURE_2D); // the finger effects' 2D canvas
const readFb = gl.createFramebuffer(), drawFb = gl.createFramebuffer();
gl.uniform1i(U.live, 0);
gl.uniform1i(U.ring, 1);
gl.uniform1i(U.titles, 2);

// Title bar sizes, all in device pixels.
const unit = isStage ? 1 : devicePixelRatio;
const bar = 24 * unit, lightsEnd = 61 * unit, titleW = 150 * unit, margin = 28 * unit;
const minW = 76 * unit, minH = 22 * unit;

const TITLES = { face: ['face'], body: ['body'], eyes: ['eyes'], mouth: ['mouth'], motion: ['motion', 'moti…', 'mo…'], threshold: ['threshold', 'thres…', 'th…'] };
const variants = {};
{
  const rows = Object.values(TITLES).flat();
  const atlas = document.createElement('canvas');
  atlas.width = titleW;
  atlas.height = bar * rows.length;
  const ctx = atlas.getContext('2d');
  ctx.fillRect(0, 0, atlas.width, atlas.height);
  ctx.fillStyle = '#fff';
  ctx.font = `${12 * unit}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let row = 0;
  for (const [kind, texts] of Object.entries(TITLES)) {
    variants[kind] = texts.map(text => {
      ctx.fillText(text, titleW / 2, (row + 0.5) * bar);
      return { row: row++, width: ctx.measureText(text).width };
    });
  }
  texture(2, gl.TEXTURE_2D);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
  gl.uniform1f(U.rows, rows.length);
}
gl.uniform1f(U.margin, margin);
gl.uniform1f(U.bar, bar);
gl.uniform1f(U.unit, unit);
gl.uniform1f(U.titleW, titleW);
gl.uniform1f(U.lightsEnd, lightsEnd);

const STRIDE = 6;
const inst = new Float32Array(MAX_TRACKS * HIST * STRIDE);
gl.bindVertexArray(gl.createVertexArray());
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, inst.byteLength, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 4, gl.FLOAT, false, STRIDE * 4, 0);
gl.vertexAttribDivisor(1, 1);
gl.enableVertexAttribArray(2);
gl.vertexAttribPointer(2, 2, gl.FLOAT, false, STRIDE * 4, 16);
gl.vertexAttribDivisor(2, 1);
gl.enable(gl.BLEND);
gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
gl.clearColor(0, 0, 0, 0);

const cam = { x: 0, y: 0, w: 1, h: 1 };

function layout() {
  // shortcut: reloading drops a video source back to the camera, fine for moving to a monitor with another scale
  if (!isStage && devicePixelRatio !== unit) location.reload();
  canvas.width = isStage ? OUT_W : innerWidth * unit;
  canvas.height = isStage ? OUT_H : innerHeight * unit;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(U.screen, canvas.width, canvas.height);
  if (!video.videoWidth) return;
  const s = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
  cam.w = video.videoWidth * s;
  cam.h = video.videoHeight * s;
  cam.x = (canvas.width - cam.w) / 2;
  cam.y = (canvas.height - cam.h) / 2;
  gl.uniform4f(U.cam, cam.x, cam.y, cam.w, cam.h);
}
addEventListener('resize', layout);
video.addEventListener('resize', layout);
layout();

const tracks = [], web = {}, swipe = {};
const seq = { on: false, t0: -1e9, start: 0, dir: 1, face: null };
const isSeq = () => S.effect === 'anime' || S.effect === 'collage';
const isFingers = () => FINGER_EFFECTS.includes(S.effect);
const fingerHands = {}, fingerFace = { cur: null, target: null, seen: 0 };
let count = 0;

function put(x, y, w, h, frame, kind) {
  let pw = w * cam.w, ph = h * cam.h;
  let px = (S.mirror ? 1 - x - w : x) * cam.w + cam.x, py = y * cam.h + cam.y;
  if (pw < minW) { px -= (minW - pw) / 2; pw = minW; }
  if (ph < minH) { py -= (minH - ph) / 2; ph = minH; }
  let row = -1;
  if (S.labels) {
    const room = pw - lightsEnd - 6 * unit;
    const fit = variants[kind].find(v => v.width <= room);
    if (fit) row = fit.row;
  }
  const i = count++ * STRIDE;
  inst[i] = px; inst[i + 1] = py - bar; inst[i + 2] = pw; inst[i + 3] = ph + bar;
  inst[i + 4] = frame; inst[i + 5] = row;
}

let frameNo = 0, snaps = 0;

// Every other frame: keep a small copy of the frame and each window's position, for the trails.
function snapshot() {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFb);
  gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, live, 0);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawFb);
  gl.framebufferTextureLayer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, ring, 0, snaps % HIST);
  gl.blitFramebuffer(0, 0, video.videoWidth, video.videoHeight, 0, 0, RING_W, RING_H, gl.COLOR_BUFFER_BIT, gl.LINEAR);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  snaps++;
  for (const t of tracks) {
    const i = t.n++ % HIST * 4;
    t.hist[i] = t.x; t.hist[i + 1] = t.y; t.hist[i + 2] = t.w; t.hist[i + 3] = t.h;
  }
}

let hadPicture = false;

function draw() {
  const webs = S.effect === 'webs', windows = S.effect === 'windows', fingers = isFingers();
  count = 0;
  if (windows) for (const t of tracks) {
    for (let k = Math.min(S.trail, t.n, HIST - 1); k >= 1; k--) {
      const i = (t.n - k) % HIST * 4, h = t.hist;
      // A copy that has not moved would be hidden behind the window anyway.
      if (Math.abs(h[i] - t.x) + Math.abs(h[i + 1] - t.y) < 0.002) continue;
      put(h[i], h[i + 1], h[i + 2], h[i + 3], (snaps - k) % HIST, t.kind);
    }
    put(t.x, t.y, t.w, t.h, -1, t.kind);
  }
  const picture = windows ? count > 0 : webs ? !!web.pts : fingers || seq.on || performance.now() - seq.t0 < CUT_MS;
  if (S.bg === 'desktop' && !picture && !hadPicture) return; // an empty layer stays as it is: nothing to composite
  hadPicture = picture;
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst, 0, count * STRIDE);
  gl.uniform1f(U.mirror, S.mirror ? 1 : 0);
  if (S.bg === 'desktop') gl.clearColor(0, 0, 0, 0);
  else gl.clearColor(...hexToRgb(S.bgColor), 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (S.bg === 'file' && bgReady) drawBackground();
  if (S.bg === 'camera' && video.videoWidth) drawCamera();
  if (windows) gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  else if (webs) { if (web.pts) drawWebs(); }
  else if (fingers) drawFingers();
  else drawSeq();
}

const CUT_MS = 800; // how long the cut between the camera and a scene takes

function toggleSeq(dir) {
  seq.on = !seq.on;
  seq.t0 = performance.now();
  seq.dir = dir;
  if (seq.on) seq.start = seq.t0;
}

function drawSeq() {
  const now = performance.now(), cut = Math.min((now - seq.t0) / CUT_MS, 1);
  if (!seq.on && cut >= 1) return;
  const f = seqFrame(S.effect, now - seq.start);
  let { scale, ang } = f, x = canvas.width / 2, y = canvas.height / 2, front = f.front;
  if (f.onFace) {
    // The mask shrinks onto the face; without a face it stays off rather than floating in the wrong place.
    if (seq.face) {
      const [fx, fy, fw, fh] = seq.face;
      x = (S.mirror ? 1 - fx - fw / 2 : fx + fw / 2) * cam.w + cam.x;
      y = (fy + fh / 2) * cam.h + cam.y;
      scale = fw * cam.w / canvas.width * 1.2;
    } else front = -1;
  }
  gl.useProgram(seqProg);
  gl.uniform2f(SU.screen, canvas.width, canvas.height);
  gl.uniform4f(SU.cam, cam.x, cam.y, cam.w, cam.h);
  gl.uniform2f(SU.frontPos, x, y);
  gl.uniform1f(SU.mirror, S.mirror ? 1 : 0);
  gl.uniform1f(SU.unit, unit);
  gl.uniform1f(SU.time, now / 1000 % 1000);
  gl.uniform1f(SU.cut, cut);
  gl.uniform1f(SU.dir, seq.dir);
  gl.uniform1f(SU.glitch, Math.max(f.glitch, cut < 1 && S.effect === 'anime' ? 1 - cut : 0));
  gl.uniform1f(SU.frontAng, ang);
  gl.uniform1f(SU.frontScale, scale);
  gl.uniform1i(SU.entering, seq.on ? 1 : 0);
  gl.uniform1i(SU.style, S.effect === 'collage' ? 1 : 0);
  gl.uniform1i(SU.bgLayer, f.bg);
  gl.uniform1i(SU.frontLayer, front);
  gl.uniform1i(SU.personMode, f.person);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.useProgram(prog);
}

// The scene art is only painted the first time its effect is chosen, and again when its words change.
const arts = {};
let wordsTimer;
function useArt() {
  if (!isSeq()) return;
  if (!arts[S.effect]) {
    arts[S.effect] = texture(4, gl.TEXTURE_2D_ARRAY);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, ART_W, ART_H, ART_LAYERS[S.effect]);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    let n = 0;
    paintArt(S.effect, c => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, n++, ART_W, ART_H, 1, gl.RGBA, gl.UNSIGNED_BYTE, c), S);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }
  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, arts[S.effect]);
}

function drawBackground() {
  if (bgVideo.src && bgVideo.readyState >= 2) {
    gl.activeTexture(gl.TEXTURE3);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bgVideo);
  }
  gl.useProgram(bgProg);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.useProgram(prog);
}

// The live frame as background. Changing to a file background sets its own scale again in fitBackground.
function drawCamera() {
  const [sx, sy] = coverScale(canvas.width, canvas.height, video.videoWidth, video.videoHeight);
  gl.useProgram(bgProg);
  gl.uniform1i(bgSampler, 0);
  gl.uniform2f(bgScale, S.mirror ? -sx : sx, sy);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.uniform1i(bgSampler, 3);
  gl.useProgram(prog);
}

function drawWebs() {
  const tips = web.pts.map((v, i) => i % 2 ? v * cam.h + cam.y : (S.mirror ? 1 - v : v) * cam.w + cam.x);
  gl.useProgram(webProg);
  gl.uniform2f(WU.screen, canvas.width, canvas.height);
  gl.uniform2fv(WU.tips, tips);
  gl.uniform4f(WU.cam, cam.x, cam.y, cam.w, cam.h);
  gl.uniform1f(WU.mirror, S.mirror ? 1 : 0);
  gl.uniform1f(WU.unit, unit);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.useProgram(prog);
}

// The hands and face in px on screen, handed to fingers.js, whose 2D canvas then goes over the picture.
function drawFingers() {
  if (hud.width !== canvas.width || hud.height !== canvas.height) { hud.width = canvas.width; hud.height = canvas.height; }
  const px = (x, y) => [(S.mirror ? 1 - x : x) * cam.w + cam.x, y * cam.h + cam.y];
  const hands = (fingerHands.list ?? []).map(h => ({ id: h.id, p: Array.from({ length: 21 }, (_, i) => px(h.pts[i * 2], h.pts[i * 2 + 1])) }));
  let face = null;
  const f = fingerFace.cur;
  if (f) {
    const [x0, y] = px(f[0], f[1]), [x1] = px(f[0] + f[2], f[1]), x = Math.min(x0, x1), w = Math.abs(x1 - x0), h = f[3] * cam.h;
    face = { x, y, w, h, cx: x + w / 2, mouth: f.length > 4 ? px(f[10], f[11]) : [x + w / 2, y + h * 0.68], eyes: f.length > 4 ? [px(f[4], f[5]), px(f[6], f[7])] : null };
  }
  fingersFrame(S.effect, { now: performance.now(), hands, face, W: canvas.width, H: canvas.height, S, sound: s => chan.postMessage({ sound: s }) });
  gl.activeTexture(gl.TEXTURE6);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, hud);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.useProgram(hudProg);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.useProgram(prog);
}

// The face eases like the hands, and goes after a while unseen.
function stepFace(now) {
  if (!fingerFace.target || now - fingerFace.seen > 600) { fingerFace.cur = null; return; }
  if (!fingerFace.cur || fingerFace.cur.length !== fingerFace.target.length) fingerFace.cur = fingerFace.target.slice();
  fingerFace.cur.forEach((v, i) => { fingerFace.cur[i] += (fingerFace.target[i] - v) * 0.5; });
}

const worker = new Worker('tracker.worker.js');
let busy = false, detectMs = 0, lastError = '';

worker.onerror = e => { lastError = `Detector: ${e.message}`; };
worker.onmessage = ({ data }) => {
  busy = false;
  if (data.error) lastError = data.error;
  if (data.ms !== undefined) detectMs += (data.ms - detectMs) * 0.1;
  if (data.hands) seeHands(web, data.hands, performance.now());
  if (data.wrists && isSeq()) {
    const dir = trackSwipe(swipe, data.wrists, performance.now(), S.gesture);
    if (dir) toggleSeq(S.mirror ? -dir : dir);
  }
  if (data.mask) {
    gl.activeTexture(gl.TEXTURE5);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, data.mask.w, data.mask.h, 0, gl.RED, gl.UNSIGNED_BYTE, data.mask.data);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
  if (isSeq()) {
    if (data.face) seq.face = data.face[0] ?? null;
    return; // the tracks below are the windows effect's
  }
  if (isFingers()) {
    if (data.marks) seeMarks(fingerHands, data.marks, performance.now());
    if (data.face?.length) {
      fingerFace.target = [...data.face[0], ...(data.kp?.[0] ?? [])];
      fingerFace.seen = performance.now();
    }
    return;
  }
  for (const kind of KINDS) {
    if (!S[kind]) continue;
    if (data[kind]) matchTracks(tracks, kind, data[kind], performance.now());
  }
};

function feedTracker() {
  if (busy) return;
  busy = true;
  const w = S.effect === 'windows' ? 320 : 640; // fingers need more pixels than a face
  createImageBitmap(video, { resizeWidth: w, resizeHeight: Math.round(w * video.videoHeight / video.videoWidth), resizeQuality: 'low' })
    .then(bitmap => worker.postMessage({ bitmap, opts: { ...S, scene: seq.on } }, [bitmap]))
    .catch(() => { busy = false; });
}

let renderMs = 0, frames = 0, statT = performance.now();

function onFrame() {
  video.requestVideoFrameCallback(onFrame);
  const t0 = performance.now();
  gl.activeTexture(gl.TEXTURE0);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  if (++frameNo % 2 === 0 && S.trail > 0 && S.effect === 'windows') snapshot();
  stepTracks(tracks, t0, 0.45);
  stepHands(web, t0, 0.6);
  stepMarks(fingerHands, t0, 0.65);
  stepFace(t0);
  feedTracker();
  draw();
  const t1 = performance.now();
  renderMs += (t1 - t0 - renderMs) * 0.1;
  frames++;
  if (t1 - statT > 500) {
    chan.postMessage({ stats: { windows: tracks.length, hands: !!web.pts, fingers: fingerHands.list?.length ?? 0, scene: seq.on, fps: Math.round(frames * 1000 / (t1 - statT)), detectMs, renderMs, error: lastError } });
    frames = 0;
    statT = t1;
  }
}
video.requestVideoFrameCallback(onFrame);

let source = 'camera', sourceError = '', devices = [], sourceRun = 0, retryTimer;
const NO_ANSWER = 'Esta cámara no responde. Elige otra en la lista.';
const NO_PICTURE = 'Este vídeo no tiene imagen que se pueda leer. Suele pasar con HEVC/H.265, el formato del iPhone: usa un MP4 H.264.';

const bgVideo = document.createElement('video');
bgVideo.muted = bgVideo.loop = true;
let bgReady = false, bgError = '', bgRun = 0, bgUrl = '';

const sendStatus = () => chan.postMessage({ status: { source, sourceError, devices, deviceId: S.deviceId, bgError } });

function fitBackground(w, h) {
  gl.useProgram(bgProg);
  gl.uniform2f(bgScale, ...coverScale(canvas.width, canvas.height, w, h));
  gl.useProgram(prog);
  bgReady = true;
}

async function loadBackground() {
  const run = ++bgRun;
  bgReady = false;
  bgError = '';
  bgVideo.pause();
  bgVideo.removeAttribute('src');
  URL.revokeObjectURL(bgUrl);
  if (S.bg === 'file') try {
    const file = await bgStore('readonly');
    if (run !== bgRun) return;
    if (file) {
      bgUrl = URL.createObjectURL(file);
      if (file.type.startsWith('video/')) {
        bgVideo.src = bgUrl;
        await bgVideo.play();
        if (run !== bgRun) return;
        if (!bgVideo.videoWidth) throw new Error(NO_PICTURE);
        fitBackground(bgVideo.videoWidth, bgVideo.videoHeight);
      } else {
        const img = new Image();
        img.src = bgUrl;
        await img.decode();
        if (run !== bgRun) return;
        gl.activeTexture(gl.TEXTURE3);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        fitBackground(img.naturalWidth, img.naturalHeight);
      }
    }
  } catch (e) {
    if (run !== bgRun) return;
    bgVideo.removeAttribute('src');
    bgError = e.message === NO_PICTURE ? NO_PICTURE : `No se puede abrir el fondo: ${e.message}`;
  }
  sendStatus();
  draw();
}

function stopSource() {
  clearTimeout(retryTimer);
  video.srcObject?.getTracks().forEach(t => t.stop());
  video.srcObject = null;
  video.removeAttribute('src');
  video.load();
  tracks.length = 0;
  web.pts = null;
  draw(); // without new frames the last windows would stay frozen on screen
}

async function listDevices() {
  devices = (await navigator.mediaDevices.enumerateDevices())
    .filter(d => d.kind === 'videoinput')
    .map(d => ({ id: d.deviceId, label: d.label || 'Cámara' }));
  sendStatus();
}

async function useCamera() {
  stopSource();
  source = 'camera';
  const run = ++sourceRun;
  // A dying webcam can leave this hanging forever, and the panel must still offer the other cameras.
  retryTimer = setTimeout(() => {
    sourceError = NO_ANSWER;
    listDevices();
  }, 5000);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      // exact: with ideal, Chromium opened a broken webcam instead of the camera the user chose.
      video: { deviceId: S.deviceId ? { exact: S.deviceId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
    if (run !== sourceRun) { stream.getTracks().forEach(t => t.stop()); return; }
    video.srcObject = stream;
    await video.play();
    clearTimeout(retryTimer);
    sourceError = '';
  } catch (e) {
    if (run !== sourceRun) return;
    clearTimeout(retryTimer);
    if (e.name === 'NotFoundError') sourceError = 'No hay ninguna cámara conectada.';
    else if (e.name === 'OverconstrainedError') sourceError = 'Esa cámara ya no está. Elige otra en la lista.';
    else if (e.name === 'AbortError') sourceError = NO_ANSWER;
    else if (e.name === 'NotReadableError') {
      sourceError = 'La cámara está ocupada por otra app (Cámara, Discord…). Arrancará sola cuando la cierres.';
      retryTimer = setTimeout(useCamera, 2000); // nothing announces that a camera got free
    } else sourceError = `Sin cámara: ${e.message}`;
  }
  await listDevices();
}

// A webcam plugged in or pulled out while the app is open.
navigator.mediaDevices.ondevicechange = () => {
  if (source === 'camera' && !video.srcObject?.active) useCamera();
  else listDevices();
};

async function useVideo(url) {
  stopSource();
  source = 'video';
  const run = ++sourceRun;
  video.src = url;
  video.loop = true;
  try {
    await video.play();
    if (run !== sourceRun) return;
    sourceError = '';
    // An undecodable picture raises no error: the audio just plays on, with no frames ever.
    if (!video.videoWidth) {
      stopSource();
      sourceError = NO_PICTURE;
    }
  } catch (e) {
    if (run !== sourceRun) return;
    sourceError = `No se puede abrir: ${e.message}`;
  }
  sendStatus();
}

chan.onmessage = ({ data }) => {
  if (data.useCamera) useCamera();
  if (data.useVideo) useVideo(data.useVideo);
  if (data.seqToggle && isSeq()) toggleSeq(1);
  if (data.lifeReset) resetLife();
  if (data.settings) {
    const changedDevice = data.settings.deviceId !== S.deviceId;
    const changedBg = data.settings.bg !== S.bg || data.settings.bgStamp !== S.bgStamp;
    const changedEffect = data.settings.effect !== S.effect;
    const changedWords = data.settings.title !== S.title || data.settings.subtitle !== S.subtitle;
    Object.assign(S, data.settings);
    if (changedEffect) {
      seq.on = false;
      seq.t0 = -1e9;
      useArt();
    }
    if (changedWords && arts.anime) {
      // Painting the eleven layers takes a moment: once the typing stops, not on every key.
      clearTimeout(wordsTimer);
      wordsTimer = setTimeout(() => {
        gl.deleteTexture(arts.anime);
        delete arts.anime;
        useArt();
      }, 300);
    }
    for (let i = tracks.length - 1; i >= 0; i--) if (!S[tracks[i].kind]) tracks.splice(i, 1);
    if (changedDevice && source === 'camera') useCamera();
    if (changedBg) loadBackground();
    else draw();
  }
};

useArt();
loadBackground();
useCamera();
chan.postMessage({ ready: true });
