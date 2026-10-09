/**
 * Baseline country data for the 2024 start.
 *
 * REAL-WORLD (approximate, rounded): population, nominal GDP, military spending share,
 * active troops, government type, nuclear status, capital coordinates, debt ratios.
 * Figures are approximate values in the range of IMF WEO / World Bank / SIPRI / IISS
 * publications for 2023-24 and are intended as a game baseline, not as a citation.
 *
 * GAME-GENERATED: everything that is marked `estimated` (fallbacks for unknown values),
 * and all derived quantities (capital stock, tech level, tax rates, etc. — see sim/init.ts).
 */

export type GovType = 'D' | 'F' | 'A' | 'M' | 'C'; // democracy, flawed/hybrid, autocracy, monarchy, communist one-party
export type Region = 'NA' | 'LA' | 'EU' | 'RU' | 'ME' | 'AF' | 'SA' | 'EA' | 'SEA' | 'OC';

export interface CountryBase {
  name: string; // matches Natural Earth / world-atlas feature name
  iso3: string;
  popM: number;
  gdpB: number;
  milPct: number;
  troopsK: number;
  gov: GovType;
  region: Region;
  capital?: [number, number]; // lat, lon
  nuclear: boolean;
  estimated: boolean; // true if economic/military values are game-generated fallbacks
}

