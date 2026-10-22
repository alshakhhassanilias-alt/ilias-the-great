# WORLD ORDER — a modern geopolitical strategy simulator

A playable, browser-based grand-strategy sandbox. You lead a real country from **1 January 2024**: run its
economy and budget, trade, form alliances, impose sanctions, build an army, declare war, take territory and
negotiate peace — in a living world where ~190 AI-controlled countries develop, scheme and fight on their own.

* **No waiting, ever.** There are no construction timers, energy timers or pay-to-skip. Every decision takes effect
  immediately (money moves, capacity is built, troops are raised, war is declared *now*) or at the very next
  simulation tick. The world runs on a simulated clock you control: ⏸ pause · ▶ slow (a year in 52 s) · ▶▶ normal (26 s, the default) · ▶▶▶ fast · ⏩ very fast.
* **Real map, dynamic borders.** Natural Earth borders (1:10m), subdivided into ~2,800 regions built around real towns and named after them. Conquest transfers
  provinces (with their population and output) and the national borders are re-drawn live.
* **Runs locally.** React + TypeScript + Vite, a canvas map, no backend, no API keys, no costs.

## Play without installing anything
Download **`play/world-order.html`** (single file, about 4 MB) and double-click it. It runs offline in any modern browser (Chrome, Edge, Firefox, Safari, phone browsers too). Saves go to that browser's storage. The music streams from this repository when you are online; offline the game plays without it.

## The desktop app (Windows, macOS, Linux) and Steam
`desktop/` wraps the game in an Electron app built for Steam: saves are files on disk (Steam Cloud ready), crash
reports go to a logs folder, the window remembers its size, and the 24 trophies unlock as Steam achievements.
* **Try it:** `npm install`, then `npm run desktop`.
* **Build it:** `npm run desktop:dist` (output in `desktop/release/`), or on GitHub: *Actions → Desktop build → Run
  workflow* builds Windows, macOS and Linux and attaches them as downloads.
