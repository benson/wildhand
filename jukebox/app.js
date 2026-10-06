// jukebox page: track list, scheduler, piano roll, slot-machine scene, editor
import { compile } from './score.js';
import { Synth } from './synth.js';

const $ = (s) => document.querySelector(s);
const COLORS = ['#ffcf5a', '#3db8ff', '#ff6a3d', '#6fdc5a', '#c77dff', '#ff4d5e', '#2f8cff', '#ffd23d', '#80ed99', '#f4a261'];
const FX = new Set(['coin', 'jackpot', 'ding', 'chips']);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const synth = new Synth();
const state = {
  tracks: [], cur: -1, song: null, src: '', original: '',
  playing: false, loop: true, t0: 0, muted: new Set(),
  hits: [], // { v, at (audio time), vel }
};

// ---------------------------------------------------------------- scheduler
const sched = { phase: 'intro', idx: 0, k: 0, timer: 0 };
let introEv = [], loopEv = [];

function songTimeOf(phase, k, e) {
  const s = state.song;
  return phase === 'intro' ? e.t : s.sections.loop.start + k * s.sections.loop.len + (e.t - s.sections.loop.start);
}

function load(song) {
  stop();
  state.song = song;
  state.muted = new Set();
  const L = song.sections.loop.start;
  introEv = song.events.filter((e) => e.t < L);
  loopEv = song.events.filter((e) => e.t >= L);
  synth.setVoices(song.voices);
  synth.setVolume(Number($('#vol').value));
  renderVoices();
  drawRollBase();
  $('#title').textContent = song.title;
  $('#meta').textContent = `${song.tempo} bpm · ${song.beats}/${song.steps === 2 ? 8 : 4} · ${song.voices.length} voices · ${fmt(song.duration)}`;
}

function seekTo(t) {
  const s = state.song;
  const L = s.sections.loop.start;
  if (t < L || !loopEv.length) { sched.phase = 'intro'; sched.k = 0; sched.idx = introEv.findIndex((e) => e.t >= t); if (sched.idx < 0) { sched.phase = 'loop'; sched.idx = 0; } }
  else { sched.phase = 'loop'; sched.k = 0; sched.idx = Math.max(0, loopEv.findIndex((e) => e.t >= t)); }
}

async function play(from = 0) {
  if (!state.song) return;
  const ctx = synth.init();
  if (ctx.state !== 'running') await ctx.resume();
  stop(true);
  seekTo(from);
  state.t0 = ctx.currentTime + 0.08 - from;
  state.playing = true;
  sched.timer = setInterval(tick, 25);
  tick();
  $('#play').innerHTML = 'stop <kbd>space</kbd>';
}

function stop(quiet = false) {
  clearInterval(sched.timer);
  if (state.playing) synth.hush();
  state.playing = false;
  state.hits = [];
  if (!quiet) $('#play').innerHTML = 'play <kbd>space</kbd>';
}

function tick() {
  const ctx = synth.ctx;
  const s = state.song;
  const horizon = ctx.currentTime + 0.18;
  for (;;) {
    const list = sched.phase === 'intro' ? introEv : loopEv;
    if (sched.idx >= list.length) {
      if (sched.phase === 'intro') { sched.phase = 'loop'; sched.idx = 0; sched.k = 0; if (!loopEv.length) return endSong(); continue; }
      if (!state.loop) return endSong();
      sched.k++; sched.idx = 0; continue;
    }
    const e = list[sched.idx];
    const at = state.t0 + songTimeOf(sched.phase, sched.k, e);
    if (at > horizon) break;
    sched.idx++;
    if (at < ctx.currentTime - 0.05) continue;
    synth.play(e.v, at, e.d, e.midi, e.vel, e.slide);
    state.hits.push({ v: e.v, at, vel: e.vel });
  }
  function endSong() {
    clearInterval(sched.timer);
    const end = state.t0 + s.duration + (sched.k) * s.sections.loop.len;
    setTimeout(() => { if (state.playing && synth.ctx.currentTime >= end) stop(); }, Math.max(0, (end - ctx.currentTime) * 1000 + 1500));
  }
}

