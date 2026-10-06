// modal screens: title, rewards, shop, deck, prompts
import { CHARMS, CREATURES, HANDS, HAND_ORDER, ENHANCE } from '../cards/data.js';
import { cardEl, charmEl, hideTip } from './cardview.js';
import { CHAR_MODELS } from '../world/assets.js';
import { PLAYER_COLORS, randomEnhancedCard, randomCharm, creatureCard, makeCard, pick } from '../cards/profile.js';
import { handBase } from '../cards/scoring.js';

const ui = () => document.getElementById('ui');

export function modal(html, { onClose = null, closable = true } = {}) {
  document.exitPointerLock?.();
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal panel">${closable ? '<button class="btn ghost small close">close <kbd>esc</kbd></button>' : ''}${html}</div>`;
  ui().appendChild(bg);
  const close = () => {
    hideTip();
    bg.remove();
    removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.code !== 'Escape' || !closable) return;
    const all = document.querySelectorAll('.modal-bg');
    if (all[all.length - 1] === bg) close();
  };
  addEventListener('keydown', onKey);
  bg.querySelector('.close')?.addEventListener('click', close);
  bg.addEventListener('mousedown', (e) => { if (e.target === bg && closable) close(); });
  return { el: bg.querySelector('.modal'), close };
}

const CLASS_ICON = { knight: '🛡️', barbarian: '🪓', mage: '🔮', rogue: '🗡️', rogue_hooded: '🏹' };
const CLASS_NAME = { knight: 'knight', barbarian: 'barbarian', mage: 'mage', rogue: 'rogue', rogue_hooded: 'ranger' };

export function titleScreen(profile, onPlay) {
  const el = document.createElement('div');
  el.className = 'title';
  el.innerHTML = `
    <div class="logo">wild<span class="w">hand</span></div>
    <div class="tagline">roam the isle · play the hand · bind the wild</div>
    <div class="panel">
      <div class="row"><input class="field" maxlength="16" value="${profile.name}" aria-label="name"><button class="btn ghost small" data-r>🎲</button></div>
      <div class="classes">${CHAR_MODELS.map((m) => `<button data-m="${m}" class="${profile.model === m ? 'on' : ''}"><span class="ico">${CLASS_ICON[m]}</span>${CLASS_NAME[m]}</button>`).join('')}</div>
      <div class="colors">${PLAYER_COLORS.map((c) => `<button data-c="${c}" style="background:${c}" class="${profile.color === c ? 'on' : ''}" aria-label="color"></button>`).join('')}</div>
      <button class="btn" data-play style="width:100%">enter the isle</button>
      <div class="howto">
        <b>wasd</b> move · <b>shift</b> run · <b>space</b> jump · <b>drag</b> look · <b>e</b> interact<br>
        walk into wild creatures to battle. play poker hands — <b>chips × mult</b> = damage.<br>
        match elements: <b>tide › ember › grove › volt › tide</b>. bind creatures into your deck.<br>
        find other players and press <b>f</b> to duel.
      </div>
    </div>
    <div class="credit">models: <a href="https://kenney.nl" target="_blank" rel="noopener">kenney</a> & <a href="https://kaylousberg.com" target="_blank" rel="noopener">kaykit</a> (cc0) · p2p multiplayer, no accounts</div>`;
  ui().appendChild(el);
  let model = profile.model || 'knight';
  let color = profile.color;
  el.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => {
    model = b.dataset.m;
    el.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b));
  });
  el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => {
    color = b.dataset.c;
    el.querySelectorAll('[data-c]').forEach((x) => x.classList.toggle('on', x === b));
  });
  const input = el.querySelector('input');
  el.querySelector('[data-r]').onclick = async () => {
    const { randomName } = await import('../cards/profile.js');
    input.value = randomName();
  };
  const go = () => {
    const name = input.value.trim().toLowerCase().replace(/[^a-z0-9 _-]/g, '').slice(0, 16) || profile.name;
    el.remove();
    onPlay({ name, model, color });
  };
  el.querySelector('[data-play]').onclick = go;
  input.addEventListener('keydown', (e) => { if (e.code === 'Enter') go(); });
}

