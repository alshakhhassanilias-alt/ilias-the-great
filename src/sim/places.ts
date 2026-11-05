/** Real place names: the main city of each game region (from the map's city data), for events and stories. */
import features from '../data/generated/features.json';
import { geoRefGet } from './geoRef';

const PROV_CITY = (features as unknown as { provCity: Record<string, string> }).provCity;
/** The main city of a region, or the region's own name when it has none. */
export function placeName(p: number): string {
  return PROV_CITY[String(p)] ?? geoRefGet()?.provinces[p]?.name ?? 'the region';
}
/** "Kraków (South Poland)" style label: the city and its region. */
export function placeLabel(p: number): string {
  const city = PROV_CITY[String(p)], region = geoRefGet()?.provinces[p]?.name;
  return city && region && city !== region ? `${city}, ${region}` : city ?? region ?? 'the region';
}
