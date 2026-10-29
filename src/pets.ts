import { TIME_SCALE, realMs } from "./clock.ts";
import { db, transaction } from "./db.ts";
import { record } from "./feed.ts";
import { randomUUID } from "node:crypto";
import {
  ABILITIES, battleTraining, startBattle, takeBattleTurn, forfeitBattle, mainAttribute, maxHpFor, maxMpFor, balancedStats, type ActiveBattle, type AbilityId, type Battle,
} from "./combat.ts";
import { inventoryFor, grantTreasure } from "./inventory.ts";
import { JOBS, SKILLS, jobLevel, type JobId } from './skills.ts';
import { logEvent, ROOM } from "./logging.ts";
import { clientsInRoom } from "./realtime.ts";
import { isCoinId, type CoinId } from "./treasure.ts";

// Keep this literal list identical to public/app.js: the unbundled browser
// cannot import this server module (which opens SQLite).
export const APPEARANCES = ["cat", "dog", "hedgehog", "lizard", "panda", "bird", "dragon", "blob"] as const;
export type Appearance = (typeof APPEARANCES)[number];
export const isAppearance = (value: unknown): value is Appearance => APPEARANCES.some((a) => a === value);

export const SKILL_LOADOUTS = [
  { id: "adventure", name: "Adventure" },
  { id: "arena", name: "Arena" },
  { id: "support", name: "Support" },
] as const;
type SkillLoadoutId = (typeof SKILL_LOADOUTS)[number]["id"];
const isSkillLoadoutId = (value: unknown): value is SkillLoadoutId => SKILL_LOADOUTS.some(slot => slot.id === value);

export interface Pet extends ReturnType<typeof inventoryFor> {
  id: string;
  color: string;
  appearance: Appearance;
  strength: number;
  intelligence: number;
  charisma: number;
  money: number;
  stealAvailableAt: number | null; // next UTC midnight after a successful theft
  suppliesAvailableAt: number | null; // next UTC midnight after collecting the free daily supplies
  activity: "idle" | "studying" | "working";
  task: string | null; // the course or location, while busy
  busySince: number | null; // epoch ms (real time) the activity started
  busyUntil: number | null; // epoch ms (real time) the activity ends
  reward: Reward | null; // paid out when it ends
  school: SchoolId;
  credits: number;
  stamina: number;
  hygiene: number;
  food: number;
  soap: number;
  hourglass: number;
  jobs: Record<LocationId, number>; // index into that location's ranks
  skillJobs: Partial<Record<JobId, number>>; // completed game minutes per specialization
  combat?: { type: string; maxHp: number; maxMp: number; balanced: boolean };
  wins: number;
  losses: number;
  equippedCoin: CoinId | null; // global to the pet; applies in Adventure, Arena, and revenge
  equippedAbilities: AbilityId[];
  skillLoadouts: Partial<Record<SkillLoadoutId, AbilityId[]>>;
}

// Always there to fight, so a new player has someone to test themselves on.
export const BOT_ID = "0";

export type Attribute = "strength" | "intelligence" | "charisma";
const ATTRIBUTES: Attribute[] = ["strength", "intelligence", "charisma"];

type Care = "stamina" | "hygiene";
export type Reward = Record<Attribute, number> & { money: number; credits: number; job?: { id: JobId; minutes: number } };
type Needs = Record<Care, number>;

// Stamina and hygiene both run from 0 to this; new pets start full.
export const MAX_CARE = 100;

// In order. Each lesson earns one credit; `creditsToAdvance` of them moves the
// pet up a level (credits reset), and each level's lessons are worth more.
// High school is the top, so its credits just keep counting.
export const SCHOOLS = [
  { id: "primary", name: "Primary school", gain: 1, creditsToAdvance: 5 },
  { id: "middle", name: "Middle school", gain: 2, creditsToAdvance: 10 },
  { id: "high", name: "High school", gain: 3, creditsToAdvance: null },
] as const;
export type SchoolId = (typeof SCHOOLS)[number]["id"];

// `attribute: null` spreads the lesson's points over random attributes.
export const COURSES = [
  { id: "math", name: "Math", attribute: "intelligence" },
  { id: "pe", name: "PE", attribute: "strength" },
  { id: "drama", name: "Drama", attribute: "charisma" },
  { id: "electives", name: "Electives", attribute: null },
] as const satisfies readonly { id: string; name: string; attribute: Attribute | null }[];
export type CourseId = (typeof COURSES)[number]["id"];

// An hour at a location pays its rank's wage plus $1 per point of its
// attribute. Every pet starts in the first rank everywhere, and can upgrade to
// the next once its attribute reaches `requires`. Attributes start at 5, so an
// hour always pays at least $25.
export const LOCATIONS = [
  {
    id: "construction", name: "Construction site", attribute: "strength",
    ranks: [
      { title: "Labourer", wage: 20, requires: 0 },
      { title: "Foreman", wage: 40, requires: 20 },
      { title: "Site manager", wage: 70, requires: 50 },
    ],
  },
  {
    id: "office", name: "Office", attribute: "intelligence",
    ranks: [
      { title: "Clerk", wage: 20, requires: 0 },
      { title: "Analyst", wage: 40, requires: 20 },
      { title: "Director", wage: 70, requires: 50 },
    ],
  },
  {
    id: "theatre", name: "Theatre", attribute: "charisma",
    ranks: [
      { title: "Usher", wage: 20, requires: 0 },
      { title: "Actor", wage: 40, requires: 20 },
      { title: "Star", wage: 70, requires: 50 },
    ],
  },
] as const satisfies readonly {
  id: string;
  name: string;
  attribute: Attribute;
  ranks: readonly { title: string; wage: number; requires: number }[];
}[];
export type LocationId = (typeof LOCATIONS)[number]["id"];

// Activities take game time. Costs are paid up front; the reward is fixed at
// the start and paid out when the activity ends.
export const STUDY_MINUTES = 30;
export const SHIFT_MINUTES = [15, 30, 60, 120, 240] as const;

