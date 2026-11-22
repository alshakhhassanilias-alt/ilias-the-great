"""Historical scenario data. Values are approximations drawn from standard references
(Maddison Project GDP per capita in 1990 GK$, contemporary army sizes, heads of government
at the scenario date). Everything listed here is ESTABLISHED HISTORY up to the start date."""

# Row format:
# tag | name | adjective | color | government | ideology | leader | title | born | traits(agg,cau,hon,amb,prag)
#     | owned modern codes | gdp per capita (1990 GK$) | stability | army(k) | navy | air | subject_of
S1936 = """
GER|Germany|German|#5b5b5b|Totalitarian Dictatorship|national_socialism|Adolf Hitler|Führer|1889|.95,.2,.1,1,.3|DEU|4450|70|800|150|2500|
GBR|United Kingdom|British|#c0392b|Constitutional Monarchy|conservatism|Stanley Baldwin|Prime Minister|1867|.2,.8,.7,.3,.7|GBR IND PAK BGD MMR LKA MDV MYS SGP BRN NGA GHA SLE GMB KEN UGA TZA ZMB MWI ZWE BWA LSO SWZ SDN SDS SOL ISR PSX JOR KWT BHR QAT ARE CYP CYN MLT GUY BLZ JAM TTO BHS BRB ATG DMA GRD KNA LCA VCT BMU CYM VGB AIA MSR TCA FJI SLB KIR TUV TON MUS SYC FLK SGS SHN PCN HKG IOA GGY JEY IMN KAS|5400|72|400|1200|1800|
FRA|France|French|#3b6fd8|Parliamentary Republic|liberal_democracy|Albert Sarraut|Président du Conseil|1872|.2,.8,.6,.3,.6|FRA DZA TUN MAR SEN MLI MRT NER BFA GIN CIV BEN TGO CMR TCD CAF COG GAB MDG COM DJI SYR LBN VNM LAO KHM NCL PYF WLF SPM ATF MCO AND|4400|55|650|500|2000|
ITA|Italy|Italian|#3a9d5d|Fascist Dictatorship|fascism|Benito Mussolini|Duce|1883|.8,.4,.3,.9,.5|ITA LBY ERI SOM SMR|3000|68|800|450|1500|
SOV|Soviet Union|Soviet|#a3001b|Socialist Union of Republics|communism|Joseph Stalin|General Secretary|1878|.6,.7,.2,.9,.8|RUS UKR BLR KAZ UZB TKM KGZ TJK GEO ARM AZE|2300|60|1300|200|7000|
USA|United States|American|#2a4d8f|Federal Presidential Republic|liberal_democracy|Franklin D. Roosevelt|President|1882|.3,.6,.7,.6,.9|USA PHL PRI GUM ASM VIR MNP|5500|70|300|1100|1500|
JPN|Japan|Japanese|#e0a3a3|Constitutional Empire (militarist cabinet)|militarist_statism|Kōki Hirota|Prime Minister|1878|.75,.45,.5,.8,.6|JPN KOR PRK TWN|2300|60|450|1000|2000|
CHN|China|Chinese|#d4b04c|Nationalist One-Party State|tridemism|Chiang Kai-shek|Generalissimo|1887|.5,.6,.5,.7,.7|CHN MAC|560|35|2000|30|300|
POL|Poland|Polish|#d65a7a|Authoritarian Republic (Sanation)|military_junta|Edward Rydz-Śmigły|Marshal of Poland|1886|.4,.6,.6,.5,.5|POL|1700|60|300|20|400|
ESP|Spain|Spanish|#e6c229|Parliamentary Republic|social_democracy|Manuel Azaña|Prime Minister|1880|.2,.4,.6,.5,.4|ESP GNQ SAH|2000|25|200|100|300|
PRT|Portugal|Portuguese|#1e8a4c|Corporatist Dictatorship (Estado Novo)|integralism|António de Oliveira Salazar|President of the Council|1889|.2,.9,.6,.3,.7|PRT AGO MOZ GNB CPV STP TLS|1600|70|60|40|100|
NLD|Netherlands|Dutch|#f08a24|Constitutional Monarchy|liberal_democracy|Hendrikus Colijn|Prime Minister|1869|.1,.8,.8,.2,.7|NLD IDN SUR CUW ABW SXM|5000|75|80|120|200|
BEL|Belgium|Belgian|#b39b2e|Constitutional Monarchy|liberal_democracy|Paul van Zeeland|Prime Minister|1893|.1,.8,.8,.2,.7|BEL COD RWA BDI|4600|70|100|5|200|
LUX|Luxembourg|Luxembourgish|#7fb3d5|Constitutional Monarchy|liberal_democracy|Joseph Bech|Prime Minister|1887|.05,.9,.8,.1,.8|LUX|5000|80|1|0|0|
CHE|Switzerland|Swiss|#e74c3c|Federal Republic|liberal_democracy|Albert Meyer|President of the Confederation|1870|.05,.95,.9,.1,.8|CHE LIE|6000|85|100|0|150|
AUT|Austria|Austrian|#f5f5f5|Federal State (Ständestaat)|fascism|Kurt Schuschnigg|Chancellor|1897|.2,.7,.6,.3,.5|AUT|3000|45|60|0|50|
CZS|Czechoslovakia|Czechoslovak|#4aa3df|Parliamentary Republic|liberal_democracy|Edvard Beneš|President|1884|.2,.7,.7,.3,.7|CZE SVK|2800|65|200|0|500|
HUN|Hungary|Hungarian|#5c8a3a|Regency|conservatism|Miklós Horthy|Regent|1868|.5,.5,.5,.6,.5|HUN|2700|60|80|0|100|
ROU|Romania|Romanian|#f4d03f|Constitutional Monarchy|constitutional_monarchy|Carol II|King|1893|.3,.5,.4,.5,.5|ROU MDA|1300|50|250|10|300|
YUG|Yugoslavia|Yugoslav|#6c5ce7|Kingdom (Regency)|constitutional_monarchy|Milan Stojadinović|Prime Minister|1888|.3,.6,.5,.4,.6|SRB HRV SVN BIH MNE MKD KOS|1300|45|150|20|300|
BGR|Bulgaria|Bulgarian|#2e7d32|Tsardom|constitutional_monarchy|Boris III|Tsar|1894|.4,.6,.5,.5,.6|BGR|1500|55|60|0|50|
GRC|Greece|Greek|#5dade2|Kingdom|conservatism|Ioannis Metaxas|Prime Minister|1871|.3,.6,.5,.4,.6|GRC|2200|45|70|60|60|
ALB|Albania|Albanian|#922b21|Kingdom|absolute_monarchy|Zog I|King|1895|.2,.7,.4,.4,.6|ALB|900|50|10|0|0|
TUR|Turkey|Turkish|#c0392b|Single-Party Republic|kemalism|Mustafa Kemal Atatürk|President|1881|.3,.6,.7,.6,.9|TUR|1600|70|150|50|150|
IRL|Ireland|Irish|#27ae60|Free State (Dominion)|conservatism|Éamon de Valera|President of the Executive Council|1882|.2,.6,.8,.4,.6|IRL|2900|70|10|0|0|
DNK|Denmark|Danish|#c0392b|Constitutional Monarchy|social_democracy|Thorvald Stauning|Prime Minister|1873|.05,.85,.8,.1,.8|DNK GRL FRO|5400|80|10|10|20|
NOR|Norway|Norwegian|#e8738a|Constitutional Monarchy|social_democracy|Johan Nygaardsvold|Prime Minister|1879|.05,.85,.8,.1,.8|NOR|4000|80|10|20|20|
SWE|Sweden|Swedish|#2471a3|Constitutional Monarchy|social_democracy|Per Albin Hansson|Prime Minister|1885|.05,.85,.8,.2,.8|SWE ALD|4500|82|60|60|150|
FIN|Finland|Finnish|#e8f4fc|Parliamentary Republic|conservatism|Pehr Evind Svinhufvud|President|1861|.2,.7,.7,.2,.6|FIN|3200|70|40|10|100|
EST|Estonia|Estonian|#2e86c1|Authoritarian Republic|conservatism|Konstantin Päts|State Elder|1874|.1,.8,.6,.2,.6|EST|3000|60|15|0|10|
LVA|Latvia|Latvian|#922b21|Authoritarian Republic|conservatism|Kārlis Ulmanis|Prime Minister|1877|.1,.8,.6,.2,.6|LVA|3000|60|20|0|10|
LTU|Lithuania|Lithuanian|#f1c40f|Authoritarian Republic|conservatism|Antanas Smetona|President|1874|.2,.7,.6,.3,.5|LTU|2000|60|25|0|10|
ISL|Iceland|Icelandic|#5dade2|Kingdom in Personal Union|liberal_democracy|Hermann Jónasson|Prime Minister|1896|.0,.9,.8,.1,.8|ISL|3500|85|0|0|0|
EGY|Egypt|Egyptian|#d4ac0d|Constitutional Monarchy|constitutional_monarchy|Fuad I|King|1868|.2,.6,.5,.4,.6|EGY|900|50|50|0|20|
SAU|Saudi Arabia|Saudi|#196f3d|Absolute Monarchy|theocracy|Abdulaziz ibn Saud|King|1875|.4,.6,.6,.6,.7|SAU|700|65|50|0|0|
YEM|Yemen|Yemeni|#a04000|Imamate|theocracy|Yahya Muhammad Hamid ed-Din|Imam|1869|.2,.8,.5,.3,.5|YEM|500|55|20|0|0|
OMN|Oman|Omani|#7b241c|Sultanate|absolute_monarchy|Said bin Taimur|Sultan|1910|.1,.8,.5,.2,.6|OMN|600|60|5|0|0|
IRQ|Iraq|Iraqi|#117a65|Constitutional Monarchy|constitutional_monarchy|Ghazi I|King|1912|.4,.4,.4,.5,.4|IRQ|900|45|25|0|20|
IRN|Iran|Iranian|#239b56|Imperial State|absolute_monarchy|Reza Shah Pahlavi|Shah|1878|.4,.6,.5,.7,.7|IRN|1000|60|100|5|50|
AFG|Afghanistan|Afghan|#6e2c00|Kingdom|absolute_monarchy|Mohammed Zahir Shah|King|1914|.2,.7,.6,.3,.5|AFG|600|50|60|0|0|
NPL|Nepal|Nepalese|#cb4335|Rana Autocracy|absolute_monarchy|Juddha Shumsher Rana|Prime Minister|1875|.1,.8,.6,.2,.6|NPL|500|60|25|0|0|
BTN|Bhutan|Bhutanese|#f39c12|Kingdom|absolute_monarchy|Jigme Wangchuck|King|1905|.0,.9,.7,.1,.6|BTN|450|70|2|0|0|
THA|Siam|Siamese|#1f618d|Constitutional Monarchy (military cabinet)|military_junta|Phraya Phahon|Prime Minister|1887|.3,.6,.5,.4,.7|THA|800|55|60|15|100|
MNG|Mongolia|Mongolian|#e67e22|People's Republic (Soviet satellite)|communism|Anandyn Amar|Prime Minister|1886|.1,.7,.5,.2,.5|MNG|600|50|15|0|20|SOV
TIB|Tibet|Tibetan|#f5b041|Theocratic Regency|theocracy|Reting Rinpoche|Regent|1912|.0,.9,.6,.1,.5||400|55|5|0|0|
MAN|Manchukuo|Manchukuoan|#d68910|Imperial State (Japanese puppet)|militarist_statism|Puyi|Emperor Kangde|1906|.1,.8,.3,.2,.4||900|45|150|0|50|JPN
CCP|Chinese Soviet Republic|Chinese Communist|#922b21|Revolutionary Soviet Base Area|communism|Mao Zedong|Chairman|1893|.5,.6,.6,.9,.9||450|60|40|0|0|
ETH|Ethiopia|Ethiopian|#28b463|Empire|absolute_monarchy|Haile Selassie|Emperor|1892|.3,.5,.8,.4,.6|ETH|450|40|150|0|5|
LBR|Liberia|Liberian|#2e4053|Republic|conservatism|Edwin Barclay|President|1882|.1,.7,.5,.2,.6|LBR|700|55|3|0|0|
ZAF|South Africa|South African|#d35400|Union (Dominion)|conservatism|J. B. M. Hertzog|Prime Minister|1866|.2,.6,.5,.4,.6|ZAF NAM|2600|65|20|5|100|
CAN|Canada|Canadian|#e74c3c|Dominion|liberal_democracy|W. L. Mackenzie King|Prime Minister|1874|.1,.8,.8,.2,.8|CAN|4100|78|10|10|50|
AUS|Australia|Australian|#16a085|Dominion|conservatism|Joseph Lyons|Prime Minister|1879|.1,.7,.8,.2,.8|AUS PNG NFK|5700|78|30|30|100|
NZL|New Zealand|New Zealand|#1a5276|Dominion|social_democracy|Michael Joseph Savage|Prime Minister|1872|.05,.8,.8,.2,.8|NZL WSM COK NIU|5700|80|5|5|20|
MEX|Mexico|Mexican|#148f77|Federal Republic|social_democracy|Lázaro Cárdenas|President|1895|.2,.6,.7,.5,.7|MEX|1700|60|60|5|60|
GTM|Guatemala|Guatemalan|#5499c7|Republic (dictatorship)|military_junta|Jorge Ubico|President|1878|.2,.7,.4,.3,.5|GTM|1400|60|10|0|5|
HND|Honduras|Honduran|#2980b9|Republic (dictatorship)|military_junta|Tiburcio Carías Andino|President|1876|.2,.7,.4,.3,.5|HND|1100|55|5|0|0|
SLV|El Salvador|Salvadoran|#1f618d|Republic (dictatorship)|military_junta|Maximiliano Hernández Martínez|President|1882|.2,.7,.4,.3,.5|SLV|1100|55|5|0|0|
NIC|Nicaragua|Nicaraguan|#5dade2|Republic|conservatism|Juan Bautista Sacasa|President|1874|.1,.6,.5,.2,.5|NIC|1000|40|5|0|0|
CRI|Costa Rica|Costa Rican|#2874a6|Republic|liberal_democracy|León Cortés Castro|President|1882|.0,.8,.8,.2,.7|CRI|1700|75|1|0|0|
PAN|Panama|Panamanian|#cd6155|Republic|liberal_democracy|Harmodio Arias Madrid|President|1886|.0,.7,.6,.2,.7|PAN|1800|60|2|0|0|
CUB|Cuba|Cuban|#2e86c1|Republic|military_junta|Fulgencio Batista|Chief of the Army|1901|.3,.5,.3,.6,.7|CUB|1900|45|20|5|10|
DOM|Dominican Republic|Dominican|#1b4f72|Republic (dictatorship)|military_junta|Rafael Trujillo|President|1891|.3,.6,.2,.6,.5|DOM|1000|60|10|1|5|
HTI|Haiti|Haitian|#21618c|Republic|conservatism|Sténio Vincent|President|1874|.1,.6,.4,.2,.5|HTI|800|45|3|0|0|
COL|Colombia|Colombian|#f4d03f|Republic|liberal_democracy|Alfonso López Pumarejo|President|1886|.1,.7,.7,.3,.7|COL|1800|60|20|5|20|
VEN|Venezuela|Venezuelan|#b9770e|Republic|conservatism|Eleazar López Contreras|President|1883|.1,.6,.6,.3,.7|VEN|2500|55|15|5|10|
ECU|Ecuador|Ecuadorian|#f7dc6f|Republic|conservatism|Federico Páez|Supreme Chief|1880|.1,.6,.5,.3,.5|ECU|1300|35|10|2|5|
PER|Peru|Peruvian|#e74c3c|Republic|military_junta|Óscar R. Benavides|President|1876|.2,.6,.5,.3,.6|PER|1500|55|25|10|30|
BOL|Bolivia|Bolivian|#27ae60|Republic|military_junta|David Toro|President|1898|.2,.5,.4,.4,.5|BOL|1000|35|20|0|10|
CHL|Chile|Chilean|#c0392b|Republic|conservatism|Arturo Alessandri|President|1868|.1,.7,.7,.3,.7|CHL|3400|65|25|30|30|
ARG|Argentina|Argentine|#85c1e9|Republic|conservatism|Agustín P. Justo|President|1876|.2,.6,.5,.4,.7|ARG|3900|65|40|60|80|
URY|Uruguay|Uruguayan|#aed6f1|Republic|conservatism|Gabriel Terra|President|1873|.1,.6,.5,.2,.6|URY|4000|60|8|2|5|
PRY|Paraguay|Paraguayan|#cb4335|Republic|military_junta|Rafael Franco|President|1896|.3,.4,.4,.4,.5|PRY|1200|35|20|1|5|
BRA|Brazil|Brazilian|#229954|Federal Republic|military_junta|Getúlio Vargas|President|1882|.2,.7,.4,.6,.9|BRA|1200|55|80|40|80|
"""

