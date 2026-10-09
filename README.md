# WORLD ORDER — a modern geopolitical strategy simulator

A playable, browser-based grand-strategy sandbox. You lead a real country from **1 January 2024**: run its
economy and budget, trade, form alliances, impose sanctions, build an army, declare war, take territory and
negotiate peace — in a living world where ~190 AI-controlled countries develop, scheme and fight on their own.

* **No waiting, ever.** There are no construction timers, energy timers or pay-to-skip. Every decision takes effect
  immediately (money moves, capacity is built, troops are raised, war is declared *now*) or at the very next
  simulation tick. The world runs on a simulated clock you control: ⏸ pause · ▶ normal · ▶▶ fast · ▶▶▶ very fast.
* **Real map, dynamic borders.** Natural Earth borders, subdivided into 656 game provinces. Conquest transfers
  provinces (with their population and output) and the national borders are re-drawn live.
* **Runs locally.** React + TypeScript + Vite, a canvas map, no backend, no API keys, no costs.

## Play without installing anything
Download **`play/world-order.html`** (single file, 1.3 MB) and double-click it. It runs offline in any modern browser (Chrome, Edge, Firefox, Safari, phone browsers too). Saves go to that browser's storage.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173 (desktop and phone browsers on the same network)
```

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `preview` | Vite dev server / production build (also type-checks) / serve the build |
| `npm test` | 31 deterministic simulation tests (Vitest) |
| `npm run e2e` | Browser smoke test (Playwright): desktop + mobile play-through; run after `npm run build` |
| `npm run build:map` | Regenerates `src/data/generated/world.json` from Natural Earth (~20 s) |
| `npx tsx scripts/headless-sim.ts 30 Germany` | Simulate 30 years headless; prints economies, wars, timing (`AGG=2`, `ALLIES=0` supported) |
| `npx tsx scripts/war-test.ts Russia Ukraine 3` | War scenario harness used to tune combat pacing |
| `npx tsx scripts/debug-country.ts 20 China,Russia` | Per-country growth-factor diagnostics |

## How to play

1. **Pick a country** on the start-screen map (or search 190+ countries). Set difficulty, starting economic
   conditions (historical / crisis / prosperous), AI aggression, defensive alliances on/off, and a victory condition.
2. **Read the map.** Click/tap a country to inspect it; drag to pan, wheel or pinch to zoom. Map modes: Political,
   Relations, Wealth, Power, Stability. Your territory has a gold outline; enemies are red, allies blue.
3. **Run your country** with the side panel (bottom sheet on phones):
   * **Overview** — advisor alerts, key stats, history charts.
   * **Economy** — *why* the economy is growing or shrinking (growth-contribution bars + plain-language summary),
     fiscal position, tax and spending sliders, instant projects (factories, infrastructure, power, farms, R&D),
     borrowing / repaying / printing money, trade and resource balances.
   * **Military** — forces, readiness, logistics, intelligence, exhaustion; budget and procurement mix; recruit,
     demobilise, buy equipment; offensive commitment and manual or automatic targeting; peace talks.
   * **Diplomacy** — relations breakdown, treaty proposals (with a likelihood preview and reasons), sanctions and
     embargoes, war declaration (with an odds estimate), pending offers from AI countries.
4. **Control time** with the clock (bottom-left on desktop, top-left on phones). Space = pause, 1–3 = speed.
   The game pauses automatically when someone declares war on you (toggle in settings).

## Architecture

```
src/
  data/countryData.ts      baseline country table (REAL, approximate) + blocs, rivalries, claims
  data/generated/world.json  build-time province geometry (from scripts/build-map.ts)
  sim/                     pure, deterministic TypeScript — no React, no DOM
    types.ts  state shapes        init.ts    calibrates every country from the baseline
    economy.ts   production, fiscal, trade, prices, stability, growth explanation
    military.ts  force strength, upkeep, procurement, readiness
    war.ts       declaration, alliance calls, fronts & combat, blockade/air war, peace, province transfer
    diplomacy.ts treaties, sanctions, offers      relations.ts  relation model + treaty/war queries
    ai.ts        personalities, economic policy, diplomacy, war and peace decisions
    actions.ts   every player/AI action (immediate effect)     tick.ts   one-week step, victory, instability
    save.ts      JSON save/load                   rng.ts    seeded PRNG stored in the save
  map/            geometry.ts (Path2D, runtime border unions, picking)  renderer.ts (canvas)  MapView.tsx
  state/store.ts  clock/speeds, selection, toasts, autosave — the only bridge between sim and React
  ui/             TopBar, TimeControls, SidePanel + tabs, Drawers (world / menu / settings / peace), StartScreen
