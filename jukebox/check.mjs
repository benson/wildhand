// node jukebox/check.mjs jukebox/tracks/*.txt — validates scores the same way the page does
import { readFileSync } from 'node:fs';
import { compile } from './score.js';

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
let bad = 0;
for (const f of process.argv.slice(2)) {
  const r = compile(readFileSync(f, 'utf8'));
  if (r.errors.length) {
    bad++;
    console.log(`✗ ${f}`);
    for (const e of r.errors) console.log(`   line ${e.line}: ${e.msg}`);
    continue;
  }
  const warn = [];
  const perVoice = r.voices.map(() => 0);
  for (const e of r.events) {
    perVoice[e.v]++;
    if (e.midi) for (const m of e.midi) if (m < 24 || m > 108) warn.push(`${r.voices[e.v].name} note ${m} at ${e.t.toFixed(2)}s is out of range`);
  }
  r.voices.forEach((v, i) => { if (!perVoice[i]) warn.push(`voice ${v.name} never plays`); });
  console.log(`✓ ${f} · ${r.title} · ${r.tempo} bpm · intro ${fmt(r.sections.play.len)} · loop ${fmt(r.sections.loop.len)} · ${r.voices.length} voices · ${r.events.length} notes`);
  for (const w of [...new Set(warn)].slice(0, 8)) console.log(`   warn: ${w}`);
}
process.exit(bad ? 1 : 0);