// Studying wears a pet out; working mostly gets it dirty. A shift's costs and
// pay scale with its length from these hourly rates.
export const STUDY_COST: Needs = { stamina: 20, hygiene: 10 };
export const WORK_COST_PER_HOUR: Needs = { stamina: 10, hygiene: 20 };
export const shiftCost = (minutes: number): Needs => ({
  stamina: Math.ceil((WORK_COST_PER_HOUR.stamina * minutes) / 60),
  hygiene: Math.ceil((WORK_COST_PER_HOUR.hygiene * minutes) / 60),
});

// A pet with no money can only recover by working, so studying never takes it
// below what an hour's shift needs, and an hour always pays at least $25:
// enough for one of every shop item. A pet can always earn its way back.
export const STUDY_NEEDS: Needs = {
  stamina: STUDY_COST.stamina + WORK_COST_PER_HOUR.stamina,
  hygiene: STUDY_COST.hygiene + WORK_COST_PER_HOUR.hygiene,
};

// Items restore a need, or (the hourglass) finish the pet's lesson or shift
// on the spot, paying its reward as if it had run its full time.
export const ITEMS = [
  { id: "food", name: "Food", price: 15, effect: "restore", restores: "stamina", amount: 40 },
  { id: "soap", name: "Soap", price: 10, effect: "restore", restores: "hygiene", amount: 50 },
  { id: "hourglass", name: "Hourglass", price: 150, effect: "skip" },
] as const satisfies readonly (
  | { id: keyof Pet; name: string; price: number; effect: "restore"; restores: Care; amount: number }
  | { id: keyof Pet; name: string; price: number; effect: "skip" }
)[];
export type ItemId = (typeof ITEMS)[number]["id"];

export const findCourse = (id: string) => COURSES.find((c) => c.id === id);
export const findItem = (id: string) => ITEMS.find((i) => i.id === id);
export const findLocation = (id: string) => LOCATIONS.find((l) => l.id === id);

// Player IDs end up in URLs and the UI, so keep them to a plain, short shape.
export const isValidId = (id: unknown): id is string =>
  typeof id === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(id);

const select = db.prepare(
  `SELECT id, color, appearance, strength, intelligence, charisma, money, activity, school, credits, stamina, hygiene, food, soap,
          hourglass, construction_rank, office_rank, theatre_rank, task, busy_since, busy_until, reward, wins, losses,
          steal_available_at AS stealAvailableAt, supplies_available_at AS suppliesAvailableAt, equipped_coin AS equippedCoin,
          equipped_abilities AS equippedAbilities, skill_loadouts AS skillLoadouts, skill_jobs AS skillJobs
     FROM pets WHERE id = ?`,
);
// The bot first, then the newest pets, so a player who just joined is easy to
// find. Newest means inserted last (rowid), not created_at: that's only to the
// second, and follows the wall clock, which can jump backwards.
const listIds = db.prepare("SELECT id FROM pets ORDER BY id = ? DESC, rowid DESC LIMIT ?");
const busyPets = db.prepare("SELECT id, busy_until FROM pets WHERE busy_until IS NOT NULL");
const insert = db.prepare("INSERT OR IGNORE INTO pets (id) VALUES (?)");
const save = db.prepare(
  // Only stealing changes steal_available_at, and only collecting the free
  // supplies changes supplies_available_at; ordinary actions preserve both.
  `UPDATE pets SET strength = ?, intelligence = ?, charisma = ?, money = ?, school = ?, credits = ?,
     stamina = ?, hygiene = ?, food = ?, soap = ?, hourglass = ?, construction_rank = ?, office_rank = ?, theatre_rank = ?,
     activity = ?, task = ?, busy_since = ?, busy_until = ?, reward = ?, wins = ?, losses = ?, color = ?, appearance = ?,
     equipped_coin = ?, equipped_abilities = ?, skill_loadouts = ?, skill_jobs = ?
   WHERE id = ?`,
);

type Row = Omit<Pet, "jobs" | "skillJobs" | "combat" | "busySince" | "busyUntil" | "reward" | "abilities" | "coins" | "equippedAbilities" | "skillLoadouts"> & {
  skillJobs: string;
  equippedAbilities: string;
  skillLoadouts: string;
  construction_rank: number;
  office_rank: number;
  theatre_rank: number;
  busy_since: number | null;
  busy_until: number | null;
  reward: string | null;
};

export function getPet(id: string): Pet | undefined {
  const row = select.get(id) as Row | undefined;
  if (!row) return undefined;
  const { construction_rank, office_rank, theatre_rank, busy_since, busy_until, reward, equippedAbilities, skillLoadouts, skillJobs, ...pet } = row;
  return {
    ...pet,
    ...inventoryFor(id),
    equippedAbilities: JSON.parse(equippedAbilities) as AbilityId[],
    skillLoadouts: JSON.parse(skillLoadouts),
    skillJobs: JSON.parse(skillJobs),
    combat: { type: mainAttribute(pet), maxHp: maxHpFor(pet), maxMp: maxMpFor(pet), balanced: balancedStats(pet) },
    busySince: busy_since,
    busyUntil: busy_until,
    reward: reward === null ? null : (JSON.parse(reward) as Reward),
    jobs: { construction: construction_rank, office: office_rank, theatre: theatre_rank },
  };
}

// Pets in the middle of something, and when each one finishes.
export const busyUntilById = (): { id: string; busyUntil: number }[] =>
  (busyPets.all() as { id: string; busy_until: number }[]).map((r) => ({ id: r.id, busyUntil: r.busy_until }));

export const listPets = (limit: number): Pet[] =>
  (listIds.all(BOT_ID, limit) as { id: string }[]).map((r) => getPet(r.id)!);

// The bot keeps pace with the players: each of its attributes is the median of
// the players' pets (rounded down, never below a new pet's), so it stays an
// even match for a typical player however far the game has moved on.
const playerStats = db.prepare(
  "SELECT strength, intelligence, charisma FROM pets WHERE id IN (SELECT id FROM accounts)",
);
const saveBotStats = db.prepare("UPDATE pets SET strength = ?, intelligence = ?, charisma = ? WHERE id = ?");
const BASE_ATTRIBUTE = 5;

function median(values: number[]): number {
  if (values.length === 0) return BASE_ATTRIBUTE;
  values.sort((a, b) => a - b);
  const mid = values.length >> 1;
  const middle = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  return Math.max(BASE_ATTRIBUTE, Math.floor(middle));
}

