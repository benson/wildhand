// pure world generation (no three.js) so it can run in a web worker.
// every client computes identical terrain, flora and spawns from WORLD_SEED.
import { makeNoise } from './noise.js';
import { mulberry32 } from '../cards/profile.js';
import { ZONES, ROADS, ZONE_BY_ID, WORLD_SEED, CONTINENT_R, CHUNK } from './zones.js';

const N = makeNoise(WORLD_SEED);
const N2 = makeNoise(WORLD_SEED + 1);
const N3 = makeNoise(WORLD_SEED + 2);

export const smoothstep = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const n01 = (v) => v * 0.5 + 0.5;

function hexLin(hex) {
  const v = parseInt(hex.slice(1), 16);
  const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return [f((v >> 16) & 255), f((v >> 8) & 255), f(v & 255)];
}
const PAL = ZONES.map((z) => Object.fromEntries(Object.entries(z.colors).map(([k, v]) => [k, hexLin(v)])));
const ROAD_COL = hexLin('#b08a5c');
const ROAD_COL2 = hexLin('#9a764a');
const PLAZA = hexLin('#b9ad9a');
const SEABED = hexLin('#3f8f8a');
const WETSAND = hexLin('#bfa36e');
const LAVA_EDGE = hexLin('#2a2024');

function ridged(x, z, oct) {
  let s = 0, a = 0.5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) { const v = 1 - Math.abs(N3.noise2(x * f, z * f)); s += a * v * v; norm += a; a *= 0.5; f *= 2.03; }
  return s / norm;
}
function terrace(h, step) {
  const k = Math.floor(h / step), f = h / step - k;
  return (k + smoothstep(0.78, 1.0, f)) * step;
}

// --- zones -----------------------------------------------------------------
// returns the 3 nearest zones (after domain warp) with blend weights
const _zw = { idx: [0, 0, 0], w: [1, 0, 0] };
export function zoneWeights(x, z, out = _zw) {
  const wx = x + N2.noise2(x * 0.0009, z * 0.0009) * 320 + N2.noise2(x * 0.004, z * 0.004) * 60;
  const wz = z + N2.noise2(x * 0.0009 + 50, z * 0.0009) * 320 + N2.noise2(x * 0.004 + 50, z * 0.004) * 60;
  let d0 = Infinity, d1 = Infinity, d2 = Infinity, i0 = 0, i1 = 0, i2 = 0;
  for (let i = 0; i < ZONES.length; i++) {
    const c = ZONES[i].center;
    const d = Math.hypot(wx - c[0], wz - c[1]);
    if (d < d0) { d2 = d1; i2 = i1; d1 = d0; i1 = i0; d0 = d; i0 = i; }
    else if (d < d1) { d2 = d1; i2 = i1; d1 = d; i1 = i; }
    else if (d < d2) { d2 = d; i2 = i; }
  }
  const B = 140;
  const w0 = 1, w1 = Math.exp(-(d1 - d0) / B * 2.2), w2 = Math.exp(-(d2 - d0) / B * 2.2);
  const s = w0 + w1 + w2;
  out.idx[0] = i0; out.idx[1] = i1; out.idx[2] = i2;
  out.w[0] = w0 / s; out.w[1] = w1 / s; out.w[2] = w2 / s;
  return out;
}
export function zoneIndexAt(x, z) { return zoneWeights(x, z).idx[0]; }

