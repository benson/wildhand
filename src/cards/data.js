// static game data: elements, poker hands, charms, creatures

export const ELEMENTS = ['ember', 'tide', 'grove', 'volt'];

export const EL = {
  ember: { name: 'ember', color: '#ff6a3d', dark: '#7a1f0c', glyph: 'ember' },
  tide: { name: 'tide', color: '#3db8ff', dark: '#0b3a66', glyph: 'tide' },
  grove: { name: 'grove', color: '#6fdc5a', dark: '#1d5a1a', glyph: 'grove' },
  volt: { name: 'volt', color: '#ffd23d', dark: '#6b5200', glyph: 'volt' },
};

// a beats b: tide > ember > grove > volt > tide
export const BEATS = { tide: 'ember', ember: 'grove', grove: 'volt', volt: 'tide' };
export function matchup(attacker, defender) {
  if (!attacker || !defender) return 1;
  if (BEATS[attacker] === defender) return 1.5;
  if (BEATS[defender] === attacker) return 0.75;
  return 1;
}

export const HANDS = {
  high: { name: 'high card', chips: 5, mult: 1, lvChips: 10, lvMult: 1 },
  pair: { name: 'pair', chips: 10, mult: 2, lvChips: 15, lvMult: 1 },
  twopair: { name: 'two pair', chips: 20, mult: 2, lvChips: 20, lvMult: 1 },
  three: { name: 'three of a kind', chips: 30, mult: 3, lvChips: 20, lvMult: 2 },
  straight: { name: 'straight', chips: 30, mult: 4, lvChips: 30, lvMult: 3 },
  flush: { name: 'flush', chips: 35, mult: 4, lvChips: 15, lvMult: 2 },
  fullhouse: { name: 'full house', chips: 40, mult: 4, lvChips: 25, lvMult: 2 },
  four: { name: 'four of a kind', chips: 60, mult: 7, lvChips: 30, lvMult: 3 },
  straightflush: { name: 'straight flush', chips: 100, mult: 8, lvChips: 40, lvMult: 4 },
  five: { name: 'five of a kind', chips: 120, mult: 12, lvChips: 35, lvMult: 3 },
};
export const HAND_ORDER = ['five', 'straightflush', 'four', 'fullhouse', 'flush', 'straight', 'three', 'twopair', 'pair', 'high'];

export const ENHANCE = {
  foil: { name: 'foil', text: '+30 chips' },
  holo: { name: 'holo', text: '+6 mult' },
  prism: { name: 'prism', text: '×1.5 mult' },
  gilded: { name: 'gilded', text: '+2 gold when scored' },
};