// Brings the bot up (or down) to the players' median. Returns the bot as
// saved if that changed it, for the caller to broadcast.
export function matchBot(): Pet | undefined {
  const pets = playerStats.all() as Record<Attribute, number>[];
  const [strength, intelligence, charisma] = ATTRIBUTES.map((a) => median(pets.map((p) => p[a])));
  const bot = getPet(BOT_ID);
  if (!bot || (bot.strength === strength && bot.intelligence === intelligence && bot.charisma === charisma)) {
    return undefined;
  }
  saveBotStats.run(strength, intelligence, charisma, BOT_ID);
  return getPet(BOT_ID);
}

// The leaderboard: the top players' pets by fights won (fewer losses breaking
// ties) or by power, the earliest player first on a tie. The bot isn't competing.
export const LEADERBOARD_SIZE = 10;
export const LEADERBOARD_ORDERS = ["wins", "power"] as const;
export type LeaderboardOrder = (typeof LEADERBOARD_ORDERS)[number];
const topByWins = db.prepare(
  `SELECT id FROM pets WHERE id IN (SELECT id FROM accounts)
    ORDER BY wins DESC, losses ASC, rowid ASC LIMIT ?`,
);
const topByPower = db.prepare(
  `SELECT id FROM pets WHERE id IN (SELECT id FROM accounts)
    ORDER BY ? * strength + ? * intelligence + ? * charisma DESC, rowid ASC LIMIT ?`,
);

export const isLeaderboardOrder = (by: unknown): by is LeaderboardOrder =>
  LEADERBOARD_ORDERS.some((order) => order === by);

export function leaderboard(by: LeaderboardOrder): Pet[] {
  const rows =
    by === "wins"
      ? topByWins.all(LEADERBOARD_SIZE)
      : topByPower.all(POWER_WEIGHTS.strength, POWER_WEIGHTS.intelligence, POWER_WEIGHTS.charisma, LEADERBOARD_SIZE);
  return (rows as { id: string }[]).map((r) => getPet(r.id)!);
}

// Logging in with an unknown ID claims a new pet with the base stats.
export function getOrCreatePet(id: string): { pet: Pet; created: boolean } {
  const { changes } = insert.run(id);
  if (changes > 0 && id !== BOT_ID) record({ kind: "joined", pet: id });
  return { pet: getPet(id)!, created: changes > 0 };
}

// A refusal can still carry `settled`: an activity that ended just before the
// request, saved on the way, which clients need to hear about.
export type Outcome = { pet: Pet } | { status: 404 | 409 | 429; error: string; settled?: Pet };

const schoolOf = (pet: Pet) => SCHOOLS.findIndex((s) => s.id === pet.school);

// Pays out an activity that has ended, moving up a school level if its
// credit completes one. Returns whether there was one to finish.
function finishIfDue(pet: Pet, now: number): boolean {
  if (pet.busyUntil === null || pet.busyUntil > now) return false;
  const reward = pet.reward!;
  const activity = pet.activity;
  const task = pet.task;
  for (const attribute of ATTRIBUTES) pet[attribute] += reward[attribute];
  pet.money += reward.money;
  pet.credits += reward.credits;
  if (reward.job) pet.skillJobs = { ...pet.skillJobs, [reward.job.id]: (pet.skillJobs[reward.job.id] ?? 0) + reward.job.minutes };
  const level = schoolOf(pet);
  const school = SCHOOLS[level];
  if (school.creditsToAdvance !== null && pet.credits >= school.creditsToAdvance) {
    pet.school = SCHOOLS[level + 1].id;
    pet.credits = 0;
  }
  pet.activity = "idle";
  pet.task = null;
  pet.busySince = null;
  pet.busyUntil = null;
  pet.reward = null;
  logEvent("action_result", {
    user: pet.id, room: ROOM, client_in_room: clientsInRoom(), action: `${activity}_finished`,
    task: task ?? "", money: reward.money, credits: reward.credits,
  });
  return true;
}

// Saves the pet, and tells the feed if it just moved up a school or a job.
function write(pet: Pet): void {
  transaction(() => {
    const before = getPet(pet.id)!;
    save.run(
      pet.strength, pet.intelligence, pet.charisma, pet.money, pet.school, pet.credits,
      pet.stamina, pet.hygiene, pet.food, pet.soap, pet.hourglass,
      pet.jobs.construction, pet.jobs.office, pet.jobs.theatre,
      pet.activity, pet.task, pet.busySince, pet.busyUntil, pet.reward === null ? null : JSON.stringify(pet.reward),
      pet.wins, pet.losses, pet.color, pet.appearance, pet.equippedCoin, JSON.stringify(pet.equippedAbilities), JSON.stringify(pet.skillLoadouts), JSON.stringify(pet.skillJobs), pet.id,
    );
    for (const skill of SKILLS) {
      if (!pet.abilities.includes(skill.id) && skill.source.channel === 'job' && jobLevel(pet.skillJobs[skill.source.job] ?? 0) >= skill.source.level) {
        grantTreasure(pet.id, { category: 'ability', id: skill.id, name: skill.name, quantity: 1 });
      }
    }
    if (pet.school !== before.school) record({ kind: "school", pet: pet.id, school: pet.school });
    for (const location of LOCATIONS) {
      if (pet.jobs[location.id] > before.jobs[location.id]) {
        record({ kind: "promoted", pet: pet.id, location: location.id, rank: pet.jobs[location.id] });
      }
    }
  });
}

// Finishes the pet's activity if it's due. The scheduler calls this when one
// ends, passing `endedAt`, the end its timer counted down to: timers run on a
// steady clock, so that end has truly passed even if the wall clock has since
// jumped backwards. An activity ending later than that (a newer one) waits.
// `finished` says whether anything changed.
export function settle(id: string, endedAt = 0): { pet: Pet; finished: boolean } | undefined {
  const pet = getPet(id);
  if (!pet) return undefined;
  const finished = finishIfDue(pet, Math.max(Date.now(), endedAt));
  if (finished) write(pet);
  return { pet: finished ? getPet(id)! : pet, finished };
}

