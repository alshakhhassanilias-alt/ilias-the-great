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
