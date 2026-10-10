/** Events need province names but only receive the state; the active Geo is registered here once at game start. */
import type { Geo } from './geo';
let g: Geo | null = null;
export const setGeoRef = (geo: Geo) => { g = geo; };
export const geoRefGet = (): Geo => g as Geo;
