// The finger effects: music, a little life with its menu, light painting and an energy ball. They draw
// with a 2D canvas over the camera, and the overlay uploads that canvas once per frame. Sizes go by k,
// pixels per 1080th of the frame height, so they look the same in the preview and over the desktop.
// Sounds play in the panel (see sound.js): a page may only make sound after a click on it.

const hud = document.createElement('canvas');
const hx = hud.getContext('2d');
const EMOJI = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
const UI = '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';
const handMem = new Map(); // per hand id: what it did last frame, and whatever an effect keeps for it
let lastFrame = 0;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const pick = list => list[Math.random() * list.length | 0];
const easeOut = t => 1 - (1 - t) ** 3;
const popIn = t => t >= 1 ? 1 : 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2; // overshoots a little, like a bubble

// ---- Short-lived bits: sparks, rings, floating glyphs and confetti

const parts = [];

function emit(o) { parts.push({ t: 0, life: 1, vx: 0, vy: 0, g: 0, spin: 0, ang: 0, kind: 'dot', color: '#fff', size: 6, ...o }); }

function burst(x, y, k, n, o = {}) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, v = (o.speed ?? 500) * (0.3 + Math.random() * 0.7) * k;
    emit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.6, ...o, color: Array.isArray(o.color) ? pick(o.color) : o.color ?? '#fff' });
  }
}

function confetti(W, H, k, n = 90) {
  const colors = ['#ff5ea8', '#ffd23f', '#3fd6ff', '#6cff8a', '#b56bff', '#ff8a3d'];
  for (let i = 0; i < n; i++) {
    emit({ kind: 'confetti', x: Math.random() * W, y: -20 * k - Math.random() * H * 0.3, vx: (Math.random() - 0.5) * 200 * k, vy: (150 + Math.random() * 250) * k, g: 300 * k, life: 2.6, size: 9 + Math.random() * 8, spin: (Math.random() - 0.5) * 14, color: pick(colors) });
  }
}

function drawParts(c, dt, k) {
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.t += dt;
    if (p.t >= p.life) { parts.splice(i, 1); continue; }
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.ang += p.spin * dt;
    const f = p.t / p.life, a = 1 - f;
    c.globalAlpha = a;
    if (p.kind === 'dot') {
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(p.x, p.y, p.size * k * (0.4 + 0.6 * a), 0, 6.283);
      c.fill();
    } else if (p.kind === 'ring') {
      c.strokeStyle = p.color;
      c.lineWidth = p.size * k * a;
      c.beginPath();
      c.arc(p.x, p.y, lerp(p.r0, p.r1, easeOut(f)), 0, 6.283);
      c.stroke();
    } else if (p.kind === 'text') {
      c.save();
      c.translate(p.x, p.y);
      c.rotate(p.ang);
      c.scale(popIn(Math.min(p.t * 5, 1)), popIn(Math.min(p.t * 5, 1)));
      c.font = `${p.bold ? '700 ' : ''}${p.size * k}px ${p.emoji ? EMOJI : UI}`;
      c.fillStyle = p.color;
      c.fillText(p.text, 0, 0);
      c.restore();
    } else if (p.kind === 'confetti') {
      c.save();
      c.translate(p.x + Math.sin(p.t * 5 + p.size) * 12 * k, p.y);
      c.rotate(p.ang);
      c.fillStyle = p.color;
      c.fillRect(-p.size * k / 2, -p.size * k / 4, p.size * k, p.size * k / 2);
      c.restore();
    }
  }
  c.globalAlpha = 1;
}

// A pill of text, for hints and labels.
function pill(c, text, x, y, k, { size = 22, bg = 'rgba(12,12,16,.62)', fg = '#fff', align = 'center' } = {}) {
  c.font = `600 ${size * k}px ${UI}`;
  const w = c.measureText(text).width + size * 1.4 * k, h = size * 1.9 * k;
  const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  c.fillStyle = bg;
  c.beginPath();
  c.roundRect(left, y - h / 2, w, h, h / 2);
  c.fill();
  c.fillStyle = fg;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, left + w / 2, y + size * 0.05 * k);
  return w;
}

function glyph(c, text, x, y, size, k) {
  c.font = `${size * k}px ${EMOJI}`;
  c.fillText(text, x, y);
}

// ---- Music: every fingertip is a note; touch it with the thumb to play it

const MUSIC_COLORS = ['#ff5ea8', '#ff8a3d', '#ffd23f', '#6cff8a', '#3fd6ff', '#5b7bff', '#b56bff', '#ff5e5e'];
const DRUMS = ['Bombo', 'Caja', 'Charles', 'Palmas', 'Tom', 'Tom agudo', 'Platillo', 'Cencerro'];
const music = { lit: new Float32Array(8), label: Array(8).fill('') };

function noteOf(S, slot, octave) {
  return scaleNote(S.scale, slot + octave * (SCALES[S.scale] ?? SCALES.mayor).length);
}

