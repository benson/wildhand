// merges many static gltf props into vertex-colored meshes (one per shadow flag),
// so a chunk's props cost a couple of draw calls
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadGLTF, natureUrl, recolor } from './assets.js';

const partCache = new Map(); // name -> Promise<[{ geometry, local }]>
const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });

function parts(name) {
  if (!partCache.has(name)) {
    partCache.set(name, loadGLTF(natureUrl(name)).then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const list = [];
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        const groups = g.groups.length ? g.groups : [{ start: 0, count: g.attributes.position.count, materialIndex: 0 }];
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const col = new Float32Array(g.attributes.position.count * 3);
        for (const gr of groups) {
          const c = recolor(mats[gr.materialIndex] || mats[0]).color;
          for (let i = gr.start; i < gr.start + gr.count; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
        }
        const clean = new THREE.BufferGeometry();
        clean.setAttribute('position', g.attributes.position);
        clean.setAttribute('normal', g.attributes.normal);
        clean.setAttribute('color', new THREE.BufferAttribute(col, 3));
        list.push({ geometry: clean, local: o.matrixWorld.clone() });
      });
      return list;
    }).catch((e) => { console.warn('missing model', name, e); return []; }));
  }
  return partCache.get(name);
}

export class StaticBatcher {
  constructor() { this.items = []; }

  // tint: optional [r, g, b] multiplier
  add(name, matrix, shadow = true, tint = null) {
    this.items.push({ name, matrix, shadow, tint });
  }

  // returns a group with up to two merged meshes (shadow casters and not)
  async build() {
    const names = [...new Set(this.items.map((i) => i.name))];
    const loaded = {};
    await Promise.all(names.map(async (n) => { loaded[n] = await parts(n); }));
    const buckets = [[], []];
    const m = new THREE.Matrix4();
    for (const it of this.items) {
      for (const part of loaded[it.name]) {
        m.multiplyMatrices(it.matrix, part.local);
        const g = part.geometry.clone().applyMatrix4(m);
        if (it.tint) {
          const c = g.attributes.color = g.attributes.color.clone();
          for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * it.tint[0], c.getY(i) * it.tint[1], c.getZ(i) * it.tint[2]);
        }
        buckets[it.shadow ? 1 : 0].push(g);
      }
    }
    const group = new THREE.Group();
    buckets.forEach((geos, shadow) => {
      if (!geos.length) return;
      const merged = mergeGeometries(geos);
      geos.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = !!shadow;
      mesh.receiveShadow = true;
      merged.computeBoundingSphere();
      group.add(mesh);
    });
    this.items = [];
    return group;
  }
}