# Province-level ownership overrides (province name, modern code) -> tag
OVR1936 = [
    ("Lower Silesian", "POL", "GER"), ("West Pomeranian", "POL", "GER"), ("Silesian", "POL", "GER"),
    ("Kaliningrad", "RUS", "GER"), ("L'viv", "UKR", "POL"), ("Volyn", "UKR", "POL"), ("Brest", "BLR", "POL"),
    ("Grodno", "BLR", "POL"), ("Vilniaus", "LTU", "POL"), ("Heilongjiang", "CHN", "MAN"), ("Jilin", "CHN", "MAN"),
    ("Liaoning", "CHN", "MAN"), ("Xizang", "CHN", "TIB"), ("Shaanxi", "CHN", "CCP"), ("Ningxia", "CHN", "CCP"),
    ("Tanger - Tétouan", "MAR", "ESP"), ("Laâyoune - Boujdour - Sakia El Hamra", "MAR", "ESP"), ("Oued el Dahab", "MAR", "ESP"),
    ("Sakhalin", "RUS", "SOV"),
]

# Population at start for the scenario in millions (modern-border approximations), by modern code
POP1936 = {"DEU": 61, "GBR": 47, "FRA": 41.5, "ITA": 42.5, "USA": 128, "JPN": 69, "RUS": 105, "UKR": 31, "BLR": 9, "CHN": 500,
           "IND": 290, "PAK": 30, "BGD": 40, "POL": 25, "ESP": 25, "BRA": 38, "MEX": 19, "IDN": 65, "KOR": 14, "PRK": 8,
           "TUR": 16.5, "EGY": 16, "IRN": 14, "CAN": 11, "AUS": 6.8, "ARG": 12.8, "NGA": 20, "ETH": 11, "VNM": 18, "PHL": 15,
           "THA": 14, "CZE": 10.6, "SVK": 3.3, "ROU": 16, "HUN": 9, "AUT": 6.8, "NLD": 8.5, "BEL": 8.3, "SWE": 6.2, "MMR": 15}