// Reads the pet, finishes any activity that's due, lets `change` edit it (or
// refuse with a reason), and writes it back. DatabaseSync is synchronous and
// the app is one process, so nothing can slip in between the read and write.
function act(id: string, change: (pet: Pet) => string | undefined): Outcome {
  const pet = getPet(id);
  if (!pet) return { status: 404, error: "no such pet" };
  const finished = finishIfDue(pet, Date.now());
  const next = { ...pet, jobs: { ...pet.jobs } };
  const refusal = combatBusy(id) ?? change(next);
  if (refusal) {
    if (!finished) return { status: 409, error: refusal };
    write(pet);
    return { status: 409, error: refusal, settled: getPet(id)! };
  }
  write(next);
  return { pet: getPet(id)! };
}

function busy(pet: Pet): string | undefined {
  const fighting = combatBusy(pet.id);
  if (fighting) return fighting;
  if (pet.activity === "idle") return undefined;
  const doing = pet.activity === "studying" ? `studying ${pet.task}` : `working at the ${pet.task}`;
  return `Your pet is busy ${doing}. Wait until it's done.`;
}

// For callers that don't settle the pet first: an activity whose time is up
// no longer keeps it busy, even before its timer pays it out.
export const busyNow = (pet: Pet, now = Date.now()): string | undefined =>
  combatBusy(pet.id) ?? (pet.busyUntil !== null && pet.busyUntil <= now ? undefined : busy(pet));

export function setAppearance(id: string, color: string, appearance: Appearance): Outcome {
  return act(id, (pet) => {
    pet.color = color;
    pet.appearance = appearance;
    return undefined;
  });
}

// Reusable equipment, not consumed: one coin (or none) applies to every fight
// this pet takes part in, in Adventure, Arena, and revenge alike.
export function equipCoin(id: string, coin: unknown): Outcome {
  return act(id, (pet) => {
    if (coin === null) { pet.equippedCoin = null; return undefined; }
    if (!isCoinId(coin)) return "Unknown coin.";
    if (pet.coins[coin] < 1) return "You don't have that coin to equip.";
    pet.equippedCoin = coin;
    return undefined;
  });
}

function validateSkills(pet: Pet, abilities: unknown): string | undefined {
  if (!Array.isArray(abilities) || abilities.length < 1 || abilities.length > 4
    || new Set(abilities).size !== abilities.length || !abilities.includes("claw-strike")) {
    return "Equip up to four different skills, including Claw Strike.";
  }
  if (abilities.some(ability => !ABILITIES.some(known => known.id === ability)
    || (ability !== "claw-strike" && !pet.abilities.includes(ability)))) return "You can only equip skills your pet has learned.";
  return undefined;
}

export function equipSkills(id: string, abilities: unknown): Outcome {
  return act(id, (pet) => {
    const refusal = validateSkills(pet, abilities);
    if (refusal) return refusal;
    pet.equippedAbilities = [...abilities as AbilityId[]];
    return undefined;
  });
}

export function saveSkillLoadout(id: string, slot: unknown, abilities: unknown): Outcome {
  return act(id, (pet) => {
    if (!isSkillLoadoutId(slot)) return "Unknown skill loadout.";
    const refusal = validateSkills(pet, abilities);
    if (refusal) return refusal;
    pet.skillLoadouts = { ...pet.skillLoadouts, [slot]: [...abilities as AbilityId[]] };
    return undefined;
  });
}

export function equipSkillLoadout(id: string, slot: unknown): Outcome {
  return act(id, (pet) => {
    if (!isSkillLoadoutId(slot)) return "Unknown skill loadout.";
    const abilities = pet.skillLoadouts[slot];
    if (!abilities) return "Save some skills in this loadout first.";
    const refusal = validateSkills(pet, abilities);
    if (refusal) return refusal;
    pet.equippedAbilities = [...abilities];
    return undefined;
  });
}

function start(pet: Pet, activity: Pet["activity"], task: string, minutes: number, reward: Reward): void {
  pet.activity = activity;
  pet.task = task;
  pet.busySince = Date.now();
  pet.busyUntil = pet.busySince + realMs(minutes);
  pet.reward = reward;
}

const noReward = (): Reward => ({ strength: 0, intelligence: 0, charisma: 0, money: 0, credits: 0 });

function spend(pet: Pet, needs: Needs, cost: Needs, doing: string): string | undefined {
  if (pet.stamina < needs.stamina) return `Too tired to ${doing}. Feed your pet first.`;
  if (pet.hygiene < needs.hygiene) return `Too dirty to ${doing}. Clean your pet first.`;
  pet.stamina -= cost.stamina;
  pet.hygiene -= cost.hygiene;
  return undefined;
}

export function study(id: string, courseId: CourseId): Outcome {
  return act(id, (pet) => {
    const refusal = busy(pet) ?? spend(pet, STUDY_NEEDS, STUDY_COST, "study");
    if (refusal) return refusal;
    const school = SCHOOLS[schoolOf(pet)];
    const course = findCourse(courseId)!;
    const reward = { ...noReward(), credits: 1 };
    for (let point = 0; point < school.gain; point++) {
      reward[course.attribute ?? ATTRIBUTES[Math.floor(Math.random() * ATTRIBUTES.length)]]++;
    }
    start(pet, "studying", course.name, STUDY_MINUTES, reward);
    return undefined;
  });
}

export const isShiftLength = (minutes: unknown): minutes is (typeof SHIFT_MINUTES)[number] =>
  SHIFT_MINUTES.some((m) => m === minutes);

// What an hour at the location pays this pet right now.
export const hourlyPay = (pet: Pet, locationId: LocationId): number => {
  const location = findLocation(locationId)!;
  return location.ranks[pet.jobs[location.id]].wage + pet[location.attribute];
};

export function work(id: string, locationId: LocationId, minutes: number, jobId?: unknown): Outcome {
  const location = findLocation(locationId)!;
  return act(id, (pet) => {
    const job = JOBS.find(j => j.id === (jobId ?? JOBS.find(j => j.location === locationId)!.id) && j.location === locationId);
    if (!job) return 'Choose a job specialization at this workplace.';
    const cost = shiftCost(minutes);
    const refusal = busy(pet) ?? spend(pet, cost, cost, "work");
    if (refusal) return refusal;
    const money = Math.round((hourlyPay(pet, locationId) * minutes) / 60);
    start(pet, "working", location.name, minutes, { ...noReward(), money, job: { id: job.id, minutes } });
    return undefined;
  });
}