// name|iso3|popM|gdpB|mil%GDP|activeTroopsK|gov|region|capLat,capLon|flags(N=nuclear, E=estimated)
const RAW = `
Afghanistan|AFG|41|17|0|150|A|SA|34.5,69.2|
Albania|ALB|2.8|23|1.5|8|D|EU|41.3,19.8|
Algeria|DZA|45|240|8|140|A|AF|36.7,3.1|
Andorra|AND|0.08|3.7|0|0.2|D|EU|42.5,1.5|
Angola|AGO|36|85|1.5|100|F|AF|-8.8,13.2|
Antigua and Barb.|ATG|0.1|2|0.3|0.2|D|LA|17.1,-61.8|
Argentina|ARG|46|640|0.7|70|D|LA|-34.6,-58.4|
Armenia|ARM|2.8|24|4|45|F|RU|40.2,44.5|
Australia|AUS|26.5|1720|2|60|D|OC|-35.3,149.1|
Austria|AUT|9.1|516|0.8|23|D|EU|48.2,16.4|
Azerbaijan|AZE|10.1|72|4|65|A|RU|40.4,49.9|
Bahamas|BHS|0.4|14|0.5|1|D|LA|25,-77.4|
Bahrain|BHR|1.5|44|3.5|8|M|ME|26.2,50.6|
Bangladesh|BGD|172|437|1.2|160|F|SA|23.8,90.4|
Barbados|BRB|0.28|6|0.5|1|D|LA|13.1,-59.6|
Belarus|BLR|9.2|72|1.5|48|A|RU|53.9,27.6|
Belgium|BEL|11.7|630|1.3|25|D|EU|50.8,4.4|
Belize|BLZ|0.4|3|1|2|D|LA|17.25,-88.8|
Benin|BEN|13|19|1|12|F|AF|6.5,2.6|
Bhutan|BTN|0.78|3|1|8|M|SA|27.5,89.6|
Bolivia|BOL|12.4|46|1.5|35|F|LA|-16.5,-68.1|
Bosnia and Herz.|BIH|3.2|27|0.9|10|F|EU|43.9,18.4|
Botswana|BWA|2.6|20|2.5|10|D|AF|-24.7,25.9|
Brazil|BRA|216|2170|1.1|360|D|LA|-15.8,-47.9|
Brunei|BRN|0.45|15|3|7|M|SEA|4.9,114.9|
Bulgaria|BGR|6.8|100|1.9|37|D|EU|42.7,23.3|
Burkina Faso|BFA|23|20|2.5|13|A|AF|12.4,-1.5|
Burundi|BDI|13|3|2|30|A|AF|-3.4,29.4|
Cabo Verde|CPV|0.6|2.4|0.5|1|D|AF|14.9,-23.5|
Cambodia|KHM|17|31|2|124|A|SEA|11.6,104.9|
Cameroon|CMR|28|48|1.3|20|A|AF|3.9,11.5|
Canada|CAN|40|2140|1.3|68|D|NA|45.4,-75.7|
Central African Rep.|CAF|5.7|2.6|1|10|F|AF|4.4,18.6|
Chad|TCD|18|13|2.5|34|A|AF|12.1,15|
Chile|CHL|19.6|335|1.8|68|D|LA|-33.4,-70.7|
China|CHN|1410|17790|1.7|2035|C|EA|39.9,116.4|N
Colombia|COL|52|363|3|290|D|LA|4.7,-74.1|
Comoros|COM|0.85|1.3|0.5|1|F|AF|-11.7,43.3|
Congo|COG|6.1|15|1.5|10|A|AF|-4.3,15.3|
Costa Rica|CRI|5.2|86|0.4|2|D|LA|9.9,-84.1|
Côte d'Ivoire|CIV|28|79|1|25|F|AF|6.8,-5.3|
Croatia|HRV|3.9|82|1.8|15|D|EU|45.8,16|
Cuba|CUB|11.1|110|3|50|C|LA|23.1,-82.4|
Cyprus|CYP|1.3|31|1.8|15|D|EU|35.2,33.4|
Czechia|CZE|10.8|335|1.5|25|D|EU|50.1,14.4|
Dem. Rep. Congo|COD|102|66|1|135|F|AF|-4.3,15.3|
Denmark|DNK|5.9|400|1.7|15|D|EU|55.7,12.6|
Djibouti|DJI|1.1|3.7|3|10|A|AF|11.6,43.1|
Dominica|DMA|0.07|0.6|0.2|0.2|D|LA|15.3,-61.4|
Dominican Rep.|DOM|11.3|120|0.7|56|D|LA|18.5,-69.9|
Ecuador|ECU|18|120|2.2|40|D|LA|-0.2,-78.5|
Egypt|EGY|112|395|1.2|440|A|ME|30,31.2|
El Salvador|SLV|6.3|34|1.2|25|F|LA|13.7,-89.2|
Eq. Guinea|GNQ|1.7|12|1|1.3|A|AF|3.75,8.8|
Eritrea|ERI|3.7|2.5|5|200|A|AF|15.3,38.9|
Estonia|EST|1.4|41|3|7|D|EU|59.4,24.7|
eSwatini|SWZ|1.2|4.4|1.5|3|M|AF|-26.3,31.1|
Ethiopia|ETH|126|156|0.6|140|F|AF|9,38.7|
Fiji|FJI|0.93|5.5|1.5|4|F|OC|-18.1,178.4|
Finland|FIN|5.6|300|2.4|24|D|EU|60.2,24.9|
France|FRA|68|3030|2|203|D|EU|48.9,2.4|N
Gabon|GAB|2.4|20|1.5|5|A|AF|0.4,9.5|
Gambia|GMB|2.7|2.3|1|4|F|AF|13.5,-16.6|
Georgia|GEO|3.7|30|1|20|F|RU|41.7,44.8|
Germany|DEU|84.5|4460|1.5|181|D|EU|52.5,13.4|
Ghana|GHA|34|76|0.5|16|D|AF|5.6,-0.2|
Greece|GRC|10.4|238|3.7|110|D|EU|38,23.7|
Grenada|GRD|0.12|1.2|0.2|0.2|D|LA|12.1,-61.7|
Guatemala|GTM|18|102|0.4|20|F|LA|14.6,-90.5|
Guinea|GIN|14|23|2|10|A|AF|9.5,-13.7|
Guinea-Bissau|GNB|2.1|2|1|4|F|AF|11.9,-15.6|
Guyana|GUY|0.8|16|1|3|F|LA|6.8,-58.2|
Haiti|HTI|11.7|20|0.3|0.5|F|LA|18.5,-72.3|
Honduras|HND|10.6|33|1.3|15|F|LA|14.1,-87.2|
Hungary|HUN|9.6|212|2|28|F|EU|47.5,19|
Iceland|ISL|0.38|31|0.2|0.3|D|EU|64.1,-21.9|
India|IND|1430|3550|2.4|1450|D|SA|28.6,77.2|N
Indonesia|IDN|277|1370|0.8|400|D|SEA|-6.2,106.8|
Iran|IRN|89|400|2.5|610|A|ME|35.7,51.4|
Iraq|IRQ|44|250|2.5|200|F|ME|33.3,44.4|
Ireland|IRL|5.3|545|0.2|8|D|EU|53.3,-6.3|
Israel|ISR|9.8|510|5.3|170|D|ME|31.8,35.2|N
Italy|ITA|59|2250|1.6|165|D|EU|41.9,12.5|
Jamaica|JAM|2.8|19|0.7|4|D|LA|18,-76.8|
Japan|JPN|124|4210|1.2|247|D|EA|35.7,139.7|
Jordan|JOR|11.3|50|4.5|100|M|ME|31.9,35.9|
Kazakhstan|KAZ|19.6|260|1|39|A|RU|51.2,71.4|
Kenya|KEN|55|108|1|24|F|AF|-1.3,36.8|
Kiribati|KIR|0.13|0.25|0|0.1|D|OC|1.4,173|
Kosovo|XKX|1.8|9.4|1|5|F|EU|42.7,21.2|
Kuwait|KWT|4.3|160|4|17|M|ME|29.4,48|
Kyrgyzstan|KGZ|7|13|2|11|F|RU|42.9,74.6|
Laos|LAO|7.6|15|0.5|30|C|SEA|18,102.6|
Latvia|LVA|1.9|43|3|7|D|EU|56.9,24.1|
Lebanon|LBN|5.4|18|3.5|60|F|ME|33.9,35.5|
Lesotho|LSO|2.3|2|2|2|M|AF|-29.3,27.5|
Liberia|LBR|5.4|4.2|0.5|2|F|AF|6.3,-10.8|
Libya|LBY|6.9|50|4|20|F|AF|32.9,13.2|
Liechtenstein|LIE|0.04|7|0|0.1|M|EU|47.1,9.5|
Lithuania|LTU|2.8|79|2.5|23|D|EU|54.7,25.3|
Luxembourg|LUX|0.66|86|1|1|D|EU|49.6,6.1|
Macedonia|MKD|1.8|15|1.8|8|F|EU|42,21.4|
Madagascar|MDG|30|16|0.5|13|F|AF|-18.9,47.5|
Malawi|MWI|20.9|13|1|10|F|AF|-14,33.8|
Malaysia|MYS|34|400|1|113|F|SEA|3.1,101.7|
Maldives|MDV|0.52|7|3|4|F|SA|4.2,73.5|
Mali|MLI|23|19|3|20|A|AF|12.6,-8|
Malta|MLT|0.54|20|0.5|2|D|EU|35.9,14.5|
Marshall Is.|MHL|0.04|0.3|0|0.1|D|OC|7.1,171.4|E
Mauritania|MRT|4.9|10|2|20|A|AF|18.1,-16|
Mauritius|MUS|1.3|14|0.2|1|D|AF|-20.2,57.5|
Mexico|MEX|128|1790|0.6|260|F|LA|19.4,-99.1|
Micronesia|FSM|0.11|0.4|0|0.1|D|OC|6.9,158.2|E
Moldova|MDA|2.6|16|0.5|6|F|EU|47,28.9|
Monaco|MCO|0.04|8.6|0|0.1|M|EU|43.7,7.4|
Mongolia|MNG|3.4|20|0.8|10|D|EA|47.9,106.9|
Montenegro|MNE|0.62|7|1.7|2|D|EU|42.4,19.3|
Morocco|MAR|37.8|143|3.3|195|M|AF|34,-6.8|
Mozambique|MOZ|34|20|1|11|F|AF|-26,32.6|
Myanmar|MMR|54|66|3|406|A|SEA|19.8,96.1|
Namibia|NAM|2.6|12|3|10|D|AF|-22.6,17.1|
Nauru|NRU|0.01|0.15|0|0.1|D|OC|-0.5,166.9|E
Nepal|NPL|30|41|1.4|96|F|SA|27.7,85.3|
Netherlands|NLD|17.9|1120|1.7|35|D|EU|52.4,4.9|
New Zealand|NZL|5.2|250|1.5|9|D|OC|-41.3,174.8|
Nicaragua|NIC|6.9|17|0.5|12|A|LA|12.1,-86.3|
Niger|NER|27|15|2|25|A|AF|13.5,2.1|
Nigeria|NGA|224|363|0.7|135|F|AF|9.1,7.5|
North Korea|PRK|26|28|20|1280|C|EA|39,125.8|NE
Norway|NOR|5.5|485|1.7|23|D|EU|59.9,10.7|
Oman|OMN|4.6|105|5.5|42|M|ME|23.6,58.6|
Pakistan|PAK|240|338|2.8|650|F|SA|33.7,73|N
Palau|PLW|0.02|0.26|0|0.1|D|OC|7.5,134.6|E
Palestine|PSE|5.4|18|1|10|F|ME|31.9,35.2|E
Panama|PAN|4.4|83|0.3|4|D|LA|9,-79.5|
Papua New Guinea|PNG|10.3|31|0.5|4|F|OC|-9.4,147.2|
Paraguay|PRY|6.8|42|1|14|D|LA|-25.3,-57.6|
Peru|PER|34|270|1.2|81|F|LA|-12,-77|
Philippines|PHL|117|437|1|150|F|SEA|14.6,121|
Poland|POL|37.7|810|3.9|165|D|EU|52.2,21|
Portugal|PRT|10.3|285|1.5|25|D|EU|38.7,-9.1|
Qatar|QAT|2.7|220|4|12|M|ME|25.3,51.5|
Romania|ROU|19|350|1.8|70|D|EU|44.4,26.1|
Russia|RUS|144|2020|5.5|1100|A|RU|55.75,37.6|N
Rwanda|RWA|14|14|1.2|34|A|AF|-1.95,30.1|
S. Sudan|SSD|11|4|2|185|A|AF|4.85,31.6|
Saint Lucia|LCA|0.18|2.4|0|0.2|D|LA|14,-61|
Samoa|WSM|0.22|0.9|0|0.1|D|OC|-13.8,-171.8|E
San Marino|SMR|0.034|1.9|0|0.1|D|EU|43.9,12.4|E
Saudi Arabia|SAU|36.9|1070|7|250|M|ME|24.7,46.7|
Senegal|SEN|18|31|1.3|14|D|AF|14.7,-17.5|
Serbia|SRB|6.6|75|2.2|28|F|EU|44.8,20.5|
Seychelles|SYC|0.1|2|0.8|0.4|D|AF|-4.6,55.5|
Sierra Leone|SLE|8.6|4|0.6|9|F|AF|8.5,-13.2|
Singapore|SGP|5.9|500|3|51|F|SEA|1.3,103.8|
Slovakia|SVK|5.4|127|1.9|15|D|EU|48.1,17.1|
Slovenia|SVN|2.1|68|1.2|7|D|EU|46.05,14.5|
Solomon Is.|SLB|0.74|1.6|0|0.1|D|OC|-9.4,160|E
Somalia|SOM|18|11|1|20|F|AF|2,45.3|
Somaliland|XSL|6|2.1|1|15|F|AF|9.56,44.06|E
South Africa|ZAF|60|380|0.9|74|D|AF|-25.7,28.2|
South Korea|KOR|51.7|1710|2.8|500|D|EA|37.6,127|
Spain|ESP|48|1580|1.3|120|D|EU|40.4,-3.7|
Sri Lanka|LKA|22|85|1.5|250|F|SA|6.9,79.9|
St. Vin. and Gren.|VCT|0.1|1|0|0.1|D|LA|13.2,-61.2|E
St. Kitts and Nevis|KNA|0.05|1.1|0|0.3|D|LA|17.3,-62.7|E
Sudan|SDN|48|25|2|200|A|AF|15.6,32.5|
Suriname|SUR|0.62|3.5|1|2|D|LA|5.85,-55.2|
Sweden|SWE|10.5|585|2.1|15|D|EU|59.3,18.1|
Switzerland|CHE|8.8|885|0.7|20|D|EU|46.9,7.4|
Syria|SYR|23|9|3|170|A|ME|33.5,36.3|
São Tomé and Principe|STP|0.23|0.6|0|0.3|D|AF|0.3,6.7|E
Taiwan|TWN|23.4|755|2.5|169|D|EA|25,121.5|
Tajikistan|TJK|10|12|1.2|16|A|RU|38.6,68.8|
Tanzania|TZA|67|79|1|27|F|AF|-6.2,35.7|
Thailand|THA|71.8|515|1.3|360|F|SEA|13.75,100.5|
Timor-Leste|TLS|1.4|2|1|2|D|SEA|-8.56,125.6|
Togo|TGO|9|9|2|8|A|AF|6.1,1.2|
Tonga|TON|0.1|0.5|0|0.5|M|OC|-21.1,-175.2|E
Trinidad and Tobago|TTO|1.5|28|0.5|4|D|LA|10.65,-61.5|
Tunisia|TUN|12.4|48|2.5|36|D|AF|36.8,10.2|
Turkey|TUR|85|1110|2.1|355|F|ME|39.9,32.9|
Turkmenistan|TKM|6.5|60|1|36|A|RU|37.95,58.4|
Uganda|UGA|48|49|2|45|A|AF|0.3,32.6|
Ukraine|UKR|37|180|10|700|F|EU|50.45,30.5|
United Arab Emirates|ARE|9.5|510|4|63|M|ME|24.5,54.4|
United Kingdom|GBR|67.7|3340|2.3|141|D|EU|51.5,-0.1|N
United States of America|USA|335|27360|3.4|1330|D|NA|38.9,-77|N
Uruguay|URY|3.4|77|1.8|20|D|LA|-34.9,-56.2|
Uzbekistan|UZB|35|90|1|68|A|RU|41.3,69.2|
Vanuatu|VUT|0.33|1.1|0|0.1|D|OC|-17.7,168.3|E
Vatican|VAT|0.0008|0.3|0|0.1|M|EU|41.9,12.45|E
Venezuela|VEN|28.8|100|1|123|A|LA|10.5,-66.9|
Vietnam|VNM|99|430|2.3|450|C|SEA|21,105.85|
W. Sahara|ESH|0.6|1|1|10|A|AF|27.15,-13.2|E
Yemen|YEM|34|20|3|40|A|ME|15.4,44.2|
Zambia|ZMB|20.5|27|1|16|F|AF|-15.4,28.3|
Zimbabwe|ZWE|16.3|35|2|40|A|AF|-17.8,31.05|
N. Cyprus|XNC|0.38|4|2|4|F|EU|35.2,33.4|E
Eswatini_placeholder|XXX|0|0|0|0|F|AF|0,0|E
`;

