// battle overlay: hand, scoring animation, enemy panel, duel scoreboard
import { HANDS, CREATURES, BEATS } from '../cards/data.js';
import { cardEl, charmEl, elBadge, hideTip } from './cardview.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function floatText(text, x, y, cls) {
  const d = document.createElement('div');
  d.className = `float ${cls}`;
  d.textContent = text;
  d.style.left = `${x}px`;
  d.style.top = `${y}px`;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 1400);
}

export function banner(text, color = '#fbf3e4') {
  const d = document.createElement('div');
  d.className = 'banner';
  d.textContent = text;
  d.style.color = color;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 1700);
}

const fmt = (n) => (Number.isInteger(n) ? n : n.toFixed(1)).toLocaleString();

export class BattleUI {
  constructor(root, hooks) {
    this.root = root;
    this.hooks = hooks;
    this.el = null;
    this.selected = [];
    this.busy = false;
    this.sortMode = 'rank';
    this.onKey = this.onKey.bind(this);
  }

  open(battle, opts = {}) {
    this.battle = battle;
    this.opts = opts;
    this.selected = [];
    this.busy = false;
    const el = document.createElement('div');
    el.className = 'battle';
    el.innerHTML = `
      ${battle.mode === 'pve' ? '<div class="enemy panel"></div>' : '<div class="duelbar panel"></div>'}
      <div class="charms"></div>
      <div class="scorebox panel">
        <div class="hand">select cards</div>
        <div class="cxm"><div class="c">0</div><span>×</span><div class="m">0</div></div>
        <div class="total"></div>
      </div>
      <div class="youbar panel"><div class="row" style="justify-content:space-between"><b>${opts.name || 'you'}</b><span class="hpn"></span></div><div class="hpbar"><div></div></div></div>
      <div class="deckcount panel" data-tip="cards left to draw · cards already played or discarded"></div>
      <div class="handwrap">
        <div class="table"></div>
        <div class="actions">
          <button class="btn red small" data-act="discard" data-tip="swap the selected cards for new ones">discard</button>
          <button class="btn ghost small" data-act="sort">sort: rank</button>
          <button class="btn blue" data-act="play">play hand <kbd>enter</kbd></button>
          ${battle.mode === 'pve' ? '<button class="btn ghost small" data-act="flee" data-tip="escape, taking half the next hit">flee</button>' : ''}
        </div>
        <div class="hand-row"></div>
      </div>`;
    this.root.appendChild(el);
    this.el = el;
    el.querySelector('[data-act=play]').onclick = () => this.play();
    el.querySelector('[data-act=discard]').onclick = () => this.discard();
    el.querySelector('[data-act=sort]').onclick = (e) => {
      this.sortMode = this.sortMode === 'rank' ? 'element' : 'rank';
      e.target.textContent = `sort: ${this.sortMode}`;
      this.renderHand();
    };
    const flee = el.querySelector('[data-act=flee]');
    if (flee) flee.onclick = () => !this.busy && this.opts.onFlee?.();
    addEventListener('keydown', this.onKey);
    this.renderCharms();
    this.refresh();
  }

  close() {
    removeEventListener('keydown', this.onKey);
    hideTip();
    this.el?.remove();
    this.el = null;
  }

  onKey(e) {
    if (!this.el || this.busy || e.target.tagName === 'INPUT') return;
    if (e.code === 'Enter') { e.preventDefault(); this.play(); }
    else if (e.code === 'KeyX') this.discard();
    else if (/^Digit[1-9]$/.test(e.code)) {
      const i = +e.code.slice(5) - 1;
      const c = this.sortedHand()[i];
      if (c) this.toggle(c.id);
    }
  }

  sortedHand() {
    const h = this.battle.hand.slice();
    const order = { ember: 0, tide: 1, grove: 2, volt: 3 };
    if (this.sortMode === 'rank') h.sort((a, b) => b.rank - a.rank || order[a.el] - order[b.el]);
    else h.sort((a, b) => order[a.el] - order[b.el] || b.rank - a.rank);
    return h;
  }

  toggle(id) {
    if (this.busy) return;
    if (this.battle.locked.has(id)) return;
    const i = this.selected.indexOf(id);
    if (i >= 0) this.selected.splice(i, 1);
    else if (this.selected.length < this.battle.maxPlay) this.selected.push(id);
    this.hooks.sfx?.('tick');
    this.renderHand();
    this.renderPreview();
  }

  renderCharms() {
    const box = this.el.querySelector('.charms');
    box.innerHTML = '';
    const p = this.battle.profile;
    p.charms.forEach((k, i) => box.appendChild(charmEl(k, { idx: i })));
    for (let i = p.charms.length; i < p.maxCharms; i++) box.appendChild(charmEl(null));
  }

