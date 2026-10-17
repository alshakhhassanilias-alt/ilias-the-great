# Balance report: automated playtests

No human playtesters were available, so balance was tested with **bots** that play full games from 2024 to 2034.
`scripts/playtest.ts` runs them.

The bots play four styles across ten countries: Poland, the USA, China, Russia, Brazil, Nigeria, Iran, Germany, India and Turkey.

| Style | What the bot does |
| --- | --- |
| **passive** | Answers every decision with the first safe option and does nothing else. |
| **builder** | Passes economic laws, runs economic national projects and answers decisions sensibly. |
| **politician** | Plays Legacy mode: picks agendas, passes popular laws and gives the factions what they want. |
| **warmonger** | Attacks its weakest neighbour every two years, declares total war aims and builds weapons programmes. |

```
npx tsx scripts/playtest.ts <passive|builder|politician|warmonger> <years> [Country,Country,...] > out.json
```

## What the first run found, and what changed

| Problem found | Evidence | Fix |
| --- | --- | --- |
| A decision could start a war by default | Germany (builder) clicked the first option of "Generals demand action" ("Declare war"), attacked Russia alone and was overrun in four months | Options that start or risk a war are never the first, highlighted choice. A test enforces this for every event. |
| Peaceful play had no tension | Approval 60–94%; the politician won **every** election in every country | Approval now starts lower, is pulled down the longer you rule, and elections are fought against an opposition that grows each term. The politician now wins about 1–2 elections and loses about one in 10–12 years. |
| Stability bonuses piled up | Stability 85–97 for builders | Bonuses from doctrines, laws, ministers and national projects now have diminishing returns, topping out at about +9. |
| The same crisis kept repeating | A banking crisis in **every** game, up to 7 times in one | Three new crises (outbreak, heatwave blackout, leaked files). The same crisis can't recur within three years or more than twice. The banking crisis is rarer for countries with low debt. |
| The same faction demanded twice in a row | Unit test | The demanding faction rotates. |
| Aggression had no lasting cost | No coalition ever formed, even against serial aggressors | Aggression now builds up from wars of conquest and captured regions. Neighbours form coalitions that sanction the aggressor and join any war on a member. |

## Results after tuning

Values are averages over 10 years.

| Style | Stability | Approval | Growth/yr | Laws passed | National projects | Wars | Coalition against you |
| --- | --- | --- | --- | --- | --- | --- | --- |
| passive | 55–88 | 40–64% | 0.8–6.9% | 0 | 0 | 0 | never |
| builder | 61–91 | 46–73% | 1.7–8.4% | 3–7 | 5–7 | 0 | never |
| politician | 62–90 | 49–73% | 2.1–7.6% | 2–6 | 5–7 | 0 | never |
| warmonger | 36–76 | 33–50% | −5.2–5.6% | 1–5 | 3–7 | 3–5 | 2.8–6.7 years of the 10 |

What this means:

- **Building and politics pay off.** Builders and politicians grow faster than passive players: India 8.4% against 6.9%, the USA 4.2% against 2.4%.
- **Elections are uncertain.** The politician won 2 of 2 in China, Brazil, Nigeria and India. It lost its first re-election in the USA, Iran, Germany and Turkey. It split 1–1 in Poland and Russia. Legacy grades ranged from A to C.
- **War is costly.** Warmongers spent 3–7 of the 10 years facing a coalition, approval fell to 33–50%, and stability dropped as low as 0–15 in the worst years. Germany and Turkey were destroyed after repeated invasions. Their national path progress dropped with them.
- **Crises vary.** Every crisis type now appears across the runs, and no game saw the same one more than twice.
- **Political capital is scarce for active players.** Builders and politicians averaged 14–61 political capital. Passive players sit near the 100 cap because they never spend it, which is expected.

## Known remaining issues

- **Nigeria and India grow 6–8% a year in every style.** That comes from the starting economic calibration (catch-up growth), not from this round. Plausible for a decade, but worth checking over 30 years.
- **Peaceful stability is still high for rich democracies** (USA 88–91). It's realistic, but the USA could use more domestic friction, for example a stronger effect from nationalist/liberal polarisation.
- **Coups never happened in any peaceful game.** The coup storyline needs an angry military, which a peaceful player rarely creates. That's fine, but it means many players will never see it.
- **The bots are simple.** Real players will find strategies they don't, such as stacking cheap laws or exploiting peace deals. Human playtesting is still the real test.

## Round 15: trust, treasury, negotiation, repetition

### The treasury

Measured with `fiscalNow` over the first two years with no player input. The "before" column is the previous calibration.

| | Before | After |
| --- | --- | --- |
| Starting deficit (most countries) | 2–3.5% of GDP | 0.5–1.4% of GDP |
| Starting treasury | 3% of GDP | 5% of GDP |
| Treasury empty | week 47–87 (Egypt week 17) | not within two years for 11 of 12 test countries |
| Spending figure at the start | $0 (so advisers reported revenue as a surplus) | equals the Economy tab |

