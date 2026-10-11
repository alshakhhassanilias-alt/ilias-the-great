# WORLD ORDER — a modern geopolitical strategy simulator

A playable, browser-based grand-strategy sandbox. You lead a real country from **1 January 2024**: run its
economy and budget, trade, form alliances, impose sanctions, build an army, declare war, take territory and
negotiate peace — in a living world where ~190 AI-controlled countries develop, scheme and fight on their own.

* **No waiting, ever.** There are no construction timers, energy timers or pay-to-skip. Every decision takes effect
  immediately (money moves, capacity is built, troops are raised, war is declared *now*) or at the very next
  simulation tick. The world runs on a simulated clock you control: ⏸ pause · ▶ slow (a year in ~1m45s) · ▶▶ normal · ▶▶▶ fast · ⏩ very fast.
* **Real map, dynamic borders.** Natural Earth borders, subdivided into ~1,200 named game provinces. Conquest transfers
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
| `npm test` | 73 deterministic simulation tests (Vitest) |
| `npm run e2e` | Browser smoke test (Playwright): desktop + mobile play-through; run after `npm run build` |
| `npm run build:map` | Regenerates `src/data/generated/world.json` from Natural Earth (~20 s) |
| `npx tsx scripts/headless-sim.ts 30 Germany` | Simulate 30 years headless; prints economies, wars, timing (`AGG=2`, `ALLIES=0` supported) |
| `npx tsx scripts/war-test.ts Russia Ukraine 3` | War scenario harness used to tune combat pacing |
| `npx tsx scripts/debug-country.ts 20 China,Russia` | Per-country growth-factor diagnostics |

## What keeps it busy
* **Decision events** (about 5 a year, 16 kinds): strikes, energy shocks, border incidents, research breakthroughs, disasters, scandals, investment offers, refugees, central-bank calls, coup plots, trade delegations, arms deals, harvest failures, tax demands, allies asking for help, resource discoveries. The game pauses and each choice has real costs and effects.
* **A living world:** AI countries have disasters, strikes, coups, booms and border clashes that show up in a live **news ticker**; they declare wars, sign peace, offer you treaties, sanction aggressors and call allies.
* **Objectives:** ten optional goals (grow GDP, open markets, build infrastructure, climb the rankings, win your first conquest ...) that pay out immediately.
* **Covert operations:** gather intelligence, influence, steal technology, sabotage, incite unrest; success depends on the intelligence gap.
* **Active war play:** per-region offensives with progress bars and troop counts, air strikes, calling allies, total mobilisation, war economy, manual or automatic targeting.
* **Conquest you can see:** captured regions flash, are hatched in the original owner's colours until integrated, borders re-draw instantly, armies and battle pulses are drawn on the map, regions have names ("North-East Poland").

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
4. **Control time** with the clock (bottom-left on desktop, top-left on phones). Space = pause, 1–4 = speed.
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

### Map rendering (`src/map/renderer.ts`)
The map is drawn in the style of a grand-strategy atlas, all in Canvas 2D:
- **Painted terrain**: a 4000×2080 texture (`src/data/generated/terrain.webp`, ~480 KB) made from Natural Earth's land-cover raster with shaded relief and its sea-floor relief, reprojected into the game's projection and masked with the game's own coastlines, so mountains, deserts, forests, ice and continental shelves show through.
- **Translucent national colours** over the terrain (hand-picked for about 50 well-known countries, generated for the rest), occupied land hatched in the original owner's colour.
- **Real geography**: rivers (more appear as you zoom), lakes, about 1,250 cities and 2,600 towns, sea and ocean names; regions are named after their real capital or largest town (Warsaw, Kraków, Lviv ...).
- **Lit coastlines, dashed region lines, heavy national borders**; curved, letter-spaced serif country names that follow each country's shape (Cinzel), italic sea names (Cormorant Garamond).
- **War**: red frontlines where warring sides meet, broad animated offensive arrows, NATO-style army counters with troop numbers; enemies outlined red and allies blue, so every country keeps its own colour.

Performance: the static layer is drawn once into the visible canvas and moved with a GPU-composited CSS transform while you pan or zoom (eased zoom, inertia), then re-rendered crisply when the view settles or territory changes. National borders are precomputed shared boundary runs between provinces, stroked when their two sides have different owners. Labels, fronts and effects go on a light overlay canvas.

Rebuilding the map assets (only needed if you change the geography; outputs are committed): download the Natural Earth files listed at the top of `scripts/build-terrain.py` and `scripts/build-features.ts` into one folder, then run `npm run build:map`, `npx tsx scripts/build-features.ts <folder>` and `python3 scripts/build-terrain.py <folder>`.

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