# Historical claims at start: tag -> list of (province name, modern code) or modern codes
CLAIMS1936 = {
    "GER": ["AUT", ("Karlovarský", "CZE"), ("Pomeranian", "POL"), ("Greater Poland", "POL"), ("Grand Est", "FRA"), ("Klaipedos", "LTU")],
    "HUN": ["SVK", ("Transylvania", "ROU")],
    "ITA": [("Corse", "FRA"), ("Provence-Alpes-Côte-d'Azur", "FRA"), "ALB", "TUN"],
    "SOV": [("L'viv", "UKR"), ("Volyn", "UKR"), ("Brest", "BLR"), ("Grodno", "BLR"), "EST", "LVA", "LTU", "MDA", "FIN"],
    "CHN": [("Heilongjiang", "CHN"), ("Jilin", "CHN"), ("Liaoning", "CHN"), ("Xizang", "CHN"), ("Shaanxi", "CHN"), ("Ningxia", "CHN"), "TWN"],
    "JPN": [("Hebei", "CHN"), ("Shandong", "CHN"), ("Shanghai", "CHN"), ("Inner Mongol", "CHN")],
    "LTU": [("Vilniaus", "LTU")],
    "BGR": [("Dobrich", "BGR")],
    "ETH": ["ERI"],
    "CCP": ["CHN"],
}

