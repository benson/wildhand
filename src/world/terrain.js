// procedural island: heightfield, biome map, colors, and the terrain mesh.
// everything derives from WORLD_SEED so every client generates the same island.
import * as THREE from 'three';
import { makeNoise } from './noise.js';

export const WORLD_SEED = 7331;
export const SIZE = 640; // world extent in meters
export const RES = 320; // cells per side
export const CELL = SIZE / RES;
export const ISLAND_R = 235;
export const TOWN_R = 26;
export const TOWN_H = 5.2;

const N = makeNoise(WORLD_SEED);
const N2 = makeNoise(WORLD_SEED + 1);

// dirt paths from town out to each region (polyline control points)
export const PATHS = [
  [[0, 0], [10, 40], [-6, 85], [12, 130], [0, 175]], // south: meadow & pond
  [[0, 0], [45, -8], [95, 6], [140, -10], [180, 4]], // east: forest
  [[0, 0], [-8, -45], [6, -90], [-14, -135], [-4, -170]], // north: highlands & ruins
  [[0, 0], [-45, 12], [-95, -4], [-150, 20]], // west: coast
];
export const POND = { x: -70, z: 95, r: 26 };
export const RUINS = { x: -10, z: -165 };

function smoothstep(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}
const lerp = (a, b, t) => a + (b - a) * t;

function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  const x = ax + dx * t - px, z = az + dz * t - pz;
  return Math.sqrt(x * x + z * z);
}
export function pathDist(x, z) {
  // wobble the path so it isn't ruler-straight
  const wx = x + N2.noise2(x * 0.03, z * 0.03) * 4;
  const wz = z + N2.noise2(x * 0.03 + 40, z * 0.03) * 4;
  let d = Infinity;
  for (const p of PATHS) for (let i = 0; i < p.length - 1; i++) {
    d = Math.min(d, distToSeg(wx, wz, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]));
  }
  return d;
}

// raw height function (expensive; used to bake the grid)
function rawHeight(x, z) {
  const r = Math.sqrt(x * x + z * z);
  let d = r / ISLAND_R + N.fbm(x * 0.006, z * 0.006, 3) * 0.22;
  const mask = smoothstep(1.02, 0.62, d);

  let h = 3.5 + 7 * (N.fbm(x * 0.009, z * 0.009, 4) * 0.5 + 0.5);
  // highlands to the north: ridged mountains
  const north = smoothstep(-40, -150, z + N.noise2(x * 0.01, 3) * 30);
  const ridge = 1 - Math.abs(N.fbm(x * 0.014, z * 0.014, 4));
  h += north * (ridge * ridge * 26 + 5);
  // gentle forest hills to the east
  const east = smoothstep(40, 120, x);
  h += east * N.fbm(x * 0.02 + 9, z * 0.02, 3) * 4;

  h = lerp(-9, h, mask);

  // pond
  const pd = Math.hypot(x - POND.x, z - POND.z) + N.noise2(x * 0.05, z * 0.05) * 6;
  h = lerp(h, -2.2, smoothstep(POND.r, POND.r * 0.45, pd));

  // ruins plateau
  const rd = Math.hypot(x - RUINS.x, z - RUINS.z);
  h = lerp(h, 22, smoothstep(30, 18, rd));

  // flatten paths a little
  const pdist = pathDist(x, z);
  const pathT = smoothstep(7, 2, pdist) * mask;
  h = lerp(h, h * 0.85 + 0.6, pathT * 0.35);

  // town plateau
  const townT = smoothstep(TOWN_R + 18, TOWN_R - 4, r);
  h = lerp(h, TOWN_H, townT);
  return h;
}

