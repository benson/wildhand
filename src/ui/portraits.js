// renders each creature model into a small transparent image for card art
import * as THREE from 'three';
import { CREATURES, EL } from '../cards/data.js';
import { createPet } from '../entities/character.js';

export async function renderPortraits(size = 192) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#806040', 1.6));
  const sun = new THREE.DirectionalLight('#fff2dd', 2.6);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  const rim = new THREE.DirectionalLight('#ffffff', 1.5);
  rim.position.set(-3, 2, -3);
  scene.add(rim);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  const out = {};
  for (const [key, spec] of Object.entries(CREATURES)) {
    const { root, anim } = await createPet(spec.model, EL[spec.el].color, 0.28);
    anim.play('idle');
    anim.update(0.3);
    scene.add(root);
    root.rotation.y = 0.65;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3()).length();
    cam.position.set(c.x + s * 0.18, c.y + s * 0.32, c.z + s * 1.2);
    cam.lookAt(c);
    renderer.render(scene, cam);
    out[key] = renderer.domElement.toDataURL('image/png');
    scene.remove(root);
  }
  renderer.dispose();
  renderer.forceContextLoss?.();
  return out;
}