function drawMusic(c, F) {
  const { W, H, k, S, dt, hands, sound } = F;
  const drums = S.instrument === 'drums';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  if (!drums) {
    // Where the hand goes up or down an octave.
    c.save();
    c.strokeStyle = 'rgba(255,255,255,.22)';
    c.lineWidth = 2 * k;
    c.setLineDash([10 * k, 14 * k]);
    for (const y of [H / 3, H * 2 / 3]) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.restore();
    pill(c, 'agudo', 24 * k, H / 3 - 28 * k, k, { size: 16, align: 'left' });
    pill(c, 'grave', 24 * k, H * 2 / 3 + 28 * k, k, { size: 16, align: 'left' });
  }
  // Left to right on screen like a keyboard: the left hand's pinky is the lowest note, the right's the highest.
  const sorted = hands.slice().sort((a, b) => a.palm[0] - b.palm[0]);
  for (const h of sorted) {
    const left = sorted.length > 1 ? h === sorted[0] : h.palm[0] < W / 2;
    const octave = drums ? 0 : h.palm[1] < H / 3 ? 1 : h.palm[1] > H * 2 / 3 ? -1 : 0;
    const slots = [0, 1, 2, 3].map(f => left ? 3 - f : 4 + f);
    if (h.touch >= 0 && h.touch !== h.wasTouch) {
      const slot = slots[h.touch], tip = h.p[TIPS[h.touch]], pan = clamp(tip[0] / W * 2 - 1, -1, 1) * 0.7;
      const midi = noteOf(S, slot, octave);
      sound(drums ? { name: 'drum', n: slot, pan } : { name: 'note', inst: S.instrument, freq: midiFreq(midi), pan });
      music.lit[slot] = 1;
      music.label[slot] = drums ? DRUMS[slot] : noteName(midi);
      const color = MUSIC_COLORS[slot];
      emit({ kind: 'ring', x: tip[0], y: tip[1], r0: 10 * k, r1: 90 * k, size: 8, color, life: 0.55 });
      emit({ kind: 'text', text: pick(['♪', '♫', '♬']), x: tip[0], y: tip[1] - 20 * k, vx: (Math.random() - 0.5) * 80 * k, vy: -160 * k, size: 44, color, life: 1.2, spin: (Math.random() - 0.5) * 2 });
      burst(tip[0], tip[1], k, 10, { color, size: 5, speed: 300 });
    }
    // The thumb, and a line to the finger it is touching.
    const thumb = h.p[4];
    if (h.touch >= 0) {
      const tip = h.p[TIPS[h.touch]];
      c.strokeStyle = MUSIC_COLORS[slots[h.touch]];
      c.lineWidth = 6 * k;
      c.beginPath(); c.moveTo(...thumb); c.lineTo(...tip); c.stroke();
    }
    c.strokeStyle = '#fff';
    c.lineWidth = 4 * k;
    c.beginPath(); c.arc(thumb[0], thumb[1], 15 * k, 0, 6.283); c.stroke();
    for (let f = 0; f < 4; f++) {
      const tip = h.p[TIPS[f]], slot = slots[f], on = h.touch === f;
      c.fillStyle = MUSIC_COLORS[slot];
      c.globalAlpha = on ? 1 : 0.85;
      c.beginPath(); c.arc(tip[0], tip[1], (on ? 19 : 13) * k, 0, 6.283); c.fill();
      c.globalAlpha = 1;
      const label = drums ? DRUMS[slot] : noteName(noteOf(S, slot, octave));
      pill(c, label, tip[0], tip[1] - 38 * k, k, { size: 15, bg: 'rgba(0,0,0,.45)' });
    }
  }
  // The eight keys along the bottom, lit as they play.
  const kw = 112 * k, kh = 58 * k, x0 = W / 2 - kw * 4, y = H - 34 * k - kh;
  for (let i = 0; i < 8; i++) {
    music.lit[i] = Math.max(0, music.lit[i] - dt * 2.2);
    const x = x0 + i * kw + 4 * k, w = kw - 8 * k;
    c.fillStyle = 'rgba(12,12,16,.55)';
    c.beginPath(); c.roundRect(x, y, w, kh, 12 * k); c.fill();
    if (music.lit[i] > 0) {
      c.globalAlpha = music.lit[i];
      c.fillStyle = MUSIC_COLORS[i];
      c.beginPath(); c.roundRect(x, y - 10 * k * music.lit[i], w, kh, 12 * k); c.fill();
      c.globalAlpha = 1;
    }
    c.fillStyle = MUSIC_COLORS[i];
    c.fillRect(x + 12 * k, y + kh - 7 * k, w - 24 * k, 3 * k);
    c.fillStyle = '#fff';
    c.font = `600 ${18 * k}px ${UI}`;
    c.fillText(music.label[i] || (drums ? DRUMS[i] : noteName(noteOf(S, i, 0))), x + w / 2, y + kh / 2 - 2 * k);
  }
  if (!hands.length) pill(c, 'Enseña las manos y toca la punta de un dedo con el pulgar', W / 2, y - 50 * k, k);
}

// ---- Life: a little character (you) with needs, a menu of things to give yourself, wishes and levels

const ITEMS = [
  { icon: '🍎', name: 'Manzana', kind: 'food', gives: { food: 18, energy: 4 }, say: ['¡Crujiente!', 'Mmm, qué fresca', 'Una al día…'] },
  { icon: '🍕', name: 'Pizza', kind: 'food', gives: { food: 32, fun: 6 }, say: ['¡PIZZA!', '¿Otra porción?', 'Esto es vida'] },
  { icon: '🍦', name: 'Helado', kind: 'food', gives: { food: 12, fun: 16 }, say: ['¡Qué frío!', 'Mi sabor favorito', 'Se me derrite…'] },
  { icon: '☕', name: 'Café', kind: 'food', gives: { energy: 38, food: 4 }, say: ['¡Despierto!', '¡A tope!', 'Ahora sí'] },
  { icon: '🎁', name: 'Regalo', kind: 'gift', gives: { fun: 22, love: 12 }, say: [] },
  { icon: '🧸', name: 'Peluche', kind: 'hug', gives: { love: 30 }, say: ['¡Abrazo!', 'Qué blandito', 'Me lo quedo'] },
  { icon: '🎈', name: 'Globos', kind: 'play', gives: {}, say: ['¡Explótalos!', '¡A jugar!'] },
  { icon: '👑', name: 'Corona', kind: 'hat', gives: { fun: 10 }, say: ['¡Me queda genial!', 'Soy de la realeza', '¿A que estoy guapo?'] },
  { icon: '🎩', name: 'Chistera', kind: 'hat', gives: { fun: 10 }, say: ['Muy elegante', '¡Ta-chán!', 'Con estilo'] },
];
const SURPRISES = [['🦖', '¡Un dinosaurio!'], ['🎮', '¡Una consola!'], ['🐱', '¡Un gatito!'], ['🌟', '¡Una estrella!'], ['🎸', '¡Una guitarra!'], ['🪴', '¡Una plantita!'], ['🛹', '¡Un monopatín!']];
const NEEDS = [
  { k: 'food', label: 'Comida', icon: '🍙', color: '#ff9f43', decay: 0.3 },
  { k: 'fun', label: 'Diversión', icon: '🎲', color: '#f5c518', decay: 0.4 },
  { k: 'energy', label: 'Energía', icon: '⚡', color: '#3fa9ff', decay: 0.18 },
  { k: 'love', label: 'Cariño', icon: '💗', color: '#ff6b9d', decay: 0.28 },
];
const MOODS = {
  food: ['😫', 'Tiene hambre', ['Tengo hambre…', '¿Hay algo de comer?', 'Me ruge la tripa']],
  fun: ['😒', 'Se aburre', ['Me aburro…', '¿Jugamos a algo?', 'Qué día más largo']],
  energy: ['😴', 'Tiene sueño', ['Qué sueño…', 'Necesito un café', '*bosteza*']],
  love: ['🥺', 'Quiere mimos', ['¿Me das un mimo?', 'Me siento solo', 'Acaríciame la cabeza']],
};
const fresh = () => ({ food: 70, fun: 60, energy: 80, love: 55, xp: 0, level: 1, hat: '' });

