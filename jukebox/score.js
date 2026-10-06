// the wildhand score format: plain text in, timed note events out.
// pure module (no dom, no audio) so the page and the node checker share it.

export const DRUMS = new Set([
  'kick', 'snare', 'clap', 'hat', 'ohat', 'ride', 'crash', 'rim', 'shaker', 'tamb', 'cowbell',
  'conga', 'bongo', 'tumba', 'tomlo', 'tommid', 'tomhi', 'noise',
  'coin', 'blip', 'zap', 'laser', 'reel', 'chips', 'riffle', 'jackpot', 'ding',
]);

export const MELODIC = [
  'pulse', 'square', 'tri', 'saw', 'sine', 'lead',
  'vibes', 'marimba', 'glock', 'bell', 'musicbox', 'epiano', 'organ', 'clav',
  'brass', 'stab', 'pluck', 'pad', 'strings', 'whistle',
  'synbass', 'fmbass', 'slap',
];
const MELODIC_SET = new Set(MELODIC);

const OPTS = new Set(['vol', 'pan', 'rev', 'oct', 'trans', 'gate', 'center', 'glide', 'bright', 'att', 'rel', 'duty', 'arp']);

const CHORDS = {
  '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11],
  6: [0, 4, 7, 9], m6: [0, 3, 7, 9], 9: [0, 4, 7, 10, 14], m9: [0, 3, 7, 10, 14], maj9: [0, 4, 7, 11, 14],
  add9: [0, 4, 7, 14], sus2: [0, 2, 7], sus4: [0, 5, 7], '7sus4': [0, 5, 7, 10], dim: [0, 3, 6],
  dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10], aug: [0, 4, 8], 5: [0, 7], '7b9': [0, 4, 7, 10, 13], 13: [0, 4, 10, 14, 21],
};
export const CHORD_NAMES = Object.keys(CHORDS);

const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

