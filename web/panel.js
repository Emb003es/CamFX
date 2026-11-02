const S = loadSettings();
const chan = new BroadcastChannel('camfx');
const $ = id => document.getElementById(id);
const invoke = (...args) => window.__TAURI__.core.invoke(...args);
const FACE_BODY = ['face', 'body', 'eyes', 'mouth'];

function save() {
  try { localStorage.setItem('camfx', JSON.stringify(S)); } catch {}
  chan.postMessage({ settings: S });
}

function syncFaceBody() {
  const on = FACE_BODY.filter(k => S[k]).length;
  $('faceBody').checked = on > 0;
  $('faceBody').indeterminate = on > 0 && on < FACE_BODY.length;
}

function paintSlider(el) {
  const output = el.parentElement.querySelector('output');
  el.style.setProperty('--p', `${(el.value - el.min) / (el.max - el.min) * 100}%`);
  output.textContent = el.step === '1' ? el.value : `${Math.round(el.value * 100)} %`;
}

for (const el of document.querySelectorAll('[data-k]')) {
  const k = el.dataset.k, isBox = el.type === 'checkbox';
  if (isBox) el.checked = S[k]; else { el.value = S[k]; paintSlider(el); }
  el.oninput = () => {
    S[k] = isBox ? el.checked : +el.value;
    if (!isBox) paintSlider(el);
    save();
    syncFaceBody();
  };
}

$('faceBody').onchange = e => {
  // The master switch restores the reel's default: only the face.
  S.face = e.target.checked;
  if (!e.target.checked) S.body = S.eyes = S.mouth = false;
  for (const k of FACE_BODY) document.querySelector(`[data-k=${k}]`).checked = S[k];
  save();
  syncFaceBody();
};
syncFaceBody();

// Source

let videoUrl = '';

function showTab(video) {
  $('tabCam').classList.toggle('on', !video);
  $('tabVid').classList.toggle('on', video);
  $('paneCam').hidden = video;
  $('paneVid').hidden = !video;
}

$('tabCam').onclick = () => { videoUrl = ''; showTab(false); chan.postMessage({ useCamera: true }); };
$('tabVid').onclick = () => showTab(true);
$('file').onclick = e => { e.target.value = ''; }; // or picking the same video again would do nothing
$('file').onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  videoUrl = URL.createObjectURL(file);
  chan.postMessage({ useVideo: videoUrl });
};
$('cams').onchange = e => { S.deviceId = e.target.value; save(); };

function renderCameras({ devices, deviceId }) {
  $('cams').replaceChildren(...devices.map(d => new Option(d.label, d.id, false, d.id === deviceId)));
}

// Background

// Over the desktop the picture comes from a layer window; otherwise from the preview here.
function showBackground() {
  for (const b of document.querySelectorAll('[data-bg]')) b.classList.toggle('on', b.dataset.bg === S.bg);
  $('paneColor').hidden = S.bg !== 'color';
  $('paneFile').hidden = S.bg !== 'file';
  $('paneDesktop').hidden = S.bg !== 'desktop';
  $('bgName').textContent = S.bgName;
  document.body.classList.toggle('desktop', S.bg === 'desktop');
  const page = S.bg === 'desktop' ? 'about:blank' : 'overlay.html';
  if ($('stage').getAttribute('src') !== page) $('stage').src = page;
}

for (const b of document.querySelectorAll('[data-bg]')) {
  b.onclick = () => {
    const desktop = b.dataset.bg === 'desktop', changedHost = desktop !== (S.bg === 'desktop');
    if (changedHost && rec) rec.stop(); // the picture being recorded is about to go away
    S.bg = b.dataset.bg;
    save();
    showBackground();
    if (changedHost) invoke('set_desktop', { on: desktop });
  };
}

$('bgColor').value = S.bgColor;
$('bgColor').oninput = e => { S.bgColor = e.target.value; save(); };
$('bgFile').onclick = e => { e.target.value = ''; };
$('bgFile').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    await bgStore('readwrite', file);
    S.bgName = file.name;
    S.bgStamp = Date.now();
    save();
    showBackground();
  } catch (err) {
    $('bgError').textContent = `No se pudo guardar el fondo: ${err.message}`;
  }
};