const life = { ...fresh(), say: null, wish: null, nextWish: 0, nextChat: 0, held: new Map(), falling: [], balloons: [], banner: null, saved: 0, patCool: 0 };
try { Object.assign(life, JSON.parse(localStorage.getItem('camfx-life'))); } catch {}

function resetLife() {
  Object.assign(life, fresh(), { say: null, wish: null, nextWish: 0, banner: null });
  life.held.clear();
  life.balloons.length = life.falling.length = 0;
}

function say(F, text, ms = 2600) { life.say = { text, t0: F.now, until: F.now + ms }; }

function give(F, gives, xp) {
  for (const [key, v] of Object.entries(gives)) life[key] = clamp(life[key] + v, 0, 100);
  life.xp += xp;
  while (life.xp >= life.level * 100) {
    life.xp -= life.level * 100;
    life.level++;
    life.banner = { text: `¡Nivel ${life.level}!`, t0: F.now };
    confetti(F.W, F.H, F.k, 120);
    F.sound({ name: 'levelup' });
  }
}

function mood() {
  const low = NEEDS.reduce((a, b) => life[a.k] <= life[b.k] ? a : b);
  if (life[low.k] < 35) return MOODS[low.k];
  if (life[low.k] > 85) return ['🤩', 'Radiante', []];
  if (life[low.k] > 60) return ['😄', 'Feliz', []];
  return ['🙂', 'Tranquilo', []];
}

function dockPos(F, i) {
  const { W, k, now } = F;
  return [W - 76 * k, 92 * k + i * 102 * k + Math.sin(now / 650 + i * 1.3) * 4 * k];
}

// Where the hat goes, the tilt of the head and the mouth, from the face detector's box and points.
function head(f) {
  const tilt = f.eyes ? Math.atan2(f.eyes[1][1] - f.eyes[0][1], f.eyes[1][0] - f.eyes[0][0]) : 0;
  const t = Math.abs(tilt) > Math.PI / 2 ? tilt - Math.sign(tilt) * Math.PI : tilt; // the eyes' order flips with the mirror
  return { ...f, tilt: t, crown: [f.cx + Math.sin(t) * f.h * 0.42, f.y + f.h * 0.06] };
}

function useItem(F, item, at) {
  const f = F.face && head(F.face), { k } = F;
  const nearMouth = f && dist(at, f.mouth) < f.w * 0.55;
  const onHead = f && Math.abs(at[0] - f.cx) < f.w * 0.6 && at[1] < f.y + f.h * 0.35 && at[1] > f.y - f.h * 0.8;
  const nearFace = f && at[0] > f.x - f.w * 0.3 && at[0] < f.x + f.w * 1.3 && at[1] > f.y - f.h * 0.3 && at[1] < f.y + f.h * 1.3;
  let used = true;
  if (item.kind === 'food' && nearMouth) {
    F.sound({ name: 'yum' });
    say(F, pick(life.food > 95 && item.gives.food ? ['¡Estoy lleno!', 'No puedo más…'] : item.say));
    burst(f.mouth[0], f.mouth[1], k, 16, { color: ['#ffd23f', '#ff8a3d', '#fff'], size: 6, speed: 380, g: 900 * k });
    give(F, item.gives, 10);
  } else if (item.kind === 'hat' && onHead) {
    if (life.hat) life.falling.push({ icon: life.hat, x: f.crown[0], y: f.crown[1], vx: 260 * k, vy: -500 * k, ang: 0 });
    life.hat = item.icon;
    F.sound({ name: 'sparkle' });
    say(F, pick(item.say));
    burst(f.crown[0], f.crown[1], k, 18, { kind: 'text', text: '✦', size: 26, color: ['#ffd23f', '#fff'], speed: 350 });
    give(F, item.gives, 10);
  } else if (item.kind === 'gift' && nearFace) {
    const [icon, text] = pick(SURPRISES);
    F.sound({ name: 'sparkle' });
    say(F, text);
    emit({ kind: 'text', emoji: true, text: icon, x: at[0], y: at[1], vy: -120 * k, size: 110, life: 2.2 });
    burst(at[0], at[1], k, 30, { kind: 'confetti', color: ['#ff5ea8', '#ffd23f', '#3fd6ff', '#6cff8a'], size: 10, speed: 600, g: 900 * k, spin: 8 });
    give(F, item.gives, 15);
  } else if (item.kind === 'hug' && nearFace) {
    F.sound({ name: 'hug' });
    say(F, pick(item.say));
    hearts(F, f.cx, f.y + f.h * 0.5, 8);
    give(F, item.gives, 10);
  } else if (item.kind === 'play') {
    F.sound({ name: 'whoosh' });
    say(F, pick(item.say));
    const colors = ['#ff5ea8', '#ffd23f', '#3fd6ff', '#6cff8a', '#b56bff', '#ff5e5e'];
    for (let i = 0; i < 7 && life.balloons.length < 14; i++) {
      life.balloons.push({ x: at[0] + (Math.random() - 0.5) * 160 * k, y: at[1] + Math.random() * 60 * k, vy: -(60 + Math.random() * 50) * k, r: (38 + Math.random() * 16) * k, phase: Math.random() * 6, color: pick(colors) });
    }
  } else {
    used = false;
    life.falling.push({ icon: item.icon, x: at[0], y: at[1], vx: (Math.random() - 0.5) * 200 * k, vy: -200 * k, ang: 0 });
  }
  if (used && life.wish?.item === item) {
    life.wish = null;
    life.nextWish = F.now + 18000 + Math.random() * 12000;
    say(F, '¡Justo lo que quería!', 3000);
    confetti(F.W, F.H, k);
    F.sound({ name: 'fanfare' });
    give(F, { fun: 15, love: 10 }, 40);
  }
}

