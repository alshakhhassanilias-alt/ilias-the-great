/**
 * National paths: every country has its own road. Twenty major countries have hand-written trees of national
 * projects that follow their real dilemmas (China's Taiwan question, Germany's debt brake, Iran's bomb or a deal,
 * Poland as NATO's eastern bastion...); every other country gets a path that fits its situation (an oil state,
 * an emerging economy, a small state, a developed one). You run one project at a time: it costs political
 * capital and money up front, takes weeks, and when it completes it changes the country for good. Branches
 * exclude each other, so two playthroughs of the same country can go very differently.
 *
 * AI countries walk their own paths too (a project every year or two), so the world around you changes: China
 * may build a blue-water navy and press the Taiwan question; Iran may cross the nuclear threshold.
 */
import { clamp } from './util';
import { hash01, nextRand } from './rng';
import { logEvent } from './log';
import { NAME_TO_ID, addRelation, areAtWar, getRelation } from './relations';
import { applyTreaty, neighborsOf, type Proposal } from './diplomacy';
import { fund } from './actions';
import { sway, spendPC } from './domestic';
import { isMajor } from './drama';
import type { Eff } from './doctrines';
import type { Geo } from './geo';
import type { Country, FactionId, GameState } from './types';

export interface Fx {
  eff?: Eff;
  stab?: number; rep?: number; infra?: number; tech?: number; milTech?: number; readiness?: number;
  /** multipliers: 0.08 = +8% */
  energy?: number; food?: number; capital?: number; troops?: number; labour?: number;
  /** one-off money as a share of GDP (negative = a cost) */
  cash?: number;
  /** equipment bought, as a share of GDP */
  army?: number; air?: number; navy?: number;
  nuclear?: boolean;
  fac?: Partial<Record<FactionId, number>>;
  rel?: [string, number][];
  treaty?: [string, Proposal][];
  /** a justified cause for war against this country (smaller diplomatic fallout) */
  cb?: string;
}
export interface NatNode { id: string; icon: string; title: string; desc: string; weeks: number; pc: number; cost: number; fx: Fx; req?: string[]; any?: string[]; excl?: string[]; news?: string }
export interface NatPath { key: string; title: string; intro: string; nodes: NatNode[] }

const N = (id: string, icon: string, title: string, desc: string, weeks: number, pc: number, cost: number, fx: Fx, more: Partial<NatNode> = {}): NatNode => ({ id, icon, title, desc, weeks, pc, cost, fx, ...more });