function recipe(kind, x, z, zone) {
  switch (kind) {
    case 'meadow': return 4 + 11 * n01(N.fbm(x * 0.0035, z * 0.0035, 4)) + 2.5 * N.fbm(x * 0.02, z * 0.02, 2);
    case 'forest': return 6 + 18 * n01(N.fbm(x * 0.003 + 5, z * 0.003, 4)) + 3 * N.fbm(x * 0.018, z * 0.018, 2);
    case 'coast': return 1.6 + 7 * n01(N.fbm(x * 0.0045 + 9, z * 0.0045, 3)) - 2.5 * smoothstep(0.2, 0.6, N3.fbm(x * 0.003, z * 0.003, 2));
    case 'swamp': {
      const f = N.fbm(x * 0.007 + 3, z * 0.007, 3);
      return 2.6 + 2.2 * f + (f < -0.12 ? (f + 0.12) * 22 : 0);
    }
    case 'desert': {
      const m = n01(N.fbm(x * 0.0022, z * 0.0022, 3));
      const mesa = terrace(m * 90, 13) * smoothstep(0.5, 0.62, m);
      const dunes = 3.5 * Math.abs(Math.sin(x * 0.018 + z * 0.006 + N.noise2(x * 0.003, z * 0.003) * 4));
      return 5 + dunes + mesa * 0.8;
    }
    case 'mountains': {
      const r = ridged(x * 0.0016, z * 0.0016, 5);
      return 22 + r * r * 190 + 6 * N.fbm(x * 0.01, z * 0.01, 2);
    }
    case 'volcano': {
      let h = 16 + ridged(x * 0.0025, z * 0.0025, 4) * 34;
      const v = zone.volcano;
      const d = Math.hypot(x - v[0], z - v[1]);
      h += 175 * Math.pow(Math.max(0, 1 - d / 780), 1.7);
      h = lerp(h, -10, smoothstep(200, 130, d)); // crater lava lake
      // slow lava channels running down the flanks
      const ch = Math.abs(N3.noise2(x * 0.0035 + 11, z * 0.0035));
      h -= smoothstep(0.045, 0.0, ch) * smoothstep(900, 300, d) * 40;
      return h;
    }
    case 'highlands': {
      const p = n01(N.fbm(x * 0.0024 + 7, z * 0.0024, 4));
      return terrace(18 + p * 95, 16) + 3 * N.fbm(x * 0.015, z * 0.015, 2);
    }
    default: return 5;
  }
}

export function landMask(x, z) {
  const r = Math.hypot(x, z) / CONTINENT_R + N.fbm(x * 0.0005, z * 0.0005, 3) * 0.24 + N.fbm(x * 0.003, z * 0.003, 2) * 0.04;
  return smoothstep(1.03, 0.88, r);
}

// --- roads -----------------------------------------------------------------
const ROAD_SEGS = [];
(function buildRoads() {
  const rng = mulberry32(WORLD_SEED + 31);
  for (const [a, b] of ROADS) {
    const A = ZONE_BY_ID[a].hub, Bp = ZONE_BY_ID[b].hub;
    const pts = [A];
    const steps = Math.max(3, Math.round(Math.hypot(Bp[0] - A[0], Bp[1] - A[1]) / 260));
    const nx = -(Bp[1] - A[1]), nz = Bp[0] - A[0];
    const nl = Math.hypot(nx, nz);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const j = (rng() - 0.5) * 220 * Math.sin(t * Math.PI);
      pts.push([lerp(A[0], Bp[0], t) + (nx / nl) * j, lerp(A[1], Bp[1], t) + (nz / nl) * j]);
    }
    pts.push(Bp);
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
      ROAD_SEGS.push({ x0, z0, x1, z1, minx: Math.min(x0, x1) - 30, maxx: Math.max(x0, x1) + 30, minz: Math.min(z0, z1) - 30, maxz: Math.max(z0, z1) + 30 });
    }
  }
})();
export function roadDist(x, z) {
  const wx = x + N2.noise2(x * 0.02, z * 0.02) * 3, wz = z + N2.noise2(x * 0.02 + 40, z * 0.02) * 3;
  let d = 99;
  for (const s of ROAD_SEGS) {
    if (wx < s.minx || wx > s.maxx || wz < s.minz || wz > s.maxz) continue;
    const dx = s.x1 - s.x0, dz = s.z1 - s.z0;
    const t = Math.max(0, Math.min(1, ((wx - s.x0) * dx + (wz - s.z0) * dz) / (dx * dx + dz * dz)));
    const ex = s.x0 + dx * t - wx, ez = s.z0 + dz * t - wz;
    d = Math.min(d, Math.sqrt(ex * ex + ez * ez));
  }
  return d;
}
export const roadSegments = () => ROAD_SEGS;

// --- height ----------------------------------------------------------------
function baseHeight(x, z) {
  const zw = zoneWeights(x, z);
  let h = 0;
  for (let k = 0; k < 3; k++) {
    if (zw.w[k] < 0.01) continue;
    const zone = ZONES[zw.idx[k]];
    h += zw.w[k] * recipe(zone.kind, x, z, zone);
  }
  const land = landMask(x, z);
  return lerp(-28, h, land);
}

const hubH = ZONES.map((zn) => Math.max(3, baseHeight(zn.hub[0], zn.hub[1])));
export const hubHeight = (i) => hubH[i];