function hearts(F, x, y, n) {
  for (let i = 0; i < n; i++) emit({ kind: 'text', emoji: true, text: pick(['💖', '💗', '💕']), x: x + (Math.random() - 0.5) * 120 * F.k, y, vx: (Math.random() - 0.5) * 120 * F.k, vy: -(140 + Math.random() * 160) * F.k, size: 30 + Math.random() * 20, life: 1.4, spin: (Math.random() - 0.5) * 2 });
}

function wish(F) {
  // What it wants most fills its lowest need; sometimes it is just a whim.
  const low = NEEDS.reduce((a, b) => life[a.k] <= life[b.k] ? a : b).k;
  const useful = ITEMS.filter(it => (it.gives[low] ?? 0) >= 12 && it.icon !== life.hat);
  const item = Math.random() < 0.65 && useful.length ? pick(useful) : pick(ITEMS.filter(it => it.icon !== life.hat));
  life.wish = { item, t0: F.now, until: F.now + 22000 };
  F.sound({ name: 'blip' });
}

function updateLife(F) {
  const { now, dt, k, hands, W, H } = F;
  const f = F.face && head(F.face);
  for (const n of NEEDS) life[n.k] = clamp(life[n.k] - n.decay * dt, 0, 100);
  if (!life.nextWish) life.nextWish = now + 9000;
  if (f && !life.wish && now > life.nextWish) wish(F);
  if (life.wish && now > life.wish.until) {
    life.wish = null;
    life.nextWish = now + 15000;
    say(F, 'Bueno… otra vez será');
    give(F, { fun: -6 }, 0);
  }
  if (f && !life.say && now > life.nextChat) {
    const [, , lines] = mood();
    if (lines.length) say(F, pick(lines));
    life.nextChat = now + 14000 + Math.random() * 8000;
  }
  if (life.say && now > life.say.until) life.say = null;

  const ids = new Set(hands.map(h => h.id));
  for (const [id, held] of life.held) if (!ids.has(id)) { useItem(F, held.item, held.at); life.held.delete(id); }
  for (const h of hands) {
    const held = life.held.get(h.id);
    if (h.pinch && !h.wasPinch && !held) {
      // Grab from the menu, take the hat off, or pop a balloon.
      const i = ITEMS.findIndex((_, i) => dist(h.at, dockPos(F, i)) < 60 * k);
      if (i >= 0) {
        life.held.set(h.id, { item: ITEMS[i], at: h.at.slice() });
        F.sound({ name: 'pop' });
      } else if (life.hat && f && dist(h.at, f.crown) < f.w * 0.5) {
        life.held.set(h.id, { item: ITEMS.find(it => it.icon === life.hat), at: h.at.slice() });
        life.hat = '';
        F.sound({ name: 'pop' });
      }
    } else if (held && h.pinch) {
      held.at[0] = lerp(held.at[0], h.at[0], 0.6);
      held.at[1] = lerp(held.at[1], h.at[1], 0.6);
    } else if (held) {
      useItem(F, held.item, held.at);
      life.held.delete(h.id);
    }
    // Any fingertip pops a balloon it touches.
    for (const tip of [h.p[8], h.p[4], h.p[12]]) {
      for (let b = life.balloons.length - 1; b >= 0; b--) {
        const bl = life.balloons[b];
        if (Math.hypot(tip[0] - bl.x, (tip[1] - bl.y) * 0.85) > bl.r) continue;
        life.balloons.splice(b, 1);
        F.sound({ name: 'pop', pan: clamp(bl.x / W * 2 - 1, -1, 1) });
        burst(bl.x, bl.y, k, 14, { color: bl.color, size: 7, speed: 420 });
        give(F, { fun: 5, energy: -1 }, 3);
      }
    }
    // An open hand rubbing the top of the head is a pat.
    if (f && h.open && Math.abs(h.palm[0] - f.cx) < f.w * 0.9 && h.palm[1] < f.y + f.h * 0.25 && h.palm[1] > f.y - f.h * 1.1) {
      h.st.rub = (h.st.rub ?? 0) + Math.abs(h.palm[0] - (h.st.lastX ?? h.palm[0])) + Math.abs(h.palm[1] - (h.st.lastY ?? h.palm[1])) * 0.5;
      if (h.st.rub > f.w * 0.45 && now > life.patCool) {
        h.st.rub = 0;
        life.patCool = now + 650;
        F.sound({ name: 'hug' });
        hearts(F, f.cx, f.y + f.h * 0.1, 3);
        if (!life.say || now - life.say.t0 > 1200) say(F, pick(['Jeje ♥', '¡Qué gusto!', 'Mmm…', 'Otra vez', '¡Me encanta!']), 1500);
        give(F, { love: 7 }, 3);
      }
    } else h.st.rub = 0;
    h.st.lastX = h.palm[0];
    h.st.lastY = h.palm[1];
  }
  for (const bl of life.balloons) { bl.y += bl.vy * dt; bl.x += Math.sin(now / 700 + bl.phase) * 30 * k * dt; }
  life.balloons = life.balloons.filter(bl => bl.y > -bl.r * 3);
  for (const it of life.falling) { it.vy += 2200 * k * dt; it.x += it.vx * dt; it.y += it.vy * dt; it.ang += it.vx * 0.004 * dt; }
  life.falling = life.falling.filter(it => it.y < H + 120 * k);
  if (now - life.saved > 3000) {
    life.saved = now;
    const { food, fun, energy, love, xp, level, hat } = life;
    try { localStorage.setItem('camfx-life', JSON.stringify({ food, fun, energy, love, xp, level, hat })); } catch {}
  }
}