// ------------------------------------------------------------------ the twenty great stories
export const PATHS: Record<string, NatPath> = {
  'United States of America': { key: 'usa', title: 'The American Century', intro: 'The world\'s largest economy and military faces a rising China, a hollowed-out industrial heartland and a public tired of foreign wars. Rebuild at home, lead abroad, or pull up the drawbridge.', nodes: [
    N('us_chips', '💾', 'CHIPS for America', 'Chip fabs in Arizona and Ohio, so the next crisis cannot cut off the supply.', 26, 12, 0.006, { eff: { tfp: 0.002 }, tech: 3, fac: { business: 6, labour: 4 } }),
    N('us_grid', '⚡', 'Rebuild the Grid', 'A trillion-dollar programme for power lines, bridges and ports.', 24, 10, 0.008, { infra: 6, energy: 0.05, fac: { regions: 8, labour: 6 } }),
    N('us_tariffs', '🏭', 'Reshoring Tariffs', 'Walls of tariffs to bring factories home.', 16, 10, 0, { capital: 0.02, eff: { tfp: -0.001, stab: 1 }, rel: [['China', -15], ['Mexico', -6], ['Germany', -5]], fac: { labour: 10, business: -8, nationalists: 6 } }, { req: ['us_chips'], excl: ['us_americas'] }),
    N('us_americas', '🌎', 'Free Trade of the Americas', 'One market from Alaska to Patagonia.', 20, 12, 0, { treaty: [['Mexico', 'trade'], ['Canada', 'trade'], ['Brazil', 'trade'], ['Argentina', 'trade']], rep: 3, fac: { business: 10, labour: -6 } }, { excl: ['us_tariffs'] }),
    N('us_pacific', '⚓', 'Pivot to the Pacific', 'Carrier groups, Marines and bases from Japan to the Philippines.', 20, 10, 0.004, { navy: 0.003, rel: [['Japan', 10], ['South Korea', 10], ['Philippines', 10], ['Australia', 8], ['China', -10]], fac: { military: 6 } }),
    N('us_arsenal', '🛡', 'Arsenal of Democracy', 'Restart the munitions lines and arm your friends.', 24, 12, 0.006, { army: 0.004, air: 0.002, eff: { def: 1.05 }, rel: [['Poland', 8], ['Ukraine', 10], ['Taiwan', 10], ['Israel', 6]], fac: { military: 8 } }, { req: ['us_pacific'] }),
    N('us_dome', '🚀', 'Golden Dome', 'A missile shield over the whole continent.', 40, 16, 0.015, { eff: { deter: 0.85 }, milTech: 3, fac: { military: 10, liberals: -6 } }, { req: ['us_arsenal'], news: 'The United States switches on a continental missile shield. Rivals call it destabilising.' }),
    N('us_border', '🧱', 'Secure the Border', 'Troops, walls and fast deportations.', 16, 10, 0.003, { stab: 2, rel: [['Mexico', -8]], fac: { nationalists: 12, liberals: -10, business: -3 } }),
  ] },
  China: { key: 'china', title: 'The Chinese Dream', intro: 'A superpower in the making, facing a shrinking workforce, a property bubble, a chip blockade and the unfinished business of Taiwan.', nodes: [
    N('cn_common', '🤝', 'Common Prosperity', 'Rein in the billionaires; spread the wealth.', 20, 10, 0.004, { eff: { stab: 2 }, stab: 2, fac: { labour: 10, business: -8 } }),
    N('cn_property', '🏚', 'Defuse the Property Bubble', 'Let the zombie developers die, slowly.', 24, 12, 0.01, { eff: { tfp: 0.001 }, stab: 1, fac: { business: -4, regions: -4 } }),
    N('cn_mic', '🔬', 'Made in China 2035', 'World leadership in ten strategic industries.', 30, 12, 0.008, { eff: { tfp: 0.0025 }, tech: 4, fac: { business: 6 } }),
    N('cn_chips', '💾', 'Break the Chip Blockade', 'Home-grown lithography at any price.', 30, 12, 0.01, { milTech: 3, tech: 3, rel: [['United States of America', -8]] }, { req: ['cn_mic'] }),
    N('cn_bri', '🛤', 'Belt and Road 2.0', 'Ports, railways and loans from Karachi to Lagos.', 26, 12, 0.012, { rel: [['Pakistan', 12], ['Kazakhstan', 10], ['Indonesia', 8], ['Nigeria', 10], ['Egypt', 8], ['Iran', 8], ['Brazil', 6]], treaty: [['Pakistan', 'trade'], ['Kazakhstan', 'trade']], rep: 2 }),
    N('cn_yuan', '💴', 'A World Currency', 'Settle oil and trade in yuan.', 24, 10, 0, { eff: { accept: 0.04 }, rep: 2, fac: { business: 6 } }, { req: ['cn_bri'] }),
    N('cn_navy', '⚓', 'Blue-Water Navy', 'Six carrier groups by the end of the decade.', 36, 14, 0.012, { navy: 0.006, eff: { off: 1.03 }, fac: { military: 8, nationalists: 6 } }),
    N('cn_taiwan', '🎯', 'The Taiwan Question', 'Make reunification a matter of when, not if.', 20, 14, 0, { cb: 'Taiwan', rel: [['Taiwan', -30], ['United States of America', -15], ['Japan', -10]], fac: { nationalists: 15, liberals: -10, business: -6 } }, { req: ['cn_navy'], news: 'Beijing declares the Taiwan question "can no longer be passed from generation to generation".' }),
  ] },
  Russia: { key: 'russia', title: 'Fortress Russia', intro: 'Sanctioned by the West, rich in oil, grain and nuclear warheads, short of people. Dig in, turn east, or reach for the near abroad.', nodes: [
    N('ru_fortress', '🏰', 'Fortress Economy', 'Import substitution and a war-proof budget.', 20, 10, 0.004, { eff: { stab: 2 }, capital: 0.01, fac: { nationalists: 8, business: -4 } }),
    N('ru_east', '🐉', 'Pivot to the East', 'Pipelines and payments that bypass the West.', 22, 10, 0, { rel: [['China', 15], ['India', 8], ['Iran', 6]], treaty: [['China', 'trade']] }, { req: ['ru_fortress'] }),
    N('ru_eurasia', '🤝', 'Eurasian Union', 'Bind the old republics together again.', 22, 10, 0.003, { rel: [['Belarus', 12], ['Kazakhstan', 10], ['Armenia', 8]], treaty: [['Belarus', 'trade'], ['Kazakhstan', 'trade']] }),
    N('ru_arctic', '🧊', 'Northern Sea Route', 'Ice-breakers and LNG through the Arctic.', 30, 12, 0.008, { energy: 0.06, infra: 3, cash: 0.006, fac: { business: 6 } }),
    N('ru_grain', '🌾', 'Grain Superpower', 'Feed Africa and the Middle East, and win friends.', 18, 8, 0.002, { food: 0.1, rel: [['Egypt', 8], ['Turkey', 5], ['Algeria', 6]], fac: { regions: 8 } }),
    N('ru_army', '🎖', 'Military Reform', 'Contract soldiers, drones and new tank factories.', 28, 12, 0.01, { eff: { off: 1.05 }, readiness: 0.1, army: 0.004, fac: { military: 10 } }),
    N('ru_near', '🎯', 'The Near Abroad', 'Declare the neighbours a zone of privileged interest.', 16, 12, 0, { cb: 'Ukraine', rel: [['Ukraine', -20], ['Georgia', -15], ['Moldova', -15], ['Poland', -8]], fac: { nationalists: 12, liberals: -10 } }, { req: ['ru_army'], news: 'Moscow declares the former Soviet republics "a zone of vital interest". Neighbours mobilise.' }),
  ] },
  India: { key: 'india', title: 'Viksit Bharat 2047', intro: 'The most populous country on earth wants to be a developed one by its hundredth birthday, and a great power that answers to no one.', nodes: [
    N('in_make', '🏭', 'Make in India', 'Factory zones and incentives to pull manufacturing from China.', 24, 10, 0.006, { capital: 0.03, eff: { tfp: 0.002 }, fac: { business: 8, labour: 4 } }),
    N('in_digital', '📱', 'India Stack', 'Digital ID, payments and services for 1.4 billion people.', 20, 8, 0.004, { tech: 4, eff: { tfp: 0.0015 }, fac: { liberals: 4 } }),
    N('in_roads', '🛣', 'Freight Corridors', 'Highways and dedicated freight railways.', 30, 12, 0.012, { infra: 8, fac: { regions: 8 } }),
    N('in_himalaya', '🏔', 'Himalayan Border Roads', 'Roads and tunnels up to the Line of Actual Control.', 26, 10, 0.006, { eff: { def: 1.05 }, rel: [['China', -6]], fac: { military: 8 } }, { req: ['in_roads'] }),
    N('in_quad', '⚓', 'Join the Quad', 'Stand with Washington, Tokyo and Canberra.', 18, 10, 0, { rel: [['United States of America', 12], ['Japan', 10], ['Australia', 10], ['China', -12]], treaty: [['Japan', 'coop']] }, { excl: ['in_autonomy'] }),
    N('in_autonomy', '🕊', 'Strategic Autonomy', 'Buy Russian oil, sell to everyone, align with no one.', 18, 8, 0, { rel: [['Russia', 10], ['Iran', 6], ['Brazil', 6]], rep: 2, eff: { accept: 0.03 } }, { excl: ['in_quad'] }),
    N('in_solar', '☀', 'Solar Superpower', 'The world\'s largest solar parks in Rajasthan and Gujarat.', 26, 10, 0.008, { energy: 0.07, rep: 3 }),
  ] },
  Japan: { key: 'japan', title: 'A Normal Nation', intro: 'An ageing, shrinking, wealthy island nation next to China and a nuclear North Korea. Re-arm, open the doors, or automate the future.', nodes: [
    N('jp_strike', '🛡', 'Counter-Strike Capability', 'Long-range missiles and a doubled defence budget.', 26, 12, 0.008, { eff: { def: 1.04, off: 1.04 }, army: 0.002, air: 0.003, fac: { military: 10, nationalists: 8, liberals: -8 } }),
    N('jp_society5', '🤖', 'Society 5.0', 'Robots and AI to make up for a shrinking workforce.', 26, 10, 0.006, { eff: { tfp: 0.002 }, tech: 3, fac: { business: 6 } }),
    N('jp_doors', '🧳', 'Open the Door', 'Work visas for a million foreign workers.', 18, 12, 0, { labour: 0.03, fac: { business: 10, nationalists: -12 } }),
    N('jp_reactors', '⚛', 'Restart the Reactors', 'Bring the idle nuclear plants back online.', 20, 10, 0.003, { energy: 0.08, fac: { business: 6, liberals: -6 } }),
    N('jp_pacific', '⚓', 'Pacific Alliance', 'Tie the democracies of the Pacific together.', 20, 10, 0, { treaty: [['Philippines', 'coop'], ['Australia', 'coop']], rel: [['United States of America', 8], ['China', -10]] }, { req: ['jp_strike'] }),
    N('jp_korea', '🤝', 'Reset with Seoul', 'Put history aside for the sake of security.', 14, 8, 0, { rel: [['South Korea', 15]], fac: { nationalists: -6, liberals: 4 } }),
  ] },
  Germany: { key: 'germany', title: 'Zeitenwende', intro: 'Europe\'s industrial heart lost its cheap Russian gas and its illusions. Re-arm, re-tool, and decide whether to keep the debt brake.', nodes: [
    N('de_fund', '🛡', 'The Bundeswehr Fund', 'A €100 billion special fund for the armed forces.', 26, 12, 0.01, { army: 0.006, air: 0.003, readiness: 0.1, fac: { military: 12, liberals: -4 } }),
    N('de_energy', '⚡', 'Energy Independence', 'LNG terminals, wind in the North Sea, no more Russian gas.', 24, 10, 0.006, { energy: 0.08, rel: [['Russia', -8]], fac: { liberals: 6, regions: -4 } }),
    N('de_brake', '📏', 'Reform the Debt Brake', 'Borrow to rebuild bridges, rail and schools.', 20, 14, 0, { infra: 6, capital: 0.02, fac: { labour: 6, business: -4 } }, { excl: ['de_zero'] }),
    N('de_zero', '🧮', 'Keep the Black Zero', 'Balanced books, whatever the cost.', 16, 8, 0, { stab: 1, rep: 2, fac: { business: 8, labour: -6 } }, { excl: ['de_brake'] }),
    N('de_mittelstand', '🏭', 'Mittelstand 4.0', 'Digitise the family firms that make the world\'s machines.', 24, 10, 0.004, { eff: { tfp: 0.0015 }, tech: 2, fac: { business: 6 } }),
    N('de_europe', '🇪🇺', 'Lead Europe', 'Germany steps up as Europe\'s leading power.', 22, 12, 0, { rel: [['France', 10], ['Poland', 8], ['Italy', 8], ['Spain', 8], ['Netherlands', 8]], eff: { accept: 0.04 } }, { req: ['de_fund'] }),
  ] },
  'United Kingdom': { key: 'uk', title: 'Global Britain', intro: 'Outside the EU, with a stagnant economy, a creaking health service and a seat at every top table. Choose Europe or the wider world.', nodes: [
    N('uk_aukus', '⚓', 'AUKUS Submarines', 'Nuclear attack submarines with America and Australia.', 30, 12, 0.008, { navy: 0.005, milTech: 2, rel: [['United States of America', 8], ['Australia', 10]] }),
    N('uk_city', '💷', 'Big Bang 2.0', 'Deregulate the City of London.', 18, 10, 0, { eff: { tfp: 0.0015 }, fac: { business: 10, labour: -6 } }),
    N('uk_nhs', '🏥', 'Save the NHS', 'Billions for hospitals and waiting lists.', 24, 10, 0.01, { stab: 3, eff: { stab: 1 }, fac: { labour: 10, business: -4 } }),
    N('uk_eu', '🇪🇺', 'Reset with Europe', 'A new trade and security pact with the EU.', 22, 12, 0, { treaty: [['France', 'trade'], ['Germany', 'trade'], ['Netherlands', 'trade']], rel: [['France', 8], ['Germany', 8]], fac: { nationalists: -12, business: 8 } }, { excl: ['uk_indopacific'] }),
    N('uk_indopacific', '🌏', 'Indo-Pacific Tilt', 'Join the Pacific trade bloc.', 22, 12, 0, { treaty: [['Japan', 'trade'], ['Australia', 'trade'], ['Canada', 'trade']], rel: [['Japan', 6], ['Australia', 6]], fac: { nationalists: 4 } }, { excl: ['uk_eu'] }),
    N('uk_wind', '🌬', 'North Sea Wind', 'The world\'s largest offshore wind farms.', 24, 10, 0.006, { energy: 0.07, fac: { regions: 6, liberals: 4 } }),
  ] },
  France: { key: 'france', title: 'Strategic Autonomy', intro: 'A nuclear power with a permanent seat, a restless street and an ambition to make Europe a power in its own right.', nodes: [
    N('fr_epr', '⚛', 'A New Fleet of Reactors', 'Six new EPR reactors, with eight more to come.', 36, 12, 0.012, { energy: 0.09, fac: { regions: 4, liberals: -3 } }),
    N('fr_defence', '🇪🇺', 'European Defence Union', 'A common European army, under French leadership.', 24, 12, 0.004, { rel: [['Germany', 8], ['Italy', 8], ['Spain', 8]], eff: { def: 1.03 }, fac: { military: 6 } }),
    N('fr_africa', '🌍', 'Africa Reset', 'Close the bases, open new partnerships.', 18, 10, 0, { rel: [['Nigeria', 8], ['Algeria', 6], ['Morocco', 6]], rep: 2, fac: { nationalists: -4, liberals: 4 } }),
    N('fr_pensions', '👴', 'Pension Reform', 'Retire at 64, whatever the street says.', 16, 14, 0, { cash: 0.006, stab: -2, fac: { business: 10, labour: -14 } }),
    N('fr_2030', '🏭', 'France 2030', 'Bring industry home: batteries, hydrogen, chips.', 26, 10, 0.006, { eff: { tfp: 0.0015 }, tech: 2 }),
    N('fr_deterrent', '☢', 'Modernise the Deterrent', 'New submarines and hypersonic missiles.', 30, 12, 0.008, { eff: { deter: 0.9 }, milTech: 2, fac: { military: 6 } }, { req: ['fr_defence'] }),
  ] },
  Brazil: { key: 'brazil', title: 'The Giant Awakes', intro: 'A continental power with the Amazon, the pre-salt oil and vast farms, and a deep divide over which of them comes first.', nodes: [
    N('br_amazon', '🌳', 'Save the Amazon', 'Zero deforestation by 2030, paid for by the world.', 24, 10, 0.003, { rep: 5, eff: { rep: 1 }, fac: { liberals: 12, regions: -8 } }),
    N('br_agro', '🚜', 'Agribusiness Superpower', 'Feed the world from the Cerrado.', 20, 8, 0.003, { food: 0.12, cash: 0.004, fac: { regions: 12, liberals: -8 } }),
    N('br_brics', '🤝', 'The BRICS Bank', 'A development bank for the Global South.', 20, 10, 0, { rel: [['China', 8], ['India', 8], ['Russia', 5], ['South Africa', 8]], eff: { accept: 0.03 } }),
    N('br_mercosur', '🌎', 'Mercosur–EU Deal', 'The world\'s largest trade agreement, at last.', 22, 12, 0, { treaty: [['Argentina', 'trade'], ['Germany', 'trade'], ['France', 'trade']], fac: { business: 8, regions: -4 } }),
    N('br_presalt', '🛢', 'Pre-Salt Boom', 'Deep-sea oil off Rio.', 26, 10, 0.006, { energy: 0.1, cash: 0.01, fac: { liberals: -6, business: 6 } }),
    N('br_bolsa', '🏘', 'Bolsa Família 2.0', 'Cash for poor families who keep their children in school.', 18, 10, 0.008, { stab: 3, eff: { stab: 1 }, fac: { labour: 10, business: -4 } }),
  ] },
  Turkey: { key: 'turkey', title: 'The Century of Türkiye', intro: 'A bridge between continents with a drone industry, a falling currency and the ambition to be a great power in its own right.', nodes: [
    N('tr_drones', '🛩', 'Drone & Defence Industry', 'Drones, warships and a fifth-generation fighter.', 26, 12, 0.008, { air: 0.004, eff: { off: 1.04 }, milTech: 2, fac: { nationalists: 8, business: 4 } }),
    N('tr_mediator', '🕊', 'The Great Mediator', 'Host every peace talk in Istanbul.', 18, 10, 0, { rep: 4, eff: { accept: 0.04 }, rel: [['Russia', 6], ['Ukraine', 6]] }),
    N('tr_lira', '💱', 'Defend the Lira', 'Orthodox economics, at last: high rates and tight budgets.', 18, 12, 0, { stab: 2, eff: { tfp: 0.001 }, fac: { business: 8, labour: -6 } }),
    N('tr_gas', '⛽', 'Energy Hub of Eurasia', 'Pipelines from the Caspian to Europe.', 26, 10, 0.006, { energy: 0.06, cash: 0.005, rel: [['Azerbaijan', 10], ['Russia', 5]] }),
    N('tr_turkic', '🐺', 'The Turkic World', 'From the Bosphorus to Central Asia.', 18, 8, 0, { rel: [['Azerbaijan', 10], ['Kazakhstan', 10]], fac: { nationalists: 8 } }),
    N('tr_eu', '🇪🇺', 'Revive the EU Bid', 'Reform, and knock on Europe\'s door again.', 22, 12, 0, { rel: [['Germany', 6], ['France', 6], ['Greece', 6]], fac: { liberals: 12, nationalists: -10 } }),
  ] },
  Iran: { key: 'iran', title: 'The Axis of Resistance', intro: 'Under sanctions for decades, with proxies across the region and a nuclear programme on the brink. The bomb, or a deal?', nodes: [
    N('ir_axis', '🔥', 'Fund the Axis', 'Money and missiles for allies from Lebanon to Yemen.', 20, 10, 0.004, { rel: [['Syria', 10], ['Iraq', 6], ['Israel', -15], ['Saudi Arabia', -10]], eff: { deter: 0.92 }, fac: { nationalists: 10, liberals: -8 } }),
    N('ir_bomb', '☢', 'The Threshold', 'Enrich to weapons grade. Build the bomb.', 40, 16, 0.015, { nuclear: true, rel: [['United States of America', -20], ['Israel', -25], ['Saudi Arabia', -12]], fac: { nationalists: 12, liberals: -12 } }, { req: ['ir_axis'], excl: ['ir_deal'], news: 'Iran has crossed the nuclear threshold. The region holds its breath.' }),
    N('ir_deal', '🤝', 'A New Nuclear Deal', 'Give up enrichment for an end to sanctions.', 26, 14, 0, { rel: [['United States of America', 15], ['Germany', 10], ['France', 10]], rep: 5, capital: 0.02, fac: { liberals: 12, nationalists: -12, business: 8 } }, { excl: ['ir_bomb'] }),
    N('ir_resist', '🛢', 'Resistance Economy', 'Make the country sanction-proof.', 20, 8, 0.004, { eff: { stab: 1 }, capital: 0.01, food: 0.05 }),
    N('ir_east', '🐉', 'Look East', 'Oil for China, drones for Russia.', 18, 8, 0, { rel: [['China', 12], ['Russia', 10]], treaty: [['China', 'trade']] }),
    N('ir_riyadh', '🕌', 'Détente with Riyadh', 'Embassies reopen; the cold war in the Gulf thaws.', 18, 10, 0, { rel: [['Saudi Arabia', 20], ['United Arab Emirates', 10]], rep: 2 }),
  ] },
  'Saudi Arabia': { key: 'saudi', title: 'Vision 2030', intro: 'Oil money, a young population and a crown prince in a hurry: build a post-oil economy before the oil runs out.', nodes: [
    N('sa_neom', '🏙', 'NEOM', 'A city of the future in the desert.', 52, 14, 0.02, { eff: { tfp: 0.002 }, rep: 2, fac: { business: 8 } }),
    N('sa_diversify', '📈', 'Diversify the Economy', 'Tourism, mining, logistics, entertainment.', 30, 10, 0.008, { eff: { tfp: 0.0015 }, capital: 0.03 }),
    N('sa_opec', '🛢', 'OPEC+ Squeeze', 'Cut output and let prices rise.', 12, 8, 0, { cash: 0.02, rel: [['United States of America', -8], ['Russia', 6]] }),
    N('sa_yemen', '🕊', 'End the Yemen War', 'A ceasefire and reconstruction money.', 18, 10, 0.004, { stab: 2, rep: 4, fac: { military: -6 } }),
    N('sa_israel', '🤝', 'Normalise with Israel', 'The deal of the century.', 22, 14, 0, { rel: [['Israel', 25], ['United States of America', 10], ['Iran', -10]], fac: { nationalists: -10, liberals: 6, business: 6 } }),
    N('sa_pif', '💰', 'A Global Sovereign Fund', 'Buy into football clubs, chip makers and airlines.', 20, 8, 0.01, { rep: 2, eff: { accept: 0.03 } }),
  ] },
  Israel: { key: 'israel', title: 'The Iron Wall', intro: 'A small, high-tech, nuclear-armed state surrounded by enemies and divided at home.', nodes: [
    N('il_beam', '🛡', 'Iron Beam', 'Laser air defence against rockets and drones.', 26, 12, 0.008, { eff: { def: 1.06, deter: 0.93 }, milTech: 2 }),
    N('il_startup', '💻', 'Start-up Nation 2.0', 'AI, cyber and biotech.', 22, 10, 0.004, { eff: { tfp: 0.002 }, tech: 3 }),
    N('il_accords', '🤝', 'Expand the Abraham Accords', 'Peace with the Gulf monarchies.', 22, 12, 0, { rel: [['Saudi Arabia', 20], ['United Arab Emirates', 10], ['Morocco', 8]], rep: 2 }),
    N('il_judicial', '⚖', 'Judicial Overhaul', 'Curb the Supreme Court.', 16, 12, 0, { stab: -4, rep: -3, fac: { nationalists: 14, liberals: -20 } }, { excl: ['il_unity'] }),
    N('il_unity', '🕊', 'National Unity Government', 'Bring the opposition in.', 14, 12, 0, { stab: 4, fac: { liberals: 8, nationalists: -6 } }, { excl: ['il_judicial'] }),
    N('il_iran', '🎯', 'Strike the Programme', 'Plan for a strike on Iran\'s nuclear sites.', 20, 14, 0.004, { cb: 'Iran', rel: [['Iran', -25]], fac: { military: 10, nationalists: 8 } }, { req: ['il_beam'] }),
  ] },
  Poland: { key: 'poland', title: 'Bastion of the East', intro: 'NATO\'s eastern bastion and one of Europe\'s fastest-growing economies, with Russia and Belarus on the other side of the fence.', nodes: [
    N('pl_army', '🪖', 'An Army of 300,000', 'The largest land army in the European Union.', 30, 12, 0.01, { troops: 0.2, army: 0.004, fac: { military: 12, nationalists: 6 } }),
    N('pl_shield', '🧱', 'East Shield', 'Ditches, bunkers and minefields along the eastern border.', 24, 10, 0.006, { eff: { def: 1.08 }, rel: [['Belarus', -10], ['Russia', -8]], fac: { nationalists: 8 } }, { req: ['pl_army'] }),
    N('pl_cpk', '✈', 'Central Transport Hub', 'A mega-airport and high-speed rail between Warsaw and Łódź.', 30, 12, 0.01, { infra: 7, capital: 0.01, fac: { regions: 6, liberals: -2 } }),
    N('pl_nuclear', '⚛', 'Baltic Nuclear Plants', 'Poland\'s first nuclear power station, on the Baltic coast.', 40, 12, 0.012, { energy: 0.08, fac: { regions: 4 } }),
    N('pl_3seas', '🤝', 'Three Seas Initiative', 'Lead the countries between the Baltic, the Adriatic and the Black Sea.', 20, 10, 0, { rel: [['Romania', 10], ['Hungary', 8], ['Czechia', 10], ['Lithuania', 10]], treaty: [['Romania', 'trade']], eff: { accept: 0.03 } }),
    N('pl_vistula', '💻', 'Silicon Vistula', 'Chips, games and software in Kraków and Wrocław.', 24, 10, 0.004, { eff: { tfp: 0.0015 }, tech: 2, fac: { liberals: 4, business: 6 } }),
  ] },
  Ukraine: { key: 'ukraine', title: 'Unbroken', intro: 'A country that refused to fall, now rebuilding, re-arming and knocking on Europe\'s door.', nodes: [
    N('ua_drones', '🛩', 'Army of Drones', 'A million drones a year from garage workshops.', 22, 10, 0.006, { eff: { off: 1.05, def: 1.04 }, milTech: 2, fac: { military: 8 } }),
    N('ua_eu', '🇪🇺', 'The Road to Brussels', 'Reforms for EU membership.', 24, 12, 0, { rel: [['Poland', 10], ['Germany', 8], ['France', 8]], eff: { accept: 0.05 }, fac: { liberals: 10 } }),
    N('ua_rebuild', '🏗', 'Reconstruction Fund', 'Foreign billions to rebuild cities and power plants.', 30, 10, 0, { infra: 8, capital: 0.03, cash: 0.015, fac: { regions: 8 } }, { req: ['ua_eu'] }),
    N('ua_grain', '🌾', 'Black Sea Grain Corridor', 'Get the harvest out to the world.', 18, 8, 0.002, { food: 0.06, cash: 0.006, rel: [['Egypt', 6], ['Turkey', 6]] }),
    N('ua_clean', '⚖', 'Clean Government', 'An anti-corruption drive with teeth.', 20, 12, 0, { rep: 4, stab: 2, fac: { liberals: 10 } }),
    N('ua_line', '🧱', 'The Fortified Line', 'Concrete, mines and trenches along the whole front.', 24, 10, 0.008, { eff: { def: 1.08 }, rel: [['Russia', -5]] }, { req: ['ua_drones'] }),
  ] },
  'South Korea': { key: 'korea', title: 'Global Pivotal State', intro: 'A tech powerhouse with the world\'s lowest birth rate and a nuclear-armed North an hour from Seoul.', nodes: [
    N('kr_chips', '💾', 'Semiconductor Mega-Cluster', 'The largest chip complex in the world, south of Seoul.', 28, 12, 0.008, { eff: { tfp: 0.002 }, tech: 3 }),
    N('kr_defence', '🛡', 'K-Defence Exports', 'Sell tanks and howitzers to the world.', 20, 8, 0, { cash: 0.006, milTech: 2, rel: [['Poland', 10]] }),
    N('kr_birth', '👶', 'Birth Rate Emergency', 'Housing, childcare and cash for young families.', 24, 10, 0.01, { stab: 2, eff: { tfp: 0.0005 }, fac: { labour: 6 } }),
    N('kr_nuke', '☢', 'The Nuclear Option', 'Build our own deterrent.', 40, 16, 0.012, { nuclear: true, rel: [['United States of America', -10], ['China', -15], ['North Korea', -10]], fac: { nationalists: 12, liberals: -12 } }, { req: ['kr_defence'], excl: ['kr_sunshine'], news: 'South Korea announces it will build nuclear weapons.' }),
    N('kr_sunshine', '🕊', 'New Sunshine Policy', 'Talks, aid and family reunions with the North.', 20, 12, 0, { rel: [['North Korea', 20], ['China', 5]], fac: { liberals: 8, nationalists: -10 } }, { excl: ['kr_nuke'] }),
    N('kr_japan', '🤝', 'Reset with Tokyo', 'Put history aside for security.', 14, 8, 0, { rel: [['Japan', 15]], fac: { nationalists: -6 } }),
  ] },
  Indonesia: { key: 'indonesia', title: 'Golden Indonesia 2045', intro: 'A nation of 17,000 islands, the world\'s nickel and a new capital in the jungle.', nodes: [
    N('id_capital', '🏙', 'Build Nusantara', 'A new capital in Borneo, away from sinking Jakarta.', 40, 12, 0.015, { infra: 6, stab: 1, fac: { regions: 8 } }),
    N('id_nickel', '🔋', 'Nickel Downstreaming', 'Ban raw exports; build battery factories at home.', 26, 10, 0.006, { capital: 0.03, eff: { tfp: 0.0015 }, fac: { business: 6, liberals: -4 } }),
    N('id_meals', '🍚', 'Free Meals for Children', 'A free lunch for every schoolchild.', 18, 10, 0.008, { stab: 3, fac: { labour: 8 } }),
    N('id_navy', '⚓', 'Archipelago Navy', 'Patrol boats and submarines for the world\'s largest archipelago.', 26, 10, 0.006, { navy: 0.004, eff: { def: 1.04 } }),
    N('id_free', '🕊', 'Free and Active', 'Friends with all, allied with none.', 16, 8, 0, { rep: 3, eff: { accept: 0.03 } }),
    N('id_brics', '🤝', 'Join BRICS', 'A seat at the table of the Global South.', 18, 8, 0, { rel: [['China', 8], ['India', 6], ['Brazil', 6]] }),
  ] },
  Mexico: { key: 'mexico', title: 'The Fourth Transformation', intro: 'Next door to America, booming from nearshoring, bleeding from cartel violence.', nodes: [
    N('mx_near', '🏭', 'Nearshoring Boom', 'Factories leaving China come to Monterrey.', 22, 10, 0.004, { capital: 0.04, rel: [['United States of America', 8]], fac: { business: 10 } }),
    N('mx_cartels', '🚔', 'War on the Cartels', 'The National Guard against the cartels.', 26, 12, 0.006, { stab: 3, eff: { stab: 2 }, fac: { military: 8, liberals: -6 } }),
    N('mx_pemex', '🛢', 'Rescue Pemex', 'Save the state oil company.', 20, 8, 0.01, { energy: 0.06, fac: { nationalists: 8 } }),
    N('mx_corridor', '🚆', 'Interoceanic Corridor', 'A rail link between two oceans.', 30, 10, 0.008, { infra: 6, fac: { regions: 8 } }),
    N('mx_pensions', '🤲', 'Universal Pensions', 'A pension for every Mexican over 65.', 18, 10, 0.008, { stab: 3, fac: { labour: 8 } }),
    N('mx_latam', '🌎', 'Latin American Leadership', 'Speak for the region.', 16, 8, 0, { rel: [['Brazil', 8], ['Argentina', 8], ['Colombia', 8]], rep: 2 }),
  ] },
  Nigeria: { key: 'nigeria', title: 'Giant of Africa', intro: 'Africa\'s most populous nation: oil, Nollywood, fintech, and insurgencies in the north.', nodes: [
    N('ng_refinery', '🛢', 'The Mega Refinery', 'Stop importing petrol.', 26, 10, 0.006, { energy: 0.1, cash: 0.005, fac: { business: 8 } }),
    N('ng_naira', '💱', 'Unify the Naira', 'Float the currency; end the black market.', 16, 12, 0, { eff: { tfp: 0.0015 }, stab: -2, fac: { business: 10, labour: -8 } }),
    N('ng_security', '🪖', 'Defeat the Insurgency', 'An offensive against the jihadists in the north-east.', 26, 12, 0.006, { stab: 3, fac: { military: 10 } }),
    N('ng_power', '⚡', 'Light Up Nigeria', 'Fix the power grid.', 24, 10, 0.006, { energy: 0.06, infra: 4, fac: { regions: 8 } }),
    N('ng_ecowas', '🤝', 'Lead West Africa', 'Hold the region together.', 18, 8, 0, { rel: [['Ghana', 10], ['Niger', 10], ['Cameroon', 10], ['Chad', 10]], rep: 2 }),
    N('ng_creative', '🎬', 'Creative Economy', 'Nollywood, Afrobeats and fintech.', 18, 8, 0.002, { eff: { tfp: 0.001 }, rep: 2, fac: { liberals: 6 } }),
  ] },
  Egypt: { key: 'egypt', title: 'The New Republic', intro: 'The Arab world\'s most populous country, the Suez Canal, the Nile, and a mountain of debt.', nodes: [
    N('eg_capital', '🏙', 'The New Administrative Capital', 'A new capital in the desert east of Cairo.', 36, 12, 0.015, { infra: 5, fac: { nationalists: 4, labour: -4 } }),
    N('eg_suez', '🚢', 'Suez Expansion', 'Widen and deepen the canal.', 26, 10, 0.006, { cash: 0.008, eff: { tfp: 0.001 }, fac: { business: 6 } }),
    N('eg_gas', '⛽', 'East Med Gas Hub', 'Liquefy and sell the gas of the Eastern Mediterranean.', 24, 10, 0.004, { energy: 0.08, rel: [['Israel', 6], ['Cyprus', 6], ['Greece', 6]] }),
    N('eg_imf', '🏦', 'The IMF Programme', 'Billions in loans, painful reforms.', 14, 10, 0, { cash: 0.02, stab: -2, fac: { business: 6, labour: -8 } }),
    N('eg_nile', '💧', 'Nile Water Diplomacy', 'A deal over the great dam upstream.', 20, 10, 0, { rel: [['Ethiopia', 10], ['Sudan', 6]], food: 0.05 }),
    N('eg_army', '🎖', 'The Army Economy', 'Let the military run more of the economy.', 16, 8, 0, { eff: { stab: 1 }, fac: { military: 10, business: -6 } }),
  ] },
};