// charms are the passive modifiers (balatro's jokers).
// hooks: card(ctx, card) runs per scored card, hand(ctx) runs once after cards.
// ctx: { hand, cards, chips, mult, add(kind, value, src), state, battle }
export const CHARMS = {
  kindling: {
    icon: '🔥', name: 'kindling', rarity: 1, cost: 5, el: 'ember',
    text: 'ember cards give +4 mult when scored',
    card: (c, card) => card.el === 'ember' && c.add('mult', 4),
  },
  riptide: {
    icon: '🌊', name: 'riptide', rarity: 1, cost: 5, el: 'tide',
    text: 'tide cards give +25 chips when scored',
    card: (c, card) => card.el === 'tide' && c.add('chips', 25),
  },
  bramble: {
    icon: '🌿', name: 'bramble', rarity: 1, cost: 5, el: 'grove',
    text: 'grove cards give +2 mult and heal 1 hp when scored',
    card: (c, card) => { if (card.el === 'grove') { c.add('mult', 2); c.heal(1); } },
  },
  dynamo: {
    icon: '⚡', name: 'dynamo', rarity: 2, cost: 7, el: 'volt',
    text: 'volt cards give ×1.2 mult when scored',
    card: (c, card) => card.el === 'volt' && c.add('xmult', 1.2),
  },
  twinfang: {
    icon: '🦷', name: 'twin fang', rarity: 1, cost: 4,
    text: '+8 mult if the hand contains a pair',
    hand: (c) => c.contains('pair') && c.add('mult', 8),
  },
  triad: {
    icon: '🔺', name: 'triad', rarity: 2, cost: 7,
    text: '×2.5 mult if the hand contains three of a kind',
    hand: (c) => c.contains('three') && c.add('xmult', 2.5),
  },
  longroad: {
    icon: '🛤️', name: 'long road', rarity: 1, cost: 5,
    text: '+80 chips if the hand is a straight',
    hand: (c) => c.contains('straight') && c.add('chips', 80),
  },
  monsoon: {
    icon: '🌧️', name: 'monsoon', rarity: 2, cost: 7,
    text: '×2 mult if the hand is a flush',
    hand: (c) => c.contains('flush') && c.add('xmult', 2),
  },
  clover: {
    icon: '🍀', name: 'four-leaf', rarity: 2, cost: 6,
    text: '1 in 3 chance for ×3 mult',
    hand: (c) => c.rng() < 1 / 3 && c.add('xmult', 3),
  },
  hoarder: {
    icon: '💰', name: 'hoarder', rarity: 2, cost: 6,
    text: '+1 mult for every 5 gold you hold',
    hand: (c) => c.state.gold >= 5 && c.add('mult', Math.floor(c.state.gold / 5)),
  },
  smallfry: {
    icon: '🐟', name: 'small fry', rarity: 1, cost: 4,
    text: '+14 mult if 3 or fewer cards are played',
    hand: (c) => c.cards.length <= 3 && c.add('mult', 14),
  },
  evenkeel: {
    icon: '⚖️', name: 'even keel', rarity: 1, cost: 4,
    text: 'even-ranked cards give +4 mult when scored',
    card: (c, card) => card.rank % 2 === 0 && c.add('mult', 4),
  },
  oddity: {
    icon: '🎲', name: 'oddity', rarity: 1, cost: 4,
    text: 'odd-ranked cards give +31 chips when scored',
    card: (c, card) => card.rank % 2 === 1 && c.add('chips', 31),
  },
  packleader: {
    icon: '🐺', name: 'pack leader', rarity: 3, cost: 9,
    text: 'bound creature cards give ×1.5 mult when scored',
    card: (c, card) => card.creature && c.add('xmult', 1.5),
  },
  laststand: {
    icon: '🩸', name: 'last stand', rarity: 2, cost: 6,
    text: '×3 mult while your hp is below 35%',
    hand: (c) => c.state.hp < c.state.maxHp * 0.35 && c.add('xmult', 3),
  },
  glasscannon: {
    icon: '💎', name: 'glass cannon', rarity: 3, cost: 8,
    text: '×2.5 mult. you take 50% more damage',
    hand: (c) => c.add('xmult', 2.5),
  },
  sparkplug: {
    icon: '🔌', name: 'spark plug', rarity: 1, cost: 5,
    text: '+5 mult for each discard remaining',
    hand: (c) => c.discards > 0 && c.add('mult', 5 * c.discards),
  },
  salvager: {
    icon: '🧰', name: 'salvager', rarity: 1, cost: 5,
    text: 'earn +4 gold after every win',
  },
  echo: {
    icon: '🔔', name: 'echo', rarity: 3, cost: 9,
    text: 'retrigger the first scored card',
    retriggerFirst: true,
  },
  bulwark: {
    icon: '🛡️', name: 'bulwark', rarity: 1, cost: 5,
    text: 'enemies deal 3 less damage to you',
  },
  wildheart: {
    icon: '💚', name: 'wild heart', rarity: 3, cost: 10,
    text: '+1.5 mult per card in your deck above 40',
    hand: (c) => c.state.deck.length > 40 && c.add('mult', 1.5 * (c.state.deck.length - 40)),
  },
};