// A speech bubble with its tail towards (tx, ty).
function bubble(c, text, x, y, tx, ty, k, t, cloud) {
  c.save();
  c.translate(x, y);
  c.scale(popIn(t), popIn(t));
  c.font = `600 ${26 * k}px ${cloud ? EMOJI : UI}`;
  const w = Math.max(c.measureText(text).width + 40 * k, 70 * k), h = 60 * k;
  c.fillStyle = '#fff';
  c.strokeStyle = 'rgba(40,30,60,.15)';
  c.lineWidth = 3 * k;
  if (cloud) {
    for (const [dx, dy, r] of [[-w * 0.3, 4, 0.55], [0, -10, 0.7], [w * 0.3, 2, 0.55], [-w * 0.12, 14, 0.5], [w * 0.15, 16, 0.5]]) {
      c.beginPath(); c.arc(dx, dy * k, h * r, 0, 6.283); c.fill();
    }
    const bx = tx - x, by = ty - y;
    for (const [f, r] of [[0.55, 12], [0.78, 8]]) { c.beginPath(); c.arc(bx * f, by * f, r * k, 0, 6.283); c.fill(); }
  } else {
    c.beginPath();
    c.roundRect(-w / 2, -h / 2, w, h, h / 2);
    c.fill();
    c.beginPath();
    c.moveTo(-14 * k, h / 2 - 4 * k);
    c.lineTo((tx - x) * 0.35, (ty - y) * 0.35);
    c.lineTo(8 * k, h / 2 - 4 * k);
    c.fill();
  }
  c.fillStyle = '#2b2440';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, 0, 2 * k);
  c.restore();
}

