// animated character wrapper (kaykit adventurers) + kenney pets
import * as THREE from 'three';
import { instantiateSkinned, charUrl, petUrl } from '../world/assets.js';

export class Animated {
  constructor(root, animations) {
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = {};
    for (const clip of animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.current = null;
    this.currentName = '';
  }
  has(name) { return !!this.actions[name]; }
  play(name, { fade = 0.2, once = false, speed = 1, then = null } = {}) {
    const a = this.actions[name];
    if (!a) return;
    if (this.currentName === name && !once) { a.timeScale = speed; return; }
    a.reset();
    a.timeScale = speed;
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = once;
    a.enabled = true;
    if (this.current && this.current !== a) a.crossFadeFrom(this.current, fade, false);
    a.play();
    this.current = a;
    this.currentName = name;
    if (once && then) {
      const onFinish = (e) => {
        if (e.action !== a) return;
        this.mixer.removeEventListener('finished', onFinish);
        if (this.currentName === name) then();
      };
      this.mixer.addEventListener('finished', onFinish);
    }
  }
  update(dt) { this.mixer.update(dt); }
}

export const CHAR_SCALE = 0.72;

export async function createCharacter(model) {
  const { root, animations } = await instantiateSkinned(charUrl(model));
  const holder = new THREE.Group();
  root.scale.setScalar(CHAR_SCALE);
  holder.add(root);
  // soft blob shadow helps ground characters when far from the shadow frustum
  const anim = new Animated(root, animations);
  anim.play('Idle');
  return { holder, anim };
}

const petMatCache = new Map();
export async function createPet(model, tint = null, tintAmount = 0.3) {
  const { root, animations } = await instantiateSkinned(petUrl(model));
  if (tint) {
    const key = `${model}:${tint}:${tintAmount}`;
    root.traverse((o) => {
      if (!o.isMesh) return;
      if (!petMatCache.has(key)) {
        const m = o.material.clone();
        m.color = new THREE.Color('#ffffff').lerp(new THREE.Color(tint), tintAmount);
        m.emissive = new THREE.Color(tint);
        m.emissiveIntensity = 0.06;
        petMatCache.set(key, m);
      }
      o.material = petMatCache.get(key);
    });
  }
  const anim = new Animated(root, animations);
  anim.play('idle');
  return { root, anim };
}
