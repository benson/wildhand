// local player: input, third-person camera, movement over the terrain
import * as THREE from 'three';
import { createCharacter, createPet } from './character.js';
import { CONTINENT_R } from '../world/zones.js';

const WALK = 4.4;
const RUN = 8.2;
const RIDE = 13;
const GALLOP = 20;
const GRAVITY = 24;
const JUMP = 8.5;

export class Input {
  constructor(dom) {
    this.keys = new Set();
    this.yaw = 0.6;
    this.pitch = 0.32;
    this.dist = 9;
    this.dragging = false;
    this.joy = { x: 0, y: 0, active: false, id: null, ox: 0, oy: 0 };
    this.camTouch = null;
    this.enabled = true;
    this.jumpQueued = false;

    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      this.keys.add(e.code);
      if (e.code === 'Space') {
        if (e.target.closest?.('.modal-bg, .title, .battle')) return;
        this.jumpQueued = true; e.preventDefault();
      }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.dragging = false; });

    // click the world to lock the mouse; esc releases it. drag still works if lock is refused.
    this.canLock = () => true;
    this.canMove = () => true;
    dom.addEventListener('mousedown', (e) => {
      this.dragging = true; this.lx = e.clientX; this.ly = e.clientY;
      if (e.button === 0 && this.enabled && this.canLock() && document.pointerLockElement !== dom) {
        dom.requestPointerLock?.()?.catch?.(() => {});
      }
    });
    addEventListener('mouseup', () => { this.dragging = false; });
    addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      let dx, dy;
      if (document.pointerLockElement === dom) { dx = e.movementX * 0.6; dy = e.movementY * 0.6; }
      else if (this.dragging) { dx = e.clientX - this.lx; dy = e.clientY - this.ly; this.lx = e.clientX; this.ly = e.clientY; }
      else return;
      this.yaw -= dx * 0.006;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, -0.15, 1.2);
    });
    dom.addEventListener('wheel', (e) => {
      if (e.ctrlKey) e.preventDefault();
      if (!this.enabled) return;
      this.dist = THREE.MathUtils.clamp(this.dist + e.deltaY * 0.01, 3.5, 22);
    }, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    // touch: left half = joystick, right half = camera
    dom.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.45 && !this.joy.active) {
          Object.assign(this.joy, { active: true, id: t.identifier, ox: t.clientX, oy: t.clientY, x: 0, y: 0 });
          this.onJoy?.(this.joy);
        } else if (!this.camTouch) {
          this.camTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
        }
      }
    }, { passive: true });
    dom.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (this.joy.active && t.identifier === this.joy.id) {
          const dx = t.clientX - this.joy.ox, dy = t.clientY - this.joy.oy;
          const len = Math.min(Math.hypot(dx, dy), 50);
          const a = Math.atan2(dy, dx);
          this.joy.x = (Math.cos(a) * len) / 50;
          this.joy.y = (Math.sin(a) * len) / 50;
          this.onJoy?.(this.joy);
        } else if (this.camTouch && t.identifier === this.camTouch.id) {
          this.yaw -= (t.clientX - this.camTouch.x) * 0.008;
          this.pitch = THREE.MathUtils.clamp(this.pitch + (t.clientY - this.camTouch.y) * 0.005, -0.15, 1.2);
          this.camTouch.x = t.clientX; this.camTouch.y = t.clientY;
        }
      }
    }, { passive: true });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (this.joy.active && t.identifier === this.joy.id) { Object.assign(this.joy, { active: false, x: 0, y: 0 }); this.onJoy?.(this.joy); }
        if (this.camTouch && t.identifier === this.camTouch.id) this.camTouch = null;
      }
    };
    dom.addEventListener('touchend', end);
    dom.addEventListener('touchcancel', end);
  }
  axis() {
    if (!this.enabled || !this.canMove()) return { x: 0, y: 0, run: false };
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (this.joy.active) { x = this.joy.x; y = this.joy.y; }
    const run = k.has('ShiftLeft') || k.has('ShiftRight') || (this.joy.active && Math.hypot(x, y) > 0.85);
    return { x, y, run };
  }
}

export class Player {
  constructor(world, camera, input) {
    this.world = world;
    this.camera = camera;
    this.input = input;
    this.pos = new THREE.Vector3(2, 0, 6);
    this.vy = 0;
    this.facing = 0;
    this.grounded = true;
    this.anim = null;
    this.locked = false; // during battles
    this.camTarget = new THREE.Vector3();
    this.camOverride = null; // { pos, look } for cinematic framing
    this.moving = false;
    this.animName = 'Idle';
  }

  async load(model) {
    if (this.holder) this.world.scene.remove(this.holder);
    const { holder, anim } = await createCharacter(model);
    this.holder = holder;
    this.charRoot = holder.children[0];
    this.mount = null;
    this.anim = anim;
    this.model = model;
    this.world.scene.add(holder);
    this.pos.y = this.world.terrain.heightAt(this.pos.x, this.pos.z);
    this.holder.position.copy(this.pos);
  }