export const COUNTRY_BASE: CountryBase[] = RAW.trim()
  .split('\n')
  .filter((l) => !l.startsWith('Eswatini_placeholder'))
  .map((line) => {
    const f = line.split('|');
    const [lat, lon] = (f[8] || '0,0').split(',').map(Number);
    const flags = f[9] || '';
    return {
      name: f[0],
      iso3: f[1],
      popM: Number(f[2]),
      gdpB: Number(f[3]),
      milPct: Number(f[4]),
      troopsK: Number(f[5]),
      gov: f[6] as GovType,
      region: f[7] as Region,
      capital: [lat, lon] as [number, number],
      nuclear: flags.includes('N'),
      estimated: flags.includes('E'),
    };
  });

/** Dependencies & territories become overseas provinces of their administering state. */
export const DEPENDENCIES: Record<string, string> = {
  'N. Mariana Is.': 'United States of America',
  'U.S. Virgin Is.': 'United States of America',
  Guam: 'United States of America',
  'American Samoa': 'United States of America',
  'Puerto Rico': 'United States of America',
  'S. Geo. and the Is.': 'United Kingdom',
  'Br. Indian Ocean Ter.': 'United Kingdom',
  'Saint Helena': 'United Kingdom',
  'Pitcairn Is.': 'United Kingdom',
  Anguilla: 'United Kingdom',
  'Falkland Is.': 'United Kingdom',
  'Cayman Is.': 'United Kingdom',
  Bermuda: 'United Kingdom',
  'British Virgin Is.': 'United Kingdom',
  'Turks and Caicos Is.': 'United Kingdom',
  Montserrat: 'United Kingdom',
  Jersey: 'United Kingdom',
  Guernsey: 'United Kingdom',
  'Isle of Man': 'United Kingdom',
  'St. Pierre and Miquelon': 'France',
  'Wallis and Futuna Is.': 'France',
  'St-Martin': 'France',
  'St-Barthélemy': 'France',
  'Fr. Polynesia': 'France',
  'New Caledonia': 'France',
  'Fr. S. Antarctic Lands': 'France',
  Niue: 'New Zealand',
  'Cook Is.': 'New Zealand',
  Aruba: 'Netherlands',
  Curaçao: 'Netherlands',
  'Sint Maarten': 'Netherlands',
  Greenland: 'Denmark',
  'Faeroe Is.': 'Denmark',
  Åland: 'Finland',
  Macao: 'China',
  'Hong Kong': 'China',
  'Indian Ocean Ter.': 'Australia',
  'Heard I. and McDonald Is.': 'Australia',
  'Norfolk Island': 'Australia',
  'Ashmore and Cartier Is.': 'Australia',
  'Siachen Glacier': 'India',
};

