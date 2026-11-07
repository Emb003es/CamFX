// The two "sequence" effects: a hand swipe cuts from the camera to an animated scene with the person's
// silhouette inside. The art is painted once to canvases; the shader only composites and animates it.
const ART_W = 1920, ART_H = 1080;
const ART_LAYERS = { anime: 11, collage: 6 };

const SEQ_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 uv;
uniform sampler2D live, mask;
uniform sampler2DArray art;
uniform vec2 screen, frontPos;
uniform vec4 cam;
uniform float mirror, unit, time, cut, dir, glitch, frontAng, frontScale;
uniform bool entering;
uniform int style, bgLayer, frontLayer, personMode; // style: 0 anime, 1 collage. personMode: 0 none, 1 grey, 2 red, 3 bricks
out vec4 o;

const vec3 PAL[8] = vec3[8](vec3(1., .18, .71), vec3(1., .88, 0.), vec3(.09, .84, 1.), vec3(.23, .33, 1.),
                            vec3(.42, 1., .23), vec3(1., .48, .1), vec3(.69, .29, 1.), vec3(1., .2, .2));

float hash(vec3 p) {
  p = fract(p * .1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

vec2 camUv(vec2 q) {
  vec2 t = (q - cam.xy) / cam.zw;
  if (mirror > .5) t.x = 1. - t.x;
  return t;
}

vec3 camera(vec2 q) { return texture(live, camUv(q)).rgb; }

// White in the core of the body, more and more coloured bricks towards its edge.
vec3 bricks(vec2 q) {
  float core = textureLod(mask, camUv(q), 4.5).r;
  vec2 b = vec2(30., 16.) * unit;
  float row = floor(q.y / b.y), beat = floor(time * 5.);
  vec3 id = vec3(floor(q.x / b.x + mod(row, 2.) * .5), row, beat);
  return hash(id) < smoothstep(.98, .62, core) ? PAL[int(hash(id + 7.) * 8.)] : vec3(1.);
}

vec4 front(vec2 q) {
  vec2 d = (q - frontPos) / frontScale;
  float c = cos(frontAng), s = sin(frontAng);
  vec2 t = vec2(c * d.x + s * d.y, c * d.y - s * d.x) / screen + .5;
  if (any(lessThan(t, vec2(0.))) || any(greaterThan(t, vec2(1.)))) return vec4(0.);
  return texture(art, vec3(t, frontLayer));
}

vec3 scene(vec2 q) {
  vec2 s = q / screen;
  vec3 col;
  if (style == 1) {
    // The room stays underneath, pale and flat, showing between the shapes.
    vec3 room = mix(floor(camera(q) * 4.) / 4., vec3(1.), .55);
    vec4 a = texture(art, vec3(s + .004 * sin(s.yx * 9. + time), bgLayer));
    col = a.rgb + room * (1. - a.a);
  } else col = texture(art, vec3(s, bgLayer)).rgb;
  if (personMode > 0) {
    float m = textureLod(mask, camUv(q), 1.).r, w = max(fwidth(m), .01);
    vec3 fill, rim = vec3(1.);
    if (personMode == 1) {
      // Blurred first, or noise in the picture breaks the flat tones up.
      vec3 c = camera(q);
      for (int k = 0; k < 4; k++) c += camera(q + vec2(k < 2 ? 6. : -6., k % 2 == 0 ? 6. : -6.) * unit);
      fill = vec3(mix(.38, .78, floor(dot(c / 5., vec3(.3, .59, .11)) * 2.6 + .5) / 2.));
    } else if (personMode == 2) fill = texture(art, vec3(s, 0.)).rgb;
    else {
      fill = bricks(q);
      vec4 shards = texture(art, vec3(fract(s + floor(time * 2.) * vec2(.37, .61)), 5.));
      fill = shards.rgb + fill * (1. - shards.a);
      rim = vec3(.93, .16, .5);
    }
    col = mix(col, fill, smoothstep(.5 - w, .5 + w, m));
    // Measured in pixels, not in mask values: where the mask is unsure its slope is gentle and the rim would smear.
    float rimPx = abs(m - .5) / max(fwidth(m), 1e-3), rimW = personMode == 3 ? 2.5 : 1.;
    col = mix(col, rim, 1. - smoothstep(rimW, rimW + 1., rimPx));
  }
  if (frontLayer >= 0) {
    vec4 f = front(q);
    col = f.rgb + col * (1. - f.a);
  }
  return col;
}

// Rows pushed sideways and blocks gone coarse, the broken-signal look of the cuts.
vec2 glitched(vec2 p) {
  if (glitch <= 0.) return p;
  float beat = floor(time * 24.), row = floor(p.y / (22. * unit));
  p.x += (hash(vec3(0., row, beat)) - .5) * step(.55, hash(vec3(1., row, beat))) * glitch * 500. * unit;
  float size = 36. * unit;
  vec2 cell = floor(p / size);
  if (hash(vec3(cell, beat)) < glitch * .8) p = (cell + .5) * size;
  return p;
}

void main() {
  vec2 p = uv * screen;
  bool show;
  vec3 col = vec3(-1.);
  if (style == 1) {
    // A band of bright mesh sweeps across, away from the side the hand came from; its edge is cell by cell.
    float size = 92. * unit;
    vec2 w = p / size;
    w += .6 * vec2(sin(w.y * .5 + time), sin(w.x * .45 - time));
    vec2 id = floor(w), f = fract(w);
    float along = (dir > 0. ? id.x + .5 : screen.x / size - id.x - .5) * size / screen.x + .12 * hash(vec3(id, 3.));
    float band = cut * 1.7 - along;
    if (band > 0. && band < .5) {
      col = PAL[int(hash(vec3(id, 1.)) * 8.)] * (f.x + f.y > 1. ? .82 : 1.);
      vec2 e = min(f, 1. - f);
      if (min(e.x, e.y) < .025) col = vec3(1.);
    }
    show = entering ? band >= .5 : band <= 0.;
  } else {
    // Long shards flip one by one; the ones about to flip still show the camera, knocked out of place.
    vec2 r = mat2(.85, .52, -.52, .85) * p / (vec2(430., 150.) * unit);
    vec2 id = floor(r), f = fract(r);
    float tri = step(f.x, f.y), flip = cut * 1.3 - hash(vec3(id, tri));
    show = entering ? flip > 0. : flip <= 0.;
    if (!show && abs(flip) < .3) col = camera(p + (vec2(hash(vec3(id, 5.)), hash(vec3(id, 6.))) - .5) * (.3 - abs(flip)) * 500. * unit);
  }
  if (col.r >= 0.) { o = vec4(col, 1.); return; }
  if (!show) { o = vec4(0.); return; }
  col = scene(glitched(p));
  if (style == 0) {
    // A few loose squares blinking over everything.
    vec3 sq = vec3(floor(p / (24. * unit)), floor(time * 5.));
    if (hash(sq) > .9975) col = PAL[int(hash(sq.yxz + 3.) * 8.)];
  }
  o = vec4(col, 1.);
}`;

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function poly(c, fill, pts) {
  c.fillStyle = fill;
  c.beginPath();
  pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  c.closePath();
  c.fill();
}

// Text stretched to w wide: this is how the reel's very tall, narrow lettering is faked with a system font.
function tallText(c, text, x, y, h, w, fill) {
  c.save();
  c.font = `600 ${h}px Bahnschrift, Impact, sans-serif`;
  c.translate(x, y);
  c.scale(w / c.measureText(text).width, 1);
  c.fillStyle = fill;
  c.fillText(text, 0, 0);
  c.restore();
}

// The lettering is the user's: a word as tall as the original's gets a width in proportion to its length.
function paintAnime(layer, { title, subtitle }) {
  title = (title.trim() || 'EMBO').toUpperCase();
  subtitle = (subtitle.trim() || 'SEQUENCE').toUpperCase();
  const wide = (text, per, max) => Math.min(max, per * [...text].length);
  const RED = '#e9134f', BLACK = '#0a0212', GREEN = '#14ee6c', BLUE = '#0f5be0', PURPLE = '#9b4be8', DARK = '#2f2f31';
  const r = rng(7);
  const W = ART_W, H = ART_H;
  const at = pts => pts.map(([x, y]) => [x * 2.04, y * 2.32 - 40]); // shapes were measured on 940 wide frames of the reel
  const frac = pts => pts.map(([x, y]) => [x * W, y * H]);
  const circle = (c, x, y, rad, fill) => { c.fillStyle = fill; c.beginPath(); c.arc(x, y, rad, 0, 6.3); c.fill(); };
  const eye = (c, x, y, rad, rings) => { for (const [k, fill] of rings) circle(c, x, y, rad * k, fill); };

  const speckled = document.createElement('canvas');
  speckled.width = W;
  speckled.height = H;
  {
    const c = speckled.getContext('2d');
    c.fillStyle = RED;
    c.fillRect(0, 0, W, H);
    for (let i = 0; i < 2600; i++) circle(c, r() * W, r() * H, .7 + r() * r() * 3.2, '#fff');
  }

  // A dark stage with a bright panel behind where the person stands.
  const stage = (c, light, spike) => {
    c.fillStyle = DARK;
    c.fillRect(0, 0, W, H);
    poly(c, '#8f8f8f', at([[322, 25], [897, 25], [897, 480], [322, 480]]));
    poly(c, light, at([[322, 25], [822, 25], [795, 70], [770, 110], [775, 165], [800, 225], [705, 262], [640, 200], [540, 175], [470, 190], [410, 215], [322, 135]]));
    for (const s of [[[330, 60], [470, 210], [430, 205]], [[400, 120], [490, 220], [445, 225]], [[522, 95], [535, 190], [500, 190]], [[605, 125], [575, 195], [550, 182]], [[700, 150], [610, 215], [600, 195]], [[770, 240], [630, 235], [625, 215]]]) poly(c, spike, at(s));
    poly(c, DARK, at([[322, 135], [480, 285], [440, 400], [322, 270]]));
    poly(c, 'rgba(0,0,0,.3)', at([[600, 280], [700, 250], [897, 430], [897, 480], [760, 480]]));
  };

  // 0: red with white specks, also the person's fill in the red scene
  layer(c => c.drawImage(speckled, 0, 0));
  // 1: the mask with the two eyes
  layer(c => {
    poly(c, BLACK, at([[160, 155], [245, 100], [322, 62], [362, 18], [500, 18], [418, 280], [600, 172], [690, 165], [738, 150], [852, 30], [792, 140], [802, 150], [770, 190], [875, 255], [800, 270], [640, 385], [590, 375], [625, 420], [725, 405], [725, 432], [690, 445], [690, 480], [262, 480], [190, 320], [172, 205]]));
    poly(c, GREEN, at([[245, 110], [322, 62], [472, 112], [402, 288], [215, 255], [235, 150]]));
    poly(c, GREEN, at([[492, 292], [603, 168], [688, 190], [590, 375], [495, 325]]));
    poly(c, GREEN, at([[172, 210], [205, 205], [185, 295]]));
    poly(c, GREEN, at([[200, 345], [240, 395], [215, 402]]));
    poly(c, PURPLE, at([[612, 360], [662, 338], [650, 356], [625, 400]]));
    poly(c, PURPLE, at([[460, 447], [585, 437], [560, 458], [480, 458]]));
    poly(c, '#fff', at([[60, 405], [200, 405], [250, 410], [215, 430], [240, 445], [200, 480], [60, 480]]));
    poly(c, '#fff', at([[770, 405], [940, 405], [940, 480], [820, 480], [790, 450]]));
    poly(c, '#e0409a', at([[600, 198], [940, 198], [940, 201], [600, 201]]));
    const rings = [[1, BLACK], [.9, GREEN], [.72, BLACK], [.56, BLUE], [.29, '#fff']];
    for (const [x, y, rad] of [[676, 370, 165], [1153, 582, 140]]) {
      for (let i = 0; i < 9; i++) {
        const a = r() * 6.28, b = a + .13;
        poly(c, BLACK, [[x + Math.cos(a) * rad * .9, y + Math.sin(a) * rad * .9], [x + Math.cos(a + .06) * rad * 1.5, y + Math.sin(a + .06) * rad * 1.5], [x + Math.cos(b) * rad * .9, y + Math.sin(b) * rad * .9]]);
      }
      eye(c, x, y, rad, rings);
    }
  });
  // 2: grey stage
  layer(c => stage(c, '#e6e6e6', '#c4c4c4'));
  // 3: its green lettering
  layer(c => {
    tallText(c, title, 50, 650, 760, wide(title, 160, 1400), '#3df08e');
    tallText(c, 'OPENING', 1500, 950, 46, 150, '#3df08e');
    tallText(c, subtitle, 1500, 1120, 210, wide(subtitle, 49, 400), '#3df08e');
  });
  // 4: the eyes up close
  layer(c => {
    c.fillStyle = GREEN;
    c.fillRect(0, 0, W, H);
    poly(c, RED, frac([[.3, 0], [.5, 0], [.41, .18], [.38, .3], [.37, .12]]));
    // Almonds with a point at each end and a spike on the brow.
    const almond = (m, y0) => {
      const X = x => (m ? 1 - x : x) * W, Y = y => (y + y0) * H;
      c.fillStyle = BLACK;
      c.beginPath();
      c.moveTo(X(.01), Y(.36));
      c.quadraticCurveTo(X(.2), Y(.38), X(.345), Y(.16));
      c.lineTo(X(.34), Y(.36));
      c.quadraticCurveTo(X(.42), Y(.62), X(.47), Y(.86));
      c.quadraticCurveTo(X(.3), Y(.92), X(.14), Y(.82));
      c.quadraticCurveTo(X(.07), Y(.62), X(.01), Y(.36));
      c.fill();
    };
    almond(false, 0);
    almond(true, -.02);
    const rings = [[1, GREEN], [.93, BLACK], [.5, BLUE], [.22, '#fff']];
    eye(c, W * .33, H * .62, H * .13, rings);
    eye(c, W * .76, H * .6, H * .13, rings);
  });
  // 5: orange stage with red spikes
  layer(c => {
    const red = c.createPattern(speckled, 'no-repeat');
    stage(c, '#f59a0c', '#a8a8a8');
    poly(c, red, at([[0, 480], [0, 290], [60, 320], [110, 370], [165, 400], [262, 395], [282, 330], [300, 430], [322, 265], [342, 430], [382, 300], [400, 450], [940, 450], [940, 490], [0, 490]]));
    poly(c, red, at([[0, 150], [480, 165], [940, 225], [940, 243], [480, 192], [0, 186]]));
    poly(c, BLACK, at([[0, 390], [110, 425], [0, 440]]));
    poly(c, BLACK, at([[275, 225], [288, 225], [270, 440], [258, 440]]));
  });
  // 6: dark ground torn by red, for the title
  layer(c => {
    const red = c.createPattern(speckled, 'no-repeat');
    c.fillStyle = DARK;
    c.fillRect(0, 0, W, H);
    poly(c, '#55555a', at([[270, 430], [940, 245], [940, 300], [420, 490], [270, 490]]));
    const top = [[0, 0], [940, 0]];
    for (let x = 940; x > 0; x -= 34) top.push([x, 40 + r() * 40], [x - 17, 90 + r() * 110]);
    poly(c, red, at([...top, [0, 60]]));
    poly(c, red, at([[0, 120], [262, 120], [262, 490], [0, 490]]));
    poly(c, red, at([[262, 262], [940, 335], [940, 362], [262, 302]]));
    poly(c, '#f59a0c', at([[150, 40], [290, 40], [290, 195], [150, 195]]));
    circle(c, 225 * 2.04, 95 * 2.32 - 40, 62, BLACK);
    poly(c, BLACK, at([[165, 195], [185, 150], [262, 150], [282, 195]]));
    poly(c, BLACK, at([[42, 490], [75, 90], [85, 90], [64, 490]]));
    for (let i = 0; i < 14; i++) {
      c.strokeStyle = i % 2 ? PURPLE : '#ff2d6f';
      c.lineWidth = 2 + r() * 3;
      c.beginPath();
      c.moveTo(r() * W, r() * H);
      c.lineTo(r() * W, r() * H);
      c.stroke();
    }
  });
  // 7: the title
  layer(c => {
    c.save();
    c.transform(1, 0, -.28, 1, 0, 0);
    tallText(c, title, 780, 830, 420, wide(title, 190, 1050), '#ffd800');
    c.restore();
    poly(c, '#e8222f', [[720, 860], [1740, 830], [1680, 960], [670, 985]]);
    c.save();
    c.transform(1, -.03, -.28, 1, 0, 0);
    tallText(c, subtitle, 1000, 980, 110, wide(subtitle, 95, 760), BLACK);
    c.restore();
    for (let i = 0; i < 12; i++) poly(c, '#f59a0c', [[470 + i * 20, 985], [480 + i * 20, 985], [510 + i * 20, 860], [500 + i * 20, 860]]);
  });
  // 8: black with huge white lettering behind the mask
  layer(c => {
    c.fillStyle = BLACK;
    c.fillRect(0, 0, W, H);
    poly(c, RED, [[0, 790], [1000, 1080], [0, 1080]]);
    poly(c, RED, [[1180, 0], [1920, 0], [1920, 500]]);
    tallText(c, title, 150, 1000, 1200, wide(title, 405, 1620), '#fff');
  });
  // 9: a small version of the mask that fits on a face, 1200 wide around the centre of the layer
  layer(c => {
    poly(c, BLACK, [[360, 430], [800, 250], [1050, 300], [1120, 450], [1560, 300], [1500, 620], [1180, 860], [700, 800], [420, 660]]);
    poly(c, GREEN, [[470, 440], [800, 310], [1000, 400], [930, 660], [560, 640]]);
    poly(c, GREEN, [[1130, 540], [1440, 390], [1420, 610], [1180, 790], [1060, 730]]);
    const rings = [[1, BLACK], [.86, GREEN], [.68, BLACK], [.52, BLUE], [.25, '#fff']];
    eye(c, 740, 500, 150, rings);
    eye(c, 1250, 590, 125, rings);
  });
  // 10: eyes up close, with gaps so the lettering shows on both sides
  layer(c => {
    poly(c, GREEN, [[640, 130], [1320, 60], [1440, 500], [1270, 980], [520, 1010], [760, 560]]);
    poly(c, BLACK, [[940, 0], [1000, 200], [900, 330], [800, 130]]);
    poly(c, RED, [[780, 170], [1280, 150], [1250, 200], [800, 215]]);
    const rings = [[1, BLACK], [.88, GREEN], [.72, BLACK], [.56, BLUE], [.28, '#fff']];
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * 6.28 + .2;
      poly(c, BLACK, [[1010 + Math.cos(a) * 300, 560 + Math.sin(a) * 300], [1010 + Math.cos(a + .05) * 440, 560 + Math.sin(a + .05) * 440], [1010 + Math.cos(a + .1) * 300, 560 + Math.sin(a + .1) * 300]]);
    }
    eye(c, 1010, 560, 330, rings);
    eye(c, 1280, 80, 145, rings);
    eye(c, 610, 1040, 170, rings);
    eye(c, 930, 20, 110, rings);
  });
}

function paintCollage(layer) {
  const W = ART_W, H = ART_H;
  const VIVID = ['#ff2db4', '#ffe100', '#17d6ff', '#3a55ff', '#6cff3a', '#ff7a1a', '#b04bff', '#ff3333', '#00e0a0', '#ffffff'];
  const at = pts => pts.map(([x, y]) => [x * 2.04, y * 2.32 - 40]);

  const blob = (c, r, fill, x, y, rx, ry) => {
    const pts = [];
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * 6.283, k = .7 + r() * .5;
      pts.push([x * 2.04 + Math.cos(a) * rx * k, y * 2.32 - 40 + Math.sin(a) * ry * k]);
    }
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    c.fillStyle = fill;
    c.beginPath();
    c.moveTo(...mid(pts[0], pts[1]));
    for (let i = 1; i <= 9; i++) c.quadraticCurveTo(...pts[i % 9], ...mid(pts[i % 9], pts[(i + 1) % 9]));
    c.fill();
  };
  const zig = (c, color, width, pts, round) => {
    c.strokeStyle = color;
    c.lineWidth = width;
    c.lineJoin = round ? 'round' : 'miter';
    c.miterLimit = 6;
    c.beginPath();
    at(pts).forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
    c.stroke();
  };
  const ring = (c, color, width, x, y, rx, ry) => {
    c.strokeStyle = color;
    c.lineWidth = width;
    c.beginPath();
    c.ellipse(x * 2.04, y * 2.32 - 40, rx, ry, 0, 0, 6.3);
    c.stroke();
  };
  const wire = (c, r, color, x, y, w, h) => {
    const nx = 10, ny = 6, node = [];
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) node.push([x + (i + (r() - .5) * .6) * w / nx, y + (j + (r() - .5) * .6) * h / ny + Math.sin(i * .9) * h * .1]);
    c.strokeStyle = color;
    c.lineWidth = 1.6;
    c.beginPath();
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const n = node[j * (nx + 1) + i];
      if (i < nx) { c.moveTo(...n); c.lineTo(...node[j * (nx + 1) + i + 1]); }
      if (j < ny) { c.moveTo(...n); c.lineTo(...node[(j + 1) * (nx + 1) + i]); }
    }
    c.stroke();
  };
  const shard = (c, r, x, y, s, fill) => {
    const n = 3 + (r() * 4 | 0), a0 = r() * 6.28, pts = [];
    for (let i = 0; i < n; i++) {
      const a = a0 + i / n * 6.283, k = s * (.5 + r() * .7);
      pts.push([x + Math.cos(a) * k, y + Math.sin(a) * k]);
    }
    poly(c, fill, pts);
  };
  const cube = (c, x, y, s) => {
    const dx = s * .45, dy = s * .3;
    c.strokeStyle = '#111';
    c.lineWidth = 1.8;
    c.strokeRect(x, y, s, s);
    c.strokeRect(x + dx, y - dy, s, s);
    c.beginPath();
    for (const [a, b] of [[0, 0], [s, 0], [0, s], [s, s]]) { c.moveTo(x + a, y + b); c.lineTo(x + a + dx, y + b - dy); }
    c.stroke();
  };

  // 0: everything behind the person
  layer(c => {
    const r = rng(11);
    blob(c, r, '#fff21f', 90, 250, 370, 260);
    blob(c, r, '#fff21f', 60, 50, 220, 120);
    blob(c, r, '#ffe500', 500, 50, 170, 130);
    blob(c, r, '#ffe500', 590, 55, 150, 120);
    blob(c, r, '#7d5cf0', 190, 55, 240, 110);
    blob(c, r, '#8cf53a', 660, 100, 170, 150);
    blob(c, r, '#8cf53a', 760, 300, 150, 100);
    wire(c, r, '#37d8e8', 40, 80, 620, 360);
    wire(c, r, '#37d8e8', 500, -10, 500, 220);
    wire(c, r, '#111', 0, 760, 480, 300);
    wire(c, r, '#ff5a6e', 1460, 40, 300, 180);
    wire(c, r, '#6a3ce8', 1500, 180, 420, 260);
    wire(c, r, '#ff6aa8', 1560, 760, 360, 300);
    zig(c, '#ff5a2e', 44, [[700, 28], [835, 12], [720, 58], [842, 72], [692, 104], [770, 118]]);
    ring(c, '#7a3cf0', 38, 845, 135, 170, 110);
    zig(c, '#2fe8ff', 40, [[0, 90], [120, 100], [62, 170], [160, 130], [230, 175], [300, 120]]);
    zig(c, '#ff7040', 56, [[600, 270], [680, 470], [740, 340], [830, 470]]);
    zig(c, '#ff2db4', 66, [[700, 480], [790, 360], [860, 450], [950, 335]]);
    zig(c, '#2fe8ff', 76, [[610, 250], [690, 205], [758, 335], [885, 165], [950, 215]]);
    ring(c, '#ff3355', 86, 165, 410, 165, 170);
    blob(c, r, '#ff4fa8', 240, 300, 80, 60);
    ring(c, '#ff6fb0', 30, 240, 300, 60, 66);
    for (let i = 0; i < 26; i++) shard(c, r, r() * W, r() * H * .8, 8 + r() * 26, VIVID[r() * 9 | 0]);
    for (let i = 0; i < 420; i++) {
      c.fillStyle = VIVID[r() * 9 | 0];
      c.beginPath();
      c.arc(r() * W * .65, r() * H * .8, 1 + r() * r() * 8, 0, 6.3);
      c.fill();
    }
  });
  // 1-4: the pile in front of the body, redrawn so it churns
  for (let k = 0; k < 4; k++) layer(c => {
    const r = rng(100 + k);
    for (let i = 0; i < 170; i++) {
      const spread = (r() - .5) * (r() + .3);
      shard(c, r, W * (.48 + spread), H * (1.04 - r() * r() * .42), 22 + r() * 72, VIVID[r() * 9 | 0]);
    }
    for (let i = 0; i < 16; i++) cube(c, W * (.22 + r() * .56), H * (.68 + r() * .3), 18 + r() * 34);
  });
  // 5: loose bits that float inside the silhouette
  layer(c => {
    const r = rng(55);
    for (let i = 0; i < 46; i++) shard(c, r, r() * W, r() * H, 18 + r() * 52, VIVID[r() * 9 | 0]);
    for (let i = 0; i < 14; i++) {
      c.fillStyle = VIVID[r() * 9 | 0];
      c.fillRect(r() * W, r() * H, 80 + r() * 150, 16 + r() * 22);
    }
    for (let i = 0; i < 8; i++) cube(c, r() * W, r() * H, 18 + r() * 22);
  });
}

// Hands each finished layer over as a canvas. words: the anime's title and subtitle.
function paintArt(effect, emit, words) {
  const canvas = document.createElement('canvas');
  canvas.width = ART_W;
  canvas.height = ART_H;
  const c = canvas.getContext('2d');
  const layer = paint => {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, ART_W, ART_H);
    paint(c);
    emit(canvas);
  };
  (effect === 'anime' ? paintAnime : paintCollage)(layer, words);
}
