// fluffy stylized trees: alpha-cut leaf cards arranged in clumps with
// spherical normals so each clump shades like a soft ball. instanced + wind.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function leafTexture() {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, s, s);
  // a cluster of rounded leaves around the card center
  const leaves = 16;
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2 + Math.random() * 0.5;
    const r = 16 + Math.random() * 24;
    const x = s / 2 + Math.cos(a) * r, y = s / 2 + Math.sin(a) * r;
    g.save();
    g.translate(x, y);
    g.rotate(a + Math.PI / 2);
    const l = 15 + Math.random() * 7, w = 11 + Math.random() * 5;
    const sh = 205 + Math.floor(Math.random() * 50);
    g.fillStyle = `rgb(${sh},${sh},${sh})`;
    g.beginPath();
    g.ellipse(0, 0, w, l, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(s / 2, s / 2, 30, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function rand(rng, a, b) { return a + (b - a) * rng(); }

// one clump of leaf cards around center c with radius r
function clumpGeometry(c, r, quads, rng, squash = 1) {
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  const v = new THREE.Vector3(), dir = new THREE.Vector3();
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let i = 0; i < quads; i++) {
    dir.set(rand(rng, -1, 1), rand(rng, -1, 1), rand(rng, -1, 1)).normalize();
    const dist = r * (1 - Math.pow(rng(), 3)) * 0.85;
    const center = new THREE.Vector3().copy(dir).multiplyScalar(dist);
    center.y *= squash;
    center.add(c);
    e.set(rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2);
    q.setFromEuler(e);
    const size = r * rand(rng, 0.55, 0.8);
    const base = pos.length / 3;
    const shade = 0.55 + 0.45 * (dist / r); // inner leaves darker = fake ao
    for (const [cx, cy] of corners) {
      v.set(cx * size, cy * size, 0).applyQuaternion(q).add(center);
      pos.push(v.x, v.y, v.z);
      const n = v.clone().sub(c);
      n.y /= squash;
      n.normalize();
      nor.push(n.x, n.y, n.z);
      uv.push((cx + 1) / 2, (cy + 1) / 2);
      // top leaves catch more light
      const topBoost = 0.9 + 0.2 * Math.max(0, n.y);
      col.push(shade * topBoost, shade * topBoost, shade * topBoost);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function branch(from, to, r0, r1) {
  const d = new THREE.Vector3().subVectors(to, from);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, 7, 2);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  g.applyQuaternion(q);
  g.translate(from.x, from.y, from.z);
  return g;
}

function toNonIndexedColor(g, shade) {
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const pos = g.attributes.position;
  for (let i = 0; i < n; i++) {
    const s = shade * (0.85 + 0.15 * Math.min(1, pos.getY(i) / 3));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = s;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

// tree archetypes
function buildVariant(kind, seed) {
  let s = seed;
  const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const trunk = [];
  const leaves = [];
  if (kind === 'oak') {
    const H = rand(rng, 3.2, 4.2);
    const top = new THREE.Vector3(rand(rng, -0.3, 0.3), H, rand(rng, -0.3, 0.3));
    trunk.push(branch(new THREE.Vector3(0, -0.3, 0), top, 0.34, 0.2));
    const clumps = 4 + Math.floor(rng() * 2);
    leaves.push(clumpGeometry(top.clone().add(new THREE.Vector3(0, 1.0, 0)), 1.9, 70, rng, 0.85));
    for (let i = 0; i < clumps; i++) {
      const a = (i / clumps) * Math.PI * 2 + rng();
      const end = top.clone().add(new THREE.Vector3(Math.cos(a) * rand(rng, 1.1, 1.7), rand(rng, -0.2, 0.9), Math.sin(a) * rand(rng, 1.1, 1.7)));
      trunk.push(branch(top.clone().add(new THREE.Vector3(0, -0.6, 0)), end, 0.16, 0.08));
      leaves.push(clumpGeometry(end, rand(rng, 1.2, 1.55), 42, rng, 0.85));
    }
  } else if (kind === 'birch') {
    const H = rand(rng, 4.5, 5.5);
    trunk.push(branch(new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, H, 0), 0.2, 0.1));
    for (let i = 0; i < 4; i++) {
      const y = H * (0.55 + i * 0.13);
      const a = rng() * Math.PI * 2;
      leaves.push(clumpGeometry(new THREE.Vector3(Math.cos(a) * 0.45, y, Math.sin(a) * 0.45), 1.15 - i * 0.12, 36, rng, 1.1));
    }
  } else if (kind === 'pine') {
    const H = rand(rng, 6, 7.5);
    trunk.push(branch(new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, H, 0), 0.3, 0.08));
    const tiers = 5;
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      leaves.push(clumpGeometry(new THREE.Vector3(0, 1.6 + t * (H - 1.6), 0), 1.9 * (1 - t * 0.7) + 0.35, 46 - i * 5, rng, 0.45));
    }
  } else if (kind === 'willow') {
    const H = rand(rng, 3.6, 4.4);
    const top = new THREE.Vector3(rand(rng, -0.3, 0.3), H, rand(rng, -0.3, 0.3));
    trunk.push(branch(new THREE.Vector3(0, -0.3, 0), top, 0.4, 0.22));
    leaves.push(clumpGeometry(top.clone().add(new THREE.Vector3(0, 0.6, 0)), 1.8, 60, rng, 0.7));
    const k = 6;
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2 + rng() * 0.5;
      const end = top.clone().add(new THREE.Vector3(Math.cos(a) * 1.9, -0.6 - rng() * 0.6, Math.sin(a) * 1.9));
      trunk.push(branch(top.clone().add(new THREE.Vector3(0, -0.4, 0)), end.clone().add(new THREE.Vector3(0, 0.8, 0)), 0.14, 0.07));
      leaves.push(clumpGeometry(end, 1.0, 34, rng, 1.9));
    }
  } else if (kind === 'dead') {
    const H = rand(rng, 3.5, 5);
    const top = new THREE.Vector3(rand(rng, -0.4, 0.4), H, rand(rng, -0.4, 0.4));
    trunk.push(branch(new THREE.Vector3(0, -0.3, 0), top, 0.3, 0.1));
    const k = 4 + Math.floor(rng() * 3);
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2 + rng();
      const y0 = H * rand(rng, 0.45, 0.9);
      const from = new THREE.Vector3(top.x * y0 / H, y0, top.z * y0 / H);
      const end = from.clone().add(new THREE.Vector3(Math.cos(a) * rand(rng, 1, 1.8), rand(rng, 0.5, 1.4), Math.sin(a) * rand(rng, 1, 1.8)));
      trunk.push(branch(from, end, 0.1, 0.03));
      const a2 = a + rand(rng, -0.8, 0.8);
      trunk.push(branch(end, end.clone().add(new THREE.Vector3(Math.cos(a2) * 0.7, 0.6, Math.sin(a2) * 0.7)), 0.04, 0.015));
    }
  } else if (kind === 'bush') {
    leaves.push(clumpGeometry(new THREE.Vector3(0, 0.55, 0), 0.9, 36, rng, 0.75));
    leaves.push(clumpGeometry(new THREE.Vector3(0.6, 0.4, 0.2), 0.6, 20, rng, 0.75));
  }
  const tg = trunk.length ? toNonIndexedColor(mergeGeometries(trunk), 1) : null;
  const lg = leaves.length ? mergeGeometries(leaves) : null;
  return { trunk: tg, leaves: lg };
}