export class Terrain {
  constructor() {
    const n = RES + 1;
    this.n = n;
    this.h = new Float32Array(n * n);
    this.path = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = -SIZE / 2 + i * CELL, z = -SIZE / 2 + j * CELL;
      this.h[j * n + i] = rawHeight(x, z);
      this.path[j * n + i] = pathDist(x, z);
    }
  }

  // exact height on the triangulated mesh
  heightAt(x, z) {
    const fx0 = (x + SIZE / 2) / CELL, fz0 = (z + SIZE / 2) / CELL;
    if (fx0 < 0 || fz0 < 0 || fx0 >= RES || fz0 >= RES) return -9;
    const i = Math.floor(fx0), j = Math.floor(fz0);
    const fx = fx0 - i, fz = fz0 - j;
    const n = this.n, H = this.h;
    const h00 = H[j * n + i], h10 = H[j * n + i + 1], h01 = H[(j + 1) * n + i], h11 = H[(j + 1) * n + i + 1];
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 1;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }
  slopeAt(x, z) {
    return 1 - this.normalAt(x, z, _v).y;
  }
  pathAt(x, z) {
    const i = Math.round((x + SIZE / 2) / CELL), j = Math.round((z + SIZE / 2) / CELL);
    if (i < 0 || j < 0 || i > RES || j > RES) return 99;
    return this.path[j * this.n + i];
  }
  // biome name at a position, for spawns and props
  biomeAt(x, z) {
    const h = this.heightAt(x, z);
    if (h < 1.4) return 'beach';
    if (z < -60 && h > 11) return 'highland';
    if (x > 45 + N.noise2(z * 0.01, 7) * 25) return 'forest';
    return 'meadow';
  }
  // how much grass grows here, 0..1
  grassAt(x, z) {
    const h = this.heightAt(x, z);
    const slope = this.slopeAt(x, z);
    const r = Math.hypot(x, z);
    let g = smoothstep(1.3, 2.4, h) * smoothstep(0.32, 0.18, slope);
    g *= smoothstep(1.2, 3.2, this.pathAt(x, z));
    g *= smoothstep(TOWN_R - 10, TOWN_R - 4, r);
    const rd = Math.hypot(x - RUINS.x, z - RUINS.z);
    g *= smoothstep(10, 20, rd) * 0.8 + 0.2;
    // patchiness
    g *= smoothstep(-0.55, -0.1, N2.fbm(x * 0.04, z * 0.04, 2));
    return g;
  }
  levelAt(x, z) {
    const r = Math.hypot(x, z);
    const h = this.heightAt(x, z);
    return Math.max(1, Math.min(6, 1 + Math.floor((r - 30) / 45) + (h > 18 ? 1 : 0)));
  }

  colorAt(x, z, out = new THREE.Color()) {
    const h = this.heightAt(x, z);
    const slope = this.slopeAt(x, z);
    const biome = this.biomeAt(x, z);
    const v = N2.fbm(x * 0.05, z * 0.05, 3) * 0.5 + 0.5;
    const v2 = N.noise2(x * 0.15, z * 0.15) * 0.5 + 0.5;

    // grass tone per biome
    if (biome === 'forest') out.copy(C.forestA).lerp(C.forestB, v);
    else if (biome === 'highland') out.copy(C.highA).lerp(C.highB, v);
    else out.copy(C.meadowA).lerp(C.meadowB, v);
    out.lerp(C.meadowTip, v2 * 0.12);

    // rock on steep slopes and high peaks
    const rockT = smoothstep(0.22, 0.38, slope) + smoothstep(26, 34, h);
    if (rockT > 0) out.lerp(_c.copy(C.rockA).lerp(C.rockB, v2), Math.min(1, rockT));

    // sand near water
    const sandT = smoothstep(2.2, 1.0, h);
    if (sandT > 0) out.lerp(_c.copy(C.sand).lerp(C.sandWet, smoothstep(0.6, -0.4, h)), sandT);
    if (h < -0.4) out.lerp(C.seabed, smoothstep(-0.4, -6, h));

    // paths
    const pd = this.pathAt(x, z);
    const pathT = smoothstep(3.2, 1.4, pd + v2 * 0.8) * smoothstep(0.8, 1.6, h);
    if (pathT > 0) out.lerp(_c.copy(C.path).lerp(C.pathB, v), pathT);

    // town plaza stone
    const r = Math.hypot(x, z);
    const plaza = smoothstep(TOWN_R - 9, TOWN_R - 11, r + v2 * 1.5);
    if (plaza > 0) out.lerp(_c.copy(C.plaza).lerp(C.plazaB, v2), plaza);
    const rd = Math.hypot(x - RUINS.x, z - RUINS.z);
    const rplaza = smoothstep(15, 12, rd + v2 * 2);
    if (rplaza > 0) out.lerp(_c.copy(C.ruinStone).lerp(C.plazaB, v2 * 0.5), rplaza);
    return out;
  }

  buildMesh() {
    const n = this.n;
    const pos = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const mask = new Float32Array(n * n);
    const c = new THREE.Color();
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = -SIZE / 2 + i * CELL, z = -SIZE / 2 + j * CELL;
      pos[k * 3] = x; pos[k * 3 + 1] = this.h[k]; pos[k * 3 + 2] = z;
      this.colorAt(x, z, c);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
      const r = Math.hypot(x, z);
      const rd = Math.hypot(x - RUINS.x, z - RUINS.z);
      mask[k] = Math.max(smoothstep(TOWN_R - 8, TOWN_R - 11, r), smoothstep(14, 11, rd));
    }
    const idx = new Uint32Array(RES * RES * 6);
    let p = 0;
    for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
      const a = j * n + i, b = j * n + i + 1, d = (j + 1) * n + i, e = (j + 1) * n + i + 1;
      // diagonal from (1,0) to (0,1), matching heightAt
      idx[p++] = a; idx[p++] = d; idx[p++] = b;
      idx[p++] = b; idx[p++] = d; idx[p++] = e;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aStone', new THREE.BufferAttribute(mask, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    this.colors = col;

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      // fine-grained color breakup so close-up ground isn't flat
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nattribute float aStone;\nvarying float vStone;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvStone = aStone;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vWPos;
varying float vStone;
vec2 hash22(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
// cobblestones: voronoi cell edges
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
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    this.mesh = mesh;
    return mesh;
  }

  // textures for gpu-side sampling (grass, water)
  buildTextures() {
    const n = this.n;
    const data = new Float32Array(n * n * 4);
    const c = new THREE.Color();
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = -SIZE / 2 + i * CELL, z = -SIZE / 2 + j * CELL;
      data[k * 4] = this.h[k];
      data[k * 4 + 1] = this.grassAt(x, z);
      data[k * 4 + 2] = this.biomeAt(x, z) === 'forest' ? 1 : 0;
      data[k * 4 + 3] = this.biomeAt(x, z) === 'highland' ? 1 : 0;
    }
    // half floats: linear filtering of half-float textures is core in webgl2
    const half = new Uint16Array(data.length);
    for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
    const tex = new THREE.DataTexture(half, n, n, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.dataTex = tex;

    const cdata = new Uint8Array(n * n * 4);
    for (let k = 0; k < n * n; k++) {
      c.setRGB(this.colors[k * 3], this.colors[k * 3 + 1], this.colors[k * 3 + 2]);
      cdata[k * 4] = Math.round(c.r * 255);
      cdata[k * 4 + 1] = Math.round(c.g * 255);
      cdata[k * 4 + 2] = Math.round(c.b * 255);
      cdata[k * 4 + 3] = 255;
    }
    const ctex = new THREE.DataTexture(cdata, n, n, THREE.RGBAFormat);
    ctex.magFilter = THREE.LinearFilter;
    ctex.minFilter = THREE.LinearFilter;
    ctex.needsUpdate = true;
    this.colorTex = ctex;
  }
}

const _v = new THREE.Vector3();
const _c = new THREE.Color();
// colors are linear (three converts hex → linear for Color.set)
const C = {
  meadowA: new THREE.Color('#5f9c3a'),
  meadowB: new THREE.Color('#8cb84a'),
  meadowTip: new THREE.Color('#d6d36a'),
  forestA: new THREE.Color('#2f6b35'),
  forestB: new THREE.Color('#4f8a3a'),
  highA: new THREE.Color('#7d8f4e'),
  highB: new THREE.Color('#a39a5c'),
  rockA: new THREE.Color('#8a8078'),
  rockB: new THREE.Color('#a89a88'),
  sand: new THREE.Color('#e9d39b'),
  sandWet: new THREE.Color('#bfa36e'),
  seabed: new THREE.Color('#3f8f8a'),
  path: new THREE.Color('#b78f5c'),
  pathB: new THREE.Color('#a07a4b'),
  plaza: new THREE.Color('#b9ad9a'),
  plazaB: new THREE.Color('#9e927f'),
  ruinStone: new THREE.Color('#a8a090'),
};
export const TERRAIN_COLORS = C;
