// gltf loading + caching, material recoloring for the kenney nature kit
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();

export function loadGLTF(url) {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
  return cache.get(url);
}

export const CHAR_MODELS = ['knight', 'barbarian', 'mage', 'rogue', 'rogue_hooded'];
export const charUrl = (m) => `assets/models/chars/${m}.glb`;
export const petUrl = (m) => `assets/models/pets/${m}.glb`;
export const natureUrl = (m) => `assets/models/nature/${m}.glb`;

// clone a skinned model (characters, pets) with its own skeleton
export async function instantiateSkinned(url) {
  const gltf = await loadGLTF(url);
  const root = SkeletonUtils.clone(gltf.scene);
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
    }
  });
  return { root, animations: gltf.animations };
}

// warm stylized palette replacing kenney's default teal/orange
const PALETTE = {
  grass: '#79ad4c',
  leafsGreen: '#5c9e44',
  leafsDark: '#3d7a45',
  leafsFall: '#e2913f',
  dirt: '#8f6a47',
  stone: '#b3ada3',
  stoneDark: '#8f8a84',
  wood: '#b07a4c',
  woodDark: '#7f5435',
  woodBark: '#7a5236',
  woodBarkDark: '#5e3f2c',
  woodInner: '#e8cf9e',
  colorRed: '#d4553f',
  colorRedDark: '#a8392c',
  colorTan: '#e9b27a',
  colorYellow: '#f2c14e',
  colorPurple: '#9a72d9',
  _defaultMat: '#c9c2b5',
};
const matCache = new Map();
export function recolor(mat) {
  const key = mat.name || '_defaultMat';
  if (!matCache.has(key)) {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[key] || '#c9c2b5'),
      roughness: 0.92,
      metalness: 0,
      flatShading: false,
    });
    m.name = key;
    matCache.set(key, m);
  }
  return matCache.get(key);
}

// build instanced meshes for a static gltf model at many transforms
export async function instanceModel(name, matrices, { shadows = true, recolorMats = true } = {}) {
  const gltf = await loadGLTF(natureUrl(name));
  const group = new THREE.Group();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const material = recolorMats ? (mats.length > 1 ? mats.map(recolor) : recolor(mats[0])) : o.material;
    const im = new THREE.InstancedMesh(o.geometry, material, matrices.length);
    const local = o.matrixWorld;
    const m = new THREE.Matrix4();
    matrices.forEach((mx, i) => { m.multiplyMatrices(mx, local); im.setMatrixAt(i, m); });
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = shadows;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  });
  return group;
}

export async function loadStatic(name) {
  const gltf = await loadGLTF(natureUrl(name));
  const root = gltf.scene.clone(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(recolor) : recolor(o.material);
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return root;
}
