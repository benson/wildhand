// the game: ties world, player, creatures, battles, duels, hud and networking together
import * as THREE from 'three';
import { createRenderer, createComposer, pickQuality } from './render.js';
import { World } from './world/world.js';
import { ZONES, ZONE_BY_ID, CONTINENT_R } from './world/zones.js';
import { roadSegments, height as genHeight } from './world/gen.js';
import { ensureProgress, grantXp, xpFor, xpToNext, MAX_LEVEL } from './cards/progress.js';
import { Player, Input } from './entities/player.js';
import { Creatures, enemyStats } from './entities/creatures.js';
import { Remotes } from './entities/remote.js';
import { Battle } from './cards/battle.js';
import { CREATURES, EL } from './cards/data.js';
import { loadProfile, saveProfile } from './cards/profile.js';
import { BattleUI, floatText, banner } from './ui/battleui.js';
import { setPortraits } from './ui/cardview.js';
import { renderPortraits } from './ui/portraits.js';
import { titleScreen, loadingScreen, rewardScreen, shopScreen, deckScreen, confirmScreen, modal, worldMapScreen } from './ui/menus.js';
import { Net } from './net.js';
import { sfx, toggleMute, isMuted } from './sfx.js';

const EPOCH = 1.76e12;
const sharedTime = () => (Date.now() - EPOCH) / 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let glowTex = null;
function getGlowTex() {
  if (glowTex) return glowTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.65)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(cv);
  return glowTex;
}

export class Game {
  constructor() {
    this.quality = pickQuality();
    this.profile = ensureProgress(loadProfile());
    this.ui = document.getElementById('ui');
    this.state = 'loading'; // loading | title | explore | battle | duel | menu
    this.fx = [];
    this.tweens = [];
    this.ignoreUntil = new Map();
    this.shopState = {};
    this.duel = null;
    this.lastSend = 0;
    this.frame = 0;
    // ?render=0 skips drawing (used by automated tests on slow software gl)
    this.skipRender = new URLSearchParams(location.search).get('render') === '0';
  }

