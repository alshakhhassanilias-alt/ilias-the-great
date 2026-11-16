/* Production drills, unlocked per grammar station.
   T = transformations: "station|sentence|task|answer||alternative answer"
   F = error spotting:  "station|wrong sentence|correct sentence|why"
   FAM = word families:  "root|member = meaning; member = meaning" */
window.WW_DRILL = {
T: `s01|Ich wohne in Köln.|Change the subject to "du".|Du wohnst in Köln.
s01|Er arbeitet sehr viel.|Change the subject to "wir".|Wir arbeiten sehr viel.
s02|Ich habe ein Auto.|Replace "ein Auto" with "der Hund" (one dog).|Ich habe einen Hund.
s02|Ich sehe die Frau.|Replace "die Frau" with "der Mann".|Ich sehe den Mann.
s03|Ich gehe heute ins Kino.|Start the sentence with "Heute".|Heute gehe ich ins Kino.
s03|Du kommst aus Spanien.|Make it a yes/no question.|Kommst du aus Spanien?
s04|Ich arbeite heute.|Add "müssen".|Ich muss heute arbeiten.
s04|Wir gehen ins Kino.|Add "wollen".|Wir wollen ins Kino gehen.
s05|Ich stehe um sieben auf.|Add "müssen".|Ich muss um sieben aufstehen.
s05|Er kauft im Supermarkt ein.|Add "wollen".|Er will im Supermarkt einkaufen.
s06|Ich habe ein Auto.|Negate it.|Ich habe kein Auto.
s06|Ich verstehe das.|Negate it.|Ich verstehe das nicht.
s07|Ich kaufe ein Buch.|Put it in the Perfekt.|Ich habe ein Buch gekauft.
s07|Er schreibt eine E-Mail.|Put it in the Perfekt.|Er hat eine E-Mail geschrieben.
s08|Wir fahren nach Berlin.|Put it in the Perfekt.|Wir sind nach Berlin gefahren.
s08|Sie steht früh auf.|Put it in the Perfekt.|Sie ist früh aufgestanden.
s09|Ich fahre mit (der Zug).|Put the bracket in the right case.|Ich fahre mit dem Zug.
s09|Ich gebe das Buch.|Add "mein Bruder" as the receiver.|Ich gebe meinem Bruder das Buch.||Ich gebe das Buch meinem Bruder.
s10|Das Buch liegt auf dem Tisch.|Rewrite with "Ich lege das Buch …".|Ich lege das Buch auf den Tisch.
s10|Ich bin in (das Büro).|Put the bracket in the right form.|Ich bin im Büro.||Ich bin in dem Büro.
s11|Ich bleibe zu Hause. Ich bin krank.|Join with "weil".|Ich bleibe zu Hause, weil ich krank bin.
s11|Er kommt morgen.|Start with "Ich glaube, dass".|Ich glaube, dass er morgen kommt.
s12|Ich habe Zeit. Ich koche.|Join, starting with "Wenn".|Wenn ich Zeit habe, koche ich.
s12|Ich war ein Kind. Ich hatte einen Hund.|Join, starting with "Als".|Als ich ein Kind war, hatte ich einen Hund.
s13|Mein Auto ist schnell. Dein Auto ist schneller.|Make one sentence starting "Dein Auto ist …".|Dein Auto ist schneller als mein Auto.||Dein Auto ist schneller als meins.||Dein Auto ist schneller als meines.
s13|Anna ist groß.|Use the superlative: "Anna ist am …".|Anna ist am größten.
s14|Ich freue mich.|Change the subject to "wir".|Wir freuen uns.
s14|Ich wasche mich.|Add "die Hände".|Ich wasche mir die Hände.
s15|Ich bin müde.|Put it in the Präteritum.|Ich war müde.
s15|Wir müssen warten.|Put it in the Präteritum.|Wir mussten warten.
s16|Das Auto ist neu.|Rewrite as "Das ist ein …".|Das ist ein neues Auto.
s16|Der Kaffee ist heiß.|Rewrite as "Ich trinke einen …".|Ich trinke einen heißen Kaffee.
s17|Das ist der Mann. Er wohnt nebenan.|Join with a relative clause.|Das ist der Mann, der nebenan wohnt.
s17|Das ist das Buch. Ich lese es.|Join with a relative clause.|Das ist das Buch, das ich lese.
s18|Ich rufe dich an.|Put it in the Futur I.|Ich werde dich anrufen.
s18|Morgen regnet es.|Put it in the Futur I.|Morgen wird es regnen.||Es wird morgen regnen.
s19|Ich habe kein Geld, also kaufe ich kein Auto.|Make it unreal: "Wenn ich Geld hätte, …".|Wenn ich Geld hätte, würde ich ein Auto kaufen.
s19|Können Sie mir helfen?|Make it more polite (Konjunktiv II).|Könnten Sie mir helfen?||Würden Sie mir helfen?
s20|Man repariert das Auto.|Make it passive.|Das Auto wird repariert.
s20|Man baute das Haus 1990.|Make it passive (Präteritum).|Das Haus wurde 1990 gebaut.
s21|Ich lerne Deutsch. Ich will in Berlin studieren.|Join with "um … zu".|Ich lerne Deutsch, um in Berlin zu studieren.
s21|Ich habe vergessen. Ich wollte dich anrufen.|Rewrite as "Ich habe vergessen, …".|Ich habe vergessen, dich anzurufen.
s22|das Auto von meinem Vater|Use the genitive.|das Auto meines Vaters
s22|Weil es regnet, bleiben wir zu Hause.|Start with "Wegen …".|Wegen des Regens bleiben wir zu Hause.
s23|Es regnet. Wir gehen spazieren.|Join, starting with "Obwohl".|Obwohl es regnet, gehen wir spazieren.
s23|Es regnet. Wir gehen spazieren.|Connect with "trotzdem".|Es regnet, trotzdem gehen wir spazieren.||Es regnet. Trotzdem gehen wir spazieren.
s24|Er geht nach Hause.|Put it in the Präteritum.|Er ging nach Hause.
s24|Sie kommt sehr spät.|Put it in the Präteritum.|Sie kam sehr spät.
s25|Ich denke an die Prüfung.|Replace "an die Prüfung" with a da-word.|Ich denke daran.
s25|Er interessiert sich für Fußball.|Ask what he is interested in.|Wofür interessiert er sich?
s26|Ich esse. Dann gehe ich spazieren.|Rewrite as "Nachdem ich …, ging ich spazieren."|Nachdem ich gegessen hatte, ging ich spazieren.
s26|Der Zug fährt ab.|Put it in the Plusquamperfekt.|Der Zug war abgefahren.
s27|Ich wusste es nicht, also bin ich nicht gekommen.|Rewrite as "Wenn ich es gewusst hätte, …".|Wenn ich es gewusst hätte, wäre ich gekommen.
s27|Du solltest mich anrufen.|Turn it into a past regret: "Du hättest …".|Du hättest mich anrufen sollen.
s28|Man muss das Problem lösen.|Make it passive with "muss".|Das Problem muss gelöst werden.
s28|Man kann das leicht erklären.|Use "sich lassen".|Das lässt sich leicht erklären.
s29|Er sagt: „Ich bin krank.“|Report it with Konjunktiv I.|Er sagt, er sei krank.
s29|Sie sagt: „Ich habe keine Zeit.“|Report it with Konjunktiv I.|Sie sagt, sie habe keine Zeit.
s30|Wir entscheiden morgen.|Use "eine Entscheidung treffen".|Wir treffen morgen eine Entscheidung.||Morgen treffen wir eine Entscheidung.
s30|Darf ich etwas fragen?|Use "eine Frage stellen".|Darf ich eine Frage stellen?
s31|Er hat keine Zeit. Er hat kein Geld.|Join with "weder … noch".|Er hat weder Zeit noch Geld.||Er hat weder Geld noch Zeit.
s31|Sie spricht Deutsch. Sie spricht Englisch.|Join with "sowohl … als auch".|Sie spricht sowohl Deutsch als auch Englisch.
s32|der Hund, der bellt|Use a participle.|der bellende Hund
s32|das Auto, das gestohlen wurde|Use a participle.|das gestohlene Auto
s33|Weil die Kosten hoch sind, stoppen wir das Projekt.|Start with "Wegen der hohen Kosten".|Wegen der hohen Kosten stoppen wir das Projekt.
s33|Nachdem sie das Studium abgeschlossen hatte, zog sie um.|Start with "Nach dem Abschluss".|Nach dem Abschluss des Studiums zog sie um.
s34|Ich finde das gut.|Start with "Meiner Meinung nach".|Meiner Meinung nach ist das gut.
s34|Komm vorbei!|Soften it with "doch mal".|Komm doch mal vorbei!`,

F: `s01|Er habt zwei Kinder.|Er hat zwei Kinder.|er/sie/es takes "hat".
s01|Wir ist in Berlin.|Wir sind in Berlin.|wir takes "sind".
s02|Ich habe ein Bruder.|Ich habe einen Bruder.|der Bruder is the object, so accusative: einen.
s02|Ich sehe der Hund.|Ich sehe den Hund.|Masculine object: der becomes den.
s03|Heute ich gehe ins Kino.|Heute gehe ich ins Kino.|The verb must be in position 2.
s03|Wo du wohnst?|Wo wohnst du?|In a W-question the verb comes right after the question word.
s04|Ich muss morgen arbeite.|Ich muss morgen arbeiten.|After a modal verb: infinitive at the end.
s04|Er kann gut schwimmt.|Er kann gut schwimmen.|After a modal verb: infinitive at the end.
s05|Ich rufe an dich morgen.|Ich rufe dich morgen an.|The separable prefix goes to the very end.
s05|Wir kaufen ein heute.|Wir kaufen heute ein.|The separable prefix goes to the very end.
s06|Ich habe nicht Zeit.|Ich habe keine Zeit.|Negate nouns without an article with kein.
s06|Das ist kein mein Problem.|Das ist nicht mein Problem.|With a possessive, negate with nicht.
s07|Ich habe Pizza gegesst.|Ich habe Pizza gegessen.|essen is strong: gegessen.
s07|Er hat die Prüfung gebestanden.|Er hat die Prüfung bestanden.|be- verbs take no ge-.
s08|Ich habe nach Hause gegangen.|Ich bin nach Hause gegangen.|Movement from A to B uses sein.
s08|Was hat passiert?|Was ist passiert?|passieren takes sein.
s09|Ich fahre mit der Bus.|Ich fahre mit dem Bus.|mit + dative: der Bus becomes dem Bus.
s09|Kannst du mich helfen?|Kannst du mir helfen?|helfen takes the dative: mir.
s10|Das Bild hängt an die Wand.|Das Bild hängt an der Wand.|Position (wo?) takes the dative.
s10|Ich lege das Buch auf dem Tisch.|Ich lege das Buch auf den Tisch.|Movement (wohin?) takes the accusative.
s11|Ich glaube, dass er hat recht.|Ich glaube, dass er recht hat.|After dass the verb goes to the end.
s11|Ich komme nicht, weil ich bin krank.|Ich komme nicht, weil ich krank bin.|After weil the verb goes to the end.
s12|Wenn ich ein Kind war, hatte ich einen Hund.|Als ich ein Kind war, hatte ich einen Hund.|One period in the past: als.
s12|Als ich Zeit habe, rufe ich dich an.|Wenn ich Zeit habe, rufe ich dich an.|Present or future: wenn.
s13|Berlin ist größer wie München.|Berlin ist größer als München.|Comparative + als.
s13|Das ist der gutste Kaffee.|Das ist der beste Kaffee.|gut → besser → am besten.
s14|Ich freue sich auf den Urlaub.|Ich freue mich auf den Urlaub.|ich → mich.
s14|Ich wasche mich die Hände.|Ich wasche mir die Hände.|With another object the reflexive is dative: mir.
s15|Gestern ich war krank.|Gestern war ich krank.|Verb in position 2.
s15|Als Kind könnte ich gut schwimmen.|Als Kind konnte ich gut schwimmen.|Past of können is konnte (no umlaut).
s16|Ich trinke einen kalter Kaffee.|Ich trinke einen kalten Kaffee.|Masculine accusative: -en.
s16|Das ist ein schönes Frau.|Das ist eine schöne Frau.|die Frau is feminine: eine schöne.
s17|Das ist der Mann, den nebenan wohnt.|Das ist der Mann, der nebenan wohnt.|He is the subject of the clause: der.
s17|Die Frau, mit die ich spreche, ist nett.|Die Frau, mit der ich spreche, ist nett.|mit + dative: der.
s18|Ich werde dich morgen anrufe.|Ich werde dich morgen anrufen.|werden + infinitive.
s18|Es wird morgen regnet.|Es wird morgen regnen.|werden + infinitive.
s19|Wenn ich reich wäre, ich würde reisen.|Wenn ich reich wäre, würde ich reisen.|After the wenn-clause the main clause starts with its verb.
s19|Wenn ich Zeit hatte, würde ich kommen.|Wenn ich Zeit hätte, würde ich kommen.|Unreal: hätte, not hatte.
s20|Das Haus wird renovieren.|Das Haus wird renoviert.|Passive: werden + participle.
s20|Der Brief ist geschrieben geworden.|Der Brief ist geschrieben worden.|Passive Perfekt uses worden.
s21|Ich habe vergessen, dich zu anrufen.|Ich habe vergessen, dich anzurufen.|zu goes inside separable verbs.
s21|Er lernt viel, um die Prüfung bestehen.|Er lernt viel, um die Prüfung zu bestehen.|um … zu + infinitive.
s22|Das ist das Auto meinem Vaters.|Das ist das Auto meines Vaters.|Genitive masculine: meines.
s22|Am Ende des Tag war ich müde.|Am Ende des Tages war ich müde.|Masculine genitive adds -es.
s23|Obwohl es regnet, wir gehen spazieren.|Obwohl es regnet, gehen wir spazieren.|After the clause, the verb comes first.
s23|Es regnet, trotzdem wir gehen spazieren.|Es regnet, trotzdem gehen wir spazieren.|trotzdem takes position 1, verb follows.
s24|Gestern gehte er nach Hause.|Gestern ging er nach Hause.|gehen is strong: ging.
s24|Sie kommte sehr spät.|Sie kam sehr spät.|kommen is strong: kam.
s25|Ich warte für den Bus.|Ich warte auf den Bus.|warten auf.
s25|Ich interessiere mich auf Musik.|Ich interessiere mich für Musik.|sich interessieren für.
s26|Nachdem ich gegessen habe, ging ich spazieren.|Nachdem ich gegessen hatte, ging ich spazieren.|Past story: nachdem + Plusquamperfekt.
s26|Als wir ankamen, hatte der Zug schon abgefahren.|Als wir ankamen, war der Zug schon abgefahren.|abfahren takes sein.
s27|Wenn ich das gewusst hätte, hätte ich früher gekommen.|Wenn ich das gewusst hätte, wäre ich früher gekommen.|kommen takes sein: wäre gekommen.
s27|Du hättest mich anrufen gesollt.|Du hättest mich anrufen sollen.|Double infinitive: anrufen sollen.
s28|Das Problem muss gelöst worden.|Das Problem muss gelöst werden.|Modal passive: participle + werden.
s28|Das lässt sich leicht zu erklären.|Das lässt sich leicht erklären.|sich lassen + infinitive, no zu.
s29|Sie sagt, sie habt keine Zeit.|Sie sagt, sie habe keine Zeit.|Konjunktiv I: sie habe.
s29|Er behauptet, er seien unschuldig.|Er behauptet, er sei unschuldig.|Konjunktiv I: er sei.
s30|Wir müssen eine Entscheidung machen.|Wir müssen eine Entscheidung treffen.|eine Entscheidung treffen.
s30|Darf ich eine Frage fragen?|Darf ich eine Frage stellen?|eine Frage stellen.
s31|Er hat weder Zeit oder Geld.|Er hat weder Zeit noch Geld.|weder … noch.
s31|Sie spricht sowohl Deutsch und Englisch.|Sie spricht sowohl Deutsch als auch Englisch.|sowohl … als auch.
s32|Der bellender Hund weckt mich.|Der bellende Hund weckt mich.|After der: -e.
s32|Das gestohlende Fahrrad wurde gefunden.|Das gestohlene Fahrrad wurde gefunden.|Partizip II: gestohlen + e.
s33|Aufgrund dem schlechten Wetter fiel das Spiel aus.|Aufgrund des schlechten Wetters fiel das Spiel aus.|aufgrund + genitive.
s33|Nach Abschluss dem Studium zog sie um.|Nach Abschluss des Studiums zog sie um.|Genitive: des Studiums.
s34|Meiner Meinung nach das ist falsch.|Meiner Meinung nach ist das falsch.|Meiner Meinung nach takes position 1: verb follows.
s34|Das kommt darauf ab.|Das kommt darauf an.|darauf ankommen.`,

FAM: `fahren|die Fahrt = journey; der Fahrer = driver; abfahren = to depart; die Abfahrt = departure; erfahren = to find out; die Erfahrung = experience
arbeiten|die Arbeit = work; der Arbeiter = worker; arbeitslos = unemployed; die Zusammenarbeit = cooperation
sprechen|die Sprache = language; das Gespräch = conversation; versprechen = to promise; ansprechen = to address
lesen|der Leser = reader; vorlesen = to read aloud; die Lesung = reading (event); lesbar = readable
schreiben|die Schrift = writing; unterschreiben = to sign; die Unterschrift = signature; beschreiben = to describe
kaufen|der Kauf = purchase; verkaufen = to sell; der Verkäufer = seller; einkaufen = to shop
wohnen|die Wohnung = flat; der Bewohner = resident; das Wohnzimmer = living room; gewohnt = usual
fliegen|der Flug = flight; das Flugzeug = plane; der Flughafen = airport
helfen|die Hilfe = help; hilfsbereit = helpful; hilflos = helpless
lernen|der Lerner = learner; erlernen = to acquire; verlernen = to forget how to
spielen|das Spiel = game; der Spieler = player; das Spielzeug = toy
kochen|der Koch = cook; die Küche = kitchen; das Kochbuch = cookbook
fragen|die Frage = question; befragen = to survey; die Anfrage = enquiry
antworten|die Antwort = answer; beantworten = to answer (sth); verantwortlich = responsible
denken|der Gedanke = thought; nachdenken = to reflect; das Denkmal = monument
gehen|der Gang = corridor; der Ausgang = exit; der Eingang = entrance; vergehen = to pass (time)
kommen|die Ankunft = arrival; ankommen = to arrive; bekommen = to receive; die Zukunft = future
sehen|die Sicht = view; die Aussicht = view, prospect; fernsehen = to watch TV; aussehen = to look (appearance)
stehen|verstehen = to understand; entstehen = to arise; der Zustand = condition
nehmen|annehmen = to accept; die Annahme = assumption; teilnehmen = to take part; unternehmen = to undertake; das Unternehmen = company
geben|die Gabe = gift; ausgeben = to spend; aufgeben = to give up; die Aufgabe = task
leben|das Leben = life; lebendig = alive; erleben = to experience; das Erlebnis = experience
lieben|die Liebe = love; lieb = dear; verliebt = in love; beliebt = popular
schlafen|der Schlaf = sleep; einschlafen = to fall asleep; ausschlafen = to sleep in
fühlen|das Gefühl = feeling; sich wohlfühlen = to feel good; einfühlsam = empathetic
wissen|das Wissen = knowledge; die Wissenschaft = science; bewusst = conscious
bauen|der Bau = construction; das Gebäude = building; aufbauen = to build up; der Bauer = farmer
zahlen|die Zahl = number; bezahlen = to pay; zählen = to count; die Zahlung = payment
suchen|die Suche = search; besuchen = to visit; der Besuch = visit; versuchen = to try
schließen|der Schluss = end; der Schlüssel = key; abschließen = to lock, to complete; der Abschluss = degree, completion
ziehen|umziehen = to move house; der Umzug = move; anziehen = to put on; die Erziehung = upbringing
bringen|mitbringen = to bring along; verbringen = to spend (time); umbringen = to kill
stellen|die Stelle = job, position; bestellen = to order; die Vorstellung = introduction, idea; vorstellen = to introduce
setzen|übersetzen = to translate; die Übersetzung = translation; besetzt = occupied; voraussetzen = to presuppose
halten|die Haltestelle = stop; behalten = to keep; sich verhalten = to behave; das Verhalten = behaviour; erhalten = to receive
reisen|die Reise = journey; der Reisende = traveller; das Reisebüro = travel agency
wählen|die Wahl = election, choice; auswählen = to select; der Wähler = voter
entscheiden|die Entscheidung = decision; entscheidend = decisive
gesund|die Gesundheit = health; ungesund = unhealthy; gesundheitlich = health-related
krank|die Krankheit = illness; das Krankenhaus = hospital; die Krankenkasse = health insurance
frei|die Freiheit = freedom; freiwillig = voluntary; die Freizeit = free time
schön|die Schönheit = beauty; verschönern = to beautify
schwer|die Schwierigkeit = difficulty; schwierig = difficult; erschweren = to make harder
wichtig|die Wichtigkeit = importance; wichtigste = most important
Freund|die Freundschaft = friendship; freundlich = friendly; befreundet = friends with
Kind|die Kindheit = childhood; kindlich = childlike; der Kindergarten = kindergarten
Zeit|zeitlich = in terms of time; rechtzeitig = in time; die Zeitung = newspaper; gleichzeitig = simultaneously
Welt|weltweit = worldwide; die Umwelt = environment
Recht|richtig = correct; gerecht = fair; die Gerechtigkeit = justice; berechtigt = entitled
Wirtschaft|wirtschaftlich = economic; der Wirt = landlord (pub)
Mensch|menschlich = human; die Menschheit = humanity; die Menschenrechte = human rights`
};