export function loadingScreen() {
  const el = document.createElement('div');
  el.className = 'title loading';
  el.innerHTML = `<div class="logo">wild<span class="w">hand</span></div><div class="progress"><div></div></div><div class="loadmsg">shuffling the deck</div>`;
  ui().appendChild(el);
  return {
    set(p, msg) {
      el.querySelector('.progress > div').style.width = `${Math.round(p * 100)}%`;
      if (msg) el.querySelector('.loadmsg').textContent = msg;
    },
    done() { el.remove(); },
  };
}

// victory rewards: gold + choose one card/charm
export function rewardScreen(profile, enemy, gold, xp, onDone, rng = Math.random) {
  const spec = CREATURES[enemy.species];
  const options = [];
  options.push({ kind: 'card', card: creatureCard(enemy.species), label: `bind ${spec.name}`, desc: spec.bound.text });
  const enh = randomEnhancedCard(rng);
  options.push({ kind: 'card', card: enh, label: `${enh.enh} ${enh.rank} of ${enh.el}`, desc: ENHANCE[enh.enh].text });
  const charmChance = enemy.boss ? 1 : spec.tier >= 2 ? 0.7 : 0.3;
  const ck = rng() < charmChance ? (randomCharm(profile.charms, rng, enemy.boss || spec.tier >= 3 ? 3 : 2, enemy.boss ? 2 : 1) || randomCharm(profile.charms, rng)) : null;
  if (ck) options.push({ kind: 'charm', key: ck, label: CHARMS[ck].name, desc: CHARMS[ck].text });
  else {
    const e2 = randomEnhancedCard(rng);
    options.push({ kind: 'card', card: e2, label: `${e2.enh} ${e2.rank} of ${e2.el}`, desc: ENHANCE[e2.enh].text });
  }
  const m = modal(`
    <h2>victory!</h2>
    <div class="sub">${enemy.boss || spec.name} lv ${enemy.level} defeated · <span class="gold">+${gold} gold</span> · <span style="color:#8fd8ff">+${xp} xp</span> · pick one to add</div>
    <div class="choices"></div>
    <div style="text-align:center"><button class="btn ghost small" data-skip>skip</button></div>`, { closable: false });
  const box = m.el.querySelector('.choices');
  options.forEach((o) => {
    const c = document.createElement('div');
    c.className = 'choice';
    const vis = o.kind === 'card' ? cardEl(o.card) : charmEl(o.key);
    if (o.kind === 'charm') { vis.style.width = '96px'; vis.style.height = '96px'; vis.style.fontSize = '44px'; }
    const full = o.kind === 'charm' && profile.charms.length >= profile.maxCharms;
    c.append(vis);
    c.insertAdjacentHTML('beforeend', `<b>${o.label}</b><div class="desc">${o.desc}</div><button class="btn small ${full ? 'ghost' : ''}" ${full ? 'disabled' : ''}>${full ? 'charms full' : 'take'}</button>`);
    c.querySelector('button').onclick = () => {
      if (o.kind === 'card') profile.deck.push(o.card);
      else profile.charms.push(o.key);
      m.close();
      onDone(o);
    };
    vis.onclick = () => c.querySelector('button').click();
    box.appendChild(c);
  });
  m.el.querySelector('[data-skip]').onclick = () => { m.close(); onDone(null); };
}

function shopStock(profile, maxRarity = 3, rng = Math.random) {
  const charms = [];
  for (let i = 0; i < 3; i++) {
    const k = randomCharm([...profile.charms, ...charms], rng, maxRarity);
    if (k) charms.push(k);
  }
  const tome = pick(HAND_ORDER.slice(3), rng); // pair..flush-ish range
  return { charms, tome, packs: 2 };
}

