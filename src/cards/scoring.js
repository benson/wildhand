// poker-hand evaluation and balatro-style chips × mult scoring
import { HANDS, HAND_ORDER, CHARMS, CREATURES, matchup } from './data.js';

// returns { type, scoring: [cards that score], contains: Set of hand types present }
export function evaluate(cards) {
  const n = cards.length;
  const byRank = new Map();
  for (const c of cards) {
    if (!byRank.has(c.rank)) byRank.set(c.rank, []);
    byRank.get(c.rank).push(c);
  }
  const groups = [...byRank.values()].sort((a, b) => b.length - a.length || b[0].rank - a[0].rank);
  const flush = n === 5 && cards.every((c) => c.el === cards[0].el);
  let straight = false;
  if (n === 5 && byRank.size === 5) {
    const r = [...byRank.keys()].sort((a, b) => a - b);
    straight = r[4] - r[0] === 4;
  }
  const g0 = groups[0]?.length || 0;
  const g1 = groups[1]?.length || 0;

  const contains = new Set(['high']);
  if (g0 >= 2) contains.add('pair');
  if (g0 >= 2 && g1 >= 2) contains.add('twopair');
  if (g0 >= 3) contains.add('three');
  if (g0 >= 4) contains.add('four');
  if (g0 >= 5) contains.add('five');
  if (g0 >= 3 && g1 >= 2) contains.add('fullhouse');
  if (flush) contains.add('flush');
  if (straight) contains.add('straight');
  if (flush && straight) contains.add('straightflush');

  const type = HAND_ORDER.find((t) => contains.has(t)) || 'high';
  let scoring;
  if (['five', 'straightflush', 'flush', 'straight', 'fullhouse'].includes(type)) scoring = cards.slice();
  else if (type === 'four') scoring = groups[0];
  else if (type === 'three') scoring = groups[0];
  else if (type === 'twopair') scoring = [...groups[0], ...groups[1]];
  else if (type === 'pair') scoring = groups[0];
  else scoring = n ? [cards.reduce((a, b) => (b.rank > a.rank ? b : a))] : [];
  // keep the original play order for the scoring animation
  scoring = cards.filter((c) => scoring.includes(c));
  return { type, scoring, contains };
}

export function handBase(type, level = 1) {
  const h = HANDS[type];
  return { chips: h.chips + h.lvChips * (level - 1), mult: h.mult + h.lvMult * (level - 1) };
}

export function dominantElement(cards) {
  const count = {};
  for (const c of cards) count[c.el] = (count[c.el] || 0) + 1;
  let best = null, bestN = 0;
  for (const [el, k] of Object.entries(count)) if (k > bestN) { best = el; bestN = k; }
  // ties go to nobody, so a mixed hand gets no matchup bonus
  const tied = Object.values(count).filter((k) => k === bestN).length > 1;
  return tied ? null : best;
}

// state: player profile ({ charms, gold, hp, maxHp, deck, handLevels })
// opts: { enemyEl, discards, rng }
// returns { type, scoring, chips, mult, total, steps, heal, gold, matchup, el }
export function score(cards, state, opts = {}) {
  const rng = opts.rng || Math.random;
  const ev = evaluate(cards);
  const base = handBase(ev.type, state.handLevels?.[ev.type] || 1);
  let chips = base.chips;
  let mult = base.mult;
  let heal = 0;
  let gold = 0;
  const steps = [];
  const scored = [];
  const ctx = {
    hand: ev.type,
    cards,
    scored,
    state,
    discards: opts.discards ?? 0,
    discardsUsed: opts.discardsUsed ?? 0,
    held: opts.held ?? 0,
    rng,
    contains: (t) => ev.contains.has(t),
    heal: (k) => { heal += k; steps.push({ kind: 'heal', value: k, src: ctx._src }); },
    add(kind, value) {
      if (kind === 'chips') chips += value;
      else if (kind === 'mult') mult += value;
      else if (kind === 'xmult') mult *= value;
      steps.push({ kind, value, src: ctx._src, chips, mult });
    },
    _src: null,
  };

  const charms = (state.charms || []).map((k) => ({ key: k, def: CHARMS[k] })).filter((x) => x.def);
  const retrigger = charms.some((c) => c.def.retriggerFirst);

  const scoreCard = (card) => {
    scored.push(card);
    ctx._src = { type: 'card', index: cards.indexOf(card) };
    ctx.add('chips', card.rank);
    if (card.enh === 'foil') ctx.add('chips', 30);
    if (card.enh === 'holo') ctx.add('mult', 6);
    if (card.enh === 'prism') ctx.add('xmult', 1.5);
    if (card.enh === 'gilded') { gold += 2; steps.push({ kind: 'gold', value: 2, src: ctx._src }); }
    if (card.creature) CREATURES[card.creature]?.bound.card(ctx, card);
    charms.forEach((ch, ci) => {
      if (!ch.def.card) return;
      ctx._src = { type: 'charm', index: ci, card: cards.indexOf(card) };
      ch.def.card(ctx, card);
    });
  };
  ev.scoring.forEach((card, i) => {
    scoreCard(card);
    if (i === 0 && retrigger) {
      steps.push({ kind: 'retrigger', src: { type: 'card', index: cards.indexOf(card) } });
      scoreCard(card);
    }
  });
  charms.forEach((ch, ci) => {
    if (!ch.def.hand) return;
    ctx._src = { type: 'charm', index: ci };
    ch.def.hand(ctx);
  });

  const el = dominantElement(ev.scoring);
  const mu = matchup(el, opts.enemyEl);
  if (mu !== 1) {
    ctx._src = { type: 'matchup' };
    ctx.add('xmult', mu);
  }
  mult = Math.max(mult, 1);
  const total = Math.floor(chips * mult);
  return { type: ev.type, scoring: ev.scoring, chips, mult, total, steps, heal, gold, matchup: mu, el, base };
}
