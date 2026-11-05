import fs from 'node:fs';
import { buildGeo, type RawWorld } from '../src/sim/geo';
import { createGame } from '../src/sim/init';
import { tick } from '../src/sim/tick';
import { DEFAULT_SETTINGS } from '../src/sim/types';
import { NAME_TO_ID } from '../src/sim/relations';
import { factors, taxBurden } from '../src/sim/economy';
const raw = JSON.parse(fs.readFileSync('src/data/generated/world.json', 'utf8')) as RawWorld;
const geo = buildGeo(raw);
const s = createGame(geo, { ...DEFAULT_SETTINGS }, NAME_TO_ID['Germany']);
const names = (process.argv[3] ?? 'China,Russia').split(',');
const years = Number(process.argv[2] ?? 9);
for (let i = 1; i <= years * 52; i++) {
  tick(s, geo);
  if (i % 52 === 0) {
    console.log(`== year ${i / 52} market E ${s.market.priceE.toFixed(2)} F ${s.market.priceF.toFixed(2)} scarcity ${s.market.scarcityE.toFixed(2)}/${s.market.scarcityF.toFixed(2)}`);
    for (const n of names) {
      const c = s.countries[NAME_TO_ID[n]], e = c.eco;
      const f = factors(c, s.market.priceE);
      console.log(n, 'f', Object.entries(f).map(([k, v]) => k + ':' + v.toFixed(2)).join(' '),
        '| enUnmet', e.energyUnmet.toFixed(2), 'foodUnmet', e.foodUnmet.toFixed(2), 'trade', e.tradeIndex.toFixed(2), 'stab', e.stability.toFixed(0), 'u', e.unemployment.toFixed(2),
        'infra', e.infra.toFixed(0), 'dmg', e.damage.toFixed(2), 'tax', taxBurden(c.budget).toFixed(2), 'soc', c.budget.social.toFixed(3), 'mil', c.budget.military.toFixed(3),
        'debt', (e.debt / e.gdp).toFixed(2), 'rate', e.avgRate.toFixed(3), 'infl', e.inflation.toFixed(3), 'cap/Y', (e.capital / e.realGdp).toFixed(2), 'tfp', e.tfp.toFixed(2), 'L', (e.laborForce / 1e6).toFixed(0), 'troops', (c.mil.troops / 1e6).toFixed(2));
    }
  }
}