function drawLife(c, F) {
  updateLife(F);
  const { now, k, W, H, hands } = F;
  const f = F.face && head(F.face);
  c.textAlign = 'center';
  c.textBaseline = 'middle';

  // The status card.
  const cx = 28 * k, cy = 28 * k, cw = 360 * k, ch = 292 * k;
  c.fillStyle = 'rgba(40,20,60,.18)';
  c.beginPath(); c.roundRect(cx + 4 * k, cy + 8 * k, cw, ch, 26 * k); c.fill();
  c.fillStyle = 'rgba(255,250,242,.95)';
  c.beginPath(); c.roundRect(cx, cy, cw, ch, 26 * k); c.fill();
  c.fillStyle = '#ffd6e7';
  c.beginPath(); c.roundRect(cx, cy, cw, 74 * k, [26 * k, 26 * k, 0, 0]); c.fill();
  const [face, moodText] = mood();
  glyph(c, face, cx + 44 * k, cy + 38 * k, 44, k);
  c.textAlign = 'left';
  c.fillStyle = '#2b2440';
  c.font = `700 ${28 * k}px ${UI}`;
  c.fillText((F.S.name || 'Tú').slice(0, 14), cx + 82 * k, cy + 28 * k);
  c.font = `500 ${18 * k}px ${UI}`;
  c.fillStyle = '#7a6a8a';
  c.fillText(moodText, cx + 82 * k, cy + 54 * k);
  c.textAlign = 'center';
  pill(c, `Nv ${life.level}`, cx + cw - 50 * k, cy + 37 * k, k, { size: 18, bg: '#ff6b9d' });
  NEEDS.forEach((n, i) => {
    const y = cy + 104 * k + i * 42 * k, v = life[n.k] / 100;
    glyph(c, n.icon, cx + 34 * k, y, 24, k);
    c.textAlign = 'left';
    c.fillStyle = '#5b4e6b';
    c.font = `600 ${17 * k}px ${UI}`;
    c.fillText(n.label, cx + 58 * k, y);
    c.textAlign = 'center';
    const bx = cx + 158 * k, bw = 172 * k, bh = 16 * k;
    c.fillStyle = '#efe6ee';
    c.beginPath(); c.roundRect(bx, y - bh / 2, bw, bh, bh / 2); c.fill();
    c.fillStyle = v < 0.35 && Math.sin(now / 180) > 0 ? '#ff4d4d' : n.color;
    c.beginPath(); c.roundRect(bx, y - bh / 2, Math.max(bw * v, bh), bh, bh / 2); c.fill();
  });
  const xy = cy + ch - 26 * k, xw = cw - 56 * k;
  c.fillStyle = '#efe6ee';
  c.beginPath(); c.roundRect(cx + 28 * k, xy - 5 * k, xw, 10 * k, 5 * k); c.fill();
  c.fillStyle = '#b56bff';
  c.beginPath(); c.roundRect(cx + 28 * k, xy - 5 * k, Math.max(xw * life.xp / (life.level * 100), 10 * k), 10 * k, 5 * k); c.fill();

  // The menu down the right edge.
  ITEMS.forEach((it, i) => {
    const [x, y] = dockPos(F, i);
    const hover = hands.some(h => dist(h.at, [x, y]) < 60 * k), wished = life.wish?.item === it;
    const s = hover ? 1.15 : 1;
    if (wished) {
      c.strokeStyle = '#ffd23f';
      c.lineWidth = 6 * k;
      c.beginPath(); c.arc(x, y, (48 + Math.sin(now / 150) * 4) * k, 0, 6.283); c.stroke();
    }
    c.fillStyle = 'rgba(40,20,60,.2)';
    c.beginPath(); c.arc(x + 3 * k, y + 6 * k, 42 * k * s, 0, 6.283); c.fill();
    c.fillStyle = hover ? '#fff' : 'rgba(255,250,242,.92)';
    c.beginPath(); c.arc(x, y, 42 * k * s, 0, 6.283); c.fill();
    glyph(c, it.icon, x, y + 2 * k, 46 * s, k);
    if (hover) pill(c, it.name, x - 62 * k, y, k, { size: 18, align: 'right', bg: 'rgba(43,36,64,.85)' });
  });

  if (f) {
    // Where a held thing would go.
    for (const { item } of life.held.values()) {
      const target = item.kind === 'food' ? [f.mouth, f.w * 0.3] : item.kind === 'hat' ? [f.crown, f.w * 0.35] : item.kind === 'play' ? null : [[f.cx, f.y + f.h * 0.5], f.w * 0.75];
      if (!target) continue;
      c.save();
      c.strokeStyle = 'rgba(255,255,255,.85)';
      c.lineWidth = 4 * k;
      c.setLineDash([12 * k, 10 * k]);
      c.lineDashOffset = -now / 30;
      c.beginPath(); c.arc(...target[0], target[1] * (1 + Math.sin(now / 200) * 0.05), 0, 6.283); c.stroke();
      c.restore();
    }
    if (life.hat) {
      c.save();
      c.translate(...f.crown);
      c.rotate(f.tilt);
      glyph(c, life.hat, 0, -f.w * 0.22, f.w / k * 0.62, k);
      c.restore();
    }
    // Name tag over the head; the speech bubble to one side and the wish to the other.
    const top = f.y - (life.hat ? f.w * 0.5 : 0) - 34 * k;
    pill(c, `${F.S.name || 'Tú'} · ${face}`, f.cx, top, k, { size: 20, bg: 'rgba(255,107,157,.92)' });
    if (life.say) bubble(c, life.say.text, clamp(f.x + f.w + 120 * k, 160 * k, W - 300 * k), clamp(f.y + f.h * 0.15, 60 * k, H - 60 * k), f.x + f.w * 0.85, f.y + f.h * 0.4, k, Math.min((now - life.say.t0) / 250, 1));
    if (life.wish) {
      const wx = clamp(f.x - 110 * k, 120 * k, W - 120 * k), wy = clamp(f.y - 20 * k, 70 * k, H);
      bubble(c, `${life.wish.item.icon}`, wx, wy, f.x + f.w * 0.1, f.y + f.h * 0.3, k, Math.min((now - life.wish.t0) / 300, 1), true);
      const left = (life.wish.until - now) / (life.wish.until - life.wish.t0);
      c.strokeStyle = '#ffd23f';
      c.lineWidth = 5 * k;
      c.beginPath(); c.arc(wx, wy - 4 * k, 44 * k, -Math.PI / 2, -Math.PI / 2 + left * 6.283); c.stroke();
    }
  } else {
    pill(c, 'Ponte delante de la cámara', W / 2, H - 60 * k, k);
  }

  for (const bl of life.balloons) {
    c.strokeStyle = 'rgba(255,255,255,.7)';
    c.lineWidth = 2 * k;
    c.beginPath(); c.moveTo(bl.x, bl.y + bl.r); c.quadraticCurveTo(bl.x + 14 * k, bl.y + bl.r * 1.8, bl.x, bl.y + bl.r * 2.6); c.stroke();
    c.fillStyle = bl.color;
    c.beginPath(); c.ellipse(bl.x, bl.y, bl.r * 0.86, bl.r, 0, 0, 6.283); c.fill();
    c.fillStyle = 'rgba(255,255,255,.55)';
    c.beginPath(); c.ellipse(bl.x - bl.r * 0.3, bl.y - bl.r * 0.35, bl.r * 0.18, bl.r * 0.28, -0.5, 0, 6.283); c.fill();
  }
  for (const it of life.falling) {
    c.save(); c.translate(it.x, it.y); c.rotate(it.ang); glyph(c, it.icon, 0, 0, 64, k); c.restore();
  }
  for (const { item, at } of life.held.values()) {
    c.save(); c.translate(...at); c.rotate(Math.sin(now / 120) * 0.12); glyph(c, item.icon, 0, 0, 78, k); c.restore();
  }
  for (const h of hands) {
    c.strokeStyle = '#fff';
    c.lineWidth = 3 * k;
    c.beginPath(); c.arc(h.at[0], h.at[1], (h.pinch ? 9 : 14) * k, 0, 6.283); c.stroke();
  }
  if (life.banner) {
    const t = (now - life.banner.t0) / 2400;
    if (t > 1) life.banner = null;
    else {
      c.save();
      c.globalAlpha = Math.min(1, (1 - t) * 4);
      c.translate(W / 2, H * 0.42);
      c.scale(popIn(Math.min(t * 4, 1)), popIn(Math.min(t * 4, 1)));
      pill(c, life.banner.text, 0, 0, k, { size: 70, bg: '#ff6b9d' });
      c.restore();
    }
  }
}

// ---- Paint: a pinch draws a line of light; an open hand rubs it out; a fist held a second clears it all

const paint = { strokes: [], hue: 0 };