export function shopScreen(profile, state, { onChange, sfx, title = 'the wandering merchant', maxRarity = 3, priceMult = 1 }) {
  const price = (n) => Math.round(n * priceMult);
  if (!state.stock) state.stock = shopStock(profile, maxRarity);
  const m = modal('<div class="shop"></div>', { onClose: onChange });
  const render = () => {
    hideTip();
    const s = state.stock;
    const el = m.el.querySelector('.shop');
    const lv = profile.handLevels[s.tome] || 1;
    const nb = handBase(s.tome, lv + 1);
    el.innerHTML = `
      <h2>${title}</h2>
      <div class="sub">“cards, charms, curiosities.” · you have <span class="gold">${profile.gold} gold</span> · charms ${profile.charms.length}/${profile.maxCharms}</div>
      <h3>charms</h3><div class="choices charms-sale"></div>
      <h3>packs & services</h3>
      <div class="choices services">
        <div class="choice"><div class="charm" style="width:86px;height:86px;font-size:40px">🎴</div><b>elemental pack</b><div class="desc">choose 1 of 3 enhanced cards</div><button class="btn small" data-buy="pack" ${s.packs <= 0 ? 'disabled' : ''}>${price(4)} gold${s.packs <= 0 ? ' · sold out' : ''}</button></div>
        <div class="choice"><div class="charm" style="width:86px;height:86px;font-size:40px">📜</div><b>tome of ${HANDS[s.tome].name}</b><div class="desc">level up to ${lv + 1}: ${nb.chips} chips × ${nb.mult} mult</div><button class="btn small" data-buy="tome">${price(5)} gold</button></div>
        <div class="choice"><div class="charm" style="width:86px;height:86px;font-size:40px">🕯️</div><b>cleanse</b><div class="desc">remove a card from your deck (${profile.deck.length})</div><button class="btn small" data-buy="cleanse">${price(3)} gold</button></div>
        <div class="choice"><div class="charm" style="width:86px;height:86px;font-size:40px">🔁</div><b>reroll charms</b><div class="desc">new stock</div><button class="btn small" data-buy="reroll">${price(2)} gold</button></div>
      </div>`;
    const cs = el.querySelector('.charms-sale');
    if (!s.charms.length) cs.innerHTML = '<div class="desc">sold out</div>';
    s.charms.forEach((k, i) => {
      const c = document.createElement('div');
      c.className = 'choice';
      const vis = charmEl(k);
      vis.style.width = '86px'; vis.style.height = '86px'; vis.style.fontSize = '40px';
      const full = profile.charms.length >= profile.maxCharms;
      c.append(vis);
      c.insertAdjacentHTML('beforeend', `<b>${CHARMS[k].name}</b><div class="desc">${CHARMS[k].text}</div><button class="btn small" ${full ? 'disabled' : ''}>${full ? 'charms full' : `${price(CHARMS[k].cost)} gold`}</button>`);
      c.querySelector('button').onclick = () => {
        if (!buy(price(CHARMS[k].cost))) return;
        profile.charms.push(k);
        s.charms.splice(i, 1);
        render();
      };
      cs.appendChild(c);
    });
    el.querySelectorAll('[data-buy]').forEach((b) => b.onclick = () => service(b.dataset.buy));
  };
  const buy = (cost) => {
    if (profile.gold < cost) { flash('not enough gold'); return false; }
    profile.gold -= cost;
    sfx?.('coin');
    onChange?.();
    return true;
  };
  const flash = (t) => {
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = t;
    document.querySelector('.toasts')?.appendChild(d);
    setTimeout(() => d.remove(), 3200);
  };
  const service = (kind) => {
    const s = state.stock;
    if (kind === 'pack' && s.packs > 0) {
      if (!buy(price(4))) return;
      s.packs--;
      sfx?.('pack');
      const cards = [randomEnhancedCard(), randomEnhancedCard(), randomEnhancedCard()];
      pickCard('open pack', 'choose one card to keep', cards, (c) => { profile.deck.push(c); onChange?.(); render(); });
    } else if (kind === 'tome') {
      if (!buy(price(5))) return;
      profile.handLevels[s.tome] = (profile.handLevels[s.tome] || 1) + 1;
      s.tome = pick(HAND_ORDER.slice(3));
      render();
    } else if (kind === 'cleanse') {
      if (profile.deck.length <= 20) { flash('your deck is already lean (20 cards min)'); return; }
      if (profile.gold < price(3)) { flash('not enough gold'); return; }
      pickCard('cleanse', 'choose a card to remove', profile.deck, (c) => {
        if (!buy(price(3))) return;
        profile.deck = profile.deck.filter((x) => x.id !== c.id);
        onChange?.();
        render();
      }, true);
    } else if (kind === 'reroll') {
      if (!buy(price(2))) return;
      s.charms = shopStock(profile, maxRarity).charms;
      render();
    }
  };
  render();
}