// "C#4" -> 61, null if not a note
export function noteToMidi(s) {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(s);
  if (!m) return null;
  let n = PC[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return n + (Number(m[3]) + 1) * 12;
}

function rootPc(s) {
  const m = /^([A-Ga-g])([#b]?)/.exec(s);
  if (!m) return null;
  return { pc: (PC[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12, len: m[0].length };
}

// "[Cm7/G]" voiced so its notes sit around `center` (a midi number)
export function chordToMidi(name, center = 60) {
  const [body, slash] = name.split('/');
  const r = rootPc(body);
  if (!r) return null;
  const q = body.slice(r.len);
  const iv = CHORDS[q];
  if (!iv) return null;
  const mean = iv.reduce((a, b) => a + b, 0) / iv.length;
  let root = r.pc;
  while (root + mean < center - 6) root += 12;
  while (root + mean > center + 6) root -= 12;
  const notes = iv.map((i) => root + i);
  if (slash) {
    const b = rootPc(slash);
    if (!b || b.len !== slash.length) return null;
    let bass = b.pc;
    while (bass > notes[0] - 5) bass -= 12;
    while (bass < notes[0] - 17) bass += 12;
    notes.unshift(bass);
  }
  return notes;
}

const stripComment = (line) => {
  const i = line.search(/(^|\s)#/);
  return i < 0 ? line : line.slice(0, i);
};

class ScoreError extends Error {}
const dedupe = (errs) => [...new Map(errs.map((e) => [`${e.line}:${e.msg}`, e])).values()].sort((a, b) => a.line - b.line);

// parse text -> { title, settings, voices, patterns, play, loop }, errors collected not thrown
export function parse(text) {
  const errors = [];
  const err = (line, msg) => errors.push({ line, msg });
  const score = { title: 'untitled', tempo: 120, beats: 4, steps: 4, swing: 0, voices: [], patterns: new Map(), play: [], loop: [] };
  const voiceBy = new Map();
  let pat = null;
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const ln = idx + 1;
    const line = stripComment(raw).trim();
    if (!line) return;
    const word = line.split(/\s+/)[0].toLowerCase();
    const rest = line.slice(word.length).trim();

    if (['tempo', 'beats', 'steps', 'swing'].includes(word) && !line.includes('|')) {
      const v = Number(rest);
      const ok = { tempo: v >= 20 && v <= 400, beats: Number.isInteger(v) && v >= 1 && v <= 16, steps: Number.isInteger(v) && v >= 1 && v <= 12, swing: v >= 0 && v <= 0.5 }[word];
      if (!ok) return err(ln, `${word} ${rest} is out of range`);
      if (pat) pat.settings[word] = v; else score[word] = v;
      return;
    }
    if (word === 'title') { score.title = rest || 'untitled'; return; }
    if (word === 'voice') {
      const parts = rest.split(/\s+/);
      const [name, inst, ...kv] = parts;
      if (!name || !inst) return err(ln, 'voice needs a name and an instrument');
      let instrument = inst.toLowerCase();
      if (!DRUMS.has(instrument) && !MELODIC_SET.has(instrument)) { err(ln, `unknown instrument "${inst}"`); instrument = 'sine'; }
      if (voiceBy.has(name)) return err(ln, `voice "${name}" is defined twice`);
      const v = { name, instrument, drum: DRUMS.has(instrument), vol: 0.8, pan: 0, rev: 0.25, oct: 0, trans: 0, gate: 1, center: 60, glide: 0.06, bright: 1, att: null, rel: null, duty: 0.5, arp: 0 };
      for (const pair of kv) {
        const [k, val] = pair.split('=');
        if (!OPTS.has(k) || val === undefined) { err(ln, `unknown voice option "${pair}"`); continue; }
        if (k === 'center') {
          const m = noteToMidi(val);
          if (m === null) { err(ln, `center=${val} is not a note`); continue; }
          v.center = m;
        } else {
          const n = Number(val);
          if (!Number.isFinite(n)) { err(ln, `${k}=${val} is not a number`); continue; }
          v[k] = n;
        }
      }
      score.voices.push(v);
      voiceBy.set(name, v);
      return;
    }
    if (word === 'pattern') {
      const parts = rest.split(/\s+/);
      const name = parts[0];
      if (!name) return err(ln, 'pattern needs a name');
      if (score.patterns.has(name)) return err(ln, `pattern "${name}" is defined twice`);
      pat = { name, line: ln, settings: {}, parts: new Map(), muted: new Set(), from: null };
      for (let i = 1; i < parts.length; i++) {
        if (parts[i] === 'from' && parts[i + 1]) { pat.from = parts[++i]; continue; }
        const [k, val] = parts[i].split('=');
        if (['tempo', 'beats', 'steps', 'swing'].includes(k) && Number.isFinite(Number(val))) pat.settings[k] = Number(val);
        else err(ln, `didn't understand "${parts[i]}" on the pattern line`);
      }
      if (pat.from) {
        const base = score.patterns.get(pat.from);
        if (!base) err(ln, `pattern "${pat.from}" must be defined before ${name}`);
        else {
          pat.settings = { ...base.settings, ...pat.settings };
          for (const [k, v] of base.parts) pat.parts.set(k, { ...v, inherited: true });
          pat.muted = new Set(base.muted);
        }
      }
      score.patterns.set(name, pat);
      return;
    }
    if (word === 'mute') {
      if (!pat) return err(ln, 'mute only works inside a pattern');
      for (const n of rest.split(/\s+/)) {
        if (!voiceBy.has(n)) err(ln, `no voice called "${n}"`);
        pat.muted.add(n);
        pat.parts.delete(n);
      }
      return;
    }
    if (word === 'play' || word === 'loop') {
      const list = [];
      for (const tok of rest.split(/\s+/).filter(Boolean)) {
        const m = /^([^*+\-]+)([+-]\d+)?(?:\*(\d+))?$/.exec(tok);
        if (!m) { err(ln, `didn't understand "${tok}"`); continue; }
        const times = m[3] ? Number(m[3]) : 1;
        for (let i = 0; i < times; i++) list.push({ name: m[1], trans: m[2] ? Number(m[2]) : 0, line: ln });
      }
      score[word].push(...list);
      return;
    }
    // a voice line inside a pattern: "lead | C4 D4 ... |"
    if (line.includes('|')) {
      const name = line.slice(0, line.indexOf('|')).trim();
      if (!pat) return err(ln, 'bars must be inside a pattern');
      const v = voiceBy.get(name);
      if (!v) return err(ln, `no voice called "${name}"`);
      const bars = line.slice(line.indexOf('|')).split('|').map((b) => b.trim());
      if (bars[0] === '') bars.shift();
      if (bars[bars.length - 1] === '') bars.pop();
      let part = pat.parts.get(name);
      if (!part || part.inherited) { part = { bars: [] }; pat.parts.set(name, part); pat.muted.delete(name); }
      for (const b of bars) part.bars.push({ text: b, line: ln });
      return;
    }
    err(ln, `didn't understand "${line.slice(0, 40)}"`);
  });
  if (!score.voices.length) err(0, 'no voices defined');
  if (!score.play.length && !score.loop.length) err(0, 'add a play or loop line');
  for (const list of [score.play, score.loop]) {
    for (const r of list) if (!score.patterns.has(r.name)) err(r.line, `no pattern called "${r.name}"`);
  }
  return { score, errors };
}

// one bar -> [{ step, len, notes: [midi]|null(rest), hold:bool, vel, slide }], or throws ScoreError
function parseMelodicBar(text, ctx) {
  const out = [];
  const toks = text.split(/\s+/).filter(Boolean);
  if (toks.length === 1 && ['%', '_', '='].includes(toks[0])) return toks[0];
  for (const tok of toks) {
    if (/^[.][.-]*$/.test(tok)) { out.push({ rest: true, len: tok.length }); continue; }
    if (/^-+$/.test(tok)) { out.push({ hold: true, len: tok.length }); continue; }
    let t = tok;
    let slide = false;
    if (t.startsWith('~')) { slide = true; t = t.slice(1); }
    const tail = /[-!?]*$/.exec(t)[0];
    const body = t.slice(0, t.length - tail.length);
    const dashes = (tail.match(/-/g) || []).length;
    const loud = (tail.match(/!/g) || []).length - (tail.match(/\?/g) || []).length;
    const notes = [];
    for (const piece of body.split('+')) {
      if (piece.startsWith('[') && piece.endsWith(']')) {
        const c = chordToMidi(piece.slice(1, -1), ctx.center);
        if (!c) throw new ScoreError(`"${piece}" is not a chord I know`);
        notes.push(...c);
      } else {
        const n = noteToMidi(piece);
        if (n === null) throw new ScoreError(`"${tok}" is not a note`);
        notes.push(n);
      }
    }
    out.push({ notes, len: 1 + dashes, vel: Math.max(0.2, Math.min(1.6, 1 + loud * 0.22)), slide });
  }
  return out;
}

function parseDrumBar(text) {
  const t = text.replace(/\s+/g, '');
  if (['%', '_', '='].includes(t)) return t === '=' ? '_' : t;
  const out = [];
  for (const ch of t) {
    if (ch === '.' || ch === '-') out.push(null);
    else if (ch === 'x') out.push(1);
    else if (ch === 'X') out.push(1.45);
    else if (ch === 'o') out.push(0.45);
    else throw new ScoreError(`"${ch}" isn't a drum hit (use x X o .)`);
  }
  return out;
}

// compile -> { events, sections: {play:{start,len,bars}, loop:{...}}, voices, title, ... }
// events: { v (voice index), t (sec), d (sec), midi: [], vel, slide }
export function compile(text) {
  const { score, errors } = parse(text);
  if (errors.length) return { errors: dedupe(errors) };
  const vIndex = new Map(score.voices.map((v, i) => [v.name, i]));
  const events = [];
  const bars = []; // { t, len, pattern } for the roll
  const lastEv = new Map(); // voice -> last event (for holds)
  const prevBar = new Map(); // voice -> last parsed bar (for %)
  let t = 0;

  const renderPattern = (ref) => {
    const p = score.patterns.get(ref.name);
    const s = { tempo: score.tempo, beats: score.beats, steps: score.steps, swing: score.swing, ...p.settings };
    const perBar = s.beats * s.steps;
    const stepDur = 60 / s.tempo / s.steps;
    const swingOn = s.steps % 2 === 0 && s.swing > 0;
    const stepTime = (i) => i * stepDur + (swingOn && i % 2 === 1 ? s.swing * stepDur : 0);
    let nBars = 0;
    for (const part of p.parts.values()) nBars = Math.max(nBars, part.bars.length);
    if (!nBars) throw new ScoreError(`pattern "${p.name}" has no bars`, p.line);
    for (const [name, part] of p.parts) {
      const vi = vIndex.get(name);
      const v = score.voices[vi];
      if (part.bars.length !== nBars) {
        errors.push({ line: part.bars[0].line, msg: `${name} has ${part.bars.length} bars in pattern ${p.name}, others have ${nBars}` });
        continue;
      }
      part.bars.forEach((bar, bi) => {
        const b0 = t + bi * perBar * stepDur;
        try {
          if (v.drum) {
            let hits = parseDrumBar(bar.text);
            if (hits === '%') hits = prevBar.get(name) || [];
            if (hits === '_') hits = new Array(perBar).fill(null);
            if (hits.length !== perBar) throw new ScoreError(`${name} bar ${bi + 1} has ${hits.length} steps, needs ${perBar}`);
            prevBar.set(name, hits);
            hits.forEach((h, i) => { if (h) events.push({ v: vi, t: b0 + stepTime(i), d: stepDur, midi: null, vel: h }); });
            return;
          }
          let toks = parseMelodicBar(bar.text, { center: v.center });
          if (toks === '%') toks = prevBar.get(name) || [{ rest: true, len: perBar }];
          if (toks === '_') toks = [{ rest: true, len: perBar }];
          if (toks === '=') toks = [{ hold: true, len: perBar }];
          const total = toks.reduce((a, k) => a + k.len, 0);
          if (total !== perBar) throw new ScoreError(`${name} bar ${bi + 1} has ${total} steps, needs ${perBar}`);
          prevBar.set(name, toks);
          let step = 0;
          for (const k of toks) {
            const st = b0 + stepTime(step), en = b0 + stepTime(step + k.len);
            if (k.hold) { const le = lastEv.get(vi); if (le) le.d = en - le.t; }
            else if (k.rest) lastEv.delete(vi);
            else {
              const shift = v.oct * 12 + v.trans + (ref.trans || 0);
              const ev = { v: vi, t: st, d: en - st, midi: k.notes.map((n) => n + shift), vel: k.vel, slide: k.slide };
              events.push(ev);
              lastEv.set(vi, ev);
            }
            step += k.len;
          }
        } catch (e) {
          if (e instanceof ScoreError) errors.push({ line: bar.line, msg: e.message });
          else throw e;
        }
      });
    }
    for (let bi = 0; bi < nBars; bi++) bars.push({ t: t + bi * perBar * stepDur, len: perBar * stepDur, pattern: p.name, beats: s.beats, steps: s.steps });
    t += nBars * perBar * stepDur;
  };

  const play = { start: 0 };
  try {
    for (const r of score.play) renderPattern(r);
    play.len = t;
    const loop = { start: t };
    // drop holds/% continuity at the loop seam so the loop restarts cleanly
    lastEv.clear();
    for (const r of score.loop) renderPattern(r);
    loop.len = t - loop.start;
    if (errors.length) return { errors: dedupe(errors) };
    events.sort((a, b) => a.t - b.t);
    return { title: score.title, tempo: score.tempo, beats: score.beats, steps: score.steps, voices: score.voices, events, bars, sections: { play, loop }, duration: t, errors: [] };
  } catch (e) {
    if (e instanceof ScoreError) return { errors: dedupe([...errors, { line: 0, msg: e.message }]) };
    throw e;
  }
}
