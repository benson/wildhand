// other players, driven by network state with interpolation
import * as THREE from 'three';
import { createCharacter } from './character.js';
import { CHAR_MODELS } from '../world/assets.js';

export class Remotes {
  constructor(scene) {
    this.scene = scene;
    this.map = new Map();
  }

  upsert(pid, raw) {
    const s = sanitize(raw);
    if (!s) return null;
    let r = this.map.get(pid);
    if (!r) {
      r = { pid, state: s, pos: new THREE.Vector3(s.x, s.y, s.z), target: new THREE.Vector3(s.x, s.y, s.z), facing: s.f || 0, holder: null, anim: null, model: null, bubble: null, bubbleUntil: 0 };
      this.map.set(pid, r);
    }
    r.state = s;
    r.target.set(s.x, s.y, s.z);
    r.targetFacing = s.f;
    const model = CHAR_MODELS.includes(s.m) ? s.m : 'knight';
    if (r.model !== model && !r.loading) this.load(r, model);
    return r;
  }

  async load(r, model) {
    r.loading = true;
    const { holder, anim } = await createCharacter(model);
    if (!this.map.has(r.pid)) { r.loading = false; return; }
    if (r.holder) this.scene.remove(r.holder);
    r.holder = holder;
    r.anim = anim;
    r.model = model;
    r.loading = false;
    holder.position.copy(r.pos);
    this.scene.add(holder);
  }

  remove(pid) {
    const r = this.map.get(pid);
    if (r?.holder) this.scene.remove(r.holder);
    this.map.delete(pid);
  }

  say(pid, text) {
    const r = this.map.get(pid);
    if (!r) return;
    r.bubble = text;
    r.bubbleUntil = performance.now() + 6000;
  }

  update(dt) {
    for (const r of this.map.values()) {
      // snap if far, else smooth
      if (r.pos.distanceTo(r.target) > 12) r.pos.copy(r.target);
      else r.pos.lerp(r.target, 1 - Math.exp(-dt * 10));
      let d = (r.targetFacing ?? r.facing) - r.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      r.facing += d * Math.min(1, dt * 10);
      if (!r.holder) continue;
      r.holder.position.copy(r.pos);
      r.holder.rotation.y = r.facing;
      const a = r.state.a;
      if (a && r.anim.has(a)) r.anim.play(a);
      r.anim.update(dt);
    }
  }

  nearest(pos, range) {
    let best = null, bd = range;
    for (const r of this.map.values()) {
      const d = r.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }
}

const num = (v, lim) => (Number.isFinite(v) && Math.abs(v) < lim ? v : 0);
function sanitize(s) {
  if (!s || typeof s !== 'object') return null;
  return {
    x: num(s.x, 1000), y: num(s.y, 200), z: num(s.z, 1000), f: num(s.f, 100),
    a: typeof s.a === 'string' ? s.a.slice(0, 32) : 'Idle',
    m: typeof s.m === 'string' ? s.m : 'knight',
    n: typeof s.n === 'string' ? s.n.slice(0, 16) : 'wanderer',
    c: typeof s.c === 'string' && /^#[0-9a-f]{6}$/i.test(s.c) ? s.c : '#ffffff',
    b: s.b ? 1 : 0,
  };
}