  // ride a big elk for long trips across the continent
  async toggleMount(on = !this.mount) {
    if (!this.holder) return false;
    if (!on) {
      if (this.mount) this.holder.remove(this.mount.root);
      this.mount = null;
      this.charRoot.position.y = 0;
      this.animName = '';
      this.setAnim('Idle');
      return false;
    }
    if (this.mount || this.mounting) return true;
    this.mounting = true;
    const { root, anim } = await createPet('deer', '#b07a4a', 0.12);
    this.mounting = false;
    root.scale.setScalar(1.75);
    this.holder.add(root);
    this.mount = { root, anim };
    this.charRoot.position.set(0, 1.5, -0.2);
    this.animName = '';
    this.setAnim('Sit_Chair_Idle');
    return true;
  }

  setAnim(name, opts) {
    if (!this.anim) return;
    this.anim.play(name, opts);
    this.animName = name;
  }

  update(dt) {
    const { terrain, colliders } = this.world;
    const ax = this.input.axis();
    let mx = 0, mz = 0;
    if (!this.locked) {
      const yaw = this.input.yaw;
      // camera-relative movement
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      mx = rx * ax.x - fx * ax.y;
      mz = rz * ax.x - fz * ax.y;
      const len = Math.hypot(mx, mz);
      if (len > 1) { mx /= len; mz /= len; }
    }
    const mag = Math.hypot(mx, mz);
    const speed = (this.mount ? (ax.run ? GALLOP : RIDE) : (ax.run ? RUN : WALK)) * Math.min(1, mag);
    this.moving = mag > 0.1;
    if (this.moving) {
      const target = Math.atan2(mx, mz);
      let d = target - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * Math.min(1, dt * 12);
    }
    const next = this.pos.clone();
    next.x += (mx / (mag || 1)) * speed * dt;
    next.z += (mz / (mag || 1)) * speed * dt;
    colliders.resolve(next, 0.4);
    // keep out of deep water and inside the world
    const nh = terrain.heightAt(next.x, next.z);
    const r = Math.hypot(next.x, next.z);
    if (nh > -0.9 && r < CONTINENT_R * 1.3) { this.pos.x = next.x; this.pos.z = next.z; }

    const ground = Math.max(terrain.heightAt(this.pos.x, this.pos.z), -0.6);
    if (this.input.jumpQueued && this.grounded && !this.locked && this.input.canMove()) {
      this.vy = JUMP;
      this.grounded = false;
      this.setAnim('Jump_Full_Short', { once: true, fade: 0.1, speed: 1.4 });
    }
    this.input.jumpQueued = false;
    this.vy -= GRAVITY * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= ground) {
      this.pos.y = ground;
      this.vy = 0;
      this.grounded = true;
    }

    if (this.mount) {
      this.mount.anim.play(this.moving ? (ax.run ? 'run' : 'walk') : 'idle', { speed: this.moving ? (ax.run ? 1.4 : 1.6) : 1 });
      this.mount.anim.update(dt);
      if (this.animName !== 'Sit_Chair_Idle' && !this.locked) this.setAnim('Sit_Chair_Idle');
    } else if (!this.locked && this.anim) {
      const airborne = !this.grounded && this.pos.y > ground + 0.3;
      if (!airborne) {
        if (this.moving) this.setAnim(ax.run ? 'Running_A' : 'Walking_A', { speed: ax.run ? 1.05 : 1.15 });
        else if (this.animName !== 'Cheer' && this.animName !== 'Interact' && this.animName !== 'Sit_Floor_Idle') this.setAnim('Idle');
      }
    }
    if (this.holder) {
      this.holder.position.copy(this.pos);
      this.holder.rotation.y = this.facing;
    }
    this.anim?.update(dt);
    this.updateCamera(dt);
  }

  updateCamera(dt) {
    const cam = this.camera;
    if (this.camOverride) {
      const k = 1 - Math.exp(-dt * 3);
      cam.position.lerp(this.camOverride.pos, k);
      this.camTarget.lerp(this.camOverride.look, k);
      cam.lookAt(this.camTarget);
      return;
    }
    const { yaw, pitch } = this.input;
    const dist = this.input.dist + (this.mount ? 3 : 0);
    const look = new THREE.Vector3(this.pos.x, this.pos.y + (this.mount ? 2.6 : 1.7), this.pos.z);
    const want = new THREE.Vector3(
      look.x + Math.sin(yaw) * Math.cos(pitch) * dist,
      look.y + Math.sin(pitch) * dist,
      look.z + Math.cos(yaw) * Math.cos(pitch) * dist,
    );
    const gh = this.world.terrain.heightAt(want.x, want.z);
    if (want.y < gh + 0.6) want.y = gh + 0.6;
    const k = 1 - Math.exp(-dt * 10);
    cam.position.lerp(want, k);
    this.camTarget.lerp(look, 1 - Math.exp(-dt * 14));
    cam.lookAt(this.camTarget);
  }
}