export function height(x, z) {
  let h = baseHeight(x, z);
  // soften the ground under roads
  const rd = roadDist(x, z);
  if (rd < 10) h = lerp(h, Math.max(h * 0.9 + 0.4, h - 3), smoothstep(10, 3, rd) * 0.5);
  // outposts sit on flat ground
  for (let i = 0; i < ZONES.length; i++) {
    const hb = ZONES[i].hub;
    const d = Math.hypot(x - hb[0], z - hb[1]);
    if (d < 70) h = lerp(h, hubH[i], smoothstep(70, 32, d));
  }
  return h;
}

// --- surface ---------------------------------------------------------------
export const WATER_NONE = 0, WATER_SWAMP = 0.5, WATER_LAVA = 1;

// color (linear rgb), grass density, grass height, plaza mask; slope from the caller
export function surface(x, z, h, slope, out) {
  const zw = zoneWeights(x, z);
  const v = n01(N2.fbm(x * 0.05, z * 0.05, 3));
  const v2 = n01(N.noise2(x * 0.15, z * 0.15));
  let r = 0, g = 0, b = 0, gd = 0, gh = 0;
  for (let k = 0; k < 3; k++) {
    const wgt = zw.w[k];
    if (wgt < 0.01) continue;
    const zone = ZONES[zw.idx[k]];
    const P = PAL[zw.idx[k]];
    let cr = lerp(P.grassA[0], P.grassB[0], v), cg = lerp(P.grassA[1], P.grassB[1], v), cb = lerp(P.grassA[2], P.grassB[2], v);
    let rock = smoothstep(0.24, 0.4, slope);
    if (zone.kind === 'desert') rock = Math.max(rock, smoothstep(14, 22, h) * 0.85);
    if (zone.kind === 'volcano') rock = Math.max(rock, 0.75);
    if (zone.kind === 'highlands') rock = Math.max(rock, smoothstep(0.16, 0.3, slope));
    const rk = P.rock;
    cr = lerp(cr, rk[0] * (0.85 + v2 * 0.3), rock); cg = lerp(cg, rk[1] * (0.85 + v2 * 0.3), rock); cb = lerp(cb, rk[2] * (0.85 + v2 * 0.3), rock);
    let snow = 0;
    if (P.snow) snow = smoothstep(30, 48, h + v2 * 12) * (1 - smoothstep(0.5, 0.65, slope));
    if (snow > 0) { cr = lerp(cr, P.snow[0], snow); cg = lerp(cg, P.snow[1], snow); cb = lerp(cb, P.snow[2], snow); }
    const sand = smoothstep(2.4, 1.0, h);
    if (sand > 0) { cr = lerp(cr, P.sand[0], sand); cg = lerp(cg, P.sand[1], sand); cb = lerp(cb, P.sand[2], sand); }
    if (zone.kind === 'desert') {
      const dune = 1 - rock;
      cr = lerp(cr, P.sand[0] * (0.92 + v * 0.16), dune * 0.75); cg = lerp(cg, P.sand[1] * (0.92 + v * 0.16), dune * 0.75); cb = lerp(cb, P.sand[2] * (0.92 + v * 0.16), dune * 0.75);
    }
    r += wgt * cr; g += wgt * cg; b += wgt * cb;
    let dens = zone.grass.density * (1 - rock) * (1 - snow);
    if (zone.kind === 'desert') dens *= smoothstep(0.62, 0.75, n01(N3.fbm(x * 0.02, z * 0.02, 2)));
    gd += wgt * dens;
    gh += wgt * zone.grass.height;
  }
  // under water
  if (h < -0.3) {
    const t = smoothstep(-0.3, -6, h);
    r = lerp(lerp(r, WETSAND[0], 0.6), SEABED[0], t); g = lerp(lerp(g, WETSAND[1], 0.6), SEABED[1], t); b = lerp(lerp(b, WETSAND[2], 0.6), SEABED[2], t);
  }
  const zone0 = ZONES[zw.idx[0]];
  if (zone0.kind === 'volcano' && h < 3) {
    const t = smoothstep(3, 0, h) * zw.w[0];
    r = lerp(r, LAVA_EDGE[0], t); g = lerp(g, LAVA_EDGE[1], t); b = lerp(b, LAVA_EDGE[2], t);
  }
  // roads
  const rd = roadDist(x, z);
  const roadT = smoothstep(3.6, 1.6, rd + v2 * 0.9) * smoothstep(0.6, 1.4, h);
  if (roadT > 0) {
    r = lerp(r, lerp(ROAD_COL[0], ROAD_COL2[0], v), roadT); g = lerp(g, lerp(ROAD_COL[1], ROAD_COL2[1], v), roadT); b = lerp(b, lerp(ROAD_COL[2], ROAD_COL2[2], v), roadT);
  }
  // hub plazas
  let stone = 0;
  for (const zn of ZONES) {
    const d = Math.hypot(x - zn.hub[0], z - zn.hub[1]);
    const R = zn.id === 'hearthvale' ? 17 : 12;
    if (d < R + 4) stone = Math.max(stone, smoothstep(R, R - 3, d + v2 * 1.5));
  }
  if (stone > 0) { r = lerp(r, PLAZA[0] * (0.9 + v2 * 0.2), stone); g = lerp(g, PLAZA[1] * (0.9 + v2 * 0.2), stone); b = lerp(b, PLAZA[2] * (0.9 + v2 * 0.2), stone); }

  // grass placement
  let dens = gd * smoothstep(1.3, 2.4, h) * smoothstep(0.34, 0.2, slope);
  dens *= smoothstep(1.2, 3.4, rd);
  dens *= 1 - stone;
  dens *= smoothstep(-0.55, -0.1, N2.fbm(x * 0.04, z * 0.04, 2));
  out.r = r; out.g = g; out.b = b; out.grass = Math.max(0, dens); out.grassH = gh; out.stone = stone;
  out.zone = zw.idx[0];
  return out;
}

