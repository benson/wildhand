// gpu grass: a patch of instanced blades that wraps around the player.
// blade roots read height, density and color from terrain textures.
import * as THREE from 'three';
import { SIZE, RES } from './terrain.js';

export function createGrass(terrain, { count = 300, patch = 76 } = {}) {
  const blade = new THREE.BufferGeometry();
  // 5-vertex tapered blade, y in [0,1]
  const w = 0.5;
  const verts = new Float32Array([
    -w, 0, 0, w, 0, 0,
    -w * 0.72, 0.45, 0, w * 0.72, 0.45, 0,
    0, 1, 0,
  ]);
  blade.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  blade.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);

  const geo = new THREE.InstancedBufferGeometry();
  geo.index = blade.index;
  geo.attributes.position = blade.attributes.position;
  const total = count * count;
  const offs = new Float32Array(total * 2);
  const rnd = new Float32Array(total * 4);
  const cell = patch / count;
  let k = 0;
  for (let j = 0; j < count; j++) for (let i = 0; i < count; i++) {
    offs[k * 2] = (i + Math.random()) * cell;
    offs[k * 2 + 1] = (j + Math.random()) * cell;
    rnd[k * 4] = Math.random();
    rnd[k * 4 + 1] = Math.random();
    rnd[k * 4 + 2] = Math.random();
    rnd[k * 4 + 3] = Math.random();
    k++;
  }
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offs, 2));
  geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rnd, 4));
  geo.instanceCount = total;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

  const uniforms = {
    uCenter: { value: new THREE.Vector2() },
    uPatch: { value: patch },
    uTime: { value: 0 },
    uData: { value: terrain.dataTex },
    uColor: { value: terrain.colorTex },
    uWorld: { value: SIZE },
    uTexN: { value: RES + 1 },
    uPlayer: { value: new THREE.Vector3(0, -100, 0) },
    uCam: { value: new THREE.Vector3() },
  };

  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', /* glsl */ `#include <common>
attribute vec2 aOffset;
attribute vec4 aRand;
uniform vec2 uCenter;
uniform float uPatch, uTime, uWorld, uTexN;
uniform sampler2D uData, uColor;
uniform vec3 uPlayer, uCam;
varying vec3 vGrassCol;
varying float vTip;
vec2 worldUV(vec2 p){ return (p / uWorld * (uTexN - 1.0) + uWorld * 0.0 + (uTexN - 1.0) * 0.5 + 0.5) / uTexN; }
float gh(vec2 p){ p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
float gn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(gh(i), gh(i+vec2(1,0)), f.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), f.x), f.y); }
`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
      .replace('#include <begin_vertex>', /* glsl */ `
float half_ = uPatch * 0.5;
vec2 root = mod(aOffset - uCenter + half_, uPatch) - half_ + uCenter;
vec2 uv = worldUV(root);
vec4 d = texture2D(uData, uv);
float density = d.g;
// thin out randomly where density is partial
float alive = step(aRand.w, density * 1.15);
vec2 rel = root - uCenter;
float edge = 1.0 - smoothstep(half_ * 0.45, half_ * 0.95, length(rel));
float forest = d.b, high = d.a;
float hgt = (0.28 + 0.42 * aRand.x) * mix(0.7, 1.05, density) * alive * edge;
hgt *= mix(1.0, 1.35, forest) * mix(1.0, 0.7, high);
float t = position.y;
float live = step(0.02, hgt);
// face the camera, with a little random twist
vec2 toCam = normalize(uCam.xz - root + 0.0001);
vec2 side = vec2(-toCam.y, toCam.x);
float tw = (aRand.y - 0.5) * 1.2;
side = vec2(side.x * cos(tw) - side.y * sin(tw), side.x * sin(tw) + side.y * cos(tw));
float width = 0.05 * (0.7 + aRand.z * 0.6);
vec3 transformed = vec3(root.x, d.r, root.y);
transformed.xz += side * position.x * width * 2.0 * live;
transformed.y += t * hgt;
// wind: two scrolling noise layers, bends the upper blade
vec2 wdir = normalize(vec2(1.0, 0.35));
float n1 = gn(root * 0.09 + wdir * uTime * 0.55);
float n2 = gn(root * 0.35 + wdir * uTime * 1.6);
float wind = (n1 * 0.8 + n2 * 0.35 - 0.45) * 0.9;
float bend = t * t * hgt;
transformed.xz += wdir * wind * bend;
transformed.xz += toCam * (aRand.y - 0.5) * 0.35 * bend;
// push away from the player
vec3 toP = transformed - uPlayer;
float pd = length(toP.xz);
float push = (1.0 - smoothstep(0.2, 1.3, pd)) * bend;
transformed.xz += normalize(toP.xz + 0.0001) * push * 0.9;
transformed.y -= push * 0.35;
vec3 base = texture2D(uColor, uv).rgb;
vec3 tipCol = mix(base * vec3(1.15, 1.18, 0.95), vec3(0.85, 0.85, 0.42), 0.12 + 0.18 * aRand.z);
vec3 rootCol = base * vec3(0.72, 0.78, 0.74);
vGrassCol = mix(rootCol, tipCol, smoothstep(0.0, 1.0, t));
vGrassCol *= 0.9 + aRand.z * 0.2;
vTip = t;
`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrassCol;\nvarying float vTip;')
      .replace('#include <color_fragment>', 'diffuseColor.rgb = vGrassCol;')
      // both faces use the up normal so blades light like the ground under them
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGrassCol * vTip * vTip * 0.18;');
  };
  // the patch moves with the player via the shader; worldUV maps meters → texel centers
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.userData.update = (t, player, camera) => {
    uniforms.uTime.value = t;
    uniforms.uCenter.value.set(player.x, player.z);
    uniforms.uPlayer.value.copy(player);
    uniforms.uCam.value.copy(camera.position);
  };
  return mesh;
}
