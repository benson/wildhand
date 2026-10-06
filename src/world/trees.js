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
  // a cluster of pointed leaves around the card center
  const leaves = 11;
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2 + Math.random() * 0.4;
    const r = 18 + Math.random() * 20;
    const x = s / 2 + Math.cos(a) * r, y = s / 2 + Math.sin(a) * r;
    g.save();
    g.translate(x, y);
    g.rotate(a + Math.PI / 2);
    const l = 22 + Math.random() * 10, w = 10 + Math.random() * 4;
    const sh = 200 + Math.floor(Math.random() * 55);
    g.fillStyle = `rgb(${sh},${sh},${sh})`;
    g.beginPath();
    g.moveTo(0, -l);
    g.quadraticCurveTo(w, 0, 0, l);
    g.quadraticCurveTo(-w, 0, 0, -l);
    g.fill();
    g.restore();
  }
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(s / 2, s / 2, 26, 0, Math.PI * 2);
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
  } else if (kind === 'bush') {
    leaves.push(clumpGeometry(new THREE.Vector3(0, 0.55, 0), 0.9, 36, rng, 0.75));
    leaves.push(clumpGeometry(new THREE.Vector3(0.6, 0.4, 0.2), 0.6, 20, rng, 0.75));
  }
  const tg = trunk.length ? toNonIndexedColor(mergeGeometries(trunk), 1) : null;
  const lg = mergeGeometries(leaves);
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
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vLeafW;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
        vec3 ip = instanceMatrix[3].xyz;
        #else
        vec3 ip = vec3(0.0);
        #endif
        float sway = sin(uTime * 1.3 + ip.x * 0.2 + ip.z * 0.13) * 0.5 + sin(uTime * 2.7 + position.y + ip.x) * 0.25;
        transformed.x += sway * 0.06 * position.y;
        transformed.z += sway * 0.04 * position.y;
        transformed += normal * sin(uTime * 3.0 + position.x * 3.0 + position.z * 2.0) * 0.04;
        #ifdef USE_INSTANCING
        vLeafW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
        vLeafW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`);
      // soft wrap lighting for foliage: lift the dark side a little
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLeafW;')
        // dissolve leaves close to the camera so they never fill the screen
        .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
          float camD = distance(vLeafW, cameraPosition);
          float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          if (camD < 2.5 + dither * 2.0) discard;`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.12;');
    };
    this.trunkMat = new THREE.MeshStandardMaterial({ color: '#6e4c34', roughness: 0.95, vertexColors: true });
    this.birchMat = new THREE.MeshStandardMaterial({ color: '#e6e0d4', roughness: 0.9, vertexColors: true });
    this.variants = {};
    for (const kind of ['oak', 'birch', 'pine', 'bush']) {
      this.variants[kind] = [0, 1, 2].map((i) => buildVariant(kind, 1000 + i * 77 + kind.length * 13));
    }
  }

  // placements: [{ kind, x, y, z, s, rot, color: THREE.Color }]
  build(placements) {
    const byKey = new Map();
    placements.forEach((p, i) => {
      const v = p.variant ?? (i % 3);
      const key = `${p.kind}:${v}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(p);
    });
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    for (const [key, list] of byKey) {
      const [kind, v] = key.split(':');
      const variant = this.variants[kind][+v];
      const leaves = new THREE.InstancedMesh(variant.leaves, this.leafMat, list.length);
      const trunk = variant.trunk ? new THREE.InstancedMesh(variant.trunk, kind === 'birch' ? this.birchMat : this.trunkMat, list.length) : null;
      list.forEach((p, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot);
        sc.setScalar(p.s);
        m.compose(new THREE.Vector3(p.x, p.y, p.z), q, sc);
        leaves.setMatrixAt(i, m);
        leaves.setColorAt(i, p.color);
        if (trunk) trunk.setMatrixAt(i, m);
      });
      leaves.castShadow = true;
      leaves.receiveShadow = true;
      leaves.computeBoundingSphere();
      this.group.add(leaves);
      if (trunk) {
        trunk.castShadow = true;
        trunk.receiveShadow = true;
        trunk.computeBoundingSphere();
        this.group.add(trunk);
      }
    }
    return this.group;
  }
  update(t) { this.uniforms.uTime.value = t; }
}