function drawPaint(c, F) {
  const { now, k, W, H, hands, S, sound } = F;
  const keep = S.ink >= INK_FOREVER ? Infinity : S.ink * 1000;
  for (const h of hands) {
    if (h.pinch) {
      if (!h.st.stroke) {
        paint.hue = (paint.hue + 47) % 360;
        h.st.stroke = { pts: [], hue: paint.hue };
        paint.strokes.push(h.st.stroke);
      }
      const pts = h.st.stroke.pts, last = pts.at(-1);
      if (!last || Math.hypot(h.at[0] - last.x, h.at[1] - last.y) > 4 * k) pts.push({ x: h.at[0], y: h.at[1], t: now });
      if (Math.random() < 0.6) emit({ x: h.at[0], y: h.at[1], vx: (Math.random() - 0.5) * 120 * k, vy: (Math.random() - 0.5) * 120 * k, size: 4, life: 0.5, color: `hsl(${h.st.stroke.hue},100%,75%)` });
    } else h.st.stroke = null;
    h.st.openSince = h.open ? h.st.openSince ?? now : null;
    if (h.open && now - h.st.openSince > 300) {
      const r = h.size * 0.95;
      for (const s of paint.strokes) for (const p of s.pts) if (Math.hypot(p.x - h.palm[0], p.y - h.palm[1]) < r) p.dead = true;
    }
    h.st.fistSince = h.fist ? h.st.fistSince ?? now : null;
    if (h.fist && now - h.st.fistSince > 900 && h.st.fistSince > 0) {
      h.st.fistSince = -1; // once per fist
      for (const s of paint.strokes) for (const p of s.pts) if (Math.random() < 0.08) burst(p.x, p.y, k, 2, { color: `hsl(${s.hue},100%,70%)`, size: 5, speed: 200 });
      paint.strokes = paint.strokes.filter(s => hands.some(o => o.st.stroke === s));
      sound({ name: 'whoosh' });
    }
  }
  for (const s of paint.strokes) {
    while (s.pts.length && (now - s.pts[0].t > keep || s.pts[0].dead)) s.pts.shift();
  }
  paint.strokes = paint.strokes.filter(s => s.pts.length || hands.some(h => h.st.stroke === s));

  c.save();
  c.globalCompositeOperation = 'lighter';
  c.lineCap = c.lineJoin = 'round';
  const copies = S.kaleido ? 6 : 1;
  for (let m = 0; m < copies; m++) for (const flip of S.kaleido ? [1, -1] : [1]) {
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (S.kaleido) { c.translate(W / 2, H / 2); c.rotate(m * Math.PI / 3); c.scale(flip, 1); c.translate(-W / 2, -H / 2); }
    for (const s of paint.strokes) {
      c.beginPath();
      let pen = false;
      for (const p of s.pts) {
        if (p.dead) { pen = false; continue; }
        if (pen) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y);
        pen = true;
      }
      for (const [width, color] of [[30, `hsla(${s.hue},100%,60%,.18)`], [12, `hsla(${s.hue},100%,62%,.85)`], [4, 'rgba(255,255,255,.9)']]) {
        c.lineWidth = width * k;
        c.strokeStyle = color;
        c.stroke();
      }
    }
  }
  c.restore();
  for (const h of hands) {
    if (h.open && now - (h.st.openSince ?? now) > 300) {
      c.save();
      c.strokeStyle = 'rgba(255,255,255,.7)';
      c.lineWidth = 3 * k;
      c.setLineDash([8 * k, 8 * k]);
      c.beginPath(); c.arc(h.palm[0], h.palm[1], h.size * 0.95, 0, 6.283); c.stroke();
      c.restore();
    }
    if (h.fist && h.st.fistSince > 0) {
      c.strokeStyle = '#fff';
      c.lineWidth = 6 * k;
      c.beginPath(); c.arc(h.palm[0], h.palm[1], h.size * 0.8, -Math.PI / 2, -Math.PI / 2 + Math.min((now - h.st.fistSince) / 900, 1) * 6.283); c.stroke();
    }
    c.fillStyle = h.pinch ? `hsl(${h.st.stroke?.hue ?? 0},100%,70%)` : 'rgba(255,255,255,.0)';
    c.strokeStyle = '#fff';
    c.lineWidth = 3 * k;
    c.beginPath(); c.arc(h.at[0], h.at[1], 10 * k, 0, 6.283); c.fill(); c.stroke();
  }
  if (!hands.length) { c.textAlign = 'center'; c.textBaseline = 'middle'; pill(c, 'Junta el pulgar y el índice para pintar con luz', W / 2, H - 60 * k, k); }
}

// ---- Energy: open hands facing each other charge a ball between them; closing both fists lets it go

const energy = { charge: 0, x: 0, y: 0, r: 0, show: 0, flash: 0, zap: 0 };

function bolt(c, a, b, jag, k) {
  const n = 7, dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  c.beginPath();
  c.moveTo(...a);
  for (let i = 1; i < n; i++) {
    const t = i / n, off = (Math.random() - 0.5) * jag * Math.sin(t * Math.PI);
    c.lineTo(a[0] + dx * t + nx * off, a[1] + dy * t + ny * off);
  }
  c.lineTo(...b);
  for (const [w, col] of [[10, 'rgba(140,120,255,.25)'], [3, 'rgba(230,240,255,.95)']]) { c.lineWidth = w * k; c.strokeStyle = col; c.stroke(); }
}

function orb(c, x, y, r, hue, heat, now) {
  const g = c.createRadialGradient(x, y, 0, x, y, r * 2);
  g.addColorStop(0, '#fff');
  g.addColorStop(0.18 + 0.1 * (1 - heat), `hsla(${hue},100%,${80 + heat * 15}%,.95)`);
  g.addColorStop(0.5, `hsla(${hue},100%,60%,.45)`);
  g.addColorStop(1, `hsla(${hue},100%,50%,0)`);
  c.fillStyle = g;
  c.beginPath(); c.arc(x, y, r * 2, 0, 6.283); c.fill();
  c.strokeStyle = `hsla(${hue},100%,85%,.6)`;
  c.lineWidth = r * 0.06;
  for (let i = 0; i < 3; i++) {
    const a = now / (300 + i * 120) + i * 2;
    c.beginPath(); c.arc(x, y, r * (0.75 + 0.12 * i), a, a + 1.4); c.stroke();
  }
}

