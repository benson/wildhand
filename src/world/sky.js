// stylized gradient sky dome with sun glow and drifting clouds
import * as THREE from 'three';

export const SKY = {
  zenith: new THREE.Color('#3f86d8'),
  horizon: new THREE.Color('#ffd7b0'),
  sunGlow: new THREE.Color('#ffb36b'),
  fog: new THREE.Color('#e9c9a8'),
};

export function createSky(sunDir) {
  const geo = new THREE.SphereGeometry(900, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: SKY.zenith },
      uHorizon: { value: SKY.horizon },
      uGlow: { value: SKY.sunGlow },
      uSun: { value: sunDir.clone() },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uHorizon, uGlow, uSun;
      uniform float uTime;
      varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.03; a*=0.5; } return s; }
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.65, h), 0.7));
        float sd = max(dot(d, normalize(uSun)), 0.0);
        col += uGlow * pow(sd, 6.0) * 0.55;
        col += vec3(1.0, 0.9, 0.75) * pow(sd, 300.0) * 6.0; // sun disk (blooms)
        // clouds on a virtual plane
        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y + 0.12) * 1.4 + vec2(uTime * 0.006, uTime * 0.002);
          float c = fbm(uv);
          c = smoothstep(0.5, 0.78, c) * smoothstep(0.0, 0.25, d.y);
          vec3 cloudCol = mix(vec3(1.0, 0.93, 0.86), uGlow * 1.2, pow(sd, 3.0) * 0.6);
          float shade = fbm(uv + 0.15);
          cloudCol *= 0.85 + 0.25 * shade;
          col = mix(col, cloudCol, c * 0.85);
        } else {
          col = mix(uHorizon, uHorizon * 0.8, min(-d.y * 4.0, 1.0));
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}