export function upgrade(id: string, locationId: LocationId): Outcome {
  const location = findLocation(locationId)!;
  return act(id, (pet) => {
    const next = location.ranks[pet.jobs[location.id] + 1];
    if (!next) return `Already at the top of the ${location.name.toLowerCase()}.`;
    if (pet[location.attribute] < next.requires) {
      return `${next.title} needs ${next.requires} ${location.attribute}; your pet has ${pet[location.attribute]}.`;
    }
    pet.jobs[location.id]++;
    return undefined;
  });
}

export function buy(id: string, itemId: ItemId): Outcome {
  const item = findItem(itemId)!;
  return act(id, (pet) => {
    if (pet.money < item.price) return `Not enough money: ${item.name.toLowerCase()} costs $${item.price}.`;
    pet.money -= item.price;
    pet[item.id]++;
    return undefined;
  });
}

export function use(id: string, itemId: ItemId): Outcome {
  const item = findItem(itemId)!;
  return act(id, (pet) => {
    if (pet[item.id] < 1) return `No ${item.name.toLowerCase()} left. Buy some at the shop.`;
    if (item.effect === "skip") {
      if (pet.activity === "idle") return "Your pet isn't studying or working, so there's nothing to skip.";
      pet[item.id]--;
      // End it now and pay out; its timer finds nothing left when it fires.
      pet.busyUntil = Date.now();
      finishIfDue(pet, pet.busyUntil);
      return undefined;
    }
    if (pet[item.restores] >= MAX_CARE) return `Your pet's ${item.restores} is already full.`;
    pet[item.id]--;
    pet[item.restores] = Math.min(MAX_CARE, pet[item.restores] + item.amount);
    return undefined;
  });
}

// Charges the flat cost of starting a fresh adventure, refusing if the pet
// doesn't have enough stamina/hygiene to spare.
export function spendForAdventure(id: string): Outcome {
  return act(id, (pet) => spend(pet, ADVENTURE_COST, ADVENTURE_COST, "start another adventure"));
}

// Skips the adventure cooldown; unlike `use`, this isn't tied to a busy
// activity, so it only ever spends the hourglass.
export function consumeHourglass(id: string): Outcome {
  return act(id, (pet) => {
    if (pet.hourglass < 1) return "No hourglass left. Buy one at the shop.";
    pet.hourglass--;
    return undefined;
  });
}

// Calendar days use real UTC time, even on the accelerated activity clock.
const nextUtcMidnight = (now: number): number => {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next.getTime();
};

// Once per UTC day, a pet can collect free supplies into its normal stock.
// Missed days don't add up. The check and the grant are one statement, so
// competing requests can't both collect.
export const FREE_SUPPLIES = { food: 1, soap: 1, resetTimezone: "UTC" } as const;
const collectFree = db.prepare(
  `UPDATE pets SET food = food + ?, soap = soap + ?, supplies_available_at = ?
    WHERE id = ? AND (supplies_available_at IS NULL OR supplies_available_at <= ?)`,
);
export function collectSupplies(id: string): Outcome {
  if (!getPet(id)) return { status: 404, error: "no such pet" };
  const now = Date.now();
  const { changes } = collectFree.run(FREE_SUPPLIES.food, FREE_SUPPLIES.soap, nextUtcMidnight(now), id, now);
  if (changes === 0) return { status: 429, error: "You've already collected today's free supplies. More at midnight UTC." };
  return { pet: getPet(id)! };
}

// A battle victory's attribute gain, written by the caller's transaction
// together with the saved result it belongs to.
const growAttributes = db.prepare(
  "UPDATE pets SET strength = strength + ?, intelligence = intelligence + ?, charisma = charisma + ? WHERE id = ?",
);
export function train(id: string, gains: Partial<Record<Attribute, number>>): void {
  growAttributes.run(gains.strength ?? 0, gains.intelligence ?? 0, gains.charisma ?? 0, id);
}

// Fights ---------------------------------------------------------------------

// Strength counts double; brains and charm help too.
export const POWER_WEIGHTS: Record<Attribute, number> = { strength: 2, intelligence: 1, charisma: 1 };
export const powerOf = (pet: Pick<Pet, 'strength' | 'intelligence' | 'charisma'>): number =>
  ATTRIBUTES.reduce((power, attribute) => power + POWER_WEIGHTS[attribute] * pet[attribute], 0);

// Initiative and Claw Strike damage share a luck factor in [0.8, 1.2].
export const LUCK = { min: 0.8, max: 1.2 };

// Fighting is tiring, and like studying it leaves enough for an hour's work.
export const FIGHT_COST: Needs = { stamina: 10, hygiene: 5 };
export const FIGHT_NEEDS: Needs = {
  stamina: FIGHT_COST.stamina + WORK_COST_PER_HOUR.stamina,
  hygiene: FIGHT_COST.hygiene + WORK_COST_PER_HOUR.hygiene,
};

// The winner takes a share of the loser's money, so a fight puts something at
// stake for both sides. The bot is practice: nothing changes hands with it.
export const SPOILS = { share: 0.1, max: 50 };
export const spoilsFrom = (loser: Pet): number => Math.min(SPOILS.max, Math.floor(loser.money * SPOILS.share));

// After attacking a pet, the attacker waits this long (game time) before
// attacking that same pet again, so a strong pet can't drain a weak one. The
// defender can hit back straight away, and the bot never makes anyone wait.
export const FIGHT_COOLDOWN_MINUTES = 60;

// Starting a fresh adventure (after winning, failing, or abandoning one in
// progress) costs this outright, with no extra buffer: an adventure doesn't
// keep running after you leave, unlike a lesson or shift.
export const ADVENTURE_COST: Needs = { stamina: 40, hygiene: 20 };
export const ADVENTURE_COOLDOWN_MINUTES = 240;