export const EXCLUDED_FEATURES = ['Antarctica'];

// ---- Blocs (initial alliances / affinities) ----
export const NATO = [
  'United States of America', 'Canada', 'United Kingdom', 'France', 'Germany', 'Italy', 'Spain', 'Portugal',
  'Netherlands', 'Belgium', 'Luxembourg', 'Denmark', 'Norway', 'Iceland', 'Poland', 'Czechia', 'Slovakia',
  'Hungary', 'Romania', 'Bulgaria', 'Greece', 'Turkey', 'Croatia', 'Slovenia', 'Albania', 'Macedonia',
  'Montenegro', 'Estonia', 'Latvia', 'Lithuania', 'Finland', 'Sweden',
];
export const EU = [
  'Germany', 'France', 'Italy', 'Spain', 'Portugal', 'Netherlands', 'Belgium', 'Luxembourg', 'Denmark',
  'Sweden', 'Finland', 'Ireland', 'Austria', 'Poland', 'Czechia', 'Slovakia', 'Hungary', 'Slovenia',
  'Croatia', 'Romania', 'Bulgaria', 'Greece', 'Cyprus', 'Malta', 'Estonia', 'Latvia', 'Lithuania',
];
export const CSTO = ['Russia', 'Belarus', 'Armenia', 'Kazakhstan', 'Kyrgyzstan', 'Tajikistan'];
export const WEST_PARTNERS = [
  'Japan', 'South Korea', 'Australia', 'New Zealand', 'Israel', 'Taiwan', 'Philippines', 'Ukraine',
  'Switzerland', 'Ireland', 'Austria', 'Moldova', 'Georgia', 'Kosovo', 'Singapore',
];
export const EAST_PARTNERS = [
  'China', 'Russia', 'Iran', 'North Korea', 'Belarus', 'Syria', 'Cuba', 'Venezuela', 'Nicaragua', 'Myanmar',
  'Eritrea', 'Mali', 'Burkina Faso', 'Niger', 'Laos', 'Cambodia', 'Pakistan', 'Serbia',
];
export const ARAB_LEAGUE = [
  'Saudi Arabia', 'United Arab Emirates', 'Qatar', 'Kuwait', 'Bahrain', 'Oman', 'Jordan', 'Egypt', 'Iraq',
  'Lebanon', 'Syria', 'Yemen', 'Libya', 'Tunisia', 'Algeria', 'Morocco', 'Sudan', 'Mauritania', 'Somalia',
  'Djibouti', 'Comoros', 'Palestine',
];
/** Initial bilateral alliances beyond NATO/CSTO. */
export const BILATERAL_ALLIANCES: [string, string][] = [
  ['United States of America', 'Japan'], ['United States of America', 'South Korea'],
  ['United States of America', 'Australia'], ['United States of America', 'Philippines'],
  ['United States of America', 'Israel'], ['Australia', 'New Zealand'],
  ['China', 'North Korea'], ['Russia', 'North Korea'], ['Russia', 'Syria'], ['Russia', 'Iran'],
  ['Pakistan', 'China'], ['Turkey', 'Azerbaijan'], ['Turkey', 'Pakistan'],
];

