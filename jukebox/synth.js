// web audio instruments for the jukebox. every sound is built from oscillators,
// noise and filters at play time; nothing is sampled.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Synth {
  constructor() {
    this.ctx = null;
    this.buses = [];
    this.lastFreq = [];
  }

  // pass an OfflineAudioContext to render a score to a buffer instead of the speakers
  init(given = null) {
    if (this.ctx) return this.ctx;
    const ctx = (this.ctx = given || new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.mix = ctx.createGain();
    this.mix.gain.value = 0.55;
    this.mix.connect(comp).connect(this.master).connect(this.analyser).connect(ctx.destination);
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(2.2);
    this.verbOut = ctx.createGain();
    this.verbOut.gain.value = 0.6;
    this.verb.connect(this.verbOut).connect(this.mix);
    this.noise = this.noiseBuffer();
    this.waves = {};
    return ctx;
  }

  impulse(sec) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return b;
  }

  noiseBuffer() {
    const ctx = this.ctx;
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  pulseWave(duty) {
    const key = duty.toFixed(3);
    if (this.waves[key]) return this.waves[key];
    const n = 64;
    const re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    return (this.waves[key] = this.ctx.createPeriodicWave(re, im));
  }

  // one bus per voice: gain (volume x mute) -> pan -> mix, plus a reverb send
  setVoices(voices) {
    const ctx = this.init();
    for (const b of this.buses) b.gain.disconnect();
    this.buses = voices.map((v) => {
      const gain = ctx.createGain();
      gain.gain.value = v.vol;
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, v.pan));
      const send = ctx.createGain();
      send.gain.value = v.rev;
      gain.connect(pan).connect(this.mix);
      pan.connect(send).connect(this.verb);
      return { gain, pan, send, v };
    });
    this.lastFreq = voices.map(() => null);
  }

  setMuted(i, muted) {
    const b = this.buses[i];
    if (!b) return;
    b.gain.gain.setTargetAtTime(muted ? 0 : b.v.vol, this.ctx.currentTime, 0.015);
  }

  setVolume(x) { if (this.master) this.master.gain.setTargetAtTime(x, this.ctx.currentTime, 0.02); }

  // stop everything already scheduled: rebuild the buses so pending nodes go nowhere
  hush() {
    if (!this.ctx) return;
    const voices = this.buses.map((b) => b.v);
    const muted = this.buses.map((b) => b.gain.gain.value === 0);
    for (const b of this.buses) { b.gain.gain.cancelScheduledValues(0); b.gain.gain.setValueAtTime(0, this.ctx.currentTime); }
    this.setVoices(voices);
    muted.forEach((m, i) => m && this.setMuted(i, true));
  }

  play(vi, t, dur, midi, vel, slide) {
    const bus = this.buses[vi];
    if (!bus) return;
    const v = bus.v;
    const out = bus.gain;
    if (v.drum) { (DRUM[v.instrument] || DRUM.noise)(this, out, t, vel, v); return; }
    const inst = INST[v.instrument] || INST.sine;
    const len = Math.max(0.02, dur * v.gate);
    if (v.arp > 0 && midi.length > 1) {
      let k = 0;
      for (let at = t; at < t + len - 0.005; at += v.arp, k++) {
        inst(this, out, at, Math.min(v.arp * 0.92, t + len - at), mtof(midi[k % midi.length]), vel * 0.9, v, null);
      }
      this.lastFreq[vi] = mtof(midi[midi.length - 1]);
      return;
    }
    const scale = midi.length > 1 ? 1 / Math.sqrt(midi.length) : 1;
    for (const m of midi) {
      const f = mtof(m);
      inst(this, out, t, len, f, vel * scale, v, slide ? this.lastFreq[vi] : null);
    }
    this.lastFreq[vi] = mtof(midi[midi.length - 1]);
  }
}