// ------------------------------------------------------------------ paths for everyone else
const GENERIC: Record<string, NatPath> = {
  petro: { key: 'petro', title: 'Beyond the Oil Age', intro: 'Oil and gas pay the bills, for now. Turn the windfall into a future before the world stops buying.', nodes: [
    N('g_fund', '💰', 'A Sovereign Wealth Fund', 'Save the windfall for the next generation.', 20, 8, 0.01, { rep: 2, eff: { stab: 1 } }),
    N('g_diversify', '📈', 'Diversification Plan', 'Tourism, logistics, finance, industry.', 28, 10, 0.008, { eff: { tfp: 0.0015 }, capital: 0.02 }),
    N('g_opec', '🛢', 'Squeeze the Market', 'Cut output, push up prices.', 12, 8, 0, { cash: 0.015 }),
    N('g_petrodip', '🤝', 'Petro-Diplomacy', 'Cheap oil for friends.', 16, 8, 0.003, { eff: { accept: 0.04 }, rep: 2 }),
    N('g_local', '👷', 'Local Content Rules', 'Jobs for citizens, not foreign contractors.', 16, 8, 0, { stab: 2, fac: { labour: 10, business: -4 } }),
    N('g_hydrogen', '🌞', 'Green Hydrogen', 'Sell sunshine instead of oil.', 30, 10, 0.01, { energy: 0.06, rep: 3 }, { req: ['g_diversify'] }),
  ] },
  emerging: { key: 'emerging', title: 'The Great Leap', intro: 'A young population, a poor country and everything to build. The right choices now decide the next fifty years.', nodes: [
    N('g_zones', '🏭', 'Special Economic Zones', 'Tax breaks and fast permits for factories.', 22, 8, 0.004, { capital: 0.04, eff: { tfp: 0.0015 }, fac: { business: 8 } }),
    N('g_roads', '🛣', 'Roads to Every Village', 'Paved roads and rural electricity.', 26, 10, 0.008, { infra: 7, energy: 0.03, fac: { regions: 10 } }),
    N('g_schools', '🎓', 'Schools for All', 'Free secondary school for every child.', 30, 10, 0.008, { tech: 3, eff: { tfp: 0.001 }, fac: { labour: 6, liberals: 6 } }),
    N('g_micro', '🏦', 'Microcredit and Mobile Money', 'Bank the unbanked.', 18, 8, 0.002, { eff: { tfp: 0.001 }, stab: 1 }),
    N('g_graft', '⚖', 'Clean Up the Customs', 'An end to bribes at the ports.', 20, 12, 0, { rep: 3, eff: { tfp: 0.0008 }, fac: { liberals: 8, business: 4 } }),
    N('g_diaspora', '✈', 'Diaspora Bonds', 'Invite emigrants to invest at home.', 14, 6, 0, { cash: 0.01, fac: { business: 4 } }),
  ] },
  small: { key: 'small', title: 'Small but Smart', intro: 'Too small to throw your weight around, so you have to be cleverer than the giants.', nodes: [
    N('g_niche', '🕊', 'Niche Diplomacy', 'Host talks, mediate, be useful to everyone.', 16, 8, 0, { eff: { accept: 0.05 }, rep: 3 }),
    N('g_finance', '🏦', 'Financial Hub', 'Low taxes and fast courts for global firms.', 22, 10, 0.003, { eff: { tfp: 0.002 }, fac: { business: 10, labour: -4 } }),
    N('g_total', '🛡', 'Total Defence', 'Every citizen trained, every bridge mined.', 24, 10, 0.006, { eff: { def: 1.1, deter: 0.9 }, fac: { military: 8 } }),
    N('g_tourism', '🏖', 'Tourism Drive', 'Airports, hotels and a global marketing campaign.', 18, 8, 0.004, { cash: 0.008, fac: { regions: 6 } }),
    N('g_digital', '💻', 'Digital State', 'Every government service online.', 20, 8, 0.003, { eff: { tfp: 0.0015 }, tech: 2 }),
    N('g_protector', '🤝', 'Find a Protector', 'Bind yourself to a great power.', 18, 10, 0, { eff: { deter: 0.9 }, fac: { nationalists: -4 } }),
  ] },
  developed: { key: 'developed', title: 'Renewal', intro: 'A rich, ageing country with high expectations and slowing growth. Reinvent yourself or slowly decline.', nodes: [
    N('g_ai', '🤖', 'National AI Strategy', 'Data centres, research and talent visas.', 24, 10, 0.006, { eff: { tfp: 0.002 }, tech: 3 }),
    N('g_defence', '🛡', 'Defence Modernisation', 'Air defence, drones and munitions.', 24, 10, 0.008, { army: 0.003, air: 0.002, eff: { def: 1.05 }, fac: { military: 8 } }),
    N('g_housing', '🏘', 'Housing for the Young', 'Build a million homes.', 26, 10, 0.008, { stab: 3, fac: { labour: 8, liberals: 4 } }),
    N('g_green', '🌱', 'Energy Transition', 'Wind, solar and storage.', 28, 10, 0.008, { energy: 0.06, rep: 2, fac: { liberals: 8 } }),
    N('g_trade', '🚢', 'Trade Leadership', 'Champion open markets.', 18, 8, 0, { eff: { accept: 0.04 }, rep: 2, fac: { business: 6 } }),
    N('g_ageing', '👴', 'An Ageing Society', 'Robots in care homes, later retirement, migrant workers.', 22, 12, 0.004, { labour: 0.02, eff: { tfp: 0.0008 }, fac: { business: 6, labour: -6 } }),
  ] },
};

