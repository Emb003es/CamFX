// Sounds of the finger effects, synthesized: no audio files. They play here in the panel because a page
// may only make sound after a click on it, and the overlay never gets one. The overlay says what to play.
const Sound = (() => {
  let ctx = null, master, out, wet, noise;

  // Without a click on the page yet, the context starts suspended and wakes on the next one.
  function wake() {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createDynamicsCompressor();
      master.connect(ctx.destination);
      out = ctx.createGain();
      out.gain.value = 0.8;
      out.connect(master);
      // A short echo gives the notes some room.
      const delay = ctx.createDelay(1), back = ctx.createGain();
      delay.delayTime.value = 0.27;
      back.gain.value = 0.3;
      wet = ctx.createGain();
      wet.connect(delay);
      delay.connect(back);
      back.connect(delay);
      delay.connect(out);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // A gain to play into, panned, with some of it sent to the echo.
  function voice(pan = 0, echo = 0) {
    const g = ctx.createGain(), p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p);
    p.connect(out);
    if (echo) {
      const s = ctx.createGain();
      s.gain.value = echo;
      p.connect(s);
      s.connect(wet);
    }
    return g;
  }

  // Up to peak in a seconds, then down to nothing in d.
  function env(param, t, a, peak, d) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + a);
    param.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  function osc(type, freq, t, dur, dest) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(dest);
    o.start(t);
    o.stop(t + dur);
    return o;
  }

  function hiss(t, dur, dest, type = 'highpass', freq = 1000) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter();
    s.buffer = noise;
    s.loop = true;
    f.type = type;
    f.frequency.value = freq;
    s.connect(f);
    f.connect(dest);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur);
    return f;
  }

  const INSTRUMENTS = {
    piano(f, t, g) {
      env(g.gain, t, 0.005, 0.32, 1.5);
      osc('triangle', f, t, 1.6, g);
      const h = ctx.createGain();
      h.gain.value = 0.25;
      h.connect(g);
      osc('sine', f * 2, t, 1.6, h);
    },
    synth(f, t, g) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 7;
      lp.frequency.setValueAtTime(5000, t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.5, 200), t + 0.35);
      lp.connect(g);
      env(g.gain, t, 0.01, 0.2, 0.8);
      for (const cents of [-8, 8]) osc('sawtooth', f * 2 ** (cents / 1200), t, 0.9, lp);
    },
    bells(f, t, g) {
      // FM: a sine bending another at an inharmonic ratio, the bending fading out faster than the note.
      const mod = ctx.createGain();
      mod.gain.setValueAtTime(f * 4, t);
      mod.gain.exponentialRampToValueAtTime(1, t + 1.6);
      const carrier = osc('sine', f, t, 2.6, g);
      mod.connect(carrier.frequency);
      osc('sine', f * 3.5, t, 2.6, mod);
      env(g.gain, t, 0.003, 0.3, 2.5);
    },
  };

  const DRUMS = [
    (t, g) => { // kick
      const o = osc('sine', 150, t, 0.5, g);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.35);
      env(g.gain, t, 0.002, 1, 0.45);
    },
    (t, g) => { // snare
      env(g.gain, t, 0.002, 0.6, 0.2);
      hiss(t, 0.25, g, 'highpass', 1500);
      osc('triangle', 190, t, 0.12, g);
    },
    (t, g) => { env(g.gain, t, 0.001, 0.35, 0.06); hiss(t, 0.08, g, 'highpass', 7000); }, // closed hat
    (t, g) => { // clap: three quick bursts
      for (const dt of [0, 0.012, 0.024]) hiss(t + dt, 0.012, g, 'bandpass', 1300);
      env(g.gain, t, 0.002, 0.8, 0.2);
      hiss(t + 0.03, 0.18, g, 'bandpass', 1100);
    },
    (t, g) => { const o = osc('sine', 130, t, 0.4, g); o.frequency.exponentialRampToValueAtTime(70, t + 0.3); env(g.gain, t, 0.002, 0.8, 0.35); },
    (t, g) => { const o = osc('sine', 220, t, 0.3, g); o.frequency.exponentialRampToValueAtTime(120, t + 0.25); env(g.gain, t, 0.002, 0.7, 0.28); },
    (t, g) => { env(g.gain, t, 0.002, 0.3, 0.9); hiss(t, 1, g, 'highpass', 5000); }, // cymbal
    (t, g) => { env(g.gain, t, 0.001, 0.25, 0.25); for (const f of [540, 800]) osc('square', f, t, 0.3, g); }, // cowbell
  ];

  // Little noises of the life, paint and energy effects.
  const SFX = {
    pop(t, g) { const o = osc('sine', 500, t, 0.15, g); o.frequency.exponentialRampToValueAtTime(1300, t + 0.08); env(g.gain, t, 0.003, 0.4, 0.1); },
    blip(t, g) { env(g.gain, t, 0.003, 0.15, 0.12); osc('square', 880, t, 0.06, g); osc('square', 1320, t + 0.07, 0.08, g); },
    yum(t, g) {
      env(g.gain, t, 0.005, 0.3, 0.35);
      [523, 659, 784].forEach((f, i) => osc('triangle', f, t + i * 0.08, 0.1, g));
    },
    hug(t, g) { env(g.gain, t, 0.02, 0.25, 0.5); osc('sine', 784, t, 0.2, g); osc('sine', 659, t + 0.17, 0.35, g); },
    sparkle(t, g) {
      env(g.gain, t, 0.003, 0.18, 0.7);
      for (let i = 0; i < 6; i++) osc('sine', 1800 + Math.random() * 2400, t + i * 0.05, 0.12, g);
    },
    levelup(t, g) {
      env(g.gain, t, 0.005, 0.25, 1.1);
      [523, 659, 784, 1047, 1319].forEach((f, i) => osc('square', f, t + i * 0.09, 0.12, g));
    },
    fanfare(t, g) {
      env(g.gain, t, 0.005, 0.25, 1.3);
      [[523, 0], [523, 0.12], [523, 0.24], [698, 0.36], [880, 0.6]].forEach(([f, dt]) => osc('sawtooth', f, t + dt, dt > 0.5 ? 0.6 : 0.1, g));
    },
    whoosh(t, g) {
      const f = hiss(t, 0.6, g, 'bandpass', 300);
      f.frequency.exponentialRampToValueAtTime(3500, t + 0.5);
      env(g.gain, t, 0.15, 0.5, 0.4);
    },
    zap(t, g, vel) {
      const o = osc('sawtooth', 300 + Math.random() * 900, t, 0.09, g);
      o.frequency.exponentialRampToValueAtTime(80 + Math.random() * 100, t + 0.08);
      env(g.gain, t, 0.002, 0.08 * vel, 0.08);
    },
    boom(t, g, vel) {
      const f = hiss(t, 1.4, g, 'lowpass', 2500);
      f.frequency.exponentialRampToValueAtTime(60, t + 1.2);
      const o = osc('sine', 90, t, 1.2, g);
      o.frequency.exponentialRampToValueAtTime(28, t + 1);
      env(g.gain, t, 0.005, 0.9 * vel, 1.3);
    },
  };

  function play({ name, inst, freq, n, pan = 0, vel = 1 }) {
    wake();
    if (ctx.state !== 'running') return; // nobody has clicked yet: better silent than a pile-up later
    const t = ctx.currentTime + 0.005;
    if (name === 'note') INSTRUMENTS[inst]?.(freq, t, voice(pan, 0.35));
    else if (name === 'drum') DRUMS[n]?.(t, voice(pan));
    else SFX[name]?.(t, voice(pan, 0.15), vel);
  }

  // An audio track for the recording: these sounds, plus the microphone if one is given.
  function track(mic) {
    wake();
    const dest = ctx.createMediaStreamDestination();
    master.connect(dest);
    const src = mic ? ctx.createMediaStreamSource(mic) : null;
    src?.connect(dest);
    return {
      track: dest.stream.getAudioTracks()[0],
      stop() {
        master.disconnect(dest);
        src?.disconnect();
        mic?.getTracks().forEach(t => t.stop());
      },
    };
  }

  // Any click or key in the panel counts as the go-ahead.
  addEventListener('pointerdown', wake);
  addEventListener('keydown', wake);
  return { play, track, wake };
})();