// Rivalries: relation penalty (negative) applied to the baseline.
export const RIVALRIES: [string, string, number][] = [
  ['Russia', 'Ukraine', -90], ['Russia', 'Poland', -50], ['Russia', 'Estonia', -55], ['Russia', 'Latvia', -55],
  ['Russia', 'Lithuania', -55], ['Russia', 'Finland', -40], ['Russia', 'Georgia', -60], ['Russia', 'Moldova', -40],
  ['United States of America', 'Iran', -85], ['United States of America', 'North Korea', -85],
  ['United States of America', 'China', -45], ['United States of America', 'Russia', -55],
  ['United States of America', 'Venezuela', -45], ['United States of America', 'Cuba', -35],
  ['China', 'Taiwan', -90], ['China', 'Japan', -35], ['China', 'India', -45], ['China', 'Philippines', -35],
  ['China', 'Vietnam', -30], ['India', 'Pakistan', -85], ['Israel', 'Iran', -90], ['Israel', 'Syria', -60],
  ['Israel', 'Lebanon', -55], ['Israel', 'Palestine', -70], ['Israel', 'Iraq', -40], ['Israel', 'Yemen', -50],
  ['Saudi Arabia', 'Iran', -55], ['Saudi Arabia', 'Yemen', -40], ['Turkey', 'Greece', -35], ['Turkey', 'Cyprus', -45],
  ['Turkey', 'Armenia', -35], ['Armenia', 'Azerbaijan', -85], ['North Korea', 'South Korea', -85],
  ['North Korea', 'Japan', -65], ['Algeria', 'Morocco', -55], ['Ethiopia', 'Eritrea', -40], ['Ethiopia', 'Egypt', -35],
  ['Sudan', 'S. Sudan', -35], ['Rwanda', 'Dem. Rep. Congo', -55], ['Serbia', 'Kosovo', -75], ['Serbia', 'Croatia', -20],
  ['Venezuela', 'Guyana', -55], ['Bolivia', 'Chile', -20], ['Ecuador', 'Peru', -15], ['Thailand', 'Cambodia', -20],
  ['Japan', 'South Korea', -15], ['Iraq', 'Kuwait', -25], ['Cyprus', 'N. Cyprus', -70], ['Morocco', 'W. Sahara', -60],
  ['Somalia', 'Somaliland', -50], ['Ethiopia', 'Somalia', -20], ['Kenya', 'Somalia', -20], ['Tajikistan', 'Kyrgyzstan', -25],
  ['Azerbaijan', 'Iran', -20], ['Egypt', 'Israel', -15], ['Iran', 'United Arab Emirates', -30], ['Pakistan', 'Afghanistan', -30],
  ['India', 'Bangladesh', -10], ['Eritrea', 'Djibouti', -20], ['Uganda', 'Dem. Rep. Congo', -10],
];