// song time folded onto the roll (intro, then one pass of the loop)
function rollTime() {
  if (!state.playing || !state.song) return null;
  const s = state.song;
  const t = synth.ctx.currentTime - state.t0;
  if (t < 0) return 0;
  const L = s.sections.loop.start, len = s.sections.loop.len;
  if (t < L || !len) return Math.min(t, s.duration);
  return L + ((t - L) % len);
}

// ---------------------------------------------------------------- voices + roll
function renderVoices() {
  const box = $('#voices');
  box.innerHTML = '';
  state.song.voices.forEach((v, i) => {
    const b = document.createElement('button');
    b.className = 'voice';
    b.style.setProperty('--c', COLORS[i % COLORS.length]);
    b.innerHTML = `<i></i><b>${v.name}</b><small>${v.instrument}</small>`;
    b.onclick = () => {
      const m = !state.muted.has(i);
      if (m) state.muted.add(i); else state.muted.delete(i);
      synth.setMuted(i, m);
      b.classList.toggle('muted', m);
      drawRollBase();
    };
    box.appendChild(b);
  });
}

const roll = $('#roll');
let rollBase = null;
function drawRollBase() {
  const s = state.song;
  if (!s) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = roll.clientWidth || 800;
  const lanes = s.voices.length;
  const laneH = Math.max(18, Math.min(40, Math.floor(300 / lanes)));
  const H = lanes * laneH + 18;
  roll.style.height = `${H}px`;
  roll.width = W * dpr; roll.height = H * dpr;
  const c = document.createElement('canvas');
  c.width = roll.width; c.height = roll.height;
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const x = (t) => (t / s.duration) * W;
  // bars and pattern names
  g.font = '500 10px JetBrains Mono, monospace';
  let lastPat = null;
  for (const b of s.bars) {
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(Math.round(x(b.t)), 14, 1, H - 14);
    if (b.pattern !== lastPat) {
      g.fillStyle = 'rgba(251,243,228,0.55)';
      g.fillText(b.pattern, x(b.t) + 3, 10);
      g.fillStyle = 'rgba(255,255,255,0.14)';
      g.fillRect(Math.round(x(b.t)), 14, 1, H - 14);
      lastPat = b.pattern;
    }
  }
  if (s.sections.loop.len) {
    const lx = x(s.sections.loop.start);
    g.fillStyle = 'rgba(255,207,90,0.08)';
    g.fillRect(lx, 14, W - lx, H - 14);
    g.fillStyle = '#ffcf5a';
    g.fillText('loop ⟲', Math.min(W - 52, lx + 3), H - 4 > 0 ? 10 : 10);
  }
  // notes per lane, pitch scaled within the lane
  s.voices.forEach((v, i) => {
    const y0 = 16 + i * laneH;
    const col = COLORS[i % COLORS.length];
    g.globalAlpha = state.muted.has(i) ? 0.18 : 1;
    const evs = s.events.filter((e) => e.v === i);
    if (v.drum) {
      g.fillStyle = col;
      for (const e of evs) g.fillRect(x(e.t), y0 + laneH * 0.2, 2, laneH * 0.6 * Math.min(1, e.vel));
    } else {
      let lo = Infinity, hi = -Infinity;
      for (const e of evs) for (const m of e.midi) { lo = Math.min(lo, m); hi = Math.max(hi, m); }
      const span = Math.max(12, hi - lo);
      const nh = Math.max(2, (laneH - 6) / (span + 1));
      g.fillStyle = col;
      for (const e of evs) for (const m of e.midi) {
        const y = y0 + (laneH - 4) - ((m - lo) / span) * (laneH - 4 - nh) - nh;
        g.fillRect(x(e.t), y, Math.max(1.5, x(e.d) - 1), nh);
      }
    }
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(255,255,255,0.04)';
    g.fillRect(0, y0 + laneH - 1, W, 1);
  });
  rollBase = { c, W, H, dpr };
}