export function pickCard(title, sub, cards, onPick, cancelable = false) {
  const m = modal(`<h2>${title}</h2><div class="sub">${sub}</div><div class="grid picks"></div>`, { closable: cancelable });
  const g = m.el.querySelector('.picks');
  if (cards.length <= 4) { g.className = 'choices picks'; }
  cards.forEach((c) => {
    const d = cardEl(c);
    d.onclick = () => { m.close(); onPick(c); };
    g.appendChild(d);
  });
}

export function deckScreen(profile, { onChange, sfx } = {}) {
  const m = modal('<div class="deckview"></div>', { onClose: onChange });
  const render = () => {
    const el = m.el.querySelector('.deckview');
    const order = { ember: 0, tide: 1, grove: 2, volt: 3 };
    const deck = profile.deck.slice().sort((a, b) => order[a.el] - order[b.el] || b.rank - a.rank);
    el.innerHTML = `
      <h2>${profile.name}'s deck</h2>
      <div class="sub">${deck.length} cards · ${deck.filter((c) => c.creature).length} bound creatures · <span class="gold">${profile.gold} gold</span> · ${profile.wins} wins · ${profile.duelWins} duel wins</div>
      <h3>charms (${profile.charms.length}/${profile.maxCharms}) — click to sell for half</h3><div class="row charmrow" style="flex-wrap:wrap"></div>
      <h3>cards</h3><div class="grid cards"></div>
      <h3>hand levels</h3><div class="levels"></div>`;
    const cr = el.querySelector('.charmrow');
    if (!profile.charms.length) cr.innerHTML = '<span style="opacity:.6">none yet — win battles or visit the merchant</span>';
    profile.charms.forEach((k, i) => {
      const c = charmEl(k);
      c.style.cursor = 'pointer';
      c.onclick = async () => {
        hideTip();
        const ok = await confirmScreen(`sell ${CHARMS[k].name}?`, `you'll get ${Math.floor(CHARMS[k].cost / 2)} gold back.`, 'sell', 'keep');
        if (!ok) return;
        profile.charms.splice(i, 1);
        profile.gold += Math.floor(CHARMS[k].cost / 2);
        sfx?.('coin');
        hideTip();
        render();
      };
      cr.appendChild(c);
    });
    const g = el.querySelector('.cards');
    deck.forEach((c) => g.appendChild(cardEl(c, { small: true })));
    const lv = el.querySelector('.levels');
    HAND_ORDER.slice().reverse().forEach((t) => {
      const l = profile.handLevels[t] || 1;
      const b = handBase(t, l);
      lv.insertAdjacentHTML('beforeend', `<span>${HANDS[t].name} <span style="opacity:.6">lv ${l}</span></span><span class="c">${b.chips}</span><span class="m">×${b.mult}</span>`);
    });
  };
  render();
  return m;
}

export function confirmScreen(title, sub, yes = 'accept', no = 'decline') {
  return new Promise((resolve) => {
    const m = modal(`<h2>${title}</h2><div class="sub">${sub}</div><div class="row" style="justify-content:center;gap:14px"><button class="btn" data-y>${yes} <kbd>y</kbd></button><button class="btn ghost" data-n>${no} <kbd>n</kbd></button></div>`, { closable: false });
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; removeEventListener('keydown', key); m.close(); resolve(v); };
    const key = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.code === 'KeyY') done(true);
      if (e.code === 'KeyN') done(false);
    };
    addEventListener('keydown', key);
    m.el.querySelector('[data-y]').onclick = () => done(true);
    m.el.querySelector('[data-n]').onclick = () => done(false);
    setTimeout(() => done(false), 15000);
  });
}

