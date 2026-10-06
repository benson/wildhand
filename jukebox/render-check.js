// dev check: render each track offline and report peak / loudness / clipping.
// run in the browser console on the jukebox page: (await import('./render-check.js')).checkAll()
import { compile } from './score.js';
import { Synth } from './synth.js';

export async function render(text, seconds = null) {
  const song = compile(text);
  if (song.errors.length) return { errors: song.errors };
  const len = Math.min(seconds ?? song.duration + 2, 120);
  const ctx = new OfflineAudioContext(2, Math.ceil(44100 * len), 44100);
  const s = new Synth();
  s.init(ctx);
  s.setVoices(song.voices);
  for (const e of song.events) if (e.t < len - 1) s.play(e.v, e.t + 0.05, e.d, e.midi, e.vel, e.slide);
  const buf = await ctx.startRendering();
  let peak = 0, sum = 0, clip = 0, bad = 0, n = 0;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const x = d[i];
      if (!Number.isFinite(x)) { bad++; continue; }
      const a = Math.abs(x);
      if (a > peak) peak = a;
      if (a > 0.99) clip++;
      sum += x * x; n++;
    }
  }
  return { title: song.title, seconds: +len.toFixed(1), peak: +peak.toFixed(3), rmsDb: +(10 * Math.log10(sum / n)).toFixed(1), clipped: clip, nonFinite: bad };
}

export async function checkAll() {
  const list = await (await fetch('tracks/tracks.json')).json();
  const out = [];
  for (const f of list) {
    const r = await fetch(`tracks/${f}`);
    if (!r.ok) { out.push({ file: f, missing: true }); continue; }
    out.push({ file: f, ...(await render(await r.text())) });
  }
  return out;
}
