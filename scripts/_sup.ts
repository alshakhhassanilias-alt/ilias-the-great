import fs from 'node:fs';
import { buildGeo, type RawWorld } from '../src/sim/geo';
import { createGame } from '../src/sim/init';
import { DEFAULT_SETTINGS } from '../src/sim/types';
import { NAME_TO_ID } from '../src/sim/relations';
import { supplyNet, landSupply } from '../src/sim/supply';
import { declareWar } from '../src/sim/war';
const raw = JSON.parse(fs.readFileSync('src/data/generated/world.json', 'utf8')) as RawWorld;
const geo = buildGeo(raw);
const s = createGame(geo, { ...DEFAULT_SETTINGS }, NAME_TO_ID['Germany']);
for (const [a, d] of [['Russia','Ukraine'],['Russia','China'],['United States of America','Mexico'],['India','China'],['Germany','Poland'],['Brazil','Argentina'],['China','India']]) {
  const A = s.countries[NAME_TO_ID[a]], D = s.countries[NAME_TO_ID[d]];
  declareWar(s, geo, A.id, D.id);
  s.tick++;
  const net = supplyNet(s, geo, A.id); const dnet = supplyNet(s, geo, D.id);
  const res: string[] = [];
  for (const q of D.provinces) if (geo.adj[q].some(p => s.owner[p] === A.id)) { const ls = landSupply(s, geo, net, q); res.push(`${geo.provinces[q].name}:${ls.supply.toFixed(2)}(${ls.cost.toFixed(0)})`); }
  console.log(a, '->', d, 'reach', net.reach.toFixed(0), 'cap', net.capacity.toFixed(2), 'pockets A', net.pocket.map(p=>geo.provinces[p].name).join(','), 'D', dnet.pocket.map(p=>geo.provinces[p].name).join(','));
  console.log('   ', res.slice(0, 12).join('  '));
}