/** Territorial claims that provide an AI casus belli: [claimant, target, strength 0-1]. */
export const CLAIMS: [string, string, number][] = [
  ['China', 'Taiwan', 1], ['Armenia', 'Azerbaijan', 0.7], ['Azerbaijan', 'Armenia', 0.6], ['Serbia', 'Kosovo', 0.7],
  ['India', 'Pakistan', 0.5], ['Pakistan', 'India', 0.5], ['Russia', 'Ukraine', 0.9], ['Venezuela', 'Guyana', 0.8],
  ['Cyprus', 'N. Cyprus', 0.5], ['Morocco', 'W. Sahara', 0.8], ['North Korea', 'South Korea', 0.8],
  ['South Korea', 'North Korea', 0.6], ['Somalia', 'Somaliland', 0.7], ['Ethiopia', 'Eritrea', 0.4],
  ['Israel', 'Palestine', 0.4], ['Iraq', 'Kuwait', 0.3], ['Bolivia', 'Chile', 0.4], ['Rwanda', 'Dem. Rep. Congo', 0.3],
];

// ---- Resource self-sufficiency overrides (production / domestic demand) ----
export const ENERGY_RATIO: Record<string, number> = {
  Russia: 1.9, 'Saudi Arabia': 3.2, 'United Arab Emirates': 2.4, Qatar: 6, Kuwait: 3.5, Norway: 3.2, Canada: 1.7,
  Australia: 2.2, 'United States of America': 1.05, Iraq: 3.3, Iran: 1.8, Nigeria: 1.4, Angola: 4.5, Algeria: 2.6,
  Libya: 3.5, Kazakhstan: 2.2, Venezuela: 2.2, Brazil: 1.1, Mexico: 0.95, Indonesia: 1.5, Oman: 3, Azerbaijan: 3,
  Turkmenistan: 4, Colombia: 1.6, 'Eq. Guinea': 4, Gabon: 3, Congo: 3.5, Brunei: 4, Bolivia: 1.4, Ecuador: 1.4,
  Japan: 0.15, 'South Korea': 0.2, Germany: 0.38, Italy: 0.25, Spain: 0.3, France: 0.6, Turkey: 0.3, India: 0.68,
  China: 0.85, 'United Kingdom': 0.75, Poland: 0.55, Belgium: 0.3, Netherlands: 0.5, Taiwan: 0.1, Singapore: 0.05,
  Pakistan: 0.65, Thailand: 0.5, Philippines: 0.6, Vietnam: 0.9, Ukraine: 0.65, Egypt: 1.0, Argentina: 1.0,
  Switzerland: 0.5, Austria: 0.35, Greece: 0.35, Portugal: 0.3, Ireland: 0.25, Israel: 0.6, Jordan: 0.2, Lebanon: 0.1,
  Morocco: 0.2, Bangladesh: 0.8, Sweden: 0.8, Finland: 0.5, Denmark: 0.9, Cuba: 0.4, Chile: 0.5, Hungary: 0.45,
  Belarus: 0.15, Serbia: 0.7, Syria: 0.5, Yemen: 0.6, Sudan: 0.8,
};
export const FOOD_RATIO: Record<string, number> = {
  Brazil: 1.7, 'United States of America': 1.25, Argentina: 2.2, Ukraine: 2.2, Russia: 1.25, Australia: 2.3,
  Canada: 1.8, France: 1.25, India: 1.05, Thailand: 1.5, Vietnam: 1.3, Indonesia: 1.0, Paraguay: 2.5, Uruguay: 2.5,
  Kazakhstan: 1.5, Denmark: 1.5, 'New Zealand': 2.5, Netherlands: 1.2, Ireland: 1.5, Hungary: 1.4, Romania: 1.2,
  Bulgaria: 1.2, Poland: 1.1, Germany: 0.95, Spain: 1.1, Italy: 0.8, 'United Kingdom': 0.65, China: 0.9,
  Japan: 0.4, 'South Korea': 0.45, Taiwan: 0.5, Egypt: 0.65, 'Saudi Arabia': 0.3, 'United Arab Emirates': 0.15,
  Qatar: 0.1, Kuwait: 0.1, Bahrain: 0.1, Oman: 0.3, Iraq: 0.65, Iran: 0.85, Algeria: 0.55, Morocco: 0.75,
  Libya: 0.3, Yemen: 0.4, Jordan: 0.3, Lebanon: 0.4, Syria: 0.7, Israel: 0.6, Singapore: 0.05, 'Hong Kong': 0.05,
  Mongolia: 0.9, Nigeria: 0.9, Ethiopia: 0.95, Somalia: 0.6, Sudan: 0.8, Haiti: 0.5, Afghanistan: 0.8, Cuba: 0.4,
  Venezuela: 0.55, Malaysia: 0.7, Philippines: 0.85, Turkey: 1.1, Pakistan: 1.0, Bangladesh: 0.95, Switzerland: 0.55,
  Norway: 0.5, Sweden: 0.85, Finland: 0.9, Belarus: 1.0, Greece: 0.9, Portugal: 0.7, Belgium: 0.8,
  Maldives: 0.2, Malta: 0.2, Iceland: 0.7, Chile: 1.1, Peru: 0.95, Colombia: 1.0, Mexico: 0.9, 'South Africa': 1.05,
};
/** Debt-to-GDP overrides (%). Default depends on income level. */
export const DEBT_RATIO: Record<string, number> = {
  Japan: 255, Italy: 138, 'United States of America': 122, France: 111, 'United Kingdom': 101, Greece: 161,
  Singapore: 168, Spain: 107, Portugal: 99, Belgium: 105, Canada: 107, Brazil: 85, India: 82, China: 83,
  Germany: 64, Argentina: 85, Egypt: 92, Pakistan: 75, Lebanon: 180, Sudan: 100, Bahrain: 120, Jordan: 90,
  Israel: 62, 'South Africa': 73, Kenya: 70, Ghana: 85, Ukraine: 85, Venezuela: 160, Mozambique: 95, Maldives: 115,
  'Sri Lanka': 115, Bhutan: 110, Bolivia: 85, Cuba: 130, 'Cabo Verde': 125, Barbados: 115, Jamaica: 80,
  Russia: 20, 'Saudi Arabia': 26, Norway: 40, Estonia: 20, Luxembourg: 25, Switzerland: 38, Australia: 50,
  Ireland: 44, Qatar: 40, 'United Arab Emirates': 30, Kuwait: 5, Brunei: 3, Botswana: 20, Chile: 38, Peru: 33,
  Bulgaria: 24, Turkey: 30, Indonesia: 40, 'North Korea': 20, Libya: 30, Algeria: 55, Iran: 30, Iraq: 45,
};
/** Baseline real GDP growth overrides (% per year). */
export const GROWTH: Record<string, number> = {
  China: 4.6, India: 6.5, Japan: 0.8, Russia: 2.5, Ukraine: 3, Germany: 0.3, Italy: 0.7, France: 1.0,
  'United Kingdom': 0.8, 'United States of America': 2.3, Vietnam: 6, Indonesia: 5, Bangladesh: 5.5, Ethiopia: 6,
  Sudan: -10, Syria: 1, Lebanon: -1, Myanmar: 1, Venezuela: 3, Argentina: -1, Iran: 3, 'Saudi Arabia': 2.5, Libya: 4,
  Rwanda: 7, Guyana: 20, Philippines: 5.8, Malaysia: 4.2, Egypt: 3.5, Turkey: 3.5, Poland: 3, Spain: 2.3, Greece: 2,
  Brazil: 2.1, Mexico: 2.4, Canada: 1.5, Australia: 1.8, 'South Korea': 2.1, Taiwan: 3,
};