export interface Fight {
  id: number;
  attacker: string;
  defender: string;
  winner: string;
  attackerPower: number;
  defenderPower: number;
  attackerRoll: number;
  defenderRoll: number;
  spoils: number; // money the winner took from the loser
  foughtAt: string;
  battle: Battle | null; // legacy fights have no replay
}

const insertFight = db.prepare(
  `INSERT INTO fights (attacker, defender, winner, attacker_power, defender_power, attacker_roll, defender_roll, spoils, battle_json)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const FIGHT_COLUMNS = `id, attacker, defender, winner, attacker_power AS attackerPower,
  defender_power AS defenderPower, attacker_roll AS attackerRoll, defender_roll AS defenderRoll,
  spoils, fought_at AS foughtAt, battle_json AS battleJson`;
const selectFight = db.prepare(`SELECT ${FIGHT_COLUMNS} FROM fights WHERE id = ?`);
const fightsFor = db.prepare(
  `SELECT ${FIGHT_COLUMNS} FROM fights WHERE attacker = ? OR defender = ? ORDER BY id DESC LIMIT ?`,
);
const lastAttack = db.prepare(
  "SELECT fought_at AS foughtAt FROM fights WHERE attacker = ? AND defender = ? ORDER BY id DESC LIMIT 1",
);
const begin = db.prepare("BEGIN IMMEDIATE");
const commit = db.prepare("COMMIT");
const rollback = db.prepare("ROLLBACK");

type FightRow = Omit<Fight, "battle"> & { battleJson: string | null };
function readFight(row: unknown): Fight {
  const { battleJson, ...fight } = row as FightRow;
  return { ...fight, battle: battleJson ? JSON.parse(battleJson) as Battle : null };
}
export const recentFights = (id: string, limit: number): Fight[] => fightsFor.all(id, id, limit).map(readFight);

const roll = (power: number): number => power * (LUCK.min + Math.random() * (LUCK.max - LUCK.min));
// Rolls are compared exactly and only rounded for the record, so rounding
// can't turn a sure win into a tie.
const tenths = (n: number): number => Math.round(n * 10) / 10;

export type FightOutcome =
  | { session: BattleSession; fight?: Fight; attacker: Pet; defender: Pet }
  | { status: 400 | 404 | 409 | 429; error: string };

// Why the attacker can't attack this defender again yet, if it can't.
function cooldown(attacker: Pet, defender: Pet, now: number): string | undefined {
  if (defender.id === BOT_ID) return undefined;
  const last = lastAttack.get(attacker.id, defender.id) as { foughtAt: string } | undefined;
  if (!last) return undefined;
  // Capped, so a wall clock that jumped backwards can't stretch the wait.
  const left = Math.min(realMs(FIGHT_COOLDOWN_MINUTES), Date.parse(last.foughtAt) + realMs(FIGHT_COOLDOWN_MINUTES) - now);
  if (left <= 0) return undefined;
  const minutes = Math.max(1, Math.ceil((left * TIME_SCALE) / 60_000));
  return `You attacked ${defender.id} recently; you can attack them again in ${minutes} min.`;
}

// Starting a fight saves its turn state and pays the starting cost once.
export function fight(attackerId: string, defenderId: string): FightOutcome {
  return transaction(() => {
    if (attackerId === defenderId) return { status: 400, error: "A pet can't fight itself." };
    const attacker = getPet(attackerId), defender = getPet(defenderId);
    if (!attacker) return { status: 404, error: "no such pet" };
    if (!defender) return { status: 404, error: `There's no pet called ${defenderId}.` };
    const now = Date.now();
    finishIfDue(attacker, now); finishIfDue(defender, now);
    const refusal = busy(attacker) ?? busy(defender);
    if (refusal) return { status: 409, error: refusal };
    const waiting = cooldown(attacker, defender, now);
    if (waiting) return { status: 429, error: waiting };
    const unfit = spend(attacker, FIGHT_NEEDS, FIGHT_COST, "fight");
    if (unfit) return { status: 409, error: unfit };
    const rolls = [roll(powerOf(attacker)), roll(powerOf(defender))];
    const battle = startBattle([attacker], defender, rolls, { mode: 'pvp', automaticIds: [BOT_ID] });
    const powers = [attacker, defender].map((pet, index) =>
      powerOf(pet) + (battle.coinProvider === index && battle.initiative?.coin === 'copper-coin' ? 4 : 0));
    write(attacker); write(defender);
    const session = createBattleSession('arena', attacker.id, defender.id, null, battle, {
      attackerPower: powers[0], defenderPower: powers[1],
      attackerRoll: tenths(rolls[0] * powers[0] / powerOf(attacker)),
      defenderRoll: tenths(rolls[1] * powers[1] / powerOf(defender)),
    });
    return { session, ...session.result, attacker: getPet(attacker.id)!, defender: getPet(defender.id)! };
  });
}

// Visits and stealing --------------------------------------------------------

// Calendar days use real UTC time, even on the accelerated activity clock.
export const STEAL = { min: 10, max: 30, resetTimezone: "UTC" } as const;
const protectFromTheft = db.prepare("UPDATE pets SET steal_available_at = ? WHERE id = ?");

export type StealOutcome =
  | { thief: Pet; victim: Pet; amount: number }
  | { status: 400 | 404 | 409 | 429; error: string };