export { makeCard };

// full continent map; when opened from a waystone, discovered outposts are travel targets
export function worldMapScreen({ base, hubs, zones, discovered, player, facing, others, level, travelFrom, onTravel, onClose }) {
  const m = modal(`<h2>${travelFrom ? `${travelFrom.zone.hubName} waystone` : 'the continent'}</h2>
    <div class="sub">${travelFrom ? 'choose an attuned waystone to travel to. touch new waystones to attune them.' : 'zones, outposts and waystones. attuned waystones glow blue.'}</div>
    <div class="worldmap"><canvas width="900" height="900"></canvas></div>`, { onClose });
  const cv = m.el.querySelector('canvas');
  const g = cv.getContext('2d');
  const S = cv.width;
  const toMap = (x, z) => [(x + 4096) / 8192 * S, (z + 4096) / 8192 * S];
  const targets = [];
  const draw = (hover) => {
    g.clearRect(0, 0, S, S);
    g.imageSmoothingEnabled = true;
    g.drawImage(base, 0, 0, S, S);
    g.textAlign = 'center';
    for (const z of zones) {
      const [x, y] = toMap(z.center[0], z.center[1]);
      const lvlOk = level + 3 >= z.levels[0];
      g.font = '600 22px Fredoka, sans-serif';
      g.lineWidth = 5; g.strokeStyle = 'rgba(27,20,48,.75)'; g.fillStyle = '#fbf3e4';
      g.strokeText(z.name, x, y); g.fillText(z.name, x, y);
      g.font = '500 15px Fredoka, sans-serif';
      g.fillStyle = lvlOk ? '#ffcf5a' : '#ff8a95';
      g.strokeText(`lv ${z.levels[0]}–${z.levels[1]}`, x, y + 20); g.fillText(`lv ${z.levels[0]}–${z.levels[1]}`, x, y + 20);
    }
    targets.length = 0;
    for (const h of hubs) {
      const [x, y] = toMap(h.pos.x, h.pos.z);
      const known = discovered.includes(h.zone.id);
      const can = travelFrom && known && h !== travelFrom;
      g.beginPath(); g.arc(x, y, hover === h ? 12 : 9, 0, 7);
      g.fillStyle = known ? '#8fd8ff' : '#ffcf5a';
      g.fill(); g.lineWidth = 3; g.strokeStyle = can ? '#ffffff' : '#1b1430'; g.stroke();
      g.font = '600 14px Fredoka, sans-serif';
      g.lineWidth = 4; g.strokeStyle = 'rgba(27,20,48,.8)'; g.fillStyle = '#fbf3e4';
      g.strokeText(h.zone.hubName, x, y - 16); g.fillText(h.zone.hubName, x, y - 16);
      if (can) targets.push({ h, x, y });
    }
    for (const o of others) {
      const [x, y] = toMap(o.x, o.z);
      g.beginPath(); g.arc(x, y, 6, 0, 7); g.fillStyle = o.c; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
    }
    const [px, py] = toMap(player.x, player.z);
    g.save(); g.translate(px, py); g.rotate(-facing + Math.PI);
    g.fillStyle = '#fff'; g.strokeStyle = '#1b1430'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 8); g.lineTo(0, 3); g.lineTo(-8, 8); g.closePath(); g.stroke(); g.fill();
    g.restore();
  };
  draw(null);
  const pick = (e) => {
    const r = cv.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * S, y = (e.clientY - r.top) / r.height * S;
    return targets.find((t) => Math.hypot(t.x - x, t.y - y) < 22)?.h || null;
  };
  cv.addEventListener('pointermove', (e) => { const h = pick(e); cv.style.cursor = h ? 'pointer' : 'default'; draw(h); });
  cv.addEventListener('click', (e) => {
    const h = pick(e);
    if (!h) return;
    m.close();
    onTravel(h);
  });
  return m;
}