// ---------------------------------------------------------------- helpers
function osc(s, type, f, t, from = null, glide = 0.06) {
  const o = s.ctx.createOscillator();
  if (type instanceof PeriodicWave) o.setPeriodicWave(type); else o.type = type;
  if (from) {
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(f, t + glide);
  } else o.frequency.setValueAtTime(f, t);
  return o;
}

// attack / decay-to-sustain / release envelope on a fresh gain node
function env(s, t, len, { a = 0.005, d = 0.1, sus = 0.7, r = 0.08, peak = 1 } = {}) {
  const g = s.ctx.createGain();
  const p = g.gain;
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setTargetAtTime(peak * sus, t + a, d / 3);
  const off = t + Math.max(len, a);
  p.cancelScheduledValues(off);
  p.setTargetAtTime(0, off, r / 4);
  g.end = off + r * 1.5;
  return g;
}

// a struck sound that just decays, no sustain
function strike(s, t, decay, peak = 1, a = 0.002) {
  const g = s.ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + decay);
  g.end = t + a + decay + 0.02;
  return g;
}

function lp(s, f, q = 0.7) { const b = s.ctx.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = f; b.Q.value = q; return b; }
function hp(s, f, q = 0.7) { const b = s.ctx.createBiquadFilter(); b.type = 'highpass'; b.frequency.value = f; b.Q.value = q; return b; }
function bp(s, f, q = 1) { const b = s.ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; return b; }

function start(nodes, t, end) { for (const n of nodes) { n.start(t); n.stop(end); } }

function vibrato(s, o, t, rate = 5.5, depth = 0.004, delay = 0.18) {
  const l = s.ctx.createOscillator();
  l.frequency.value = rate;
  const g = s.ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.frequency.value * depth, t + delay + 0.2);
  l.connect(g).connect(o.frequency);
  return l;
}

function noiseSrc(s, t) {
  const n = s.ctx.createBufferSource();
  n.buffer = s.noise;
  n.loop = true;
  n.loopStart = Math.random();
  return n;
}

const rel = (v, d) => (v.rel ?? d);
const att = (v, d) => (v.att ?? d);