export function pathOf(c: Country): NatPath {
  const p = PATHS[c.name];
  if (p) return p;
  const e = c.eco;
  if (e.energyCap > e.energyDemand * 1.6) return GENERIC.petro;
  if (e.gdp / Math.max(1, e.pop) < 12000) return GENERIC.emerging;
  if (e.pop < 12e6) return GENERIC.small;
  return GENERIC.developed;
}
export const nodeOf = (c: Country, id: string) => pathOf(c).nodes.find((n) => n.id === id);
const done = (c: Country, id: string) => !!c.nat?.done.includes(id);

/** Why a project cannot be started right now (null = it can). */
export function blocked(s: GameState, c: Country, n: NatNode): string | null {
  if (done(c, n.id)) return 'Completed';
  if (c.nat?.active?.id === n.id) return 'Under way';
  if (n.excl?.some((x) => done(c, x))) return `Closed off by ${nodeOf(c, n.excl.find((x) => done(c, x))!)?.title ?? 'an earlier choice'}`;
  if (n.req?.some((x) => !done(c, x))) return `Needs ${n.req.filter((x) => !done(c, x)).map((x) => nodeOf(c, x)?.title).join(' and ')}`;
  if (n.any && !n.any.some((x) => done(c, x))) return `Needs one of: ${n.any.map((x) => nodeOf(c, x)?.title).join(', ')}`;
  if (c.nat?.active) return 'Another national project is under way';
  if (c.isPlayer && (c.politics?.pc ?? 0) < n.pc) return `Needs ${n.pc} political capital`;
  void s;
  return null;
}