MEM1936 = [
    # (country, other, year, kind, weight, text)
    ("GER", "FRA", 1919, "treaty_imposed", -40, "The Treaty of Versailles imposed war guilt, reparations and the loss of Alsace-Lorraine."),
    ("GER", "GBR", 1919, "treaty_imposed", -25, "Britain co-authored the Versailles settlement and the naval restrictions."),
    ("GER", "POL", 1919, "territory_lost", -35, "Posen and West Prussia were ceded to the resurrected Polish state, creating the Danzig Corridor."),
    ("GER", "FRA", 1923, "invasion", -30, "French and Belgian troops occupied the Ruhr to seize reparations."),
    ("FRA", "GER", 1914, "invasion", -45, "German armies invaded France in 1914; the Western Front devastated the north."),
    ("FRA", "GER", 1871, "defeat", -30, "Defeat in the Franco-Prussian War and the loss of Alsace-Lorraine (recovered 1918)."),
    ("FRA", "GBR", 1914, "cooperation", 30, "The Entente Cordiale fought together through the Great War."),
    ("GBR", "FRA", 1914, "cooperation", 30, "Britain and France were allies through the Great War."),
    ("GBR", "GER", 1914, "war", -20, "The Great War against the German Empire cost nearly a million British lives."),
    ("POL", "GER", 1795, "territory_lost", -30, "Prussia took part in the partitions that erased Poland for 123 years."),
    ("POL", "SOV", 1795, "territory_lost", -30, "Russia annexed the largest share of partitioned Poland."),
    ("POL", "SOV", 1920, "victory", -20, "The Red Army was turned back at the gates of Warsaw in 1920."),
    ("SOV", "POL", 1920, "defeat", -25, "The Soviet advance on Warsaw ended in defeat and the Treaty of Riga."),
    ("SOV", "GBR", 1918, "interference", -25, "British forces intervened against the revolution in the Russian Civil War."),
    ("SOV", "JPN", 1918, "interference", -25, "Japan occupied the Russian Far East during the Civil War."),
    ("SOV", "JPN", 1905, "defeat", -20, "Imperial Russia lost the Russo-Japanese War."),
    ("JPN", "SOV", 1905, "victory", -5, "Victory over Russia in 1905 made Japan a great power."),
    ("JPN", "USA", 1924, "interference", -20, "The US Immigration Act excluded Japanese immigrants."),
    ("JPN", "GBR", 1919, "interference", -15, "The Racial Equality Proposal was rejected at Versailles."),
    ("CHN", "JPN", 1931, "invasion", -50, "Japan seized Manchuria after the Mukden Incident and installed Manchukuo."),
    ("CHN", "JPN", 1895, "defeat", -25, "Defeat in the First Sino-Japanese War cost China Taiwan."),
    ("CHN", "GBR", 1842, "treaty_imposed", -20, "The Opium Wars and unequal treaties began China's 'century of humiliation'."),
    ("ETH", "ITA", 1935, "invasion", -60, "Italy invaded Ethiopia in October 1935, using poison gas."),
    ("ETH", "ITA", 1896, "victory", -10, "Ethiopia defeated Italy at Adwa in 1896."),
    ("ITA", "ETH", 1896, "defeat", -25, "The humiliation of Adwa still drives Italian ambitions in East Africa."),
    ("ITA", "FRA", 1919, "betrayal", -15, "Italy's 'mutilated victory': promised territories were denied at Versailles."),
    ("ITA", "GBR", 1935, "interference", -15, "League sanctions, led by Britain, were imposed over Ethiopia."),
    ("HUN", "ROU", 1920, "territory_lost", -40, "The Treaty of Trianon gave Transylvania to Romania."),
    ("HUN", "CZS", 1920, "territory_lost", -35, "Trianon gave Upper Hungary (Slovakia) to Czechoslovakia."),
    ("HUN", "YUG", 1920, "territory_lost", -25, "Trianon gave Vojvodina and Croatia to Yugoslavia."),
    ("TUR", "GRC", 1922, "victory", -15, "The War of Independence expelled Greek armies from Anatolia."),
    ("GRC", "TUR", 1922, "defeat", -35, "The Asia Minor Catastrophe and the burning of Smyrna."),
    ("TUR", "GBR", 1915, "victory", -10, "The defence of Gallipoli against the Allied landings."),
    ("IRL", "GBR", 1921, "independence", -30, "The War of Independence won Irish self-government, at the cost of partition."),
    ("LTU", "POL", 1920, "territory_lost", -40, "Poland seized Vilnius, Lithuania's historic capital."),
    ("AUT", "GER", 1919, "cooperation", 15, "Union with Germany was forbidden by the peace treaties."),
    ("USA", "GBR", 1917, "cooperation", 15, "The US fought alongside Britain in 1917-18."),
    ("BGR", "ROU", 1913, "territory_lost", -20, "Southern Dobruja was lost in the Second Balkan War."),
    ("CCP", "CHN", 1927, "betrayal", -45, "The Shanghai massacre broke the first United Front."),
    ("CHN", "CCP", 1934, "war", -30, "The encirclement campaigns drove the Communists on the Long March."),
]

