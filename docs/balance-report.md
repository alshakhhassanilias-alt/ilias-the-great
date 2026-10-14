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