  async init() {
    const load = loadingScreen();
    const canvas = document.getElementById('game');
    this.renderer = createRenderer(canvas, this.quality);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2000);
    this.camera.fov = this.camera.aspect < 1 ? 70 : 55;
    this.camera.updateProjectionMatrix();
    this.world = new World(this.scene, this.quality);
    await this.world.build((p, msg) => load.set(p * 0.6, msg));
    this.creatures = new Creatures(this.world);
    this.world.onSpawns = (k, list) => this.creatures.addSpawns(k, list);
    this.world.onUnloadSpawns = (k) => this.creatures.removeSpawns(k);
    this.titleCenter = ZONE_BY_ID.hearthvale.hub;
    const hp = this.world.hubs[0].pos;
    await this.world.settle(hp, (left) => load.set(0.6 + 0.2 * (1 - Math.min(1, left / 12)), 'growing the meadow'));
    load.set(0.85, 'painting portraits');
    try { setPortraits(await renderPortraits()); } catch (e) { console.warn('portraits failed', e); }
    this.input = new Input(canvas);
    this.player = new Player(this.world, this.camera, this.input);
    this.input.canLock = () => this.state === 'explore';
    this.input.canMove = () => this.state !== 'menu';
    this.remotes = new Remotes(this.scene);
    this.composer = createComposer(this.renderer, this.scene, this.camera, this.quality);
    this.battleUI = new BattleUI(this.ui, this.battleHooks());
    load.set(0.95, 'calling the merchants');
    await this.spawnMerchants();
    addEventListener('resize', () => this.resize());
    this.clock = new THREE.Clock();
    load.done();
    this.state = 'title';
    this.loop();
    window.__ready = true;
    window.__game = this;
    titleScreen(this.profile, (o) => this.start(o));
  }

  closeChat() {
    const inp = this.hud.chatIn;
    if (inp.classList.contains('hidden')) return;
    inp.classList.add('hidden'); inp.blur(); this.input.enabled = true;
  }

  resize() {
    const pr = Math.min(devicePixelRatio, this.quality.pixelRatio);
    this.renderer.setPixelRatio(pr);
    this.composer.setPixelRatio?.(pr);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.fov = this.camera.aspect < 1 ? 70 : 55;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
  }

  async spawnMerchants() {
    const { createCharacter } = await import('./entities/character.js');
    this.merchants = [];
    for (const hub of this.world.hubs) {
      const { holder, anim } = await createCharacter(hub.index % 2 ? 'mage' : 'rogue_hooded');
      holder.position.copy(hub.merchantPos);
      holder.position.y = hub.pos.y;
      holder.rotation.y = hub.merchantRot;
      anim.play('Idle');
      this.scene.add(holder);
      this.merchants.push({ holder, anim, hub });
    }
  }

  // nearest outpost to a point
  nearestHub(p, onlyDiscovered = false) {
    let best = null, bd = Infinity;
    for (const h of this.world.hubs) {
      if (onlyDiscovered && !this.profile.discovered.includes(h.zone.id)) continue;
      const d = Math.hypot(h.pos.x - p.x, h.pos.z - p.z);
      if (d < bd) { bd = d; best = h; }
    }
    return { hub: best, dist: bd };
  }

  // move the player somewhere far away, waiting for the ground to stream in
  async teleport(x, z, label = 'travelling') {
    const veil = document.createElement('div');
    veil.className = 'title loading';
    veil.innerHTML = `<div class="logo" style="font-size:64px">${label}…</div><div class="progress"><div></div></div>`;
    this.ui.appendChild(veil);
    const prev = this.state;
    this.state = 'menu';
    this.player.pos.set(x, genHeight(x, z), z);
    await this.world.settle(this.player.pos, (left) => { veil.querySelector('.progress > div').style.width = `${Math.round((1 - Math.min(1, left / 12)) * 100)}%`; });
    this.player.pos.y = this.world.terrain.heightAt(x, z);
    this.world.snapAtmosphere = true;
    this.lastZone = null;
    veil.remove();
    this.state = prev === 'menu' ? 'explore' : prev;
  }

  async start({ name, model, color }) {
    const p = this.profile;
    p.name = name;
    p.model = model;
    p.color = color;
    saveProfile(p);
    const home = this.world.hubs[0].pos;
    let sx = home.x + 3, sz = home.z + 7;
    if (p.pos && Math.hypot(p.pos.x, p.pos.z) < CONTINENT_R * 1.2 && genHeight(p.pos.x, p.pos.z) > 0.5) { sx = p.pos.x; sz = p.pos.z; }
    await this.player.load(model);
    this.buildHUD();
    await this.teleport(sx, sz, 'arriving');
    this.state = 'explore';
    this.net = new Net();
    this.setupNet();
    this.net.connect();
    this.toast(`welcome to the continent, ${name}`);
    if (!p.wins) setTimeout(() => this.toast('tip: walk into a wild creature to battle it'), 2500);
    setInterval(() => this.save(), 5000);
  }

  save() {
    this.profile.pos = { x: this.player.pos.x, z: this.player.pos.z };
    saveProfile(this.profile);
  }

  // ---------------------------------------------------------------- hud
  buildHUD() {
    const ui = this.ui;
    ui.insertAdjacentHTML('beforeend', `
      <div class="labels"></div>
      <div class="hud-tl">
        <div class="chip"><span class="hud-name"></span><div class="hpbar"><div></div></div><span class="hud-hp"></span></div>
        <div class="row"><div class="chip hud-lv"><span class="lvn"></span><div class="xpbar"><div></div></div></div><div class="chip gold hud-gold"></div></div>
        <div class="row"><div class="chip hud-zone"></div></div>
      </div>
      <div class="hud-tr"><canvas class="minimap" width="170" height="170"></canvas><div class="chip hud-online"></div></div>
      <div class="hud-br">
        <button class="iconbtn" data-b="map">map <kbd>m</kbd></button>
        <button class="iconbtn" data-b="mount">ride <kbd>r</kbd></button>
        <button class="iconbtn" data-b="deck">deck <kbd>tab</kbd></button>
        <button class="iconbtn" data-b="mute">${isMuted() ? 'sound off' : 'sound on'} <kbd>n</kbd></button>
        <button class="iconbtn" data-b="help">help <kbd>h</kbd></button>
      </div>
      <div class="prompt hidden"></div>
      <div class="toasts"></div>
      <div class="chat"><div class="log"></div><input class="field hidden" maxlength="120" placeholder="say something…"></div>
    `);
    this.hud = {
      name: ui.querySelector('.hud-name'),
      hp: ui.querySelector('.hud-tl .hpbar > div'),
      hpn: ui.querySelector('.hud-hp'),
      gold: ui.querySelector('.hud-gold'),
      zone: ui.querySelector('.hud-zone'),
      lvn: ui.querySelector('.hud-lv .lvn'),
      xp: ui.querySelector('.hud-lv .xpbar > div'),
      online: ui.querySelector('.hud-online'),
      prompt: ui.querySelector('.prompt'),
      labels: ui.querySelector('.labels'),
      map: ui.querySelector('.minimap'),
      chatLog: ui.querySelector('.chat .log'),
      chatIn: ui.querySelector('.chat input'),
      tl: ui.querySelector('.hud-tl'),
      tr: ui.querySelector('.hud-tr'),
      br: ui.querySelector('.hud-br'),
    };
    ui.querySelector('[data-b=deck]').onclick = () => this.openDeck();
    ui.querySelector('[data-b=mute]').onclick = (e) => { e.currentTarget.innerHTML = `${toggleMute() ? 'sound off' : 'sound on'} <kbd>n</kbd>`; };
    ui.querySelector('[data-b=map]').onclick = () => this.openMap();
    ui.querySelector('[data-b=mount]').onclick = () => this.toggleMount();
    ui.querySelector('[data-b=help]').onclick = () => this.openHelp();
    this.buildMinimap();
    this.labelEls = new Map();

    addEventListener('keydown', (e) => {
      if (this.state === 'title' || this.state === 'loading') return;
      const typing = e.target.tagName === 'INPUT';
      if (e.code === 'Enter' && this.state === 'explore') {
        const inp = this.hud.chatIn;
        if (inp.classList.contains('hidden')) { inp.classList.remove('hidden'); inp.focus(); this.input.enabled = false; document.exitPointerLock?.(); e.preventDefault(); }
        else { this.sendChat(inp.value); inp.value = ''; inp.classList.add('hidden'); inp.blur(); this.input.enabled = true; }
        return;
      }
      if (e.code === 'Escape' && typing) { this.hud.chatIn.classList.add('hidden'); this.hud.chatIn.blur(); this.input.enabled = true; return; }
      if (typing) return;
      if (this.state !== 'explore') return;
      if (e.code === 'KeyE') this.interact();
      if (e.code === 'KeyF') this.challenge();
      if (e.code === 'Tab') { e.preventDefault(); this.openDeck(); }
      if (e.code === 'KeyN') ui.querySelector('[data-b=mute]').click();
      if (e.code === 'KeyM') this.openMap();
      if (e.code === 'KeyR') this.toggleMount();
      if (e.code === 'KeyH') this.openHelp();
    });

    if (matchMedia('(pointer: coarse)').matches) {
      ui.insertAdjacentHTML('beforeend', '<div class="joystick hidden"><div></div></div><div class="mobile-btns"><button data-m="ride">ride</button><button data-m="e">act</button><button data-m="jump">jump</button></div>');
      ui.querySelector('[data-m=ride]').onclick = () => this.toggleMount();
      const joy = ui.querySelector('.joystick');
      this.input.onJoy = (j) => {
        joy.classList.toggle('hidden', !j.active);
        joy.style.left = `${j.ox}px`; joy.style.top = `${j.oy}px`;
        joy.firstElementChild.style.transform = `translate(${j.x * 32}px, ${j.y * 32}px)`;
      };
      ui.querySelector('[data-m=e]').onclick = () => { if (this.state === 'explore') { if (!this.interact()) this.challenge(); } };
      ui.querySelector('[data-m=jump]').onclick = () => { this.input.jumpQueued = true; };
    }
  }

  setHudVisible(v) {
    for (const k of ['tl', 'tr', 'br']) this.hud[k].classList.toggle('hidden', !v);
    document.body.classList.toggle('in-battle', !v);
  }

  toast(text) {
    const box = this.ui.querySelector('.toasts');
    if (!box) return;
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = text;
    box.appendChild(d);
    setTimeout(() => d.remove(), 3300);
  }

  buildMinimap() {
    const m = this.world.terrain.map;
    const base = document.createElement('canvas');
    base.width = base.height = m.res;
    const g = base.getContext('2d');
    const img = g.createImageData(m.res, m.res);
    for (let k = 0; k < m.res * m.res; k++) {
      const h = m.h[k];
      if (h < 0) {
        const d = Math.min(1, -h / 12);
        const lava = m.water[k] > 0.75, swamp = m.water[k] > 0.25 && !lava;
        img.data[k * 4] = lava ? 230 : swamp ? 90 : 70 - d * 40;
        img.data[k * 4 + 1] = lava ? 90 : swamp ? 100 : 180 - d * 90;
        img.data[k * 4 + 2] = lava ? 30 : swamp ? 50 : 200 - d * 60;
      } else {
        const shade = 0.85 + Math.min(0.3, h / 300);
        img.data[k * 4] = Math.min(255, m.col[k * 4] * shade);
        img.data[k * 4 + 1] = Math.min(255, m.col[k * 4 + 1] * shade);
        img.data[k * 4 + 2] = Math.min(255, m.col[k * 4 + 2] * shade);
      }
      img.data[k * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // roads
    g.strokeStyle = 'rgba(120, 84, 50, 0.9)';
    g.lineWidth = 1.2;
    const sc = m.res / 8192;
    for (const r of roadSegments()) {
      g.beginPath(); g.moveTo((r.x0 + 4096) * sc, (r.z0 + 4096) * sc); g.lineTo((r.x1 + 4096) * sc, (r.z1 + 4096) * sc); g.stroke();
    }
    this.mapBase = base;
  }

  drawMinimap() {
    const cv = this.hud.map;
    const g = cv.getContext('2d');
    const S = cv.width;
    const span = 900; // meters across the minimap
    const m = this.world.terrain.map;
    const sc = m.res / 8192;
    const p = this.player.pos;
    g.save();
    g.imageSmoothingEnabled = true;
    g.drawImage(this.mapBase, (p.x - span / 2 + 4096) * sc, (p.z - span / 2 + 4096) * sc, span * sc, span * sc, 0, 0, S, S);
    const toMap = (x, z) => [((x - p.x) / span + 0.5) * S, ((z - p.z) / span + 0.5) * S];
    for (const h of this.world.hubs) {
      const [x, z] = toMap(h.pos.x, h.pos.z);
      if (x < -10 || z < -10 || x > S + 10 || z > S + 10) continue;
      g.fillStyle = this.profile.discovered.includes(h.zone.id) ? '#8fd8ff' : '#ffcf5a';
      g.strokeStyle = '#1b1430'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, z, 4.5, 0, 7); g.fill(); g.stroke();
    }
    for (const c of this.creatures.list) {
      if (!c.obj?.holder.visible) continue;
      const [x, z] = toMap(c.pos.x, c.pos.z);
      g.fillStyle = c.boss ? '#ff4d5e' : EL[CREATURES[c.species].el].color;
      g.beginPath(); g.arc(x, z, c.boss ? 4 : 2.2, 0, 7); g.fill();
    }
    for (const r of this.remotes.map.values()) {
      const [x, z] = toMap(r.pos.x, r.pos.z);
      g.fillStyle = r.state.c || '#fff';
      g.strokeStyle = '#fff'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, z, 3.5, 0, 7); g.fill(); g.stroke();
    }
    g.translate(S / 2, S / 2);
    g.rotate(-this.player.facing + Math.PI);
    g.fillStyle = '#fff'; g.strokeStyle = '#1b1430'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(0, 2); g.lineTo(-5, 5); g.closePath(); g.stroke(); g.fill();
    g.restore();
  }

  openMap(travelFrom = null) {
    if (this.state !== 'explore') return;
    this.state = 'menu';
    worldMapScreen({
      base: this.mapBase,
      hubs: this.world.hubs,
      zones: ZONES,
      discovered: this.profile.discovered,
      player: this.player.pos,
      facing: this.player.facing,
      others: [...this.remotes.map.values()].map((r) => ({ x: r.pos.x, z: r.pos.z, c: r.state.c, n: r.state.n })),
      level: this.profile.level,
      travelFrom,
      onTravel: async (hub) => {
        sfx('heal');
        await this.teleport(hub.waystone.x + 2.5, hub.waystone.z + 3, `to ${hub.zone.hubName}`);
        this.toast(`you arrive at ${hub.zone.hubName}`);
      },
      onClose: () => { if (this.state === 'menu') this.state = 'explore'; },
    });
  }

  async toggleMount() {
    if (this.state !== 'explore') return;
    const on = await this.player.toggleMount();
    sfx(on ? 'encounter' : 'tick');
  }

  updateHUD() {
    const p = this.profile;
    this.hud.name.textContent = p.name;
    this.hud.name.style.color = p.color;
    this.hud.hp.style.width = `${(p.hp / p.maxHp) * 100}%`;
    this.hud.hpn.textContent = `${p.hp}/${p.maxHp}`;
    this.hud.gold.textContent = `${p.gold} gold`;
    const pos = this.player.pos;
    const { hub, dist } = this.nearestHub(pos);
    const zone = ZONES[this.world.zoneIdx];
    this.hud.zone.textContent = dist < 40 ? `${hub.zone.hubName} · safe` : `${zone.name} · lv ${zone.levels[0]}–${zone.levels[1]}`;
    this.hud.lvn.textContent = `lv ${p.level}`;
    this.hud.xp.style.width = p.level >= MAX_LEVEL ? '100%' : `${(p.xp / xpToNext(p.level)) * 100}%`;
    if (this.lastZone !== zone.id) {
      if (this.lastZone) this.zoneBanner(zone);
      this.lastZone = zone.id;
    }
    const n = this.net?.count || 0;
    this.hud.online.textContent = `${n + 1} on the isle`;
  }

  updatePrompt() {
    if (this.state !== 'explore') { this.hud.prompt.classList.add('hidden'); return; }
    const it = this.nearInteractable();
    const opp = this.remotes.nearest(this.player.pos, 6);
    let html = '';
    if (it) html = `<kbd>e</kbd>${it.label}`;
    else if (opp) html = `<kbd>f</kbd>challenge ${esc(opp.state.n)} to a duel`;
    this.hud.prompt.classList.toggle('hidden', !html);
    if (html && this.hud.prompt.innerHTML !== html) this.hud.prompt.innerHTML = html;
  }

  nearInteractable() {
    for (const it of this.world.interactables) {
      if (Math.hypot(it.pos.x - this.player.pos.x, it.pos.z - this.player.pos.z) < it.radius) return it;
    }
    return null;
  }

  interact() {
    const it = this.nearInteractable();
    if (!it) return false;
    if (it.id === 'waystone') {
      const id = it.hub.zone.id;
      if (!this.profile.discovered.includes(id)) {
        this.profile.discovered.push(id);
        sfx('win');
        banner(`${it.hub.zone.hubName} waystone attuned`, '#8fd8ff');
        this.save();
      }
      this.player.setAnim('Interact', { once: true, then: () => this.player.setAnim('Idle') });
      setTimeout(() => this.openMap(it.hub), 350);
      return true;
    }
    if (it.id === 'hearth') {
      const p = this.profile;
      if (p.hp < p.maxHp) { p.hp = p.maxHp; sfx('heal'); this.toast('the hearth restores you to full hp'); }
      else this.toast('you feel rested. progress is saved.');
      this.player.setAnim('Interact', { once: true, then: () => this.player.setAnim('Idle') });
      this.save();
    } else if (it.id === 'shop') {
      this.openShop(it.hub);
    } else if (it.id === 'duel') {
      this.toast(this.remotes.map.size ? 'walk up to another player and press f to duel' : 'no one else is here yet — share the link with a friend!');
    }
    return true;
  }

  openShop(hub) {
    this.state = 'menu';
    const mer = this.merchants.find((m) => m.hub === hub);
    mer?.anim.play('Interact', { once: true, then: () => mer.anim.play('Idle') });
    const st = (this.shopStates ||= {});
    const key = hub.zone.id;
    const state = (st[key] ||= {});
    if (state.stockVersion !== this.profile.wins) { state.stock = null; state.stockVersion = this.profile.wins; }
    shopScreen(this.profile, state, {
      sfx,
      title: `${hub.zone.hubName} merchant`,
      maxRarity: hub.zone.levels[0] >= 9 ? 3 : 2,
      priceMult: 1 + hub.zone.levels[0] / 8,
      onChange: () => { this.save(); if (!document.querySelector('.modal-bg')) this.state = 'explore'; },
    });
  }

  zoneBanner(zone) {
    const d = document.createElement('div');
    d.className = 'zonebanner';
    d.innerHTML = `<div class="zn">${zone.name}</div><div class="zl">lv ${zone.levels[0]}–${zone.levels[1]} · ${zone.blurb}</div>`;
    this.ui.appendChild(d);
    setTimeout(() => d.remove(), 4200);
  }

  openDeck() {
    if (this.state !== 'explore') return;
    this.state = 'menu';
    deckScreen(this.profile, { sfx, onChange: () => { this.save(); this.state = 'explore'; } });
  }

  openHelp() {
    if (this.state !== 'explore') return;
    this.state = 'menu';
    modal(`<h2>how to play</h2>
      <div class="howto" style="font-size:16px;opacity:1">
      <p><b>explore.</b> wasd to move, shift to run, space to jump, drag to look, scroll to zoom. on touch: left thumb moves, right thumb looks.</p>
      <p><b>battle.</b> walk into a wild creature. pick up to 5 cards and play a poker hand: pair, two pair, three of a kind, straight, flush (5 of one element), full house, four of a kind, straight flush, five of a kind. each hand has base <span style="color:#7fbfff">chips</span> × <span style="color:#ff8a95">mult</span>; scored cards add their rank in chips. the result is your damage.</p>
      <p><b>elements.</b> tide › ember › grove › volt › tide. if most of your scoring cards beat the enemy's element, ×1.5 mult. if they're weak to it, ×0.75.</p>
      <p><b>grow.</b> win to earn gold and pick a reward: bind the creature as a card (with its own ability), take an enhanced card, or a charm. charms are passive combo engines — the merchant in hearthtown sells more, plus tomes that level up hand types.</p>
      <p><b>danger.</b> creatures attack after each of your hands — watch their intent. creatures get stronger the farther you go from town. rest at the hearth to heal. if you faint, you lose half your gold.</p>
      <p><b>duel.</b> walk up to another player and press f. both play 4 hands from your own decks; highest total score wins.</p>
      </div>`, { onClose: () => { this.state = 'explore'; } });
  }

  // ---------------------------------------------------------------- labels
  updateLabels() {
    const seen = new Set();
    const v = new THREE.Vector3();
    const place = (key, pos, html, cls = '') => {
      v.copy(pos).project(this.camera);
      if (v.z > 1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) return;
      let el = this.labelEls.get(key);
      if (!el) { el = document.createElement('div'); el.className = `label ${cls}`; this.hud.labels.appendChild(el); this.labelEls.set(key, el); }
      if (el._html !== html) { el.innerHTML = html; el._html = html; }
      el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
      el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
      seen.add(key);
    };
    const now = performance.now();
    for (const r of this.remotes.map.values()) {
      if (!r.holder) continue;
      const bubble = r.bubble && now < r.bubbleUntil ? `<span class="bubble">${esc(r.bubble)}</span>` : '';
      const tag = r.state.b ? ' <span class="lv">⚔</span>' : '';
      place(`p:${r.pid}`, _v.copy(r.pos).setY(r.pos.y + 2.25), `${bubble}<span style="color:${r.state.c}">${esc(r.state.n)}</span>${tag}`);
    }
    if (this.myBubble && now < this.myBubbleUntil) {
      place('me', _v.copy(this.player.pos).setY(this.player.pos.y + 2.25), `<span class="bubble">${esc(this.myBubble)}</span>`);
    }
    if (this.state === 'explore') {
      for (const c of this.creatures.list) {
        if (!c.obj?.holder.visible) continue;
        const d = c.pos.distanceTo(this.player.pos);
        if (d > (c.boss ? 60 : 22)) continue;
        const spec = CREATURES[c.species];
        const lvCls = c.level >= this.profile.level + 5 ? ' style="color:#ff6a78"' : '';
        const nm = c.boss ? `<span style="color:#ffcf5a">☠ ${esc(c.boss)}</span>` : `<span style="color:${EL[spec.el].color}">${spec.name}</span>`;
        place(`c:${c.id}`, _v.copy(c.pos).setY(c.pos.y + 1.5 * spec.scale * (c.boss ? 2.1 : 1) + 0.4), `${c.chase ? '<span class="bang">!</span>' : ''}${nm} <span class="lv"${lvCls}>lv ${c.level}</span>`, 'creature');
      }
    }
    for (const [k, el] of this.labelEls) if (!seen.has(k)) { el.remove(); this.labelEls.delete(k); }
  }

  // ---------------------------------------------------------------- chat
  sendChat(text) {
    text = text.trim().slice(0, 120);
    if (!text) return;
    this.net.send('chat', { text });
    this.addChat(this.profile.name, this.profile.color, text);
    this.myBubble = text;
    this.myBubbleUntil = performance.now() + 6000;
  }
  addChat(name, color, text) {
    const d = document.createElement('div');
    d.innerHTML = `<b style="color:${color}">${esc(name)}</b> ${esc(text)}`;
    this.hud.chatLog.appendChild(d);
    while (this.hud.chatLog.children.length > 8) this.hud.chatLog.firstChild.remove();
    setTimeout(() => { d.style.transition = 'opacity 1s'; d.style.opacity = '0'; setTimeout(() => d.remove(), 1000); }, 25000);
  }

  // ---------------------------------------------------------------- network
  setupNet() {
    const net = this.net;
    net.on('st', (s, pid) => this.remotes.upsert(pid, s));
    net.on('leave', (pid) => {
      const r = this.remotes.map.get(pid);
      if (r) this.toast(`${r.state.n} left the isle`);
      this.remotes.remove(pid);
      if (this.duel && this.duel.opp === pid) this.finishDuel(true);
    });
    net.on('join', () => this.sendState(true));
    net.on('chat', (d, pid) => {
      const r = this.remotes.map.get(pid);
      if (!r) return;
      this.addChat(r.state.n, r.state.c, String(d.text).slice(0, 120));
      this.remotes.say(pid, String(d.text).slice(0, 120));
    });
    net.on('kill', (d) => {
      if (typeof d?.id === 'string' && typeof d.until === 'number') this.creatures.markDefeated(d.id, Math.min(d.until, sharedTime() + 300));
    });
    net.on('duelReq', (d, pid) => this.onDuelRequest(d, pid));
    net.on('duelAns', (d, pid) => this.onDuelAnswer(d, pid));
    net.on('duelScore', (d, pid) => {
      if (!this.duel || this.duel.opp !== pid || d.id !== this.duel.id) return;
      this.duel.oppTotal = d.total;
      this.duel.oppHands = d.handsLeft;
      this.battleUI.setOpponent({ name: this.duel.oppName, total: d.total, handsLeft: d.handsLeft });
      const r = this.remotes.map.get(pid);
      if (r?.holder) {
        this.projectile(r.pos.clone().setY(r.pos.y + 1.4), this.player.pos.clone().setY(this.player.pos.y + 1.1), d.el ? EL[d.el].color : '#ffffff').then(() => this.burst(this.player.pos.clone().setY(this.player.pos.y + 1), d.el ? EL[d.el].color : '#ffffff', 16));
        r.anim?.play('Spellcast_Shoot', { once: true });
      }
    });
    net.on('duelDone', (d, pid) => {
      if (!this.duel || this.duel.opp !== pid || d.id !== this.duel.id) return;
      this.duel.oppTotal = d.total;
      this.duel.oppHands = 0;
      this.duel.oppDone = true;
      this.battleUI.setOpponent({ name: this.duel.oppName, total: d.total, handsLeft: 0 });
      if (this.duel.meDone) this.finishDuel(false);
    });
  }

  sendState(force = false) {
    if (!this.net || this.state === 'title') return;
    const now = performance.now();
    if (!force && now - this.lastSend < 110) return;
    this.lastSend = now;
    const p = this.player;
    this.net.send('st', {
      x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2), f: +p.facing.toFixed(2),
      a: p.animName, m: p.model, n: this.profile.name, c: this.profile.color, r: p.mount ? 1 : 0, l: this.profile.level,
      b: this.state === 'battle' || this.state === 'duel' ? 1 : 0,
    });
  }

  // ---------------------------------------------------------------- fx
  projectile(from, to, color, dur = 0.45) {
    return new Promise((resolve) => {
      const mat = new THREE.SpriteMaterial({ map: getGlowTex(), color: new THREE.Color(color).multiplyScalar(3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      const s = new THREE.Sprite(mat);
      s.scale.setScalar(0.9);
      this.scene.add(s);
      const light = new THREE.PointLight(color, 8, 8, 2);
      this.scene.add(light);
      let t = 0, trailT = 0;
      this.fx.push((dt) => {
        t += dt / dur;
        const k = Math.min(1, t);
        s.position.lerpVectors(from, to, k);
        s.position.y += Math.sin(k * Math.PI) * 1.2;
        light.position.copy(s.position);
        trailT += dt;
        if (trailT > 0.016) { trailT = 0; this.spark(s.position, color, 0.45, 0.35); }
        if (k >= 1) { this.scene.remove(s); this.scene.remove(light); mat.dispose(); resolve(); return false; }
        return true;
      });
    });
  }

  spark(pos, color, size, life, vel = null) {
    const mat = new THREE.SpriteMaterial({ map: getGlowTex(), color: new THREE.Color(color).multiplyScalar(2.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    s.scale.setScalar(size);
    this.scene.add(s);
    let t = 0;
    const v = vel || new THREE.Vector3();
    this.fx.push((dt) => {
      t += dt;
      const k = t / life;
      s.position.addScaledVector(v, dt);
      v.y -= dt * 4;
      v.multiplyScalar(1 - dt * 2);
      s.scale.setScalar(size * (1 - k));
      mat.opacity = 1 - k;
      if (k >= 1) { this.scene.remove(s); mat.dispose(); return false; }
      return true;
    });
  }

  burst(pos, color, n = 24, speed = 6) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.6));
      this.spark(pos, color, 0.35 + Math.random() * 0.3, 0.5 + Math.random() * 0.4, v);
    }
  }

  tween(dur, fn) {
    return new Promise((resolve) => {
      let t = 0;
      this.fx.push((dt) => {
        t += dt;
        const k = Math.min(1, t / dur);
        fn(k);
        if (k >= 1) { resolve(); return false; }
        return true;
      });
    });
  }

  shake(amount) { this.shakeAmt = Math.max(this.shakeAmt || 0, amount); }

  flash(color, a = 0.35) {
    const u = this.composer.grade.uniforms.uFlash.value;
    const c = new THREE.Color(color);
    u.set(c.r, c.g, c.b, a);
  }

  screenPos(v3) {
    const v = v3.clone().project(this.camera);
    return [(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight];
  }

  // ---------------------------------------------------------------- battle
  battleHooks() {
    return {
      sfx,
      playerAttack: async (res) => {
        const b = this.battle;
        const c = this.engaged;
        const color = res.el ? EL[res.el].color : '#fff6d8';
        this.player.setAnim('Spellcast_Shoot', { once: true, fade: 0.1, then: () => this.player.setAnim('Idle') });
        sfx('cast');
        await sleep(280);
        const from = this.player.pos.clone().add(new THREE.Vector3(0, 1.4, 0)).addScaledVector(this.battleDir, 0.6);
        const to = c.pos.clone().add(new THREE.Vector3(0, 0.8 * CREATURES[c.species].scale, 0));
        await this.projectile(from, to, color);
        sfx('hit');
        this.burst(to, color, 30 + Math.min(40, Math.log10(res.total + 1) * 10), 7);
        this.shake(Math.min(0.6, 0.1 + Math.log10(res.total + 1) * 0.12));
        const [x, y] = this.screenPos(to);
        floatText(res.total.toLocaleString(), x, y - 30, 'dmg');
        if (res.matchup > 1) floatText('super effective!', x, y - 90, 'gold');
        else if (res.matchup < 1) floatText('resisted…', x, y - 90, 'heal');
        this.flashCreature(c, '#ffffff');
        const home = c.pos.clone();
        await this.tween(0.25, (k) => {
          const push = Math.sin(k * Math.PI) * 0.6;
          c.obj.holder.position.copy(home).addScaledVector(this.battleDir, push);
        });
        if (b.enemy.hp <= 0) {
          sfx('win');
          const s0 = c.obj.holder.scale.x;
          await this.tween(0.6, (k) => {
            c.obj.holder.rotation.y += 0.3;
            c.obj.holder.scale.setScalar(s0 * (1 - k));
            c.obj.holder.position.y = home.y + k * 1.2;
          });
          this.burst(to, color, 60, 9);
          this.burst(to, '#ffcf5a', 30, 5);
          c.obj.holder.visible = false;
          c.obj.holder.scale.setScalar(s0);
        } else {
          c.obj.anim.play('gesture-negative', { once: true, then: () => c.obj.anim.play('idle') });
        }
      },
      enemyAttack: async (move) => {
        const c = this.engaged;
        const home = c.pos.clone();
        if (move.dmg > 0) {
          c.obj.anim.play('run');
          await this.tween(0.22, (k) => c.obj.holder.position.copy(home).addScaledVector(this.battleDir, -k * 2.6));
          sfx('hurt');
          this.player.setAnim('Hit_A', { once: true, fade: 0.05, then: () => this.player.setAnim('Idle') });
          this.flash('#ff2040', 0.28);
          this.shake(0.35);
          this.burst(this.player.pos.clone().setY(this.player.pos.y + 1.1), EL[CREATURES[c.species].el].color, 18, 5);
          const [x, y] = this.screenPos(this.player.pos.clone().setY(this.player.pos.y + 2));
          floatText(`-${move.dmg}`, x, y, 'hurt');
          await this.tween(0.3, (k) => c.obj.holder.position.copy(home).addScaledVector(this.battleDir, -(1 - k) * 2.6));
          c.obj.anim.play('idle');
        } else {
          c.obj.anim.play('gesture-positive', { once: true, then: () => c.obj.anim.play('idle') });
          this.burst(home.clone().setY(home.y + 1), EL[CREATURES[c.species].el].color, 20, 3);
          await sleep(500);
        }
        const [x, y] = this.screenPos(home.clone().setY(home.y + 1.8));
        move.effects.forEach((e, i) => setTimeout(() => floatText(e, x, y - i * 30, 'mult'), i * 200));
        if (move.effects.length) await sleep(400);
      },
    };
  }

  flashCreature(c, color) {
    const mats = [];
    c.obj.holder.traverse((o) => { if (o.isMesh && o.material.emissive) mats.push(o.material); });
    const orig = mats.map((m) => [m.emissive.clone(), m.emissiveIntensity]);
    mats.forEach((m) => { m.emissive.set(color); m.emissiveIntensity = 1.2; });
    setTimeout(() => mats.forEach((m, i) => { m.emissive.copy(orig[i][0]); m.emissiveIntensity = orig[i][1]; }), 120);
  }

  startBattle(c) {
    if (this.state !== 'explore') return;
    this.state = 'battle';
    document.exitPointerLock?.();
    this.closeChat();
    if (this.player.mount) this.player.toggleMount(false);
    this.engaged = c;
    this.creatures.engagedId = c.id;
    c.chase = null;
    // give the engaged creature its own materials so hit flashes don't affect others
    c.obj.holder.traverse((o) => { if (o.isMesh && !o.userData.own) { o.material = o.material.clone(); o.userData.own = true; } });
    const p = this.player;
    p.locked = true;
    const dir = new THREE.Vector3(c.pos.x - p.pos.x, 0, c.pos.z - p.pos.z);
    if (dir.lengthSq() < 0.01) dir.set(Math.sin(p.facing), 0, Math.cos(p.facing));
    dir.normalize();
    const spec = CREATURES[c.species];
    // prefer a flat, open spot for the creature so the fight reads well on camera
    const T = this.world.terrain;
    const D = 4.2 + spec.scale * (c.boss ? 2.4 : 1);
    for (const off of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.7, -1.7, 2.3, -2.3, Math.PI]) {
      const d2 = dir.clone().applyAxisAngle(_up, off);
      const q = p.pos.clone().addScaledVector(d2, D);
      const mid = p.pos.clone().addScaledVector(d2, D / 2);
      if (Math.abs(T.heightAt(q.x, q.z) - p.pos.y) < 1.0 && Math.abs(T.heightAt(mid.x, mid.z) - p.pos.y) < 0.8
        && T.heightAt(q.x, q.z) > 0.2 && !this.world.colliders.near(q.x, q.z, 1.2)) { dir.copy(d2); break; }
    }
    this.battleDir = dir;
    c.pos.copy(p.pos).addScaledVector(dir, D);
    c.pos.y = this.world.terrain.heightAt(c.pos.x, c.pos.z);
    c.obj.holder.position.copy(c.pos);
    c.facing = Math.atan2(-dir.x, -dir.z);
    c.obj.holder.rotation.y = c.facing;
    p.facing = Math.atan2(dir.x, dir.z);
    p.setAnim('Idle');
    c.obj.anim.play('idle');
    this.frameBattle(p.pos, c.pos, dir, spec.scale * (c.boss ? 2.1 : 1));
    this.setHudVisible(false);
    sfx('encounter');
    banner(c.boss ? c.boss : `wild ${spec.name}!`, c.boss ? '#ffcf5a' : EL[spec.el].color);
    const stats = enemyStats(c.species, c.level, !!c.boss);
    this.battle = new Battle({ profile: this.profile, enemy: { id: c.id, species: c.species, level: c.level, hp: stats.hp, atk: stats.atk, boss: c.boss || null } });
    setTimeout(() => {
      if (this.state !== 'battle') return;
      this.battleUI.open(this.battle, {
        name: this.profile.name,
        onWin: () => this.winBattle(),
        onLose: () => this.loseBattle(),
        onFlee: () => this.flee(),
      });
    }, 700);
  }

  // search for a camera that shows both fighters clear of the ui and of trees
  frameBattle(a, b, dir, bigness = 1) {
    const t = this.world.terrain;
    const col = this.world.colliders;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const look = mid.clone().setY(mid.y + 0.9);
    const side = new THREE.Vector3(dir.z, 0, -dir.x);
    const cam = new THREE.PerspectiveCamera(this.camera.fov, this.camera.aspect, 0.1, 500);
    const pa = a.clone().setY(a.y + 1), pb = b.clone().setY(b.y + 0.8);
    let best = null, bestScore = Infinity;
    for (const sgn of [1, -1]) for (let ang = -1.2; ang <= 1.21; ang += 0.15) for (const dist of [5.5, 7.5, 9.5, 11.5]) for (const hgt of [2.2, 3.5, 5, 7]) {
      // orbit around the midpoint, starting from the side view
      const off = side.clone().multiplyScalar(sgn).applyAxisAngle(_up, ang * sgn).multiplyScalar(dist);
      const pos = mid.clone().add(off);
      pos.y = mid.y + hgt;
      const gh = t.heightAt(pos.x, pos.z);
      if (pos.y < gh + 1.2) continue;
      cam.position.copy(pos);
      cam.lookAt(look);
      cam.updateMatrixWorld();
      // shift the framing right to make room for the left-side panels
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
      cam.lookAt(look.clone().addScaledVector(right, -dist * 0.13));
      cam.updateMatrixWorld();
      const sa = pa.clone().project(cam), sb = pb.clone().project(cam);
      let score = 0;
      score += (sa.x - -0.05) ** 2 + (sb.x - 0.42) ** 2;
      score += (sa.y - 0.12) ** 2 + (sb.y - 0.18) ** 2;
      if (Math.abs(sa.x) > 0.8 || Math.abs(sb.x) > 0.8) score += 5;
      if (sa.y < -0.3 || sb.y < -0.3 || sa.y > 0.75 || sb.y > 0.75) score += 5;
      if (sa.x > sb.x - 0.2) score += 2;
      // trees or rocks between the camera and the fighters
      for (const target of [pa, pb]) for (let k = 0.1; k < 0.95; k += 0.08) {
        const q = pos.clone().lerp(target, k);
        if (col.near(q.x, q.z, 0.9)) score += 1.2;
        if (t.heightAt(q.x, q.z) > q.y - 0.2) score += 3;
      }
      if (col.near(pos.x, pos.z, 2.5)) score += 2;
      // never park the camera inside a fighter
      if (pos.distanceTo(pb) < 3.5 + bigness * 2) score += 6;
      if (pos.distanceTo(pa) < 3) score += 6;
      score += dist * 0.01;
      if (score < bestScore) { bestScore = score; this.frameScore = score; best = { pos: pos.clone(), look: look.clone().addScaledVector(right, -dist * 0.13) }; }
    }
    if (!best) best = { pos: mid.clone().addScaledVector(side, 9).setY(mid.y + 5), look };
    this.player.camOverride = best;
  }

  endBattleCommon() {
    this.battleUI.close();
    this.creatures.engagedId = null;
    this.player.locked = false;
    this.player.camOverride = null;
    this.setHudVisible(true);
    this.battle = null;
    this.save();
  }

  winBattle() {
    const c = this.engaged;
    const b = this.battle;
    const { gold } = b.rewards();
    this.profile.gold += gold;
    this.profile.wins++;
    this.profile.bestiary[c.species] = (this.profile.bestiary[c.species] || 0) + 1;
    const until = sharedTime() + (c.boss ? 300 : 75);
    this.creatures.markDefeated(c.id, until);
    this.net?.send('kill', { id: c.id, until });
    const enemy = { ...b.enemy };
    const xp = xpFor(c.level, CREATURES[c.species].tier, !!c.boss);
    const gained = grantXp(this.profile, xp);
    this.endBattleCommon();
    this.state = 'menu';
    this.player.setAnim('Cheer', { once: true, then: () => this.player.setAnim('Idle') });
    banner(c.boss ? `${c.boss} falls!` : 'victory!', '#ffcf5a');
    if (gained) setTimeout(() => { sfx('win'); banner(`level ${this.profile.level}!`, '#8fd8ff'); this.toast(`max hp ${this.profile.maxHp} · charm slots ${this.profile.maxCharms}`); }, 1200);
    setTimeout(() => {
      rewardScreen(this.profile, enemy, gold, xp, (o) => {
        if (o?.kind === 'card' && o.card.creature) this.toast(`${CREATURES[o.card.creature].name} joins your deck`);
        else if (o?.kind === 'charm') this.toast('charm equipped');
        this.state = 'explore';
        this.save();
      });
    }, 900);
  }

  async loseBattle() {
    const c = this.engaged;
    this.ignoreUntil.set(c.id, sharedTime() + 15);
    this.endBattleCommon();
    this.state = 'menu';
    this.player.locked = true;
    this.player.setAnim('Death_A', { once: true });
    sfx('lose');
    banner('you fainted', '#ff8a95');
    await sleep(2200);
    const lost = Math.floor(this.profile.gold / 2);
    this.profile.gold -= lost;
    this.profile.hp = this.profile.maxHp;
    const { hub } = this.nearestHub(this.player.pos, true);
    this.player.locked = false;
    this.player.setAnim('Idle');
    await this.teleport(hub.pos.x + 3, hub.pos.z + 6, 'waking up');
    this.state = 'explore';
    this.toast(`you wake by the ${hub.zone.hubName} hearth${lost ? ` · lost ${lost} gold` : ''}`);
    this.save();
  }

  flee() {
    const b = this.battle;
    const dmg = Math.ceil((b.enemy.intent.dmg || 0) / 2);
    this.profile.hp = Math.max(1, this.profile.hp - dmg);
    this.ignoreUntil.set(this.engaged.id, sharedTime() + 10);
    this.endBattleCommon();
    this.state = 'explore';
    this.toast(dmg ? `you escape, taking ${dmg} damage` : 'you escape');
  }

  // ---------------------------------------------------------------- duels
  challenge() {
    if (this.state !== 'explore') return;
    const opp = this.remotes.nearest(this.player.pos, 6);
    if (!opp) return;
    if (opp.state.b) { this.toast(`${opp.state.n} is busy`); return; }
    const id = Math.random().toString(36).slice(2, 9);
    this.pendingDuel = { id, opp: opp.pid, at: performance.now() };
    this.net.send('duelReq', { id, name: this.profile.name }, opp.pid);
    this.toast(`challenge sent to ${opp.state.n}`);
  }

  async onDuelRequest(d, pid) {
    const r = this.remotes.map.get(pid);
    if (!r || typeof d?.id !== 'string') return;
    if (this.state !== 'explore' || this.duelPrompting) { this.net.send('duelAns', { id: d.id, ok: false }, pid); return; }
    this.duelPrompting = true;
    this.state = 'menu';
    const ok = await confirmScreen('duel!', `<b style="color:${r.state.c}">${esc(r.state.n)}</b> challenges you to a duel. 4 hands each, highest score wins.`);
    this.duelPrompting = false;
    this.state = 'explore';
    this.net.send('duelAns', { id: d.id, ok }, pid);
    if (ok) this.startDuel(d.id, pid);
  }

  onDuelAnswer(d, pid) {
    const pd = this.pendingDuel;
    if (!pd || pd.id !== d?.id || pd.opp !== pid) return;
    this.pendingDuel = null;
    const r = this.remotes.map.get(pid);
    if (!d.ok) { this.toast(`${r?.state.n || 'they'} declined`); return; }
    if (this.state !== 'explore') return;
    this.startDuel(d.id, pid);
  }

  startDuel(id, pid) {
    const r = this.remotes.map.get(pid);
    if (!r) return;
    this.state = 'duel';
    this.duel = { id, opp: pid, oppName: r.state.n, oppTotal: 0, oppHands: 4, meDone: false, oppDone: false };
    const p = this.player;
    p.locked = true;
    const dir = new THREE.Vector3(r.pos.x - p.pos.x, 0, r.pos.z - p.pos.z);
    if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
    dir.normalize();
    this.battleDir = dir;
    p.facing = Math.atan2(dir.x, dir.z);
    p.setAnim('Idle');
    this.frameBattle(p.pos, r.pos, dir);
    this.setHudVisible(false);
    sfx('encounter');
    banner('duel!', '#c77dff');
    document.exitPointerLock?.();
    this.closeChat();
    this.battle = new Battle({ profile: this.profile, mode: 'duel' });
    setTimeout(() => {
      this.battleUI.open(this.battle, {
        name: this.profile.name,
        opponent: { name: r.state.n, total: 0, handsLeft: 4 },
        onScore: (total, handsLeft, res) => {
          this.net.send('duelScore', { id, total, handsLeft, el: res.el }, pid);
          this.player.setAnim('Spellcast_Shoot', { once: true, then: () => this.player.setAnim('Idle') });
          const rr = this.remotes.map.get(pid);
          if (rr) {
            const to = rr.pos.clone().setY(rr.pos.y + 1.1);
            this.projectile(this.player.pos.clone().setY(this.player.pos.y + 1.4), to, res.el ? EL[res.el].color : '#fff').then(() => this.burst(to, res.el ? EL[res.el].color : '#fff', 24));
          }
        },
        onDuelDone: (total) => {
          this.duel.meDone = true;
          this.net.send('duelDone', { id, total }, pid);
          if (this.duel.oppDone) this.finishDuel(false);
          else {
            this.toast('waiting for your opponent…');
            this.duelTimeout = setTimeout(() => this.duel && this.finishDuel(true), 90000);
          }
        },
      });
    }, 700);
  }

  finishDuel(forfeit) {
    const d = this.duel;
    if (!d) return;
    clearTimeout(this.duelTimeout);
    this.duel = null;
    const me = this.battle?.total || 0;
    const them = d.oppTotal;
    this.battleUI.close();
    this.player.locked = false;
    this.player.camOverride = null;
    this.setHudVisible(true);
    this.battle = null;
    this.state = 'explore';
    const win = forfeit || me > them;
    if (win) {
      this.profile.gold += 8;
      this.profile.duelWins++;
      sfx('win');
      banner(forfeit ? 'win by forfeit' : 'you win the duel!', '#ffcf5a');
      this.player.setAnim('Cheer', { once: true, then: () => this.player.setAnim('Idle') });
      this.toast(`+8 gold · ${me.toLocaleString()} vs ${them.toLocaleString()}`);
    } else if (me === them) {
      banner('a draw', '#fbf3e4');
      this.profile.gold += 3;
    } else {
      sfx('lose');
      banner('duel lost', '#ff8a95');
      this.profile.gold += 2;
      this.toast(`${me.toLocaleString()} vs ${them.toLocaleString()} · +2 gold for trying`);
    }
    this.save();
  }

  // ---------------------------------------------------------------- loop
  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    const st = sharedTime();
    this.frame++;

    if (this.state === 'title') {
      // slow orbit over the town behind the title screen
      const a = t * 0.05;
      const c = this.world.hubs[0].pos;
      this.camera.position.set(c.x + Math.sin(a) * 34, c.y + 10, c.z + Math.cos(a) * 34);
      this.camera.lookAt(c.x, c.y, c.z);
      this.world.update(t, dt, _v.set(c.x + Math.sin(a) * 20, c.y, c.z + Math.cos(a) * 20), this.camera);
      this.creatures.peaceful = true;
      this.creatures.update(st, dt, this.camera.position, null);
    } else {
      this.player.update(dt);
      const inTown = this.nearestHub(this.player.pos).dist < 50;
      this.creatures.peaceful = inTown || this.state !== 'explore';
      this.creatures.update(st, dt, this.player.pos, this.creatures.engagedId);
      this.remotes.update(dt);
      this.world.update(t, dt, this.player.pos, this.camera);
      if (this.state === 'explore') {
        const c = this.creatures.touching(this.player.pos, st);
        if (c && !(this.ignoreUntil.get(c.id) > st)) this.startBattle(c);
      }
      this.sendState();
      if (this.hud) {
        this.updateLabels();
        if (this.frame % 6 === 0) { this.updateHUD(); this.updatePrompt(); this.drawMinimap(); }
      }
    }
    // merchants idle nearby and turn to face the player
    for (const mer of this.merchants || []) {
      const m = mer.holder;
      const d = m.position.distanceTo(this.state === 'title' ? this.camera.position : this.player.pos);
      m.visible = d < 200;
      if (d < 90) mer.anim.update(dt);
      if (d < 8 && this.state !== 'title') {
        let da = Math.atan2(this.player.pos.x - m.position.x, this.player.pos.z - m.position.z) - m.rotation.y;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        m.rotation.y += da * Math.min(1, dt * 4);
      }
    }

    this.fx = this.fx.filter((f) => f(dt) !== false);
    if (this.shakeAmt > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmt;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmt;
      this.shakeAmt *= Math.exp(-dt * 10);
    }
    const fl = this.composer.grade.uniforms.uFlash.value;
    fl.w *= Math.exp(-dt * 6);
    this.composer.grade.uniforms.uTime.value = t;
    if (!this.skipRender) this.composer.render();
  }
}

const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
