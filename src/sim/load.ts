import world from '../data/generated/world.json';
import features from '../data/generated/features.json';
import { setGeoRef } from './geoRef';
import { buildGeo, type Geo, type RawWorld } from './geo';

let cached: Geo | null = null;
export function loadGeo(): Geo {
  cached ??= buildGeo(world as unknown as RawWorld, (features as unknown as { provCity: Record<number, string> }).provCity);
  setGeoRef(cached);
  return cached;
}
