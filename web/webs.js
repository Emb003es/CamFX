// Shader of the "Telas de tinta" effect: cyanotype, risograph and stippling stretched between the
// fingertips of two hands. Each sheet is a lens on the camera: the picture stays put, only its outline moves.
const WEB_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D live;
uniform vec2 screen, tips[8]; // in px: four on one hand, then the same four on the other
uniform vec4 cam;             // camera frame on screen in px: x, y, w, h
uniform float mirror, unit;
out vec4 o;

// Distance to a polygon that may cross itself, as the sheets do when the hands turn. Negative inside.
float sheetDist(vec2 p, vec2 v[4]) {
  float m = 1e12, s = 1.;
  for (int i = 0, j = 3; i < 4; j = i, i++) {
    vec2 e = v[j] - v[i], w = p - v[i];
    vec2 b = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-6), 0., 1.);
    m = min(m, dot(b, b));
    bvec3 c = bvec3(p.y >= v[i].y, p.y < v[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
  }
  return s * sqrt(m);
}

float luma(vec2 q) {
  vec2 t = (q - cam.xy) / cam.zw;
  if (mirror > .5) t.x = 1. - t.x;
  return dot(texture(live, t).rgb, vec3(.3, .59, .11));
}

// True on a share of the grain cells equal to cover: how ink breaks up on paper.
float speckle(vec2 p, float seed, float cover) {
  vec3 q = fract(vec3(floor(p / (2. * unit)), seed) * .1031);
  q += dot(q, q.zyx + 31.32);
  return step(fract((q.x + q.y) * q.z), cover);
}

// Light turns the paper blue and shadow leaves it white. Even full light misses a few specks.
vec3 cyanotype(vec2 p) {
  return mix(vec3(.93, .95, .97), vec3(.094, .314, .529), speckle(p, 1., .985 * smoothstep(.18, .55, luma(p))));
}

// Three inks printed out of register; the green is where blue and yellow overlap.
vec3 riso(vec2 p) {
  vec3 col = vec3(.988, .953, .91);
  vec3 inks[3] = vec3[3](vec3(.97, .76, .82), vec3(.03, .66, .85), vec3(1., .8, .07));
  vec2 shifts[3] = vec2[3](vec2(-.016, 0.), vec2(-.006, .003), vec2(.009, -.002));
  for (int k = 0; k < 3; k++) {
    float cover = smoothstep(.32, .85, 1. - luma(p + shifts[k] * cam.z));
    col *= mix(vec3(1.), inks[k], speckle(p, float(k + 2), cover));
  }
  return col;
}

// A halftone grid. Only mid-tones print: in the reel both the wall and a black shirt stay blank paper.
vec3 stipple(vec2 p) {
  float cell = 15. * unit;
  vec2 c = (floor(p / cell) + .5) * cell;
  float l = luma(c), size = smoothstep(.15, .3, l) * (1. - smoothstep(.42, .62, l));
  // At most the cell's own half width: past that a dot would be cut into a square.
  float ink = clamp(cell * .5 * sqrt(size) - length(p - c) + .5, 0., 1.) * step(.04, size);
  return mix(vec3(1.), vec3(.88, .25, .22), ink);
}

void main() {
  vec2 p = uv * screen;
  o = vec4(0.);
  for (int k = 0; k < 3; k++) {
    float a = clamp(.5 - sheetDist(p, vec2[4](tips[k], tips[k + 4], tips[k + 5], tips[k + 1])), 0., 1.);
    if (a <= 0.) continue;
    vec3 col = k == 0 ? cyanotype(p) : k == 1 ? riso(p) : stipple(p);
    o = vec4(col * a, a) + o * (1. - a);
  }
}`;