export function waterStyle(x, z) {
  const zw = zoneWeights(x, z);
  const zone = ZONES[zw.idx[0]];
  if (zone.water === 'lava' && landMask(x, z) > 0.95) return WATER_LAVA;
  if (zone.water === 'swamp' && landMask(x, z) > 0.9) return WATER_SWAMP;
  return WATER_NONE;
}

export function levelAt(x, z) {
  const zw = zoneWeights(x, z);
  const zone = ZONES[zw.idx[0]];
  const d = Math.hypot(x - zone.hub[0], z - zone.hub[1]);
  const t = Math.min(1, d / 900);
  return Math.round(lerp(zone.levels[0], zone.levels[1], t));
}

// --- chunks ----------------------------------------------------------------
// lod 0: 2m grid, lod 1: 4m, lod 2: 8m, lod 3: 16m
export function genChunk(cx, cz, lod, withScatter) {
  const step = 2 << lod;
  const n = CHUNK / step + 1;
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  // heights with a one-sample border for normals
  const nb = n + 2;
  const hb = new Float32Array(nb * nb);
  for (let j = 0; j < nb; j++) for (let i = 0; i < nb; i++) hb[j * nb + i] = height(x0 + (i - 1) * step, z0 + (j - 1) * step);
  const heights = new Float32Array(n * n);
  const normals = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);
  const stone = new Float32Array(n * n);
  const grass = lod === 0 ? new Float32Array(n * n * 2) : null;
  const s = {};
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    const c = (j + 1) * nb + (i + 1);
    const h = hb[c];
    heights[k] = h;
    const dx = hb[c + 1] - hb[c - 1], dz = hb[c + nb] - hb[c - nb];
    let nx = -dx, ny = 2 * step, nz = -dz;
    const l = Math.hypot(nx, ny, nz);
    nx /= l; ny /= l; nz /= l;
    normals[k * 3] = nx; normals[k * 3 + 1] = ny; normals[k * 3 + 2] = nz;
    surface(x0 + i * step, z0 + j * step, h, 1 - ny, s);
    colors[k * 3] = s.r; colors[k * 3 + 1] = s.g; colors[k * 3 + 2] = s.b;
    stone[k] = s.stone;
    if (grass) { grass[k * 2] = s.grass; grass[k * 2 + 1] = s.grassH; }
  }
  const out = { cx, cz, lod, n, step, heights, normals, colors, stone, grass };
  if (withScatter) Object.assign(out, scatter(cx, cz, heights, n, step));
  return out;
}

const FLOWERS = ['flower_purpleA', 'flower_redA', 'flower_yellowA', 'flower_purpleB', 'flower_yellowB'];
const ROCKS = ['rock_largeA', 'rock_largeB', 'rock_largeC', 'rock_largeD'];
const ROCKS_S = ['rock_smallA', 'rock_smallB', 'rock_smallC'];
const ROCKS_T = ['rock_tallA', 'rock_tallB', 'rock_tallC'];
const STONES = ['stone_largeA', 'stone_largeB', 'stone_tallA', 'stone_tallB'];
const SHROOMS = ['mushroom_red', 'mushroom_redGroup', 'mushroom_tanGroup'];
const RUINS = ['statue_column', 'statue_columnDamaged', 'statue_columnDamaged', 'statue_obelisk', 'statue_head', 'statue_block', 'statue_ring'];

