// stylized ocean: depth-tinted, shoreline foam bands, sun glints, sky fresnel
import * as THREE from 'three';
import { SKY } from './sky.js';

let mesh_setMap = null;
export function createWater(terrain, sunDir) {
  const geo = new THREE.PlaneGeometry(3400, 3400, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uData: { value: null },
      uMap: { value: null },
      uWinOrigin: { value: null },
      uTexN: { value: 256 },
      uSun: { value: sunDir.clone() },
      uShallow: { value: new THREE.Color('#5fe3d2') },
      uMid: { value: new THREE.Color('#1fa3b8') },
      uDeep: { value: new THREE.Color('#14507f') },
      uSky: { value: SKY.horizon.clone() },
      uZenith: { value: SKY.zenith.clone() },
    },
  ]);
  uniforms.uData.value = terrain.winTex;
  uniforms.uWinOrigin.value = terrain.winOrigin;
  uniforms.uTexN.value = terrain.winN;
  mesh_setMap = () => { uniforms.uMap.value = terrain.mapTex; };
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
      uniform float uTime, uTexN;
      uniform vec2 uWinOrigin;
      uniform sampler2D uData, uMap;
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
        vec2 muv = (vW.xz + 4096.0) / 8192.0;
        vec4 mp = texture2D(uMap, muv);
        float ground = mp.r;
        float style = mp.g;
        vec2 uv = ((vW.xz - uWinOrigin) * 0.5 + 0.5) / uTexN;
        if (uv.x > 0.01 && uv.x < 0.99 && uv.y > 0.01 && uv.y < 0.99) ground = texture2D(uData, uv).r;
        if (muv.x < 0.0 || muv.x > 1.0 || muv.y < 0.0 || muv.y > 1.0) { ground = -30.0; style = 0.0; }
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
        // swamp: murky green-brown, little foam
        float swamp = smoothstep(0.25, 0.5, style) * (1.0 - smoothstep(0.75, 0.95, style));
        vec3 murk = mix(vec3(0.16, 0.2, 0.08), vec3(0.3, 0.34, 0.14), w0) + vec3(1.0, 0.85, 0.6) * spec * 1.5;
        col = mix(col, murk, swamp);
        alpha = mix(alpha, 0.93, swamp);
        // lava: slow glowing crust
        float lava = smoothstep(0.75, 0.95, style);
        if (lava > 0.0) {
          vec2 lp = vW.xz * 0.12 + vec2(uTime * 0.03, uTime * 0.02);
          float crust = vn(lp) * 0.6 + vn(lp * 2.7 - uTime * 0.05) * 0.4;
          float cracks = smoothstep(0.42, 0.5, crust) * (1.0 - smoothstep(0.5, 0.62, crust));
          vec3 hot = mix(vec3(3.2, 0.9, 0.12), vec3(4.0, 2.0, 0.3), vn(lp * 4.0 + uTime * 0.2));
          vec3 lc = mix(hot, vec3(0.08, 0.04, 0.03), smoothstep(0.45, 0.75, crust));
          lc += hot * cracks * 0.8;
          col = mix(col, lc, lava);
          alpha = mix(alpha, 1.0, lava);
        }
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0;
  mesh.renderOrder = 2;
  mesh.userData.setMap = () => mesh_setMap?.();
  mesh.userData.update = (t, cam) => {
    uniforms.uTime.value = t;
    mesh.position.x = Math.round(cam.position.x / 50) * 50;
    mesh.position.z = Math.round(cam.position.z / 50) * 50;
  };
  return mesh;
}
