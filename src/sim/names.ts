/**
 * Name banks: fictional people should sound like they come from their country. Major countries have their own
 * banks (male and female first names, surnames, with feminine surname forms where the language has them);
 * everyone else falls back to a regional bank. Names are combinations, never real office holders.
 */
import { keyOf } from './util';
import type { Country } from './types';

interface Bank { m: string[]; f: string[]; l: string[]; fem?: 'slavic' | 'polish' | 'czech' | 'baltic' }
const B: Record<string, Bank> = {
  Poland: { m: ['Tomasz', 'Krzysztof', 'Piotr', 'Andrzej', 'Marek', 'Paweł', 'Jakub', 'Michał', 'Grzegorz', 'Wojciech'], f: ['Agnieszka', 'Katarzyna', 'Magdalena', 'Joanna', 'Ewa', 'Małgorzata', 'Beata', 'Dorota'], l: ['Nowicki', 'Zieliński', 'Wróblewski', 'Kaczmarek', 'Mazur', 'Sadowski', 'Jabłoński', 'Wiśniewski', 'Pawlak', 'Górecki', 'Michalski', 'Krawczyk'], fem: 'polish' },
  Germany: { m: ['Matthias', 'Stefan', 'Jürgen', 'Thomas', 'Frank', 'Andreas', 'Klaus', 'Markus', 'Tobias', 'Jens'], f: ['Katrin', 'Sabine', 'Annette', 'Ulrike', 'Claudia', 'Birgit', 'Heike', 'Johanna'], l: ['Brandt', 'Vogel', 'Kessler', 'Lindner', 'Hartmann', 'Becker', 'Schröder', 'Krämer', 'Wolff', 'Neumann', 'Bauer', 'Engel'] },
  France: { m: ['Laurent', 'Olivier', 'Thierry', 'Philippe', 'Julien', 'Bertrand', 'Nicolas', 'Antoine', 'Didier', 'Gérard'], f: ['Isabelle', 'Nathalie', 'Sylvie', 'Valérie', 'Camille', 'Hélène', 'Céline', 'Agnès'], l: ['Moreau', 'Lefèvre', 'Garnier', 'Rousseau', 'Fontaine', 'Mercier', 'Chevalier', 'Dubois', 'Girard', 'Lambert', 'Bonnet', 'Faure'] },
  'United Kingdom': { m: ['Nigel', 'Simon', 'Graham', 'Oliver', 'Hugh', 'Alistair', 'Edward', 'Rupert', 'Callum', 'Gareth'], f: ['Fiona', 'Harriet', 'Philippa', 'Gemma', 'Imogen', 'Rachel', 'Siobhan', 'Margaret'], l: ['Whitmore', 'Ashworth', 'Pemberton', 'Hargreaves', 'Fairfax', 'Blackwood', 'Thornton', 'Kendall', 'Cartwright', 'Holloway', 'Pryce', 'Mackintosh'] },
  'United States of America': { m: ['Bill', 'Robert', 'Greg', 'Mike', 'Tom', 'Scott', 'Dwight', 'Frank', 'Kevin', 'Marcus'], f: ['Karen', 'Diane', 'Pamela', 'Nancy', 'Kristen', 'Tamara', 'Hillary', 'Denise'], l: ['Whitaker', 'Caldwell', 'Harrington', 'McAllister', 'Dawson', 'Prescott', 'Holbrook', 'Garrison', 'Bradford', 'Kingsley', 'Monroe', 'Sullivan'] },
  Canada: { m: ['Pierre', 'Brian', 'Justin', 'Malcolm', 'Gordon', 'Stephen', 'Jean-Marc', 'Doug'], f: ['Chrystia', 'Catherine', 'Mélanie', 'Heather', 'Danielle', 'Kirsten'], l: ['Tremblay', 'MacLeod', 'Gagnon', 'Fraser', 'Bouchard', 'Campbell', 'Leblanc', 'Sinclair', 'Côté', 'Morrison'] },
  Italy: { m: ['Giuseppe', 'Matteo', 'Enrico', 'Luca', 'Paolo', 'Massimo', 'Stefano', 'Alessandro', 'Franco', 'Davide'], f: ['Giulia', 'Francesca', 'Chiara', 'Federica', 'Paola', 'Valentina', 'Raffaella', 'Lucia'], l: ['Bianchi', 'Ferraro', 'Marchetti', 'Galli', 'Conti', 'De Luca', 'Ricci', 'Moretti', 'Barbieri', 'Lombardi', 'Fontana', 'Serra'] },
  Spain: { m: ['Javier', 'Alfonso', 'Pedro', 'Santiago', 'Ignacio', 'Rodrigo', 'Fernando', 'Íñigo', 'Pablo', 'Mariano'], f: ['Carmen', 'Pilar', 'Montserrat', 'Inés', 'Yolanda', 'Begoña', 'Lucía', 'Rocío'], l: ['Ortega', 'Navarro', 'Iglesias', 'Montero', 'Calvo', 'Serrano', 'Domínguez', 'Vidal', 'Prieto', 'Aguirre', 'Castro', 'Herrero'] },
  Russia: { m: ['Dmitri', 'Sergei', 'Nikolai', 'Andrei', 'Vladislav', 'Gennady', 'Oleg', 'Yevgeny', 'Arkady', 'Valery'], f: ['Irina', 'Tatiana', 'Svetlana', 'Ekaterina', 'Larisa', 'Natalia', 'Galina', 'Valentina'], l: ['Volkov', 'Sokolov', 'Orlov', 'Lebedev', 'Morozov', 'Zaytsev', 'Belov', 'Gromov', 'Tarasov', 'Shubin', 'Karpov', 'Rybakov'], fem: 'slavic' },
  Ukraine: { m: ['Oleksandr', 'Andriy', 'Taras', 'Bohdan', 'Mykola', 'Serhiy', 'Yuriy', 'Vasyl', 'Ostap', 'Dmytro'], f: ['Oksana', 'Yulia', 'Olena', 'Iryna', 'Halyna', 'Lesya', 'Nataliya', 'Viktoriya'], l: ['Kovalenko', 'Shevchuk', 'Bondarenko', 'Melnyk', 'Tkachenko', 'Kravchuk', 'Marchenko', 'Lysenko', 'Hrytsenko', 'Savchenko', 'Moroz', 'Petrenko'] },
  Belarus: { m: ['Aliaksandr', 'Uladzimir', 'Siarhei', 'Viktar', 'Ihar', 'Pavel', 'Mikhail', 'Dzmitry'], f: ['Sviatlana', 'Volha', 'Natallia', 'Tatsiana', 'Alena', 'Maryia'], l: ['Kavaliou', 'Lukashevich', 'Novikau', 'Zhukau', 'Karpovich', 'Sidarenka', 'Kuzmich', 'Marozau', 'Bahdanovich', 'Hrynevich'] },
  Czechia: { m: ['Jiří', 'Petr', 'Tomáš', 'Václav', 'Miroslav', 'Ondřej', 'Radek', 'Lubomír'], f: ['Jana', 'Lenka', 'Petra', 'Markéta', 'Hana', 'Zuzana'], l: ['Dvořák', 'Novotný', 'Procházka', 'Kučera', 'Veselý', 'Horák', 'Němec', 'Pokorný', 'Marek', 'Růžička'], fem: 'czech' },
  Hungary: { m: ['László', 'Gábor', 'Zoltán', 'Péter', 'Attila', 'István', 'Tamás', 'Balázs'], f: ['Katalin', 'Judit', 'Eszter', 'Zsófia', 'Ildikó', 'Andrea'], l: ['Nagy', 'Szabó', 'Kovács', 'Tóth', 'Horváth', 'Varga', 'Kiss', 'Molnár', 'Farkas', 'Balogh'] },
  Romania: { m: ['Ion', 'Mihai', 'Adrian', 'Florin', 'Dragoș', 'Victor', 'Cătălin', 'Sorin'], f: ['Ioana', 'Elena', 'Raluca', 'Andreea', 'Gabriela', 'Monica'], l: ['Popescu', 'Ionescu', 'Constantinescu', 'Dumitru', 'Stoica', 'Munteanu', 'Georgescu', 'Ciobanu', 'Dobre', 'Neagu'] },
  Greece: { m: ['Kostas', 'Giorgos', 'Nikos', 'Dimitris', 'Yannis', 'Alexis', 'Stavros', 'Panos'], f: ['Eleni', 'Maria', 'Dora', 'Katerina', 'Sofia', 'Anna'], l: ['Papadopoulos', 'Karamanlis', 'Georgiou', 'Nikolaidis', 'Vlachos', 'Dimitriou', 'Antonopoulos', 'Mavros', 'Kostopoulos', 'Pappas'] },
  Sweden: { m: ['Magnus', 'Anders', 'Fredrik', 'Erik', 'Johan', 'Henrik', 'Lars', 'Mattias'], f: ['Ingrid', 'Karin', 'Annika', 'Ebba', 'Lena', 'Malin'], l: ['Lindqvist', 'Bergström', 'Sandberg', 'Holmgren', 'Eklund', 'Nyström', 'Wallin', 'Forsberg', 'Åkesson', 'Sjöberg'] },
  Netherlands: { m: ['Mark', 'Wouter', 'Joost', 'Pieter', 'Bart', 'Ruud', 'Sander', 'Hendrik'], f: ['Sigrid', 'Femke', 'Annelies', 'Marieke', 'Ilse', 'Lotte'], l: ['de Vries', 'van Dijk', 'Bakker', 'Janssen', 'Visser', 'Smit', 'Mulder', 'de Boer', 'van Leeuwen', 'Hoekstra'] },
  Turkey: { m: ['Mehmet', 'Mustafa', 'Ahmet', 'Kemal', 'Murat', 'Hakan', 'Selim', 'Burak', 'Emre', 'Osman'], f: ['Ayşe', 'Elif', 'Zeynep', 'Fatma', 'Meral', 'Tansu'], l: ['Yılmaz', 'Demir', 'Şahin', 'Çelik', 'Aydın', 'Öztürk', 'Arslan', 'Doğan', 'Koç', 'Kaya', 'Erdem', 'Akın'] },
  Iran: { m: ['Hossein', 'Mohammad', 'Ali-Reza', 'Mahmoud', 'Javad', 'Hassan', 'Mehdi', 'Abbas'], f: ['Maryam', 'Zahra', 'Masoumeh', 'Shirin', 'Fatemeh', 'Leila'], l: ['Rahimi', 'Hosseini', 'Moradi', 'Karimi', 'Ahmadi', 'Jafari', 'Sadeghi', 'Rezaei', 'Larijani', 'Tehrani'] },
  'Saudi Arabia': { m: ['Faisal', 'Abdullah', 'Khalid', 'Turki', 'Saud', 'Nawaf', 'Bandar', 'Majed'], f: ['Reema', 'Haifa', 'Lulwa', 'Nouf', 'Sara', 'Hessa'], l: ['al-Otaibi', 'al-Qahtani', 'al-Shammari', 'al-Harbi', 'al-Dossari', 'al-Ghamdi', 'al-Mutairi', 'al-Zahrani'] },
  Egypt: { m: ['Ahmed', 'Mahmoud', 'Tarek', 'Hesham', 'Sherif', 'Amr', 'Karim', 'Mostafa'], f: ['Nadia', 'Mona', 'Rania', 'Dina', 'Hala', 'Yasmine'], l: ['Mansour', 'El-Sayed', 'Abdel-Fattah', 'Shoukry', 'Farouk', 'Hamdy', 'Saleh', 'Ezzat', 'Radwan', 'Fahmy'] },
  Israel: { m: ['Avi', 'Yossi', 'Moshe', 'Eitan', 'Dror', 'Gideon', 'Ronen', 'Amir'], f: ['Tamar', 'Noa', 'Michal', 'Orly', 'Yael', 'Ayelet'], l: ['Ben-David', 'Shapira', 'Levi', 'Mizrahi', 'Peretz', 'Katz', 'Friedman', 'Golan', 'Barak', 'Rosen'] },
  China: { m: ['Wei', 'Jianguo', 'Zhiqiang', 'Haoran', 'Yong', 'Jun', 'Lei', 'Guoqiang', 'Ming', 'Tao'], f: ['Li', 'Xiuying', 'Yan', 'Hong', 'Mei', 'Jing'], l: ['Zhang', 'Wang', 'Liu', 'Chen', 'Yang', 'Zhao', 'Huang', 'Zhou', 'Wu', 'Xu', 'Sun', 'Ma'] },
  Japan: { m: ['Hiroshi', 'Takeshi', 'Kenji', 'Shinjiro', 'Taro', 'Yoshihide', 'Masahiro', 'Kazuo'], f: ['Yuko', 'Sanae', 'Haruka', 'Keiko', 'Naoko', 'Emiko'], l: ['Tanaka', 'Sato', 'Watanabe', 'Kobayashi', 'Nakamura', 'Ishikawa', 'Matsumoto', 'Inoue', 'Kimura', 'Hayashi'] },
  'South Korea': { m: ['Min-jun', 'Seung-ho', 'Jae-won', 'Dong-hyun', 'Sung-min', 'Young-soo'], f: ['Ji-woo', 'Soo-ah', 'Hye-jin', 'Eun-young', 'Min-ji', 'Seo-yeon'], l: ['Kim', 'Lee', 'Park', 'Choi', 'Jung', 'Kang', 'Yoon', 'Han', 'Shin', 'Oh'] },
  India: { m: ['Rajesh', 'Arvind', 'Suresh', 'Vikram', 'Anand', 'Prakash', 'Manoj', 'Ravi', 'Amit', 'Nitin'], f: ['Priya', 'Sunita', 'Kavita', 'Meenakshi', 'Smriti', 'Lakshmi'], l: ['Sharma', 'Patel', 'Reddy', 'Iyer', 'Singh', 'Nair', 'Gupta', 'Mehta', 'Joshi', 'Rao', 'Kapoor', 'Menon'] },
  Pakistan: { m: ['Imran', 'Shahid', 'Asif', 'Bilal', 'Tariq', 'Zulfikar', 'Nawaz', 'Faisal'], f: ['Ayesha', 'Hina', 'Sherry', 'Fatima', 'Maryam', 'Sana'], l: ['Khan', 'Qureshi', 'Malik', 'Chaudhry', 'Butt', 'Abbasi', 'Siddiqui', 'Mirza', 'Bhatti', 'Raza'] },
  Indonesia: { m: ['Budi', 'Joko', 'Agus', 'Prabowo', 'Hendra', 'Bambang', 'Dedi', 'Rizal'], f: ['Sri', 'Retno', 'Dewi', 'Puan', 'Siti', 'Wulan'], l: ['Santoso', 'Wijaya', 'Hartono', 'Setiawan', 'Kusuma', 'Pratama', 'Gunawan', 'Saputra', 'Hidayat', 'Nugroho'] },
  Brazil: { m: ['João', 'Luiz', 'Marcelo', 'Rodrigo', 'Fernando', 'Ricardo', 'Paulo', 'Eduardo', 'Gustavo', 'Sérgio'], f: ['Ana', 'Fernanda', 'Gabriela', 'Marina', 'Simone', 'Tereza'], l: ['Silva', 'Oliveira', 'Santos', 'Souza', 'Costa', 'Pereira', 'Almeida', 'Ribeiro', 'Carvalho', 'Barbosa', 'Moreira', 'Teixeira'] },
  Argentina: { m: ['Martín', 'Sergio', 'Gustavo', 'Ricardo', 'Alberto', 'Facundo', 'Horacio', 'Mauricio'], f: ['Cristina', 'Patricia', 'Victoria', 'Florencia', 'Silvina', 'Mercedes'], l: ['Fernández', 'Giménez', 'Pereyra', 'Sosa', 'Acosta', 'Romero', 'Benítez', 'Ledesma', 'Bullrich', 'Massa'] },
  Mexico: { m: ['Andrés', 'Marcelo', 'Ricardo', 'Jesús', 'Alejandro', 'Enrique', 'Rogelio', 'Arturo'], f: ['Claudia', 'Xóchitl', 'Rocío', 'Guadalupe', 'Beatriz', 'Alicia'], l: ['López', 'Hernández', 'Ramírez', 'Gutiérrez', 'Ebrard', 'Monreal', 'Cárdenas', 'Villarreal', 'Treviño', 'Salinas'] },
  Nigeria: { m: ['Babatunde', 'Chukwuemeka', 'Olusegun', 'Ibrahim', 'Yakubu', 'Emeka', 'Aminu', 'Femi'], f: ['Ngozi', 'Folake', 'Aisha', 'Chiamaka', 'Funmilayo', 'Zainab'], l: ['Okonkwo', 'Adeyemi', 'Bello', 'Okafor', 'Abubakar', 'Eze', 'Adebayo', 'Danjuma', 'Nwosu', 'Ogunleye'] },
  'South Africa': { m: ['Thabo', 'Sipho', 'Cyril', 'Pieter', 'Mandla', 'Bongani', 'Johan', 'Ronald'], f: ['Naledi', 'Nomvula', 'Thandi', 'Zanele', 'Lerato', 'Annelie'], l: ['Ndlovu', 'Mokoena', 'Dlamini', 'Botha', 'Khumalo', 'van der Merwe', 'Nkosi', 'Mahlangu', 'Pretorius', 'Zulu'] },
  Australia: { m: ['Malcolm', 'Craig', 'Bruce', 'Shane', 'Anthony', 'Darren', 'Lachlan', 'Barnaby'], f: ['Penny', 'Kylie', 'Tanya', 'Jacinta', 'Sussan', 'Bronwyn'], l: ['Hawke', 'McGowan', 'Kerrigan', 'Dutton', 'Albury', 'Whitlam', 'Fitzgerald', 'Harrison', 'Prentice', 'Gallagher'] },
  Vietnam: { m: ['Minh', 'Tuấn', 'Hùng', 'Phúc', 'Dũng', 'Thắng', 'Long', 'Quang'], f: ['Lan', 'Hương', 'Thảo', 'Ngọc', 'Mai', 'Hà'], l: ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ', 'Đặng', 'Bùi', 'Đỗ', 'Võ'] },
  Philippines: { m: ['Rodrigo', 'Manuel', 'Ferdinand', 'Antonio', 'Benigno', 'Ramon', 'Jose', 'Eduardo'], f: ['Leni', 'Imelda', 'Gloria', 'Risa', 'Corazon', 'Maricel'], l: ['Reyes', 'Santos', 'Dela Cruz', 'Bautista', 'Villanueva', 'Aquino', 'Mendoza', 'Ramos', 'Tolentino', 'Castillo'] },
  Thailand: { m: ['Somchai', 'Prayut', 'Thaksin', 'Anutin', 'Chuan', 'Pita', 'Surachai', 'Wichai'], f: ['Yingluck', 'Paetongtarn', 'Sudarat', 'Kanya', 'Pimchanok', 'Nattaya'], l: ['Chaiyasit', 'Srisuk', 'Wongsawat', 'Thongchai', 'Rattanakorn', 'Suwannarat', 'Boonmee', 'Charoensuk', 'Siriwat', 'Kittikun'] },
  Kazakhstan: { m: ['Nursultan', 'Kassym', 'Yerlan', 'Askar', 'Daulet', 'Bauyrzhan', 'Marat', 'Serik'], f: ['Dariga', 'Aigerim', 'Gulnara', 'Saule', 'Aliya', 'Zhanar'], l: ['Nurlanov', 'Abenov', 'Sultanov', 'Tokayev', 'Bekov', 'Zhakupov', 'Ermekov', 'Kassymov', 'Ospanov', 'Utemisov'], fem: 'slavic' },
};

// regional fallbacks
const R: Record<string, Bank> = {
  NA: B['United States of America'], OC: B.Australia,
  LA: { m: ['Carlos', 'Miguel', 'Andrés', 'Rafael', 'Diego', 'Javier', 'Mateo', 'Luis', 'Hernán', 'Ernesto'], f: ['Lucía', 'Sofía', 'Camila', 'Elena', 'Paula', 'Valeria', 'Gabriela', 'Daniela'], l: ['Vargas', 'Herrera', 'Castillo', 'Mendoza', 'Rojas', 'Salazar', 'Navarro', 'Cruz', 'Morales', 'Paredes', 'Quintero', 'Cabrera'] },
  EU: { m: ['Jan', 'Peter', 'Lukas', 'Marco', 'Henrik', 'Viktor', 'Stefan', 'Martin', 'Tomas', 'Andrej'], f: ['Anna', 'Marta', 'Katarina', 'Eva', 'Ines', 'Petra', 'Sanna', 'Mira'], l: ['Novak', 'Horvat', 'Kovač', 'Jansen', 'Petersen', 'Berzins', 'Kask', 'Bajramović', 'Popov', 'Marković', 'Rinaldi', 'Varga'] },
  RU: B.Russia,
  ME: { m: ['Omar', 'Khalid', 'Hassan', 'Yusuf', 'Tariq', 'Rashid', 'Zaid', 'Karim', 'Samir', 'Walid'], f: ['Layla', 'Fatima', 'Samira', 'Nadia', 'Rania', 'Huda', 'Amal', 'Zeina'], l: ['al-Rashid', 'Haddad', 'Nasser', 'Farouk', 'Mansour', 'Saleh', 'Aziz', 'Khoury', 'Abboud', 'Hamdan', 'Jaber', 'Sabbagh'] },
  AF: { m: ['Kwame', 'Tunde', 'Samuel', 'Joseph', 'Moses', 'Idris', 'Kofi', 'Abdoulaye', 'Jean-Pierre', 'Tendai'], f: ['Amara', 'Zuri', 'Nia', 'Fatou', 'Abena', 'Wanjiru', 'Aminata', 'Grace'], l: ['Mensah', 'Diallo', 'Kamara', 'Traoré', 'Banda', 'Osei', 'Mwangi', 'Ndiaye', 'Kabila', 'Moyo', 'Toure', 'Odinga'] },
  SA: { m: ['Arjun', 'Rahul', 'Imran', 'Vikram', 'Rohan', 'Sanjay', 'Mahinda', 'Sheikh'], f: ['Priya', 'Anita', 'Sunita', 'Farah', 'Meera', 'Nisha', 'Rukhsana', 'Chandrika'], l: ['Sharma', 'Khan', 'Rahman', 'Perera', 'Hussain', 'Thapa', 'Chowdhury', 'Bandara', 'Karki', 'Haque'] },
  EA: { m: ['Wei', 'Jun', 'Hao', 'Bat-Erdene', 'Ming', 'Kenji', 'Lin'], f: ['Mei', 'Yuki', 'Oyun', 'Hui', 'Jing'], l: ['Zhang', 'Chen', 'Lin', 'Batbayar', 'Huang', 'Tsai', 'Wong'] },
  SEA: { m: ['Somchai', 'Arif', 'Budi', 'Rizal', 'Minh', 'Sokha', 'Hun', 'Aung'], f: ['Putri', 'Lan', 'Siti', 'Suu', 'Mai', 'Dara'], l: ['Tran', 'Rahman', 'Wijaya', 'Lim', 'Pham', 'Sok', 'Win', 'Tan', 'Ibrahim', 'Chea'] },
};

const FEMALE = new Set<string>();
for (const b of [...Object.values(B), ...Object.values(R)]) for (const n of b.f) FEMALE.add(n);
for (const n of ['Sarah', 'Linda', 'Susan', 'Laura', 'Ada', 'Maria', 'Hana', 'Amina', 'Zara', 'Leila', 'Clara', 'Julia', 'Olivia', 'Aroha', 'Lily', 'Kiri']) FEMALE.add(n);
export const isFemaleName = (name: string) => FEMALE.has(name.split(' ')[0]);

function feminize(l: string, kind?: Bank['fem']) {
  if (kind === 'polish') return l.replace(/ski$/, 'ska').replace(/cki$/, 'cka').replace(/dzki$/, 'dzka');
  if (kind === 'czech') return /ý$/.test(l) ? l.replace(/ý$/, 'á') : /[aeiou]$/.test(l) ? `${l.slice(0, -1)}ová` : `${l}ová`;
  if (kind === 'slavic') return /(ov|ev|in|yn)$/.test(l) ? `${l}a` : /sky$/.test(l) ? l.replace(/sky$/, 'skaya') : l;
  return l;
}

const bankOf = (c: Pick<Country, 'name' | 'region'> & { key?: string; culture?: string }) => B[c.culture ?? keyOf(c)] ?? R[c.region] ?? R.EU;

/**
 * A fictional name for someone from country c. `r1`..`r3` are uniform random numbers (deterministic upstream).
 * Politicians are women about 30% of the time in democracies, less elsewhere; generals rarely.
 */
export function nationalName(c: Pick<Country, 'name' | 'region' | 'gov'>, r1: number, r2: number, r3: number, role: 'politician' | 'general' = 'politician'): string {
  const b = bankOf(c);
  const pf = role === 'general' ? 0.06 : c.gov === 'D' ? 0.32 : c.gov === 'F' ? 0.2 : 0.1;
  const female = r1 < pf;
  const first = (female ? b.f : b.m)[Math.floor(r2 * (female ? b.f : b.m).length)];
  const last = b.l[Math.floor(r3 * b.l.length)];
  return `${first} ${female ? feminize(last, b.fem) : last}`;
}
