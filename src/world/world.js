// assembles the island: lights, sky, terrain, water, grass, trees, props, town
import * as THREE from 'three';
import { Terrain, TOWN_R, POND, RUINS, WORLD_SEED, ISLAND_R, PATHS } from './terrain.js';
import { createSky } from './sky.js';
import { createWater } from './water.js';
import { createGrass } from './grass.js';
import { Forest } from './trees.js';
import { instanceModel, loadStatic } from './assets.js';
import { mulberry32 } from '../cards/profile.js';
import { SKY } from './sky.js';

export const SUN_DIR = new THREE.Vector3(-0.62, 0.5, 0.6).normalize();

// spatial hash of circular colliders
class Colliders {
  constructor() { this.cells = new Map(); this.size = 8; }
  key(i, j) { return i * 10007 + j; }
  add(x, z, r) {
    const i = Math.floor(x / this.size), j = Math.floor(z / this.size);
    const k = this.key(i, j);
    if (!this.cells.has(k)) this.cells.set(k, []);
    this.cells.get(k).push({ x, z, r });
  }
  // push a point out of any colliders it overlaps
  resolve(p, radius) {
    const i0 = Math.floor(p.x / this.size), j0 = Math.floor(p.z / this.size);
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      const list = this.cells.get(this.key(i, j));
      if (!list) continue;
      for (const c of list) {
        const dx = p.x - c.x, dz = p.z - c.z;
        const d = Math.hypot(dx, dz);
        const min = c.r + radius;
        if (d < min && d > 1e-5) { p.x = c.x + (dx / d) * min; p.z = c.z + (dz / d) * min; }
      }
    }
  }
  near(x, z, r) {
    const i0 = Math.floor(x / this.size), j0 = Math.floor(z / this.size);
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      const list = this.cells.get(this.key(i, j));
      if (list) for (const c of list) if (Math.hypot(x - c.x, z - c.z) < c.r + r) return true;
    }
    return false;
  }
}

