// roaming wild creatures. positions are a pure function of (spawn seed, shared clock),
// so every client sees the same creature in the same place without a server.
import * as THREE from 'three';
import { CREATURES, EL } from '../cards/data.js';
import { mulberry32 } from '../cards/profile.js';
import { createPet } from './character.js';

const SEG = 11; // seconds per wander segment
const MOVE = 4.5; // seconds spent walking in each segment

export const HP_GROWTH = 1.221;
export function enemyStats(species, level, boss = false) {
  const s = CREATURES[species];
  return {
    hp: Math.round(220 * s.hp * Math.pow(HP_GROWTH, level - 1) * (boss ? 2.4 : 1)),
    atk: Math.max(2, Math.round((2.5 + 1.25 * level) * s.atk * (boss ? 1.35 : 1))),
  };
}

export class Creatures {
  constructor(world) {
    this.world = world;
    this.list = [];
    this.group = new THREE.Group();
    world.scene.add(this.group);
    this.defeated = new Map(); // id -> respawn time (shared clock seconds)
    this.byId = new Map();
    this.engagedId = null;
    this.ringGeo = new THREE.RingGeometry(0.7, 0.95, 32);
    this.ringGeo.rotateX(-Math.PI / 2);
  }

  // spawns stream in and out with terrain chunks
  addSpawns(key, spawns) {
    for (const sp of spawns) {
      if (this.byId.has(sp.id)) continue;
      const h = this.world.terrain.heightAt(sp.x, sp.z);
      const c = {
        ...sp,
        chunk: key,
        home: new THREE.Vector3(sp.x, h, sp.z),
        obj: null,
        loading: false,
        pos: new THREE.Vector3(sp.x, h, sp.z),
        facing: 0,
        chase: null,
      };
      this.list.push(c);
      this.byId.set(c.id, c);
    }
  }
  removeSpawns(key) {
    this.list = this.list.filter((c) => {
      if (c.chunk !== key || c.id === this.engagedId) return true;
      if (c.obj) this.group.remove(c.obj.holder);
      c.dead = true;
      this.byId.delete(c.id);
      return false;
    });
  }

  // deterministic wander target for segment k
  target(c, k, out) {
    const r = mulberry32(c.seed ^ (k * 2654435761));
    const { terrain } = this.world;
    for (let i = 0; i < 6; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * c.radius;
      const x = c.home.x + Math.cos(a) * d, z = c.home.z + Math.sin(a) * d;
      if (terrain.heightAt(x, z) > 0.4 && terrain.slopeAt(x, z) < 0.35) return out.set(x, 0, z);
    }
    return out.set(c.home.x, 0, c.home.z);
  }

  // where the creature is at shared time t, plus whether it's walking
  sample(c, t, out) {
    const tt = t + (c.seed % 1000) / 1000 * SEG;
    const k = Math.floor(tt / SEG);
    const f = tt - k * SEG;
    const a = this.target(c, k - 1, _a);
    const b = this.target(c, k, _b);
    const u = Math.min(1, f / MOVE);
    const s = u * u * (3 - 2 * u);
    out.lerpVectors(a, b, s);
    out.y = this.world.terrain.heightAt(out.x, out.z);
    return { walking: u < 1, dir: Math.atan2(b.x - a.x, b.z - a.z), eating: f > MOVE + 2 && (k % 3 === 0) };
  }

  isDefeated(c, t) {
    const until = this.defeated.get(c.id);
    if (until && t < until) return true;
    if (until) this.defeated.delete(c.id);
    return false;
  }
  markDefeated(id, until) { this.defeated.set(id, until); }

  async ensureObj(c) {
    if (c.obj || c.loading) return;
    c.loading = true;
    const spec = CREATURES[c.species];
    const { root, anim } = await createPet(spec.model, EL[spec.el].color, c.boss ? 0.42 : 0.28);
    if (c.dead) return;
    const holder = new THREE.Group();
    const s = 1.35 * spec.scale * (c.boss ? 2.1 : 1);
    root.scale.setScalar(s);
    holder.add(root);
    // element ring on the ground
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({
      color: new THREE.Color(EL[spec.el].color).multiplyScalar(spec.tier >= 3 ? 2.2 : 1.4),
      transparent: true, opacity: 0.55, depthWrite: false,
    }));
    ring.position.y = 0.05;
    ring.scale.setScalar(spec.scale * (spec.tier >= 3 ? 1.4 : 1) * (c.boss ? 2.4 : 1));
    holder.add(ring);
    c.obj = { holder, anim, ring };
    c.loading = false;
    this.group.add(holder);
  }

  // t: shared clock seconds. engagedId: creature in battle with us (frozen)
  update(t, dt, playerPos, engagedId) {
    for (const c of this.list) {
      const dist = Math.hypot(c.home.x - playerPos.x, c.home.z - playerPos.z);
      const near = dist < (c.boss ? 140 : 80);
      if (!near) { if (c.obj) c.obj.holder.visible = false; continue; }
      if (!c.obj) { this.ensureObj(c); continue; }
      const dead = this.isDefeated(c, t) && c.id !== engagedId;
      c.obj.holder.visible = !dead;
      if (dead) continue;

      if (c.id === engagedId) {
        c.obj.anim.update(dt);
        continue;
      }
      const st = this.sample(c, t, _p);
      // tier 2+ creatures give chase when you get close; they return home after
      const pd = Math.hypot(c.pos.x - playerPos.x, c.pos.z - playerPos.z);
      const spec = CREATURES[c.species];
      if ((spec.tier >= 2 || c.boss) && pd < (c.boss ? 14 : 9) && !this.peaceful) c.chase = Math.min((c.chase || 0) + dt, 6);
      else if (c.chase) c.chase = Math.max(0, c.chase - dt * 0.5) || null;
      if (c.chase) {
        const dx = playerPos.x - c.pos.x, dz = playerPos.z - c.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        c.pos.x += (dx / len) * 5 * dt;
        c.pos.z += (dz / len) * 5 * dt;
        c.pos.y = this.world.terrain.heightAt(c.pos.x, c.pos.z);
        c.facing = Math.atan2(dx, dz);
        c.obj.anim.play('run');
      } else {
        // ease back onto the shared path
        c.pos.lerp(_p, Math.min(1, dt * 2.5));
        if (st.walking) { c.facing = lerpAngle(c.facing, st.dir, dt * 6); c.obj.anim.play('walk'); }
        else c.obj.anim.play(st.eating ? 'eat' : 'idle');
      }
      c.obj.holder.position.copy(c.pos);
      c.obj.holder.rotation.y = c.facing;
      const shadows = dist < 40;
      if (c.obj.shadows !== shadows) {
        c.obj.shadows = shadows;
        c.obj.holder.traverse((o) => { if (o.isMesh) o.castShadow = shadows; });
      }
      if (dist < 60) c.obj.anim.update(dt);
    }
  }

  // nearest live creature within range of the player
  touching(playerPos, t, range = 1.9) {
    let best = null, bd = Infinity;
    for (const c of this.list) {
      if (!c.obj || !c.obj.holder.visible) continue;
      if (this.isDefeated(c, t)) continue;
      const d = Math.hypot(c.pos.x - playerPos.x, c.pos.z - playerPos.z);
      const s = CREATURES[c.species].scale * (c.boss ? 2.1 : 1);
      if (d < range * s && d < bd) { best = c; bd = d; }
    }
    return best;
  }
}

function lerpAngle(a, b, t) {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a + d * Math.min(1, t);
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _p = new THREE.Vector3();