### World politics: deals ripple (`politics.ts`)
Every treaty, sanction, guarantee, war and annexation is passed through a ripple model: allies of both sides, rivals,
blocs and the World Assembly react (relations shift, AI countries may cancel treaties with an offended partner,
hostile blocs raise their threat level). Before you confirm a deal the diplomacy tab previews who will be pleased or
angry. Other systems: blocs (map mode), counter-blocs, Assembly resolutions with votes, guarantees, mediation,
ultimatums, "honour your alliance?" decisions, buildings (fortresses, bases, ports…) that change hands in conquest,
~60 situational events with cooldowns and follow-ups, and rotating objectives (3 active at a time) with an advisor.

### Action layer: things that happen *to* you and things you *do* (`projects.ts`, `crises.ts`, `unrest.ts`, `rival.ts`, `trophies.ts`, `events3.ts`)
- **Decisions never block the game.** They wait in an inbox on the map, with a countdown; ignored ones lapse with a consequence
  (an ultimatum you ignore may turn into war). Pausing for decisions is an option in Settings. At most a few decisions a year, never
  the same one twice in a row.
- **Breaking news**: world-shaking events (a capital falling, armies at the gates, a country wiped off the map, a rebirth, a crisis, a
  trophy) get a banner, a sound and an expanding ring on the map. Battles have names and casualty counts. Sound is synthesised and can be muted.
- **Megaprojects**: space programme, nuclear deterrent, fortress belt, cyber command, power grid, rail, AI initiative, carrier fleet,
  education, green revolution. Funded weekly, years to build, spectacular payoff. The AI builds them too.
- **World crises** (recession, pandemic, energy shock, harvest failure, new cold war, tech boom) hit every economy for months and give you a
  response decision.
- **Independence movements**: conquered land rises up when the occupier is unstable; a dead country can be reborn.
- **A named rival** who spies, masses troops, courts your allies and grabs headlines; a "Right now" panel compares you with them.
- **Trophies** and a **year in review** card.
- **National doctrines**: three standing choices (economy, military, foreign policy), each with plain-number upsides and downsides; reforms cost money and can be done once a year.
- **Explanations everywhere**: relations show a line-by-line "why they feel this way"; AI war declarations state their reason; front cards show odds, losses and an ETA; a "Coming up" list (elections, Assembly vote, project completions, decision deadlines).
- **Leaders, goals and memory** (`leaders.ts`): every AI country has a (fictional) named leader with two traits (Hawk, Dove, Nationalist, Mercantilist ...) that change how it behaves; they succeed one another through elections, palace coups or death. Each country has a long-term goal (win back lost land, press claims, deter a neighbour, break sanctions ...) and a memory of wrongs done to it that fades over years and feeds revenge.
- **Political calendar**: an election (or, in a one-party state, a leadership congress) every four years.

## Data provenance — real vs generated
* **Real (approximate, rounded, ~2023–24):** population, nominal GDP, military spending share, active troops,
  government type, nuclear status, capitals, debt ratios, rivalries and bloc membership. These come from the
  author's recollection of IMF/World Bank/SIPRI/IISS-range figures and are meant as a *game baseline, not a
  citation*; rows marked `E` in `src/data/countryData.ts` are rough game estimates.
* **Game-generated:** everything derived — capital stock, productivity, tech and infrastructure levels, tax-rate
  split, equipment stocks, resource balances, terrain ruggedness, provinces and their weights, AI personalities.
* Map data: Natural Earth (public domain) — borders, the NE1 land-cover/relief and sea-floor relief rasters, rivers, lakes, populated places and marine area names. The game starts at peace in 2024 (no scripted wars or events).
* Fonts: Cinzel and Cormorant Garamond via Fontsource (SIL Open Font License), embedded in the build.
* Leaders are fictional: names are generated, not real people.

## Status vs. the roadmap
| Stage | Status |
| --- | --- |
| 1 — vertical slice (map, stats, budget, clock, military, war, territory, responsive UI) | ✅ done and tested |
| 2 — trade, diplomacy, AI, alliances, peace talks | ✅ done |
| 3 — richer economy, logistics, population, technology | ✅ first version (resource markets, trade index, intel fog, tech/R&D; no tech tree) |
| 4 — save/load, balancing, tests, performance, mobile polish | ✅ saves/autosave/export, 73 unit tests + e2e smoke test, ~7 ms/tick for the whole world; balance is a first pass |

## Known limitations / ideas for next iterations
* Provinces are coarse (656); microstates are a single province, so one capture annexes them. Rebel/secession states,
  puppets and vassals are not modelled; unrest causes upheaval and forced ceasefires instead.
* Combat is abstract by design (no unit-level tactics); nuclear weapons act as deterrence only (never used).
* Balance needs playtesting: AI war frequency, peace-time attrition and long-run (30+ year) GDP trajectories are tuned lightly.
* Ideas: tech tree, multi-front alliance coalitions, per-province buildings, historical event packs, richer news,
  per-country flags, sound, a service worker for offline play.

## Licence
Code: see `LICENSE`. Map data: Natural Earth (public domain) via `world-atlas` (ISC).