ORGS1936 = [
    ("league", "League of Nations", "international", 1920, "GBR FRA ITA SOV CHN POL ESP PRT NLD BEL LUX CHE AUT CZS HUN ROU YUG BGR GRC ALB TUR IRL DNK NOR SWE FIN EST LVA LTU IRQ IRN AFG THA ETH LBR ZAF CAN AUS NZL MEX GTM HND SLV NIC PAN CUB DOM HTI COL VEN ECU PER BOL CHL ARG URY PRY", "Collective security organisation founded after the Great War; weakened by the departures of Germany and Japan."),
    ("commonwealth", "British Commonwealth", "commonwealth", 1931, "GBR CAN AUS NZL ZAF IRL", "Free association of the self-governing dominions under the Crown (Statute of Westminster)."),
    ("little_entente", "Little Entente", "alliance", 1920, "CZS ROU YUG", "Alliance against Hungarian revisionism, backed by France."),
    ("balkan_pact", "Balkan Pact", "alliance", 1934, "YUG GRC TUR ROU", "Mutual guarantee of Balkan borders."),
    ("rome_protocols", "Rome Protocols", "bloc", 1934, "ITA AUT HUN", "Italian-led consultative bloc in the Danube basin."),
]
TREATIES1936 = [
    ("alliance", ["FRA", "POL"], 1921, "Franco-Polish Alliance"),
    ("alliance", ["FRA", "CZS"], 1924, "Franco-Czechoslovak Treaty of Alliance"),
    ("defensive_pact", ["FRA", "SOV"], 1935, "Franco-Soviet Treaty of Mutual Assistance"),
    ("defensive_pact", ["SOV", "CZS"], 1935, "Soviet-Czechoslovak Treaty"),
    ("non_aggression", ["GER", "POL"], 1934, "German-Polish Declaration of Non-Aggression"),
    ("alliance", ["GBR", "EGY"], 1936, "Anglo-Egyptian Treaty"),
    ("defensive_pact", ["SOV", "MNG"], 1936, "Soviet-Mongolian Protocol of Mutual Assistance"),
    ("alliance", ["GBR", "FRA"], 1904, "Entente Cordiale"),
    ("alliance", ["GBR", "PRT"], 1373, "Anglo-Portuguese Alliance"),
    ("trade", ["GBR", "CAN"], 1932, "Imperial Preference (Ottawa Agreements)"),
    ("trade", ["GBR", "AUS"], 1932, "Imperial Preference (Ottawa Agreements)"),
    ("non_aggression", ["CHN", "CCP"], 1936, "Truce of the Second United Front"),
]
WARS1936 = [
    ("Second Italo-Ethiopian War", ["ITA"], ["ETH"], 1935, "conquest", 45),
]
BACK1936 = {
    "_world": "March 1936. The Great Depression has shattered the liberal economic order. Germany, rearming openly under Adolf Hitler, has repudiated the military clauses of Versailles; its army now stands ready to march into the demilitarised Rhineland. Fascist Italy is completing its brutal conquest of Ethiopia while the League of Nations proves powerless. In the east, Japan rules Manchuria through the puppet state of Manchukuo and eyes northern China, where Chiang Kai-shek's Nationalists remain locked in civil war with Mao's Communists. Stalin's Soviet Union industrialises at a terrible human cost. Britain and France, war-weary and economically wounded, cling to appeasement, while the United States remains committed to neutrality.",
    "GER": "Unified in 1871 under Prussian leadership, the German Empire lost the Great War and became the Weimar Republic, burdened by reparations, hyperinflation (1923) and the Depression. In 1933 Hitler's National Socialists took power and dismantled democracy. Germany left the League of Nations, reintroduced conscription (1935) and seeks to overturn the Versailles settlement.",
    "GBR": "Ruler of the largest empire in history, Britain emerged from the Great War victorious but indebted. The Statute of Westminster (1931) made the dominions sovereign. Rising Indian nationalism, imperial overstretch and the Depression shape a cautious policy of rearmament balanced with appeasement.",
    "FRA": "Victor of the Great War at the cost of 1.4 million dead, France built the Maginot Line and a web of eastern alliances to contain Germany. The Third Republic is politically unstable; left and right clash in the streets, and the Popular Front is gaining ground.",
    "ITA": "Unified in 1861, Italy fought with the Allies in 1915-18 but felt cheated of its promised gains. Mussolini's Fascists seized power in 1922. Dreaming of a new Roman Empire, Italy invaded Ethiopia in 1935 in defiance of the League.",
    "SOV": "Born from the 1917 revolution and civil war, the Soviet Union under Stalin is undergoing forced industrialisation and collectivisation. The Five-Year Plans have built heavy industry, while famine and terror have killed millions. Moscow champions collective security against fascism through the Comintern.",
    "USA": "The world's largest economy is recovering under Roosevelt's New Deal. Isolationist sentiment is strong: the Neutrality Acts bar arms sales to belligerents. The US Navy is second to none in the Pacific, where friction with Japan grows.",
    "JPN": "Modernised after the Meiji Restoration (1868), Japan defeated China (1895) and Russia (1905) and annexed Korea (1910). The Depression strengthened militarists; the army seized Manchuria in 1931. A failed military coup in February 1936 has left the army even more dominant in politics.",
    "CHN": "The Republic of China, founded in 1912, fragmented among warlords before Chiang Kai-shek's Northern Expedition (1926-28) nominally reunified it. China has lost Manchuria to Japan and fights a civil war against the Communists, who survived the Long March.",
    "POL": "Reborn in 1918 after 123 years of partition, Poland defeated the Red Army in 1920. Governed by Piłsudski's Sanation regime (Piłsudski died in 1935), it balances between Germany and the Soviet Union.",
    "ESP": "Spain's Second Republic (1931) is deeply polarised. The Popular Front won the February 1936 elections; conservative generals are plotting.",
    "CZS": "Founded in 1918 from the ruins of Austria-Hungary, Czechoslovakia is central Europe's most stable democracy and an industrial powerhouse, but its large German minority in the Sudetenland is a growing source of tension.",
    "ETH": "One of only two African states never colonised, Ethiopia defeated Italy at Adwa in 1896. In October 1935 Italy invaded again; Emperor Haile Selassie's armies are being overwhelmed.",
    "CCP": "Having survived the Long March (1934-35), the Chinese Communist Party has established its base at Yan'an in Shaanxi under Mao Zedong.",
    "TUR": "Founded in 1923 from the ruins of the Ottoman Empire, Atatürk's Republic is rapidly secularising and modernising.",
    "MAN": "A puppet state created by Japan in 1932 in occupied Manchuria, nominally ruled by Puyi, the last Qing emperor.",
}
HOOKS1936 = [
    # year, month, id, title, condition key, description
    (1936, 3, "rhineland", "Remilitarisation of the Rhineland", "GER", "German troops can march into the demilitarised Rhineland in defiance of Versailles and Locarno."),
    (1936, 7, "spanish_civil_war", "Spanish Civil War", "ESP", "Nationalist generals rise against the Republic."),
    (1936, 11, "anti_comintern", "Anti-Comintern Pact", "GER", "Germany and Japan sign a pact against the Communist International."),
    (1937, 7, "marco_polo", "Marco Polo Bridge Incident", "JPN", "A skirmish near Beijing escalates into full-scale war between Japan and China."),
    (1938, 3, "anschluss", "Anschluss", "GER", "Germany moves to annex Austria."),
    (1938, 9, "sudeten", "Sudeten Crisis", "GER", "Germany demands the Sudetenland from Czechoslovakia."),
    (1939, 8, "nazi_soviet", "Pact with the Soviet Union", "GER", "Germany and the Soviet Union consider a non-aggression pact with secret protocols."),
    (1939, 9, "invasion_poland", "The Polish Question", "GER", "Germany's demands over Danzig and the Corridor reach breaking point."),
]

