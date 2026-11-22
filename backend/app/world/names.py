"""Procedural names for leaders, states, newspapers and fictional realms, by culture group."""
from __future__ import annotations

import random

FIRST = {
    "germanic": "Friedrich Karl Wilhelm Otto Heinrich Ludwig Konrad Ernst Hans Johanna Margarete Ilse Greta Klara Anneliese Dietrich Wolfgang",
    "anglo": "James William Thomas Edward George Arthur Henry Charles Margaret Elizabeth Eleanor Catherine Alice Victoria Harold Winston",
    "french": "Louis Henri Jean Pierre Charles Philippe Antoine Marie Jeanne Camille Élise Hélène Gaston Raymond Léon",
    "dutch": "Willem Pieter Jan Hendrik Maarten Johanna Anna Cornelia Joost",
    "nordic": "Erik Olaf Gustav Harald Sven Ingrid Astrid Sigrid Magnus Leif",
    "italian": "Giuseppe Vittorio Giovanni Luigi Alessandro Francesca Lucia Giulia Benito Enrico Carlo",
    "iberian": "José Juan Francisco Manuel Carlos Isabel María Carmen Fernando Álvaro Rafael",
    "slavic_w": "Józef Jan Tomáš Václav Stanisław Władysław Anna Zofia Edvard Milan",
    "slavic_e": "Ivan Nikolai Alexei Dmitri Mikhail Sergei Anastasia Yekaterina Vladimir Boris Olga",
    "slavic_s": "Petar Aleksandar Milan Josip Dragan Stjepan Jelena Milica Todor",
    "baltic": "Kārlis Antanas Konstantin Jānis Algirdas Ruta Laima",
    "balkan": "Nicolae Ion Miklós István Ferenc Eleftherios Ioannis Ahmet Ana Elena",
    "turkic": "Mustafa İsmet Mehmet Ahmet Nursultan Timur Aylin Zeynep Kemal",
    "caucasian": "Giorgi Levon Tigran Nino Ani",
    "persian": "Reza Cyrus Dariush Mohammad Farah Shirin Abbas Amanullah",
    "arab": "Abdullah Faisal Ibrahim Hussein Omar Khalid Fatima Aisha Saad Gamal Hassan",
    "south_asian": "Jawaharlal Vallabhbhai Subhas Ananya Rajendra Indira Arjun Muhammad Priya Vikram",
    "east_asian": "Zhou Wei Ming Jian Hua Lin Mei Chen Sun Yat",
    "japanese": "Hiroshi Kenji Takeshi Ichirō Haruto Yuki Aiko Sakura Kōki Fumimaro",
    "korean": "Min-jun Seo-yeon Ji-ho Jae-in Kim-sung Hye-jin",
    "se_asian": "Sukarno Manuel Phibun Aung Anh Thanh Siti Rizal",
    "latin": "Juan Carlos Getúlio Lázaro Simón Isabela Gabriela Rafael Eva Ernesto",
    "caribbean": "Marcus Alexander Norman Eugenia Errol",
    "west_african": "Kwame Nnamdi Léopold Amadou Ama Ngozi Félix Sékou",
    "central_african": "Patrice Joseph Barthélemy Ange Jeanne",
    "east_african": "Haile Jomo Julius Menelik Wangari Zewditu Ras",
    "southern_african": "Nelson Thabo Jan Seretse Nomvula Kenneth",
    "oceanic": "Ratu Michael Tupou Sione Malia",
    "mars": "Ares Valen Tharsa Kade Orin Selene Juno Rhea Cassian Lyra Dax Noor",
    "luna": "Selen Artemis Cyrus Mare Tycho Lune",
    "digital": "Quorum Lattice Echo Meridian Vector Cantor Aleph Halcyon Sable Iris",
    "other": "Aram Elan Tomas Mira Soren Lena Arin Kai",
}
LAST = {
    "germanic": "Hartmann Weber Becker Richter Brandt Vogel Krüger Lindner Falk Steiner Albrecht Wendt",
    "anglo": "Hamilton Ashford Whitmore Carlisle Pembroke Fairfax Thornton Langley Mercer Hale",
    "french": "Dubois Laurent Moreau Fontaine Mercier Lambert Girard Rousseau Delacroix",
    "dutch": "de Vries Bakker Visser van Dijk Smit",
    "nordic": "Lindqvist Andersen Halvorsen Nyström Berg",
    "italian": "Rossi Bianchi Esposito Romano Conti Ferrari Galli Marino",
    "iberian": "García Fernández Moreno Navarro Ortega Castillo Salazar",
    "slavic_w": "Nowak Kowalski Novák Dvořák Wiśniewski Svoboda",
    "slavic_e": "Volkov Sokolov Morozov Orlov Petrov Kuznetsov Lebedev",
    "slavic_s": "Petrović Jovanović Horvat Kovačević Marković",
    "baltic": "Ozols Kalniņš Kazlauskas Tamm",
    "balkan": "Popescu Ionescu Horváth Nagy Papadopoulos Dimitriou",
    "turkic": "Yılmaz Demir Kaya Nazarbayev Aliyev",
    "caucasian": "Beridze Petrosyan Gelashvili",
    "persian": "Tehrani Rostami Karimi Hosseini",
    "arab": "al-Hashimi al-Saud Mansour Haddad Nasser al-Rashid",
    "south_asian": "Sharma Patel Singh Rao Ali Bose Khan",
    "east_asian": "Wang Li Zhang Liu Chen Yang Huang",
    "japanese": "Tanaka Yamamoto Watanabe Saitō Kobayashi Konoe Hirota",
    "korean": "Kim Lee Park Choi Jung",
    "se_asian": "Nguyen Santos Wongsuwan Hassan Tran",
    "latin": "Vargas Cárdenas Perón Bolívar Mendoza Herrera Rocha",
    "caribbean": "Manley Garvey Williams Bustamante",
    "west_african": "Nkrumah Azikiwe Senghor Diallo Touré Okafor",
    "central_african": "Lumumba Mbeki Boganda Ngoy",
    "east_african": "Selassie Kenyatta Nyerere Mwangi Tesfaye",
    "southern_african": "Mandela Khama Smuts Dlamini Kaunda",
    "oceanic": "Tupou Mara Somare",
    "mars": "Okonkwo-Hale Tharsis Vance Arcadia Ishikawa Marr Cydonia Chen-Reyes",
    "luna": "Shackleton Imbrium Vance Kaur",
    "digital": "Prime Nine Continuum Seventeen Concord Unbound",
    "other": "Ardent Vale Morrow Rook Sterling",
}
STATE_FORMS = {
    "democratic": ["Republic of {n}", "{a} Republic", "Federal Republic of {n}", "Commonwealth of {n}"],
    "monarchic": ["Kingdom of {n}", "{a} Kingdom", "Grand Duchy of {n}"],
    "authoritarian": ["{a} State", "{a} National State", "Directorate of {n}"],
    "socialist": ["{a} People's Republic", "Socialist Republic of {n}", "{a} Workers' Commune"],
    "religious": ["Holy State of {n}", "{a} Caliphate", "Sacred Realm of {n}"],
    "imperial": ["{a} Empire", "Empire of {n}", "Imperial Federation of {n}"],
    "technocratic": ["{a} Directorate", "Technate of {n}"],
    "corporate": ["{a} Charter Company", "{n} Combine"],
    "traditional": ["{a} Confederation", "Chiefdoms of {n}"],
    "post-national": ["{a} Concord", "Planetary Union of {n}"],
    "artificial": ["{a} Administration", "Algorithmic Directorate of {n}"],
    "transhumanist": ["{a} Digital Republic", "Substrate Commonwealth of {n}"],
    "collective": ["The {a} Chorus", "Collective of {n}"],
}
SYL = {
    "default": ["ar", "an", "el", "or", "is", "ia", "on", "ra", "ta", "ven", "dor", "mar", "sel", "kar", "lun", "thal", "ber", "gor", "ess", "ul"],
    "mars": ["thar", "ares", "cyd", "on", "ia", "red", "ox", "hel", "las", "utop", "arc", "ely"],
    "digital": ["nex", "um", "lat", "ice", "cod", "ex", "ion", "syn", "qu", "or", "aeon"],
}