Egypt is the exception. Its interest bill is about 9% of GDP, so it starts with an 8% deficit and its treasury runs dry in about 33 weeks. That is a deliberately hard start, and the game now announces it ("The treasury is empty ...") instead of borrowing silently.

The AI still targets deficits of up to 3% of GDP when its debt is low. Over a decade, AI countries therefore run modest deficits.

### Decisions: repetition

Six 10-year sandbox games (Germany, Poland, Brazil, India, Nigeria, Japan). The bot answers every decision with its first allowed option.

| | Before | After |
| --- | --- | --- |
| Faction demands | 109 (35–40% of all decisions; each one reset the clock for every other story) | 45 |
| Distinct decisions per game | 19–25 | 25–31 |
| Median gap before the same decision returns | 29 weeks | 159 weeks |
| Decisions per year | 4.3–5.8 | 4.0–5.4 |

Root cause: faction demands were queued every 16–30 weeks. Each one also reset the timer that lets the main event pool fire, so the 75+ ordinary events were crowded out.

What changed:

- Demands now come every 32–54 weeks, from each faction at most once a year.
- Demands no longer hold back other events.
- Each faction remembers your last answer to it.
- Minister scandals are limited to one every 40 weeks, and the same minister can revolt at most once a year.
- A crisis arc cannot repeat for five years, and only once all fresh arcs are used up.

### Negotiation calibration

Germany at the start, trade unless noted:

- **France** (friend, already allied): military cooperation about 97%.
- **Brazil** (neutral): trade 88%, cooperation 52%, alliance 11%. Its paranoid/dove leader likes NAPs and dislikes alliances.
- **India** (neutral, hawkish leader): trade 94%, NAP 64%.
- **China** (−30): trade 46%, NAP 12%.
- **Russia** (−41): trade 31%. Cooperation and alliance are blocked by a red line while Germany is allied with Russia's rival.
- **Iran** (−40, ideologue): trade 19%, rising to 30% with a 0.3% investment package. An alliance is a red line.

Each sweetener's value depends on what the other side wants and is capped, so money alone cannot buy a hostile government. Money is worth more to poor or indebted countries, and less to governments that distrust you.

### Elections after this round

Twelve matched 8-year Legacy games use the "politician" bot, with the same seeds on the previous and the current version.

| | Before | After |
| --- | --- | --- |
| Elections won / lost | 6 / 10 | 5 / 11 |
| Average approval | 56.6% | 55.3% |
| Average growth | 3.9% | 3.7% |
| Debt after 8 years | 91% of GDP | 75% of GDP |

The difference in elections is within noise; the clear change is lower debt. Under both versions the bot wins only about a third of its elections in this time frame. This round did not cause that, but it is the next balance question for human playtesting.

### Still open

- Treasury balance is now gentle by default; "hard" difficulty only trims revenue by 5%. A harder fiscal mode may be worth adding.
- The negotiation odds are tuned on starting relations; real players may find combinations (tech + guarantee) that make alliances too cheap. Watch for it.

## Round 16: alignment, organisations and regimes

The 2024 blocs are now starting state, not constants. At the start, relations are identical to the previous version except between BRICS members (+6, they now share an organisation).

Twenty-year AI-only runs (the player is Uruguay):

- **Camps hold without a push.** Western-leaning countries go from 49 to 47–50, Eastern-leaning from 18 to 15–18. Earlier tuning let the West snowball to 104; bandwagoning now applies only when a camp is below 40% or above 80% of world power, and non-aligned countries hedge.
- **Plausible membership changes.** Ukraine joins NATO and the EU (not while at war), Balkan states join the EU, the UK sometimes rejoins the EU, and India sometimes leaves BRICS. Traditionally neutral states (Austria, Ireland, Switzerland, Malta ...) stay out of defence pacts unless attacked. Countries join a defence pact only when a dangerous, hostile neighbour gives them a reason.
- **New organisations.** Asian democracies found a Seoul Pact, and some regional economic forums appear. Clubs stop absorbing members who already share a closer union with most of them.
- **Regime changes: about 8–10 in 20 years,** almost all in fragile states (coups, revolutions, emergency rule).
- **Lasting US collapse** (forced every year): the West's share of power falls to about 50%. NATO's credibility drops, Japan, South Korea and Taiwan found their own pact, and Turkey cools. Europe does not flip East, because its friendships and institutions hold.
- **Russia played as a reformer** (Thaw, Open for Business, Free Elections, European Partnership, turning West once a year): it moves from −1 to about +0.67 over 12 years. Relations with Germany go from −41 to about +55, with France about +50, and with China fall to −66. NATO and the EU still reject Russia after 10 years: Poland, Finland, the Baltic states and the US vote no.

**Performance:** about 15% more simulation time per week.

## Round 17: courses and evolving alliances

Twenty-year AI runs, three seeds:

- **AI course changes are rare and motivated.** There are about 10–15 per 20 years worldwide, and at most four run at once. Typical stories:
  - Pakistan turns toward Washington, then a decade later back to China.
  - India pursues the Quad and joins a Western economic grouping.
  - Nigeria and Algeria join BRICS.
  - Vietnam, Argentina, Spain and Thailand found regional unions.
  - Iran attempts a Grand Bargain and is turned down.
