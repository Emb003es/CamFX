// Draws every floating window in one instanced draw call, once per camera frame.
const S = loadSettings();
const chan = new BroadcastChannel('camfx');
const video = document.getElementById('v'), canvas = document.getElementById('c');
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

function compile() {
  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]]) {
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

const prog = compile();
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
const readFb = gl.createFramebuffer(), drawFb = gl.createFramebuffer();
gl.uniform1i(U.live, 0);
gl.uniform1i(U.ring, 1);
gl.uniform1i(U.titles, 2);

// Title bar sizes, all in device pixels.
const unit = devicePixelRatio;
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
  if (devicePixelRatio !== unit) location.reload();
  canvas.width = innerWidth * unit;
  canvas.height = innerHeight * unit;
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

const tracks = [];
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

function draw() {
  const hadWindows = count > 0;
  count = 0;
  for (const t of tracks) {
    for (let k = Math.min(S.trail, t.n, HIST - 1); k >= 1; k--) {
      const i = (t.n - k) % HIST * 4, h = t.hist;
      // A copy that has not moved would be hidden behind the window anyway.
      if (Math.abs(h[i] - t.x) + Math.abs(h[i + 1] - t.y) < 0.002) continue;
      put(h[i], h[i + 1], h[i + 2], h[i + 3], (snaps - k) % HIST, t.kind);
    }
    put(t.x, t.y, t.w, t.h, -1, t.kind);
  }
  if (!count && !hadWindows) return; // an empty layer stays as it is: nothing to composite
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst, 0, count * STRIDE);
  gl.uniform1f(U.mirror, S.mirror ? 1 : 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
}

const worker = new Worker('tracker.worker.js');
let busy = false, detectMs = 0, lastError = '';

worker.onerror = e => { lastError = `Detector: ${e.message}`; };
worker.onmessage = ({ data }) => {
  busy = false;
  if (data.error) lastError = data.error;
  if (data.ms !== undefined) detectMs += (data.ms - detectMs) * 0.1;
  for (const kind of KINDS) {
    if (!S[kind]) continue;
    if (data[kind]) matchTracks(tracks, kind, data[kind], performance.now());
  }
};

function feedTracker() {
  if (busy) return;
  busy = true;
  createImageBitmap(video, { resizeWidth: 320, resizeHeight: Math.round(320 * video.videoHeight / video.videoWidth), resizeQuality: 'low' })
    .then(bitmap => worker.postMessage({ bitmap, opts: S }, [bitmap]))
    .catch(() => { busy = false; });
}

let renderMs = 0, frames = 0, statT = performance.now();

function onFrame() {
  video.requestVideoFrameCallback(onFrame);
  const t0 = performance.now();
  gl.activeTexture(gl.TEXTURE0);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  if (++frameNo % 2 === 0 && S.trail > 0) snapshot();
  stepTracks(tracks, t0, 0.45);
  feedTracker();
  draw();
  const t1 = performance.now();
  renderMs += (t1 - t0 - renderMs) * 0.1;
  frames++;
  if (t1 - statT > 500) {
    chan.postMessage({ stats: { windows: tracks.length, fps: Math.round(frames * 1000 / (t1 - statT)), detectMs, renderMs, error: lastError } });
    frames = 0;
    statT = t1;
  }
}
video.requestVideoFrameCallback(onFrame);

let source = 'camera', sourceError = '', devices = [], sourceRun = 0, retryTimer;

const sendStatus = () => chan.postMessage({ status: { source, sourceError, devices, deviceId: S.deviceId } });

function stopSource() {
  clearTimeout(retryTimer);
  video.srcObject?.getTracks().forEach(t => t.stop());
  video.srcObject = null;
  video.removeAttribute('src');
  video.load();
  tracks.length = 0;
  draw(); // without new frames the last windows would stay frozen on screen
}

async function useCamera() {
  stopSource();
  source = 'camera';
  const run = ++sourceRun;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { deviceId: S.deviceId ? { ideal: S.deviceId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
    if (run !== sourceRun) { stream.getTracks().forEach(t => t.stop()); return; }
    video.srcObject = stream;
    await video.play();
    sourceError = '';
  } catch (e) {
    if (run !== sourceRun) return;
    if (e.name === 'NotFoundError') sourceError = 'No hay ninguna cámara conectada.';
    else if (e.name === 'NotReadableError') {
      sourceError = 'La cámara está ocupada por otra app (Cámara, Discord…). Arrancará sola cuando la cierres.';
      retryTimer = setTimeout(useCamera, 2000); // nothing announces that a camera got free
    } else sourceError = `Sin cámara: ${e.message}`;
  }
  devices = (await navigator.mediaDevices.enumerateDevices())
    .filter(d => d.kind === 'videoinput')
    .map(d => ({ id: d.deviceId, label: d.label || 'Cámara' }));
  sendStatus();
}

// A webcam plugged in or pulled out while the app is open.
navigator.mediaDevices.ondevicechange = () => {
  if (source === 'camera' && !video.srcObject?.active) useCamera();
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
      sourceError = 'Este vídeo no tiene imagen que se pueda leer. Suele pasar con HEVC/H.265, el formato del iPhone: usa un MP4 H.264.';
    }
  } catch (e) {
    if (run !== sourceRun) return;
    sourceError = `No se puede abrir: ${e.message}`;
  }
  sendStatus();
}

chan.onmessage = ({ data }) => {
  if (data.hello) sendStatus();
  if (data.useCamera) useCamera();
  if (data.useVideo) useVideo(data.useVideo);
  if (data.settings) {
    const changedDevice = data.settings.deviceId !== S.deviceId;
    Object.assign(S, data.settings);
    document.body.style.background = S.windowed ? '#000' : 'transparent';
    for (let i = tracks.length - 1; i >= 0; i--) if (!S[tracks[i].kind]) tracks.splice(i, 1);
    if (changedDevice && source === 'camera') useCamera();
  }
};

document.body.style.background = S.windowed ? '#000' : 'transparent';
useCamera();
