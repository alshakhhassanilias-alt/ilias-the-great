/* Listening dialogues, read by two voices. Lines start with "A: " or "B: ". q: [question, [options], right index] */
window.WW_LISTEN = [
{ id:'h01', lvl:'A1', t:'Im Café', d:`A: Guten Tag! Was möchten Sie trinken?
B: Einen Kaffee mit Milch, bitte.
A: Gern. Möchten Sie auch etwas essen?
B: Ja, ein Stück Apfelkuchen, bitte.
A: Mit Sahne?
B: Nein, danke. Ohne Sahne.
A: Das macht sechs Euro fünfzig.
B: Hier, bitte. Stimmt so.`,
  q:[['Was trinkt die Person?',['Tee','Kaffee mit Milch','Orangensaft'],1],['Was isst sie?',['Apfelkuchen ohne Sahne','Apfelkuchen mit Sahne','Ein Brötchen'],0],['Wie viel kostet es?',['5,60 €','6,50 €','16,50 €'],1]] },
{ id:'h02', lvl:'A1', t:'Am Telefon', d:`A: Hallo, hier ist Jonas.
B: Hallo Jonas! Hier ist Mia. Wie geht's?
A: Gut, danke. Mia, hast du am Samstag Zeit?
B: Am Samstag? Am Vormittag arbeite ich, aber am Nachmittag habe ich Zeit.
A: Super! Wir gehen ins Kino. Kommst du mit?
B: Ja, gern! Wann beginnt der Film?
A: Um vier Uhr. Wir treffen uns um halb vier vor dem Kino.
B: Okay, bis Samstag!`,
  q:[['Was macht Mia am Samstagvormittag?',['Sie geht ins Kino','Sie arbeitet','Sie schläft'],1],['Wann beginnt der Film?',['Um halb vier','Um vier Uhr','Um vierzehn Uhr'],1],['Wo treffen sie sich?',['Vor dem Kino','Bei Mia','Am Bahnhof'],0]] },
{ id:'h03', lvl:'A1', t:'Nach dem Weg fragen', d:`A: Entschuldigung, wo ist hier die Post?
B: Die Post? Gehen Sie hier geradeaus und dann die zweite Straße links.
A: Geradeaus und dann die zweite Straße links. Ist es weit?
B: Nein, nur fünf Minuten zu Fuß. Die Post ist neben der Apotheke.
A: Vielen Dank!
B: Bitte schön.`,
  q:[['Was sucht die Person?',['Die Apotheke','Die Post','Den Bahnhof'],1],['Wie geht man dorthin?',['Geradeaus, dann die zweite Straße links','Die erste Straße rechts','Immer geradeaus'],0],['Wie lange dauert es zu Fuß?',['Fünfzehn Minuten','Fünf Minuten','Eine Stunde'],1]] },
{ id:'h04', lvl:'A1', t:'Im Kleidergeschäft', d:`A: Kann ich Ihnen helfen?
B: Ja, ich suche eine Jacke. Für den Winter.
A: Welche Größe haben Sie?
B: Größe M, glaube ich.
A: Hier ist eine schöne Jacke in Blau. Und hier eine in Schwarz.
B: Die schwarze gefällt mir. Was kostet sie?
A: Neunundsiebzig Euro.
B: Gut, die nehme ich.`,
  q:[['Was sucht die Kundin?',['Einen Pullover','Eine Jacke','Schuhe'],1],['Welche Farbe nimmt sie?',['Blau','Schwarz','Grau'],1],['Wie viel kostet die Jacke?',['69 €','79 €','97 €'],1]] },
{ id:'h05', lvl:'A1', t:'Die neue Kollegin', d:`A: Hallo, ich bin Sandra. Bist du neu hier?
B: Ja, heute ist mein erster Tag. Ich heiße Emre.
A: Herzlich willkommen, Emre! Woher kommst du?
B: Ich komme aus Izmir, aber ich wohne seit drei Jahren in Stuttgart.
A: Und was machst du hier in der Firma?
B: Ich arbeite in der IT-Abteilung.
A: Ah, prima! Dann sehen wir uns in der Kantine.`,
  q:[['Woher kommt Emre?',['Aus Stuttgart','Aus Izmir','Aus Istanbul'],1],['Seit wann wohnt er in Stuttgart?',['Seit drei Monaten','Seit drei Jahren','Seit heute'],1],['Wo arbeitet Emre?',['In der IT-Abteilung','In der Kantine','Im Verkauf'],0]] },
{ id:'h06', lvl:'A2', t:'Einen Arzttermin machen', d:`A: Praxis Dr. Krüger, guten Morgen.
B: Guten Morgen, mein Name ist Peters. Ich hätte gern einen Termin. Ich habe seit einer Woche Rückenschmerzen.
A: Waren Sie schon einmal bei uns?
B: Ja, letztes Jahr.
A: Gut. Ich kann Ihnen einen Termin am Donnerstag um 9 Uhr anbieten.
B: Am Donnerstag muss ich leider arbeiten. Geht es auch am Freitag?
A: Freitag um 14:30 Uhr ist noch frei.
B: Perfekt, das passt.
A: Bringen Sie bitte Ihre Versichertenkarte mit.`,
  q:[['Welches Problem hat Herr Peters?',['Kopfschmerzen','Rückenschmerzen','Fieber'],1],['Warum kann er am Donnerstag nicht?',['Er ist im Urlaub','Er muss arbeiten','Die Praxis ist zu'],1],['Wann ist sein Termin?',['Donnerstag um 9 Uhr','Freitag um 14:30 Uhr','Freitag um 9 Uhr'],1]] },
{ id:'h07', lvl:'A2', t:'Wohnung gesucht', d:`A: Hallo, ich rufe wegen der Wohnung in der Gartenstraße an. Ist sie noch frei?
B: Ja, noch ist sie frei. Sie hat zwei Zimmer, Küche, Bad und einen kleinen Balkon.
A: Wie hoch ist die Miete?
B: 650 Euro warm. Dazu kommen drei Monatsmieten Kaution.
A: Darf man Haustiere haben? Ich habe eine Katze.
B: Eine Katze ist kein Problem. Nur Hunde sind nicht erlaubt.
A: Wann kann ich die Wohnung besichtigen?
B: Am Mittwoch um 18 Uhr. Passt Ihnen das?
A: Ja, sehr gut. Bis Mittwoch!`,
  q:[['Wie viele Zimmer hat die Wohnung?',['Eins','Zwei','Drei'],1],['Was ist in der Wohnung nicht erlaubt?',['Katzen','Hunde','Rauchen'],1],['Wann ist die Besichtigung?',['Mittwoch um 18 Uhr','Montag um 18 Uhr','Mittwoch um 8 Uhr'],0]] },
{ id:'h08', lvl:'A2', t:'Durchsage am Bahnhof', d:`A: Achtung am Gleis 7. Der ICE 578 nach Hamburg hat heute circa 25 Minuten Verspätung. Grund dafür ist eine Störung am Zug.
B: Oh nein, 25 Minuten! Dann verpasse ich meinen Anschluss in Hannover.
A: Fahrgäste nach Bremen nutzen bitte den Regionalexpress um 10:42 Uhr von Gleis 3.
B: Ah, ich fahre ja nach Bremen. Dann nehme ich den Regionalexpress.`,
  q:[['Wie viel Verspätung hat der ICE?',['15 Minuten','25 Minuten','45 Minuten'],1],['Warum hat der Zug Verspätung?',['Wegen des Wetters','Wegen einer Störung am Zug','Wegen eines Streiks'],1],['Von welchem Gleis fährt der Regionalexpress?',['Gleis 3','Gleis 7','Gleis 10'],0]] },
{ id:'h09', lvl:'A2', t:'Pläne fürs Wochenende', d:`A: Was hast du am Wochenende vor?
B: Am Samstag besuche ich meine Eltern in Freiburg. Mein Vater hat Geburtstag.
A: Schön! Wie alt wird er?
B: Sechzig. Wir machen eine kleine Feier im Garten. Und du?
A: Ich wollte eigentlich wandern gehen, aber es soll regnen.
B: Dann geh doch ins Museum. Im Stadtmuseum gibt es gerade eine tolle Ausstellung über Fotografie.
A: Gute Idee, das mache ich vielleicht.`,
  q:[['Warum fährt B nach Freiburg?',['Zu einer Hochzeit','Zum Geburtstag des Vaters','Zu einer Ausstellung'],1],['Warum geht A nicht wandern?',['Es soll regnen','Er ist krank','Er muss arbeiten'],0],['Was empfiehlt B?',['Ins Kino zu gehen','Ins Museum zu gehen','Zu Hause zu bleiben'],1]] },
{ id:'h10', lvl:'A2', t:'Im Restaurant reklamieren', d:`A: Entschuldigung, ich habe das vegetarische Curry bestellt, aber hier ist Hähnchen drin.
B: Oh, das tut mir leid! Da hat die Küche einen Fehler gemacht.
A: Ich esse kein Fleisch.
B: Selbstverständlich. Ich bringe Ihnen sofort ein neues Curry. Das dauert etwa zehn Minuten.
A: Okay, danke.
B: Und als Entschuldigung bekommen Sie den Nachtisch gratis.`,
  q:[['Was ist das Problem?',['Das Essen ist kalt','Im Curry ist Fleisch','Das Curry ist zu scharf'],1],['Wie lange dauert das neue Essen?',['Fünf Minuten','Zehn Minuten','Zwanzig Minuten'],1],['Was bekommt der Gast gratis?',['Ein Getränk','Den Nachtisch','Das Curry'],1]] },
{ id:'h11', lvl:'B1', t:'Ein Vorstellungsgespräch', d:`A: Frau Yilmaz, warum haben Sie sich bei uns beworben?
B: Ich arbeite seit vier Jahren in der Logistik, aber in meiner jetzigen Firma habe ich kaum Möglichkeiten, mich weiterzuentwickeln. Ihr Unternehmen ist international tätig, und das reizt mich sehr.
A: Was sind Ihre Stärken?
B: Ich bin sehr organisiert und kann auch unter Zeitdruck ruhig bleiben. Außerdem spreche ich Türkisch, Deutsch und Englisch.
A: Und Ihre Schwächen?
B: Manchmal bin ich zu perfektionistisch. Ich habe aber gelernt, Prioritäten zu setzen.
A: Wann könnten Sie bei uns anfangen?
B: Ich habe eine Kündigungsfrist von drei Monaten, also frühestens im April.`,
  q:[['Warum möchte Frau Yilmaz die Stelle wechseln?',['Sie verdient zu wenig','Sie kann sich kaum weiterentwickeln','Sie hat Streit mit dem Chef'],1],['Welche Schwäche nennt sie?',['Sie ist zu perfektionistisch','Sie ist oft unpünktlich','Sie spricht kein Englisch'],0],['Wann kann sie frühestens anfangen?',['Sofort','Im April','In drei Wochen'],1]] },
{ id:'h12', lvl:'B1', t:'Streit unter Mitbewohnern', d:`A: Lukas, können wir kurz reden? Die Küche sieht schon wieder chaotisch aus.
B: Ich weiß, tut mir leid. Ich hatte diese Woche so viele Prüfungen.
A: Das verstehe ich, aber das ist jetzt schon das dritte Mal in diesem Monat.
B: Du hast recht. Was hältst du von einem Putzplan? Dann weiß jeder genau, wann er dran ist.
A: Gute Idee. Und wer nicht putzt, kauft für alle Pizza.
B: Einverstanden! Ich mache heute Abend die Küche sauber.`,
  q:[['Worüber beschwert sich A?',['Über laute Musik','Über die chaotische Küche','Über die Miete'],1],['Warum hatte Lukas keine Zeit?',['Er war krank','Er hatte viele Prüfungen','Er war im Urlaub'],1],['Was schlägt Lukas vor?',['Einen Putzplan','Eine Putzfirma','Auszuziehen'],0]] },
{ id:'h13', lvl:'B1', t:'Radiobeitrag: Stadtgärten', d:`A: Immer mehr Menschen in deutschen Großstädten bauen ihr eigenes Gemüse an. Wir sind heute in einem Gemeinschaftsgarten in Berlin-Neukölln. Frau Schneider, wie ist das Projekt entstanden?
B: Vor fünf Jahren war das hier eine leere Fläche voller Müll. Ein paar Nachbarn hatten die Idee, daraus einen Garten zu machen. Heute machen über achtzig Leute mit.
A: Was ist das Besondere an dem Garten?
B: Es geht nicht nur um Tomaten und Salat. Hier treffen sich Menschen aus über zwanzig Ländern. Man lernt sich kennen, man hilft sich. Viele sagen, der Garten ist für sie wie ein zweites Wohnzimmer.`,
  q:[['Was war die Fläche früher?',['Ein Parkplatz','Eine leere Fläche voller Müll','Ein Spielplatz'],1],['Wie viele Leute machen heute mit?',['Über zwanzig','Über achtzig','Über achthundert'],1],['Was ist laut Frau Schneider das Besondere?',['Das Gemüse ist billig','Menschen aus vielen Ländern kommen zusammen','Der Garten ist sehr groß'],1]] },
{ id:'h14', lvl:'B1', t:'Beim Bürgeramt', d:`A: Guten Tag, ich möchte mich ummelden. Ich bin letzten Monat innerhalb von Köln umgezogen.
B: Haben Sie die Wohnungsgeberbestätigung von Ihrem Vermieter dabei?
A: Ja, hier ist sie. Und mein Personalausweis.
B: Danke. Sie wissen, dass man sich innerhalb von zwei Wochen ummelden muss?
A: Ehrlich gesagt nicht. Ist das ein Problem?
B: Diesmal lasse ich es noch durchgehen. Aber normalerweise kann das ein Bußgeld kosten. So, Ihre neue Adresse steht jetzt im Ausweis.`,
  q:[['Warum ist A beim Bürgeramt?',['Für einen neuen Pass','Um sich umzumelden','Um ein Auto anzumelden'],1],['Innerhalb welcher Frist muss man sich ummelden?',['Zwei Wochen','Zwei Monate','Ein Jahr'],0],['Was passiert diesmal?',['A muss ein Bußgeld zahlen','Die Beamtin macht eine Ausnahme','A muss wiederkommen'],1]] },
{ id:'h15', lvl:'B1', t:'Pro und Contra: Handyverbot an Schulen', d:`A: In Bayern wird über ein Handyverbot an Schulen diskutiert. Herr Brandt, Sie sind Lehrer. Was halten Sie davon?
B: Ich bin dafür. Die Schüler sind in den Pausen nur noch am Handy und reden kaum noch miteinander. Außerdem gibt es weniger Mobbing, wenn keine Fotos gemacht werden.
A: Viele Eltern sagen aber, sie wollen ihre Kinder erreichen können.
B: Das verstehe ich. Deshalb sollen die Handys auch nicht verboten, sondern nur während des Unterrichts und der Pausen im Schrank eingeschlossen werden. Nach der Schule bekommen die Kinder sie zurück.`,
  q:[['Welche Meinung hat Herr Brandt?',['Er ist gegen das Verbot','Er ist für das Verbot','Er hat keine Meinung'],1],['Welchen Vorteil nennt er?',['Bessere Noten','Weniger Mobbing','Weniger Kosten'],1],['Was sieht der Kompromiss vor?',['Handys werden ganz verboten','Handys werden in der Schulzeit eingeschlossen','Nur Lehrer dürfen Handys haben'],1]] },
{ id:'h16', lvl:'B2', t:'Interview: Fachkräfte aus dem Ausland', d:`A: Frau Dr. Weber, Deutschland wirbt verstärkt um Fachkräfte aus dem Ausland. Funktioniert das?
B: Teilweise. Das Interesse ist durchaus vorhanden, gerade in der Pflege und in der IT. Das Problem liegt häufig woanders: Die Anerkennung ausländischer Abschlüsse dauert oft viel zu lange, manchmal über ein Jahr.
A: Woran liegt das?
B: Zum einen an der Bürokratie, zum anderen daran, dass die Zuständigkeiten auf viele verschiedene Behörden verteilt sind. Wer in Bayern arbeiten will, durchläuft unter Umständen ein ganz anderes Verfahren als jemand in Hamburg.
A: Was müsste sich ändern?
B: Wir brauchen zentrale Anlaufstellen und digitale Verfahren. Und wir dürfen nicht vergessen: Wer kommt, will auch gut ankommen. Sprachkurse, Hilfe bei der Wohnungssuche und eine echte Willkommenskultur sind mindestens genauso wichtig.`,
  q:[['Was ist laut Dr. Weber das Hauptproblem?',['Mangelndes Interesse','Die langsame Anerkennung von Abschlüssen','Zu niedrige Gehälter'],1],['Warum unterscheiden sich die Verfahren?',['Weil die Zuständigkeiten verteilt sind','Weil die Berufe verschieden sind','Weil es zu wenig Personal gibt'],0],['Was hält sie außer digitalen Verfahren für wichtig?',['Höhere Steuern','Unterstützung beim Ankommen','Strengere Kontrollen'],1]] },
{ id:'h17', lvl:'B2', t:'Podcast: Warum wir prokrastinieren', d:`A: Willkommen zu unserer heutigen Folge. Thema: Aufschieben. Fast jeder kennt es, man hat eine wichtige Aufgabe und räumt stattdessen den Kühlschrank auf.
B: Genau. Und lange dachte man, das sei einfach ein Problem mit dem Zeitmanagement. Die Forschung zeigt aber inzwischen, dass Prokrastination vor allem mit Gefühlen zu tun hat. Wir schieben Aufgaben auf, die unangenehme Gefühle auslösen: Langeweile, Unsicherheit oder Angst vor dem Scheitern.
A: Was hilft dagegen?
B: Ein Trick ist, die Einstiegshürde so niedrig wie möglich zu machen. Statt "Ich schreibe heute die Hausarbeit" sagt man sich: "Ich schreibe fünf Minuten lang irgendetwas." Meistens macht man danach weiter. Und ganz wichtig: sich selbst nicht fertigmachen. Selbstvorwürfe verstärken das Problem nämlich.`,
  q:[['Womit hat Prokrastination laut Forschung vor allem zu tun?',['Mit Faulheit','Mit Gefühlen','Mit Intelligenz'],1],['Welchen Trick empfiehlt B?',['Sich eine Belohnung versprechen','Die Einstiegshürde niedrig machen','Früher aufstehen'],1],['Was verstärkt das Problem?',['Pausen','Selbstvorwürfe','Musik beim Arbeiten'],1]] },
{ id:'h18', lvl:'B2', t:'Diskussion: Tempolimit auf der Autobahn', d:`A: Deutschland ist eines der wenigen Länder ohne generelles Tempolimit auf Autobahnen. Herr Kraus, sollte sich das ändern?
B: Eindeutig ja. Ein Tempolimit von 130 würde den CO2-Ausstoß spürbar senken, und zwar sofort und praktisch ohne Kosten. Außerdem zeigen Studien, dass es auf Strecken mit Tempolimit weniger schwere Unfälle gibt.
A: Frau Lenz, Sie sehen das anders.
C: Ich halte die Debatte für symbolisch. Der Effekt aufs Klima ist im Vergleich zu anderen Maßnahmen gering. Und auf vielen Abschnitten gibt es ohnehin schon Begrenzungen. Ich finde, man sollte den Menschen nicht vorschreiben, wie schnell sie auf einer freien Autobahn fahren dürfen.
B: Mit Verlaub, Freiheit endet dort, wo andere gefährdet werden.`,
  q:[['Welche Vorteile nennt Herr Kraus?',['Weniger CO2 und weniger schwere Unfälle','Kürzere Fahrzeiten','Mehr Einnahmen für den Staat'],0],['Wie bewertet Frau Lenz die Debatte?',['Als dringend','Als eher symbolisch','Als zu spät'],1],['Welches Argument bringt Frau Lenz?',['Tempolimits sind zu teuer','Man sollte Menschen nicht bevormunden','Autobahnen sind sicher genug'],1]] },
{ id:'h19', lvl:'B2', t:'Nachrichten', d:`A: Die Bundesregierung hat sich auf ein neues Entlastungspaket geeinigt. Haushalte mit geringem Einkommen sollen im kommenden Jahr einen einmaligen Zuschuss zu den Heizkosten erhalten. Die Opposition kritisierte das Paket als unzureichend.
A: Die Deutsche Bahn will bis Ende des Jahrzehnts rund 50 Milliarden Euro in ihr Schienennetz investieren. Ziel sei es, die Pünktlichkeit deutlich zu verbessern. Derzeit erreicht nur etwa jeder dritte Fernzug sein Ziel mit Verspätung, so ein Sprecher.
A: Und zum Wetter: Im Norden bleibt es wechselhaft mit Schauern, im Süden setzt sich zunehmend die Sonne durch. Die Temperaturen erreichen bis zu 22 Grad.`,
  q:[['Wer soll einen Zuschuss bekommen?',['Alle Rentner','Haushalte mit geringem Einkommen','Unternehmen'],1],['Was will die Bahn verbessern?',['Die Pünktlichkeit','Die Ticketpreise','Das Essen im Zug'],0],['Wie wird das Wetter im Süden?',['Regnerisch','Zunehmend sonnig','Stürmisch'],1]] },
{ id:'h20', lvl:'B2', t:'Beratungsgespräch an der Uni', d:`A: Ich überlege, ob ich mein Studium abbrechen soll. Ich studiere Maschinenbau im dritten Semester, aber es macht mir überhaupt keinen Spaß mehr.
B: Das ist eine wichtige Entscheidung. Lassen Sie uns zuerst herausfinden, woran es liegt. Ist es der Stoff, sind es die Prüfungen oder etwas ganz anderes?
A: Ehrlich gesagt merke ich, dass mich die Theorie überhaupt nicht interessiert. Ich arbeite viel lieber praktisch.
B: Dann wäre vielleicht ein duales Studium oder eine Ausbildung interessant. Dort wechseln sich Theorie und Praxis ab, und Sie verdienen sogar schon Geld. Manche Leistungen aus Ihrem Studium können Sie unter Umständen anrechnen lassen.
A: Das wusste ich nicht. Das klingt vielversprechend.
B: Ich gebe Ihnen die Kontaktdaten der Berufsberatung. Und treffen Sie keine Entscheidung übereilt.`,
  q:[['Warum will A das Studium abbrechen?',['Zu hohe Kosten','Die Theorie interessiert ihn nicht','Er ist durch Prüfungen gefallen'],1],['Was schlägt die Beraterin vor?',['Ein duales Studium oder eine Ausbildung','Das Fach zu wechseln','Ein Jahr Pause'],0],['Welchen Rat gibt sie am Ende?',['Sofort zu kündigen','Nicht übereilt zu entscheiden','Mehr zu lernen'],1]] }
];
