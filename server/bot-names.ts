/**
 * The house roster.
 *
 * One hundred Nepali first names, fifty boys and fifty girls, so a table of
 * bots reads like a table of people from Kathmandu rather than "Bot 2" and
 * "Bot 3". The pairing is first name + surname, which is how a Nepali name is
 * actually written in Latin script, and it also keeps two seats from showing
 * the same string.
 *
 * Names are data, not logic: no gender is inferred from a name and nothing in
 * the game branches on `gender` — it exists so the client can pick a matching
 * avatar instead of putting a girl's name over a boy's portrait.
 */

export type BotGender = "boy" | "girl";

export type BotName = { name: string; gender: BotGender };

const BOYS = [
  "Aarav", "Aayush", "Abhishek", "Anish", "Anup", "Arjun", "Ashish", "Avinash",
  "Bibek", "Bikash", "Bikram", "Binod", "Bipin", "Bishal", "Deepak", "Dipesh",
  "Ganesh", "Hari", "Hemant", "Kamal", "Kiran", "Krishna", "Lalit", "Mahesh",
  "Manish", "Milan", "Nabin", "Naresh", "Nirajan", "Nischal", "Pradeep",
  "Prakash", "Prashant", "Rajan", "Rajesh", "Rakesh", "Ramesh", "Rohan",
  "Rohit", "Roshan", "Sabin", "Sagar", "Sajan", "Sanjay", "Santosh", "Saroj",
  "Shishir", "Suman", "Suraj", "Umesh"
];

const GIRLS = [
  "Aakriti", "Aashma", "Anjali", "Anisha", "Anita", "Anu", "Archana", "Asmita",
  "Barkha", "Barsha", "Bimala", "Binita", "Bipana", "Chanda", "Dipa", "Dipika",
  "Gita", "Goma", "Ishika", "Jamuna", "Kabita", "Kalpana", "Kamala", "Karuna",
  "Laxmi", "Lila", "Manisha", "Meena", "Nirmala", "Nisha", "Pooja", "Pratima",
  "Priyanka", "Rabina", "Rachana", "Radha", "Rekha", "Renuka", "Rojina",
  "Roshani", "Sabina", "Sabita", "Sadhana", "Samjhana", "Sangita", "Sarita",
  "Shanti", "Sharmila", "Shreya", "Sita"
];

const SURNAMES = [
  "Sharma", "Thapa", "Gurung", "Shrestha", "Rai", "Magar", "Karki", "Adhikari",
  "Bhatta", "Poudel", "Lama", "Tamang", "Chaudhary", "Yadav", "Mandal", "Jha",
  "Khanal", "Pandey", "Bhandari", "Subedi", "Ojha", "Dhakal", "Basnet",
  "Khadka", "Bista", "Rana", "Malla", "Shahi", "Koirala", "Acharya"
];

/** The full roster, boys first, so it is obvious at a glance that it is 50/50. */
export const BOT_ROSTER: readonly BotName[] = [
  ...BOYS.map((name): BotName => ({ name, gender: "boy" })),
  ...GIRLS.map((name): BotName => ({ name, gender: "girl" }))
];

/** A flat list of first names, for anything that only needs a label. */
export const BOT_NAME_LIST: readonly string[] = BOT_ROSTER.map((bot) => bot.name);

function surname(random: () => number): string {
  return SURNAMES[Math.floor(random() * SURNAMES.length)] as string;
}

/**
 * One random bot, full name. Gender travels with it so the seat can be dressed
 * before it is named.
 */
export function randomBotName(random: () => number = Math.random): BotName {
  const pick = BOT_ROSTER[Math.floor(random() * BOT_ROSTER.length)] as BotName;
  return { name: `${pick.name} ${surname(random)}`, gender: pick.gender };
}

/**
 * `count` distinct bots for one table, alternating boys and girls so a 3-seat
 * fill does not come back as three boys. Distinct by first name, which is what
 * a player actually reads across the table.
 */
export function drawBotRoster(count: number, random: () => number = Math.random): BotName[] {
  const boys = [...BOYS];
  const girls = [...GIRLS];
  const picked: BotName[] = [];

  for (let i = 0; i < count; i += 1) {
    const pool = i % 2 === 0 ? boys : girls;
    const other = i % 2 === 0 ? girls : boys;
    const source = pool.length > 0 ? pool : other;
    const index = Math.floor(random() * source.length);
    const [first] = source.splice(index, 1);
    if (!first) break;
    picked.push({ name: `${first} ${surname(random)}`, gender: i % 2 === 0 ? "boy" : "girl" });
  }

  return picked;
}
