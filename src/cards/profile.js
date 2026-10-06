// player profile: deck, charms, gold, hp. persisted to localStorage.
import { ELEMENTS, START_HP, CHARMS, CREATURES, ENHANCE } from './data.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
export const pick = (arr, rng = Math.random) => arr[Math.floor(rng() * arr.length)];

let uid = 0;
export function makeCard(el, rank, extra = {}) {
  return { id: `${Date.now().toString(36)}${(uid++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, el, rank, ...extra };
}
export function creatureCard(key, extra = {}) {
  const c = CREATURES[key];
  return makeCard(c.el, c.bound.rank, { creature: key, ...extra });
}

export function starterDeck() {
  const deck = [];
  for (const el of ELEMENTS) for (let r = 1; r <= 10; r++) deck.push(makeCard(el, r));
  return deck;
}

const ADJ = ['brisk', 'mossy', 'quiet', 'lucky', 'ashen', 'bright', 'drift', 'amber', 'salt', 'storm', 'wild', 'dusk', 'clover', 'ember', 'pale', 'bold'];
const NOUN = ['fox', 'wren', 'finch', 'otter', 'moth', 'heron', 'lynx', 'vole', 'hare', 'crow', 'newt', 'stag', 'owl', 'pike', 'ram', 'bee'];
export function randomName() {
  return pick(ADJ) + pick(NOUN) + Math.floor(Math.random() * 90 + 10);
}
export const PLAYER_COLORS = ['#ff7a59', '#4cc9f0', '#80ed99', '#ffd166', '#c77dff', '#f72585', '#f4a261', '#90e0ef'];

const KEY = 'wildhand.profile.v1';
export function newProfile() {
  return {
    v: 1,
    name: randomName(),
    color: pick(PLAYER_COLORS),
    deck: starterDeck(),
    charms: [],
    maxCharms: 5,
    gold: 6,
    hp: START_HP,
    maxHp: START_HP,
    handLevels: {},
    bestiary: {},
    wins: 0,
    duelWins: 0,
    pos: null,
  };
}
export function loadProfile() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && p.v === 1 && Array.isArray(p.deck)) {
        p.charms = (p.charms || []).filter((k) => CHARMS[k]);
        p.deck = p.deck.filter((c) => !c.creature || CREATURES[c.creature]);
        return p;
      }
    }
  } catch (e) { /* storage unavailable */ }
  return newProfile();
}
export function saveProfile(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
}
export function resetProfile() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

// random reward cards
export function randomEnhancedCard(rng = Math.random) {
  const el = pick(ELEMENTS, rng);
  const rank = 1 + Math.floor(rng() * 10);
  const enh = pick(Object.keys(ENHANCE), rng);
  return makeCard(el, rank, { enh });
}
export function randomCharm(owned, rng = Math.random, maxRarity = 3) {
  const pool = Object.keys(CHARMS).filter((k) => !owned.includes(k) && CHARMS[k].rarity <= maxRarity);
  if (!pool.length) return null;
  // weight common charms higher
  const weighted = pool.flatMap((k) => Array(4 - CHARMS[k].rarity).fill(k));
  return pick(weighted, rng);
}
