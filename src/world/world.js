// the continent: lights, sky, streamed terrain + flora, water, grass, outposts, zone atmosphere
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Terrain } from './terrain.js';
import { createSky, SKY } from './sky.js';
import { createWater } from './water.js';
import { createGrass } from './grass.js';
import { Forest } from './trees.js';
import { StaticBatcher } from './batcher.js';
import { ZONES, ROADS, ZONE_BY_ID } from './zones.js';
import { hubHeight, zoneWeights } from './gen.js';

export const SUN_DIR = new THREE.Vector3(-0.62, 0.5, 0.6).normalize();

// spatial hash of circular colliders, removable by owner key (chunk)
class Colliders {
  constructor() { this.cells = new Map(); this.size = 8; this.owned = new Map(); }
  key(i, j) { return i * 100003 + j; }
  add(x, z, r, owner = null) {
    const k = this.key(Math.floor(x / this.size), Math.floor(z / this.size));
    if (!this.cells.has(k)) this.cells.set(k, []);
    this.cells.get(k).push({ x, z, r, owner });
    if (owner) { if (!this.owned.has(owner)) this.owned.set(owner, []); this.owned.get(owner).push(k); }
  }
  removeOwner(owner) {
    const ks = this.owned.get(owner);
    if (!ks) return;
    for (const k of new Set(ks)) {
      const list = this.cells.get(k);
      if (!list) continue;
      const kept = list.filter((e) => e.owner !== owner);
      if (kept.length) this.cells.set(k, kept); else this.cells.delete(k);
    }
    this.owned.delete(owner);
  }
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
    fragmentShader: `${extra} varying float vLife; varying vec2 vUv;
      void main(){ float d = length(vUv - 0.5); float a = smoothstep(0.5, 0.0, d); a *= a;
        ${frag} }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

let glowTexture = null;
export function glowTex() {
  if (glowTexture) return glowTexture;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTexture = new THREE.CanvasTexture(cv);
  return glowTexture;
}

const PARTICLES = {
  pollen: { color: [1, 0.95, 0.7], fall: 0, size: 0.06, blink: 1, swirl: 2, bright: 2 },
  fireflies: { color: [0.75, 1, 0.35], fall: 0, size: 0.09, blink: 2.5, swirl: 1.5, bright: 3 },
  snow: { color: [1, 1, 1], fall: -1.8, size: 0.1, blink: 0, swirl: 1.2, bright: 1.2 },
  embers: { color: [1, 0.45, 0.1], fall: 1.4, size: 0.08, blink: 1.5, swirl: 1, bright: 3.5 },
  dust: { color: [0.95, 0.82, 0.62], fall: -0.15, size: 0.05, blink: 0, swirl: 4, bright: 1 },
};

export class World {
  constructor(scene, quality) {
    this.scene = scene;
    this.quality = quality;
    this.terrain = new Terrain(scene, quality);
    this.colliders = new Colliders();
    this.updatables = [];
    this.interactables = []; // { id, hub, pos, radius, label }
    this.hubs = [];
    this.chunkObjs = new Map();
    this.onSpawns = null;
    this.onUnloadSpawns = null;
    this.zoneIdx = 0;
  }

  async build(onProgress = () => {}) {
    const { scene, terrain } = this;
    scene.background = SKY.horizon.clone();
    scene.fog = new THREE.Fog(SKY.fog.clone(), this.quality.fogNear, this.quality.fogFar);

    this.hemi = new THREE.HemisphereLight('#b4c8ff', '#8a7050', 1.3);
    scene.add(this.hemi);
    const sun = new THREE.DirectionalLight('#ffe0bd', 2.9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.quality.shadow, this.quality.shadow);
    const ext = 55;
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 400 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
    this.sun = sun;

    this.sky = createSky(SUN_DIR);
    scene.add(this.sky);

    onProgress(0.05, 'surveying the continent');
    await terrain.loadMap(this.quality.mapRes);
    this.water = createWater(terrain, SUN_DIR);
    this.water.userData.setMap();
    scene.add(this.water);
    this.grass = createGrass(terrain, { count: this.quality.grass, patch: this.quality.grassPatch });
    scene.add(this.grass);
    this.forest = new Forest();
    this.addMotes();

    terrain.on('scatter', (key, c) => this.buildChunkObjects(key, c));
    terrain.on('unload', (key) => this.dropChunkObjects(key));

    onProgress(0.2, 'raising outposts');
    for (let i = 0; i < ZONES.length; i++) await this.buildHub(i);
    this.hubLight = new THREE.PointLight('#ff9a4a', 30, 20, 1.6);
    scene.add(this.hubLight);
  }

  // wait until the ground and flora around p exist (used at spawn and after teleporting)
  async settle(p, onProgress = () => {}) {
    const start = performance.now();
    for (;;) {
      this.terrain.update(p);
      const left = this.terrain.pendingNear(p, 170);
      onProgress(left);
      if (left === 0 || performance.now() - start > 20000) break;
      await new Promise((r) => setTimeout(r, 60));
    }
    this.terrain.buildWindow(p);
  }

  async buildChunkObjects(key, c) {
    const entry = { trees: null, props: null, alive: true };
    this.chunkObjs.set(key, entry);
    if (c.trees.length) {
      entry.trees = this.forest.buildChunk(c.trees);
      this.scene.add(entry.trees);
      for (const t of c.trees) if (t[0] !== 'bush') this.colliders.add(t[1], t[3], 0.45 * t[4], key);
    }
    if (c.spawns.length) this.onSpawns?.(key, c.spawns);
    if (c.props.length) {
      const b = new StaticBatcher();
      const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      for (const [name, x, y, z, s, rot, col, shadow, tint] of c.props) {
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, rot), new THREE.Vector3(s, s, s));
        b.add(name, m, !!shadow, tint);
        if (col) this.colliders.add(x, z, col * s, key);
      }
      const g = await b.build();
      if (!entry.alive) { disposeGroup(g); return; }
      entry.props = g;
      this.scene.add(g);
    }
  }

  dropChunkObjects(key) {
    const e = this.chunkObjs.get(key);
    if (!e) return;
    e.alive = false;
    if (e.trees) { this.scene.remove(e.trees); disposeGroup(e.trees); }
    if (e.props) { this.scene.remove(e.props); disposeGroup(e.props); }
    this.colliders.removeOwner(key);
    this.onUnloadSpawns?.(key);
    this.chunkObjs.delete(key);
  }

  // ---------------------------------------------------------------- outposts
  async buildHub(i) {
    const zone = ZONES[i];
    const [hx, hz] = zone.hub;
    const y = hubHeight(i);
    const big = zone.id === 'hearthvale';
    const b = new StaticBatcher();
    const up = new THREE.Vector3(0, 1, 0);
    const put = (name, dx, dz, { s = 1, rot = 0, collide = 0, shadow = true } = {}) => {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(hx + dx, y, hz + dz), new THREE.Quaternion().setFromAxisAngle(up, rot), new THREE.Vector3(s, s, s));
      b.add(name, m, shadow);
      if (collide) this.colliders.add(hx + dx, hz + dz, collide);
    };
    put('campfire_stones', 0, 0, { s: 2.6, collide: 1.3 });
    put('campfire_logs', 0, 0, { s: 2.2 });
    const firePos = new THREE.Vector3(hx, y + 0.3, hz);
    const fire = this.makeFire(firePos);
    const benches = big ? 4 : 3;
    for (let k = 0; k < benches; k++) {
      const a = k * (Math.PI * 2 / benches) + Math.PI / 4;
      put('log', Math.cos(a) * 4.4, Math.sin(a) * 4.4, { s: 2.4, rot: -a, collide: 0.8 });
    }
    const R = big ? 17 : 12;
    const tents = big ? [[-14, -9, 0.9], [13, 11, 3.9], [3, 19, 2.3], [16, -2, 4.9]] : [[-11, 6, 1.2], [10, 9, 3.6]];
    for (const [x, z, r] of tents) put('tent_detailedOpen', x, z, { s: 3, rot: r, collide: 2.4 });
    if (big) {
      for (const [x, z] of [[-17, 4], [-6, -17], [10, 17.5]]) put('log_stack', x, z, { s: 2.2, rot: x, collide: 1 });
      for (const [x, z] of [[-4, -19], [19, 6]]) put('pot_large', x, z, { s: 2.2, collide: 0.6 });
      for (const [x, z] of [[6, -18], [-18, -3]]) put('crop_pumpkin', x, z, { s: 2.6 });
    } else {
      put('log_stack', -12, -4, { s: 2, rot: 1, collide: 1 });
      put('pot_large', 4, 12, { s: 2, collide: 0.6 });
    }
    // waystone: fast travel between discovered outposts
    const ws = new THREE.Vector3(hx - (big ? 6 : 7), y, hz - (big ? 12 : 8));
    put('statue_obelisk', ws.x - hx, ws.z - hz, { s: 2.6, collide: 1 });
    const glow = this.makeGlow(ws.clone().setY(y + 6.2), '#8fd8ff', 3.2);
    // signposts toward each road leaving this hub
    for (const [a, c] of ROADS) {
      if (a !== zone.id && c !== zone.id) continue;
      const other = ZONE_BY_ID[a === zone.id ? c : a].hub;
      const ang = Math.atan2(other[1] - hz, other[0] - hx);
      put('sign', Math.cos(ang) * (R + 3), Math.sin(ang) * (R + 3), { s: 2.2, rot: -ang + Math.PI / 2 });
    }
    this.scene.add(await b.build());
    this.lanterns(hx, hz, y, R - 3, big ? 10 : 6);
    const stall = this.buildStall(new THREE.Vector3(hx + (big ? 7 : 8), y, hz + (big ? -9 : -6)), big ? -0.6 : -0.9);
    const hub = { index: i, zone, pos: new THREE.Vector3(hx, y, hz), fire, glow, stall, waystone: ws, merchantPos: stall.merchantPos, merchantRot: stall.rot, firePos };
    this.hubs.push(hub);
    this.interactables.push({ id: 'hearth', hub, pos: new THREE.Vector3(hx, y, hz), radius: 4, label: `rest at the ${zone.hubName} hearth` });
    this.interactables.push({ id: 'shop', hub, pos: stall.front, radius: 3.2, label: 'trade with the merchant' });
    this.interactables.push({ id: 'waystone', hub, pos: ws, radius: 3.4, label: `touch the ${zone.hubName} waystone` });
  }

  lanterns(hx, hz, y, r, count) {
    const posts = [], lamps = [];
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + 0.2;
      const x = hx + Math.cos(a) * r, z = hz + Math.sin(a) * r;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(up, a * 3.1), new THREE.Vector3(1, 1, 1));
      const pole = new THREE.CylinderGeometry(0.07, 0.09, 2.6, 6).translate(0, 1.3, 0).toNonIndexed();
      const arm = new THREE.BoxGeometry(0.6, 0.06, 0.06).translate(0.25, 2.5, 0).toNonIndexed();
      pole.deleteAttribute('uv'); arm.deleteAttribute('uv');
      posts.push(pole.applyMatrix4(m), arm.applyMatrix4(m));
      lamps.push(new THREE.SphereGeometry(0.2, 12, 8).translate(0.5, 2.3, 0).applyMatrix4(m));
      this.colliders.add(x, z, 0.25);
    }
    const pm = new THREE.Mesh(mergeGeometries(posts), LANTERN_POST);
    pm.castShadow = true;
    this.scene.add(pm, new THREE.Mesh(mergeGeometries(lamps), LANTERN_LAMP));
  }

  buildStall(pos, rot) {
    const g = new THREE.Group();
    for (const [x, z] of [[-1.8, -1.1], [1.8, -1.1], [-1.8, 1.1], [1.8, 1.1]]) {
      const p = new THREE.Mesh(STALL_POST_GEO, STALL_WOOD);
      p.position.set(x, 1.5, z);
      p.castShadow = true;
      g.add(p);
    }
    const counter = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1, 0.9), STALL_WOOD);
    counter.position.set(0, 0.5, 1.0);
    counter.castShadow = counter.receiveShadow = true;
    const top = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.1, 1.1), STALL_TOP);
    top.position.set(0, 1.03, 1.0);
    const canopy = new THREE.Mesh(CANOPY_GEO, canopyMat());
    canopy.position.set(0, 3.0, 0);
    canopy.castShadow = true;
    g.add(counter, top, canopy, new THREE.Mesh(cardStacks(), CARD_MAT));
    g.position.copy(pos);
    g.rotation.y = rot;
    this.scene.add(g);
    const axis = new THREE.Vector3(0, 1, 0);
    this.colliders.add(pos.x, pos.z, 2.1);
    return {
      group: g, rot,
      merchantPos: new THREE.Vector3(0, 0, -0.3).applyAxisAngle(axis, rot).add(pos),
      front: new THREE.Vector3(0, 0, 2.6).applyAxisAngle(axis, rot).add(pos),
    };
  }

  makeGlow(pos, color, scale = 5) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color(color).multiplyScalar(2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.scale.setScalar(scale);
    s.position.copy(pos);
    this.scene.add(s);
    const phase = Math.random() * 6;
    this.updatables.push((t) => { s.scale.setScalar(scale * (0.9 + Math.sin(t * 1.7 + phase) * 0.12)); });
    return s;
  }

  makeFire(pos) {
    const pts = billboards(70, FIRE_UNIFORMS, /* glsl */ `
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
    return pts;
  }

  // ambient particles around the camera, restyled per zone
  addMotes() {
    const u = {
      uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Vector3(1, 0.95, 0.7) }, uFall: { value: 0 }, uSize: { value: 0.06 },
      uBlink: { value: 1 }, uSwirl: { value: 2 }, uBright: { value: 2 },
    };
    const pts = billboards(this.quality.name === 'low' ? 220 : 420, u, /* glsl */ `
      vec3 p = vec3((seed.x - 0.5) * 60.0, 0.0, (seed.z - 0.5) * 60.0);
      p.y = mod(seed.y * 14.0 + uTime * uFall, 14.0) - 3.0;
      p.x += sin(uTime * 0.3 + seed.z * 20.0) * uSwirl;
      p.y += sin(uTime * 0.5 + seed.x * 20.0) * 0.4;
      p.z += cos(uTime * 0.27 + seed.y * 30.0) * uSwirl;
      p.xz = mod(p.xz - uCenter.xz + 30.0, 60.0) - 30.0 + uCenter.xz;
      p.y += uCenter.y;
      center = p;
      vLife = mix(1.0, 0.5 + 0.5 * sin(uTime * 2.0 * uBlink + seed.w * 60.0), min(uBlink, 1.0));
      size = uSize * (0.7 + seed.w * 0.6);`, /* glsl */ `
      gl_FragColor = vec4(uColor * uBright, a * vLife * 0.8);`,
    'uniform vec3 uCenter; uniform vec3 uColor; uniform float uFall, uSize, uBlink, uSwirl, uBright;');
    this.scene.add(pts);
    this.motes = u;
  }

  // ease fog, sky and particles toward the zone the player is in
  updateAtmosphere(dt, p) {
    const zw = zoneWeights(p.x, p.z);
    this.zoneIdx = zw.idx[0];
    const z = ZONES[this.zoneIdx];
    const k = this.snapAtmosphere ? 1 : 1 - Math.exp(-dt * 0.8);
    this.snapAtmosphere = false;
    this.scene.fog.color.lerp(_c.set(z.fog), k);
    this.scene.background.copy(this.scene.fog.color);
    const su = this.sky.material.uniforms;
    su.uZenith.value.lerp(_c.set(z.sky), k);
    su.uHorizon.value.lerp(_c.set(z.horizon), k);
    this.water.material.uniforms.uSky.value.copy(su.uHorizon.value);
    this.water.material.uniforms.uZenith.value.copy(su.uZenith.value);
    this.hemi.intensity += ((z.ambient || 1.3) - this.hemi.intensity) * k;
    const P = PARTICLES[z.particles] || PARTICLES.pollen;
    const m = this.motes;
    m.uColor.value.lerp(_v3.set(...P.color), k);
    m.uFall.value += (P.fall - m.uFall.value) * k;
    m.uSize.value += (P.size - m.uSize.value) * k;
    m.uBlink.value += (P.blink - m.uBlink.value) * k;
    m.uSwirl.value += (P.swirl - m.uSwirl.value) * k;
    m.uBright.value += (P.bright - m.uBright.value) * k;
  }

  update(t, dt, playerPos, camera) {
    this.terrain.update(playerPos);
    this.grass.userData.update(t, playerPos, camera);
    this.water.userData.update(t, camera);
    this.forest.update(t);
    this.sky.position.copy(camera.position);
    this.sky.material.uniforms.uTime.value = t;
    this.motes.uTime.value = t;
    this.motes.uCenter.value.copy(playerPos);
    FIRE_UNIFORMS.uTime.value = t;
    CANOPY_U.uTime.value = t;
    this.updateAtmosphere(dt, playerPos);
    // a single point light, parked at the nearest hearth
    let best = null, bd = 1e9;
    for (const h of this.hubs) {
      const d = h.pos.distanceTo(playerPos);
      h.fire.visible = d < 250;
      if (d < bd) { bd = d; best = h; }
    }
    if (best) {
      this.hubLight.position.copy(best.firePos).add(_v3.set(0, 1.2, 0));
      this.hubLight.intensity = bd < 120 ? 26 + Math.sin(t * 13) * 3 + Math.sin(t * 7.3) * 3 : 0;
    }
    // shadow frustum follows the player, snapped to texels to avoid shimmer
    const snap = (55 * 2) / this.quality.shadow;
    const cx = Math.round(playerPos.x / snap) * snap, cz = Math.round(playerPos.z / snap) * snap;
    this.sun.target.position.set(cx, playerPos.y, cz);
    this.sun.position.set(cx, playerPos.y, cz).addScaledVector(SUN_DIR, 200);
    for (const f of this.updatables) f(t, dt);
  }
}