// camera-facing instanced quads; body sets center/size/vLife from seed (vec4)
export function billboards(count, uniforms, body, frag, extra = '') {
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geo.index = quad.index;
  geo.attributes.position = quad.attributes.position;
  geo.attributes.uv = quad.attributes.uv;
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  geo.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec4 seed; uniform float uTime; ${extra} varying float vLife; varying vec2 vUv;
      void main(){
        vec3 center = vec3(0.0); float size = 1.0; vLife = 0.0;
        ${body}
        vec4 mv = modelViewMatrix * vec4(center, 1.0);
        mv.xy += position.xy * size;
        vUv = uv;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vLife; varying vec2 vUv;
      void main(){ float d = length(vUv - 0.5); float a = smoothstep(0.5, 0.0, d); a *= a;
        ${frag} }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

export class World {
  constructor(scene, quality) {
    this.scene = scene;
    this.quality = quality;
    this.terrain = new Terrain();
    this.colliders = new Colliders();
    this.updatables = [];
    this.interactables = []; // { pos, radius, label, action }
  }

  async build(onProgress = () => {}) {
    const { scene, terrain } = this;
    scene.background = SKY.horizon.clone();
    scene.fog = new THREE.Fog(SKY.fog.clone(), 70, 420);

    // lights
    const hemi = new THREE.HemisphereLight('#a9c4ff', '#7a6248', 1.15);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight('#ffe0bd', 2.9);
    sun.position.copy(SUN_DIR).multiplyScalar(120);
    sun.castShadow = true;
    const sz = 2048;
    sun.shadow.mapSize.set(sz, sz);
    const ext = 55;
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 320 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 3;
    scene.add(sun, sun.target);
    this.sun = sun;

    this.sky = createSky(SUN_DIR);
    scene.add(this.sky);
    onProgress(0.1, 'raising the island');

    scene.add(terrain.buildMesh());
    terrain.buildTextures();
    onProgress(0.3, 'filling the sea');

    this.water = createWater(terrain, SUN_DIR);
    scene.add(this.water);

    this.grass = createGrass(terrain, { count: this.quality.grass, patch: this.quality.grassPatch });
    scene.add(this.grass);
    onProgress(0.4, 'growing trees');

    this.forest = new Forest();
    scene.add(this.forest.build(this.placeTrees()));
    onProgress(0.55, 'placing stones');

    await this.placeProps();
    onProgress(0.75, 'building the town');
    await this.buildTown();
    await this.buildRuins();
    this.addMotes();
    onProgress(0.85, 'waking creatures');
  }

  placeTrees() {
    const { terrain } = this;
    const rng = mulberry32(WORLD_SEED + 99);
    const out = [];
    const tint = (hex, j = 0.08) => {
      const c = new THREE.Color(hex);
      c.offsetHSL((rng() - 0.5) * 0.03, (rng() - 0.5) * 0.1, (rng() - 0.5) * j);
      return c;
    };
    const tries = 26000;
    for (let i = 0; i < tries; i++) {
      const x = (rng() - 0.5) * ISLAND_R * 2.1, z = (rng() - 0.5) * ISLAND_R * 2.1;
      const h = terrain.heightAt(x, z);
      if (h < 2.2) continue;
      const r = Math.hypot(x, z);
      if (r < TOWN_R + 6) continue;
      if (terrain.pathAt(x, z) < 4.5) continue;
      if (terrain.slopeAt(x, z) > 0.28) continue;
      if (Math.hypot(x - RUINS.x, z - RUINS.z) < 22) continue;
      const biome = terrain.biomeAt(x, z);
      let p = 0;
      let kind = 'oak';
      if (biome === 'forest') { p = 0.5; kind = rng() < 0.7 ? 'oak' : 'birch'; }
      else if (biome === 'meadow') { p = 0.045; kind = rng() < 0.55 ? 'oak' : (rng() < 0.5 ? 'birch' : 'bush'); }
      else if (biome === 'highland') { p = h > 30 ? 0.01 : 0.12; kind = rng() < 0.8 ? 'pine' : 'bush'; }
      if (rng() > p) continue;
      if (this.colliders.near(x, z, kind === 'bush' ? 1.5 : 3.2)) continue;
      const s = kind === 'bush' ? 0.8 + rng() * 0.6 : 0.85 + rng() * 0.5;
      let color;
      if (kind === 'pine') color = tint('#3f7f4f');
      else if (kind === 'birch') color = rng() < 0.25 ? tint('#e8b84a') : tint('#8fc25a');
      else if (biome === 'forest') color = rng() < 0.12 ? tint('#d9783f') : tint('#4f9a45');
      else color = rng() < 0.15 ? tint('#f2a7b8', 0.04) : tint('#6fb04c');
      out.push({ kind, x, y: h, z, s, rot: rng() * Math.PI * 2, color, variant: Math.floor(rng() * 3) });
      if (kind !== 'bush') this.colliders.add(x, z, 0.45 * s);
    }
    this.treeCount = out.length;
    return out;
  }

  // scatter kenney props in each biome
  async placeProps() {
    const { terrain } = this;
    const rng = mulberry32(WORLD_SEED + 7);
    const sets = {};
    const add = (name, x, z, s = 1, rot = rng() * Math.PI * 2, sink = 0.05, collide = 0) => {
      const y = terrain.heightAt(x, z) - sink;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(s, s, s));
      (sets[name] ||= []).push(m);
      if (collide) this.colliders.add(x, z, collide * s);
    };
    const rocks = ['rock_largeA', 'rock_largeB', 'rock_largeC', 'rock_largeD'];
    const stones = ['stone_largeA', 'stone_largeB', 'stone_tallA', 'stone_tallB'];
    const small = ['rock_smallA', 'rock_smallB', 'rock_smallC'];
    const flowers = ['flower_purpleA', 'flower_redA', 'flower_yellowA', 'flower_purpleB', 'flower_yellowB'];
    const shrooms = ['mushroom_red', 'mushroom_redGroup', 'mushroom_tanGroup'];
    for (let i = 0; i < 16000; i++) {
      const x = (rng() - 0.5) * ISLAND_R * 2.1, z = (rng() - 0.5) * ISLAND_R * 2.1;
      const h = terrain.heightAt(x, z);
      if (h < 0.4) continue;
      const r = Math.hypot(x, z);
      if (r < TOWN_R + 2) continue;
      const pd = terrain.pathAt(x, z);
      if (pd < 2.5) continue;
      const biome = terrain.biomeAt(x, z);
      const slope = terrain.slopeAt(x, z);
      const roll = rng();
      if (biome === 'highland') {
        if (roll < 0.05) add(stones[Math.floor(rng() * 4)], x, z, 2 + rng() * 3, undefined, 0.4, 0.9);
        else if (roll < 0.09) add(small[Math.floor(rng() * 3)], x, z, 1.5 + rng() * 2);
      } else if (biome === 'forest') {
        if (roll < 0.02) add(rocks[Math.floor(rng() * 4)], x, z, 1.4 + rng(), undefined, 0.2, 0.8);
        else if (roll < 0.055) add(shrooms[Math.floor(rng() * 3)], x, z, 1.6 + rng());
        else if (roll < 0.065 && slope < 0.15) add(rng() < 0.5 ? 'stump_old' : 'log_large', x, z, 1.5, undefined, 0.05, 0.5);
        else if (roll < 0.08) add('plant_bushDetailed', x, z, 1.6 + rng());
      } else if (biome === 'meadow') {
        if (roll < 0.012) add(rocks[Math.floor(rng() * 4)], x, z, 1.2 + rng() * 1.2, undefined, 0.2, 0.8);
        else if (roll < 0.11) add(flowers[Math.floor(rng() * 5)], x, z, 1.4 + rng() * 0.8);
        else if (roll < 0.118) add('plant_bushLarge', x, z, 1.4 + rng());
      } else if (biome === 'beach') {
        if (roll < 0.02 && h > 0.6) add(small[Math.floor(rng() * 3)], x, z, 1.4 + rng() * 2);
        else if (roll < 0.03 && h > 0.8) {
          add(rng() < 0.5 ? 'tree_palmTall' : 'tree_palmBend', x, z, 2.2 + rng(), undefined, 0.1, 0.25);
        }
      }
    }
    // lily pads on the pond
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2, d = rng() * POND.r * 0.6;
      const x = POND.x + Math.cos(a) * d, z = POND.z + Math.sin(a) * d;
      if (terrain.heightAt(x, z) > -0.5) continue;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0.03, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6), new THREE.Vector3(2, 2, 2));
      (sets.lily_large ||= []).push(m);
    }
    await Promise.all(Object.entries(sets).map(async ([name, mats]) => {
      const g = await instanceModel(name, mats, { shadows: !name.startsWith('flower') && name !== 'lily_large' });
      this.scene.add(g);
    }));
  }

  async put(name, x, z, { s = 1, rot = 0, y = null, collide = 0 } = {}) {
    const o = await loadStatic(name);
    o.position.set(x, y ?? this.terrain.heightAt(x, z), z);
    o.rotation.y = rot;
    o.scale.setScalar(s);
    this.scene.add(o);
    if (collide) this.colliders.add(x, z, collide);
    return o;
  }

  async buildTown() {
    const t = this.terrain;
    const y0 = t.heightAt(0, 0);
    // the hearth: central campfire that heals
    await this.put('campfire_stones', 0, 0, { s: 2.6, collide: 1.3 });
    await this.put('campfire_logs', 0, 0, { s: 2.2 });
    this.fire = this.makeFire(new THREE.Vector3(0, y0 + 0.3, 0));
    this.interactables.push({ id: 'hearth', pos: new THREE.Vector3(0, y0, 0), radius: 4, label: 'rest at the hearth' });

    // log benches around the fire
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      await this.put('log', Math.cos(a) * 4.4, Math.sin(a) * 4.4, { s: 2.4, rot: -a, collide: 0.8 });
    }
    // tents ringing the plaza
    const tents = [[-14, -9, 0.9], [13, 11, 3.9], [3, 19, 2.3], [16, -2, 4.9]];
    for (const [x, z, r] of tents) await this.put('tent_detailedOpen', x, z, { s: 3, rot: r, collide: 2.4 });
    for (const [x, z] of [[-17, 4], [-6, -17], [10, 17.5]]) await this.put('log_stack', x, z, { s: 2.2, rot: Math.random() * 6, collide: 1 });
    for (const [x, z] of [[-4, -19], [19, 6]]) await this.put('pot_large', x, z, { s: 2.2, collide: 0.6 });
    for (const [x, z] of [[6, -18], [-18, -3]]) await this.put('crop_pumpkin', x, z, { s: 2.6 });

    // merchant stall
    this.buildStall(new THREE.Vector3(7, y0, -9), -0.6);
    // duel ring
    this.buildDuelRing(new THREE.Vector3(-9, y0, 9));

    // signposts at path heads
    for (const p of PATHS) {
      const [x, z] = p[1];
      const a = Math.atan2(z, x);
      await this.put('sign', Math.cos(a) * (TOWN_R - 2), Math.sin(a) * (TOWN_R - 2), { s: 2.2, rot: -a + Math.PI / 2 });
    }
    // lanterns
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.2;
      this.lantern(Math.cos(a) * (TOWN_R - 6), Math.sin(a) * (TOWN_R - 6));
    }
  }

  lantern(x, z) {
    const y = this.terrain.heightAt(x, z);
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.6, 6), new THREE.MeshStandardMaterial({ color: '#4a3526', roughness: 0.9 }));
    pole.position.y = 1.3;
    pole.castShadow = true;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.06), pole.material);
    arm.position.set(0.25, 2.5, 0);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshStandardMaterial({ color: '#ffcf7a', emissive: '#ffb347', emissiveIntensity: 3 }));
    lamp.position.set(0.5, 2.3, 0);
    g.add(pole, arm, lamp);
    g.position.set(x, y, z);
    g.rotation.y = Math.random() * 6;
    this.scene.add(g);
    this.colliders.add(x, z, 0.25);
  }

  buildStall(pos, rot) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: '#8a5a3a', roughness: 0.9 });
    const posts = [[-1.8, -1.1], [1.8, -1.1], [-1.8, 1.1], [1.8, 1.1]];
    for (const [x, z] of posts) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3, 6), wood);
      p.position.set(x, 1.5, z);
      p.castShadow = true;
      g.add(p);
    }
    const counter = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1, 0.9), wood);
    counter.position.set(0, 0.5, 1.0);
    counter.castShadow = counter.receiveShadow = true;
    const top = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.1, 1.1), new THREE.MeshStandardMaterial({ color: '#c89a68', roughness: 0.8 }));
    top.position.set(0, 1.03, 1.0);
    g.add(counter, top);
    // striped canopy cloth that ripples
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 8;
    const cx = cv.getContext('2d');
    for (let i = 0; i < 8; i++) { cx.fillStyle = i % 2 ? '#f4e9d4' : '#c8453b'; cx.fillRect(i * 32, 0, 32, 8); }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const cloth = new THREE.PlaneGeometry(4.2, 2.8, 24, 12);
    cloth.rotateX(-Math.PI / 2 + 0.25);
    const cmat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9 });
    const u = { uTime: { value: 0 } };
    cmat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = u.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += sin(position.x * 2.0 + uTime * 2.0) * 0.05 * (1.0 - abs(position.x) / 2.1) + sin(position.z * 3.0 + uTime * 3.1) * 0.03;');
    };
    const canopy = new THREE.Mesh(cloth, cmat);
    canopy.position.set(0, 3.0, 0);
    canopy.castShadow = true;
    g.add(canopy);
    // little card stacks on the counter
    const cardMat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, emissive: c, emissiveIntensity: 0.25 });
    ['#ff6a3d', '#3db8ff', '#6fdc5a', '#ffd23d'].forEach((c, i) => {
      for (let k = 0; k < 4; k++) {
        const card = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.02, 0.5), cardMat(c));
        card.position.set(-1.2 + i * 0.8, 1.1 + k * 0.025, 1.0);
        card.rotation.y = (Math.random() - 0.5) * 0.3;
        g.add(card);
      }
    });
    g.position.copy(pos);
    g.rotation.y = rot;
    this.scene.add(g);
    this.updatables.push((t) => { u.uTime.value = t; });
    const world = new THREE.Vector3(0, 0, 0.0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).add(pos);
    this.colliders.add(world.x, world.z, 2.1);
    this.stall = { pos, rot, merchantPos: new THREE.Vector3(0, 0, -0.3).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).add(pos) };
    const front = new THREE.Vector3(0, 0, 2.6).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).add(pos);
    this.interactables.push({ id: 'shop', pos: front, radius: 3.2, label: 'trade with the merchant' });
  }

  buildDuelRing(pos) {
    const u = { uTime: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: u,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        void main(){
          vec2 p = vUv * 2.0 - 1.0; float r = length(p); float a = atan(p.y, p.x);
          float ring = smoothstep(0.03, 0.0, abs(r - 0.92)) + smoothstep(0.02, 0.0, abs(r - 0.78)) * 0.7;
          float runes = step(0.5, fract(a * 6.0 / 3.14159 + uTime * 0.1)) * smoothstep(0.03, 0.0, abs(r - 0.85)) ;
          float star = smoothstep(0.02, 0.0, abs(r - 0.5 - 0.1 * sin(a * 5.0 + uTime * 0.5)));
          float glow = (ring + runes * 0.8 + star * 0.6) * (0.75 + 0.25 * sin(uTime * 2.0));
          glow += smoothstep(1.0, 0.0, r) * 0.08;
          gl_FragColor = vec4(vec3(0.75, 0.55, 1.0) * glow, glow);
        }`,
    });
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), mat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.copy(pos).add(new THREE.Vector3(0, 0.06, 0));
    this.scene.add(disc);
    this.updatables.push((t) => { u.uTime.value = t; });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.put(i % 2 ? 'statue_columnDamaged' : 'statue_column', pos.x + Math.cos(a) * 5.4, pos.z + Math.sin(a) * 5.4, { s: 2.2, rot: a, collide: 0.6 });
    }
    this.duelRing = pos;
    this.interactables.push({ id: 'duel', pos, radius: 4.5, label: 'duel ring — challenge a nearby player' });
  }

  async buildRuins() {
    const { x, z } = RUINS;
    const cols = 10;
    for (let i = 0; i < cols; i++) {
      const a = (i / cols) * Math.PI * 2;
      const name = i % 3 === 1 ? 'statue_columnDamaged' : 'statue_column';
      if (i === 4) continue;
      await this.put(name, x + Math.cos(a) * 11, z + Math.sin(a) * 11, { s: 3.2, rot: a, collide: 0.8 });
    }
    await this.put('statue_obelisk', x, z, { s: 3.4, collide: 1.2 });
    await this.put('statue_head', x + 5, z - 4, { s: 3, rot: 2.2, collide: 1.2 });
    await this.put('statue_block', x - 6, z + 3, { s: 2.5, rot: 0.4, collide: 1 });
    await this.put('statue_ring', x - 3, z - 7, { s: 2.5, rot: 1.2, collide: 1 });
    this.ruinsLight = this.makeGlow(new THREE.Vector3(x, this.terrain.heightAt(x, z) + 7.5, z), '#b28bff');
  }

  makeGlow(pos, color) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(cv);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.scale.setScalar(5);
    s.position.copy(pos);
    this.scene.add(s);
    this.updatables.push((t) => { s.scale.setScalar(4.5 + Math.sin(t * 1.7) * 0.6); });
    return s;
  }

  makeFire(pos) {
    const u = { uTime: { value: 0 } };
    const pts = billboards(70, u, /* glsl */ `
      float life = fract(uTime * (0.7 + seed.x * 0.6) + seed.y * 7.0);
      vLife = life;
      float a = seed.z * 40.0;
      center.x += sin(a) * 0.55 * (1.0 - life) + sin(uTime * 3.0 + a) * 0.12 * life;
      center.z += cos(a) * 0.55 * (1.0 - life);
      center.y += life * 2.6;
      size = (1.0 - life) * 0.9 + 0.1;`, /* glsl */ `
      vec3 c = mix(vec3(1.0, 0.85, 0.4), vec3(1.0, 0.25, 0.05), vLife);
      gl_FragColor = vec4(c * 2.2, a * (1.0 - vLife));`);
    pts.position.copy(pos);
    this.scene.add(pts);
    const light = new THREE.PointLight('#ff9a4a', 30, 18, 1.6);
    light.position.copy(pos).add(new THREE.Vector3(0, 1.2, 0));
    this.scene.add(light);
    this.updatables.push((t) => {
      u.uTime.value = t;
      light.intensity = 26 + Math.sin(t * 13) * 3 + Math.sin(t * 7.3) * 3;
    });
    return pts;
  }

  // drifting pollen / fireflies around the camera
  addMotes() {
    const u = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() } };
    const pts = billboards(350, u, /* glsl */ `
      vec3 p = (seed.xyz - 0.5) * vec3(60.0, 0.0, 60.0);
      p.y = seed.y * 8.0;
      p.x += sin(uTime * 0.3 + seed.z * 20.0) * 2.0;
      p.y += sin(uTime * 0.5 + seed.x * 20.0) * 0.6;
      p.z += cos(uTime * 0.27 + seed.y * 30.0) * 2.0;
      p.xz = mod(p.xz - uCenter.xz + 30.0, 60.0) - 30.0 + uCenter.xz;
      p.y += uCenter.y - 1.0;
      center = p;
      vLife = 0.5 + 0.5 * sin(uTime * 2.0 + seed.w * 60.0);
      size = 0.06;`, /* glsl */ `
      gl_FragColor = vec4(vec3(1.0, 0.95, 0.7) * 2.0, a * vLife * 0.8);`, 'uniform vec3 uCenter;');
    this.scene.add(pts);
    this.motes = u;
  }

  update(t, dt, playerPos, camera) {
    this.grass.userData.update(t, playerPos, camera);
    this.water.userData.update(t, camera);
    this.forest.update(t);
    this.sky.position.copy(camera.position);
    this.sky.material.uniforms.uTime.value = t;
    this.motes.uTime.value = t;
    this.motes.uCenter.value.copy(playerPos);
    // keep the shadow frustum centered on the player, snapped to texels to avoid shimmer
    const snap = (55 * 2) / 2048;
    const cx = Math.round(playerPos.x / snap) * snap, cz = Math.round(playerPos.z / snap) * snap;
    this.sun.target.position.set(cx, playerPos.y, cz);
    this.sun.position.set(cx, playerPos.y, cz).addScaledVector(SUN_DIR, 150);
    for (const f of this.updatables) f(t, dt);
  }
}