* **Put it on Steam:** step-by-step in [`desktop/STEAM.md`](desktop/STEAM.md) (app id, depots, achievements with
  icons, Steam Cloud paths, overlay, crash reports).

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173 (desktop and phone browsers on the same network)
```

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `preview` | Vite dev server / production build (also type-checks) / serve the build |
| `npm test` | 203 deterministic simulation tests (Vitest) |
| `npm run desktop` / `desktop:dist` | Run the desktop app / build it for release (see `desktop/STEAM.md`) |
| `python3 tools/music/tracks.py` | Re-render the score into `public/music/` (numpy, scipy, ffmpeg) |
| `npm run e2e` | Browser smoke test (Playwright): desktop + mobile play-through; run after `npm run build` |
| `npm run build:map` | Regenerates `src/data/generated/world.json` from Natural Earth 1:10m borders and populated places (~5 min; `WO_NE_DIR` points to the Natural Earth GeoJSON folder), then rerun `scripts/build-features.ts` |
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
* **Political capital** is the scarce currency of power: about 25–45 a year (plus treaties, objectives and the capital levers), more when you are popular and your cabinet is loyal. Laws cost 14–34, doctrine reforms 10, crisis responses 6–15. Every few months you must choose what to spend it on.
* **Six factions** (Unions & Workers, Business & Finance, the Military, Nationalists, Liberals & Civil Society, Regions & Farmers), each with a named leader, a share of the population (seats in parliament), a clout that depends on the regime (the army matters most in a junta) and a mood that follows the budget, the economy, wars, the laws you pass and how you answered their demands. Favours are forgotten fast, grudges slowly, and expectations rise the longer you govern. Their mood feeds stability, approval and elections; happy factions give perks (investment, productivity, defence, reputation), furious ones go on general strike, move capital abroad, riot, protest, blockade or plot.
* **20 laws** in five areas (minimum wage, universal healthcare, retirement age, flat tax or wealth tax, privatisation or nationalisation, technology fund, farm support, green deal, conscription, police powers, war powers, border fortification, media control, anti-corruption agency, regional autonomy, labour migration, free trade, foreign aid), each with real effects and faction reactions. In a democracy they go to a **parliamentary vote**: a hemicycle shows the seats, the forecast is given faction by faction, and you can whip votes with political capital (a defeat costs half the capital). Hybrid regimes rig the vote; autocracies rule by decree at a higher price.
* **Faction demands** every few months (accept, offer a smaller deal, or refuse) and **uprisings** when a faction is furious (concede, send in the police, or wait it out while it costs you every week).
* **Crisis arcs** that unfold in stages, with named people and real places: a **banking crisis** (a guarantee, a quiet takeover or letting it fail decides whether you face moral hazard or a bank run, then the reckoning with the bank's chief), a **border standoff** with a hostile neighbour (mobilise, rally allies or talk; then shots at the border; then an ultimatum, which can end in war), a **coup plot** (arrest, buy off or wait; then tanks in the capital) and a **separatist movement** (talks, a ban or neglect; then a statute, bombs or a referendum; then a showdown).

## Round 30: a detailed map, wars that mean something, a world that answers
* **2,804 regions instead of 1,224, built around real towns and named after them.** Each country is divided around
  its real cities (Natural Earth's 7,300 populated places): Poland is Warsaw, Katowice, Łódź, Gdańsk, Wrocław,
  Poznań, Lublin and ten more, not "West Poland II"; Ukraine is Kyiv, Kharkiv, Odessa, Lviv... Crowded countries get
  small regions, empty Siberia and the Sahara big ones. A region's weight (its share of the people, the economy and
  what a war is fought over) follows its towns' population, so Moscow outweighs a Siberian district many times its
  size. Land without a town takes its name from its neighbour and its ground ("Kutaisi Highlands", "Batumi Coast").
* **Winding borders.** Borders between regions follow smooth, irregular lines like real ones instead of the straight
  edges of a Voronoi diagram, and country outlines come from Natural Earth's detailed 1:10m borders, simplified along
  shared arcs so neighbours always meet exactly.
* **Old saves still load.** A save from the old map is laid onto the new one region by region (owners, occupation,
  buildings, resistance and capitals follow the ground; fronts re-form within a week).
* **Wars that take time and end for a reason.** A country is now taken region by region (Poland against Belarus:
  four years, twelve battles, from Brest to Minsk to Mahilyow), fronts are wider, and supply comes from regional
  depots spread across a country instead of a few big cities. A war against you never just stops: if a coup or a
  collapse hits the enemy, its new rulers send you a peace offer with land and say why. If your own government is
  collapsing, you decide (sue for peace, martial law, a government of national unity) instead of a dice roll ending
  every war.
* **Nobody watches a friend be swallowed.** When a country has lost its capital or a third of its land, a strong friend
  that is not already fighting may enter the war to save it, whoever started it (an ally first; China will not fight
  Russia for Kazakhstan). If you are that friend, you are asked.
* **The world answers you.** Going to war, being attacked, taking a capital, losing ground, making peace, a crackdown at
  home, reforms, a default, a nuclear programme or a broken treaty: the leaders who matter (your rival, your allies,
  the great powers, the other side's friends and neighbours) each say what they think in their own words, in
  proportion to how they feel about you and the other side, and relations move. Your own press and public answer too
  ("Poll: 58% back the war", "Students march: not in our name"). On the desktop each round is one card with the
  leaders' portraits; on every device it is in the news.
* **Objectives that never run out and follow the way you play.** Your path is read from what you have actually done
  (the Conqueror, the Strongman, the Reformer, the Trader, the Peacemaker or the Builder) and new objectives are made
  for it from the world as it is: the next economy to overtake, the army to outgun, the big power to win over, the
  ally to sign, the market to open, the feud to end, the enemy to defeat, the land to take back, the region to
  dominate. A war puts its objective first. When the fixed objectives are done, generated ones carry on for ever.
  The mission card shows your path, why, and an ambition that follows it ("Make Russia the master of Eurasia").
* **The story notices your direction.** When your path settles (half a year as a conqueror, a strongman, a reformer, a
  trader or a peacemaker), a turning-point decision asks what kind of nation you are making, with real effects:
  proclaim a greater nation or offer a grand peace; more powers for the police or free elections; a new
  constitution; a trading bloc of your own; a permanent seat in world diplomacy.
* **Captured land changes hands visibly.** The old owner's colour holds the region while the conqueror's sweeps across
  it from the side the attack came from, behind a bright leading edge (it used to flash over a region that had
  already changed colour).
* **Rules rescaled to the finer map** so history keeps its pace: about as many breakaways as before, and two
  established nations (Italy and Switzerland, Germany and the Netherlands) no longer merge in the first century and a
  half. An AI country waits six years before attacking the same neighbour again.
* **Performance:** about the same as before on a CPU slowed to a quarter (11 fps during a war at top speed, 8 while
  panning; 60 fps paused), 41–48 ms per simulated week headless.

## Round 29: less boring, and a world that makes sense
Found by playing headless games as Poland, Brazil, the United States and Nigeria for 15 years and reading every
headline, decision, message and number the player sees.
* **The music no longer stops.** It used to play once and go silent for good: a cancelled track was taken for a
  refusal to play, and changes of mood cut tracks off mid-load. Now a watchdog keeps a track playing at all times,
  moves on when one ends or fails, waits a few seconds before following a new mood, never repeats a track twice in a
  row, and its fades work in a background tab. The 2021 pandemic no longer makes the score tense.
* **Wars need a cause.** AI countries used to attack anyone weaker ("Vietnam declares war on Laos", "Turkey on
  Jordan"). Now there has to be a claim, a feud, a grudge, a plan aimed at the target or a case made at home, and
  never against a friend. War breaks out at flashpoints (Taiwan, Georgia, Guyana, Western Sahara, Algeria and
  Morocco): 4–5 wars in 15 years instead of 20–24. Great powers arm the victim; they arm an aggressor only if it is a close friend
  fighting a declared enemy (no more Germany arming Turkey against Jordan).
* **Clubs keep their identity.** BRICS no longer fills up with France, Germany, Canada and Vanuatu: a non-aligned
  club takes countries that sit near its members, not the other camp's loyalists or micro-states, and members of a
  customs union (the EU) join no other trade bloc and do not found rival ones. **Joining takes years:** a country
  applies (it is in the news), waits (about ten years for the EU, two for a club, one for an alliance) and then the
  members vote. No more Norway and the UK joining the EU in 2021 and 2022.
* **The map is settled at the start and loosens with time.** In the first decades new nations are born and unions
  formed about a third as often (a stable, well-run state like Canada almost never loses a region; a failing one
  does); after a century or two history moves twice as fast as it did. Empires earn their titles by holding other
  peoples for fifteen years, not after one war. No more "North South Sudan".
* **Messages fit the relationship.** A strongman who likes you no longer writes "Do not test us"; offers sound as
  warm as relations really are; grievances are told in the right voice ("imposed sanctions on us", not "on it");
  "the old enmity" only where there is one; the generals name your real rival, not China for Poland.
* **Numbers that make sense.** Unemployment starts from each country's real rate (the US at 3.9%, Spain at 11.8%, South
  Africa at 32%) and moves with the business cycle instead of sitting flat for decades. Governments no longer hoard
  trillions in cash while they owe money: a surplus beyond a working buffer repays debt. Decision texts say
  "shrinking 0.9% a year", not "growing -0.9%", and "Gains 10 political capital", not "Costs -10".
* **Something to play for, always on screen (desktop).** A mission card tops your country's panel: the nation's
  ambition ("Make Poland a leading power of Europe"), the act of its story you are in and what comes next, and your
  three current objectives with progress bars, rewards and a one-click "Do it" or "Go".
* **Faster.** The clock runs twice as fast at every speed (a year in 26 seconds at Normal), and a new game starts
  at Normal instead of Slow.
* **Less to read (desktop).** Long decisions show their first lines with "More…" for the rest; ministers' briefings
  stay at two lines until you open them; the budget rule's notices are one line.
* **Tested over 500 years** (a headless game from 2021): the first decades stay close to the world we know (4% of
  the land changed hands by 2070); by 2519, 76 nations had been born and 3 restored, 41 unions formed, a third of the
  world's land had changed hands, and 234 nations stood (199 at the start). A slow leak in the birth rate that let
  the United States reach a billion people is fixed: family policy nudges births but no longer compounds for
  centuries, and the world's population levels off near 11.5 billion.

## Round 28: centuries of history, and a 2021 start
Play for decades or for a thousand years: the map changes the way it always has.
* **New nations are born.** Big countries crack along their far edges in hard times (a lost war, years of turmoil, a
  weak centre): the Russian Far East, Xinjiang or the Amazon can become a republic, named after its main city or
  region ("Republic of Hotan", "West Canada", "Free State of Santarém"). A hard-line parent may fight a war of
  independence instead of letting go.
* **Old nations rise again.** A country swallowed by a neighbour comes back under its own name when its conqueror
  weakens; an empire in deep crisis loses all its unintegrated conquests at once.
* **Empires and unions.** A country that rules many peoples takes an imperial title ("Empire of Ethiopia",
  "Commonwealth of India") and drops it when they are gone; close allies that have long been alike unite, as equals
  under a new name ("Lithuania-Latvia Union") or with the smaller joining the larger. Big old nations rarely do.
* **Assimilation.** Conquered land governed well for about fifty years comes to see itself as part of the country
  that holds it.
* **Your country too:** if one of your regions wants to leave you decide (let it go, a referendum, autonomy, or a
  crackdown that may start a war of independence); a close ally may propose a union.
* **World → History** lists every nation born, restored, united, renamed and fallen; a country's header says where
  it came from ("Founded in 2087, breaking away from Brazil").
* **The long run is sane now.** Before this round, a 300-year game ended with 2.3 trillion people and Guyana worth
  $46 quadrillion trillion. Now: booms fade into convergence (the poorest catch up fastest, the richest grow about
  1% a year), birth rates fall with the demographic transition so the population levels off, and money is shown in
  the dollars of the year you started.
* **Tested over a thousand years** (a headless game from 2021 to 3017): 121 nations were born and 15 restored, 70 unions
  formed, 31 nations were conquered; half of the world's land changed hands and 235 nations stood at the end (199 at
  the start). Population follows the UN path (about 9.3 billion by 2046, a peak near 10–11 billion, then level), each
  country starting from its real growth rate. No broken numbers; the save stays under 5 MB.
* **A "Centuries" speed** (key 5) runs as fast as your computer allows.
* **Start in 2021 (the new default) or 2024.** 2021 is the world before the wars: Ukraine at peace and at peacetime
  strength, Finland and Sweden outside NATO, BRICS still five members, the West's rivals not yet its declared
  adversaries, economies in the dollars of 2021, the pandemic's last wave fading.

## Round 27: deep QA (what was quietly breaking the world)
Found by long automated games (20 years, many countries and seeds) and by playing the opening as a new player.
* **No more debt death spirals:** 17 AI countries used to end with debts of 400–13,000% of GDP at 40% interest. A
  country that can no longer pay now defaults and restructures to a level it can carry; rates are capped at 25%.
* **No more collapsing economies:** fragile states used to shrink 40–80% a year because output followed every swing
  in stability. Output now follows stability over months, and productivity wrecked by war or turmoil recovers toward
  its normal path.
* **Inflation no longer makes countries rich:** prices are in dollars, so a high-inflation currency loses value;
  Turkey or Iran no longer grow tenfold in dollars in 15 years.
* **Every game is different:** leaders' tempers vary from game to game, and the real 2024 security guarantees exist
  (the US for Taiwan, the main NATO powers for Kosovo). Before, China invaded Taiwan in 7 of 10 games and Serbia
  attacked Kosovo in 7 of 10; now the opening crises vary from game to game.
* **Wars end sensibly:** peace treaties only hand over land next to the winner and never the loser's capital (before,
  a peace could hand Russia the capitals of Sweden and Finland at once); capitals are much harder to storm; great
  powers arm a country fighting off an invasion at real-world scale, so Kyiv does not always fall.
* **Interface:** pop-up news no longer covers an open decision; each offer quotes its own covering note and offers
  have more varied wording; war odds and troop numbers in plain words ("their defence is about 3 times your
  attack", "1.2 million troops"); the year in review disappears after a quarter; a full political capital bar says
  so and points to where to spend it.

## Round 26: what players expect from a Steam game
* **Save slots:** named saves, rotating autosaves (every 1–24 months, keep 1–10), F5 quick save / F9 quick load,
  Continue on the main menu, export and import; old saves move over by themselves.
* **Settings with tabs:** Game, Display (fullscreen, interface size, map graphics, fewer animations, autosave), Sound
  (master, music, effects, quieter while paused, mute in the background) and **Controls: every key can be rebound**.
* **A pause menu** (Esc): resume, save, load, settings, how to play, replay the walkthrough, quit.
* **A first-game walkthrough** that points at the real interface and waits for you to try things; skip or replay it.
* **Crash handling:** an error pauses the game instead of breaking it; a crash screen offers a rescue save, carry on
  or back to the menu, and a report you can copy (the desktop app also writes it to a log file).
* **An original score:** seven pieces (main theme, three for peace, one for tension, two for war) that crossfade as
  the world changes; the main theme returns in the war music. They are generated in code (`tools/music/`), so they are
  free to ship. Replace them with your own: see `public/music/README.md`.
* **Fixes:** developing economies no longer grow implausibly fast (India ~7.7% a year instead of 9%, Nigeria ~3%
  instead of 7%); the decision list no longer covers the clock; breaking news no longer covers offers; a leader's
  covering note is no longer shown twice; the war room says "too early to tell" in a war's first weeks.

## Round 25: deeper war, countries that differ, trade as a weapon
* **War campaigns** (war room): general offensive (+25% attack, +40% losses, war support rides on the result), strategic bombing of factories, power grid or cities (scaled by air superiority; bombing cities kills civilians and costs reputation and relations), naval blockade (stacks on the automatic one; the target's trading partners resent it) and defence in depth (+25% defence, −40% attack). AI countries choose campaigns by how their war goes (`campaigns.ts`).
* **Occupation and resistance** (`occupation.ts`): every conquered region has a resistance level driven by the homeland still fighting, partisans, hatred between the nations, integration and the occupier's policy. Resistance slows integration, kills garrison troops every week and can become an uprising that returns the region to its homeland. Three occupation policies: hearts and minds (costly, +50% integration), garrison and curfew, iron fist (fast suppression, but resentment builds and pushes resistance back up; reprisals cost reputation and civilian lives and leave grudges).
* **Peace conference** (`peaceterms.ts`): on top of the borders, demand reparations (2% of GDP a year for five years, paid monthly and shown in the ledger), demilitarisation (ten years: defence budget capped at 1.2% of GDP, border forts razed, no war against you), leaving alliances, a friendly government (regime change: new leader, orientation and alliance) or a formal apology. Each demand adds to what the other side needs; the conference shows willingness against what you ask. AI victors demand them too.
* **National character** (`character.ts`): 13 traits (petro-state, breadbasket, energy importer, ageing society, youth bulge, frontline state, island, landlocked, silicon shield, mineral giant, financial hub, remittance economy, tourist magnet, continental power) with real rule changes, and 14 kinds of national challenges with real-world local names (insurgencies, cartels, pension time bombs, inflation spirals, corruption, coal, water, inequality, brain drain, property bubbles, debt overhangs, climate disasters, migration pressure, life under sanctions) in about 150 country cases. Severity drifts with each country's situation; three responses per challenge, each with a cost and a side effect. Baselines are calibrated so 2024 matches real data: getting worse hurts, solving helps.
* **Trade as a weapon** (`trade.ts`): chips and critical minerals join energy and food as strategic goods, with real producer shares (Taiwan about 40% of chips, China most refined minerals). A cut-off country loses productivity and military technology; a war that hits a producer sends world prices up (a war over Taiwan is a world chip crisis) and high prices pay producers. Export bans (any of the four goods) and tariffs (trade shrinks on both sides; targets hit back) for the player and the AI. A business cycle with visible warning signs and a recession risk that can bring the next recession early.
* **Play-test and fixes:** bots played 10-year games as six countries in three styles, before and after. Passive play now differs from active play because challenges worsen when ignored. The rate of AI trade wars was tuned down (from about 19 to about 7 in five years). AI countries are less effective at their own challenges, so the world's problems persist. Small countries no longer launch offensives they cannot win, and casualty figures under 1,000 are no longer printed as "0,000". The monthly trade calculation takes about 0.9 ms and runs in its own slice of the week.

## Round 24: depth and smoothness
* **Smoother late game:** when land changes hands, only the rectangle around it is repainted (about 4 ms instead of 90 ms for a full map redraw; pixel-identical); autosave writes in idle time. Late game at the top speed: 59–60 fps with no frame over 50 ms on a normal CPU, worst frame 100 ms on a CPU slowed to half speed (it was 350–450 ms).
* **Negotiating styles:** ten in all, now with the Royal Court, the Swing State and the Wounded Nation. New terms: a cheap loan (repaid weekly over about five years), discounted energy supplies, backing their cause against their rival.
* **Reconciliation, deeper:** more gestures (scholarships, a joint memorial for the dead of an old war), their requests (do it within 12 weeks and it counts double; ignore it and trust falls), incidents you answer yourself (keep talking, retaliate, demand an apology), a summit agenda (peace pact, normal trade, settle the old quarrel), and a fifth stage: a treaty of friendship that makes the détente permanent and ends the rivalry.
* **Constitutions:** six constitutional laws (federal constitution, independent central bank, term limits, presidential system, ceremonial crown, council of guardians) and a new regime path, rule of the clerics, that makes a theocracy. Each has real effects: law costs, inflation, borrowing rates, the wear of power, capital income, how democracies see you.

## Round 23: deeper, fairer, clearer
* **Money that works:** one-off decisions cost half what their tables say (and the real price is shown in money); a **fiscal rule** (on by default) has the finance minister close up to 0.4% of GDP of the deficit gap each quarter; **levers** to raise money, each with a price and a cooldown: sell state companies (each sale yields less), a spending review, a tax enforcement drive, a cheap loan from a friendly power, an oil & gas concession.
* **Political capital you can earn:** about 25–45 a year, plus +2 per treaty (+4 alliances) and +6 per objective; levers to build it: address the nation, hand out favours, call in a favour from a happy faction, silence the opposition (not in a democracy).
* **Negotiating styles:** the Merchant, National Pride, Security First, the True Believer, the Strongman, Answers to Voters, the Pragmatist. Each values terms differently and has its own patience and opening line. New terms: a state visit, a formal apology, pulling troops back, a discounted arms sale.
* **Reconciliation:** back channel → confidence-building gestures → summit → a two-year détente. Hardliners may sabotage it; a war ends it.
* **Changing the system:** five paths (full democracy, political opening, emergency rule, restore the crown, one-party state), three paid steps each, each with a real risk.
* **The war room:** military casualties per side, civilian deaths, refugees, a chart of casualties and war score over time, every country involved, the fronts, the war's story. Past wars keep their record.
* **Concrete words:** leader messages quote real numbers and grudges; every storyline act opens with a briefing in figures; objectives name the best partner and the odds, and new objectives appear for pressing problems (a deficit, an angry faction, a bitter enemy, laws to pass).
* **Smoother:** portraits are cached images, the selection highlight moved off the base map, heavy panels are cached, the date formatter no longer uses the slow locale API.

## People, not just numbers
* **Faces for everyone:** every head of state, minister and general has a procedurally drawn portrait (skin tone and hair typical of the region, age, glasses, beards, suits, uniforms with ribbons and peaked caps) and a name that fits the country (Polish ministers are Tomasz Zieliński and Małgorzata Wiśniewska, Russian ones Volkov and Volkova). All names are fictional combinations.
* **Your cabinet:** Finance, Foreign Affairs, Defence and Interior ministers, each with a trait (Technocrat, Populist, Hardliner, Reformer, Loyalist, Ambitious, Fixer, Old Soldier, Charismatic), 1–5 stars of skill that change real numbers (productivity, treaty acceptance, combat power, stability), and loyalty that follows your popularity. They brief you every week with concrete figures ("a deficit of $24B a year; debt reaches 61% by July 2026"), present each decision and recommend an answer. Scandals, plots, Treasury-vs-generals budget fights and public resignations happen; reshuffle from three candidates or win a minister over. In Legacy, a divided cabinet costs you votes.
* **Diplomatic cables:** foreign leaders answer what you do (treaties, refusals, sanctions, war, peace) in their own voice, coloured by their traits; rivals send the occasional threat, friends a kind word. Reply warmly or firmly. Offers show the leader, their pitch, what the treaty gives you and how the world would react.

## A world that can realign
* **Camps that move:** every country has an orientation from the Eastern camp to the Western camp. It drifts with the company it keeps (allies, partners, friends), with bandwagoning when one camp is clearly winning or collapsing, and with its form of government. A dead zone and a slow rate keep it realistic: realignments take years and need a push. The West's view of its adversaries fades as they lean West and keep the peace, and hardens when they fight Western-leaning states.
* **Organisations are live:** NATO, the EU, the CSTO, the Arab League and BRICS start as in 2024. Members leave when they no longer belong; organisations dissolve when too few remain; outsiders apply and members vote (each vote and its reason is shown); great powers found new pacts and forums; defence pacts bind members with alliance treaties. An alliance whose leading power collapses loses credibility and its members hedge.
* **Regimes change:** revolutions, coups, emergency rule and free elections change a country's form of government and with it who trusts it. The player can face both choices.
* **Your foreign policy:** once a year, turn toward the West or the East or declare non-alignment (political capital, relations shift, the old guard may push back). Apply to or leave any organisation, or found your own. Russia's national path includes a Reset: the Thaw, Open for Business, Free Elections and a European Partnership.
* **Two ways to play, each its own:** in Sandbox you are the nation itself (no elections, no personal leader; your storyline can be switched off). In Legacy you are one person: you pick your style (Hawk, Dove, Reformer, Strongman ...), foreign leaders react to it, your personal record follows you out of office and back in (the country gets a partial fresh start abroad while you are out), and your storyline's chapters follow your terms. Every new game is its own world (a fresh seed; replay or share one with `?seed=12345`).
* **A world of minds, not scripts:** every foreign leader has an agenda (security, expansion, wealth, prestige, ideology), a stance on alliances and a camp they prefer, and comes to power on the public mood (war weariness, the cost of allies, the economy, fear, humiliation). Each government pursues a long-term aim for years (revenge, claims, deterrence, regional dominance, the bomb, joining or leaving a bloc, founding one, containing a troublemaker, growth) and drops it when it stalls. Alliance membership is a running cost-benefit sum: a big member that carries too much threatens to leave, partners pay more or it walks. Every leader judges your record (wars, conquests, broken promises, loyalty, crackdowns, reforms, aid, defaults, the bomb) through their own agenda, and it shows in deals, votes, sanctions, coalitions, war and what they say to you.
* **Turning points, not scripts:** any country can change sides, Russia, China and Iran included, but only through a chain of causes: crisis (defeat, economic collapse, sanctions) → the regime cracks → a leader who breaks with the old line → a thaw (the courted camp warms, the old one cools) → and a possible hardliner backlash that reverses it. Western countries can turn away the same way. Leaders' economic instincts (reform, trade, tariffs, cronyism, dogma) shape growth year by year, and over-borrowed countries can hit debt crises.
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
4. **Control time** with the clock (bottom-left on desktop, top-left on phones). Space = pause, 1–4 = speed, + / − zoom,
   Esc = menu, F5 / F9 = quick save / load (all keys can be changed in Settings → Controls).
   The game pauses automatically when someone declares war on you, and two weeks before an urgent decision would
   lapse. While a decision, a menu or the negotiating table is open, the clock holds. Each can be switched off in
   settings. Autosave runs every 6 months of game time by default (Settings → Display).

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
Natural Earth admin-0 (1:10m, via `world-atlas`, public domain), simplified along the topology's shared arcs →
Natural Earth projection → per-country seeds at the capital and the largest well-spaced real towns (Natural Earth
1:10m populated places), filled out in empty land and relaxed toward even sizes → Voronoi cells whose edges are
given a smooth, deterministic meander (bounded so borders never cross) → **clipped to the real border**
(polygon-clipping) → each region named after its town and weighted by its towns' population → province adjacency
from shared boundary segments (exact matches, then geometry for the rest). `src/data/generated/oldmap.json` maps the
old 1,224-region map onto the new one so old saves load. Overseas dependencies (Greenland, Puerto Rico, Hong Kong …) become
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
