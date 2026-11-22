// Procedural naming for creatures, species and tribes.
const A = ['ka', 'zu', 'mor', 'vel', 'tha', 'ri', 'on', 'sha', 'ul', 'dra', 'xi', 'lo', 'ne', 'qua', 'bri', 'ost', 'fen', 'yar', 'gol', 'mi', 'tor', 'ae', 'vin', 'ska'];
const B = ['ra', 'ni', 'th', 'lo', 'mek', 'sa', 'dun', 'vi', 'ka', 'rel', 'ox', 'ia', 'um', 'en', 'ar', 'is', 'go', 'te'];
const C = ['n', 'th', 'x', 'l', 'ra', 'i', 'or', 'ash', 'um', 'el', 'ek', 'a', 'is', 'on'];
const LAT_A = ['Proto', 'Neo', 'Ortho', 'Macro', 'Micro', 'Pseudo', 'Meso', 'Para', 'Xeno', 'Archeo', 'Cryo', 'Pyro'];
const LAT_B = ['morphus', 'pod', 'saurus', 'cyte', 'raptor', 'vorax', 'grazer', 'lopex', 'therium', 'nyx', 'phagus', 'cephalon'];

const cap = (s) => s[0].toUpperCase() + s.slice(1);

export function creatureName(rng) {
  return cap(rng.pick(A) + rng.pick(B) + (rng.chance(0.5) ? rng.pick(C) : ''));
}
export function speciesName(rng) {
  return rng.pick(LAT_A) + rng.pick(LAT_B);
}
export function tribeName(rng) {
  const roots = ['Ash', 'Ember', 'Stone', 'River', 'Moss', 'Thorn', 'Sun', 'Storm', 'Bone', 'Tide', 'Frost', 'Fern', 'Iron', 'Dusk', 'Amber', 'Wolf', 'Crow', 'Salt'];
  const style = rng.int(0, 2);
  const core = cap(rng.pick(A) + rng.pick(B));
  if (style === 0) return `${core}i`;
  if (style === 1) return `${rng.pick(roots)}-${core.toLowerCase()}`;
  return `${core}${rng.pick(C)}`;
}

export const TRIBE_COLORS = [
  '#ff6b4a', '#4ac3ff', '#ffd24a', '#b56bff', '#4aff9e', '#ff4ab8',
  '#ff9f2e', '#2ee6d6', '#d7ff4a', '#7a8cff', '#ff7a7a', '#56e05a',
];
