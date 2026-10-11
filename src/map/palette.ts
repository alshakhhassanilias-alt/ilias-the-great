/**
 * National map colours. Well-known countries get a fixed, recognisable colour (inspired by flags and classic
 * strategy-game maps); everyone else gets a generated hue chosen to contrast with their neighbours.
 */
import type { Country } from '../sim/types';

const NATIONAL: Record<string, [number, number, number]> = {
  Germany: [30, 6, 46], France: [222, 58, 52], 'United Kingdom': [356, 60, 46], Italy: [118, 42, 44], Spain: [44, 76, 52], Portugal: [140, 42, 40],
  Poland: [348, 56, 58], Russia: [355, 46, 33], Ukraine: [50, 82, 55], Belarus: [78, 30, 46], Netherlands: [26, 86, 55], Belgium: [48, 70, 50],
  Switzerland: [2, 62, 52], Austria: [0, 42, 64], Czechia: [205, 46, 50], Slovakia: [228, 32, 62], Hungary: [100, 34, 54], Romania: [215, 46, 54],
  Bulgaria: [150, 36, 44], Greece: [204, 62, 62], Serbia: [10, 40, 50], Croatia: [228, 50, 44], Sweden: [212, 62, 54], Norway: [8, 52, 46],
  Finland: [196, 38, 74], Denmark: [354, 50, 56], Ireland: [130, 50, 48], Turkey: [176, 44, 40], Iran: [96, 34, 38], Iraq: [32, 44, 46],
  'Saudi Arabia': [100, 52, 32], Egypt: [40, 55, 56], Israel: [210, 70, 62], Syria: [345, 30, 44], Kazakhstan: [190, 52, 50], Pakistan: [150, 44, 34],
  India: [30, 78, 56], China: [8, 62, 46], Japan: [350, 28, 78], 'South Korea': [210, 32, 72], 'North Korea': [355, 52, 40], Mongolia: [200, 44, 44],
  Indonesia: [0, 52, 54], Vietnam: [52, 70, 48], Thailand: [235, 40, 56], Philippines: [212, 54, 52], Australia: [36, 58, 54], 'New Zealand': [190, 30, 50],
  'United States of America': [214, 54, 44], Canada: [4, 58, 54], Mexico: [138, 40, 40], Brazil: [100, 48, 42], Argentina: [196, 56, 64],
  Chile: [354, 46, 50], Colombia: [48, 76, 50], Venezuela: [16, 58, 50], Peru: [6, 40, 60], Cuba: [214, 40, 46],
  Nigeria: [126, 46, 42], 'South Africa': [30, 46, 50], Ethiopia: [56, 56, 48], Algeria: [148, 34, 46], Morocco: [2, 50, 44], Libya: [70, 40, 46],
  'Dem. Rep. Congo': [196, 52, 48], Kenya: [10, 44, 44], Afghanistan: [60, 20, 46], Myanmar: [72, 44, 46],
};

export function nationalHsl(c: Pick<Country, 'name' | 'color' | 'id'>): [number, number, number] {
  return NATIONAL[c.name] ?? [c.color, 52 + (c.id % 4) * 5, 44 + (c.id % 3) * 4];
}
export const nationalColor = (c: Pick<Country, 'name' | 'color' | 'id'>) => { const [h, s, l] = nationalHsl(c); return `hsl(${h},${s}%,${l}%)`; };