S1914 = """
GER|German Empire|German|#5b5b5b|Constitutional Empire|constitutional_monarchy|Wilhelm II|Kaiser|1859|.7,.4,.5,.8,.4|DEU|3650|70|800|400|50|
AUH|Austria-Hungary|Austro-Hungarian|#e8d6a0|Dual Monarchy|absolute_monarchy|Franz Joseph I|Emperor-King|1830|.5,.6,.6,.4,.4|AUT HUN CZE SVK SVN HRV BIH|2800|45|450|80|10|
RUS|Russian Empire|Russian|#3d7a3d|Autocracy|absolute_monarchy|Nicholas II|Tsar|1868|.5,.5,.6,.6,.3|RUS UKR BLR FIN EST LVA LTU MDA KAZ UZB TKM KGZ TJK GEO ARM AZE|1500|40|1300|200|20|
GBR|United Kingdom|British|#c0392b|Constitutional Monarchy|liberal_democracy|H. H. Asquith|Prime Minister|1852|.3,.6,.7,.4,.7|GBR IRL IND PAK BGD MMR LKA MYS SGP NGA GHA SLE GMB KEN UGA ZMB MWI ZWE BWA LSO SWZ SDN SDS SOL EGY CYP MLT GUY BLZ JAM TTO BHS FJI KWT BHR QAT ARE HKG|4900|65|250|1500|10|
FRA|France|French|#3b6fd8|Parliamentary Republic|liberal_democracy|René Viviani|Président du Conseil|1863|.4,.5,.6,.5,.6|FRA DZA TUN MAR SEN MLI MRT NER BFA GIN CIV BEN CMR TCD CAF COG GAB MDG COM DJI VNM LAO KHM NCL PYF|3500|60|800|600|20|
ITA|Italy|Italian|#3a9d5d|Constitutional Monarchy|liberal_democracy|Antonio Salandra|Prime Minister|1853|.4,.5,.4,.6,.7|ITA LBY ERI SOM|2550|55|300|250|10|
OTT|Ottoman Empire|Ottoman|#7b241c|Constitutional Sultanate (CUP junta)|military_junta|Enver Pasha|Minister of War|1881|.7,.3,.4,.8,.4|TUR SYR IRQ LBN ISR PSX JOR|1100|35|300|40|0|
USA|United States|American|#2a4d8f|Federal Presidential Republic|liberal_democracy|Woodrow Wilson|President|1856|.2,.6,.8,.5,.6|USA PHL PRI GUM|5300|70|100|800|10|
JPN|Japan|Japanese|#e0a3a3|Constitutional Empire|constitutional_monarchy|Ōkuma Shigenobu|Prime Minister|1838|.6,.5,.5,.7,.7|JPN KOR PRK TWN|1400|65|250|500|0|
CHN|China|Chinese|#d4b04c|Republic (Beiyang Government)|military_junta|Yuan Shikai|President|1859|.4,.5,.3,.8,.6|CHN MNG|550|30|500|20|0|
SRB|Serbia|Serbian|#6c5ce7|Kingdom|constitutional_monarchy|Nikola Pašić|Prime Minister|1845|.6,.4,.5,.7,.6|SRB MKD KOS MNE|1100|60|200|0|0|
BEL|Belgium|Belgian|#b39b2e|Constitutional Monarchy|liberal_democracy|Charles de Broqueville|Prime Minister|1860|.1,.8,.8,.2,.7|BEL COD|4200|70|120|0|0|
NLD|Netherlands|Dutch|#f08a24|Constitutional Monarchy|liberal_democracy|Pieter Cort van der Linden|Prime Minister|1846|.1,.8,.8,.2,.7|NLD IDN SUR|4000|75|100|60|0|
ESP|Spain|Spanish|#e6c229|Constitutional Monarchy|conservatism|Eduardo Dato|Prime Minister|1856|.1,.7,.5,.3,.6|ESP SAH GNQ|2200|50|150|60|0|
PRT|Portugal|Portuguese|#1e8a4c|Republic|liberal_democracy|Bernardino Machado|Prime Minister|1851|.2,.5,.5,.3,.5|PRT AGO MOZ GNB CPV|1250|35|50|20|0|
ROU|Romania|Romanian|#f4d03f|Kingdom|constitutional_monarchy|Ion I. C. Brătianu|Prime Minister|1864|.3,.6,.4,.5,.7|ROU|1700|55|300|5|0|
BGR|Bulgaria|Bulgarian|#2e7d32|Tsardom|constitutional_monarchy|Ferdinand I|Tsar|1861|.5,.4,.3,.6,.5|BGR|1500|50|200|0|0|
GRC|Greece|Greek|#5dade2|Kingdom|constitutional_monarchy|Eleftherios Venizelos|Prime Minister|1864|.4,.5,.6,.6,.7|GRC|1600|55|120|40|0|
ALB|Albania|Albanian|#922b21|Principality|absolute_monarchy|Wilhelm of Wied|Prince|1876|.1,.6,.5,.2,.3|ALB|800|20|5|0|0|
SWE|Sweden|Swedish|#2471a3|Constitutional Monarchy|liberal_democracy|Hjalmar Hammarskjöld|Prime Minister|1862|.05,.8,.8,.2,.8|SWE|3100|80|80|40|0|
NOR|Norway|Norwegian|#e8738a|Constitutional Monarchy|liberal_democracy|Gunnar Knudsen|Prime Minister|1848|.05,.8,.8,.2,.8|NOR|2500|80|20|10|0|
DNK|Denmark|Danish|#c0392b|Constitutional Monarchy|liberal_democracy|Carl Theodor Zahle|Prime Minister|1866|.05,.8,.8,.2,.8|DNK ISL GRL FRO|3900|80|20|10|0|
CHE|Switzerland|Swiss|#e74c3c|Federal Republic|liberal_democracy|Arthur Hoffmann|President of the Confederation|1857|.05,.95,.9,.1,.8|CHE|4300|85|100|0|0|
PER|Persia|Persian|#239b56|Qajar Monarchy|absolute_monarchy|Ahmad Shah Qajar|Shah|1898|.1,.6,.4,.3,.4|IRN|900|30|30|0|0|
AFG|Afghanistan|Afghan|#6e2c00|Emirate|absolute_monarchy|Habibullah Khan|Emir|1872|.2,.7,.5,.3,.5|AFG|600|50|40|0|0|
SIA|Siam|Siamese|#1f618d|Absolute Monarchy|absolute_monarchy|Vajiravudh|King|1881|.1,.7,.6,.3,.7|THA|800|65|50|5|0|
ETH|Ethiopia|Ethiopian|#28b463|Empire|absolute_monarchy|Lij Iyasu|Emperor|1895|.3,.5,.4,.5,.4|ETH|400|35|150|0|0|
LBR|Liberia|Liberian|#2e4053|Republic|conservatism|Daniel E. Howard|President|1861|.1,.7,.5,.2,.6|LBR|600|50|2|0|0|
ZAF|South Africa|South African|#d35400|Union (Dominion)|conservatism|Louis Botha|Prime Minister|1862|.2,.6,.6,.4,.7|ZAF|2000|60|20|0|0|
CAN|Canada|Canadian|#e74c3c|Dominion|conservatism|Robert Borden|Prime Minister|1854|.2,.7,.8,.3,.7|CAN|4400|75|3|5|0|
AUS|Australia|Australian|#16a085|Dominion|social_democracy|Joseph Cook|Prime Minister|1860|.2,.7,.8,.3,.7|AUS PNG|5700|75|5|20|0|
NZL|New Zealand|New Zealand|#1a5276|Dominion|conservatism|William Massey|Prime Minister|1856|.1,.7,.8,.2,.7|NZL|5100|80|2|2|0|
MEX|Mexico|Mexican|#148f77|Republic (revolutionary)|military_junta|Victoriano Huerta|President|1850|.5,.3,.2,.6,.4|MEX|1700|20|100|5|0|
BRA|Brazil|Brazilian|#229954|Federal Republic|conservatism|Hermes da Fonseca|President|1855|.2,.6,.5,.3,.6|BRA|800|55|30|30|0|
ARG|Argentina|Argentine|#85c1e9|Republic|conservatism|Victorino de la Plaza|President|1840|.1,.7,.6,.3,.7|ARG|4000|65|20|40|0|
CHL|Chile|Chilean|#c0392b|Republic|conservatism|Ramón Barros Luco|President|1835|.1,.7,.6,.3,.7|CHL|3000|65|20|30|0|
"""
OVR1914 = [("Masovian", "POL", "RUS"), ("Podlachian", "POL", "RUS"), ("Subcarpathian", "POL", "AUH"),
           ("Silesian", "POL", "GER"), ("Lower Silesian", "POL", "GER"), ("West Pomeranian", "POL", "GER"), ("Pomeranian", "POL", "GER"),
           ("Greater Poland", "POL", "GER"), ("Grand Est", "FRA", "GER"), ("L'viv", "UKR", "AUH"), ("Kaliningrad", "RUS", "GER")]
MEM1914 = [
    ("FRA", "GER", 1871, "territory_lost", -50, "Alsace-Lorraine was annexed by Germany after the Franco-Prussian War."),
    ("GER", "FRA", 1871, "victory", -10, "Victory over France forged the German Empire at Versailles."),
    ("SRB", "AUH", 1908, "territory_lost", -40, "Austria-Hungary annexed Bosnia, home to many Serbs."),
    ("AUH", "SRB", 1908, "interference", -30, "Belgrade backs South Slav nationalism inside the Habsburg lands."),
    ("RUS", "JPN", 1905, "defeat", -30, "Defeat by Japan humiliated the Tsarist autocracy."),
    ("BGR", "SRB", 1913, "defeat", -35, "The Second Balkan War stripped Bulgaria of Macedonia."),
    ("OTT", "ITA", 1912, "territory_lost", -30, "Italy seized Libya and the Dodecanese."),
    ("OTT", "SRB", 1913, "territory_lost", -30, "The First Balkan War expelled the Ottomans from most of Europe."),
    ("GBR", "GER", 1906, "interference", -15, "The naval arms race with Germany alarmed Britain."),
]
CLAIMS1914 = {"FRA": [("Grand Est", "FRA")], "SRB": ["BIH", "HRV", "SVN"], "ITA": [("Tirol", "AUT"), "SVN"], "BGR": ["MKD"], "ROU": [("Transylvania", "ROU")]}
ORGS1914 = [("triple_entente", "Triple Entente", "alliance", 1907, "GBR FRA RUS", "Informal understanding between Britain, France and Russia."),
            ("triple_alliance", "Triple Alliance", "alliance", 1882, "GER AUH ITA", "Defensive alliance of the Central Powers (Italy's loyalty is doubtful).")]