// wild creatures. model refers to an entry in assets.js.
// bound: what the creature does as a card in your deck once you catch it.
export const CREATURES = {
  cinderpup: {
    name: 'cinderpup', el: 'ember', model: 'fox', scale: 1.0, tier: 1,
    hp: 1.0, atk: 1.0, moves: ['bite', 'bite', 'scorch'],
    bound: { rank: 7, text: '+8 mult when scored', card: (c) => c.add('mult', 8) },
  },
  emberhorn: {
    name: 'emberhorn', el: 'ember', model: 'deer', scale: 1.2, tier: 2,
    hp: 1.4, atk: 1.2, moves: ['charge', 'gore', 'gore'],
    bound: { rank: 9, text: '×1.5 mult when scored', card: (c) => c.add('xmult', 1.5) },
  },
  solmane: {
    name: 'solmane', el: 'ember', model: 'lion', scale: 1.45, tier: 3,
    hp: 2.2, atk: 1.5, moves: ['howl', 'scorch', 'gore'],
    bound: { rank: 10, text: '×2 mult if the hand is mostly ember', card: (c) => c.scored.filter((x) => x.el === 'ember').length >= 3 && c.add('xmult', 2) },
  },
  waddlewave: {
    name: 'waddlewave', el: 'tide', model: 'penguin', scale: 1.0, tier: 1,
    hp: 0.9, atk: 0.9, moves: ['splash', 'soak', 'splash'],
    bound: { rank: 4, text: '+40 chips when scored', card: (c) => c.add('chips', 40) },
  },
  shellback: {
    name: 'shellback', el: 'tide', model: 'crab', scale: 1.15, tier: 2,
    hp: 1.6, atk: 0.85, moves: ['shell', 'crash', 'crash'],
    bound: { rank: 8, text: '+60 chips, heal 3 hp', card: (c) => { c.add('chips', 60); c.heal(3); } },
  },
  floepaw: {
    name: 'floepaw', el: 'tide', model: 'polar', scale: 1.5, tier: 3,
    hp: 2.4, atk: 1.3, moves: ['soak', 'crash', 'shell'],
    bound: { rank: 6, text: '+120 chips when scored', card: (c) => c.add('chips', 120) },
  },
  mossling: {
    name: 'mossling', el: 'grove', model: 'bunny', scale: 1.0, tier: 1,
    hp: 0.8, atk: 0.8, moves: ['nibble', 'nibble', 'tangle'],
    bound: { rank: 3, text: '+5 mult, heal 2 hp', card: (c) => { c.add('mult', 5); c.heal(2); } },
  },
  thornhog: {
    name: 'thornhog', el: 'grove', model: 'hog', scale: 1.15, tier: 2,
    hp: 1.4, atk: 1.15, moves: ['gore', 'tangle', 'gore'],
    bound: { rank: 10, text: '+10 mult when scored', card: (c) => c.add('mult', 10) },
  },
  bamboozle: {
    name: 'bamboozle', el: 'grove', model: 'panda', scale: 1.45, tier: 3,
    hp: 2.5, atk: 1.2, moves: ['tangle', 'crash', 'nibble'],
    bound: { rank: 5, text: '+3 mult per card in hand', card: (c) => c.add('mult', 3 * (c.held || 0)) },
  },
  buzzlet: {
    name: 'buzzlet', el: 'volt', model: 'bee', scale: 1.0, tier: 1,
    hp: 0.75, atk: 1.1, moves: ['zap', 'zap', 'static'],
    bound: { rank: 5, text: '×1.3 mult, +15 chips', card: (c) => { c.add('chips', 15); c.add('xmult', 1.3); } },
  },
  zapwing: {
    name: 'zapwing', el: 'volt', model: 'parrot', scale: 1.1, tier: 2,
    hp: 1.2, atk: 1.25, moves: ['static', 'zap', 'zap'],
    bound: { rank: 2, text: '+2 mult per discard used this fight', card: (c) => c.add('mult', 2 * (c.discardsUsed || 0)) },
  },
  stormstripe: {
    name: 'stormstripe', el: 'volt', model: 'tiger', scale: 1.4, tier: 3,
    hp: 2.1, atk: 1.55, moves: ['howl', 'zap', 'bite'],
    bound: { rank: 9, text: '+4 mult per volt card scored', card: (c) => c.add('mult', 4 * c.scored.filter((x) => x.el === 'volt').length) },
  },
};

export const MOVES = {
  bite: { name: 'bite', dmg: 1.0, text: 'attacks' },
  scorch: { name: 'scorch', dmg: 0.7, burn: 2, text: 'burns: 2 dmg for 3 turns' },
  charge: { name: 'charge', dmg: 0, charge: true, text: 'charging: next hit ×2' },
  gore: { name: 'gore', dmg: 1.2, text: 'attacks hard' },
  splash: { name: 'splash', dmg: 0.9, text: 'attacks' },
  soak: { name: 'soak', dmg: 0.4, discardDrain: 1, text: 'soaks: −1 discard' },
  shell: { name: 'shell', dmg: 0, shield: 0.25, text: 'shields: +25% hp shield' },
  crash: { name: 'crash', dmg: 1.1, text: 'attacks' },
  nibble: { name: 'nibble', dmg: 0.8, text: 'attacks' },
  tangle: { name: 'tangle', dmg: 0.5, handDrain: 1, text: 'tangles: −1 hand size next turn' },
  zap: { name: 'zap', dmg: 1.0, text: 'attacks' },
  static: { name: 'static', dmg: 0.5, lock: true, text: 'static: locks a random card' },
  howl: { name: 'howl', dmg: 0, enrage: 0.3, text: 'howls: +30% attack' },
};

export const START_HP = 40;