  renderHand() {
    const row = this.el.querySelector('.hand-row');
    row.innerHTML = '';
    const hand = this.sortedHand();
    const n = hand.length;
    hand.forEach((c, i) => {
      const d = cardEl(c);
      const t = n > 1 ? i / (n - 1) - 0.5 : 0;
      d.style.transform = `rotate(${t * 12}deg) translateY(${t * t * 28}px)`;
      if (this.selected.includes(c.id)) d.classList.add('sel');
      if (this.battle.locked.has(c.id)) d.classList.add('locked');
      d.onclick = () => this.toggle(c.id);
      row.appendChild(d);
    });
  }

  renderPreview() {
    const box = this.el.querySelector('.scorebox');
    const pv = this.selected.length ? this.battle.preview(this.selected) : null;
    const lv = (t) => this.battle.profile.handLevels?.[t] || 1;
    if (!pv) {
      box.querySelector('.hand').innerHTML = `select up to ${this.battle.maxPlay} cards`;
      box.querySelector('.c').textContent = '0';
      box.querySelector('.m').textContent = '0';
      box.querySelector('.total').textContent = '';
    } else {
      const mu = pv.matchup > 1 ? ' <span class="lv" style="color:#80ed99">strong ×1.5</span>' : pv.matchup < 1 ? ' <span class="lv" style="color:#ff8a95">weak ×0.75</span>' : '';
      box.querySelector('.hand').innerHTML = `${HANDS[pv.type].name} <span class="lv" data-tip="hand level ${lv(pv.type)}: ${pv.base.chips} chips × ${pv.base.mult} mult base. raise it with tomes from merchants.">lv ${lv(pv.type)}</span>${mu}`;
      box.querySelector('.c').textContent = fmt(pv.base.chips);
      box.querySelector('.m').textContent = fmt(pv.base.mult);
      box.querySelector('.total').textContent = '';
    }
    const b = this.battle;
    this.el.querySelector('[data-act=play]').disabled = !this.selected.length || this.busy;
    this.el.querySelector('[data-act=discard]').disabled = !this.selected.length || b.discards <= 0 || this.busy;
    this.el.querySelector('[data-act=discard]').innerHTML = `discard (${b.discards}) <kbd>x</kbd>`;
  }

  refresh() {
    const b = this.battle;
    const p = b.profile;
    if (b.mode === 'pve') {
      const e = b.enemy;
      const spec = CREATURES[e.species];
      const weak = Object.keys(BEATS).find((k) => BEATS[k] === e.el);
      const shieldW = Math.min(100, (e.shield / e.maxHp) * 100);
      this.el.querySelector('.enemy').innerHTML = `
        <div class="nm">${e.boss ? `☠ ${e.boss}` : spec.name} <span class="lvl">lv ${e.level}</span> ${elBadge(e.el)}</div>
        <div class="hpbar foe"><div style="width:${(e.hp / e.maxHp) * 100}%"></div>${e.shield ? `<div class="shield" style="width:${shieldW}%"></div>` : ''}</div>
        <div class="hpnum"><span>${fmt(e.hp)} / ${fmt(e.maxHp)} hp</span>${e.shield ? `<span data-tip="shield · absorbs damage before hp">🛡 ${e.shield}</span>` : ''}</div>
        <div class="intent" data-tip="what it does after your next hand: ${e.intent.text}">next: <b>${e.intent.name}</b>${e.intent.dmg ? ` · ${e.intent.dmg} dmg` : ''}</div>
        <div class="matchup" data-tip="a hand's element is the most common one among its scoring cards (ties: none). tide › ember › grove › volt › tide. strong ×1.5 mult, weak ×0.75.">weak to ${elBadge(weak)} hands</div>`;
      const flee = this.el.querySelector('[data-act=flee]');
      if (flee) flee.textContent = e.intent.dmg ? `flee (−${Math.ceil(e.intent.dmg / 2)} hp)` : 'flee';
    } else {
      const o = this.opts.opponent || { name: 'opponent', total: 0, handsLeft: 4 };
      this.el.querySelector('.duelbar').innerHTML = `
        <div style="font-weight:700;font-size:20px;margin-bottom:6px">duel</div>
        <div class="vs">
          <span>${this.opts.name || 'you'} <span style="opacity:.6">(${b.handsLeft} hands left)</span></span><span class="sc">${fmt(b.total)}</span>
          <span>${o.name} <span style="opacity:.6">(${o.handsLeft} hands left)</span></span><span class="sc">${fmt(o.total)}</span>
        </div>`;
    }
    this.el.querySelector('.youbar .hpbar > div').style.width = `${(p.hp / p.maxHp) * 100}%`;
    this.el.querySelector('.youbar .hpn').innerHTML = `${p.hp}/${p.maxHp} hp${b.burn ? ` · <span data-tip="burning · +2 damage on each of the next ${b.burn} enemy hits">🔥 ${b.burn}</span>` : ''}`;
    this.el.querySelector('.deckcount').textContent = `deck ${b.drawPile.length} · used ${b.discardPile.length}`;
    this.renderHand();
    this.renderPreview();
  }