scripts/          map build pipeline, headless simulators, e2e smoke test
tests/sim.test.ts
```

Separation of concerns: geography (`world.json`, `map/`) knows nothing about the economy; the simulation never
touches the DOM or the map renderer; React only reads from the store. The whole game state is plain JSON, and all
randomness comes from a seeded generator whose state is saved — **the same seed and actions always give the same
world**, and a save resumes identically (both are tested).

### Geography pipeline (`scripts/build-map.ts`)
Natural Earth admin-0 (1:50m, via `world-atlas`, public domain) → Natural Earth projection → per-country
k-means on a land-sample grid → Voronoi cells **clipped to the real border** (polygon-clipping) → province
adjacency from shared boundary segments. Overseas dependencies (Greenland, Puerto Rico, Hong Kong …) become
overseas provinces of their parent; disputed or partly recognised entities (Taiwan, Kosovo, Palestine, Western
Sahara …) are separate actors. At runtime, each owner's border is the *union* of its provinces, recomputed
when territory changes hands.

### The economy (`economy.ts`) — one tick = one week
Nothing is random. Each country has a calibrated production function:

```
Real GDP target  Y* = A · K^0.35 · L^0.65 · infraF · energyF · tradeF · stabilityF · taxF · warF
```
`K` industrial capital (private investment ∝ confidence & corporate tax, plus state industrial policy), `L`
workforce (population × participation − unemployment − soldiers), `A` productivity (country trend + education/R&D).
Output converges to `Y*` over a few months; nominal GDP = real × price level. On top of that:

* **Fiscal:** revenue = GDP × collection efficiency × (0.50·income + 0.20·corporate + 0.55·VAT rates); spending =
  services + infrastructure + industry + education + military + intelligence + interest. Deficits are borrowed;
  interest depends on debt, inflation and stability; extreme debt → default and haircut.
* **Trade-offs:** effective tax rates above efficient levels reduce output; underfunded infrastructure decays;
  low social spending erodes stability; high military spending strains the budget; printing money creates inflation.
* **Energy & food:** each country's domestic production vs demand; shortfalls are imported at world prices unless
  sanctioned or blockaded; unmet demand cuts output / population. World prices respond to global scarcity.
* **Trade:** agreements raise a country's trade index, sanctions and war cut it; exports/imports include resource flows.
* **Inflation, unemployment, stability, population, technology** are all derived from the above (no free-floating numbers).
* The **Economy tab explains itself:** annualised log-contributions of capital, labour, productivity, infrastructure,
  energy, trade, stability, taxes and war to the current growth rate, plus current "drags" on output.

### Military & war (`military.ts`, `war.ts`)
Strength = troops × equipment quality × technology × readiness (+ air and naval power), not a bare headcount.
War is resolved per contested province each week:

* attacker power = committed troops × quality × tech × readiness × **supply** (distance from friendly integrated land,
  logistics) × air support × intel edge × amphibious penalty;
* defender power = field troops reinforced where pressure is highest × fortification × **terrain** × capital bonus;
* progress = f(ln(attack/defence)); a province changes hands at 100% and takes its population and output with it;
  conquered land has to be integrated (unrest) and is remembered as belonging to its original owner;
* air superiority bombs infrastructure; naval superiority blockades trade; nuclear powers brake invasions;
* casualties, devastation and territorial loss build **war exhaustion**, which forces peace or political upheaval.

Peace talks offer ceasefire, restoring borders, territorial demands/concessions, or total surrender; the other side
evaluates exhaustion, war score, losses and the size of the demand and explains its answer.

### Diplomacy & AI (`diplomacy.ts`, `ai.ts`)
Relations = historic/bloc baseline + treaties + dynamic memory (aggression, sanctions, broken pacts). Treaties: trade,
non-aggression, defensive alliance (can be switched off for a faster sandbox), military cooperation; plus sanctions
and embargoes. Every AI has a personality (aggression, expansion, trade, ideology, caution) and periodically weighs
its economy, threats, relations, logistics, allies, nuclear deterrence and claims. It sets taxes and budgets,
mobilises, proposes treaties (to you as offers), sanctions aggressors, declares war only when the odds and desire
justify it, and makes peace. AIs do **not** automatically target the player; difficulty only tilts the odds.

## Data provenance — real vs generated
* **Real (approximate, rounded, ~2023–24):** population, nominal GDP, military spending share, active troops,
  government type, nuclear status, capitals, debt ratios, rivalries and bloc membership. These come from the
  author's recollection of IMF/World Bank/SIPRI/IISS-range figures and are meant as a *game baseline, not a
  citation*; rows marked `E` in `src/data/countryData.ts` are rough game estimates.
* **Game-generated:** everything derived — capital stock, productivity, tech and infrastructure levels, tax-rate
  split, equipment stocks, resource balances, terrain ruggedness, provinces and their weights, AI personalities.
* Borders: Natural Earth (public domain). The game starts at peace in 2024 (no scripted wars or events).

## Status vs. the roadmap
| Stage | Status |
| --- | --- |
| 1 — vertical slice (map, stats, budget, clock, military, war, territory, responsive UI) | ✅ done and tested |
| 2 — trade, diplomacy, AI, alliances, peace talks | ✅ done |
| 3 — richer economy, logistics, population, technology | ✅ first version (resource markets, trade index, intel fog, tech/R&D; no tech tree) |
| 4 — save/load, balancing, tests, performance, mobile polish | ✅ saves/autosave/export, 31 unit tests + e2e smoke test, ~7 ms/tick for the whole world; balance is a first pass |

## Known limitations / ideas for next iterations
* Provinces are coarse (656); microstates are a single province, so one capture annexes them. Rebel/secession states,
  puppets and vassals are not modelled; unrest causes upheaval and forced ceasefires instead.
* Combat is abstract by design (no unit-level tactics); nuclear weapons act as deterrence only (never used).
* Balance needs playtesting: AI war frequency, peace-time attrition and long-run (30+ year) GDP trajectories are tuned lightly.
* Ideas: tech tree, multi-front alliance coalitions, per-province buildings, historical event packs, richer news,
  per-country flags, sound, a service worker for offline play.

## Licence
Code: see `LICENSE`. Map data: Natural Earth (public domain) via `world-atlas` (ISC).