def person(rng: random.Random, culture: str) -> str:
    f = FIRST.get(culture, FIRST["other"]).split()
    l = LAST.get(culture, LAST["other"]).split()
    if culture == "digital":
        return f"{rng.choice(f)}-{rng.choice(l)}"
    return f"{rng.choice(f)} {rng.choice(l)}"


def realm_root(rng: random.Random, flavor: str = "default") -> str:
    syl = SYL.get(flavor, SYL["default"])
    n = rng.choice([2, 2, 3])
    s = "".join(rng.choice(syl) for _ in range(n))
    return s[:1].upper() + s[1:]


ADJ_EXCEPTIONS = {
    "Burkina Faso": "Burkinabé", "France": "French", "Spain": "Spanish", "Netherlands": "Dutch", "Switzerland": "Swiss", "Denmark": "Danish",
    "Sweden": "Swedish", "Finland": "Finnish", "Poland": "Polish", "Turkey": "Turkish", "Ireland": "Irish", "Iceland": "Icelandic",
    "Thailand": "Thai", "China": "Chinese", "Japan": "Japanese", "Vietnam": "Vietnamese", "Portugal": "Portuguese", "Greece": "Greek",
    "Cyprus": "Cypriot", "Madagascar": "Malagasy", "Philippines": "Filipino", "Pakistan": "Pakistani", "Bangladesh": "Bangladeshi",
    "Afghanistan": "Afghan", "Iraq": "Iraqi", "Israel": "Israeli", "Kuwait": "Kuwaiti", "Qatar": "Qatari", "Yemen": "Yemeni", "Oman": "Omani",
    "Uzbekistan": "Uzbek", "Kazakhstan": "Kazakh", "Tajikistan": "Tajik", "Turkmenistan": "Turkmen", "Kyrgyzstan": "Kyrgyz", "Mali": "Malian",
    "Niger": "Nigerien", "Chad": "Chadian", "Sudan": "Sudanese", "Senegal": "Senegalese", "Togo": "Togolese", "Benin": "Beninese",
    "Gabon": "Gabonese", "Congo": "Congolese", "Lebanon": "Lebanese", "Nepal": "Nepali", "Bhutan": "Bhutanese", "Myanmar": "Burmese",
    "Laos": "Lao", "Peru": "Peruvian", "Chile": "Chilean", "Brazil": "Brazilian", "Mexico": "Mexican", "Morocco": "Moroccan",
    "Egypt": "Egyptian", "Norway": "Norwegian", "Germany": "German", "Wales": "Welsh", "Scotland": "Scottish", "England": "English",
    "Belgium": "Belgian", "Luxembourg": "Luxembourgish", "Malta": "Maltese", "Guinea": "Guinean", "Somalia": "Somali", "Somaliland": "Somali",
    "Djibouti": "Djiboutian", "Argentina": "Argentine", "Canada": "Canadian", "Mars": "Martian", "Luna": "Lunar", "Venus": "Venusian",
    "Sri Lanka": "Sri Lankan", "Côte d'Ivoire": "Ivorian", "Isle of Man": "Manx", "United States": "American", "United States of America": "American", "United Kingdom": "British", "New Zealand": "New Zealand", "South Africa": "South African", "Panama": "Panamanian", "Ghana": "Ghanaian", "Rwanda": "Rwandan", "Uganda": "Ugandan", "Eritrea": "Eritrean", "Libya": "Libyan", "Haiti": "Haitian", "Cuba": "Cuban", "Fiji": "Fijian",
}