TREATIES1914 = [("alliance", ["GER", "AUH"], 1879, "Dual Alliance"), ("alliance", ["FRA", "RUS"], 1894, "Franco-Russian Alliance"),
                ("guarantee", ["GBR", "BEL"], 1839, "Treaty of London (Belgian neutrality)"), ("alliance", ["RUS", "SRB"], 1912, "Russian protection of Serbia"),
                ("alliance", ["GBR", "JPN"], 1902, "Anglo-Japanese Alliance")]
BACK1914 = {"_world": "June 1914. Europe stands at the summit of its power: its empires rule most of the globe and its industries power the world economy. Beneath the surface, two armed blocs face each other - the Triple Entente of Britain, France and Russia and the Triple Alliance of Germany, Austria-Hungary and Italy. The Balkans, freshly reshaped by two wars, seethe with nationalism. On 28 June the heir to the Habsburg throne is due to visit Sarajevo.",
            "GER": "Forged in 1871 under Bismarck, the German Empire is Europe's foremost industrial and military power, locked in a naval race with Britain and fearing encirclement by France and Russia.",
            "AUH": "The multinational Habsburg monarchy is strained by the nationalisms of its peoples, above all the South Slavs encouraged by Serbia.",
            "RUS": "The Tsarist autocracy survived the 1905 revolution and is rapidly industrialising and rearming, posing as protector of the Slavs.",
            "OTT": "The 'sick man of Europe' has lost almost all its Balkan lands; the Young Turk triumvirate seeks German backing for a revival."}
WARS1914 = []
HOOKS1914 = [(1914, 6, "sarajevo", "Assassination in Sarajevo", "AUH", "Archduke Franz Ferdinand is assassinated; Vienna considers an ultimatum to Serbia.")]

S1962 = """
USA|United States|American|#2a4d8f|Federal Presidential Republic|liberal_democracy|John F. Kennedy|President|1917|.4,.6,.7,.6,.8|USA PRI GUM VIR ASM|13400|75|2800|4000|15000|
SOV|Soviet Union|Soviet|#a3001b|Socialist Union of Republics|communism|Nikita Khrushchev|First Secretary|1894|.6,.4,.4,.8,.6|RUS UKR BLR EST LVA LTU MDA KAZ UZB TKM KGZ TJK GEO ARM AZE|5500|65|3600|1500|10000|
GBR|United Kingdom|British|#c0392b|Constitutional Monarchy|conservatism|Harold Macmillan|Prime Minister|1894|.2,.7,.7,.3,.8|GBR KEN ZMB MWI ZWE BWA LSO SWZ SOL MLT GUY BLZ BHS BRB HKG FJI ADN|8500|70|450|1200|1500|
FRA|France|French|#3b6fd8|Semi-Presidential Republic|conservatism|Charles de Gaulle|President|1890|.3,.6,.8,.7,.7|FRA DJI NCL PYF COM|8400|65|700|400|1200|
FRG|West Germany|West German|#5b5b5b|Federal Parliamentary Republic|conservatism|Konrad Adenauer|Chancellor|1876|.1,.8,.8,.3,.8|DEU|8700|80|400|50|800|
GDR|East Germany|East German|#8c1c1c|Socialist Single-Party State|communism|Walter Ulbricht|First Secretary|1893|.4,.7,.2,.4,.5||5000|55|100|10|300|SOV
CHN|People's Republic of China|Chinese|#d4b04c|Socialist Single-Party State|communism|Mao Zedong|Chairman|1893|.6,.4,.4,.9,.5|CHN|550|45|2500|100|2000|
TWN|Republic of China (Taiwan)|Taiwanese|#2e86c1|Nationalist One-Party State|tridemism|Chiang Kai-shek|President|1887|.4,.7,.5,.6,.6|TWN|1500|65|600|50|400|
JPN|Japan|Japanese|#e0a3a3|Constitutional Monarchy|conservatism|Hayato Ikeda|Prime Minister|1899|.05,.8,.8,.3,.9|JPN|6000|80|200|50|400|
IND|India|Indian|#f39c12|Federal Parliamentary Republic|social_democracy|Jawaharlal Nehru|Prime Minister|1889|.2,.6,.8,.5,.6|IND KAS|750|65|550|30|500|
PAK|Pakistan|Pakistani|#1e8449|Military Republic|military_junta|Ayub Khan|President|1907|.4,.6,.4,.5,.6|PAK BGD|800|55|250|10|200|
ITA|Italy|Italian|#3a9d5d|Parliamentary Republic|conservatism|Amintore Fanfani|Prime Minister|1908|.1,.8,.7,.3,.8|ITA SMR|7000|65|300|150|500|
POL|Poland|Polish|#d65a7a|Socialist Single-Party State|communism|Władysław Gomułka|First Secretary|1905|.2,.7,.4,.3,.6|POL|3600|60|250|20|500|SOV
CZS|Czechoslovakia|Czechoslovak|#4aa3df|Socialist Single-Party State|communism|Antonín Novotný|First Secretary|1904|.1,.8,.4,.2,.6|CZE SVK|6300|60|180|0|400|SOV
HUN|Hungary|Hungarian|#5c8a3a|Socialist Single-Party State|communism|János Kádár|First Secretary|1912|.1,.8,.4,.2,.8|HUN|4800|55|100|0|200|SOV
ROU|Romania|Romanian|#f4d03f|Socialist Single-Party State|communism|Gheorghe Gheorghiu-Dej|First Secretary|1901|.2,.7,.4,.4,.7|ROU|2800|60|200|10|200|
BGR|Bulgaria|Bulgarian|#2e7d32|Socialist Single-Party State|communism|Todor Zhivkov|First Secretary|1911|.1,.8,.4,.2,.6|BGR|3500|65|120|5|150|SOV
YUG|Yugoslavia|Yugoslav|#6c5ce7|Socialist Federal Republic|communism|Josip Broz Tito|President|1892|.3,.6,.6,.6,.9|SRB HRV SVN BIH MNE MKD KOS|3000|70|250|20|300|
CUB|Cuba|Cuban|#2e86c1|Socialist Republic|communism|Fidel Castro|Prime Minister|1926|.6,.3,.6,.7,.5|CUB|2100|60|100|5|50|
PRT|Portugal|Portuguese|#1e8a4c|Corporatist Dictatorship (Estado Novo)|integralism|António de Oliveira Salazar|President of the Council|1889|.3,.8,.6,.3,.6|PRT AGO MOZ GNB CPV STP TLS|3100|60|150|20|100|
ESP|Spain|Spanish|#e6c229|Nationalist Dictatorship|fascism|Francisco Franco|Caudillo|1892|.2,.8,.5,.3,.7|ESP SAH GNQ|4000|65|250|50|200|
KOR|South Korea|South Korean|#2e4053|Military Government|military_junta|Park Chung-hee|Chairman|1917|.4,.6,.4,.7,.8|KOR|1300|50|600|20|200|
PRK|North Korea|North Korean|#922b21|Socialist Single-Party State|communism|Kim Il-sung|Premier|1912|.7,.5,.3,.8,.5|PRK|1300|65|350|10|300|
VNM|North Vietnam|North Vietnamese|#c0392b|Socialist Single-Party State|communism|Hồ Chí Minh|President|1890|.6,.6,.6,.8,.7|VNM|800|60|250|0|20|
EGY|Egypt|Egyptian|#d4ac0d|Socialist Republic|social_democracy|Gamal Abdel Nasser|President|1918|.5,.5,.5,.8,.6|EGY|1300|60|180|20|300|
ISR|Israel|Israeli|#5dade2|Parliamentary Republic|social_democracy|David Ben-Gurion|Prime Minister|1886|.4,.6,.6,.5,.8|ISR|5000|70|60|10|200|
IRN|Iran|Iranian|#239b56|Monarchy|constitutional_monarchy|Mohammad Reza Pahlavi|Shah|1919|.3,.6,.4,.6,.7|IRN|2500|55|200|10|150|
TUR|Turkey|Turkish|#c0392b|Parliamentary Republic|kemalism|İsmet İnönü|Prime Minister|1884|.2,.7,.6,.3,.7|TUR|2700|55|400|30|300|
SAU|Saudi Arabia|Saudi|#196f3d|Absolute Monarchy|theocracy|Saud bin Abdulaziz|King|1902|.1,.7,.5,.3,.6|SAU|4000|60|40|0|50|
IDN|Indonesia|Indonesian|#c0392b|Guided Democracy|military_junta|Sukarno|President|1901|.5,.4,.4,.8,.5|IDN|1000|45|300|20|100|
BRA|Brazil|Brazilian|#229954|Federal Republic|social_democracy|João Goulart|President|1919|.1,.5,.6,.4,.5|BRA|2900|45|200|30|200|
ARG|Argentina|Argentine|#85c1e9|Republic|military_junta|José María Guido|President|1910|.1,.5,.4,.3,.5|ARG|6300|40|100|40|100|
MEX|Mexico|Mexican|#148f77|Dominant-Party Republic|social_democracy|Adolfo López Mateos|President|1909|.1,.7,.6,.3,.7|MEX|3600|70|60|10|50|
CAN|Canada|Canadian|#e74c3c|Federal Parliamentary Monarchy|conservatism|John Diefenbaker|Prime Minister|1895|.1,.7,.8,.3,.7|CAN|10500|80|120|40|300|
AUS|Australia|Australian|#16a085|Federal Parliamentary Monarchy|conservatism|Robert Menzies|Prime Minister|1894|.1,.7,.8,.3,.8|AUS PNG|8500|80|50|20|150|
ZAF|South Africa|South African|#d35400|Apartheid Republic|conservatism|Hendrik Verwoerd|Prime Minister|1901|.4,.7,.2,.4,.5|ZAF NAM|4500|45|80|10|200|
"""
OVR1962 = [("Sachsen", "DEU", "GDR"), ("Sachsen-Anhalt", "DEU", "GDR"), ("Mecklenburg-Vorpommern", "DEU", "GDR")]
MEM1962 = [
    ("SOV", "FRG", 1941, "invasion", -60, "Nazi Germany's invasion killed some 27 million Soviet citizens."),
    ("POL", "FRG", 1939, "invasion", -60, "German invasion and occupation devastated Poland."),
    ("USA", "SOV", 1945, "cooperation", 10, "The wartime alliance against Nazi Germany."),
    ("USA", "SOV", 1948, "interference", -30, "The Berlin Blockade began the Cold War's confrontations."),
    ("CHN", "JPN", 1937, "invasion", -60, "The Japanese invasion of China (1937-45)."),
    ("KOR", "PRK", 1950, "invasion", -60, "North Korea invaded the South in June 1950."),
    ("CUB", "USA", 1961, "invasion", -50, "The CIA-backed Bay of Pigs invasion failed in April 1961."),
    ("CHN", "SOV", 1960, "betrayal", -25, "The Sino-Soviet split: Soviet advisers were withdrawn in 1960."),
    ("EGY", "GBR", 1956, "invasion", -40, "Britain, France and Israel invaded during the Suez Crisis."),
    ("HUN", "SOV", 1956, "invasion", -40, "Soviet tanks crushed the Hungarian Revolution."),
    ("IND", "PAK", 1947, "war", -35, "Partition and the first Kashmir war."),
]
CLAIMS1962 = {"PRK": ["KOR"], "KOR": ["PRK"], "CHN": ["TWN"], "TWN": ["CHN"], "VNM": [], "PAK": ["KAS"], "IND": [], "FRG": [("Sachsen", "DEU"), ("Sachsen-Anhalt", "DEU"), ("Mecklenburg-Vorpommern", "DEU")], "ARG": ["FLK"]}
ORGS1962 = [("nato", "NATO", "alliance", 1949, "USA GBR FRA FRG ITA CAN TUR PRT", "North Atlantic Treaty Organization."),
            ("warsaw_pact", "Warsaw Pact", "alliance", 1955, "SOV GDR POL CZS HUN ROU BGR", "Soviet-led military alliance."),
            ("un", "United Nations", "international", 1945, "USA SOV GBR FRA TWN IND PAK ITA POL CZS HUN ROU BGR YUG CUB PRT ESP EGY ISR IRN TUR SAU IDN BRA ARG MEX CAN AUS ZAF JPN", "Successor to the League of Nations; the Security Council is deadlocked by the veto."),
            ("eec", "European Economic Community", "economic", 1957, "FRA FRG ITA", "Common market of Western Europe (with the Benelux states).")]
