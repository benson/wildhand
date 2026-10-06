// the continent's zones. pure data, shared by the main thread and the chunk worker.
// coordinates in meters; -z is north. the continent spans roughly ±3400m.

export const WORLD_SEED = 7331;
export const WORLD_HALF = 4096; // world extent: 8192m square
export const CONTINENT_R = 3300;
export const CHUNK = 128;

// kind picks the terrain recipe in gen.js
export const ZONES = [
  {
    id: 'hearthvale', name: 'hearthvale', kind: 'meadow', center: [0, 300], hub: [0, 300], hubName: 'hearthtown',
    levels: [1, 5], blurb: 'rolling meadows around the first hearth',
    colors: { grassA: '#5f9c3a', grassB: '#8cb84a', rock: '#a39587', ground: '#b78f5c', sand: '#e9d39b' },
    grass: { density: 1, height: 1 },
    fog: '#e9c9a8', sky: '#3f86d8', horizon: '#ffd7b0', particles: 'pollen',
    flora: [['oak', 0.0011], ['birch', 0.0004], ['blossom', 0.00035], ['bush', 0.0004]],
    props: [['flower', 0.012], ['rock', 0.0012], ['bushModel', 0.0008]],
    creatures: [['mossling', 5], ['cinderpup', 4], ['buzzlet', 3], ['peeplet', 4]],
    boss: { species: 'thornhog', name: 'old bristle', at: [380, 640] },
  },
  {
    id: 'whisperwood', name: 'whisperwood', kind: 'forest', center: [1500, -100], hub: [1250, 40], hubName: 'mossgate',
    levels: [5, 10], blurb: 'an old forest that hums when the wind is still',
    colors: { grassA: '#2f6b35', grassB: '#4f8a3a', rock: '#8a8a78', ground: '#7d5b3a', sand: '#c9b27a' },
    grass: { density: 1, height: 1.3 },
    fog: '#b9c9a0', sky: '#4f8fc0', horizon: '#e6e8c0', particles: 'fireflies',
    flora: [['oak', 0.0075], ['birch', 0.0015], ['autumn', 0.0012], ['bush', 0.002]],
    props: [['mushroom', 0.006], ['stump', 0.0012], ['rock', 0.001], ['bushModel', 0.002]],
    creatures: [['mossling', 2], ['thornhog', 4], ['drowsel', 4], ['shadepaw', 3], ['inchwyrm', 3]],
    boss: { species: 'drowsel', name: 'the drowsing king', at: [1900, -350] },
  },
  {
    id: 'coralreach', name: 'coral reach', kind: 'coast', center: [-1600, 650], hub: [-1350, 520], hubName: 'driftmoor',
    levels: [6, 11], blurb: 'warm shallows, palm groves and grumpy crabs',
    colors: { grassA: '#6fb04c', grassB: '#a2c75a', rock: '#c7b49a', ground: '#d8bf8a', sand: '#f1dfaa' },
    grass: { density: 0.55, height: 0.9 },
    fog: '#f2d6b8', sky: '#3a9ee0', horizon: '#ffe2c0', particles: 'pollen',
    flora: [['palm', 0.002], ['bush', 0.0008], ['oak', 0.0003]],
    props: [['rockSmall', 0.002], ['flower', 0.003]],
    creatures: [['shellback', 4], ['waddlewave', 4], ['coconaut', 4], ['zapwing', 2]],
    boss: { species: 'shellback', name: 'captain pincer', at: [-2050, 900] },
  },
  {
    id: 'saltmarsh', name: 'saltmarsh', kind: 'swamp', center: [1350, 1450], hub: [1050, 1250], hubName: 'reedwatch',
    levels: [9, 14], blurb: 'brackish pools under a low green haze',
    colors: { grassA: '#4d6b34', grassB: '#6f7f3c', rock: '#6f6a5a', ground: '#5c4a32', sand: '#8a7a55' },
    grass: { density: 1.1, height: 1.7 },
    fog: '#a9b48c', sky: '#6a8a88', horizon: '#c9cfa8', particles: 'fireflies', water: 'swamp',
    flora: [['willow', 0.0025], ['dead', 0.0012], ['bush', 0.0015]],
    props: [['reed', 0.006], ['mushroom', 0.002], ['stump', 0.0015], ['lily', 0.003]],
    creatures: [['bogbeaver', 4], ['mudsnout', 4], ['inchwyrm', 3], ['waddlewave', 2]],
    boss: { species: 'bogbeaver', name: 'the mirefather', at: [1650, 1750] },
  },
  {
    id: 'sunscorch', name: 'sunscorch', kind: 'desert', center: [-250, 2050], hub: [-100, 1650], hubName: 'dustwell',
    levels: [12, 17], blurb: 'red mesas, dry wind and things that bask',
    colors: { grassA: '#b59a5a', grassB: '#c9ab62', rock: '#c0704a', ground: '#e0b070', sand: '#ecc88a' },
    grass: { density: 0.14, height: 0.6 },
    fog: '#f0c890', sky: '#4a8ad0', horizon: '#ffd8a0', particles: 'dust',
    flora: [['cactus', 0.0012], ['dead', 0.0005], ['palm', 0.0002]],
    props: [['rockTall', 0.0015], ['rock', 0.001], ['rockSmall', 0.0015]],
    creatures: [['dunestrider', 4], ['cinderpup', 2], ['sandtusk', 2], ['buzzlet', 2]],
    boss: { species: 'sandtusk', name: 'the dune colossus', at: [150, 2450] },
  },
  {
    id: 'frostpeak', name: 'frostpeak', kind: 'mountains', center: [-650, -1750], hub: [-450, -1250], hubName: 'cold hollow',
    levels: [16, 22], blurb: 'wind-cut peaks above the treeline',
    colors: { grassA: '#7f9a7a', grassB: '#a3b39a', rock: '#9a9aa6', ground: '#9a8f86', sand: '#d8d6d0', snow: '#f4f7fb' },
    ambient: 1.8,
    grass: { density: 0.25, height: 0.7 },
    fog: '#d8e2ee', sky: '#5a8ac8', horizon: '#e6eef8', particles: 'snow',
    flora: [['snowpine', 0.0022], ['pine', 0.0008]],
    props: [['stone', 0.0016], ['rockSmall', 0.001]],
    creatures: [['floepaw', 3], ['waddlewave', 3], ['stormstripe', 2], ['zapwing', 2]],
    boss: { species: 'floepaw', name: 'hoarfang', at: [-800, -2150] },
  },
  {
    id: 'embercaldera', name: 'ember caldera', kind: 'volcano', center: [1650, -1750], hub: [1150, -1350], hubName: 'ashfall',
    levels: [20, 26], blurb: 'black rock and rivers of slow fire',
    colors: { grassA: '#6a5a44', grassB: '#7e6a48', rock: '#5e4e4c', ground: '#6a5040', sand: '#6a5a50' },
    ambient: 1.7,
    grass: { density: 0.08, height: 0.5 },
    fog: '#a0685a', sky: '#6a4a6a', horizon: '#f0a070', particles: 'embers', water: 'lava',
    flora: [['charred', 0.0012], ['dead', 0.0006]],
    props: [['stoneDark', 0.002], ['rockSmall', 0.001]],
    creatures: [['magmox', 4], ['cinderhound', 4], ['solmane', 2], ['emberhorn', 2]],
    boss: { species: 'solmane', name: 'the pyrelord', at: [1650, -1520] },
    volcano: [1650, -1750],
  },
  {
    id: 'highlands', name: 'the shattered highlands', kind: 'highlands', center: [-2050, -650], hub: [-1600, -500], hubName: 'last light',
    levels: [24, 30], blurb: 'broken plateaus and the ruins of whoever came first',
    colors: { grassA: '#8a9a4e', grassB: '#b8a85a', rock: '#a89a8a', ground: '#9a8060', sand: '#d0c090' },
    grass: { density: 0.75, height: 1.1 },
    fog: '#d8c8b0', sky: '#5a78b8', horizon: '#f0d8b8', particles: 'pollen',
    flora: [['goldbirch', 0.0014], ['pine', 0.0012], ['bush', 0.0006]],
    props: [['ruin', 0.0012], ['stone', 0.0012], ['rock', 0.0008]],
    creatures: [['stormstripe', 3], ['bamboozle', 3], ['emberhorn', 3], ['sandtusk', 1], ['floepaw', 1]],
    boss: { species: 'stormstripe', name: 'the last warden', at: [-2400, -800] },
  },
];

export const ZONE_BY_ID = Object.fromEntries(ZONES.map((z) => [z.id, z]));

// each zone opens once the previous zone's boss has fallen
export const zoneGate = (i) => (i > 0 ? ZONES[i - 1] : null);
export const zoneOpen = (profile, i) => !zoneGate(i) || (profile.bosses || []).includes(zoneGate(i).id);

// dirt roads between hubs
export const ROADS = [
  ['hearthvale', 'whisperwood'], ['hearthvale', 'coralreach'], ['hearthvale', 'sunscorch'],
  ['hearthvale', 'frostpeak'], ['whisperwood', 'saltmarsh'], ['whisperwood', 'embercaldera'],
  ['frostpeak', 'highlands'], ['coralreach', 'highlands'], ['saltmarsh', 'sunscorch'],
];