def adjective(name: str) -> str:
    if name in ADJ_EXCEPTIONS:
        return ADJ_EXCEPTIONS[name]
    last = name.split()[-1]
    if last in ADJ_EXCEPTIONS:
        return ADJ_EXCEPTIONS[last]
    if name.endswith("ia"):
        return name + "n"
    if name.endswith("o"):
        return name[:-1] + "an"
    if name.endswith("y") and len(name) > 2 and name[-2] in "aeiou":
        return name + "an"
    if name.endswith(("da", "ta")):
        return name[:-1] + "ian"
    if name.endswith(("a", "e")):
        return name + "n"
    if name.endswith(("y",)):
        return name[:-1] + "ian"
    if name.endswith(("s", "x")):
        return name + "ian"
    return name + "ian"


def state_name(rng: random.Random, family: str, base: str, adj: str | None = None) -> str:
    forms = STATE_FORMS.get(family, STATE_FORMS["democratic"])
    awkward = (" " in base or "'" in base or base.endswith("s") or "." in base) and not adj and base not in ADJ_EXCEPTIONS
    if awkward:
        forms = [f for f in forms if "{a}" not in f] or [f"{{n}} {forms[0].split()[-1]}"]
    fmt = rng.choice(forms)
    return fmt.format(n=base, a=adj or adjective(base))


def masthead(rng: random.Random, country_name: str, adj: str, year: int) -> str:
    if year < 1700:
        forms = ["The {a} Proclamation Scroll", "Courier of {n}", "The Town Crier of {n}"]
    elif year < 1950:
        forms = ["The {a} Herald", "{n} Daily Courier", "The {a} Gazette", "Morning Chronicle of {n}"]
    elif year < 2030:
        forms = ["The {a} Times", "{n} Today", "The {a} Observer", "{n} News Network"]
    elif year < 2200:
        forms = ["{a} Newsfeed", "{n}Stream", "The {a} Signal", "{n} Pulse"]
    elif year < 3000:
        forms = ["{a} Neural Broadcast", "The {a} Consensus Feed", "Lattice of {n}"]
    else:
        forms = ["The {a} Memory Weave", "Chorus-Record of {n}", "The {a} Continuum Archive"]
    return rng.choice(forms).format(a=adj, n=country_name)