TREATIES1962 = []
WARS1962 = []
BACK1962 = {"_world": "September 1962. Seventeen years after the Second World War, the world is divided by an Iron Curtain. The United States and the Soviet Union, armed with thermonuclear weapons and intercontinental missiles, compete for allies across a rapidly decolonising world. Berlin is split by a new wall; China has broken with Moscow; Cuba has become a Soviet ally ninety miles from Florida - where, unknown to Washington, Soviet missiles are being installed.",
            "USA": "Victorious in 1945, the US leads the Western alliance and the world economy, committed to containing communism.",
            "SOV": "Having lost 27 million people in the war, the USSR dominates Eastern Europe and leads the communist world, though Khrushchev's de-Stalinisation has split it."}
HOOKS1962 = [(1962, 10, "cuban_missiles", "Cuban Missile Crisis", "SOV", "US reconnaissance discovers Soviet nuclear missiles in Cuba.")]

EXTRA_IDEOLOGIES = {
    "militarist_statism": ("Militarist Statism", "authoritarian", 0.1, 0.8, -0.3, 0.8, -0.8,
                           "Emperor-centred nationalism directed by the armed forces.", "army factions, nationalist societies", "liberals, communists",
                           "Zaibatsu-led war economy."),
    "tridemism": ("Tridemism", "authoritarian", 0.0, 0.6, 0.1, 0.6, -0.6, "Sun Yat-sen's Three Principles: nationalism, democracy and livelihood, under party tutelage.",
                  "Kuomintang, military academies", "Communists, warlords", "State-guided development."),
    "kemalism": ("Kemalism", "authoritarian", 0.1, 0.6, 0.7, 0.8, -0.5, "Republican, secular and modernising nationalism.", "officer corps, urban reformers",
                 "religious conservatives", "Statist industrialisation."),
    "integralism": ("Integralism", "authoritarian", 0.1, 0.7, -0.6, 0.7, -0.9, "Catholic corporatist nationalism.", "Church, landowners, army",
                    "socialists, liberals", "Guild corporatism."),
}
