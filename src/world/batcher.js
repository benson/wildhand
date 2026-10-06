// merges many static gltf props into one vertex-colored mesh per map tile,
// so the whole island's props cost a handful of draw calls
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadGLTF, natureUrl, recolor } from './assets.js';

const TILE = 64;

export class StaticBatcher {
  constructor() {
    this.items = []; // { name, matrix, shadow }
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  }

  add(name, matrix, shadow = true) {
    this.items.push({ name, matrix, shadow });
  }

  async build(scene) {
    const names = [...new Set(this.items.map((i) => i.name))];
    const parts = {}; // name -> [{ geometry (with color), local matrix }]
    await Promise.all(names.map(async (name) => {
      const gltf = await loadGLTF(natureUrl(name));
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
      parts[name] = list;
    }));

    const buckets = new Map();
    const m = new THREE.Matrix4();
    for (const it of this.items) {
      const p = new THREE.Vector3().setFromMatrixPosition(it.matrix);
      const key = `${Math.floor(p.x / TILE)}:${Math.floor(p.z / TILE)}:${it.shadow ? 1 : 0}`;
      if (!buckets.has(key)) buckets.set(key, []);
      for (const part of parts[it.name]) {
        m.multiplyMatrices(it.matrix, part.local);
        buckets.get(key).push(part.geometry.clone().applyMatrix4(m));
      }
    }
    for (const [key, geos] of buckets) {
      const merged = mergeGeometries(geos);
      geos.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(merged, this.material);
      const shadow = key.endsWith(':1');
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      merged.computeBoundingSphere();
      scene.add(mesh);
    }
    this.items = [];
  }
}