function disposeGroup(g) { g.traverse((o) => o.geometry?.dispose()); }

const _c = new THREE.Color();
const _v3 = new THREE.Vector3();
const FIRE_UNIFORMS = { uTime: { value: 0 } };
const LANTERN_POST = new THREE.MeshStandardMaterial({ color: '#4a3526', roughness: 0.9 });
const LANTERN_LAMP = new THREE.MeshStandardMaterial({ color: '#ffcf7a', emissive: '#ffb347', emissiveIntensity: 3 });
const STALL_WOOD = new THREE.MeshStandardMaterial({ color: '#8a5a3a', roughness: 0.9 });
const STALL_TOP = new THREE.MeshStandardMaterial({ color: '#c89a68', roughness: 0.8 });
const STALL_POST_GEO = new THREE.CylinderGeometry(0.1, 0.12, 3, 6);
const CANOPY_GEO = new THREE.PlaneGeometry(4.2, 2.8, 24, 12).rotateX(-Math.PI / 2 + 0.25);
const CANOPY_U = { uTime: { value: 0 } };
const CARD_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, emissive: '#ffffff', emissiveIntensity: 0.08 });
let canopyMaterial = null;
function canopyMat() {
  if (canopyMaterial) return canopyMaterial;
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 8;
  const cx = cv.getContext('2d');
  for (let i = 0; i < 8; i++) { cx.fillStyle = i % 2 ? '#f4e9d4' : '#c8453b'; cx.fillRect(i * 32, 0, 32, 8); }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  canopyMaterial = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9 });
  canopyMaterial.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = CANOPY_U.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += sin(position.x * 2.0 + uTime * 2.0) * 0.05 * (1.0 - abs(position.x) / 2.1) + sin(position.z * 3.0 + uTime * 3.1) * 0.03;');
  };
  return canopyMaterial;
}
function cardStacks() {
  const cards = [];
  ['#ff6a3d', '#3db8ff', '#6fdc5a', '#ffd23d'].forEach((hex, i) => {
    const c = new THREE.Color(hex);
    for (let k = 0; k < 4; k++) {
      const card = new THREE.BoxGeometry(0.35, 0.02, 0.5).toNonIndexed();
      card.rotateY(((i * 4 + k) % 5 - 2) * 0.07).translate(-1.2 + i * 0.8, 1.1 + k * 0.025, 1.0);
      const col = new Float32Array(card.attributes.position.count * 3);
      for (let v = 0; v < col.length; v += 3) { col[v] = c.r; col[v + 1] = c.g; col[v + 2] = c.b; }
      card.setAttribute('color', new THREE.BufferAttribute(col, 3));
      card.deleteAttribute('uv');
      cards.push(card);
    }
  });
  return mergeGeometries(cards);
}