export class Forest {
  constructor() {
    this.leafTex = leafTexture();
    this.uniforms = { uTime: { value: 0 } };
    this.group = new THREE.Group();
    this.leafMat = new THREE.MeshStandardMaterial({
      map: this.leafTex,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      vertexColors: true,
      roughness: 0.8,
    });
    const u = this.uniforms;
    this.leafMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = u.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute vec3 aOrigin;\nvarying vec3 vLeafW;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        // geometry is pre-merged in world space; aOrigin is each tree's base
        float hgt = max(transformed.y - aOrigin.y, 0.0);
        float sway = sin(uTime * 1.3 + aOrigin.x * 0.2 + aOrigin.z * 0.13) * 0.5 + sin(uTime * 2.7 + hgt + aOrigin.x) * 0.25;
        transformed.x += sway * 0.06 * hgt;
        transformed.z += sway * 0.04 * hgt;
        transformed += normal * sin(uTime * 3.0 + transformed.x * 3.0 + transformed.z * 2.0) * 0.04;
        vLeafW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLeafW;')
        // dissolve leaves close to the camera so they never fill the screen
        .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
          float camD = distance(vLeafW, cameraPosition);
          // 4x4 bayer screen-door fade
          ivec2 bp = ivec2(mod(gl_FragCoord.xy, 4.0));
          int bi = bp.x + bp.y * 4;
          float bayer[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
          float dither = bayer[bi] / 16.0;
          if (camD < 2.0 + dither * 2.2) discard;`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.12;');
    };
    this.trunkMat = new THREE.MeshStandardMaterial({ roughness: 0.95, vertexColors: true });
    this.variants = {};
    for (const kind of ['oak', 'birch', 'pine', 'bush', 'willow', 'dead']) {
      this.variants[kind] = [0, 1, 2].map((i) => buildVariant(kind, 1000 + i * 77 + kind.length * 13));
    }
  }

  // one chunk's trees merged into a leaf mesh + a trunk mesh.
  // list items: [kind, x, y, z, scale, rot, colorHex, variant]
  buildChunk(list) {
    const group = new THREE.Group();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const leafGeos = [], trunkGeos = [];
    const col = new THREE.Color();
    for (const [kind, x, y, z, s, rot, hex, v] of list) {
      const arch = ARCH[kind] || 'oak';
      const variant = this.variants[arch][v % 3];
      q.setFromAxisAngle(up, rot);
      sc.setScalar(s);
      m.compose(_p.set(x, y - 0.15, z), q, sc);
      if (variant.leaves) {
        const lg = variant.leaves.clone().applyMatrix4(m);
        tint(lg, col.set(hex));
        if (kind === 'snowpine') snowcap(lg);
        origin(lg, x, y, z);
        leafGeos.push(lg);
      }
      if (variant.trunk) {
        const tg = variant.trunk.clone().applyMatrix4(m);
        tint(tg, TRUNK[kind] || TRUNK.oak);
        origin(tg, x, y, z);
        trunkGeos.push(tg);
      }
    }
    if (leafGeos.length) {
      const leaves = new THREE.Mesh(mergeGeometries(leafGeos), this.leafMat);
      leaves.castShadow = leaves.receiveShadow = true;
      group.add(leaves);
    }
    if (trunkGeos.length) {
      const trunk = new THREE.Mesh(mergeGeometries(trunkGeos), this.trunkMat);
      trunk.castShadow = trunk.receiveShadow = true;
      group.add(trunk);
    }
    leafGeos.concat(trunkGeos).forEach((g) => g.dispose());
    return group;
  }

  update(t) { this.uniforms.uTime.value = t; }
}

function snowcap(g) {
  const c = g.attributes.color, n = g.attributes.normal;
  for (let i = 0; i < c.count; i++) {
    const t = Math.min(1, Math.max(0, (n.getY(i) - 0.15) / 0.5));
    const w = 0.92;
    c.setXYZ(i, c.getX(i) + (w - c.getX(i)) * t, c.getY(i) + (w - c.getY(i)) * t, c.getZ(i) + (0.96 - c.getZ(i)) * t);
  }
}
function tint(g, color) {
  const c = g.attributes.color;
  for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * color.r, c.getY(i) * color.g, c.getZ(i) * color.b);
}
function origin(g, x, y, z) {
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = x; a[i * 3 + 1] = y; a[i * 3 + 2] = z; }
  g.setAttribute('aOrigin', new THREE.BufferAttribute(a, 3));
}
const _p = new THREE.Vector3();
const ARCH = { oak: 'oak', blossom: 'oak', autumn: 'oak', birch: 'birch', goldbirch: 'birch', pine: 'pine', snowpine: 'pine', bush: 'bush', willow: 'willow', dead: 'dead', charred: 'dead' };
const TRUNK = {
  oak: new THREE.Color('#6e4c34'), birch: new THREE.Color('#e6e0d4'), goldbirch: new THREE.Color('#e6e0d4'),
  dead: new THREE.Color('#7a6a5a'), charred: new THREE.Color('#2a2224'), willow: new THREE.Color('#5a4a34'),
  pine: new THREE.Color('#5a3e2c'), snowpine: new THREE.Color('#5a3e2c'),
};