export function actStartProject(s: GameState, id: string) {
  const c = s.countries[s.player];
  const n = nodeOf(c, id);
  if (!n) return { ok: false, message: 'No such project' };
  const why = blocked(s, c, n);
  if (why) return { ok: false, message: why };
  if (n.cost > 0) { const f = fund(s, c.id, n.cost * c.eco.gdp); if (!f.ok) return f; }
  spendPC(c, n.pc);
  c.nat ??= { done: [] };
  c.nat.active = { id, start: s.tick, until: s.tick + n.weeks };
  return { ok: true, message: `${n.title} begins: ${n.weeks} weeks to completion.` };
}
export function actCancelProject(s: GameState) {
  const c = s.countries[s.player];
  if (!c.nat?.active) return { ok: false, message: 'Nothing under way' };
  const n = nodeOf(c, c.nat.active.id);
  c.nat.active = undefined;
  return { ok: true, message: `${n?.title ?? 'The project'} is abandoned. The money is gone.` };
}

const target = (s: GameState, c: Country, name: string): number => (name === 'RIVAL' ? (c.isPlayer ? s.rival : -1) : NAME_TO_ID[name] ?? -1);

export function applyFx(s: GameState, c: Country, fx: Fx) {
  const e = c.eco, m = c.mil;
  if (fx.stab) e.stability = clamp(e.stability + fx.stab, 0, 100);
  if (fx.rep) c.reputation = clamp(c.reputation + fx.rep, 0, 100);
  if (fx.infra) e.infra = clamp(e.infra + fx.infra, 0, 100);
  if (fx.tech) e.tech += fx.tech;
  if (fx.milTech) m.milTech = clamp(m.milTech + fx.milTech, 0, 110);
  if (fx.readiness) m.readiness = clamp(m.readiness + fx.readiness, 0.2, 1);
  if (fx.energy) e.energyCap *= 1 + fx.energy;
  if (fx.food) e.foodCap *= 1 + fx.food;
  if (fx.capital) e.capital *= 1 + fx.capital;
  if (fx.labour) { e.laborForce *= 1 + fx.labour; e.pop *= 1 + fx.labour * 0.6; }
  if (fx.troops) m.troops *= 1 + fx.troops;
  if (fx.cash) e.cash += fx.cash * e.gdp;
  if (fx.army) m.equipArmy += fx.army * e.gdp;
  if (fx.air) m.equipAir += fx.air * e.gdp;
  if (fx.navy) m.equipNavy += fx.navy * e.gdp;
  if (fx.nuclear) m.nuclear = true;
  if (c.isPlayer && fx.fac) for (const [f, v] of Object.entries(fx.fac)) sway(c, f as FactionId, v as number);
  for (const [name, v] of fx.rel ?? []) { const t = target(s, c, name); if (t >= 0 && t !== c.id && s.countries[t]?.alive) addRelation(s, c.id, t, v); }
  for (const [name, kind] of fx.treaty ?? []) {
    const t = target(s, c, name);
    if (t < 0 || t === c.id || !s.countries[t]?.alive || areAtWar(s, c.id, t) || getRelation(s, c.id, t) < -20) continue;
    const tr = s.treaties[c.id < t ? `${c.id}-${t}` : `${t}-${c.id}`];
    if (!tr?.[kind]) applyTreaty(s, c.id, t, kind, true);
  }
  if (fx.cb) { const t = target(s, c, fx.cb); if (t >= 0) s.stats[`cb:${c.id}>${t}`] = 1; }
}

