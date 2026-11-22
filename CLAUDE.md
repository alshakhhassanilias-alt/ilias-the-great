# World Order: notes for working on this codebase

A real-time grand-strategy game (React + TypeScript + Vite). The whole world simulation is plain TypeScript in
`src/sim/` with no DOM dependencies, so it runs the same in the browser, in Vitest, and headless from the command line.

## Commands

| What | Command |
|---|---|
| Type check | `npm run typecheck` |
| Unit tests (about 300, a few minutes) | `npx vitest run` |
| **Headless war test (run this after any change to the simulation)** | `npm run sim_test` |
| Build the web app and the single-file game | `npm run build && python3 scripts/make-single-file.py` (writes `play/world-order.html`) |
| Browser smoke test (needs a build) | `npm run e2e` |
| Full balance audit: 16 countries × 20 years, invariant checks every week | `npm run audit` (about 15 min; `MODE=sandbox`, `HAWK=1`, `OUT=file`) |
| Browser sweep of every tab and screen on 3 screen sizes (needs a build) | `npm run audit:ui` |

Chromium for Playwright is preinstalled at `/opt/pw-browsers/chromium`; the browser scripts use `playwright-core`.
Scratch scripts are named `scripts/_*` and must be deleted before committing.

## The headless war test: `npm run sim_test`

`scripts/sim_test.ts` loads the world, makes a far-away spectator country the player, declares war between two AI
nations, and runs the real weekly tick for 300 days (43 weeks) with no rendering. It does this for six matchups by
default (Poland–Belarus, India–Pakistan, Brazil–Argentina, Iran–Iraq, Germany–France, Nigeria–Cameroon).

```
npm run sim_test                                   # all matchups, 300 days, seed 11
npm run sim_test -- --a Poland --b Belarus         # one matchup
npm run sim_test -- --days 300 --seed 23 --json report.json --weeks   # JSON, with a week-by-week series
```

Each matchup should take about 1 s (the budget is under 5 s per 300 days). The report covers territory (start/end, number
of changes, the longest spell with no change), frozen fronts (no progress for 8+ weeks, with attack, defence and supply),
supply (weeks with pockets, and spikes when supply collapses or a pocket forms), armies, casualties, war support,
GDP, and crashes or broken invariants (NaN, negative troops, provinces owned by dead countries, `c.provinces` out of
sync with `s.owner`).

Verdicts: `OK`, `CRASH`, `BROKEN INVARIANTS`, `FREEZE` (no territory changed hands at all), `STALL` (16+ quiet weeks),
`STALEMATE` (3+ frozen fronts), `SUPPLY`, `ECONOMY` (a big GDP fall in a week with no territory lost). **The exit code is
1 on any crash, broken invariant or freeze.** A war between near-equals (Germany–France) may legitimately show a
`STALL` of 20-30 weeks between captures; a `FREEZE` is never acceptable. Run at least two seeds after touching
`war.ts`, `supply.ts`, `ai.ts`, `economy.ts` or `military.ts`.

## Architecture

### State and determinism
- `GameState` (`src/sim/types.ts`) is one plain JSON object: countries, `owner[]`/`core[]` per province, wars,
  treaties, inbox, log, `stats` (a numeric key-value map for counters and flags). Saves are `JSON.stringify` of it
  (`save.ts`), with numbers rounded to 9 digits.
- The simulation is **deterministic**: all randomness goes through `nextRand(s)` (`rng.ts`), seeded from
  `s.settings.seed`; stable per-entity draws use `hash01(...parts)` (include `s.settings.seed` in the parts if games
  should differ). Never use `Math.random` or `Date` in `src/sim/`.
- Never assign `undefined` to a state field (it changes JSON key order); use optional fields and leave them out.
- Module-level caches exist (supply networks keyed by tick and ownership version, exclave hubs per `Geo`, relation
  indexes). Anything that changes ownership must go through `transferProvince` (`war.ts`), which calls `bumpSupply()`.

### The weekly tick (`src/sim/tick.ts`)
`tick(s, geo)` runs the generator `tickSlices`; the browser runs the same slices a few milliseconds per frame. The
order (each `mark()` label): `stepEconomiesGen` → `stepWars` (then operations, campaigns, peace deals) → `stepArmies`
→ `stepPartisans`/occupation → `stepAIGen` (AI budgets, diplomacy every 4-8 weeks, war declarations every 12, peace and
reinforcements every 4) → `stepArcs` (cabinet, domestic politics, bills, legacy) → `stepCharacter` → `stepTrade` →
`stepCoalitions` → `stepMinds` → membership, alignment, courses, stories, world events → `stepPolitics` (world) →
rivals, doctrines, `stepIndustry`, influence → trophies → `stepUnrest` → `weekEnd`.

### Provinces and territory
- `s.owner[p]` and `c.provinces` must always agree; only `transferProvince` (`war.ts`) changes them (and `deserialize`
  repairs a save where they disagree). It moves the region's share of population, labour, capital and GDP, measured in
  people (`peopleW`), and leaves productivity (`tfp`) alone. It moves buildings (damaged unless the hand-over is
  peaceful) and invalidates supply caches.
- A fallen capital: the government moves to the biggest city of the largest *connected* part of what is left, and the
  historic seat is remembered in `s.stats['seat:<id>']`. Use `capitalLost(s, c)` (`relations.ts`) to ask whether a
  country has lost its capital; `c.provinces.includes(c.capital)` is always true. Retaking the seat moves the
  government back.