function drawRoll() {
  if (!rollBase) return;
  const g = roll.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, roll.width, roll.height);
  g.drawImage(rollBase.c, 0, 0);
  const t = rollTime();
  if (t === null) return;
  const px = (t / state.song.duration) * rollBase.W * rollBase.dpr;
  g.fillStyle = '#ffcf5a';
  g.fillRect(Math.round(px), 0, 2 * rollBase.dpr, roll.height);
}

roll.addEventListener('click', (e) => {
  if (!state.song) return;
  const r = roll.getBoundingClientRect();
  const t = ((e.clientX - r.left) / r.width) * state.song.duration;
  play(Math.max(0, Math.min(state.song.duration - 0.05, t)));
});
addEventListener('resize', () => drawRollBase());

// ---------------------------------------------------------------- slot machine scene
const scene = $('#scene');
const sg = scene.getContext('2d');
const ICONS = {
  ember: ['...#....', '..##....', '..###.#.', '.#####..', '.######.', '########', '.######.', '..####..'],
  tide: ['...##...', '...##...', '..####..', '.######.', '.######.', '########', '.######.', '..####..'],
  grove: ['.....###', '...#####', '..######', '.######.', '.#####..', '.####...', '#.##....', '#.......'],
  volt: ['....###.', '...###..', '..###...', '.######.', '...###..', '..###...', '.###....', '.#......'],
};
const ICON_COL = { ember: '#ff6a3d', tide: '#3db8ff', grove: '#6fdc5a', volt: '#ffd23d' };
const SYMS = Object.keys(ICONS);
const reels = [0, 1, 2].map((i) => ({ pos: i, target: i, spin: 0 }));
const activity = [];
const coins = [];
let lastBar = -1, lever = 0, flash = 0;

function icon(name, x, y, s = 2) {
  sg.fillStyle = ICON_COL[name];
  ICONS[name].forEach((row, j) => { for (let i = 0; i < 8; i++) if (row[i] === '#') sg.fillRect(x + i * s, y + j * s, s, s); });
}

function rect(c, x, y, w, h) { sg.fillStyle = c; sg.fillRect(x, y, w, h); }