/** Permanent modifiers from completed national projects (folded into the country's modifiers). */
export function natEff(c: Country): Eff {
  const out = { tfp: 0, stab: 0, accept: 0, rep: 0, off: 1, def: 1, deter: 1 };
  for (const id of c.nat?.done ?? []) {
    const e = nodeOf(c, id)?.fx.eff;
    if (!e) continue;
    out.tfp += e.tfp ?? 0; out.stab += e.stab ?? 0; out.accept += e.accept ?? 0; out.rep += e.rep ?? 0;
    out.off *= e.off ?? 1; out.def *= e.def ?? 1; out.deter *= e.deter ?? 1;
  }
  return out;
}

function complete(s: GameState, c: Country, n: NatNode) {
  c.nat ??= { done: [] };
  c.nat.active = undefined;
  c.nat.done.push(n.id);
  applyFx(s, c, n.fx);
  const mine = c.id === s.player;
  const text = n.news ? `${c.name}: ${n.news}` : mine ? `🏛 NATIONAL PROJECT COMPLETE: ${n.title}. ${n.desc}` : `${n.icon} ${c.name} completes "${n.title}": ${n.desc.charAt(0).toLowerCase()}${n.desc.slice(1)}`;
  logEvent(s, text, n.news ? 'danger' : 'info', [c.id], mine || isMajor(s, c.id), { big: mine || !!n.news, prov: c.capital });
}