// ---------------------------------------------------------------- melodic instruments
const INST = {
  pulse(s, out, t, len, f, vel, v, from) {
    const o = osc(s, s.pulseWave(v.duty || 0.25), f, t, from, v.glide);
    const g = env(s, t, len, { a: att(v, 0.003), d: 0.12, sus: 0.65, r: rel(v, 0.04), peak: 0.32 * vel });
    const l = len > 0.25 ? vibrato(s, o, t, 6, 0.006, 0.2) : null;
    o.connect(g).connect(out);
    start(l ? [o, l] : [o], t, g.end);
  },
  square(s, out, t, len, f, vel, v, from) { INST.pulse(s, out, t, len, f, vel, { ...v, duty: 0.5 }, from); },
  tri(s, out, t, len, f, vel, v, from) {
    const o = osc(s, 'triangle', f, t, from, v.glide);
    const g = env(s, t, len, { a: att(v, 0.003), d: 0.05, sus: 0.95, r: rel(v, 0.03), peak: 0.6 * vel });
    o.connect(g).connect(out);
    start([o], t, g.end);
  },
  sine(s, out, t, len, f, vel, v, from) {
    const o = osc(s, 'sine', f, t, from, v.glide);
    const g = env(s, t, len, { a: att(v, 0.01), d: 0.1, sus: 0.85, r: rel(v, 0.1), peak: 0.55 * vel });
    o.connect(g).connect(out);
    start([o], t, g.end);
  },
  saw(s, out, t, len, f, vel, v, from) {
    const o = osc(s, 'sawtooth', f, t, from, v.glide);
    const fl = lp(s, Math.min(16000, f * 6 * v.bright), 0.8);
    const g = env(s, t, len, { a: att(v, 0.004), d: 0.15, sus: 0.6, r: rel(v, 0.06), peak: 0.28 * vel });
    o.connect(fl).connect(g).connect(out);
    start([o], t, g.end);
  },
  lead(s, out, t, len, f, vel, v, from) {
    const a = osc(s, 'sawtooth', f, t, from, v.glide), b = osc(s, 'sawtooth', f * 1.006, t, from && from * 1.006, v.glide);
    const fl = lp(s, Math.min(14000, f * 5 * v.bright), 1.2);
    const g = env(s, t, len, { a: att(v, 0.01), d: 0.2, sus: 0.75, r: rel(v, 0.12), peak: 0.2 * vel });
    const l = vibrato(s, a, t, 5.6, 0.006, 0.22), l2 = vibrato(s, b, t, 5.6, 0.006, 0.22);
    a.connect(fl); b.connect(fl); fl.connect(g).connect(out);
    start([a, b, l, l2], t, g.end);
  },
  vibes(s, out, t, len, f, vel, v) {
    const dec = Math.max(0.6, Math.min(2.2, len + 0.9));
    const a = osc(s, 'sine', f, t), b = osc(s, 'sine', f * 4, t);
    const ga = strike(s, t, dec, 0.42 * vel), gb = strike(s, t, 0.25, 0.1 * vel);
    const trem = s.ctx.createOscillator(); trem.frequency.value = 5;
    const tg = s.ctx.createGain(); tg.gain.value = 0.12 * vel;
    trem.connect(tg).connect(ga.gain);
    a.connect(ga).connect(out); b.connect(gb).connect(out);
    start([a, b, trem], t, ga.end);
  },
  marimba(s, out, t, len, f, vel) {
    const a = osc(s, 'sine', f, t), b = osc(s, 'sine', f * 4, t), c = osc(s, 'sine', f * 9.9, t);
    const ga = strike(s, t, 0.45, 0.5 * vel), gb = strike(s, t, 0.12, 0.16 * vel), gc = strike(s, t, 0.03, 0.08 * vel);
    a.connect(ga).connect(out); b.connect(gb).connect(out); c.connect(gc).connect(out);
    start([a, b, c], t, ga.end);
  },
  glock(s, out, t, len, f, vel) {
    const ratios = [[1, 0.36, 1.4], [2.76, 0.14, 0.6], [5.4, 0.08, 0.25], [8.93, 0.04, 0.12]];
    const nodes = [];
    let end = t;
    for (const [r, p, d] of ratios) {
      const o = osc(s, 'sine', f * r, t), g = strike(s, t, d, p * vel);
      o.connect(g).connect(out); nodes.push(o); end = Math.max(end, g.end);
    }
    start(nodes, t, end);
  },
  bell(s, out, t, len, f, vel) {
    const c = osc(s, 'sine', f, t), m = osc(s, 'sine', f * 3.5, t);
    const mg = s.ctx.createGain();
    mg.gain.setValueAtTime(f * 2.2, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.1, t + 1.2);
    m.connect(mg).connect(c.frequency);
    const g = strike(s, t, 2.2, 0.32 * vel);
    c.connect(g).connect(out);
    start([c, m], t, g.end);
  },
  musicbox(s, out, t, len, f, vel) {
    const a = osc(s, 'sine', f, t), b = osc(s, 'sine', f * 3.01, t), c = osc(s, 'triangle', f * 2, t);
    const ga = strike(s, t, 1.1, 0.34 * vel), gb = strike(s, t, 0.15, 0.08 * vel), gc = strike(s, t, 0.35, 0.06 * vel);
    a.connect(ga).connect(out); b.connect(gb).connect(out); c.connect(gc).connect(out);
    start([a, b, c], t, ga.end);
  },
  epiano(s, out, t, len, f, vel, v) {
    const c = osc(s, 'sine', f, t), m = osc(s, 'sine', f, t), tine = osc(s, 'sine', f * 14, t);
    const mg = s.ctx.createGain();
    mg.gain.setValueAtTime(f * 1.6 * vel, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.15, t + 0.5);
    m.connect(mg).connect(c.frequency);
    const g = env(s, t, len, { a: 0.003, d: 1.6, sus: 0.25, r: rel(v, 0.25), peak: 0.38 * vel });
    const gt = strike(s, t, 0.08, 0.05 * vel);
    const trem = s.ctx.createOscillator(); trem.frequency.value = 4.2;
    const tg = s.ctx.createGain(); tg.gain.value = 0.06 * vel;
    trem.connect(tg).connect(g.gain);
    c.connect(g).connect(out); tine.connect(gt).connect(out);
    start([c, m, tine, trem], t, g.end);
  },
  organ(s, out, t, len, f, vel, v) {
    const bars = [[0.5, 0.5], [1, 1], [2, 0.6], [3, 0.4], [4, 0.25], [8, 0.08]];
    const g = env(s, t, len, { a: att(v, 0.012), d: 0.05, sus: 1, r: rel(v, 0.06), peak: 0.11 * vel });
    const lfo = s.ctx.createOscillator(); lfo.frequency.value = 6.4;
    const nodes = [lfo];
    for (const [r, p] of bars) {
      const o = osc(s, 'sine', f * r, t);
      const lg = s.ctx.createGain(); lg.gain.value = f * r * 0.003;
      lfo.connect(lg).connect(o.frequency);
      const pg = s.ctx.createGain(); pg.gain.value = p;
      o.connect(pg).connect(g);
      nodes.push(o);
    }
    g.connect(out);
    start(nodes, t, g.end);
  },
  clav(s, out, t, len, f, vel, v) {
    const o = osc(s, s.pulseWave(0.12), f, t);
    const fl = bp(s, Math.min(9000, f * 3 * v.bright), 2.2);
    const g = env(s, t, Math.min(len, 0.3), { a: 0.002, d: 0.12, sus: 0.35, r: rel(v, 0.03), peak: 0.55 * vel });
    o.connect(fl).connect(g).connect(out);
    start([o], t, g.end);
  },
  brass(s, out, t, len, f, vel, v, from) {
    const a = osc(s, 'sawtooth', f, t, from || f * 0.97, from ? v.glide : 0.05), b = osc(s, 'sawtooth', f * 1.004, t, from || f * 0.97, from ? v.glide : 0.05);
    const fl = lp(s, f * 1.2, 1.4);
    fl.frequency.setValueAtTime(f * 1.2, t);
    fl.frequency.linearRampToValueAtTime(Math.min(12000, f * 7 * v.bright * vel), t + 0.07);
    fl.frequency.setTargetAtTime(f * 4 * v.bright, t + 0.08, 0.2);
    const g = env(s, t, len, { a: att(v, 0.02), d: 0.2, sus: 0.8, r: rel(v, 0.1), peak: 0.22 * vel });
    a.connect(fl); b.connect(fl); fl.connect(g).connect(out);
    start([a, b], t, g.end);
  },
  stab(s, out, t, len, f, vel, v) {
    const a = osc(s, 'sawtooth', f, t), b = osc(s, 'square', f * 1.003, t);
    const fl = lp(s, f * 8, 3);
    fl.frequency.setValueAtTime(Math.min(14000, f * 10 * v.bright), t);
    fl.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.22);
    const g = env(s, t, Math.min(len, 0.35), { a: 0.002, d: 0.15, sus: 0.4, r: rel(v, 0.06), peak: 0.24 * vel });
    a.connect(fl); b.connect(fl); fl.connect(g).connect(out);
    start([a, b], t, g.end);
  },
  pluck(s, out, t, len, f, vel, v) {
    const o = osc(s, 'sawtooth', f, t);
    const fl = lp(s, f * 10, 1);
    fl.frequency.setValueAtTime(Math.min(15000, f * 12 * v.bright), t);
    fl.frequency.exponentialRampToValueAtTime(Math.max(80, f * 0.8), t + 0.35);
    const g = strike(s, t, Math.min(0.9, len + 0.25), 0.4 * vel);
    o.connect(fl).connect(g).connect(out);
    start([o], t, g.end);
  },
  pad(s, out, t, len, f, vel, v) {
    const nodes = [];
    const fl = lp(s, Math.min(6000, f * 3 * v.bright), 0.6);
    for (const d of [0.994, 1, 1.007]) { const o = osc(s, 'sawtooth', f * d, t); o.connect(fl); nodes.push(o); }
    const g = env(s, t, len, { a: att(v, 0.35), d: 0.4, sus: 0.85, r: rel(v, 0.7), peak: 0.12 * vel });
    fl.connect(g).connect(out);
    start(nodes, t, g.end);
  },
  strings(s, out, t, len, f, vel, v) {
    const nodes = [];
    const fl = lp(s, Math.min(9000, f * 4 * v.bright), 0.5);
    for (const d of [0.996, 1.004]) { const o = osc(s, 'sawtooth', f * d, t); o.connect(fl); nodes.push(o, vibrato(s, o, t, 5, 0.004, 0.25)); }
    const g = env(s, t, len, { a: att(v, 0.12), d: 0.3, sus: 0.9, r: rel(v, 0.35), peak: 0.13 * vel });
    fl.connect(g).connect(out);
    start(nodes, t, g.end);
  },
  whistle(s, out, t, len, f, vel, v, from) {
    const o = osc(s, 'sine', f, t, from, v.glide);
    const l = vibrato(s, o, t, 5.2, 0.008, 0.15);
    const g = env(s, t, len, { a: att(v, 0.04), d: 0.1, sus: 0.9, r: rel(v, 0.08), peak: 0.38 * vel });
    const n = noiseSrc(s, t), nf = bp(s, f * 2, 8), ng = env(s, t, len, { a: 0.03, sus: 0.6, r: 0.05, peak: 0.04 * vel });
    o.connect(g).connect(out); n.connect(nf).connect(ng).connect(out);
    start([o, l, n], t, g.end);
  },
  synbass(s, out, t, len, f, vel, v, from) {
    const a = osc(s, 'sawtooth', f, t, from, v.glide), b = osc(s, 'square', f * 0.5, t, from && from * 0.5, v.glide);
    const fl = lp(s, f * 4, 4);
    fl.frequency.setValueAtTime(Math.min(8000, f * 14 * v.bright), t);
    fl.frequency.exponentialRampToValueAtTime(f * 2, t + 0.18);
    const g = env(s, t, len, { a: 0.003, d: 0.2, sus: 0.6, r: rel(v, 0.05), peak: 0.32 * vel });
    const bg = s.ctx.createGain(); bg.gain.value = 0.6;
    a.connect(fl); b.connect(bg).connect(fl); fl.connect(g).connect(out);
    start([a, b], t, g.end);
  },
  fmbass(s, out, t, len, f, vel, v, from) {
    const c = osc(s, 'sine', f, t, from, v.glide), m = osc(s, 'sine', f, t, from, v.glide);
    const mg = s.ctx.createGain();
    mg.gain.setValueAtTime(f * 3 * vel * v.bright, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.3, t + 0.25);
    m.connect(mg).connect(c.frequency);
    const g = env(s, t, len, { a: 0.002, d: 0.3, sus: 0.6, r: rel(v, 0.05), peak: 0.62 * vel });
    c.connect(g).connect(out);
    start([c, m], t, g.end);
  },
  slap(s, out, t, len, f, vel, v, from) {
    const o = osc(s, s.pulseWave(0.35), f, t, from, v.glide), sub = osc(s, 'sine', f, t, from, v.glide);
    const fl = lp(s, f * 3, 2);
    fl.frequency.setValueAtTime(Math.min(9000, f * 16 * v.bright * vel), t);
    fl.frequency.exponentialRampToValueAtTime(f * 2.2, t + 0.09);
    const g = env(s, t, len, { a: 0.002, d: 0.25, sus: 0.5, r: rel(v, 0.04), peak: 0.32 * vel });
    const sg = env(s, t, len, { a: 0.003, d: 0.2, sus: 0.8, r: rel(v, 0.04), peak: 0.4 * vel });
    o.connect(fl).connect(g).connect(out); sub.connect(sg).connect(out);
    start([o, sub], t, Math.max(g.end, sg.end));
  },
};

