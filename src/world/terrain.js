// streamed continent terrain: chunks generated in workers, drawn at distance-based lod,
// plus gpu-side data textures (a local window around the player and a coarse world map)
import * as THREE from 'three';
import { CHUNK, ZONES, WORLD_HALF } from './zones.js';
import * as G from './gen.js';

const LOD_DIST = [210, 460, 820, 1400];

export class Terrain {
  constructor(scene, quality) {
    this.scene = scene;
    this.quality = quality;
    this.view = quality.view;
    this.chunks = new Map();
    this.inflight = 0;
    this.listeners = { scatter: [], unload: [] };
    this.group = new THREE.Group();
    scene.add(this.group);
    this.material = makeMaterial();
    this.indexCache = new Map();
    const nw = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1));
    this.workers = [];
    this.pending = new Map();
    this.reqId = 0;
    for (let i = 0; i < nw; i++) {
      const w = new Worker(new URL('./chunkworker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this.onMessage(e.data);
      w.onerror = (e) => console.error('chunk worker error', e.message || e);
      this.workers.push(w);
    }
    this.nextWorker = 0;
    // local data window (2m texels) for grass + shoreline
    this.winN = 256;
    this.winSize = this.winN * 2;
    this.winOrigin = new THREE.Vector2(1e9, 1e9);
    this.winData = new Uint16Array(this.winN * this.winN * 4);
    this.winCol = new Uint8Array(this.winN * this.winN * 4);
    this.winTex = new THREE.DataTexture(this.winData, this.winN, this.winN, THREE.RGBAFormat, THREE.HalfFloatType);
    this.winTex.magFilter = this.winTex.minFilter = THREE.LinearFilter;
    this.winColTex = new THREE.DataTexture(this.winCol, this.winN, this.winN, THREE.RGBAFormat);
    this.winColTex.magFilter = this.winColTex.minFilter = THREE.LinearFilter;
    this.winDirty = true;
    this.lastWinBuild = 0;
  }

  on(ev, fn) { this.listeners[ev].push(fn); }

  post(msg) {
    const w = this.workers[this.nextWorker++ % this.workers.length];
    w.postMessage(msg);
  }

  // coarse whole-world map (minimap, world map, distant water)
  loadMap(res = 384) {
    return new Promise((resolve) => {
      const id = ++this.reqId;
      this.pending.set(id, (map) => {
        this.map = map;
        const n = map.res;
        const data = new Uint16Array(n * n * 4);
        for (let k = 0; k < n * n; k++) {
          data[k * 4] = THREE.DataUtils.toHalfFloat(map.h[k]);
          data[k * 4 + 1] = THREE.DataUtils.toHalfFloat(map.water[k]);
          data[k * 4 + 2] = THREE.DataUtils.toHalfFloat(map.zone[k]);
          data[k * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
        }
        this.mapTex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.HalfFloatType);
        this.mapTex.magFilter = this.mapTex.minFilter = THREE.LinearFilter;
        this.mapTex.needsUpdate = true;
        resolve(map);
      });
      this.post({ type: 'map', res, id });
    });
  }

  onMessage(m) {
    if (m.type === 'map') { this.pending.get(m.id)?.(m.map); this.pending.delete(m.id); return; }
    const c = m.chunk;
    this.inflight--;
    const key = `${c.cx}:${c.cz}`;
    const ch = this.chunks.get(key);
    if (!ch || ch.want === undefined) return;
    ch.requested = -1;
    if (c.lod !== ch.lod) this.buildMesh(ch, c);
    if (c.lod === 0) { ch.data0 = c; this.winDirty = true; }
    if (!ch.dataAny || c.lod <= ch.dataAny.lod) ch.dataAny = c;
    if (c.trees && !ch.scattered) {
      ch.scattered = true;
      for (const fn of this.listeners.scatter) fn(key, c, ch);
    }
  }

  edgeList(n) {
    const e = [];
    for (let i = 0; i < n - 1; i++) e.push(i);
    for (let j = 0; j < n - 1; j++) e.push(j * n + n - 1);
    for (let i = n - 1; i > 0; i--) e.push((n - 1) * n + i);
    for (let j = n - 1; j > 0; j--) e.push(j * n);
    return e;
  }

  indices(n) {
    if (this.indexCache.has(n)) return this.indexCache.get(n);
    const idx = [];
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, d = a + n, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    // skirts: an extra ring of vertices hanging below the edge hides lod cracks
    const base = n * n;
    const edge = this.edgeList(n);
    for (let k = 0; k < edge.length; k++) {
      const a = edge[k], b = edge[(k + 1) % edge.length];
      const sa = base + k, sb = base + ((k + 1) % edge.length);
      idx.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
    }
    const total = n * n + edge.length;
    const attr = new THREE.BufferAttribute(total > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1);
    this.indexCache.set(n, attr);
    return attr;
  }

  buildMesh(ch, c) {
    const { n, step, heights, normals, colors, stone } = c;
    const edge = this.edgeList(n);
    const total = n * n + edge.length;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const st = new Float32Array(total);
    const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      pos[k * 3] = x0 + i * step; pos[k * 3 + 1] = heights[k]; pos[k * 3 + 2] = z0 + j * step;
    }
    nor.set(normals);
    col.set(colors);
    st.set(stone);
    const drop = step * 1.5 + 2;
    edge.forEach((v, k) => {
      const t = n * n + k;
      pos[t * 3] = pos[v * 3]; pos[t * 3 + 1] = pos[v * 3 + 1] - drop; pos[t * 3 + 2] = pos[v * 3 + 2];
      nor[t * 3] = nor[v * 3]; nor[t * 3 + 1] = nor[v * 3 + 1]; nor[t * 3 + 2] = nor[v * 3 + 2];
      col[t * 3] = col[v * 3]; col[t * 3 + 1] = col[v * 3 + 1]; col[t * 3 + 2] = col[v * 3 + 2];
      st[t] = st[v];
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aStone', new THREE.BufferAttribute(st, 1));
    g.setIndex(this.indices(n));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.receiveShadow = true;
    mesh.castShadow = c.lod === 0;
    if (ch.mesh) { this.group.remove(ch.mesh); ch.mesh.geometry.dispose(); }
    ch.mesh = mesh;
    ch.lod = c.lod;
    this.group.add(mesh);
  }

  rectDist(cx, cz, p) {
    const ex = Math.max(cx * CHUNK - p.x, 0, p.x - (cx + 1) * CHUNK);
    const ez = Math.max(cz * CHUNK - p.z, 0, p.z - (cz + 1) * CHUNK);
    return Math.hypot(ex, ez);
  }

  // decide which chunks should exist at which lod; queue work nearest-first
  update(p) {
    const R = this.view;
    const c0x = Math.floor(p.x / CHUNK), c0z = Math.floor(p.z / CHUNK);
    const rc = Math.ceil(R / CHUNK) + 1;
    for (const ch of this.chunks.values()) ch.dist = this.rectDist(ch.cx, ch.cz, p);
    for (let dz = -rc; dz <= rc; dz++) for (let dx = -rc; dx <= rc; dx++) {
      const cx = c0x + dx, cz = c0z + dz;
      if (Math.abs((cx + 0.5) * CHUNK) > WORLD_HALF || Math.abs((cz + 0.5) * CHUNK) > WORLD_HALF) continue;
      const d = this.rectDist(cx, cz, p);
      if (d > R) continue;
      let lod = 0;
      while (lod < 3 && d > LOD_DIST[lod] * this.quality.lodScale) lod++;
      const key = `${cx}:${cz}`;
      let ch = this.chunks.get(key);
      if (!ch) { ch = { cx, cz, lod: -1, requested: -1, mesh: null, scattered: false }; this.chunks.set(key, ch); }
      ch.want = lod;
      ch.dist = d;
      ch.needScatter = d < this.quality.scatter;
    }
    for (const [key, ch] of this.chunks) {
      if (ch.dist > R + 160) { this.unload(key, ch); continue; }
      if (ch.scattered && ch.dist > this.quality.scatter + 120) {
        ch.scattered = false;
        for (const fn of this.listeners.unload) fn(key, ch);
      }
      if (ch.data0 && ch.dist > LOD_DIST[0] * this.quality.lodScale + 150) ch.data0 = null;
    }
    // queue requests
    const todo = [];
    for (const ch of this.chunks.values()) {
      if (ch.want === undefined || ch.requested >= 0) continue;
      const needMesh = ch.lod !== ch.want;
      const needScatter = ch.needScatter && !ch.scattered;
      if (needMesh || needScatter || (ch.want === 0 && !ch.data0)) todo.push(ch);
    }
    todo.sort((a, b) => a.dist - b.dist);
    const maxInflight = this.workers.length * 3;
    for (const ch of todo) {
      if (this.inflight >= maxInflight) break;
      ch.requested = ch.want;
      this.inflight++;
      this.post({ type: 'chunk', cx: ch.cx, cz: ch.cz, lod: ch.want, scatter: ch.needScatter && !ch.scattered });
    }
    const cx = this.winOrigin.x + this.winSize / 2, cz = this.winOrigin.y + this.winSize / 2;
    if (this.winDirty || Math.abs(p.x - cx) > 48 || Math.abs(p.z - cz) > 48) {
      const now = performance.now();
      if (now - this.lastWinBuild > 350) { this.lastWinBuild = now; this.buildWindow(p); }
    }
  }

  unload(key, ch) {
    if (ch.mesh) { this.group.remove(ch.mesh); ch.mesh.geometry.dispose(); }
    if (ch.scattered) for (const fn of this.listeners.unload) fn(key, ch);
    ch.want = undefined;
    this.chunks.delete(key);
  }

  // how many chunks near p still need their first mesh or scatter
  pendingNear(p, r = 200) {
    let k = 0;
    for (const ch of this.chunks.values()) if (ch.dist < r && (ch.lod < 0 || (ch.needScatter && !ch.scattered))) k++;
    return k;
  }

  chunkData(x, z) {
    const ch = this.chunks.get(`${Math.floor(x / CHUNK)}:${Math.floor(z / CHUNK)}`);
    return ch ? (ch.data0 || ch.dataAny) : null;
  }

  heightAt(x, z) {
    const c = this.chunkData(x, z);
    if (!c) return G.height(x, z);
    const { n, step, heights } = c;
    const fx0 = (x - c.cx * CHUNK) / step, fz0 = (z - c.cz * CHUNK) / step;
    const i = Math.min(n - 2, Math.max(0, Math.floor(fx0))), j = Math.min(n - 2, Math.max(0, Math.floor(fz0)));
    const fx = fx0 - i, fz = fz0 - j;
    const h00 = heights[j * n + i], h10 = heights[j * n + i + 1], h01 = heights[(j + 1) * n + i], h11 = heights[(j + 1) * n + i + 1];
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 1;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }
  slopeAt(x, z) { return 1 - this.normalAt(x, z, _v).y; }
  zoneAt(x, z) { return ZONES[G.zoneIndexAt(x, z)]; }
  levelAt(x, z) { return G.levelAt(x, z); }

  // fill the local data window around p from chunk data (grass density/height, color)
  buildWindow(p) {
    const N = this.winN, S = 2;
    const ox = Math.round((p.x - this.winSize / 2) / S) * S, oz = Math.round((p.z - this.winSize / 2) / S) * S;
    this.winOrigin.set(ox, oz);
    const d = this.winData, col = this.winCol;
    const H = THREE.DataUtils.toHalfFloat;
    const one = H(1);
    let missing = 0;
    let cache = null, cacheKey = '';
    for (let j = 0; j < N; j++) {
      const z = oz + j * S;
      for (let i = 0; i < N; i++) {
        const x = ox + i * S;
        const k = (j * N + i) * 4;
        const key = `${Math.floor(x / CHUNK)}:${Math.floor(z / CHUNK)}`;
        if (key !== cacheKey) { cacheKey = key; const ch = this.chunks.get(key); cache = ch ? (ch.data0 || ch.dataAny) : null; }
        const c = cache;
        if (!c) {
          missing++;
          d[k] = H(this.mapHeight(x, z)); d[k + 1] = 0; d[k + 2] = 0; d[k + 3] = one;
          continue;
        }
        const ci = Math.min(c.n - 1, Math.round((x - c.cx * CHUNK) / c.step));
        const cj = Math.min(c.n - 1, Math.round((z - c.cz * CHUNK) / c.step));
        const q = cj * c.n + ci;
        d[k] = H(c.heights[q]);
        if (c.grass) { d[k + 1] = H(c.grass[q * 2]); d[k + 2] = H(c.grass[q * 2 + 1]); } else { d[k + 1] = 0; d[k + 2] = 0; }
        d[k + 3] = one;
        // linear values: the grass shader treats this texture as linear color
        col[k] = Math.min(255, c.colors[q * 3] * 255);
        col[k + 1] = Math.min(255, c.colors[q * 3 + 1] * 255);
        col[k + 2] = Math.min(255, c.colors[q * 3 + 2] * 255);
        col[k + 3] = 255;
      }
    }
    this.winTex.needsUpdate = true;
    this.winColTex.needsUpdate = true;
    this.winDirty = missing > 0;
  }

  mapHeight(x, z) {
    const m = this.map;
    if (!m) return -10;
    const n = m.res;
    const i = Math.max(0, Math.min(n - 1, Math.floor((x + 4096) / 8192 * n)));
    const j = Math.max(0, Math.min(n - 1, Math.floor((z + 4096) / 8192 * n)));
    return m.h[j * n + i];
  }
}

const _v = new THREE.Vector3();

function makeMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nattribute float aStone;\nvarying float vStone;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvStone = aStone;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
varying float vStone;
vec2 hash22(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
vec2 cobble(vec2 p){ vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0; vec2 id = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(x, y); vec2 o = hash22(i + g) * 0.8 + 0.1;
    float d = length(g + o - f); if (d < d1) { d2 = d1; d1 = d; id = i + g; } else if (d < d2) d2 = d; }
  return vec2(d2 - d1, fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453)); }
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x), mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float n1 = vnoise(vWPos.xz*0.9)*0.6 + vnoise(vWPos.xz*3.1)*0.4;
diffuseColor.rgb *= 0.88 + n1*0.24;
if (vStone > 0.01) {
  vec2 cb = cobble(vWPos.xz * 1.1);
  float grout = smoothstep(0.04, 0.12, cb.x);
  vec3 stone = diffuseColor.rgb * (0.86 + cb.y * 0.28);
  stone = mix(diffuseColor.rgb * 0.55, stone, grout);
  diffuseColor.rgb = mix(diffuseColor.rgb, stone, vStone);
}`);
  };
  return mat;
}
