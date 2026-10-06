// player levels: xp from wins raises max hp and unlocks charm slots
import { START_HP } from './data.js';

export const MAX_LEVEL = 30;
export const xpToNext = (lv) => Math.round(50 + 30 * lv + 4 * lv * lv);
export const maxHpFor = (lv) => START_HP + 5 * (lv - 1);
export const charmSlotsFor = (lv) => 3 + (lv >= 4) + (lv >= 9) + (lv >= 15) + (lv >= 22);

// xp for beating a creature of level L (tier 1-3, bosses count as 5)
export function xpFor(level, tier, boss) {
  return Math.round((12 + level * 6) * (boss ? 5 : tier === 3 ? 1.8 : tier === 2 ? 1.3 : 1));
}

export function ensureProgress(p) {
  if (!p.level) { p.level = 1; p.xp = 0; }
  if (!Array.isArray(p.discovered)) p.discovered = ['hearthvale'];
  p.maxHp = maxHpFor(p.level);
  p.maxCharms = Math.max(charmSlotsFor(p.level), Math.min(p.charms.length, 7));
  p.hp = Math.min(p.hp, p.maxHp);
  return p;
}

// returns number of levels gained
export function grantXp(p, amount) {
  if (p.level >= MAX_LEVEL) return 0;
  p.xp += amount;
  let gained = 0;
  while (p.level < MAX_LEVEL && p.xp >= xpToNext(p.level)) {
    p.xp -= xpToNext(p.level);
    p.level++;
    gained++;
  }
  if (gained) {
    const before = p.maxHp;
    p.maxHp = maxHpFor(p.level);
    p.hp += p.maxHp - before;
    p.maxCharms = Math.max(p.maxCharms, charmSlotsFor(p.level));
  }
  if (p.level >= MAX_LEVEL) p.xp = 0;
  return gained;
}