- **No snowball.** Western-leaning countries end at 49–51 (49 at the start); Eastern-leaning countries end at 16–19.
- **Alliances evolve.** Clubs add defence clauses when threatened (a Kyiv-founded forum became the Kharkiv Pact after a threat), small blocs are absorbed, and NATO and the EU keep their names. Schisms are rare: they need a big bloc whose members have fallen out.
- **Player courses:** a completed West course moves Kazakhstan about +0.3 on the East–West scale (drift back toward old friends offsets part of it), lifts relations with the US by more than 10, and takes it out of the CSTO.

## Round 18: national storylines

- **Coverage.** 199 storyline seeds, one per country (tested). Every act event resolves for every combination of problem, road and economy.
- **Pacing.** Chapter I opens 4–14 months in. Its acts come 9–16 months apart and finish after about four years. The next chapter opens 4–5½ years later. After 14 years almost every country is in chapter II.
- **Chapter II problems** come from the state of the world. In one 14-year run they were corruption 52, exodus 39, crime 25, energy 20, climate 20, polarisation 20, restless generals 10, debt 7, succession 2 and sanctions 1. This makes the later chapters differ from the 2024 problems.
- **Headlines.** AI chapter endings go into the news feed as plain lines, and only the big powers' turns are reported. The player's own endings and new chapters are the only storyline headlines.
- **AI choices follow character.** Democracies take the reformer's road; juntas, communist states and hawks take the iron hand; the rest are pragmatists. Act IV never changes an AI country's camp: AI course changes keep their own rules from round 17.

## Round 19: a world of minds

AI-only worlds, 20 years each. The baseline is 16 worlds before this round; "now" is 50 worlds on the final code. The player is Uruguay and does nothing.

| | before | now |
|---|---|---|
| Western-leaning countries at the end | 48–52 | 48–56 |
| India's orientation at the end | 0.0–0.8 | −0.1 to 0.8 |
| Brazil's orientation at the end | always 0.0–0.1 | −0.4 to +0.2 |
| Saudi Arabia's orientation at the end | always 0.0 | −0.5 to +0.3 |
| US leaves NATO | never | 8 of 50 worlds (after 36 threats) |
| New nuclear states | 2–5 per world, picked at random (Canada, Cuba, Argentina ...) | none in 50 worlds; the bomb now takes a reason |
| Wars per 20 years | 31–50 | 15–39 |
| Leaders' names and traits | identical in every world (seeded by the date) | different in every world |

**What changed and why**
- **Every game is its own world.** New games used a fixed seed, so the same choices gave the same world. Leaders were also drawn from the calendar, not the seed: the same president took office in 2035 in four different worlds. Each new game now gets a fresh seed, and leaders, AI national paths, storyline timing and bloc names are drawn from it.
- **Leaders come from the mood.** Successors are weighted by the public mood (war weariness, the burden of allies, economic pain, fear, humiliation), and each leader states the mandate they won on. The leaders of 2024 are never "Country First", because that mood has not happened yet.
- **Swing states swing.** A leader's camp preference is centred on where the country stands, with no built-in tilt. An early version pulled democracies West and dictatorships East a second time, on top of the existing system pull, and the West grew to 61 in every world. Another bug centred the opening leaders on "neutral".
- **The membership sum.** Burden only counts when the allies are rich enough to pay for themselves. Otherwise Russia "paid more than its partners" in the CSTO and quit it in 2024 in most worlds. Leading a bloc is worth a sphere of influence, except to a "country first" leader.
- **NATO and the US.** A "country first" president facing rich allies makes the demand, and the partners who value the alliance raise their spending. At the deadline the president judges what was delivered. If it is under 0.25% of GDP, the US walks. Of the 8 exits, 4 came after the partners raised spending by only 0–0.2% of GDP. In the other 4 the alliance's sum had turned clearly negative for that president.
- **The bomb is a decision.** AI countries no longer pick the nuclear project, or a nuclear node on a national path, at random. Before this, South Korea went nuclear in 28 of 50 worlds. Now a country needs a plan to build the bomb: a top-35 economy, technology of 40 or more, a real threat and no nuclear ally. A programme is found out at 30% and draws sanctions, alarm next door and possibly sabotage.
- **Applications.** A country applies to join a bloc only when at least half the members would vote yes, and goes public only at 75%. This stopped Caribbean microstates being turned down by the same South American union over and over.
- **Historic organisations.** NATO, the EU and the other founding bodies absorb merging blocs and keep their names. In one world the EU had become the "Kyiv Union".

**Plans across 50 worlds**
- Long-term aims adopted: security 10k, joining a bloc 4.2k, containing a troublemaker 1.4k, revenge 600, building a bloc 258, regional dominance 269, the bomb 56, leaving a bloc 32.
- Revenge plans are given up about one time in four.
- Bids to join a bloc succeed three times in four, because governments wait until they have support.

**Still open**
- The US remains the top economy in 47 of 50 worlds; the economic model drives that, not the minds.
- Russia, China and Iran never change camp without the player.
