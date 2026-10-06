// generates terrain chunks off the main thread
import { genChunk, genMap } from './gen.js';

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'chunk') {
    const c = genChunk(m.cx, m.cz, m.lod, m.scatter);
    c.id = m.id;
    const transfer = [c.heights.buffer, c.normals.buffer, c.colors.buffer, c.stone.buffer];
    if (c.grass) transfer.push(c.grass.buffer);
    self.postMessage({ type: 'chunk', chunk: c }, transfer);
  } else if (m.type === 'map') {
    const map = genMap(m.res);
    self.postMessage({ type: 'map', map, id: m.id }, [map.h.buffer, map.zone.buffer, map.water.buffer, map.col.buffer]);
  }
};
