/* Lessons that teach each grammar station step by step, plus extra practice sentences.
   Lesson markup: cards split by "---". "## " heading, "| a | b |" table row, "> German = English" example,
   "? Sentence with {right/wrong/wrong} = English" check question, "! " tip, other lines are paragraphs. *x* highlights. */
window.WW_PLUS = {
s01: { lesson: `## Two verbs you need in every sentence
*sein* (to be) and *haben* (to have) are irregular. You will use them thousands of times, so learn them as a chant.
| ich bin | ich habe |
| du bist | du hast |
| er / sie / es ist | er / sie / es hat |
| wir sind | wir haben |
| ihr seid | ihr habt |
| sie / Sie sind | sie / Sie haben |
> Ich bin müde. = I am tired.
> Wir haben Hunger. = We are hungry. (literally: we have hunger)
! German uses *haben* for hunger, thirst and fear: Hunger haben, Durst haben, Angst haben.
? Du {bist/bin/ist} sehr nett. = You are very nice.
? Er {hat/habt/hast} ein Auto. = He has a car.
---
## Regular verbs: stem + ending
Take the infinitive (*wohnen*), remove *-en* to get the stem (*wohn-*), then add the ending for the person.
| ich wohn*e* | wir wohn*en* |
| du wohn*st* | ihr wohn*t* |
| er wohn*t* | sie / Sie wohn*en* |
> Ich wohne in Köln. = I live in Cologne.
> Wo wohnst du? = Where do you live?
! *wir*, *sie* (they) and *Sie* (formal you) always look like the infinitive.
? Wir {spielen/spielt/spielst} Fußball. = We play football.
? Du {lernst/lernt/lernen} Deutsch. = You are learning German.
---
## Small spelling rules
Stems ending in *-t* or *-d* add an *e* so you can pronounce it: du arbeit*e*st, er find*e*t.
Some strong verbs change their vowel for *du* and *er/sie/es*: fahren → du f*ä*hrst, sprechen → er spr*i*cht, lesen → sie l*ie*st.
> Er arbeitet viel. = He works a lot.
> Sie spricht drei Sprachen. = She speaks three languages.
? Sie {arbeitet/arbeitt/arbeiten} in Berlin. = She works in Berlin.
? Er {fährt/fahrt/fahren} nach Hause. = He's driving home.`,
items: [
'Ich {habe/bin/hat} heute keine Lust.|I don\'t feel like it today.',
'Das Wetter {ist/hat/sind} heute schön.|The weather is nice today.',
'Er {spricht/sprecht/sprichst} sehr gut Deutsch.|He speaks German very well.',
'Wir {haben/sind/hat} Hunger.|We\'re hungry.',
'{Bist/Hast/Ist} du verheiratet?|Are you married?',
'Sie {liest/lest/lesst} jeden Abend ein Buch.|She reads a book every evening.',
'Du {arbeitest/arbeitst/arbeiten} zu viel.|You work too much.',
'Meine Eltern {sind/seid/ist} in Urlaub.|My parents are on holiday.',
'{Habt/Seid/Hat} ihr Kinder?|Do you (all) have children?',
'Er {fährt/fahrt/fahrst} jeden Tag mit dem Bus.|He takes the bus every day.' ]},

s02: { lesson: `## Every noun has a gender
German nouns are masculine (*der*), feminine (*die*) or neuter (*das*). The gender is often not logical: *das Mädchen* (the girl) is neuter. So you learn every noun together with its article, never alone.
| der Tisch (m) | die Lampe (f) | das Buch (n) |
| ein Tisch | eine Lampe | ein Buch |
! In this app, nouns are coloured: *blue = der*, *red = die*, *green = das*. Your memory will start to link colour and word.
? {Die/Der/Das} Lampe ist neu. = The lamp is new.
---
## Patterns that help
Some endings tell you the gender almost always:
| die: -ung, -heit, -keit, -schaft, -ion, -tät | die Zeitung, die Freiheit, die Information |
| das: -chen, -lein, -ment, -um | das Mädchen, das Dokument, das Zentrum |
| der: days, months, seasons, -er for people | der Montag, der Mai, der Lehrer |
? {Die/Der/Das} Wohnung ist groß. = The flat is big.
---
## The accusative: the thing you have, need or see
When a noun is the *direct object* (what you have, need, buy, see), it is in the accusative. Good news: only *masculine* changes.
| der → *den* | ein → *einen* | kein → *keinen* |
| die, das, plural stay the same | | |
> Ich brauche einen Stift. = I need a pen. (der Stift)
> Ich sehe die Frau. = I see the woman.
? Ich habe {einen/ein/eine} Bruder. = I have a brother.
? Wir kaufen {den/der/dem} Tisch. = We're buying the table.`,
items: [
'Ich habe {einen/ein/eine} Termin um zehn.|I have an appointment at ten.',
'Wir brauchen {eine/einen/ein} neue Waschmaschine.|We need a new washing machine.',
'{Das/Der/Die} Mädchen spielt im Garten.|The girl is playing in the garden.',
'Er liest {die/der/den} Zeitung.|He\'s reading the newspaper.',
'Siehst du {den/der/das} Bus dort?|Do you see the bus there?',
'Ich nehme {den/der/die} Fisch, bitte.|I\'ll have the fish, please.',
'{Die/Der/Das} Information ist falsch.|The information is wrong.',
'Sie hat {einen/ein/eine} Hund und eine Katze.|She has a dog and a cat.',
'Wir besuchen {den/der/dem} Markt am Samstag.|We visit the market on Saturday.',
'Kennst du {das/den/der} Restaurant am Bahnhof?|Do you know the restaurant at the station?' ]},

s03: { lesson: `## The verb is always number two
In a German statement the conjugated verb sits in *position 2*. Position 1 can be the subject, but also a time, a place or an object.
| Ich | *gehe* | heute ins Kino. |
| Heute | *gehe* | ich ins Kino. |
| Ins Kino | *gehe* | ich heute. |
! When something else takes position 1, the subject jumps behind the verb. This is the single most important rule of German word order.
? Morgen {fahre/fahren/fährt} ich nach Hamburg. = Tomorrow I'm going to Hamburg.
---
## W-questions
Question word in position 1, verb in position 2.
| wer = who | was = what | wo = where |
| wohin = where to | woher = where from | wann = when |
| warum = why | wie = how | wie viel = how much |
> Wo wohnst du? = Where do you live?
> Wann beginnt der Kurs? = When does the course start?
? {Woher/Wohin/Wo} kommst du? = Where are you from?
---
## Yes/no questions
Put the verb first.
> Kommst du mit? = Are you coming along?
> Hast du Zeit? = Do you have time?
! Answer a negative question with *doch* when you mean "yes": Kommst du nicht? *Doch!* (Yes, I am!)
? {Sprichst/Sprecht/Du sprichst} du Englisch? = Do you speak English?`,
items: [
'Im Sommer {fahren/fahrt/fährt} wir ans Meer.|In summer we go to the seaside.',
'{Wer/Wo/Was} ist das?|Who is that?',
'{Was/Wer/Wie} machst du am Wochenende?|What are you doing at the weekend?',
'Um acht Uhr {beginnt/beginnen/begin} der Unterricht.|Class starts at eight.',
'{Wohin/Woher/Wo} fährst du im Urlaub?|Where are you going on holiday?',
'{Wie viel/Wie/Wann} kostet das?|How much does that cost?',
'Leider {kann/kannst/können} ich nicht kommen.|Unfortunately I can\'t come.',
'{Hast/Habt/Hat} du einen Moment Zeit?|Do you have a moment?',
'Am Abend {koche/kocht/kochen} ich meistens selbst.|In the evening I usually cook myself.',
'{Warum/Wann/Wer} bist du so müde?|Why are you so tired?' ]},

s04: { lesson: `## A modal verb + an infinitive at the end
Modal verbs change the meaning of another verb. The modal goes in position 2, the main verb goes to the *very end* in the infinitive.
> Ich *kann* gut *schwimmen*. = I can swim well.
> Wir *müssen* jetzt *gehen*. = We have to go now.
? Ich muss heute {arbeiten/arbeite/arbeitet}. = I have to work today.
---
## The six modals
| können = can | müssen = must, have to |
| wollen = want | dürfen = may, be allowed |
| sollen = should, be supposed to | mögen / möchte = like / would like |
Their *ich* and *er* forms are identical and have no ending, and most change their vowel in the singular:
| ich kann, du kannst, er kann | ich muss, du musst, er muss |
| ich will, du willst, er will | ich darf, du darfst, er darf |
? Er {kann/kannt/könnt} nicht schwimmen. = He can't swim.
? Du {darfst/darf/dürfst} hier parken. = You're allowed to park here.
---
## Polite and careful
*möchte* is the polite "would like". Use it in shops and restaurants.
> Ich möchte einen Kaffee. = I'd like a coffee.
! *muss nicht* means "don't have to", not "must not". "Must not" is *darf nicht*.
? Du {musst/darfst/willst} nicht kommen, wenn du keine Zeit hast. = You don't have to come if you have no time.`,
items: [
'Ich {kann/kann ich/könne} leider nicht tanzen.|Unfortunately I can\'t dance.',
'Wir {müssen/muss/müsst} noch einkaufen.|We still have to go shopping.',
'Was {möchtest/möchte/möchtet} du trinken?|What would you like to drink?',
'Kinder {dürfen/darf/dürft} hier nicht spielen.|Children aren\'t allowed to play here.',
'Ich will heute nur {schlafen/schlafe/geschlafen}.|Today I just want to sleep.',
'Er {muss/musst/müssen} jeden Tag früh aufstehen.|He has to get up early every day.',
'{Soll/Sollst/Sollen} ich das Fenster aufmachen?|Shall I open the window?',
'Ihr {könnt/kann/könnet} gern bei uns übernachten.|You (all) are welcome to stay the night with us.',
'Du musst morgen nicht {kommen/kommst/gekommen}, es ist ein Feiertag.|You don\'t have to come tomorrow, it\'s a holiday.',
'Ich {mag/möge/magst} keinen Fisch.|I don\'t like fish.' ]},

s05: { lesson: `## Verbs that split in two
Many verbs have a small prefix: *an*rufen, *auf*stehen, *ein*kaufen, *mit*kommen, *fern*sehen. In a normal sentence the prefix breaks off and goes to the *end*.
> Ich *rufe* dich morgen *an*. = I'll call you tomorrow.
> Wann *stehst* du *auf*? = When do you get up?
? Ich kaufe heute {ein/an/auf}. = I'm going shopping today.
---
## Which prefixes split?
| split (stressed) | an, auf, aus, ein, mit, vor, zu, zurück, fern, los, weg |
| never split | be-, ver-, er-, ent-, ge-, zer-, emp-, miss- |
> Ich verstehe das. = I understand that. (ver- never splits)
> Ich stehe um sechs auf. = I get up at six.
? Ich {verstehe/stehe ver/verstehe ver} dich nicht. = I don't understand you.
---
## Together again
With a modal verb, or after *dass/weil*, the verb sits at the end and stays in one piece.
> Ich muss früh *aufstehen*. = I have to get up early.
> …, weil ich früh *aufstehe*. = …because I get up early.
? Kannst du mich morgen {anrufen/rufen an/anrufst}? = Can you call me tomorrow?`,
items: [
'Wir fahren morgen früh {los/an/auf}.|We\'re setting off early tomorrow morning.',
'Sie räumt jeden Samstag ihr Zimmer {auf/an/ein}.|She tidies her room every Saturday.',
'Ich lade dich zum Essen {ein/an/aus}.|I\'m inviting you for a meal.',
'Wann kommst du {zurück/an/ein}?|When are you coming back?',
'Mach bitte das Licht {aus/auf/an}, wenn du gehst.|Please turn off the light when you leave.',
'Der Unterricht hört um zwölf {auf/an/aus}.|Class ends at twelve.',
'Ich muss heute noch {einkaufen/kaufe ein/kaufen ein}.|I still have to go shopping today.',
'Er sieht heute sehr müde {aus/an/auf}.|He looks very tired today.',
'Ich {bekomme/komme be/bekomm} viele E-Mails.|I get a lot of emails.',
'Probier die Jacke doch mal {an/auf/aus}!|Why not try the jacket on!' ]},

s06: { lesson: `## My, your, his, her
Possessives take the same endings as *ein*.
| ich → mein | wir → unser |
| du → dein | ihr → euer |
| er/es → sein | sie (they) → ihr |
| sie (she) → ihr | Sie (formal) → Ihr |
> Das ist mein Bruder und meine Schwester. = That's my brother and my sister.
? Wie alt ist {deine/dein/deinen} Tochter? = How old is your daughter?
---
## kein: "no / not a"
Use *kein* to negate a noun that would have *ein* or no article.
> Ich habe ein Auto. → Ich habe *kein* Auto.
> Ich habe Zeit. → Ich habe *keine* Zeit.
Masculine accusative again takes *-en*: Ich habe *keinen* Hunger.
? Wir haben {keine/kein/nicht} Kinder. = We don't have children.
---
## nicht: everything else
*nicht* negates verbs, adjectives, names, and nouns with *der/die/das* or a possessive.
> Ich komme *nicht*. = I'm not coming.
> Das ist *nicht* mein Handy. = That's not my phone.
! Rough rule: *nicht* goes at the end, but before adjectives, places and the second verb part: Ich gehe heute *nicht* ins Kino.
? Das Essen ist {nicht/kein/keine} gut. = The food isn't good.`,
items: [
'Ist das {dein/deine/deinen} Rucksack?|Is that your backpack?',
'Er hat {keinen/kein/keine} Führerschein.|He doesn\'t have a driving licence.',
'Unsere Kinder gehen {nicht/kein/keine} gern zur Schule.|Our kids don\'t like going to school.',
'Habt ihr {euer/eure/euren} Ticket dabei?|Do you (all) have your ticket with you?',
'Sie besucht {ihre/ihr/ihren} Großmutter.|She\'s visiting her grandmother.',
'Ich habe heute {keine/kein/nicht} Zeit.|I have no time today.',
'Wo ist {Ihr/Ihre/Ihren} Pass, bitte?|Where is your passport, please? (formal)',
'Das ist {nicht/kein/keine} meine Tasche.|That\'s not my bag.',
'Er findet {seinen/sein/seine} Schlüssel nicht.|He can\'t find his key.',
'Wir haben {kein/keine/keinen} Problem damit.|We have no problem with that.' ]},

s07: { lesson: `## How Germans talk about the past
In speech Germans mostly use the *Perfekt*: a helper verb (*haben* or *sein*) in position 2, and the *past participle* at the end.
> Ich *habe* Pizza *gegessen*. = I ate pizza. / I have eaten pizza.
! Same structure as modal verbs: two parts, the second one at the end.
? Wir haben gestern Tennis {gespielt/spielen/gespielen}. = We played tennis yesterday.
---
## Regular participles: ge- … -t
| machen → *ge*mach*t* | kaufen → *ge*kauf*t* |
| arbeiten → *ge*arbeit*et* | spielen → *ge*spiel*t* |
? Was hast du {gekauft/gekaufen/kaufte}? = What did you buy?
---
## Strong participles: ge- … -en
Many common verbs end in *-en* and often change their vowel. Learn them with the verb.
| sehen → gesehen | essen → gegessen | trinken → getrunken |
| schreiben → geschrieben | nehmen → genommen | finden → gefunden |
! No *ge-* for verbs ending in *-ieren* (studiert, telefoniert) or starting with *be-, ver-, er-, ent-* (bezahlt, verstanden).
? Hast du den Brief {geschrieben/geschreibt/schreiben}? = Did you write the letter?
? Ich habe alles {verstanden/geverstanden/verstehen}. = I understood everything.`,
items: [
'Wir haben gestern lange {geschlafen/geschlaft/schlafen}.|We slept in yesterday.',
'Hast du den Schlüssel {gefunden/gefindet/finden}?|Did you find the key?',
'Ich habe ihn noch nie {getroffen/getreffen/treffen}.|I\'ve never met him.',
'Sie hat mir sehr {geholfen/gehelft/helfen}.|She helped me a lot.',
'Wir haben viel über Politik {diskutiert/gediskutiert/diskutieren}.|We discussed politics a lot.',
'Was hast du zum Geburtstag {bekommen/gebekommen/bekommt}?|What did you get for your birthday?',
'Er {hat/ist/habe} den ganzen Tag gearbeitet.|He worked all day.',
'Habt ihr schon {getrunken/getrinkt/trinken}?|Have you (all) had something to drink?',
'Ich habe dich gestern {angerufen/geanrufen/anrufen}.|I called you yesterday.',
'Sie hat das Buch in zwei Tagen {gelesen/geliesen/gelest}.|She read the book in two days.' ]},

s08: { lesson: `## When the helper is sein
A small group of verbs builds the Perfekt with *sein* instead of *haben*. They have one thing in common: no direct object, and they describe *movement from A to B* or a *change of state*.
| movement | gehen → ist gegangen, fahren → ist gefahren, fliegen → ist geflogen, kommen → ist gekommen |
| change | aufstehen → ist aufgestanden, einschlafen → ist eingeschlafen, werden → ist geworden, sterben → ist gestorben |
> Ich *bin* nach Berlin *gefahren*. = I went to Berlin.
? Wir {sind/haben/ist} nach Spanien geflogen. = We flew to Spain.
---
## Three to memorise
These use *sein* even though nothing moves: *sein* (ist gewesen), *bleiben* (ist geblieben), *passieren* (ist passiert).
> Ich *bin* zu Hause *geblieben*. = I stayed home.
> Was *ist passiert*? = What happened?
? Er {ist/hat/sind} krank gewesen. = He was ill.
---
## Separable verbs
*ge-* goes between prefix and verb: an*ge*kommen, auf*ge*standen, ein*ge*kauft, mit*ge*bracht.
? Der Zug ist schon {abgefahren/geabfahren/abfahren}. = The train has already left.`,
items: [
'Wir {sind/haben/seid} gestern ins Kino gegangen.|We went to the cinema yesterday.',
'Er ist mit dem Fahrrad zur Arbeit {gefahren/gefahrt/fahren}.|He rode his bike to work.',
'Wann {bist/hast/ist} du nach Hause gekommen?|When did you come home?',
'Meine Oma ist letztes Jahr {gestorben/gesterbt/sterben}.|My grandma died last year.',
'Ich {bin/habe/ist} noch nie in Japan gewesen.|I\'ve never been to Japan.',
'Wir sind sehr früh {aufgestanden/aufgesteht/aufstehen}.|We got up very early.',
'Sie ist in Hamburg {geblieben/gebleibt/bleiben}.|She stayed in Hamburg.',
'Er {hat/ist/sind} das Auto in die Garage gefahren.|He drove the car into the garage. (with an object: haben)',
'Wir sind durch den Park {gelaufen/gelauft/laufen}.|We walked through the park.',
'Das Kind ist sofort {eingeschlafen/eingeschlaft/geeinschlafen}.|The child fell asleep immediately.' ]},

s09: { lesson: `## The dative: the receiver
The dative is the "to whom / for whom" case. In *Ich gebe dem Mann das Buch*, the man receives (dative), the book is given (accusative).
| | m | f | n | plural |
| der-word | *dem* | *der* | *dem* | *den* + n |
| ein-word | *einem* | *einer* | *einem* | *keinen* + n |
> Ich gebe dem Kind einen Apfel. = I give the child an apple.
? Ich schenke {meiner/meine/meinem} Mutter Blumen. = I'm giving my mother flowers.
---
## Prepositions that always take the dative
A handy chant: *aus, bei, mit, nach, seit, von, zu*. Also *gegenüber*.
> mit dem Bus = by bus · bei der Arbeit = at work · nach dem Essen = after the meal
! Short forms: zu dem = *zum*, zu der = *zur*, bei dem = *beim*, von dem = *vom*.
? Ich fahre {zum/zur/zu} Bahnhof. = I'm driving to the station.
? Wir gehen {zur/zum/zu der} Schule. = We go to school.
---
## Dative pronouns and verbs
| ich → mir | wir → uns |
| du → dir | ihr → euch |
| er/es → ihm, sie → ihr | sie/Sie → ihnen/Ihnen |
Some verbs always take the dative: helfen, danken, gefallen, gehören, schmecken, passen, antworten.
> Das Kleid gefällt mir. = I like the dress. (it pleases me)
? Kannst du {mir/mich/ich} helfen? = Can you help me?`,
items: [
'Das Essen schmeckt {mir/mich/ich} sehr gut.|I really like the food.',
'Ich fahre mit {der/die/dem} U-Bahn.|I take the underground.',
'Wir gehen heute Abend {zum/zur/zu der} Konzert.|We\'re going to the concert tonight.',
'Seit {einem/einen/ein} Jahr lerne ich Deutsch.|I\'ve been learning German for a year.',
'Wem gehört die Tasche? Sie gehört {ihr/sie/ihre}.|Whose is the bag? It\'s hers.',
'Ich danke {Ihnen/Sie/Ihr} für Ihre Hilfe.|Thank you for your help. (formal)',
'Er wohnt bei {seiner/seine/seinen} Freundin.|He lives at his girlfriend\'s.',
'Kommst du {aus/von/bei} der Türkei?|Are you from Turkey?',
'Die Schuhe passen {mir/mich/mein} nicht.|The shoes don\'t fit me.',
'Ich gehe jetzt {zur/zum/zu} Arbeit.|I\'m going to work now.' ]},

s10: { lesson: `## One preposition, two cases
Nine prepositions can take either case: *in, an, auf, über, unter, vor, hinter, neben, zwischen*. The question decides.
| *Wo?* (where: position) | dative | Ich bin *in der* Küche. |
| *Wohin?* (where to: movement) | accusative | Ich gehe *in die* Küche. |
? Das Bild hängt an {der/die/den} Wand. = The picture hangs on the wall.
---
## The verb pairs
German has separate verbs for "being somewhere" and "putting something somewhere":
| position + dative | action + accusative |
| liegen (lie) | legen (lay down) |
| stehen (stand) | stellen (stand up, put upright) |
| sitzen (sit) | setzen (sit down, seat) |
| hängen (hang) | hängen (hang up) |
> Das Buch *liegt* auf *dem* Tisch. = The book is on the table.
> Ich *lege* das Buch auf *den* Tisch. = I put the book on the table.
? Ich stelle die Vase auf {den/dem/der} Tisch. = I put the vase on the table.
---
## Contractions
in dem = *im*, in das = *ins*, an dem = *am*, an das = *ans*
> Ich bin im Büro. = I'm in the office. · Ich gehe ins Büro. = I'm going to the office.
? Wir gehen heute {ins/im/in} Kino. = We're going to the cinema today.`,
items: [
'Ich sitze schon {im/ins/in} Zug.|I\'m already on the train.',
'Stell die Flaschen bitte {auf den/auf dem/auf der} Balkon.|Please put the bottles on the balcony.',
'Das Handy liegt {neben dem/neben den/neben das} Bett.|The phone is next to the bed.',
'Wir fahren am Wochenende {an die/an der/am} Ostsee.|We\'re going to the Baltic Sea at the weekend.',
'Die Kinder spielen {hinter dem/hinter das/hinter den} Haus.|The children are playing behind the house.',
'Häng deine Jacke {in den/im/in dem} Schrank.|Hang your jacket in the wardrobe.',
'Der Hund liegt {unter dem/unter den/unter das} Tisch.|The dog is lying under the table.',
'Ich setze mich {auf das/auf dem/auf den} Sofa.|I sit down on the sofa.',
'Zwischen {den/die/der} Häusern ist ein kleiner Park.|There is a small park between the houses.',
'Er geht {ins/im/in} Bett.|He\'s going to bed.' ]},

s11: { lesson: `## Joining sentences: verb to the end
Words like *weil* (because), *dass* (that) and *ob* (whether) start a *subordinate clause*. In that clause the conjugated verb moves to the very end.
> Ich lerne Deutsch. Ich *wohne* in Wien. → Ich lerne Deutsch, weil ich in Wien *wohne*.
! Always put a comma before *weil, dass, ob*.
? Ich bin froh, dass du da {bist/bist da/sein}. = I'm glad you're here.
---
## With two verbs
The conjugated verb goes last, after the infinitive or participle.
> …, weil ich morgen arbeiten *muss*. = …because I have to work tomorrow.
> …, dass er nicht gekommen *ist*. = …that he didn't come.
? Ich glaube, dass er das nicht gesagt {hat/ist/haben}. = I believe he didn't say that.
---
## weil vs denn
Both mean "because". *denn* keeps normal word order (verb in position 2).
> Ich bleibe zu Hause, *weil* ich krank *bin*.
> Ich bleibe zu Hause, *denn* ich *bin* krank.
*ob* = whether, for yes/no questions inside a sentence: Ich weiß nicht, *ob* er kommt.
? Er fragt, {ob/dass/weil} du Zeit hast. = He's asking whether you have time.`,
items: [
'Ich weiß, dass du recht {hast/hat/haben}.|I know you\'re right.',
'Er kommt nicht, weil er arbeiten {muss/müssen/musst}.|He isn\'t coming because he has to work.',
'Kannst du mir sagen, {ob/dass/weil} der Zug Verspätung hat?|Can you tell me whether the train is delayed?',
'Es ist wichtig, dass du pünktlich {bist/sein/ist}.|It\'s important that you\'re on time.',
'Sie ist glücklich, weil sie eine neue Stelle {gefunden hat/hat gefunden/findet hat}.|She\'s happy because she found a new job.',
'Ich frage mich, {ob/dass/wenn} das stimmt.|I wonder whether that\'s true.',
'Wir gehen früh schlafen, {denn/weil/dass} wir sind müde.|We\'re going to bed early because we\'re tired.',
'Ich finde, dass Berlin eine tolle Stadt {ist/sei/sind}.|I think Berlin is a great city.',
'Er sagt, dass er keine Zeit {hat/haben/hast}.|He says he has no time.',
'Ich lerne viel, weil ich die Prüfung bestehen {will/wollen/willst}.|I\'m studying a lot because I want to pass the exam.' ]},

s12: { lesson: `## wenn, als, wann: three words for "when"
| *wenn* | if; when in the present or future; whenever (repeated) |
| *als* | when: one single time or period in the past |
| *wann* | when: only in questions |
> Wenn ich Zeit habe, rufe ich dich an. = When I have time, I'll call you.
> Als ich klein war, wohnten wir in Bonn. = When I was little, we lived in Bonn.
> Wann kommst du? = When are you coming?
? {Als/Wenn/Wann} wir in Paris waren, hat es geregnet. = When we were in Paris, it rained.
---
## The clause can come first
A subordinate clause can take position 1. Then the main clause starts straight with its verb: *verb, verb* in the middle.
> Wenn es regnet, *bleibe* ich zu Hause.
? Wenn ich müde bin, {trinke/ich trinke/trinken} ich Kaffee. = When I'm tired, I drink coffee.
---
## Repeated past = wenn
For things that happened again and again in the past, use *(immer) wenn*.
> Immer wenn ich bei Oma war, hat sie Kuchen gebacken. = Whenever I was at Grandma's, she baked cake.
? Ich weiß nicht, {wann/wenn/als} er kommt. = I don't know when he's coming.`,
items: [
'{Wenn/Als/Wann} du Hilfe brauchst, sag Bescheid.|If you need help, let me know.',
'{Als/Wenn/Wann} ich 18 wurde, habe ich den Führerschein gemacht.|When I turned 18, I got my driving licence.',
'{Wann/Wenn/Als} beginnt das Konzert?|When does the concert start?',
'Wenn ich Geld hätte, {würde/werde/wurde} ich ein Haus kaufen.|If I had money, I\'d buy a house.',
'Als er nach Hause kam, {war/ist/wäre} niemand da.|When he came home, nobody was there.',
'Immer {wenn/als/wann} es schneit, freuen sich die Kinder.|Whenever it snows, the children are happy.',
'Sag mir bitte, {wann/wenn/als} du ankommst.|Please tell me when you arrive.',
'Wenn du willst, {können/kannst/könnt} wir zusammen kochen.|If you want, we can cook together.',
'{Als/Wenn/Wann} wir jung waren, hatten wir kein Handy.|When we were young, we didn\'t have mobile phones.',
'Wenn das Wetter gut ist, {gehen/geht/gehe} wir schwimmen.|If the weather is good, we\'ll go swimming.' ]},

s13: { lesson: `## Comparative: -er (als)
Add *-er* to the adjective. Use *als* for "than".
> schnell → schnell*er*: Das Auto ist schneller *als* das Fahrrad.
Many short adjectives also take an umlaut: alt → *ä*lter, jung → j*ü*nger, groß → gr*ö*ßer, warm → w*ä*rmer, kurz → k*ü*rzer.
? Mein Bruder ist {älter/alter/mehr alt} als ich. = My brother is older than me.
---
## Superlative: am …-sten
> schnell → *am* schnell*sten*: Der Zug fährt am schnellsten.
Before a noun: der/die/das …-ste: *der schnellste Zug*.
! After -d, -t, -s, -ß, -z add an *e*: am ält*e*sten, am kürz*e*sten.
? Im Juli ist es {am wärmsten/am wärmste/am warmsten}. = It's warmest in July.
---
## The irregular ones
| gut | besser | am besten |
| gern | lieber | am liebsten |
| viel | mehr | am meisten |
| hoch | höher | am höchsten |
| nah | näher | am nächsten |
Equal: *so … wie* / *genauso … wie*.
? Ich esse {lieber/gerner/mehr gern} Reis als Nudeln. = I prefer rice to pasta.
? Er ist so alt {wie/als/so} ich. = He's as old as me.`,
items: [
'Heute ist es {kälter/kalter/mehr kalt} als gestern.|Today it\'s colder than yesterday.',
'Das ist die {schönste/schönsten/schöner} Stadt, die ich kenne.|That\'s the most beautiful city I know.',
'Was machst du {am liebsten/am liebste/am gernsten}?|What do you like doing most?',
'Die Zugspitze ist der {höchste/hochste/höcheste} Berg Deutschlands.|The Zugspitze is Germany\'s highest mountain.',
'Ich verdiene {mehr/mehrer/viel} als letztes Jahr.|I earn more than last year.',
'Sie läuft schneller {als/wie/so} ihr Bruder.|She runs faster than her brother.',
'Das neue Handy ist nicht so gut {wie/als/wenn} das alte.|The new phone isn\'t as good as the old one.',
'Welcher Weg ist {kürzer/kurzer/kürzester}?|Which way is shorter?',
'Am {besten/gutesten/bessten} fragst du einen Kollegen.|It\'s best to ask a colleague.',
'Die {nächste/nahste/nächsten} Haltestelle ist am Markt.|The nearest stop is at the market.' ]},

s14: { lesson: `## Verbs that point back to the subject
Some verbs need a *reflexive pronoun*: the action points back to the person doing it.
| ich freue *mich* | wir freuen *uns* |
| du freust *dich* | ihr freut *euch* |
| er/sie freut *sich* | sie/Sie freuen *sich* |
> Ich wasche mich. = I wash (myself).
? Wir {treffen uns/treffen sich/treffen wir} um acht. = We're meeting at eight.
---
## Common reflexive verbs
Learn these as one unit, often with a preposition:
| sich freuen auf / über | look forward to / be happy about |
| sich interessieren für | be interested in |
| sich ärgern über | be annoyed about |
| sich erinnern an | remember |
| sich beeilen | hurry |
| sich entschuldigen | apologise |
? Ich interessiere {mich/mir/sich} für Kunst. = I'm interested in art.
---
## Dative when there is another object
If the sentence already has an accusative object, *mich/dich* become *mir/dir*.
> Ich wasche *mich*. → Ich wasche *mir* die Hände.
> Ich putze *mir* die Zähne. = I brush my teeth.
? Du musst {dir/dich/du} die Haare kämmen. = You need to comb your hair.`,
items: [
'Beeil {dich/dir/sich}, der Bus kommt!|Hurry up, the bus is coming!',
'Ich erinnere {mich/mir/ich} gut an meine Kindheit.|I remember my childhood well.',
'Er hat {sich/ihm/ihn} bei mir entschuldigt.|He apologised to me.',
'Wir haben {uns/sich/euch} in Berlin kennengelernt.|We met in Berlin.',
'Ich putze {mir/mich/meine} jeden Abend die Zähne.|I brush my teeth every evening.',
'Freust du {dich/dir/sich} auf den Urlaub?|Are you looking forward to the holiday?',
'Ihr müsst {euch/sich/uns} warm anziehen.|You (all) need to dress warmly.',
'Sie fühlt {sich/ihr/sie} heute nicht gut.|She doesn\'t feel well today.',
'Ich ziehe {mich/mir/sich} schnell um.|I\'ll quickly get changed.',
'Habt ihr {euch/sich/uns} schon an das Wetter gewöhnt?|Have you (all) got used to the weather yet?' ]},

s15: { lesson: `## The simple past of sein and haben
For *sein*, *haben* and the modal verbs, Germans use the *Präteritum* even in everyday speech. "Ich bin gewesen" sounds clumsy; say *ich war*.
| ich war | ich hatte |
| du warst | du hattest |
| er/sie war | er/sie hatte |
| wir waren | wir hatten |
| ihr wart | ihr hattet |
| sie/Sie waren | sie/Sie hatten |
? Wir {waren/war/wart} gestern im Theater. = We were at the theatre yesterday.
? Ich {hatte/hat/hattest} keine Zeit. = I had no time.
---
## Modal verbs in the past
Add *-te*, and drop the umlaut:
| können → konnte | müssen → musste |
| dürfen → durfte | wollen → wollte |
| sollen → sollte | mögen → mochte |
> Ich *konnte* nicht schlafen. = I couldn't sleep.
! Careful: *könnte* (with umlaut) means "could" in the sense of "would be able to". That's Konjunktiv II, a later station.
? Er {musste/müsste/muss} gestern lange warten. = He had to wait a long time yesterday.`,
items: [
'Wir {waren/wären/sind} letztes Jahr in Italien.|We were in Italy last year.',
'Sie {hatte/hätte/hat} gestern Geburtstag.|It was her birthday yesterday.',
'Ich {wollte/will/würde} dich gestern anrufen.|I wanted to call you yesterday.',
'Wie {war/wurde/wäre} dein Wochenende?|How was your weekend?',
'Als Kind {mochte/möchte/mag} ich keinen Spinat.|As a child I didn\'t like spinach.',
'{Hattest/Hattet/Hatte} du gestern Zeit?|Did you have time yesterday?',
'Er {sollte/soll/sollst} um acht da sein, aber er kam erst um neun.|He was supposed to be there at eight but only came at nine.',
'Wir {konnten/könnten/können} das Haus nicht finden.|We couldn\'t find the house.',
'Es {war/hatte/hat} sehr kalt im Januar.|It was very cold in January.',
'Ihr {hattet/hattest/hatten} Glück mit dem Wetter.|You (all) were lucky with the weather.' ]},

s16: { lesson: `## Why adjectives have endings
Before a noun, an adjective needs an ending. The ending shows gender and case when the article doesn't show it clearly.
> Der Wein ist *gut*. (no noun after it: no ending)
> ein gut*er* Wein (before the noun: ending)
? Das Auto ist {neu/neues/neue}. = The car is new.
---
## After der / die / das
In the nominative singular the ending is always *-e*. Everything else after der/die/das is *-en*.
| der alt*e* Mann | die alt*e* Frau | das alt*e* Haus | die alt*en* Leute |
| den alt*en* Mann (acc.) | mit der alt*en* Frau (dat.) | | |
? Der {neue/neuer/neuen} Kollege ist sehr nett. = The new colleague is very nice.
---
## After ein / kein / mein
Here the adjective must show the gender, because *ein* doesn't:
| ein gut*er* Wein (m) | eine gut*e* Idee (f) | ein gut*es* Buch (n) |
| einen gut*en* Wein (acc. m) | mit einem gut*en* Freund (dat.) | meine gut*en* Freunde (pl.) |
! Shortcut: in the dative and plural (after an article), it's almost always *-en*.
? Ich habe ein {neues/neuer/neue} Handy. = I have a new phone.
? Wir suchen einen {großen/große/großer} Tisch. = We're looking for a big table.`,
items: [
'Das ist eine {gute/guter/guten} Idee!|That\'s a good idea!',
'Ich trinke gern {kalten/kalte/kaltes} Kaffee.|I like drinking cold coffee.',
'Der {kleine/kleiner/kleinen} Junge weint.|The little boy is crying.',
'Sie wohnt in einer {schönen/schöne/schöner} Wohnung.|She lives in a nice flat.',
'Kennst du den {neuen/neue/neuer} Film?|Do you know the new film?',
'Wir haben ein {großes/großer/große} Problem.|We have a big problem.',
'Er hat {blaue/blauen/blauer} Augen.|He has blue eyes.',
'Mit meinem {alten/alte/altes} Auto fahre ich nicht mehr weit.|I don\'t drive far in my old car any more.',
'Das {deutsche/deutscher/deutschen} Brot ist sehr lecker.|German bread is very tasty.',
'Sie hat einen {interessanten/interessante/interessanter} Beruf.|She has an interesting job.' ]},

s17: { lesson: `## Relative clauses: giving extra information
A relative clause describes a noun: *the man who lives next door*. In German it starts with a *relative pronoun*, is set off by commas, and its verb goes to the end.
> Das ist der Mann, *der* nebenan *wohnt*. = That's the man who lives next door.
? Das ist die Frau, {die/der/das} hier arbeitet. = That's the woman who works here.
---
## Gender from the noun, case from the clause
The pronoun has the same *gender* as the noun it describes, but its *case* depends on its role inside the relative clause.
| nominative | der | die | das | die |
| accusative | den | die | das | die |
| dative | dem | der | dem | *denen* |
> Der Mann, *den* ich gestern gesehen habe… (I saw him: accusative)
> Der Mann, *dem* ich geholfen habe… (I helped him: dative)
? Der Kollege, {den/der/dem} ich angerufen habe, ist krank. = The colleague I called is ill.
---
## With prepositions and "was"
The preposition comes first: die Stadt, *in der* ich wohne.
After *alles, etwas, nichts, das Beste* use *was*: Alles, *was* du brauchst.
Whose: *dessen* (m/n), *deren* (f/pl).
? Das ist die Firma, für {die/der/das} ich arbeite. = That's the company I work for.`,
items: [
'Wie heißt der Film, {den/der/dem} du gestern gesehen hast?|What\'s the film you watched yesterday called?',
'Das ist das Kind, {dem/das/den} ich Nachhilfe gebe.|That\'s the child I tutor.',
'Ich suche eine Wohnung, {die/der/das} nicht so teuer ist.|I\'m looking for a flat that isn\'t so expensive.',
'Die Freunde, mit {denen/die/den} ich Urlaub mache, kommen aus Wien.|The friends I\'m going on holiday with are from Vienna.',
'Er hat etwas gesagt, {was/das/dass} ich nicht verstanden habe.|He said something I didn\'t understand.',
'Das ist der Kollege, {dessen/deren/dem} Frau Ärztin ist.|That\'s the colleague whose wife is a doctor.',
'Die Stadt, in {der/die/dem} ich geboren bin, ist sehr klein.|The town I was born in is very small.',
'Das Beste, {was/das/dass} du tun kannst, ist warten.|The best thing you can do is wait.',
'Der Bus, {der/den/dem} zum Flughafen fährt, kommt gleich.|The bus that goes to the airport is coming soon.',
'Die Leute, {die/denen/deren} hier wohnen, sind sehr freundlich.|The people who live here are very friendly.' ]},

s18: { lesson: `## werden: three jobs in one verb
| ich werde | wir werden |
| du wirst | ihr werdet |
| er/sie wird | sie/Sie werden |
1. On its own it means *become / get*: Es *wird* kalt. Er *wird* Arzt.
2. With an infinitive it makes the *future*: Ich *werde* kommen.
3. With a participle it makes the *passive* (next station).
? Es {wird/werdet/wirst} langsam hell. = It's slowly getting light.
---
## Future tense
*werden* in position 2, infinitive at the end.
> Ich *werde* dich *anrufen*. = I will call you.
! For plans, Germans usually use the present tense + a time word: *Morgen fahre ich nach Hamburg.* Use werden for promises, predictions and emphasis.
? Morgen {wird/werdet/werde} es regnen. = It'll rain tomorrow.
---
## Guessing about now
*werden + wohl* expresses an assumption: "probably".
> Er *wird wohl* noch schlafen. = He's probably still asleep.
? Sie wird wohl im Büro {sein/ist/gewesen}. = She'll probably be at the office.`,
items: [
'Was willst du später {werden/wirst/geworden}?|What do you want to be later?',
'Ich {werde/wird/werdet} es nie verstehen.|I\'ll never understand it.',
'Das Essen wird kalt, wenn du nicht {kommst/kommt/kommen}.|The food will get cold if you don\'t come.',
'Er ist im letzten Jahr sehr groß {geworden/worden/werden}.|He got very tall last year.',
'Wir werden morgen früh {losfahren/fahren los/losgefahren}.|We\'ll set off early tomorrow.',
'Du {wirst/wird/werdest} das schon schaffen!|You\'ll manage it!',
'Die Tage {werden/wird/werdet} wieder länger.|The days are getting longer again.',
'Das wird wohl die richtige Adresse {sein/ist/gewesen}.|That\'s probably the right address.',
'Mir {wird/werde/wirst} schlecht, wenn ich Bus fahre.|I get sick when I take the bus.',
'{Werdet/Wird/Werden} ihr zur Hochzeit kommen?|Will you (all) come to the wedding?' ]},

s19: { lesson: `## The "would" mood: Konjunktiv II
Konjunktiv II talks about things that are not real: wishes, dreams, polite requests and advice.
For most verbs: *würde* + infinitive at the end.
| ich würde | wir würden |
| du würdest | ihr würdet |
| er/sie würde | sie/Sie würden |
> Ich *würde* gern in Italien *leben*. = I would like to live in Italy.
? Ich {würde/wurde/werde} gern mehr reisen. = I'd like to travel more.
---
## Verbs with their own form
The most common verbs have their own Konjunktiv form. Use these instead of würde:
| sein → wäre | haben → hätte |
| können → könnte | müssen → müsste |
| dürfen → dürfte | sollen → sollte |
| wissen → wüsste | geben → es gäbe |
> Wenn ich Zeit *hätte*, *würde* ich mitkommen. = If I had time, I'd come along.
? Wenn ich du {wäre/war/würde}, würde ich das Angebot annehmen. = If I were you, I'd accept the offer.
---
## Polite requests and advice
> *Könnten* Sie mir helfen? = Could you help me?
> *Hätten* Sie einen Moment Zeit? = Would you have a moment?
> Du *solltest* weniger arbeiten. = You should work less.
? {Würden/Wurden/Werden} Sie bitte die Tür schließen? = Would you close the door please?`,
items: [
'Ich {wüsste/wusste/weiß} gern, wie das funktioniert.|I\'d like to know how that works.',
'Wenn ich Zeit hätte, {würde/werde/wurde} ich dich besuchen.|If I had time, I\'d visit you.',
'Das {wäre/war/würde} super!|That would be great!',
'{Hätten/Hatten/Haben} Sie noch ein Zimmer frei?|Would you have a room available?',
'Wir {sollten/sollst/solltet} langsam gehen.|We should get going.',
'Es {wäre/war/ist} besser, wenn du früher kommst.|It would be better if you came earlier.',
'An deiner Stelle {würde/wurde/werde} ich mehr schlafen.|In your place I\'d sleep more.',
'{Könntest/Konntest/Kannst} du mir kurz helfen?|Could you help me for a second?',
'Wenn es nicht so teuer {wäre/war/ist}, würde ich es kaufen.|If it weren\'t so expensive, I\'d buy it.',
'Ich {hätte/hatte/hättest} gern die Rechnung, bitte.|I\'d like the bill, please.' ]},

s20: { lesson: `## Active vs passive
In an active sentence the doer is the subject. In the passive, the *thing that happens* takes centre stage and the doer often disappears.
> Active: Der Mechaniker *repariert* das Auto.
> Passive: Das Auto *wird repariert*. = The car is being repaired.
Form: *werden* (conjugated) + *past participle* at the end.
? Die Briefe {werden/wird/sind} morgen geschickt. = The letters will be sent tomorrow.
---
## Past and Perfekt passive
| present | Das Haus *wird* gebaut. |
| Präteritum | Das Haus *wurde* gebaut. |
| Perfekt | Das Haus *ist* gebaut *worden*. |
! In the passive Perfekt it's *worden*, never *geworden*.
? Das Fahrrad {wurde/wird/war} gestern gestohlen. = The bike was stolen yesterday.
---
## Naming the doer
If you mention who did it, use *von* + dative.
> Das Bild wurde *von* Picasso gemalt. = The picture was painted by Picasso.
Very common in signs and rules: *Hier wird nicht geraucht.* (No smoking here.)
? Das Buch wurde {von/durch/bei} einer jungen Autorin geschrieben. = The book was written by a young author.`,
items: [
'Das Museum {wird/werden/wurden} um zehn geöffnet.|The museum is opened at ten.',
'Die Kinder werden um drei {abgeholt/abholen/geabholt}.|The children are picked up at three.',
'Der Brief ist noch nicht {beantwortet/geantwortet/beantworten} worden.|The letter hasn\'t been answered yet.',
'Hier wird nicht {geraucht/rauchen/raucht}.|There\'s no smoking here.',
'Das Konzert {wurde/wird/würde} wegen Regen abgesagt.|The concert was cancelled because of rain.',
'Die Straße wird gerade {gebaut/bauen/gebaut worden}.|The road is being built right now.',
'Ich {wurde/werde/würde} gestern zum Essen eingeladen.|I was invited to dinner yesterday.',
'Das Auto ist schon repariert {worden/geworden/wurde}.|The car has already been repaired.',
'Die Wohnung wurde {von/vom/durch} einem Makler vermietet.|The flat was rented out by an agent.',
'In der Schweiz werden vier Sprachen {gesprochen/sprechen/gesprecht}.|Four languages are spoken in Switzerland.' ]},

s21: { lesson: `## zu + infinitive
After many verbs and expressions, a second verb comes with *zu* at the end of its clause.
> Ich habe keine Lust, heute *zu kochen*. = I don't feel like cooking today.
> Es ist schwer, Deutsch *zu lernen*. = It's hard to learn German.
Typical triggers: Lust haben, Zeit haben, versuchen, vergessen, anfangen, aufhören, hoffen, vorhaben, es ist + adjective.
! Modal verbs never take zu: Ich *muss* arbeiten (not "zu arbeiten").
? Ich versuche, mehr Sport {zu machen/machen/zu mache}. = I'm trying to do more sport.
---
## Separable verbs
*zu* goes between prefix and verb: an*zu*rufen, auf*zu*stehen, ein*zu*kaufen.
? Vergiss nicht, Milch {einzukaufen/zu einkaufen/einkaufen}! = Don't forget to buy milk!
---
## um … zu, ohne … zu, statt … zu
| *um … zu* | in order to | Ich spare, *um* ein Auto *zu kaufen*. |
| *ohne … zu* | without doing | Er ging, *ohne* etwas *zu sagen*. |
| *statt … zu* | instead of doing | *Statt zu lernen*, spielt er. |
*damit* also means "so that", but is used when the subject changes: Ich spare, *damit* meine Kinder studieren können.
? Er arbeitet nachts, {um/damit/ohne} mehr Geld zu verdienen. = He works nights to earn more money.`,
items: [
'Ich habe vor, nächstes Jahr nach Kanada {zu reisen/reisen/zu reise}.|I plan to travel to Canada next year.',
'Es macht Spaß, mit dir {zu reden/reden/zu redet}.|It\'s fun talking to you.',
'Hör endlich auf {zu rauchen/rauchen/zu raucht}!|Stop smoking at last!',
'Sie fährt nach Berlin, {um/damit/statt} ihre Freunde zu besuchen.|She\'s going to Berlin to visit her friends.',
'Er ist gefahren, {ohne/um/statt} zu tanken.|He drove off without filling up.',
'Ich hoffe, dich bald {wiederzusehen/zu wiedersehen/wiedersehen}.|I hope to see you again soon.',
'Ich gebe dir das Geld, {damit/um/ohne} du ein Ticket kaufen kannst.|I\'ll give you the money so you can buy a ticket.',
'Wir haben angefangen, Spanisch {zu lernen/lernen/gelernt}.|We\'ve started learning Spanish.',
'Hast du Zeit, mir kurz {zu helfen/helfen/zu hilfst}?|Do you have time to help me for a moment?',
'{Statt/Ohne/Um} zu arbeiten, surft er im Internet.|Instead of working, he\'s surfing the internet.' ]},

s22: { lesson: `## The genitive: of / 's
The genitive shows belonging, like English *'s* or *of*.
| | m | f | n | plural |
| der-word | *des* …-(e)s | *der* | *des* …-(e)s | *der* |
| ein-word | *eines* …-(e)s | *einer* | *eines* …-(e)s | – |
> das Auto *des Mannes* = the man's car
> die Farbe *der Tür* = the colour of the door
! Masculine and neuter nouns add *-s* or *-es*: des Vater*s*, des Kind*es*.
? Das ist das Haus {meines/meinem/meiner} Bruders. = That's my brother's house.
---
## Names
With names you just add *-s*, with no apostrophe: *Annas* Fahrrad, *Peters* Mutter.
In speech, many people use *von* + dative instead: das Auto *von meinem Vater*.
? {Marias/Maria/Mariases} Freund heißt Tom. = Maria's boyfriend is called Tom.
---
## Genitive prepositions
*wegen* (because of), *trotz* (despite), *während* (during), *statt* (instead of), *innerhalb* (within), *außerhalb* (outside).
> *Wegen des* Regens bleiben wir drinnen. = Because of the rain we're staying inside.
? {Während/Wegen/Trotz} des Films hat er geschlafen. = He slept during the film.`,
items: [
'Der Name {des/dem/der} Hotels ist mir entfallen.|I\'ve forgotten the name of the hotel.',
'{Wegen/Trotz/Während} der Hitze bleiben wir zu Hause.|Because of the heat we\'re staying home.',
'Das ist die Tochter {unserer/unsere/unserem} Nachbarin.|That\'s our neighbour\'s daughter.',
'{Trotz/Wegen/Statt} der Kälte gehen wir joggen.|Despite the cold we\'re going jogging.',
'Während {des/dem/der} Urlaubs habe ich viel gelesen.|During the holiday I read a lot.',
'{Peters/Peter/Peterses} Wohnung liegt im Zentrum.|Peter\'s flat is in the centre.',
'Die Preise {der/den/des} Wohnungen steigen immer weiter.|The prices of flats keep rising.',
'Das Ende {des/dem/der} Films war sehr traurig.|The end of the film was very sad.',
'{Statt/Trotz/Wegen} eines Autos hat er sich ein E-Bike gekauft.|Instead of a car he bought an e-bike.',
'Außerhalb {der/die/den} Stadt ist es viel ruhiger.|Outside the city it\'s much quieter.' ]},

s23: { lesson: `## Connector words that don't move the verb
*und, aber, oder, denn, sondern* simply join two main clauses. Word order doesn't change.
> Ich bin müde, *aber* ich *gehe* noch aus.
*sondern* = "but rather", only after a negation: Nicht heute, *sondern* morgen.
? Er trinkt keinen Kaffee, {sondern/aber/oder} Tee. = He doesn't drink coffee, but tea.
---
## Adverbs in position 1
*deshalb* (therefore), *trotzdem* (anyway), *dann* (then), *außerdem* (besides) are adverbs. They take position 1, so the verb follows straight after.
> Es regnet. *Deshalb nehme* ich den Bus. = It's raining, so I'm taking the bus.
> Es regnet. *Trotzdem gehe* ich zu Fuß. = It's raining. I'm walking anyway.
? Ich hatte Hunger, {deshalb/obwohl/weil} habe ich gekocht. = I was hungry, so I cooked.
---
## Subordinating: verb to the end
| obwohl | although | falls | in case |
| indem | by (doing) | seit / seitdem | since |
| sodass | so that (result) | bevor / nachdem | before / after |
> *Obwohl* es regnet, *gehe* ich spazieren. = Although it's raining, I'm going for a walk.
? {Obwohl/Trotzdem/Deshalb} er krank ist, geht er zur Arbeit. = Although he's ill, he goes to work.`,
items: [
'Ich habe wenig geschlafen. {Trotzdem/Obwohl/Weil} bin ich fit.|I slept little. I\'m fit anyway.',
'{Obwohl/Trotzdem/Deshalb} sie viel verdient, hat sie nie Geld.|Although she earns a lot, she never has money.',
'Der Zug hatte Verspätung, {deshalb/obwohl/weil} kam ich zu spät.|The train was late, so I arrived late.',
'Er lernt Vokabeln, {indem/damit/obwohl} er Karteikarten schreibt.|He learns vocabulary by writing flashcards.',
'Nimm einen Schirm mit, {falls/obwohl/sondern} es regnet.|Take an umbrella in case it rains.',
'Ich möchte nicht Tee, {sondern/aber/oder} Kaffee.|I don\'t want tea, but coffee.',
'Es war sehr laut, {sodass/obwohl/indem} ich nicht schlafen konnte.|It was so loud that I couldn\'t sleep.',
'Er ist nett, {aber/sondern/denn} etwas chaotisch.|He\'s nice but a bit chaotic.',
'{Außerdem/Obwohl/Falls} ist die Wohnung zu teuer.|Besides, the flat is too expensive.',
'{Seitdem/Seither/Trotzdem} er in München wohnt, fährt er Ski.|Since he\'s been living in Munich, he goes skiing.' ]},

s24: { lesson: `## The past tense of stories
Books, news and fairy tales use the *Präteritum*. You need to recognise it well, and use it in writing.
Regular verbs: stem + *-te* + ending.
| ich sag*te* | wir sag*ten* |
| du sag*test* | ihr sag*tet* |
| er/sie sag*te* | sie sag*ten* |
! *ich* and *er/sie* forms are identical: ich wohnte, er wohnte.
? Früher {wohnte/wohnt/gewohnt} er in Dresden. = He used to live in Dresden.
---
## Strong verbs: new vowel, no -te
| gehen → ging | kommen → kam | sehen → sah |
| geben → gab | nehmen → nahm | finden → fand |
| schreiben → schrieb | bleiben → blieb | laufen → lief |
The *ich/er* forms have no ending: er ging, ich kam.
? Er {nahm/nehmte/nimmt} den letzten Zug. = He took the last train.
---
## Mixed verbs
A few verbs change the vowel *and* add -te:
| denken → dachte | bringen → brachte | wissen → wusste |
| kennen → kannte | rennen → rannte | nennen → nannte |
? Ich {dachte/denkte/dacht}, du kommst nicht. = I thought you weren't coming.`,
items: [
'Er {öffnete/öffnet/geöffnet} langsam die Tür.|He slowly opened the door.',
'Wir {fanden/findeten/fandten} das Restaurant sofort.|We found the restaurant straight away.',
'Sie {schrieb/schreibte/schrieben} jeden Tag in ihr Tagebuch.|She wrote in her diary every day.',
'Niemand {wusste/wisste/weißte}, wo er war.|Nobody knew where he was.',
'Der Hund {lief/laufte/lauf} über die Straße.|The dog ran across the street.',
'Er {brachte/bringte/brang} ihr jeden Tag Blumen.|He brought her flowers every day.',
'Die Prinzessin {sah/sehte/sieh} aus dem Fenster.|The princess looked out of the window.',
'Wir {kannten/kennten/konnten} uns schon aus der Schule.|We already knew each other from school.',
'Plötzlich {hörte/hört/hörtete} sie ein Geräusch.|Suddenly she heard a noise.',
'Dann {stieg/steigte/stiegte} er ins Auto und fuhr weg.|Then he got into the car and drove away.' ]},

s25: { lesson: `## Verbs with a fixed preposition
Many German verbs come with a fixed preposition, and it is often a different one than in English. Learn verb + preposition + case as one chunk.
| warten *auf* + acc. | wait for |
| denken *an* + acc. | think of |
| sich freuen *auf* + acc. | look forward to |
| sich freuen *über* + acc. | be happy about |
| sprechen *mit* + dat. / *über* + acc. | talk to / about |
| Angst haben *vor* + dat. | be afraid of |
| sich kümmern *um* + acc. | take care of |
| teilnehmen *an* + dat. | take part in |
? Ich warte {auf/für/an} dich. = I'm waiting for you.
---
## Asking and referring: wo- and da-
For *things*, combine the preposition with *wo(r)-* for questions and *da(r)-* for "it/that". Add *r* before a vowel.
> *Worauf* wartest du? – Ich warte *darauf*. = What are you waiting for? – I'm waiting for it.
> *Woran* denkst du? – *Daran*. = What are you thinking about? – About that.
? {Worüber/Wofür/Woran} sprecht ihr? = What are you talking about?
---
## People are different
For *people*, keep preposition + pronoun:
> Ich denke an *dich*. (not "daran")
> Auf *wen* wartest du? = Who are you waiting for?
? Ich habe lange mit {ihm/damit/es} gesprochen. = I talked to him for a long time.`,
items: [
'Hast du Angst {vor/von/über} Hunden?|Are you afraid of dogs?',
'Ich nehme an dem Kurs {teil/an/mit}.|I\'m taking part in the course.',
'Wir müssen {darüber/davon/darum} sprechen.|We need to talk about it.',
'{Woran/Worauf/Worüber} denkst du gerade?|What are you thinking about right now?',
'Er kümmert sich {um/für/an} seine kranke Mutter.|He takes care of his sick mother.',
'Ich freue mich schon {auf/über/für} die Ferien.|I\'m already looking forward to the holidays.',
'Bist du {damit/dafür/davon} einverstanden?|Do you agree with it?',
'Sie hat sich {über/auf/an} den Lärm beschwert.|She complained about the noise.',
'Ich bitte dich {um/für/auf} einen Gefallen.|I\'m asking you for a favour.',
'Ich habe mich {für/um/an} die Stelle beworben.|I\'ve applied for the job.' ]},

s26: { lesson: `## Plusquamperfekt: the past before the past
When you tell a story in the past and want to mention something that happened even *earlier*, use the Plusquamperfekt: *hatte / war* + participle.
> Als ich ankam, *hatte* der Film schon *angefangen*. = When I arrived, the film had already started.
> Ich *hatte* schon *gegessen*, als er anrief. = I had already eaten when he called.
! Same choice of haben/sein as in the Perfekt, just in the past: hatte gemacht, war gegangen.
? Er war müde, weil er schlecht {geschlafen hatte/geschlafen war/schlief hatte}. = He was tired because he had slept badly.
---
## nachdem, bevor, sobald, bis, während
| *nachdem* | after (usually + Plusquamperfekt) |
| *bevor* | before |
| *sobald* | as soon as |
| *bis* | until |
| *während* | while |
All of them send the verb to the end.
> *Nachdem* er gegessen *hatte*, ging er spazieren.
? {Bevor/Nachdem/Sobald} du schlafen gehst, mach das Fenster zu. = Before you go to sleep, close the window.
---
## Tense pairing with nachdem
| nachdem + Plusquamperfekt | main clause in Präteritum/Perfekt |
| nachdem + Perfekt | main clause in present |
> Nachdem ich gefrühstückt habe, gehe ich zur Arbeit. (routine)
? Nachdem sie die Prüfung bestanden {hatte/hat/war}, feierte sie. = After she had passed the exam, she celebrated.`,
items: [
'Ich {hatte/war/habe} den Film schon gesehen.|I had already seen the film.',
'Als die Polizei kam, {war/hatte/ist} der Dieb schon geflohen.|When the police arrived, the thief had already fled.',
'{Bevor/Nachdem/Bis} wir essen, waschen wir uns die Hände.|Before we eat, we wash our hands.',
'Ruf mich an, {sobald/bevor/nachdem} du Neuigkeiten hast.|Call me as soon as you have news.',
'{Während/Bevor/Sobald} ich koche, höre ich Musik.|While I cook, I listen to music.',
'Nachdem er sein Studium beendet {hatte/war/hat}, reiste er ein Jahr.|After he had finished his studies, he travelled for a year.',
'Wir warten, {bis/bevor/seit} der Regen aufhört.|We\'re waiting until the rain stops.',
'Sie {waren/hatten/sind} schon nach Hause gegangen.|They had already gone home.',
'Ich konnte nicht schlafen, weil ich zu viel Kaffee getrunken {hatte/war/habe}.|I couldn\'t sleep because I had drunk too much coffee.',
'{Nachdem/Bevor/Bis} der Arzt ihn untersucht hatte, durfte er gehen.|After the doctor had examined him, he was allowed to go.' ]},

s27: { lesson: `## Talking about what didn't happen
To talk about an unreal past ("if I had known…"), use *hätte* or *wäre* + past participle.
> Wenn ich das *gewusst hätte*, *wäre* ich *gekommen*. = If I had known that, I would have come.
! Same haben/sein choice as in the Perfekt: gemacht → hätte gemacht, gegangen → wäre gegangen.
? Ich {hätte/wäre/würde} dir geholfen. = I would have helped you.
? Wir {wären/hätten/würden} früher gekommen. = We would have come earlier.
---
## With modal verbs
Use *hätte* + infinitive + modal infinitive. Two infinitives at the end, the modal last.
> Du *hättest* mich *anrufen sollen*. = You should have called me.
> Wir *hätten* das *machen können*. = We could have done that.
? Ich hätte früher {aufstehen sollen/aufgestanden sollen/sollen aufstehen}. = I should have got up earlier.
---
## Regrets and "as if"
> *Hätte* ich doch nur mehr gelernt! = If only I had studied more!
> *Wäre* ich bloß zu Hause geblieben! = If only I'd stayed home!
*als ob* + Konjunktiv II: Er tut so, *als ob* er nichts *wüsste*. = He acts as if he knew nothing.
? Sie sieht aus, als ob sie nicht geschlafen {hätte/hat/wäre}. = She looks as if she hadn't slept.`,
items: [
'Wenn du früher gefragt {hättest/hast/wärst}, hätte ich ja gesagt.|If you\'d asked earlier, I would have said yes.',
'Ich wäre gern mitgekommen, aber ich {hatte/hätte/habt} keine Zeit.|I would have liked to come, but I didn\'t have time.',
'Das {hätte/wäre/würde} ich nie gedacht.|I would never have thought that.',
'Er {wäre/hätte/würde} fast vom Fahrrad gefallen.|He nearly fell off his bike.',
'Wir hätten das Problem früher {erkennen müssen/erkannt müssen/müssen erkennen}.|We should have recognised the problem earlier.',
'Wäre ich bloß nicht so spät {losgefahren/losfahren/losgefahren wäre}!|If only I hadn\'t left so late!',
'Er redet, als ob er der Chef {wäre/ist/war}.|He talks as if he were the boss.',
'Ohne Navi hätten wir den Weg nie {gefunden/finden/fanden}.|Without satnav we\'d never have found the way.',
'Wenn es nicht geregnet {hätte/wäre/hat}, wären wir gewandert.|If it hadn\'t rained, we would have gone hiking.',
'Du {hättest/hattest/hast} mir die Wahrheit sagen müssen.|You should have told me the truth.' ]},

s28: { lesson: `## Passive with a modal verb
Modal verb in position 2, then *participle + werden* at the end.
> Das Formular *muss* bis Freitag *abgegeben werden*. = The form must be handed in by Friday.
> Das *kann* nicht *repariert werden*. = That can't be repaired.
? Die Rechnung muss sofort bezahlt {werden/sein/worden}. = The bill must be paid immediately.
---
## State passive: sein + participle
The *werden* passive describes a process; *sein* + participle describes the *result*.
> Die Tür *wird* geschlossen. = The door is being closed. (process)
> Die Tür *ist* geschlossen. = The door is closed. (state)
? Das Geschäft {ist/hat/sind} heute geschlossen. = The shop is closed today.
---
## Alternatives to the passive
| *sich lassen* + infinitive | can be done | Das lässt sich ändern. |
| *sein + zu* + infinitive | must / can be done | Die Miete ist bis zum 3. zu zahlen. |
| *-bar* adjective | -able | machbar, lösbar, essbar |
| *man* | one / people | Man spricht hier Deutsch. |
? Das Problem {lässt/ist/wird} sich leicht lösen. = The problem can be solved easily.`,
items: [
'Der Antrag kann online gestellt {werden/sein/worden}.|The application can be submitted online.',
'Die Tickets sind an der Kasse {abzuholen/abholen/abgeholt}.|The tickets are to be collected at the box office.',
'Das Fenster {ist/wird/hat} schon seit Stunden offen.|The window has been open for hours.',
'Dieser Fehler {lässt/ist/wird} sich leicht vermeiden.|This mistake can easily be avoided.',
'Die Kosten sollen gesenkt {werden/worden/sein}.|The costs are supposed to be reduced.',
'Das Wasser ist hier nicht {trinkbar/getrunken/trinkend}.|The water here isn\'t drinkable.',
'In diesem Raum {darf/muss/kann} nicht telefoniert werden.|No phone calls may be made in this room.',
'Die Arbeit {ist/hat/sind} endlich erledigt.|The work is finally done.',
'{Man/Es/Wer} sagt, dass er sehr reich ist.|People say he\'s very rich.',
'Dieser Plan ist leider nicht {umsetzbar/umgesetzt/umsetzen}.|This plan unfortunately isn\'t feasible.' ]},

s29: { lesson: `## Reported speech: Konjunktiv I
News, reports and formal writing use *Konjunktiv I* to pass on what someone said without claiming it's true.
Form: infinitive stem + *-e* endings. The *er/sie* form is the one you'll see most.
| haben → er habe | können → er könne |
| werden → er werde | wissen → er wisse |
| kommen → er komme | müssen → er müsse |
> Der Minister sagte, er *habe* nichts gewusst. = The minister said he had known nothing.
? Sie sagt, sie {komme/kommen/kommst} morgen. = She says she's coming tomorrow.
---
## sein is special
| ich sei | wir seien |
| du seist | ihr seiet |
| er/sie sei | sie seien |
> Er behauptet, er *sei* krank. = He claims he is ill.
? Die Zeitung berichtet, die Lage {sei/seien/seid} ernst. = The paper reports the situation is serious.
---
## When Konjunktiv I looks like the present, use II
For *ich, wir, sie (plural)*, Konjunktiv I often looks exactly like the normal present (wir haben = wir haben). Then switch to Konjunktiv II: wir *hätten*, sie *könnten*.
! In everyday conversation people mostly say: Er sagt, dass er krank *ist*. That's fine. Recognise Konjunktiv I in the news; use it in formal writing.
? Sie sagten, sie {hätten/habe/hättest} keine Zeit. = They said they had no time.`,
items: [
'Der Sprecher erklärte, das Problem {sei/ist/seien} gelöst.|The spokesperson declared the problem was solved.',
'Er meinte, er {habe/haben/habt} den Brief nie bekommen.|He said he had never received the letter.',
'Sie behauptet, sie {wisse/wissen/wisst} von nichts.|She claims she knows nothing about it.',
'Die Firma teilte mit, sie {werde/werden/wirst} 200 Stellen streichen.|The company announced it would cut 200 jobs.',
'Laut Polizei {sei/seien/seist} der Täter noch flüchtig.|According to the police, the perpetrator is still at large.',
'Der Arzt sagte, ich {müsse/müssen/musst} mich ausruhen.|The doctor said I needed to rest.',
'Die Experten meinen, die Preise {würden/werde/wurdet} weiter steigen.|Experts think prices will keep rising.',
'Er fragte, ob ich morgen Zeit {hätte/hättet/hätten}.|He asked whether I had time tomorrow.',
'Die Regierung betonte, man {könne/können/könnt} das nicht akzeptieren.|The government stressed that this could not be accepted.',
'Die Zeugin gab an, sie {habe/haben/habt} nichts gesehen.|The witness stated she had seen nothing.' ]},

s30: { lesson: `## Noun-verb pairs
Formal German often expresses an action as *noun + a fixed verb*. The verb carries little meaning; the noun carries the content. You cannot swap the verb: it's *eine Entscheidung treffen*, never "machen".
| eine Entscheidung treffen | make a decision |
| eine Frage stellen | ask a question |
| einen Antrag stellen | submit an application |
| Kritik üben | criticise |
| Abschied nehmen | say goodbye |
| in Anspruch nehmen | make use of, take up |
? Darf ich eine Frage {stellen/machen/fragen}? = May I ask a question?
---
## More you'll hear at work
| zur Verfügung stehen | be available |
| in Frage kommen | be an option |
| Bescheid geben / sagen | let someone know |
| zur Sprache bringen | raise (a topic) |
| Rücksicht nehmen auf | be considerate of |
| in Kraft treten | come into force |
> Ich stehe Ihnen jederzeit zur Verfügung. = I'm available to you at any time.
? Bitte geben Sie mir bis Freitag {Bescheid/Antwort/Wissen}. = Please let me know by Friday.
---
## Why it matters
These phrases are everywhere in emails, letters, news and exams at B1/B2. Using them makes you sound educated and natural.
? Wir müssen auf die Nachbarn Rücksicht {nehmen/machen/geben}. = We have to be considerate of the neighbours.`,
items: [
'Ich möchte einen Antrag auf Elterngeld {stellen/machen/geben}.|I\'d like to apply for parental allowance.',
'Der Raum steht Ihnen ab Montag zur {Verfügung/Benutzung/Hilfe}.|The room is available to you from Monday.',
'Er hat das Problem in der Sitzung zur {Sprache/Rede/Frage} gebracht.|He raised the problem in the meeting.',
'Wir mussten von unserem Hund Abschied {nehmen/machen/geben}.|We had to say goodbye to our dog.',
'Dieser Kandidat kommt für die Stelle nicht in {Frage/Antwort/Sicht}.|This candidate isn\'t an option for the job.',
'Die Opposition {übte/machte/gab} scharfe Kritik an der Regierung.|The opposition sharply criticised the government.',
'Sie hat die Hilfe ihrer Familie in {Anspruch/Gebrauch/Hand} genommen.|She made use of her family\'s help.',
'Wir müssen bis morgen eine Lösung {finden/treffen/stellen}.|We have to find a solution by tomorrow.',
'Er hat mir ein gutes Angebot {gemacht/gestellt/getroffen}.|He made me a good offer.',
'Das Projekt wurde zum Abschluss {gebracht/genommen/gestellt}.|The project was brought to completion.' ]},

s31: { lesson: `## Two-part connectors
These come in pairs and connect two parallel ideas.
| sowohl … als auch | both … and |
| weder … noch | neither … nor |
| entweder … oder | either … or |
| nicht nur … sondern auch | not only … but also |
| zwar … aber | admittedly … but |
| einerseits … andererseits | on the one hand … on the other |
> Ich spreche *sowohl* Englisch *als auch* Deutsch.
> Er hat *weder* Zeit *noch* Geld.
? Wir fahren {entweder/weder/sowohl} heute oder morgen. = We'll go either today or tomorrow.
---
## je … desto: the more, the more
*je* + comparative starts a subordinate clause (verb at the end). *desto* + comparative is followed by the verb.
> *Je* mehr ich übe, *desto* besser *werde* ich. = The more I practise, the better I get.
? Je früher wir losfahren, {desto/als/so} weniger Stau gibt es. = The earlier we leave, the less traffic there is.
---
## Sound like a B2 speaker
These connectors are exactly what examiners look for in B2 essays and discussions. Use *einerseits … andererseits* to weigh arguments and *zwar … aber* to concede a point.
> *Zwar* ist die Wohnung klein, *aber* sie ist sehr günstig.
? Das Auto ist {zwar/sowohl/weder} alt, aber es fährt noch gut. = The car is old, admittedly, but it still runs well.`,
items: [
'Ich mag {sowohl/weder/entweder} Hunde als auch Katzen.|I like both dogs and cats.',
'Er kann {weder/sowohl/entweder} kochen noch backen.|He can neither cook nor bake.',
'Sie ist nicht nur Ärztin, {sondern/aber/als} auch Musikerin.|She\'s not only a doctor but also a musician.',
'Je älter er wird, {desto/als/je} ruhiger wird er.|The older he gets, the calmer he becomes.',
'{Einerseits/Entweder/Zwar} verdient man gut, andererseits hat man wenig Freizeit.|On the one hand you earn well, on the other you have little free time.',
'Du kannst {entweder/weder/sowohl} mit dem Bus oder mit der Bahn fahren.|You can go either by bus or by train.',
'Das Hotel war {zwar/weder/sowohl} teuer, aber sehr schön.|The hotel was expensive, admittedly, but very nice.',
'Je mehr du liest, {desto/umso mehr/je} größer wird dein Wortschatz.|The more you read, the bigger your vocabulary gets.',
'Weder ich {noch/oder/nicht} mein Mann haben davon gewusst.|Neither I nor my husband knew about it.',
'Er spricht sowohl Arabisch {als auch/als/und auch} Französisch.|He speaks both Arabic and French.' ]},

s32: { lesson: `## Participles as adjectives
A verb can describe a noun, like English *the barking dog* or *the stolen bike*.
| Partizip I | infinitive + *d* | active, happening now | der bell*end*e Hund |
| Partizip II | normal participle | finished or passive | das gestohlen*e* Fahrrad |
Both take normal adjective endings.
? Die {wartenden/gewarteten/warten} Kunden sind ungeduldig. = The waiting customers are impatient.
---
## Packed information
Formal German packs whole relative clauses in front of a noun:
> das Kind, das schläft → das *schlafende* Kind
> die Pizza, die bestellt wurde → die *bestellte* Pizza
> die im Jahr 2020 gegründete Firma = the company founded in 2020
? Das {gestohlene/stehlende/gestohlen} Auto wurde gefunden. = The stolen car was found.
---
## Participles as nouns and adverbs
They can become nouns: *der/die Reisende* (traveller), *die Angestellten* (employees), *der Verletzte* (the injured man).
Without an ending, Partizip I works as an adverb: Sie kam *lachend* herein. = She came in laughing.
? Alle {Anwesenden/Anwesend/Anwesende} haben zugestimmt. = Everyone present agreed.`,
items: [
'Er trinkt nur {kochendes/gekochtes/kochend} Wasser.|He only drinks boiling water.',
'Wir haben ein {renoviertes/renovierendes/renoviert} Haus gekauft.|We bought a renovated house.',
'Die {Angestellten/Angestellende/Anstellten} streiken seit Montag.|The employees have been on strike since Monday.',
'Das {weinende/geweinte/weinend} Kind sucht seine Mutter.|The crying child is looking for its mother.',
'Bitte schicken Sie das {ausgefüllte/ausfüllende/ausgefüllt} Formular zurück.|Please send back the completed form.',
'Die {Reisenden/Gereisten/Reisende} nach München steigen bitte um.|Passengers to Munich please change trains.',
'Sie ging {singend/gesungen/singende} durch die Straße.|She walked down the street singing.',
'Der {gestern/gestrige/gesterns} angekündigte Streik wurde abgesagt.|The strike announced yesterday was called off.',
'Die {steigende/gestiegene/steigend} Zahl der Touristen ist ein Problem.|The rising number of tourists is a problem.',
'Der {Verletzte/Verletzende/Verletzt} wurde sofort behandelt.|The injured man was treated immediately.' ]},

s33: { lesson: `## Nominal style
Spoken German uses verbs and clauses. Written, formal German turns them into *nouns*. Recognising this unlocks newspapers, letters and official texts.
> weil es stark regnete → *wegen des starken Regens*
> nachdem er die Schule abgeschlossen hatte → *nach dem Schulabschluss*
? {Wegen/Trotz/Nach} des Streiks fielen viele Züge aus. = Because of the strike many trains were cancelled.
---
## Building nouns from verbs
| -ung | entwickeln → die Entwicklung, verbessern → die Verbesserung |
| infinitive | das Lesen, das Autofahren |
| stem changes | abschließen → der Abschluss, beginnen → der Beginn, fliegen → der Flug |
! Nouns on *-ung* are always feminine.
? Die {Lösung/Lösen/Löse} des Problems dauert lange. = Solving the problem takes a long time.
---
## Formal prepositions (+ genitive)
| aufgrund | due to | infolge | as a result of |
| angesichts | in view of | mithilfe | with the help of |
| bezüglich | regarding | hinsichtlich | with regard to |
| laut (+ dat.) | according to | gemäß (+ dat.) | in accordance with |
? {Bezüglich/Angesichts/Mithilfe} Ihrer Anfrage melden wir uns morgen. = Regarding your enquiry, we'll get back to you tomorrow.`,
items: [
'{Infolge/Bezüglich/Mithilfe} des Unfalls war die Autobahn gesperrt.|As a result of the accident the motorway was closed.',
'Die {Bearbeitung/Bearbeiten/Bearbeitet} Ihres Antrags dauert zwei Wochen.|Processing your application takes two weeks.',
'{Hinsichtlich/Infolge/Trotz} der Kosten gibt es noch Fragen.|There are still questions regarding the costs.',
'Nach {Ankunft/Ankommen/Ankunfts} des Zuges bitte aussteigen.|Please get off after the train arrives.',
'{Gemäß/Infolge/Aufgrund} dem Vertrag muss die Miete im Voraus gezahlt werden.|In accordance with the contract, the rent must be paid in advance.',
'Die {Einführung/Einführen/Eingeführt} des Euro war 2002.|The euro was introduced in 2002.',
'{Aufgrund/Laut/Gemäß} der hohen Nachfrage ist das Produkt ausverkauft.|Due to high demand the product is sold out.',
'Vor {Beginn/Beginnen/Begann} der Veranstaltung gibt es einen Empfang.|There is a reception before the event begins.',
'Die {Verbesserung/Verbessern/Verbesserte} der Infrastruktur ist dringend nötig.|Improving the infrastructure is urgently needed.',
'{Angesichts/Bezüglich/Laut} der Lage hat die Regierung reagiert.|In view of the situation, the government has reacted.' ]},

s34: { lesson: `## Modal particles: the flavour of real German
Natives sprinkle small words like *doch, ja, mal, denn, halt, eben, wohl* into almost every sentence. They don't change the facts, but they change the *tone*. Without them your German sounds like a textbook.
| *mal* | softens a request | Kannst du *mal* kommen? |
| *doch* | encouraging, or "come on, you know" | Komm *doch* mit! |
| *ja* | surprise or "as we both know" | Das ist *ja* toll! |
| *denn* | makes questions sound interested | Was ist *denn* los? |
| *halt / eben* | "that's just how it is" | Das ist *halt* so. |
? Was machst du {denn/halt/mal} hier? = So what are you doing here?
---
## Giving your opinion
| Meiner Meinung nach … | In my opinion … (verb next!) |
| Ich bin der Meinung, dass … | I'm of the opinion that … |
| Ich bin davon überzeugt, dass … | I'm convinced that … |
| Da stimme ich dir zu. | I agree with you there. |
| Da bin ich anderer Meinung. | I see it differently. |
| Das sehe ich genauso. | I see it the same way. |
? Meiner Meinung nach {ist/ist es/es ist} das zu teuer. = In my opinion that's too expensive.
---
## Keeping a conversation going
| Wie meinst du das? | What do you mean? |
| Das kommt darauf an. | It depends. |
| Na ja, … | Well, … |
| Ehrlich gesagt … | To be honest … |
| Stimmt! | True! |
? Ehrlich {gesagt/sagen/gesagen} habe ich keine Lust. = To be honest, I don't feel like it.`,
items: [
'Hör {mal/denn/ja}, ich muss dir was erzählen!|Listen, I have to tell you something!',
'Das hast du {ja/denn/halt} toll gemacht!|You did that really well!',
'Was ist {denn/doch/mal} passiert?|What happened, then?',
'Da kann man nichts machen, das ist {eben/denn/gar} so.|Nothing you can do, that\'s just the way it is.',
'Ich bin der Meinung, {dass/das/weil} wir mehr investieren sollten.|I\'m of the opinion that we should invest more.',
'Da stimme ich dir völlig {zu/an/bei}.|I completely agree with you there.',
'Das sehe ich {genauso/gleich so/so gleich}.|I see it exactly the same way.',
'Wie {meinst/sagst/denkst} du das?|What do you mean by that?',
'Na ja, das kommt {darauf/davon/dafür} an.|Well, that depends.',
'Setz dich {doch/denn/etwa}!|Do sit down!' ]}
};
