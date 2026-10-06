// dom rendering for cards and charms
import { CREATURES, CHARMS, ENHANCE, EL } from '../cards/data.js';

export const GLYPH = {
  ember: '<svg viewBox="0 0 24 24"><path d="M12.5 1.5c.8 3.6 4.8 5.6 4.8 10.6a5.3 5.3 0 0 1-10.6 0c0-2.8 1.5-4 2.2-5.6.5 1.6 1.4 2.3 2.1 2.4-.6-2.7.1-5.3 1.5-7.4z"/></svg>',
  tide: '<svg viewBox="0 0 24 24"><path d="M12 1.8C9 6.6 5.6 10.1 5.6 14.4a6.4 6.4 0 0 0 12.8 0C18.4 10.1 15 6.6 12 1.8z"/><path d="M8.6 15.2c1.2 1 2.5 1 3.6 0s2.5-1 3.6 0" fill="none" stroke-width="1.6" stroke-linecap="round"/></svg>',
  grove: '<svg viewBox="0 0 24 24"><path d="M20.5 3C10.5 3 4 8.2 4 15.6c0 1.6.3 2.8.9 3.8C7.2 13.3 11.4 10.2 15.6 8.6 11.6 11.1 8.4 14.8 6.8 20.2 8.3 21 10 21.4 12.2 21.4c6.4 0 9.6-6.3 8.3-18.4z"/></svg>',
  volt: '<svg viewBox="0 0 24 24"><path d="M13.6 1.5 4 13.8h6.4L9.3 22.5l9.7-12.6h-6.5z"/></svg>',
};

let portraits = {};
export function setPortraits(p) { portraits = p; }

export function cardEl(card, { small = false } = {}) {
  const d = document.createElement('div');
  d.className = `card el-${card.el}` + (card.creature ? ' creature' : '') + (card.enh ? ` enh-${card.enh}` : '');
  d.dataset.id = card.id;
  const rank = card.rank;
  if (card.creature) {
    const spec = CREATURES[card.creature];
    const img = portraits[card.creature];
    d.innerHTML = `<div class="face">
      <div class="rank">${rank}</div>
      <div class="portrait" style="${img ? `background-image:url(${img})` : ''}"></div>
      <div class="cname">${spec.name}</div>
      <div class="pip">${GLYPH[card.el]}</div>
      <div class="rank br">${rank}</div>
      <div class="enh"></div></div>`;
  } else {
    d.innerHTML = `<div class="face">
      <div class="rank">${rank}</div>
      <div class="pip">${GLYPH[card.el]}</div>
      <div class="art">${GLYPH[card.el]}</div>
      <div class="rank br">${rank}</div>
      ${card.enh ? `<div class="tag">${ENHANCE[card.enh].name}</div>` : ''}
      <div class="enh"></div></div>`;
  }
  // subtle 3d tilt toward the pointer
  if (!small) {
    d.addEventListener('pointermove', (e) => {
      const r = d.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      d.style.setProperty('--tilt-y', `${x * 18}deg`);
      d.style.setProperty('--tilt-x', `${-y * 18}deg`);
    });
    d.addEventListener('pointerleave', () => { d.style.setProperty('--tilt-y', '0deg'); d.style.setProperty('--tilt-x', '0deg'); });
  }
  attachTip(d, () => cardTip(card));
  return d;
}

export function cardTip(card) {
  const parts = [`<b>${card.rank} of ${card.el}</b>`, `<span class="r">+${card.rank} chips when scored</span>`];
  if (card.creature) {
    const s = CREATURES[card.creature];
    parts[0] = `<b>${s.name} · ${card.rank} of ${card.el}</b>`;
    parts.push(`bound creature: ${s.bound.text}`);
  }
  if (card.enh) parts.push(`${ENHANCE[card.enh].name}: ${ENHANCE[card.enh].text}`);
  return parts.join('<br>');
}

export function charmEl(key, { idx = null } = {}) {
  const d = document.createElement('div');
  if (!key) { d.className = 'charm empty'; return d; }
  const c = CHARMS[key];
  d.className = `charm r${c.rarity}`;
  d.dataset.key = key;
  if (idx !== null) d.dataset.idx = idx;
  d.textContent = c.icon;
  attachTip(d, () => charmTip(key));
  return d;
}
export function charmTip(key) {
  const c = CHARMS[key];
  const rar = ['', 'common', 'uncommon', 'rare'][c.rarity];
  return `<b>${c.name}</b>${c.text}<br><span class="r">${rar} charm</span>`;
}

let tipEl = null;
export function attachTip(el, html) {
  const show = (e) => {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; document.body.appendChild(tipEl); }
    tipEl.innerHTML = html();
    tipEl.classList.remove('hidden');
    move(e);
  };
  const move = (e) => {
    if (!tipEl) return;
    const x = Math.min(e.clientX + 14, innerWidth - 250);
    const y = Math.max(10, e.clientY - tipEl.offsetHeight - 14);
    tipEl.style.left = `${x}px`;
    tipEl.style.top = `${y}px`;
  };
  el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') show(e); });
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerleave', hideTip);
}
export function hideTip() { tipEl?.classList.add('hidden'); }

export function elBadge(el) {
  return `<span class="badge" style="background:${EL[el].color}">${GLYPH[el]}${el}</span>`;
}
