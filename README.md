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
Download **`play/world-order.html`** (single file, about 4 MB) and double-click it. It runs offline in any modern browser (Chrome, Edge, Firefox, Safari, phone browsers too). Saves go to that browser's storage.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173 (desktop and phone browsers on the same network)
```

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `preview` | Vite dev server / production build (also type-checks) / serve the build |
| `npm test` | 120 deterministic simulation tests (Vitest) |
| `npm run e2e` | Browser smoke test (Playwright): desktop + mobile play-through; run after `npm run build` |
| `npm run build:map` | Regenerates `src/data/generated/world.json` from Natural Earth (~20 s) |
| `npx tsx scripts/headless-sim.ts 30 Germany` | Simulate 30 years headless; prints economies, wars, timing (`AGG=2`, `ALLIES=0` supported) |
| `npx tsx scripts/war-test.ts Russia Ukraine 3` | War scenario harness used to tune combat pacing |
| `npx tsx scripts/debug-country.ts 20 China,Russia` | Per-country growth-factor diagnostics |

## Two modes, and as much control as you want
* **🌍 Sandbox** — the open world: play forever, or set the start (today / world depression / new cold war / détente), random events on or off, nuclear weapons on or off, and an end year.
* **📜 Legacy** — a political career of up to 40 years. Terms of four years; at each inauguration you pick up to three promises from five **agenda cards** (about 20 kinds: economic miracle, balanced books, full employment, energy independence, rearmament, a great alliance, reclaiming lost land, lasting peace ...), each with a live progress bar and a once-per-term signature action. Eight weeks before the vote a **campaign** starts; the result depends on approval, promises kept or broken, fatigue and your campaign choices. Every term ends with a **newspaper review**. Lose and you lead the **opposition** (or go into exile in an autocracy): rallies, exposés, coalitions and foreign backing raise your support, a weak government can be forced into a snap vote, and a comeback returns you to power — two failed comebacks end the career. Retiring, losing your country or reaching the end of the era opens the **history book**: a legacy score in six parts (prosperity, power, standing, the people, promises, terms, wars), a grade from S to F, an epithet and a verdict, after which you can keep playing the world as a sandbox.
* **Control levels** — Economy, Military and Diplomacy can each be **Auto** (ministers and generals run it; pick an economic focus), **Guided** (they propose a plan, you approve) or **Hands-on**, with presets Leader / Strategist / Commander. Change it any time in Settings.
* **Army groups** — with the military on Guided or Hands-on your field forces form 3–6 armies, drawn as banners on the map with their commander. Drag a banner onto an enemy region to set its objective, or onto your own land to hold it; give orders Advance, Encircle (pincers, +25% against cut-off regions), Raid (half the losses, economic damage, slower gains), Hold (the region and its neighbours defend much harder) or Defend capital; change each army's share of the troops and its commander.

## Every country has its own road
* **National paths**: twenty major countries have hand-written trees of national projects that follow their real dilemmas: the United States (chips, the grid, tariffs or free trade, the Pacific, a missile shield), China (common prosperity, chips, Belt and Road, a blue-water navy, the Taiwan question), Russia, India, Japan, Germany, the UK, France, Brazil, Turkey, Iran (the bomb or a deal), Saudi Arabia, Israel, Poland, Ukraine, South Korea, Indonesia, Mexico, Nigeria and Egypt. Every other country gets a path that fits its situation (oil state, emerging economy, small state, developed country). You run one project at a time; it costs political capital and money, takes weeks, and changes the country for good, and branches close each other off. AI countries walk their own paths, so the world changes around you. Major countries also start with their own political landscape (a polarised America, Russia's powerful army, France's militant unions…).
* **War with a purpose**: declare a war aim (limited, total, or defend and restore) and be judged on it when the war ends. Wartime brings its own decisions (sieges of real cities, volunteers, atrocity reports, generals asking for reserves, mediators, arms offers with strings, anti-war marches, heroes, prisoner exchanges, saboteurs, a strained war economy). Eight **weapons programmes** permanently change how you fight; missile brigades unlock strikes on the enemy's economy.
* **A world that pushes back**: wars of aggression and conquered regions raise an aggression score, and when it is high the neighbours form a **coalition** that sanctions the aggressor and joins any war on its members (this applies to you too). Great powers arm the side they favour in other wars. Threatened countries look for allies, and long stalemates and lost causes end in peace.
* **Balanced by automated playtests**: `scripts/playtest.ts` plays full games with four bot styles across ten countries; see [docs/balance-report.md](docs/balance-report.md).
* **Smoother everywhere (desktop)**: map modes cross-fade, zoom and pan glide, numbers count up and down, bars slide, panels rise into place.

## Politics at home: the core loop
* **Political capital** is the scarce currency of power: about 25–45 a year, more when you are popular and your cabinet is loyal. Laws cost 14–34, doctrine reforms 10, crisis responses 6–15. Every few months you must choose what to spend it on.
* **Six factions** (Unions & Workers, Business & Finance, the Military, Nationalists, Liberals & Civil Society, Regions & Farmers), each with a named leader, a share of the population (seats in parliament), a clout that depends on the regime (the army matters most in a junta) and a mood that follows the budget, the economy, wars, the laws you pass and how you answered their demands. Favours are forgotten fast, grudges slowly, and expectations rise the longer you govern. Their mood feeds stability, approval and elections; happy factions give perks (investment, productivity, defence, reputation), furious ones go on general strike, move capital abroad, riot, protest, blockade or plot.
* **20 laws** in five areas (minimum wage, universal healthcare, retirement age, flat tax or wealth tax, privatisation or nationalisation, technology fund, farm support, green deal, conscription, police powers, war powers, border fortification, media control, anti-corruption agency, regional autonomy, labour migration, free trade, foreign aid), each with real effects and faction reactions. In a democracy they go to a **parliamentary vote**: a hemicycle shows the seats, the forecast is given faction by faction, and you can whip votes with political capital (a defeat costs half the capital). Hybrid regimes rig the vote; autocracies rule by decree at a higher price.
* **Faction demands** every few months (accept, offer a smaller deal, or refuse) and **uprisings** when a faction is furious (concede, send in the police, or wait it out while it costs you every week).
* **Crisis arcs** that unfold in stages, with named people and real places: a **banking crisis** (a guarantee, a quiet takeover or letting it fail decides whether you face moral hazard or a bank run, then the reckoning with the bank's chief), a **border standoff** with a hostile neighbour (mobilise, rally allies or talk; then shots at the border; then an ultimatum, which can end in war), a **coup plot** (arrest, buy off or wait; then tanks in the capital) and a **separatist movement** (talks, a ban or neglect; then a statute, bombs or a referendum; then a showdown).

## People, not just numbers
* **Faces for everyone:** every head of state, minister and general has a procedurally drawn portrait (skin tone and hair typical of the region, age, glasses, beards, suits, uniforms with ribbons and peaked caps) and a name that fits the country (Polish ministers are Tomasz Zieliński and Małgorzata Wiśniewska, Russian ones Volkov and Volkova). All names are fictional combinations.
* **Your cabinet:** Finance, Foreign Affairs, Defence and Interior ministers, each with a trait (Technocrat, Populist, Hardliner, Reformer, Loyalist, Ambitious, Fixer, Old Soldier, Charismatic), 1–5 stars of skill that change real numbers (productivity, treaty acceptance, combat power, stability), and loyalty that follows your popularity. They brief you every week with concrete figures ("a deficit of $24B a year; debt reaches 61% by July 2026"), present each decision and recommend an answer. Scandals, plots, Treasury-vs-generals budget fights and public resignations happen; reshuffle from three candidates or win a minister over. In Legacy, a divided cabinet costs you votes.
* **Diplomatic cables:** foreign leaders answer what you do (treaties, refusals, sanctions, war, peace) in their own voice, coloured by their traits; rivals send the occasional threat, friends a kind word. Reply warmly or firmly. Offers show the leader, their pitch, what the treaty gives you and how the world would react.

## A world that can realign
* **Camps that move:** every country has an orientation from the Eastern camp to the Western camp. It drifts with the company it keeps (allies, partners, friends), with bandwagoning when one camp is clearly winning or collapsing, and with its form of government. A dead zone and a slow rate keep it realistic: realignments take years and need a push. The West's view of its adversaries fades as they lean West and keep the peace, and hardens when they fight Western-leaning states.
* **Organisations are live:** NATO, the EU, the CSTO, the Arab League and BRICS start as in 2024. Members leave when they no longer belong; organisations dissolve when too few remain; outsiders apply and members vote (each vote and its reason is shown); great powers found new pacts and forums; defence pacts bind members with alliance treaties. An alliance whose leading power collapses loses credibility and its members hedge.
* **Regimes change:** revolutions, coups, emergency rule and free elections change a country's form of government and with it who trusts it. The player can face both choices.
* **Your foreign policy:** once a year, turn toward the West or the East or declare non-alignment (political capital, relations shift, the old guard may push back). Apply to or leave any organisation, or found your own. Russia's national path includes a Reset: the Thaw, Open for Business, Free Elections and a European Partnership.
* **A world of minds, not scripts:** every foreign leader has an agenda (security, expansion, wealth, prestige, ideology), a stance on alliances and a camp they prefer, and comes to power on the public mood (war weariness, the cost of allies, the economy, fear, humiliation). Each government pursues a long-term aim for years (revenge, claims, deterrence, regional dominance, the bomb, joining or leaving a bloc, founding one, containing a troublemaker, growth) and drops it when it stalls. Alliance membership is a running cost-benefit sum: a big member that carries too much threatens to leave, partners pay more or it walks. Every leader judges your record (wars, conquests, broken promises, loyalty, crackdowns, reforms, aid, defaults, the bomb) through their own agenda, and it shows in deals, votes, sanctions, coalitions, war and what they say to you.
* **National storylines for every country:** all 199 countries have a storyline written from their real situation (their defining problem, their rival, what their economy lives on, their ambition). Four acts arrive as decisions when events make them urgent (the problem flares up, your rival moves, the economy turns, the world shifts): Act I sets your road (reformer, iron hand or pragmatist), Act II pits you against your rival with an option only your road has, Act III shapes the economy, Act IV can start a change of course. The ending is named by the road and the economy you chose; years later a new chapter opens, built from where you stand then (debt, inflation, war damage, sanctions, unrest). AI countries play theirs by character. The Goals tab shows your chapter, choices and the endings in reach.
* **Change course, as a story:** every country can set out to turn West, turn East, take a third way or lead its region: four or five steps written for its situation (who leads each camp, which organisation might take it, its neighbours), with national flavour for the countries where the choice is most charged (Turkey, India, Ukraine, Iran, Saudi Arabia, China, the US, Pakistan, Serbia, Kazakhstan ...). Steps cost political capital and time, move orientation and friendships, stir factions, and the camp you leave pushes back (a phone call, sanctions). The finale is a membership vote or a new organisation you name. AI countries change course too, rarely and for a reason (a new regime, a dangerous neighbour, the pull of their friends).
* **Alliances evolve:** ties deepen or fray; clubs add mutual-defence clauses when a common threat appears; regional blocs merge or absorb smaller ones; quarrelling blocs split. New blocs get realistic, varied names; you name your own and can rename it.
* **History sticks:** years of goodwill or enmity settle into a long memory that outlasts the news cycle.

## What keeps it busy
* **Choices with consequences:** pay off strikers and other unions want the same; cover up a scandal and the cover-up can unravel a year later; take the investor's money and the strings show up; admit refugees and integration becomes the issue; reinforce a border and they answer in kind. Follow-ups say which choice of yours led to them. Factions remember how you answered their last demand.
* **A treasury you can read:** annual revenue, spending (services, defence, interest) and balance kept apart from the cash in hand and the debt; how long the cash lasts; one-click ways to balance the budget with their side effects; a ledger of one-off costs and automatic borrowing; and every cost button showing how much comes from the treasury and how much is borrowed.
* **Crisis arcs** now also include an outbreak, a heatwave blackout and a leaked-files scandal.
* **Decision events** (about 5 a year, drawn from 140+ kinds): strikes, energy shocks, border incidents, research breakthroughs, disasters, scandals, investment offers, refugees, central-bank calls, coup plots, trade delegations, arms deals, harvest failures, tax demands, allies asking for help, resource discoveries and many more. Each choice has real costs and effects; each card says what happens if you let it lapse and when.
* **A living world:** AI countries have disasters, strikes, coups, booms and border clashes that show up in a live **news ticker**; they declare wars, sign peace, offer you treaties, sanction aggressors and call allies.
* **Objectives:** ten optional goals (grow GDP, open markets, build infrastructure, climb the rankings, win your first conquest ...) that pay out immediately.
* **Covert operations:** gather intelligence, influence, steal technology, sabotage, incite unrest; success depends on the intelligence gap.
* **Active war play:** per-region offensives with progress bars and troop counts, air strikes, calling allies, total mobilisation, war economy, manual or automatic targeting.
* **Supply lines and encirclement:** every army is fed from supply hubs (capital, big cities, 📦 supply-hub buildings, open ports). Pushing deep, through mountains or freshly conquered land, stretches the line; cut a region off and its defenders fight at half strength. Supply lines, convoys and ENCIRCLED pockets are drawn on the map.
* **Generals:** every army at war has named (fictional) commanders with a trait (Blitz, Fortress, Logistician, Encircler, Gunner, Inspiring) and 1–5 stars earned in battle. They lead offensives, show on the army counters and in battle reports, get promoted, and can be killed in action. Recruit, reassign or retire yours in the Military tab.
* **Special operations:** naval invasions (a new front from the sea), airborne assaults (paratroopers up to three regions behind the lines) and, when your land is occupied, partisans who wreck the occupier's supply lines and stop integration.
* **A war room on desktop:** walnut-and-brass panels with engraved section titles and corner fittings, folder tabs with engraved icons, condensed military type for numbers (Barlow Condensed), Cinzel for titles, Cormorant italic for flavour, a procedurally generated **coat of arms** for every country (shield shape, heraldic division, charge and a crest that reflects its government), breaking news as a newspaper flash, and in "Beautiful" graphics: glowing shell bursts with sparks, shock rings and drifting smoke, aircraft with contrails and navigation lights, light pulses running down offensive arrows, army counters that glide with the front, and a burst of colour when a region falls. The phone layout keeps its own compact design.
* **Big moments:** a WAR card when a war involving you starts (both sides, troops, power, war support), a VICTORY / DEFEAT / PEACE card when it ends (duration, casualties, regions), a war history, a war diary, captured regions swept in the conqueror's colour with a glowing new border and a planted flag, floating callouts on the map (CAPTURED, ENCIRCLED, AIR STRIKE ...), war drums, fanfares and distant artillery.
* **War support:** the public's backing for each war rises with victories and an invaded homeland and falls with casualties, a long war and hardship. It changes army morale, stability and how soon a government wants peace; run propaganda, sell war bonds or censor the press to manage it.
* **Conquest you can see:** captured regions flash, are hatched in the original owner's colours until integrated, borders re-draw instantly, armies and battle pulses are drawn on the map, regions have names ("North-East Poland").

## How to play

1. **Pick a mode** (Sandbox or Legacy), your control level and **a country** on the start-screen map (or search 190+ countries). Set difficulty, starting economic
   conditions (historical / crisis / prosperous), AI aggression, defensive alliances on/off, and a victory condition.
2. **Read the map.** Click/tap a country to inspect it; drag to pan, wheel or pinch to zoom. Map modes: Political,
   Relations, Wealth, Power, Stability. Your territory has a gold outline; enemies are red, allies blue.
3. **Run your country** with the side panel (bottom sheet on phones):
   * **Overview** — advisor alerts, key stats, history charts.
   * **Economy** — *why* the economy is growing or shrinking (growth-contribution bars + plain-language summary),
     fiscal position, tax and spending sliders, instant projects (factories, infrastructure, power, farms, R&D),
     borrowing / repaying / printing money, trade and resource balances.
   * **Military** — forces, readiness, logistics, intelligence, exhaustion; budget and procurement mix; recruit,
     demobilise, buy equipment; offensive commitment and manual or automatic targeting; peace talks. At war it also
     shows the **home front** (war support, why it moves, propaganda / war bonds / censorship) and **supply lines**
     (supply per offensive, encircled pockets, a one-tap "build a supply hub here" suggestion).
   * **Diplomacy** — relations breakdown, the **negotiating table** (what they want, red lines, your leverage, terms
     you can add, the odds with every factor, counteroffers and patience), sanctions and embargoes, war declaration
     (with an odds estimate), pending offers from AI countries.
4. **Control time** with the clock (bottom-left on desktop, top-left on phones). Space = pause, 1–4 = speed, + / − zoom.
   The game pauses automatically when someone declares war on you, and two weeks before an urgent decision would
   lapse. While a decision, a menu or the negotiating table is open, the clock holds. Each can be switched off in
   settings. Autosave runs every 26 weeks of game time.

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
    modes.ts     game modes, control levels, autopilot, world starts
    legacy.ts    Legacy career: terms, elections, opposition, score     agenda.ts  agenda cards
    armies.ts    the player's army groups: orders, objectives, hold bonus
    cabinet.ts   the player's ministers: traits, skill, loyalty, scandals, reshuffles   events4.ts  cabinet events
    cables.ts    messages from foreign leaders     names.ts  national name banks
    domestic.ts  factions, political capital, laws, parliament    arcs.ts + events5.ts  crisis arcs, demands, uprisings
    nations.ts   national paths       wargoals.ts + events6.ts  war aims, weapons programmes, war stories
    coalitions.ts  aggression, coalitions, great powers taking sides
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
- **Desktop interface** (`src/desktop.css`, `src/ui/art/`): all desktop styling lives in one stylesheet behind a `min-width: 901px` media query; coats of arms are SVG generated from each country's id (`Emblem.tsx`); battle effects for Beautiful graphics are in `src/map/fx.ts` (pre-rendered glow and smoke sprites, additive blending).
- **Lit coastlines, dashed region lines, heavy national borders**; curved, letter-spaced serif country names that follow each country's shape (Cinzel), italic sea names (Cormorant Garamond).
- **War**: contested regions are split (visually) into small cells that fall to the attacker one by one as the offensive progresses, so the front visibly creeps forward or is pushed back instead of whole regions flipping at once (`src/map/battlefield.ts`). A glowing red line shows where the fighting is, with artillery flashes and smoke, aircraft when one side rules the skies, broad offensive arrows, and NATO-style army counters (divisions, infantry/armour symbol, strength bar) that slide forward with the front. Garrison counters show where your and your enemies' idle troops stand. Click a ⚔ marker for the **battle report** (`src/sim/battle.ts`): forces, odds, ground taken, an ETA, losses, every modifier (terrain, fortresses, air superiority, intelligence, amphibious landing, equipment and tech, nuclear deterrence, doctrines) and actions (air strike, make it a priority, dig in, call allies, negotiate).

Performance: the simulation runs each week in small slices inside a few milliseconds per frame (`tickSlices` in `tick.ts`; the result is identical to running the week at once), so drawing never waits for the world; battles live on their own canvas moved by CSS and only small effects animate per frame; graphics adapt automatically (Settings → Graphics: Auto / Beautiful / Balanced / Fast) when frames run slow. Country and city names live on their own canvas layer (a conquest repaints colours and borders without redrawing every name; names catch up a moment later in a separate frame), outlines and frontlines are drawn into the cached layer, the terrain has its own oversized cache that is just shifted while you pan (redrawn only on zoom), unit counters are cached as sprites, the battle layer is rebuilt at most ~3 times a second at high speed, and the AI's first leaders are chosen when the game is created, battles are cached per week and only the animated bits are drawn per frame, conquests batch their redraws, panels refresh at a steady rate while the clock runs, and the backing resolution is capped at 1.5x on touch screens. `node scripts/perf-browser.mjs 4` measures frame rates with the CPU slowed 4x.

The static layer is drawn once into the visible canvas and moved with a GPU-composited CSS transform while you pan or zoom (eased zoom, inertia), then re-rendered crisply when the view settles or territory changes. National borders are precomputed shared boundary runs between provinces, stroked when their two sides have different owners. Labels, fronts and effects go on a light overlay canvas.

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

* attacker power = committed troops × quality × tech × readiness × **supply** × air support × intel edge × amphibious
  penalty × **morale** (war support);
* defender power = field troops reinforced where pressure is highest × fortification × **terrain** × capital bonus ×
  morale × 0.55 if the region is **encircled**;
* **supply** (`supply.ts`): each week every country at war runs a shortest-path search from its hubs (capital, its
  largest home cities, supply-hub buildings, and coasts while not blockaded) over its own, allied and co-belligerent
  land. A step costs distance × terrain, ×1.8 through land conquered recently. Front supply = 1.08 − 0.5·(path /
  reach)^1.4 (25–100%) × logistics capacity (infrastructure, tech, blockade, war economy). Own land no hub can reach
  and that touches the enemy is a **pocket**: its defenders fight at 55%, bleed troops and fall faster;
* **war support** (`warsupport.ts`, 0–100%, normal 60%): starts high for defenders (rally round the flag), lower
  for unprovoked aggressors; weekly drivers are casualties (democracies feel them most, defenders half as much),
  war length, an invaded homeland, war score, inflation/blockade/bombing and unrest, plus one-off swings from battles
  won and lost. It sets morale (×0.85–1.10), adds exhaustion and costs stability when low, and enters every peace
  evaluation;
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
- **Goals tab** (`src/ui/tabs/GoalsTab.tsx`, `src/ui/guides.ts`): 40 objectives (three active, never handed out already complete) with how-to tips, plus a country check-up (growth, budget, debt, inflation, jobs, energy, food, stability, infrastructure, army vs threats, readiness, forts, allies, trade, reputation, sanctions). Guidance depends on difficulty: Easy gives full explanations and one-tap fixes, Normal gives status lights, tips and one top priority, Hard gives none (the Overview advisor follows the same rule).
- **Political calendar**: an election (or, in a one-party state, a leadership congress) every four years.

## Data provenance — real vs generated
* **Real (approximate, rounded, ~2023–24):** population, nominal GDP, military spending share, active troops,
  government type, nuclear status, capitals, debt ratios, rivalries and bloc membership. These come from the
  author's recollection of IMF/World Bank/SIPRI/IISS-range figures and are meant as a *game baseline, not a
  citation*; rows marked `E` in `src/data/countryData.ts` are rough game estimates.
* **Game-generated:** everything derived — capital stock, productivity, tech and infrastructure levels, tax-rate
  split, equipment stocks, resource balances, terrain ruggedness, provinces and their weights, AI personalities.
* Map data: Natural Earth (public domain) — borders, the NE1 land-cover/relief and sea-floor relief rasters, rivers, lakes, populated places and marine area names. The game starts at peace in 2024 (no scripted wars or events).
* Fonts: Cinzel, Cormorant Garamond, Barlow and Barlow Condensed via Fontsource (SIL Open Font License), embedded in the build.
* Leaders are fictional: names are generated, not real people.

## Status vs. the roadmap
| Stage | Status |
| --- | --- |
| 1 — vertical slice (map, stats, budget, clock, military, war, territory, responsive UI) | ✅ done and tested |
| 2 — trade, diplomacy, AI, alliances, peace talks | ✅ done |
| 3 — richer economy, logistics, population, technology | ✅ first version (resource markets, trade index, intel fog, tech/R&D; no tech tree) |
| 4 — save/load, balancing, tests, performance, mobile polish | ✅ saves/autosave/export, 120 unit tests + e2e smoke test, ~13 ms/tick for the whole world; balance is a first pass |

## Known limitations / ideas for next iterations
* Provinces are coarse (656); microstates are a single province, so one capture annexes them. Rebel/secession states,
  puppets and vassals are not modelled; unrest causes upheaval and forced ceasefires instead.
* Combat is abstract by design (no unit-level tactics); nuclear weapons act as deterrence only (never used).
* Balance needs playtesting: AI war frequency, peace-time attrition and long-run (30+ year) GDP trajectories are tuned lightly.
* Ideas: tech tree, multi-front alliance coalitions, per-province buildings, historical event packs, richer news,
  per-country flags, sound, a service worker for offline play.

## Licence
Code: see `LICENSE`. Map data: Natural Earth (public domain) via `world-atlas` (ISC).