const TREE_COLORS = {
  oak: ['#6fb04c', '#5c9e44', '#7cb84e'], birch: ['#8fc25a', '#a6c85c'], blossom: ['#f2a7b8', '#f5b8c6', '#e895ac'],
  autumn: ['#d9783f', '#e2913f', '#c9603a'], bush: ['#5c9e44', '#6fae4a'], willow: ['#4f6e38', '#5a7a3c'],
  snowpine: ['#3f7a55', '#4a7f5a'], pine: ['#3f7f4f', '#467a52'], goldbirch: ['#e8b84a', '#e0a840', '#d9c060'],
  dead: ['#000000'], charred: ['#000000'],
};

function scatter(cx, cz, heights, n, step) {
  const rng = mulberry32((cx * 73856093) ^ (cz * 19349663) ^ WORLD_SEED);
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const hAt = (x, z) => {
    const i = Math.min(n - 2, Math.max(0, Math.floor((x - x0) / step))), j = Math.min(n - 2, Math.max(0, Math.floor((z - z0) / step)));
    return heights[j * n + i];
  };
  const slopeAt = (x, z) => {
    const i = Math.min(n - 2, Math.max(0, Math.floor((x - x0) / step))), j = Math.min(n - 2, Math.max(0, Math.floor((z - z0) / step)));
    const h = heights[j * n + i];
    const dx = (heights[j * n + i + 1] - h) / step, dz = (heights[(j + 1) * n + i] - h) / step;
    return 1 - 1 / Math.sqrt(1 + dx * dx + dz * dz);
  };
  const trees = [], props = [], spawns = [];
  const occupied = new Set();
  const M = 400;
  for (let m = 0; m < M; m++) {
    const x = x0 + rng() * CHUNK, z = z0 + rng() * CHUNK;
    const h = hAt(x, z);
    const zw = zoneWeights(x, z);
    // pick a zone near borders proportionally to the blend weights
    let pr = rng(), zi = zw.idx[0];
    for (let k = 0; k < 3; k++) { if ((pr -= zw.w[k]) <= 0) { zi = zw.idx[k]; break; } }
    const zone = ZONES[zi];
    const list = zone.flora.map(([k, d]) => ['tree', k, d]).concat(zone.props.map(([k, d]) => ['prop', k, d]));
    const total = list.reduce((a, e) => a + e[2], 0);
    if (rng() > total * (CHUNK * CHUNK / M)) continue;
    let r = rng() * total, pick = list[0];
    for (const e of list) { if ((r -= e[2]) <= 0) { pick = e; break; } }
    const [type, kind] = pick;
    let hubNear = false;
    for (const zn of ZONES) if (Math.hypot(x - zn.hub[0], z - zn.hub[1]) < 48) hubNear = true;
    if (hubNear) continue;
    const rd = roadDist(x, z);
    if (kind === 'lily') {
      if (h > -0.4) continue;
      props.push(['lily_large', x, 0.03, z, 1.6 + rng(), rng() * 6.28, 0, 0]);
      continue;
    }
    if (h < 1.3 || rd < 4.5) continue;
    const slope = slopeAt(x, z);
    const rot = rng() * Math.PI * 2;
    if (type === 'tree') {
      if (slope > 0.3) continue;
      const cell = `${Math.floor(x / 3.5)}:${Math.floor(z / 3.5)}`;
      if (occupied.has(cell)) continue;
      occupied.add(cell);
      if (kind === 'palm') { props.push([rng() < 0.5 ? 'tree_palmTall' : 'tree_palmBend', x, h - 0.1, z, 2.2 + rng(), rot, 0.3, 1]); continue; }
      if (kind === 'cactus') { props.push([rng() < 0.5 ? 'cactus_tall' : 'cactus_short', x, h - 0.1, z, 2.2 + rng() * 1.5, rot, 0.45, 1]); continue; }
      const cols = TREE_COLORS[kind] || TREE_COLORS.oak;
      const s = kind === 'bush' ? 0.8 + rng() * 0.6 : 0.85 + rng() * 0.55;
      trees.push([kind, x, h, z, s, rot, cols[Math.floor(rng() * cols.length)], Math.floor(rng() * 3), (rng() - 0.5)]);
    } else {
      let name, s = 1.4 + rng() * 1.2, col = 0, shadow = 1, y = h - 0.05, tint = null;
      switch (kind) {
        case 'flower': name = FLOWERS[Math.floor(rng() * 5)]; shadow = 0; break;
        case 'rock': name = ROCKS[Math.floor(rng() * 4)]; col = 0.8; y = h - 0.2; break;
        case 'rockSmall': name = ROCKS_S[Math.floor(rng() * 3)]; break;
        case 'rockTall': name = ROCKS_T[Math.floor(rng() * 3)]; s = 2.5 + rng() * 2.5; col = 0.7; break;
        case 'stone': name = STONES[Math.floor(rng() * 4)]; s = 2 + rng() * 3; col = 0.9; y = h - 0.4; break;
        case 'stoneDark': name = STONES[Math.floor(rng() * 4)]; s = 2 + rng() * 3; col = 0.9; y = h - 0.4; tint = [0.35, 0.3, 0.32]; break;
        case 'bushModel': name = rng() < 0.5 ? 'plant_bushLarge' : 'plant_bushDetailed'; break;
        case 'mushroom': name = SHROOMS[Math.floor(rng() * 3)]; break;
        case 'stump': name = ['stump_old', 'log_large', 'stump_oldTall'][Math.floor(rng() * 3)]; col = 0.5; if (slope > 0.15) continue; break;
        case 'reed': name = rng() < 0.6 ? 'grass_large' : 'plant_flatTall'; s = 1.8 + rng(); shadow = 0; break;
        case 'ruin': name = RUINS[Math.floor(rng() * RUINS.length)]; s = 2.6 + rng() * 1.2; col = 0.8; if (slope > 0.2) continue; break;
        default: continue;
      }
      props.push([name, x, y, z, s, rot, col, shadow, tint]);
    }
  }
  // creatures
  const land = (x, z) => hAt(x, z) > 0.8;
  const nSpawn = rng() < 0.55 ? 1 : 0;
  for (let i = 0; i < nSpawn; i++) {
    const x = x0 + 10 + rng() * (CHUNK - 20), z = z0 + 10 + rng() * (CHUNK - 20);
    if (!land(x, z) || slopeAt(x, z) > 0.3) continue;
    const zi = zoneWeights(x, z).idx[0];
    const zone = ZONES[zi];
    let near = false;
    for (const zn of ZONES) if (Math.hypot(x - zn.hub[0], z - zn.hub[1]) < 90) near = true;
    if (near) continue;
    const tot = zone.creatures.reduce((a, c) => a + c[1], 0);
    let r = rng() * tot, species = zone.creatures[0][0];
    for (const [sp, w] of zone.creatures) { if ((r -= w) <= 0) { species = sp; break; } }
    const level = Math.max(1, Math.min(30, levelAt(x, z) + Math.floor(rng() * 3) - 1));
    spawns.push({ id: `c${cx}_${cz}_${i}`, species, level, x, z, seed: Math.floor(rng() * 1e9), radius: 7 + rng() * 8 });
  }
  for (const zn of ZONES) {
    const [bx, bz] = zn.boss.at;
    if (Math.floor(bx / CHUNK) === cx && Math.floor(bz / CHUNK) === cz) {
      spawns.push({ id: `boss_${zn.id}`, species: zn.boss.species, level: zn.levels[1] + 2, x: bx, z: bz, seed: 99, radius: 3, boss: zn.boss.name, zone: zn.id });
    }
  }
  return { trees, props, spawns };
}

// coarse whole-world map: height, zone, water style, color
export function genMap(res) {
  const half = 4096;
  const step = (half * 2) / res;
  const h = new Float32Array(res * res);
  const zone = new Uint8Array(res * res);
  const water = new Float32Array(res * res);
  const col = new Uint8Array(res * res * 4);
  const s = {};
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const x = -half + (i + 0.5) * step, z = -half + (j + 0.5) * step;
    const k = j * res + i;
    const hh = height(x, z);
    h[k] = hh;
    surface(x, z, hh, 0, s);
    zone[k] = s.zone;
    water[k] = waterStyle(x, z);
    const g = (c) => Math.round(Math.pow(Math.min(1, c), 1 / 2.2) * 255);
    col[k * 4] = g(s.r); col[k * 4 + 1] = g(s.g); col[k * 4 + 2] = g(s.b); col[k * 4 + 3] = 255;
  }
  return { res, h, zone, water, col };
}
