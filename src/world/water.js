// stylized ocean: depth-tinted, shoreline foam bands, sun glints, sky fresnel
import * as THREE from 'three';
import { SIZE, RES } from './terrain.js';
import { SKY } from './sky.js';

export function createWater(terrain, sunDir) {
  const geo = new THREE.PlaneGeometry(2400, 2400, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uData: { value: null },
      uWorld: { value: SIZE },
      uTexN: { value: RES + 1 },
      uSun: { value: sunDir.clone() },
      uShallow: { value: new THREE.Color('#5fe3d2') },
      uMid: { value: new THREE.Color('#1fa3b8') },
      uDeep: { value: new THREE.Color('#14507f') },
      uSky: { value: SKY.horizon.clone() },
      uZenith: { value: SKY.zenith.clone() },
    },
  ]);
  uniforms.uData.value = terrain.dataTex;
  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime, uWorld, uTexN;
      uniform sampler2D uData;
      uniform vec3 uSun, uShallow, uMid, uDeep, uSky, uZenith;
      varying vec3 vW;
      float h2(vec2 p){ p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
      float wave(vec2 p){
        return vn(p * 0.35 + vec2(uTime * 0.12, uTime * 0.05)) * 0.5
             + vn(p * 0.9 - vec2(uTime * 0.18, -uTime * 0.11)) * 0.3
             + vn(p * 2.3 + vec2(uTime * 0.31, uTime * 0.27)) * 0.2;
      }
      void main() {
        vec2 uv = (vW.xz / uWorld * (uTexN - 1.0) + (uTexN - 1.0) * 0.5 + 0.5) / uTexN;
        float ground = -12.0;
        if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) ground = texture2D(uData, uv).r;
        float depth = max(-ground, 0.0);

        // normal from animated value noise
        float e = 0.15;
        float w0 = wave(vW.xz);
        vec3 n = normalize(vec3(w0 - wave(vW.xz + vec2(e, 0.0)), e * 1.6, w0 - wave(vW.xz + vec2(0.0, e))));
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);

        vec3 col = mix(uShallow, uMid, smoothstep(0.0, 2.5, depth));
        col = mix(col, uDeep, smoothstep(2.5, 12.0, depth));
        // caustic shimmer in the shallows
        float caust = pow(vn(vW.xz * 1.3 + w0 * 2.0 + uTime * 0.2), 3.0);
        col += vec3(0.5, 0.9, 0.8) * caust * (1.0 - smoothstep(0.0, 3.0, depth)) * 0.35;

        vec3 skyCol = mix(uSky, uZenith, 0.35);
        col = mix(col, skyCol, fres * 0.55);

        // sun glints
        vec3 H = normalize(normalize(uSun) + V);
        float spec = pow(max(dot(n, H), 0.0), 220.0);
        col += vec3(1.0, 0.85, 0.6) * spec * 3.0;

        // shoreline foam: moving contour bands plus a solid edge
        float edgeFoam = 1.0 - smoothstep(0.0, 0.35, depth + (vn(vW.xz * 2.0 + uTime * 0.4) - 0.5) * 0.25);
        float band = fract(depth * 1.6 - uTime * 0.35 + vn(vW.xz * 0.6) * 0.8);
        float bands = step(0.82, band) * (1.0 - smoothstep(0.3, 1.8, depth));
        float foam = max(edgeFoam, bands * 0.75);
        col = mix(col, vec3(1.0, 0.98, 0.93), foam * 0.9);

        float alpha = mix(0.55, 0.96, smoothstep(0.0, 2.0, depth));
        alpha = max(alpha, foam);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0;
  mesh.renderOrder = 2;
  mesh.userData.update = (t, cam) => {
    uniforms.uTime.value = t;
    mesh.position.x = Math.round(cam.position.x / 50) * 50;
    mesh.position.z = Math.round(cam.position.z / 50) * 50;
  };
  return mesh;
}