- When home regions change (`s.core`), bump `s.stats.coreVer` so the exclave-depot cache in `supply.ts` is rebuilt.
- `s.core[p]` is the nation a region belongs to; integration and resistance of conquered land are in `occupation.ts`.
- Map geometry is `Geo` (`geo.ts`, loaded once by `load.ts`): `adj` (attack adjacency), `dist`, terrain, weights.
  Supply uses `neighbours()` in `supply.ts`, which adds a few borders missing from `adj`.

### Economy (`economy.ts`, `industry.ts`, `military.ts`, `develop.ts`, `trade.ts`)
Weekly, per country: trade index and energy/food balances, population and labour, potential output (TFP × K^0.35 ×
L^0.65 × factors for infrastructure, energy, trade, stability, tax, war damage and mobilisation, research and industry),
real GDP moving toward it, inflation and the price level, capital, the budget, debt. The military draws its budget
share; equipment is bought with what is left after pay and upkeep. Development projects that change numbers the economy
recomputes each week (trade, energy demand, labour force) store lasting multipliers in `c.dev.k`, applied in
`economy.ts`; follow that pattern, or the effect lasts one week.

### Supply (`supply.ts`)
`supplyNet(s, geo, c)` is a Dijkstra from hubs (capital, big home cities, exclave hubs, depots, ports unless
blockaded) over the country's, its allies' and co-belligerents' land (never through the land of anyone it is fighting).
Its cache key covers the week, ownership, who fights on which side and treaties; building a depot or port calls
`bumpSupply()`. "Encircled" has one meaning everywhere: `isPocket(s, geo, p)` (cut off *and* touching the enemy). Attacks and supply use the same
neighbour lists (`neighbours(geo)`). `capacity` comes from `mil.supply` and
blockade; `landSupply` turns path cost into an attack's supply (0.15 if cut off). Pockets are own regions with no path.
Blockades are built during `stepWars` and swapped in at its end, so supply stays consistent within a week.

### Combat (`war.ts` `stepWars`)
For each war:
1. **Targets.** Each side picks targets from `attackCandidates`: land regions next to friendly land, plus landings
   only if their supply is at least 0.45 and the enemy navy is not stronger. The AI scores candidates by importance ×
   supply ÷ terrain, and penalises fronts stuck for 6+ weeks (`front.stall`), very low supply and sectors the
   defender has reinforced (`w.gar`).
2. **Defence.** Defenders keep 35% of the field army spread along the whole frontier. The other 65% moves toward the
   attacks, part of the way each week (`w.gar`), so new or shifted attacks meet a thin line at first.
3. **Battles.** Each battle compares attack power with defence power. Defence includes fortification, terrain,
   infrastructure, morale and generals. A ratio of about 0.7 breaks even. Progress per week is capped and scaled by
   province size, the nuclear brake and red lines. Casualties are Lanchester-like.
4. **Captures.** When progress reaches 1 the region changes hands, and the neighbouring regions start at a head start
   (breakthrough exploitation).
5. **Decay.** A front its attacker abandons loses 0.06 progress a week.

War support, exhaustion and peace: `warsupport.ts`, `ai.ts` `managePeace`; AI wartime recruitment: `ai.ts` `warRecruit`.
A country in several wars splits its army between them (`wr`), and war exhaustion is charged once a week, however
many wars it is in.

Peace (`makePeace`): a peace between the two side leaders ends the war for everyone. A separate peace takes out only
the signers who do not lead their side. A war that ends because a nation is destroyed is recorded in `warHistory`
too.

Red lines (`redlines.ts`) slow an advance into the defender's homeland (`advanceBrake`). A warning nobody acts on fades
within a year. While a protector is fighting and the danger lasts, the brake is renewed. An intervener may make its
own peace two years after intervening.

The AI finishes offensives already under way (the pull grows with progress) before opening new ones. It looks for thin
sectors only when opening new fronts. It drops attacks stuck for 8+ weeks at a losing ratio (below about 0.7) or with
supply under 0.2. It opens a second sector only when it clearly outnumbers the enemy's field army.

The player gets extra layers on top: army groups (`armies.ts`), named operations (`operations.ts`), campaigns
(`campaigns.ts`), war councils (`warmode.ts`). The same `stepWars` resolves everyone's battles.

Chip and mineral output belongs to the land (`producersNow` in `trade.ts`). A defence industry (`armsCostMult`) makes
equipment and its upkeep cheaper, not pay. AI governments' share of industry growth is paid for and brings the same
payoffs as the player's expansions (`industry.ts` `drift`/`payoff`). Lasting military-technology gains go
through `raiseMilTech` (`military.ts`), or they fade. A partial or general mobilisation costs output through the
workers it calls up; only total war also converts industry. Player mobilisation calls up against the army at its start,
within the manpower available.

### Domestic politics and legacy
Factions, laws and political capital are in `domestic.ts`; bills are fought seat by seat in `bill.ts`; coalitions are in
`coalition.ts`; the Legacy career is in `legacy.ts`, `persona.ts` and `campaign.ts`.

Political capital is capped at `PC_CAP` (100). Add it with `addPC`: what does not fit becomes public goodwill (an
approval boost of up to +4), never silently lost.

### UI
`src/state/store.ts` owns the game loop, speed, drawers and the log-driven reactions (pauses, cinematic moments). The
interface is React in `src/ui/`, and the map canvas renderer is in `src/map/`.

## Rules for changes
- Keep the sim deterministic and free of DOM access. Test new mechanics in `tests/sim.test.ts` and check them with
  `npm run sim_test`.
- Before committing, run `npm run typecheck`, `npx vitest run` and `npm run sim_test`. If the UI changed, also build and
  run `npm run e2e`.
- Do not put model identifiers in repository files.
