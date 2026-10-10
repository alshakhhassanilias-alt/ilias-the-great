import world from '../data/generated/world.json';
import { setGeoRef } from './geoRef';
import { buildGeo, type Geo, type RawWorld } from './geo';

let cached: Geo | null = null;
export function loadGeo(): Geo {
  cached ??= buildGeo(world as unknown as RawWorld);
  setGeoRef(cached);
  return cached;
}
