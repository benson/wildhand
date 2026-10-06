// renderer + post-processing chain
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.32 },
    uSat: { value: 1.12 },
    uTime: { value: 0 },
    uFlash: { value: new THREE.Vector4(0, 0, 0, 0) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uVignette, uSat, uTime; uniform vec4 uFlash;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat);
      // warm highlights, cool shadows
      c.rgb += vec3(0.02, 0.01, -0.01) * smoothstep(0.4, 1.0, l) + vec3(-0.01, 0.0, 0.025) * smoothstep(0.4, 0.0, l);
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d, d) * uVignette * 2.4;
      c.rgb *= v;
      c.rgb = mix(c.rgb, uFlash.rgb, uFlash.a);
      gl_FragColor = c;
    }`,
};

export function createRenderer(canvas, quality) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

export function createComposer(renderer, scene, camera, quality) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality.msaa });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.5, 0.92);
  composer.addPass(bloom);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  composer.grade = grade;
  composer.bloom = bloom;
  return composer;
}

export function pickQuality() {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || window.innerWidth < 700;
  const q = new URLSearchParams(location.search).get('q');
  if (q === 'low' || (mobile && q !== 'high')) {
    return { name: 'low', grass: 170, grassPatch: 56, pixelRatio: 1.25, msaa: 0, shadow: 1024, view: 720, lodScale: 0.6, scatter: 300, fogNear: 90, fogFar: 640, mapRes: 256 };
  }
  return { name: 'high', grass: 400, grassPatch: 72, pixelRatio: 1.75, msaa: 4, shadow: 2048, view: 1300, lodScale: 1, scatter: 520, fogNear: 170, fogFar: 1150, mapRes: 384 };
}