export function steal(thiefId: string, victimId: string): StealOutcome {
  if (thiefId === victimId) return { status: 400, error: "You can't steal from your own pet." };
  if (thiefId === BOT_ID || victimId === BOT_ID) {
    return { status: 400, error: "The bot doesn't take part in stealing." };
  }
  // Lock before checking the target. The two balances, daily protection and
  // feed entry all commit together; a competing visitor must check again.
  begin.run();
  let committed = false;
  try {
    const thief = getPet(thiefId);
    const victim = getPet(victimId);
    if (!thief) return { status: 404, error: "no such pet" };
    if (!victim) return { status: 404, error: `There's no pet called ${victimId}.` };
    const refusal = combatBusy(thiefId) ?? combatBusy(victimId);
    if (refusal) return { status: 409, error: refusal };
    const now = Date.now();
    if (victim.stealAvailableAt !== null && now < victim.stealAvailableAt) {
      return { status: 429, error: "Someone already stole from this pet today. Try after midnight UTC." };
    }
    finishIfDue(thief, now);
    finishIfDue(victim, now);
    if (victim.money < STEAL.min) {
      return { status: 409, error: `This pet needs at least $${STEAL.min} before you can steal.` };
    }
    const amount = STEAL.min + Math.floor(Math.random() * (Math.min(STEAL.max, victim.money) - STEAL.min + 1));
    thief.money += amount;
    victim.money -= amount;
    write(thief);
    write(victim);
    protectFromTheft.run(nextUtcMidnight(now), victimId);
    insertTheft.run(thiefId, victimId, amount);
    record({ kind: "stole", pet: thiefId, other: victimId, amount });
    commit.run();
    committed = true;
    return { thief: getPet(thiefId)!, victim: getPet(victimId)!, amount };
  } finally {
    if (!committed) rollback.run();
  }
}


// Helping: a visitor feeds or cleans someone else's pet with Food or Soap from
// their own cupboard. Both pets change together, or neither does.
export type HelpOutcome =
  | { helper: Pet; pet: Pet; item: "food" | "soap"; amount: number }
  | { status: 400 | 404 | 409; error: string };

export function help(helperId: string, petId: string, itemId: "food" | "soap"): HelpOutcome {
  if (helperId === petId) return { status: 400, error: "Feed and clean your own pet from Care & shop." };
  if (helperId === BOT_ID || petId === BOT_ID) return { status: 400, error: "The bot looks after itself." };
  const item = ITEMS.find((i) => i.id === itemId)!;
  if (item.effect !== "restore") return { status: 400, error: "Only Food and Soap help another pet." };
  return transaction(() => {
    const helper = getPet(helperId);
    const pet = getPet(petId);
    if (!helper) return { status: 404, error: "no such pet" };
    if (!pet) return { status: 404, error: `There's no pet called ${petId}.` };
    const now = Date.now();
    finishIfDue(helper, now);
    finishIfDue(pet, now);
    if (helper[item.id] < 1) {
      return { status: 409, error: `You have no ${item.name.toLowerCase()} to give. Buy some at the shop.` };
    }
    if (pet[item.restores] >= MAX_CARE) return { status: 409, error: `${petId}'s ${item.restores} is already full.` };
    const amount = Math.min(MAX_CARE, pet[item.restores] + item.amount) - pet[item.restores];
    helper[item.id]--;
    pet[item.restores] += amount;
    write(helper);
    write(pet);
    record({ kind: "helped", pet: helperId, other: petId, item: item.id });
    return { helper: getPet(helperId)!, pet: getPet(petId)!, item: item.id, amount };
  });
}

// Theft reports survive feed pruning and are consumed only by a completed revenge.
export interface Theft {
  id: number;
  thief: string;
  victim: string;
  amount: number;
  stolenAt: string;
  result: "won" | "lost" | null;
}
const insertTheft = db.prepare("INSERT INTO thefts (thief, victim, amount) VALUES (?, ?, ?)");
const theftColumns = "id, thief, victim, amount, stolen_at AS stolenAt, result";
const selectTheft = db.prepare(`SELECT ${theftColumns} FROM thefts WHERE id = ? AND victim = ?`);
const pendingThefts = db.prepare(`SELECT ${theftColumns} FROM thefts WHERE victim = ? AND result IS NULL ORDER BY id DESC`);
const resolveTheft = db.prepare("UPDATE thefts SET result = ?, resolved_at = ?, battle_json = ? WHERE id = ?");
export const theftsFor = (id: string): Theft[] => pendingThefts.all(id) as unknown as Theft[];

export type RevengeOutcome =
  | { session: BattleSession; theft: Theft; victim: Pet; thief: Pet; won?: boolean; reward?: number; battle?: ActiveBattle }
  | { status: 404 | 409; error: string };

export function revenge(victimId: string, theftId: number): RevengeOutcome {
  return transaction(() => {
    const theft = selectTheft.get(theftId, victimId) as unknown as Theft | undefined;
    if (!theft) return { status: 404, error: "No such theft against your pet." };
    if (theft.result) return { status: 409, error: "You already attempted revenge for this theft." };
    const victim = getPet(victimId)!, thief = getPet(theft.thief)!;
    const now = Date.now();
    finishIfDue(victim, now); finishIfDue(thief, now);
    const refusal = busy(victim) ?? busy(thief);
    if (refusal) return { status: 409, error: refusal };
    const reward = theft.amount * 2;
    if (thief.money < reward) return { status: 409, error: `The thief needs $${reward} to pay the full reward. Try again later.` };
    const unfit = spend(victim, FIGHT_NEEDS, FIGHT_COST, "take revenge");
    if (unfit) return { status: 409, error: unfit };
    const battle = startBattle([victim], thief, [roll(powerOf(victim)), roll(powerOf(thief))], { mode: 'pvp' });
    write(victim); write(thief);
    const session = createBattleSession('revenge', victim.id, thief.id, theft.id, battle, {});
    return { session, theft, ...session.result, victim: getPet(victimId)!, thief: getPet(thief.id)! };
  });
}