  setOpponent(o) {
    this.opts.opponent = o;
    if (this.el && !this.busy) this.refresh();
  }

  async play() {
    if (this.busy || !this.selected.length) return;
    this.busy = true;
    hideTip();
    const b = this.battle;
    const ids = this.selected.slice();
    // show played cards on the table in play order
    const cards = ids.map((id) => b.hand.find((c) => c.id === id));
    const table = this.el.querySelector('.table');
    table.innerHTML = '';
    const nodes = cards.map((c) => { const d = cardEl(c); table.appendChild(d); return d; });
    this.selected = [];
    b.hand = b.hand.filter((c) => !ids.includes(c.id));
    this.renderHand();
    this.renderPreview();
    b.hand.push(...cards); // battle.play() removes them again
    const ev = b.play(ids);
    const res = ev.score;
    const scoringIdx = new Set(res.scoring.map((c) => cards.indexOf(c)));
    nodes.forEach((n, i) => { if (!scoringIdx.has(i)) n.classList.add('dim'); });

    const box = this.el.querySelector('.scorebox');
    const cEl = box.querySelector('.c'), mEl = box.querySelector('.m');
    box.querySelector('.hand').innerHTML = `${HANDS[res.type].name} <span class="lv">lv ${b.profile.handLevels?.[res.type] || 1}</span>`;
    cEl.textContent = fmt(res.base.chips);
    mEl.textContent = fmt(res.base.mult);
    this.hooks.sfx?.('hand');
    await sleep(350);
    const charmNodes = [...this.el.querySelectorAll('.charms .charm')];
    for (const st of res.steps) {
      let anchor = null;
      if (st.src?.type === 'card') { anchor = nodes[st.src.index]; anchor?.classList.remove('pop'); void anchor?.offsetWidth; anchor?.classList.add('pop'); }
      else if (st.src?.type === 'charm') { anchor = charmNodes[st.src.index]; anchor?.classList.remove('fire'); void anchor?.offsetWidth; anchor?.classList.add('fire'); }
      else if (st.src?.type === 'matchup') anchor = box;
      const r = (anchor || box).getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + (st.src?.type === 'charm' ? r.height + 18 : -10);
      if (st.kind === 'chips') { floatText(`+${fmt(st.value)}`, x, y, 'chips'); cEl.textContent = fmt(st.chips); bump(cEl); this.hooks.sfx?.('chip'); }
      else if (st.kind === 'mult') { floatText(`+${fmt(st.value)} mult`, x, y, 'mult'); mEl.textContent = fmt(st.mult); bump(mEl); this.hooks.sfx?.('mult'); }
      else if (st.kind === 'xmult') { floatText(`×${fmt(st.value)}`, x, y, 'xmult'); mEl.textContent = fmt(st.mult); bump(mEl); this.hooks.sfx?.('xmult'); }
      else if (st.kind === 'heal') floatText(`+${st.value} hp`, x, y, 'heal');
      else if (st.kind === 'gold') floatText(`+${st.value} gold`, x, y, 'gold');
      else if (st.kind === 'retrigger') floatText('again!', x, y, 'gold');
      await sleep(st.kind === 'xmult' ? 300 : 190);
    }
    // count up the total
    const totalEl = box.querySelector('.total');
    const steps = 18;
    for (let i = 1; i <= steps; i++) { totalEl.textContent = fmt(Math.round((res.total * i) / steps)); await sleep(22); }
    this.hooks.sfx?.('total');
    await sleep(250);

    if (b.mode === 'pve') {
      await this.hooks.playerAttack(res);
      this.refresh();
      if (b.result === 'win') { await sleep(300); this.busy = false; table.innerHTML = ''; this.opts.onWin?.(); return; }
      if (ev.enemyMove) {
        await sleep(250);
        await this.hooks.enemyAttack(ev.enemyMove);
        this.refresh();
      }
      if (b.result === 'lose') { await sleep(400); this.busy = false; this.opts.onLose?.(); return; }
    } else {
      this.opts.onScore?.(b.total, b.handsLeft, res);
      this.refresh();
      if (b.over) { await sleep(300); table.innerHTML = ''; this.busy = false; this.opts.onDuelDone?.(b.total); return; }
    }
    await sleep(300);
    table.innerHTML = '';
    this.busy = false;
    this.refresh();
  }

  discard() {
    if (this.busy || !this.selected.length) return;
    if (this.battle.discard(this.selected)) {
      this.selected = [];
      this.hooks.sfx?.('discard');
      this.refresh();
    }
  }
}

function bump(el) {
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
  setTimeout(() => el.classList.remove('bump'), 120);
}