function drawEnergy(c, F) {
  const { now, dt, k, W, H, hands, sound } = F;
  const open = hands.filter(h => h.count >= 3 && !h.pinch);
  const e = energy;
  c.save();
  c.globalCompositeOperation = 'lighter';
  if (open.length >= 2) {
    const [a, b] = open;
    const gap = dist(a.palm, b.palm);
    e.x = lerp(e.x, (a.palm[0] + b.palm[0]) / 2, e.show ? 0.5 : 1);
    e.y = lerp(e.y, (a.palm[1] + b.palm[1]) / 2, e.show ? 0.5 : 1);
    e.r = lerp(e.r, clamp(gap * 0.2, 24 * k, 240 * k) * (0.6 + 0.6 * e.charge), 0.3);
    e.charge = Math.min(1, e.charge + dt * 0.45);
    e.show = Math.min(1, e.show + dt * 4);
    const hue = lerp(190, 285, e.charge);
    // Bolts to a few fingertips each frame, and specks pulled in from around.
    for (const h of [a, b]) for (const t of [4, 8, 12, 16, 20]) if (Math.random() < 0.35 + e.charge * 0.4) bolt(c, [e.x, e.y], h.p[t], e.r * 0.8, k);
    for (let i = 0; i < 2 + e.charge * 4; i++) {
      const ang = Math.random() * 6.283, d = e.r * (2.5 + Math.random() * 2);
      emit({ x: e.x + Math.cos(ang) * d, y: e.y + Math.sin(ang) * d, vx: -Math.cos(ang) * d * 2.2, vy: -Math.sin(ang) * d * 2.2, life: 0.42, size: 4, color: `hsl(${hue},100%,75%)` });
    }
    if (now > e.zap) { sound({ name: 'zap', vel: 0.3 + e.charge * 0.5 }); e.zap = now + 120 + Math.random() * 260 * (1.2 - e.charge); }
  } else {
    e.show = Math.max(0, e.show - dt * 2.5);
    if (!e.show) e.charge = Math.max(0, e.charge - dt);
  }
  // Both fists after a charge: it goes off.
  if (hands.length >= 2 && hands.every(h => h.fist) && e.charge > 0.25 && e.show > 0) {
    const p = e.charge;
    sound({ name: 'boom', vel: 0.5 + p * 0.5 });
    e.flash = 0.35 + p * 0.5;
    for (let i = 0; i < 3; i++) emit({ kind: 'ring', x: e.x, y: e.y, r0: e.r, r1: (400 + i * 300) * k * (0.5 + p), size: 26 - i * 6, color: `hsl(${250 + i * 25},100%,75%)`, life: 0.6 + i * 0.25 });
    burst(e.x, e.y, k, 70, { color: ['#fff', '#b9a8ff', '#7fe3ff', '#ff9bf0'], size: 7, speed: 1500 * (0.5 + p) });
    e.charge = 0;
    e.show = 0;
  }
  if (e.show > 0) orb(c, e.x, e.y, e.r * e.show, lerp(190, 285, e.charge), e.charge, now);
  // A spark over a single open palm.
  for (const h of open) {
    if (open.length >= 2) break;
    const r = h.size * (0.28 + 0.04 * Math.sin(now / 90));
    orb(c, h.palm[0], h.palm[1] - h.size * 0.2, r, 195, 0.2, now);
    if (Math.random() < 0.5) emit({ x: h.palm[0] + (Math.random() - 0.5) * r, y: h.palm[1] - h.size * 0.2, vy: -220 * k, vx: (Math.random() - 0.5) * 60 * k, life: 0.6, size: 4, color: '#9fe8ff' });
  }
  c.restore();
  if (e.flash > 0) {
    c.fillStyle = `rgba(235,230,255,${e.flash})`;
    c.fillRect(0, 0, W, H);
    e.flash = Math.max(0, e.flash - dt * 1.6);
  }
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  if (open.length < 2 && !e.show) pill(c, hands.length ? 'Abre las dos manos, una frente a la otra' : 'Enseña las dos manos abiertas', W / 2, H - 60 * k, k);
  else if (e.charge > 0.25) pill(c, e.charge >= 1 ? '¡A tope! Cierra los puños' : 'Cargando… cierra los puños para soltarla', W / 2, H - 60 * k, k, { bg: 'rgba(90,60,200,.7)' });
}

// ---- One frame of whichever finger effect is on. hands: [{ id, p: 21 [x, y] in px }]; face: px box or null.

const DRAW = { music: drawMusic, life: drawLife, paint: drawPaint, energy: drawEnergy };

function fingersFrame(effect, F) {
  F.dt = Math.min((F.now - (lastFrame || F.now)) / 1000, 0.1);
  lastFrame = F.now;
  F.k = F.H / 1080;
  for (const h of F.hands) {
    h.st = handMem.get(h.id) ?? {};
    handMem.set(h.id, h.st);
    Object.assign(h, readHand(h.p, h.st));
    h.wasPinch = !!h.st.pinch;
    h.wasTouch = h.st.touch ?? -1;
    h.st.pinch = h.pinch;
    h.st.touch = h.touch;
  }
  for (const id of handMem.keys()) if (!F.hands.some(h => h.id === id)) handMem.delete(id);
  hx.setTransform(1, 0, 0, 1, 0, 0);
  hx.clearRect(0, 0, hud.width, hud.height);
  DRAW[effect](hx, F);
  drawParts(hx, F.dt, F.k);
}
