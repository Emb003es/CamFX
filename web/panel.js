const S = loadSettings();
const chan = new BroadcastChannel('camfx');
const $ = id => document.getElementById(id);
const FACE_BODY = ['face', 'body', 'eyes', 'mouth'];

function save() {
  try { localStorage.setItem('camfx', JSON.stringify(S)); } catch {}
  chan.postMessage({ settings: S });
}

const setWindowed = () => window.__TAURI__.core.invoke('set_windowed', { on: S.windowed });

function syncFaceBody() {
  const on = FACE_BODY.filter(k => S[k]).length;
  $('faceBody').checked = on > 0;
  $('faceBody').indeterminate = on > 0 && on < FACE_BODY.length;
}

for (const el of document.querySelectorAll('[data-k]')) {
  const k = el.dataset.k, isBox = el.type === 'checkbox';
  if (isBox) el.checked = S[k]; else el.value = S[k];
  el.oninput = () => {
    S[k] = isBox ? el.checked : +el.value;
    save();
    syncFaceBody();
    if (k === 'windowed') setWindowed();
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

function showTab(video) {
  $('tabCam').classList.toggle('on', !video);
  $('tabVid').classList.toggle('on', video);
  $('paneCam').hidden = video;
  $('paneVid').hidden = !video;
}

$('tabCam').onclick = () => { showTab(false); chan.postMessage({ useCamera: true }); };
$('tabVid').onclick = () => showTab(true);
$('file').onclick = e => { e.target.value = ''; }; // or picking the same video again would do nothing
$('file').onchange = e => {
  const file = e.target.files[0];
  if (file) chan.postMessage({ useVideo: URL.createObjectURL(file) });
};

function renderCameras({ devices, deviceId }) {
  $('cams').replaceChildren(...devices.map((d, i) => {
    const label = document.createElement('label'), radio = document.createElement('input'), name = document.createElement('span');
    radio.type = 'radio';
    radio.name = 'cam';
    radio.checked = d.id === deviceId || (!deviceId && i === 0);
    radio.onchange = () => { S.deviceId = d.id; save(); };
    name.textContent = name.title = d.label;
    label.append(radio, name);
    return label;
  }));
}

chan.onmessage = ({ data }) => {
  if (data.status) {
    // Only ever towards Vídeo: a busy camera keeps reporting, and must not close the tab the user just opened.
    if (data.status.source === 'video') showTab(true);
    renderCameras(data.status);
    $('error').textContent = data.status.sourceError;
    if (data.status.sourceError) $('stat').textContent = 'Sin imagen';
  }
  if (data.stats) {
    const s = data.stats;
    const modes = ['face', 'body', 'eyes', 'mouth', 'threshold', 'motion'].filter(k => S[k]).join(' + ');
    $('stat').textContent = `${modes}\n${s.windows} win · ${s.fps} fps · det ${s.detectMs.toFixed(1)} · gl ${s.renderMs.toFixed(1)} ms`;
    if (s.error) $('error').textContent = s.error;
  }
};

showTab(false);
chan.postMessage({ hello: true });
if (S.windowed) setWindowed();