// Recording

const RECORD_TYPES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
let rec = null;

async function listMics() {
  // Device names only show once the page has asked for a microphone; nothing is captured here.
  try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach(t => t.stop()); } catch {}
  const mics = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
  $('mic').replaceChildren(new Option('Sin sonido', ''), ...mics.map(d => new Option(d.label || 'Micrófono', d.deviceId)));
  $('mic').value = mics.some(d => d.deviceId === S.micId) ? S.micId : '';
}
$('mic').onchange = e => { S.micId = e.target.value; save(); };
navigator.mediaDevices.addEventListener('devicechange', listMics);

function clock(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function fileName(ext) {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `CamFX ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.${ext}`;
}

async function startRecording() {
  $('recError').textContent = '';
  $('saved').hidden = true;
  const desktop = S.bg === 'desktop';
  let stream;
  try {
    stream = desktop
      // shortcut: the auto-accept flag always picks the first monitor; CamFX must be there, add a picker if that bothers
      ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false })
      : $('stage').contentDocument.getElementById('c').captureStream(30);
    // Voice and instruments: the browser's call-oriented clean-up would ruin them.
    if (S.micId) {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: S.micId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      stream.addTrack(mic.getAudioTracks()[0]);
    }
    const mimeType = RECORD_TYPES.find(t => MediaRecorder.isTypeSupported(t));
    const path = await invoke('start_recording', { name: fileName(mimeType.startsWith('video/mp4') ? 'mp4' : 'webm') });
    if (desktop) await invoke('protect_panel', { on: true });

    rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12e6 });
    let writes = Promise.resolve();
    rec.ondataavailable = e => {
      writes = writes
        .then(() => e.data.arrayBuffer())
        .then(buffer => invoke('append_recording', buffer))
        .catch(err => {
          $('recError').textContent = `No se pudo guardar la grabación: ${err}`;
          if (rec?.state === 'recording') rec.stop();
        });
    };
    const t0 = performance.now();
    const timer = setInterval(() => { $('time').textContent = clock(performance.now() - t0); }, 250);
    rec.onstop = async () => {
      rec = null;
      clearInterval(timer);
      stream.getTracks().forEach(t => t.stop());
      await writes;
      await invoke('finish_recording');
      if (desktop) await invoke('protect_panel', { on: false });
      document.body.classList.remove('rec');
      $('rec').textContent = 'Grabar';
      $('time').textContent = '00:00';
      $('savedPath').textContent = $('savedPath').title = path;
      $('saved').hidden = false;
    };
    rec.start(1000); // chunks to disk every second, so a long take never piles up in memory
    document.body.classList.add('rec');
    $('rec').textContent = 'Detener';
  } catch (err) {
    stream?.getTracks().forEach(t => t.stop());
    $('recError').textContent = `No se pudo grabar: ${err.message ?? err}`;
  }
}

$('rec').onclick = () => { if (rec) rec.stop(); else startRecording(); };
$('reveal').onclick = () => invoke('reveal_recording');

// Messages from whichever page is drawing

chan.onmessage = ({ data }) => {
  // A new renderer starts on the camera: hand it the video it should be showing.
  if (data.ready && videoUrl) chan.postMessage({ useVideo: videoUrl });
  if (data.status) {
    // Only ever towards Vídeo: a busy camera keeps reporting, and must not close the tab the user just opened.
    if (data.status.source === 'video') showTab(true);
    renderCameras(data.status);
    $('error').textContent = data.status.sourceError;
    $('bgError').textContent = data.status.bgError;
    if (data.status.sourceError) $('stat').textContent = 'Sin imagen';
  }
  if (data.stats) {
    const s = data.stats;
    $('stat').textContent = `${s.fps} fps · ${s.windows} ${s.windows === 1 ? 'ventana' : 'ventanas'}`;
    if (s.error) $('error').textContent = s.error;
  }
};

showTab(false);
listMics();
showBackground();
if (S.bg === 'desktop') invoke('set_desktop', { on: true });
