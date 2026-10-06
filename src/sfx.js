// tiny synthesized sound effects (no audio files)
let ctx = null;
let muted = false;
try { muted = localStorage.getItem('wildhand.muted') === '1'; } catch (e) { /* ignore */ }

// ios keeps an audio context muted unless it is created during a user gesture
addEventListener('pointerdown', () => ac(), { once: true });

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur = 0.1, { type = 'sine', vol = 0.12, slide = 0, delay = 0 } = {}) {
  const a = ac();
  if (!a || muted) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur = 0.2, vol = 0.1, freq = 1200) {
  const a = ac();
  if (!a || muted) return;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

let chipPitch = 0;
export function sfx(name) {
  switch (name) {
    case 'tick': tone(880, 0.05, { type: 'triangle', vol: 0.06 }); break;
    case 'hand': chipPitch = 0; tone(392, 0.12, { type: 'triangle' }); tone(523, 0.14, { type: 'triangle', delay: 0.06 }); break;
    case 'chip': tone(520 + chipPitch * 40, 0.08, { type: 'square', vol: 0.05 }); chipPitch = Math.min(chipPitch + 1, 14); break;
    case 'mult': tone(300 + chipPitch * 30, 0.1, { type: 'sawtooth', vol: 0.05 }); chipPitch = Math.min(chipPitch + 1, 14); break;
    case 'xmult': tone(220, 0.25, { type: 'sawtooth', vol: 0.07, slide: 440 }); break;
    case 'total': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, { type: 'triangle', delay: i * 0.05, vol: 0.08 })); break;
    case 'discard': noise(0.12, 0.08, 2400); break;
    case 'hit': noise(0.25, 0.25, 500); tone(140, 0.2, { type: 'square', vol: 0.08, slide: -80 }); break;
    case 'hurt': noise(0.3, 0.2, 300); tone(200, 0.3, { type: 'sawtooth', vol: 0.08, slide: -120 }); break;
    case 'cast': tone(300, 0.35, { type: 'sine', vol: 0.1, slide: 900 }); noise(0.3, 0.05, 3000); break;
    case 'win': [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.25, { type: 'triangle', delay: i * 0.09, vol: 0.1 })); break;
    case 'lose': [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, { type: 'triangle', delay: i * 0.14, vol: 0.1 })); break;
    case 'encounter': tone(660, 0.1, { type: 'square', vol: 0.06 }); tone(990, 0.18, { type: 'square', vol: 0.06, delay: 0.1 }); break;
    case 'coin': tone(988, 0.08, { type: 'square', vol: 0.05 }); tone(1319, 0.2, { type: 'square', vol: 0.05, delay: 0.07 }); break;
    case 'pack': [440, 554, 659, 880].forEach((f, i) => tone(f, 0.12, { type: 'triangle', delay: i * 0.04, vol: 0.07 })); break;
    case 'heal': [523, 659, 784].forEach((f, i) => tone(f, 0.3, { type: 'sine', delay: i * 0.08, vol: 0.08 })); break;
    default: break;
  }
}
export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('wildhand.muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
  return muted;
}
export const isMuted = () => muted;