export interface BattleSession {
  id: string;
  kind: 'arena' | 'revenge';
  attacker: string;
  defender: string;
  sourceId: number | null;
  battle: ActiveBattle;
  result?: { fight?: Fight; theft?: Theft; won?: boolean; reward?: number; trained?: Training };
}
// The attribute a winning pet gained, saved with the result it came from.
export interface Training { pet: string; attribute: Attribute; amount: number }
interface SessionRow {
  id: string; kind: BattleSession['kind']; player_a: string; player_b: string; source_id: number | null;
  state_json: string; meta_json: string; result_json: string | null;
}
const selectSession = db.prepare('SELECT * FROM manual_battles WHERE id = ? AND (player_a = ? OR player_b = ?)');
const selectActiveSessions = db.prepare("SELECT * FROM manual_battles WHERE status = 'active' AND (player_a = ? OR player_b = ?)");
function sessionFrom(row: SessionRow): BattleSession {
  return { id: row.id, kind: row.kind, attacker: row.player_a, defender: row.player_b, sourceId: row.source_id,
    battle: JSON.parse(row.state_json) as ActiveBattle, ...(row.result_json ? { result: JSON.parse(row.result_json) } : {}) };
}
export function battleSessionsFor(id: string): BattleSession[] {
  return (selectActiveSessions.all(id, id) as unknown as SessionRow[]).map(sessionFrom);
}
export function battleSessionFor(id: string, battleId: string): BattleSession | undefined {
  const row = selectSession.get(battleId, id, id) as unknown as SessionRow | undefined;
  return row ? sessionFrom(row) : undefined;
}
// The bot is a reusable training partner; every human pet has one live fight.
export function combatBusy(id: string): string | undefined {
  if (id === BOT_ID) return undefined;
  if (selectActiveSessions.get(id, id)) return 'Your pet is busy in a battle. Finish it or forfeit first.';
  const row = db.prepare('SELECT battle_json, abandoned FROM adventures WHERE player_id = ?').get(id) as { battle_json: string | null; abandoned: number } | undefined;
  if (row?.battle_json && !row.abandoned) {
    const wrapper = JSON.parse(row.battle_json) as { pending: boolean; playback?: ActiveBattle };
    const battle = wrapper.playback, mine = battle?.fighters.findIndex(fighter => fighter.id === id) ?? -1;
    if (wrapper.pending && battle?.status === 'active' && mine >= 0 && battle.hp[mine] > 0) {
      return 'Your pet is busy in an Adventure battle. Finish it or forfeit first.';
    }
  }
  return undefined;
}
function createBattleSession(kind: BattleSession['kind'], attacker: string, defender: string, sourceId: number | null,
  battle: ActiveBattle, metadata: Record<string, number>): BattleSession {
  const id = randomUUID();
  db.prepare('INSERT INTO manual_battles (id, kind, player_a, player_b, source_id, status, state_json, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, kind, attacker, defender, sourceId, battle.status, JSON.stringify(battle), JSON.stringify(metadata));
  if (battle.status === 'finished') {
    const outcome = actInBattle(attacker, id, 'turn', 'claw-strike', battle.revision);
    if ('error' in outcome) throw new Error(outcome.error);
    return outcome.session;
  }
  return battleSessionFor(attacker, id)!;
}
export type BattleSessionOutcome = {
  session: BattleSession; attacker: Pet; defender: Pet; fight?: Fight;
  theft?: Theft; won?: boolean; reward?: number; trained?: Training; battle?: ActiveBattle; victim?: Pet; thief?: Pet;
} | { status: number; error: string };
function sessionOutcome(session: BattleSession): Exclude<BattleSessionOutcome, { error: string }> {
  const attacker = getPet(session.attacker)!, defender = getPet(session.defender)!;
  return { session, attacker, defender, ...session.result,
    ...(session.kind === 'revenge' ? { victim: attacker, thief: defender, battle: session.battle } : {}) };
}
export function actInBattle(id: string, battleId: string, action: 'turn' | 'forfeit', ability: unknown, revision: unknown): BattleSessionOutcome {
  return transaction(() => {
    const row = selectSession.get(battleId, id, id) as unknown as SessionRow | undefined;
    if (!row) return { status: 404, error: 'No such battle for your pet.' };
    const session = sessionFrom(row);
    if (!Number.isSafeInteger(revision) || (revision as number) < 0) return { status: 400, error: 'A valid turn revision is required.' };
    // Retrying an accepted request returns its saved state, without another turn.
    if ((revision as number) < session.battle.revision || session.result) return sessionOutcome(session);
    const battle = session.battle.status === 'finished' ? session.battle
      : action === 'forfeit' ? forfeitBattle(session.battle, id, revision) : takeBattleTurn(session.battle, id, ability, revision);
    if ('error' in battle) return battle;
    const result: NonNullable<BattleSession['result']> = {};
    if (battle.status === 'finished') {
      const attacker = getPet(session.attacker)!, defender = getPet(session.defender)!;
      const won = battle.winner === attacker.id;
      if (session.kind === 'arena') {
        const winner = won ? attacker : defender, loser = won ? defender : attacker;
        winner.wins++; loser.losses++;
        const practice = attacker.id === BOT_ID || defender.id === BOT_ID;
        const spoils = practice ? 0 : spoilsFrom(loser);
        loser.money -= spoils; winner.money += spoils;
        // Beating another player trains the attribute behind the winning blow.
        // The bot is practice, with no cooldown, so it trains nothing.
        const trained = practice ? undefined : battleTraining(battle, won ? 0 : 1);
        if (trained) {
          winner[trained]++;
          result.trained = { pet: winner.id, attribute: trained, amount: 1 };
        }
        write(attacker); write(defender);
        const metadata = JSON.parse(row.meta_json) as Record<string, number>;
        const { lastInsertRowid } = insertFight.run(attacker.id, defender.id, winner.id,
          metadata.attackerPower, metadata.defenderPower, metadata.attackerRoll, metadata.defenderRoll, spoils, JSON.stringify(battle));
        result.fight = readFight(selectFight.get(lastInsertRowid));
        record({ kind: 'fight', pet: attacker.id, other: defender.id, winner: winner.id, spoils });
      } else {
        const theft = selectTheft.get(session.sourceId, attacker.id) as unknown as Theft;
        const reward = won ? theft.amount * 2 : 0;
        if (won) { defender.money -= reward; attacker.money += reward; attacker.strength++; attacker.intelligence++; attacker.charisma++; }
        write(attacker); write(defender);
        resolveTheft.run(won ? 'won' : 'lost', new Date().toISOString(), JSON.stringify(battle), theft.id);
        result.theft = { ...theft, result: won ? 'won' : 'lost' }; result.won = won; result.reward = reward;
        record({ kind: 'revenge', pet: attacker.id, other: defender.id, won, amount: reward });
      }
    }
    db.prepare('UPDATE manual_battles SET status = ?, state_json = ?, result_json = ? WHERE id = ?')
      .run(battle.status, JSON.stringify(battle), battle.status === 'finished' ? JSON.stringify(result) : null, session.id);
    return sessionOutcome(battleSessionFor(id, session.id)!);
  });
}