function drawScene(dt) {
  const s = state.song;
  const now = synth.ctx ? synth.ctx.currentTime : 0;
  const t = state.playing ? now - state.t0 : -1;
  // consume note hits that have sounded
  while (state.hits.length && state.hits[0].at <= now) {
    const h = state.hits.shift();
    activity[h.v] = Math.min(1.4, (activity[h.v] || 0) * 0.5 + h.vel);
    const el = document.querySelectorAll('.voice')[h.v];
    if (el) { el.classList.add('hit'); setTimeout(() => el.classList.remove('hit'), 90); }
    const inst = s?.voices[h.v]?.instrument;
    if (FX.has(inst)) for (let k = 0; k < (inst === 'jackpot' ? 14 : 4); k++) coins.push({ x: 160 + (Math.random() - 0.5) * 16, y: 92, vx: (Math.random() - 0.5) * 90, vy: -60 - Math.random() * 70, life: 1.6 });
  }
  for (let i = 0; i < activity.length; i++) activity[i] = Math.max(0, (activity[i] || 0) - dt * 2.2);

  // which bar / step are we on
  let step = Math.floor(performance.now() / 260), barIdx = -1;
  if (s && t >= 0) {
    const L = s.sections.loop.start, len = s.sections.loop.len;
    const ft = t < L || !len ? t : L + ((t - L) % len);
    const pass = t < L || !len ? 0 : Math.floor((t - L) / len);
    for (let i = 0; i < s.bars.length; i++) if (s.bars[i].t <= ft) barIdx = i;
    const b = s.bars[Math.max(0, barIdx)];
    step = Math.floor((ft - b.t) / (b.len / (b.beats * b.steps)));
    barIdx += pass * 1000;
  }
  if (barIdx !== lastBar && barIdx >= 0) {
    lastBar = barIdx;
    lever = 1;
    reels.forEach((r, i) => { r.spin = 0.35 + i * 0.12; r.target = Math.floor(Math.random() * SYMS.length); });
  }
  lever = Math.max(0, lever - dt * 4);
  flash = Math.max(0, flash - dt * 2);

  // wall
  rect('#1b1430', 0, 0, 320, 110);
  for (let y = 16; y < 100; y += 6) rect(y % 12 ? '#211839' : '#1e1635', 0, y, 320, 3);
  // marquee bulbs chase with the steps
  rect('#2b2147', 0, 3, 320, 9);
  for (let i = 0; i < 40; i++) {
    const on = (i + step) % 4 === 0 || flash > 0.3;
    rect(on ? '#ffcf5a' : '#5a4a2a', 4 + i * 8, 6, 3, 3);
  }
  // floor
  rect('#120d22', 0, 102, 320, 8);
  rect('#2b2147', 0, 101, 320, 1);

  // chip stacks: one per voice, height follows that voice
  const n = s ? s.voices.length : 6;
  for (let i = 0; i < n; i++) {
    const side = i % 2, k = Math.floor(i / 2);
    const x = side ? 222 + k * 24 : 84 - k * 24;
    const h = 2 + Math.round((activity[i] || 0) * 9);
    const col = COLORS[i % COLORS.length];
    for (let j = 0; j < h; j++) {
      const y = 98 - j * 3;
      rect('#120d22', x, y + 2, 16, 1);
      rect(col, x, y, 16, 2);
      rect('#fbf3e4', x + 3, y, 2, 2); rect('#fbf3e4', x + 11, y, 2, 2);
    }
  }

  // slot machine
  rect('#8a6420', 112, 20, 96, 82);
  rect('#ffcf5a', 114, 22, 92, 78);
  rect('#c9952b', 114, 96, 92, 4);
  rect('#ff4d5e', 140, 13, 40, 9);
  rect(flash > 0 || step % 2 ? '#ffd977' : '#ff8a95', 152, 15, 16, 5);
  rect('#2a2135', 120, 34, 80, 34);
  reels.forEach((r, i) => {
    const x = 123 + i * 26;
    rect('#fbf3e4', x, 36, 22, 30);
    if (r.spin > 0) {
      r.spin -= dt;
      r.pos += dt * 22;
      if (r.spin <= 0) r.pos = r.target;
    }
    sg.save();
    sg.beginPath(); sg.rect(x, 36, 22, 30); sg.clip();
    const base = Math.floor(r.pos), frac = r.pos - base;
    for (let k = -1; k <= 1; k++) icon(SYMS[((base + k) % 4 + 4) % 4], x + 3, 43 + (k - frac) * 20);
    sg.restore();
    rect('rgba(42,33,53,0.35)', x, 36, 22, 3); rect('rgba(42,33,53,0.35)', x, 63, 22, 3);
  });
  if (reels.every((r) => r.spin <= 0) && reels.every((r) => ((Math.round(r.pos) % 4) + 4) % 4 === ((Math.round(reels[0].pos) % 4) + 4) % 4) && lever === 0 && flash === 0 && state.playing) {
    flash = 1;
    for (let k = 0; k < 10; k++) coins.push({ x: 160, y: 92, vx: (Math.random() - 0.5) * 120, vy: -70 - Math.random() * 60, life: 1.6 });
  }
  rect('#2a2135', 132, 76, 56, 8);
  rect('#120d22', 136, 86, 48, 6);
  // lever
  const ly = 36 + Math.round(lever * 18);
  rect('#8a6420', 208, 54, 6, 10);
  rect('#c9c2d6', 212, ly, 2, 60 - ly);
  rect('#ff4d5e', 210, ly - 4, 6, 6);

  // coins
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    c.vy += 220 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.life -= dt;
    if (c.y > 98) { c.y = 98; c.vy *= -0.35; c.vx *= 0.7; }
    if (c.life <= 0) { coins.splice(i, 1); continue; }
    rect('#c9952b', Math.round(c.x), Math.round(c.y), 4, 4);
    rect('#ffcf5a', Math.round(c.x), Math.round(c.y), 3, 3);
  }
}