// ---------------------------------------------------------------- drums & casino effects
function noiseHit(s, out, t, { type = 'highpass', f = 6000, q = 0.7, dec = 0.05, peak = 0.5, a = 0.001 }) {
  const n = noiseSrc(s, t);
  const fl = type === 'highpass' ? hp(s, f, q) : type === 'lowpass' ? lp(s, f, q) : bp(s, f, q);
  const g = strike(s, t, dec, peak, a);
  n.connect(fl).connect(g).connect(out);
  start([n], t, g.end);
}
function tone(s, out, t, type, f0, f1, sweep, dec, peak) {
  const o = osc(s, type, f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + sweep);
  const g = strike(s, t, dec, peak);
  o.connect(g).connect(out);
  start([o], t, g.end);
}
function metal(s, out, t, dec, peak, f = 7000) {
  const g = strike(s, t, dec, peak);
  const fl = hp(s, f, 0.8);
  const nodes = [];
  for (const r of [1, 1.342, 1.2312, 1.6532, 1.9523, 2.1523]) {
    const o = osc(s, 'square', 330 * r, t);
    o.connect(fl); nodes.push(o);
  }
  fl.connect(g).connect(out);
  start(nodes, t, g.end);
}

const DRUM = {
  kick(s, out, t, vel) {
    tone(s, out, t, 'sine', 160, 42, 0.12, 0.38, 0.95 * vel);
    tone(s, out, t, 'triangle', 600, 120, 0.02, 0.025, 0.25 * vel);
  },
  snare(s, out, t, vel) {
    noiseHit(s, out, t, { type: 'bandpass', f: 2200, q: 0.6, dec: 0.17, peak: 0.55 * vel });
    tone(s, out, t, 'triangle', 220, 170, 0.06, 0.09, 0.35 * vel);
  },
  clap(s, out, t, vel) {
    for (const [o, p] of [[0, 0.5], [0.011, 0.45], [0.023, 0.6]]) noiseHit(s, out, t + o, { type: 'bandpass', f: 1300, q: 1.2, dec: o === 0.023 ? 0.16 : 0.02, peak: p * vel });
  },
  hat(s, out, t, vel) { noiseHit(s, out, t, { f: 8000, dec: 0.045, peak: 0.3 * vel }); },
  ohat(s, out, t, vel) { noiseHit(s, out, t, { f: 7500, dec: 0.3, peak: 0.24 * vel }); },
  ride(s, out, t, vel) { metal(s, out, t, 0.9, 0.08 * vel, 5000); noiseHit(s, out, t, { f: 9000, dec: 0.4, peak: 0.06 * vel }); },
  crash(s, out, t, vel) { metal(s, out, t, 1.6, 0.08 * vel, 4000); noiseHit(s, out, t, { f: 5000, dec: 1.4, peak: 0.28 * vel }); },
  rim(s, out, t, vel) { tone(s, out, t, 'triangle', 1700, 1700, 0, 0.03, 0.4 * vel); noiseHit(s, out, t, { type: 'bandpass', f: 3500, q: 2, dec: 0.015, peak: 0.3 * vel }); },
  shaker(s, out, t, vel) { noiseHit(s, out, t, { type: 'bandpass', f: 6500, q: 1.5, dec: 0.06, peak: 0.3 * vel, a: 0.012 }); },
  tamb(s, out, t, vel) { metal(s, out, t, 0.18, 0.06 * vel, 7000); noiseHit(s, out, t, { f: 7000, dec: 0.15, peak: 0.18 * vel, a: 0.004 }); },
  cowbell(s, out, t, vel) {
    const fl = bp(s, 800, 1.5);
    const g = strike(s, t, 0.32, 0.32 * vel);
    const a = osc(s, 'square', 540, t), b = osc(s, 'square', 800, t);
    a.connect(fl); b.connect(fl); fl.connect(g).connect(out);
    start([a, b], t, g.end);
  },
  conga(s, out, t, vel) { tone(s, out, t, 'sine', 260, 200, 0.04, 0.22, 0.6 * vel); },
  bongo(s, out, t, vel) { tone(s, out, t, 'sine', 420, 340, 0.03, 0.14, 0.55 * vel); },
  tumba(s, out, t, vel) { tone(s, out, t, 'sine', 180, 140, 0.05, 0.28, 0.65 * vel); },
  tomlo(s, out, t, vel) { tone(s, out, t, 'sine', 140, 80, 0.2, 0.4, 0.75 * vel); },
  tommid(s, out, t, vel) { tone(s, out, t, 'sine', 200, 120, 0.18, 0.35, 0.7 * vel); },
  tomhi(s, out, t, vel) { tone(s, out, t, 'sine', 280, 170, 0.15, 0.3, 0.65 * vel); },
  // 8-bit style noise percussion: x is a snare-ish burst, o a short tick
  noise(s, out, t, vel) { noiseHit(s, out, t, { type: 'lowpass', f: vel < 0.6 ? 9000 : 5000, dec: vel < 0.6 ? 0.03 : 0.12, peak: 0.35 * Math.min(vel, 1.2) }); },
  // casino effects
  coin(s, out, t, vel) {
    const o = osc(s, 'square', 988, t);
    o.frequency.setValueAtTime(1319, t + 0.07);
    const g = s.ctx.createGain();
    g.gain.setValueAtTime(0.16 * vel, t);
    g.gain.setValueAtTime(0.16 * vel, t + 0.07);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g).connect(out);
    start([o], t, t + 0.5);
  },
  blip(s, out, t, vel) { tone(s, out, t, 'square', 1568, 1568, 0, 0.05, 0.13 * vel); },
  zap(s, out, t, vel) { tone(s, out, t, 'square', 1800, 180, 0.16, 0.18, 0.13 * vel); },
  laser(s, out, t, vel) { tone(s, out, t, 'sawtooth', 2400, 300, 0.22, 0.24, 0.12 * vel); },
  reel(s, out, t, vel) {
    for (let i = 0; i < 9; i++) noiseHit(s, out, t + i * 0.028, { type: 'bandpass', f: 3200 + (i % 3) * 600, q: 4, dec: 0.012, peak: 0.4 * vel * (1 - i / 14) });
  },
  chips(s, out, t, vel) {
    noiseHit(s, out, t, { type: 'bandpass', f: 3800, q: 6, dec: 0.02, peak: 0.6 * vel });
    noiseHit(s, out, t + 0.035, { type: 'bandpass', f: 4600, q: 6, dec: 0.018, peak: 0.45 * vel });
    noiseHit(s, out, t + 0.06, { type: 'bandpass', f: 4200, q: 6, dec: 0.015, peak: 0.25 * vel });
  },
  riffle(s, out, t, vel) {
    for (let i = 0; i < 14; i++) noiseHit(s, out, t + i * 0.022 + Math.random() * 0.006, { type: 'bandpass', f: 2500 + Math.random() * 2500, q: 2, dec: 0.014, peak: 0.28 * vel });
  },
  jackpot(s, out, t, vel) {
    [1047, 1319, 1568, 2093, 2637].forEach((f, i) => tone(s, out, t + i * 0.045, 'square', f, f, 0, i === 4 ? 0.4 : 0.06, 0.11 * vel));
  },
  ding(s, out, t, vel) { INST.bell(s, out, t, 0.5, 2093, vel * 0.8); },
};
