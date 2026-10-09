import world from '../data/generated/world.json';
import { buildGeo, type Geo, type RawWorld } from './geo';

let cached: Geo | null = null;
export function loadGeo(): Geo {
  return (cached ??= buildGeo(world as unknown as RawWorld));
}