// ---------------------------------------------------------------- tracks, editor, guide
function setErrors(errs) {
  const ul = $('#errors');
  ul.innerHTML = errs.map((e) => `<li>${e.line ? `line ${e.line}: ` : ''}${e.msg.replace(/</g, '&lt;')}</li>`).join('');
}

async function pick(i, autoplay) {
  const tr = state.tracks[i];
  if (!tr.text) tr.text = await (await fetch(`tracks/${tr.file}`)).text();
  state.cur = i;
  state.original = tr.text;
  $('#src').value = tr.edited ?? tr.text;
  document.querySelectorAll('.tracks button').forEach((b, k) => b.classList.toggle('cur', k === i));
  const song = compile($('#src').value);
  setErrors(song.errors);
  if (song.errors.length) return;
  load(song);
  if (autoplay) play(0);
  try { history.replaceState(null, '', `#${tr.file.replace('.txt', '')}`); } catch (e) { /* ignore */ }
}

async function init() {
  const list = await (await fetch('tracks/tracks.json')).json();
  state.tracks = list.map((f) => ({ file: f }));
  // read titles and lengths for the list
  await Promise.all(state.tracks.map(async (tr) => {
    tr.text = await (await fetch(`tracks/${tr.file}`)).text();
    const s = compile(tr.text);
    tr.title = s.title || tr.file;
    tr.len = s.duration ? fmt(s.duration) : '!';
    tr.tempo = s.tempo;
  }));
  $('#tracks').innerHTML = state.tracks.map((tr, i) => `<li><button><span class="n">${String(i + 1).padStart(2, '0')}</span><span class="t">${tr.title}</span><span class="m">${tr.tempo} · ${tr.len}</span></button></li>`).join('');
  document.querySelectorAll('.tracks button').forEach((b, i) => b.onclick = () => pick(i, true));
  const hash = location.hash.slice(1);
  const start = Math.max(0, state.tracks.findIndex((t) => t.file === `${hash}.txt`));
  await pick(start, false);

  const doc = await (await fetch('FORMAT.md')).text();
  state.formatDoc = doc;
  $('#doc').innerHTML = window.marked ? window.marked.parse(doc.replace(/^# .*\n/, '')) : `<pre>${doc.replace(/</g, '&lt;')}</pre>`;
}

$('#play').onclick = () => (state.playing ? stop() : play(0));
$('#restart').onclick = () => play(0);
$('#loop').onclick = (e) => {
  state.loop = !state.loop;
  e.currentTarget.classList.toggle('on', state.loop);
  e.currentTarget.setAttribute('aria-pressed', state.loop);
};
$('#vol').oninput = (e) => synth.setVolume(Number(e.target.value));
$('#apply').onclick = () => {
  const song = compile($('#src').value);
  setErrors(song.errors);
  if (song.errors.length) return;
  state.tracks[state.cur].edited = $('#src').value;
  load(song);
  play(0);
};
$('#revert').onclick = () => {
  delete state.tracks[state.cur].edited;
  $('#src').value = state.original;
  $('#apply').click();
};
$('#src').addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); $('#apply').click(); }
  if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '    '); }
});
$('#prompt').onclick = async (e) => {
  const text = `You are composing game music in the wildhand score format: plain text that a web page plays through a Web Audio synthesizer. The game is a cheerful creature-collecting card battler; its music is upbeat casino and arcade: chiptune blips, lounge chords, slot-machine effects. Reply with only the score, no commentary. Count the steps in every bar; a bar with the wrong number of steps is the most common mistake.\n\n${state.formatDoc}\n\nThe music I want:\n`;
  try { await navigator.clipboard.writeText(text); e.currentTarget.textContent = 'copied'; } catch (err) { e.currentTarget.textContent = 'copy failed'; }
  setTimeout(() => { $('#prompt').textContent = 'copy llm prompt'; }, 1600);
};
addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.target.closest('textarea, input, button')) return;
  e.preventDefault();
  state.playing ? stop() : play(0);
});

let last = performance.now();
(function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  drawScene(dt);
  drawRoll();
  requestAnimationFrame(frame);
})(last);

init().catch((e) => { $('#title').textContent = 'could not load tracks'; console.error(e); });
