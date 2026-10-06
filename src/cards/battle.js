// battle state machine. pve: you vs a wild creature, turn based.
// duel: score race vs another player — fixed number of hands, highest total wins.
import { CREATURES, MOVES, CHARMS } from './data.js';
import { score } from './scoring.js';
import { shuffle, mulberry32 } from './profile.js';

export class Battle {
  constructor({ profile, mode = 'pve', enemy = null, seed = Date.now() }) {
    this.profile = profile;
    this.mode = mode;
    this.rng = mulberry32(seed);
    this.handSize = 8;
    this.maxPlay = 5;
    this.discards = 3;
    this.discardsUsed = 0;
    this.handsLeft = mode === 'duel' ? 4 : Infinity;
    this.total = 0; // duel score
    this.turn = 0;
    this.drawPile = shuffle(profile.deck.map((c) => ({ ...c })), this.rng);
    this.discardPile = [];
    this.hand = [];
    this.locked = new Set();
    this.handDrain = 0;
    this.burn = 0;
    this.over = false;
    this.result = null;
    if (enemy) {
      const spec = CREATURES[enemy.species];
      this.enemy = {
        ...enemy,
        name: spec.name,
        el: spec.el,
        maxHp: enemy.hp,
        shield: 0,
        charged: false,
        enrage: 1,
        moves: spec.moves,
      };
      this.pickIntent();
    }
    this.draw();
  }

  has(charm) { return this.profile.charms.includes(charm); }

  draw() {
    const target = Math.max(3, this.handSize - this.handDrain);
    this.handDrain = 0;
    while (this.hand.length < target) {
      if (!this.drawPile.length) {
        if (!this.discardPile.length) break;
        this.drawPile = shuffle(this.discardPile, this.rng);
        this.discardPile = [];
      }
      this.hand.push(this.drawPile.pop());
    }
  }

  pickIntent() {
    const e = this.enemy;
    const key = e.moves[Math.floor(this.rng() * e.moves.length)];
    const m = MOVES[key];
    let dmg = Math.round(e.atk * m.dmg * e.enrage * (e.charged ? 2 : 1));
    if (this.has('bulwark')) dmg = Math.max(0, dmg - 3);
    if (this.has('glasscannon')) dmg = Math.round(dmg * 1.5);
    e.intent = { key, name: m.name, dmg, text: m.text, move: m };
  }

  preview(ids) {
    const cards = ids.map((id) => this.hand.find((c) => c.id === id)).filter(Boolean);
    if (!cards.length) return null;
    // preview without randomness so the number doesn't flicker
    return score(cards, this.profile, { enemyEl: this.enemy?.el, discards: this.discards, discardsUsed: this.discardsUsed, held: this.hand.length - cards.length, rng: () => 1 });
  }

  play(ids) {
    if (this.over) return null;
    const cards = ids.map((id) => this.hand.find((c) => c.id === id)).filter(Boolean).slice(0, this.maxPlay);
    if (!cards.length) return null;
    const res = score(cards, this.profile, { enemyEl: this.enemy?.el, discards: this.discards, discardsUsed: this.discardsUsed, held: this.hand.length - cards.length, rng: this.rng });
    this.hand = this.hand.filter((c) => !cards.includes(c));
    this.discardPile.push(...cards);
    for (const c of cards) this.locked.delete(c.id);
    this.turn++;
    const events = { score: res, cards, enemyMove: null, dmgToEnemy: 0, dmgToPlayer: 0, heal: 0, gold: res.gold };
    const p = this.profile;
    if (res.heal) { const before = p.hp; p.hp = Math.min(p.maxHp, p.hp + res.heal); events.heal = p.hp - before; }
    if (res.gold) p.gold += res.gold;

    if (this.mode === 'duel') {
      this.total += res.total;
      this.handsLeft--;
      if (this.handsLeft <= 0) this.over = true;
      else this.draw();
      return events;
    }

    // pve: damage the enemy (shield soaks first)
    const e = this.enemy;
    let dmg = res.total;
    if (e.shield > 0) { const s = Math.min(e.shield, dmg); e.shield -= s; dmg -= s; events.shielded = s; }
    e.hp = Math.max(0, e.hp - dmg);
    events.dmgToEnemy = res.total;
    if (e.hp <= 0) {
      this.over = true;
      this.result = 'win';
      return events;
    }
    // enemy acts
    events.enemyMove = this.enemyAct(events);
    if (p.hp <= 0) { this.over = true; this.result = 'lose'; return events; }
    this.pickIntent();
    this.draw();
    return events;
  }

  enemyAct(events) {
    const e = this.enemy;
    const it = e.intent;
    const m = it.move;
    let dmg = it.dmg;
    if (e.charged && m.dmg > 0) e.charged = false;
    const out = { name: it.name, key: it.key, dmg: 0, effects: [] };
    if (m.charge) { e.charged = true; out.effects.push('charging'); }
    if (m.enrage) { e.enrage += m.enrage; out.effects.push('enraged'); }
    if (m.shield) { e.shield += Math.round(e.maxHp * m.shield); out.effects.push('shielded'); }
    if (m.burn) { this.burn = 3; out.effects.push('burned'); }
    if (m.discardDrain) { this.discards = Math.max(0, this.discards - m.discardDrain); out.effects.push('−1 discard'); }
    if (m.handDrain) { this.handDrain = m.handDrain; out.effects.push('tangled'); }
    if (m.lock && this.hand.length) {
      const c = this.hand[Math.floor(this.rng() * this.hand.length)];
      this.locked.add(c.id);
      out.effects.push('a card is locked');
    }
    if (this.burn > 0) { dmg += 2; this.burn--; }
    this.profile.hp = Math.max(0, this.profile.hp - dmg);
    out.dmg = dmg;
    events.dmgToPlayer = dmg;
    return out;
  }

  discard(ids) {
    if (this.over || this.discards <= 0) return false;
    const cards = ids.map((id) => this.hand.find((c) => c.id === id)).filter((c) => c && !this.locked.has(c.id)).slice(0, this.maxPlay);
    if (!cards.length) return false;
    this.hand = this.hand.filter((c) => !cards.includes(c));
    this.discardPile.push(...cards);
    this.discards--;
    this.discardsUsed++;
    this.draw();
    return true;
  }

  // rewards on a pve win
  rewards() {
    const p = this.profile;
    const e = this.enemy;
    let gold = 3 + e.level * 2;
    if (this.has('salvager')) gold += 4;
    return { gold };
  }
}

export function charmDesc(key) {
  const c = CHARMS[key];
  return c ? c.text : '';
}