/** Weekly: the player's project advances; AI countries pick and complete projects of their own. */
export function stepNations(s: GameState, geo: Geo) {
  const P = s.countries[s.player];
  if (P?.alive && P.nat?.active && s.tick >= P.nat.active.until) { const n = nodeOf(P, P.nat.active.id); if (n) complete(s, P, n); else P.nat.active = undefined; }
  if (s.tick % 13 !== 6) return;
  for (const c of s.countries) {
    if (!c.alive || c.isPlayer || !PATHS[c.name]) continue;
    if (c.nat?.active) { if (s.tick >= c.nat.active.until) { const n = nodeOf(c, c.nat.active.id); if (n) complete(s, c, n); else c.nat.active = undefined; } continue; }
    if (s.tick < 20 || nextRand(s) > 0.35) continue;
    const open = pathOf(c).nodes.filter((n) => !blocked(s, c, n));
    if (!open.length) continue;
    // aggressive leaders favour military and claim projects; traders favour the economy
    const score = (n: NatNode) => hash01('np', c.id, n.id) + (n.fx.cb || n.fx.army || n.fx.navy || n.fx.nuclear ? c.ai.aggression : 0) + (n.fx.eff?.tfp || n.fx.capital ? c.ai.trade : 0);
    const n = open.sort((a, b) => score(b) - score(a))[0];
    c.nat ??= { done: [] };
    c.nat.active = { id: n.id, start: s.tick, until: s.tick + Math.round(n.weeks * 1.6) };
  }
  void neighborsOf; void geo;
}
