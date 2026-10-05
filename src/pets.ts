import { TIME_SCALE, realMs } from "./clock.ts";
import { db } from "./db.ts";
import { record } from "./feed.ts";

export interface Pet {
  id: string;
  strength: number;
  intelligence: number;
  charisma: number;
  money: number;
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
  wins: number;
  losses: number;
}

// Always there to fight, so a new player has someone to test themselves on.
export const BOT_ID = "0";

export type Attribute = "strength" | "intelligence" | "charisma";
const ATTRIBUTES: Attribute[] = ["strength", "intelligence", "charisma"];

type Care = "stamina" | "hygiene";
export type Reward = Record<Attribute, number> & { money: number; credits: number };
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
  `SELECT id, strength, intelligence, charisma, money, activity, school, credits, stamina, hygiene, food, soap,
          hourglass, construction_rank, office_rank, theatre_rank, task, busy_since, busy_until, reward, wins, losses
     FROM pets WHERE id = ?`,
);
// The bot first, then the newest pets, so a player who just joined is easy to
// find. Newest means inserted last (rowid), not created_at: that's only to the
// second, and follows the wall clock, which can jump backwards.
const listIds = db.prepare("SELECT id FROM pets ORDER BY id = ? DESC, rowid DESC LIMIT ?");
const busyPets = db.prepare("SELECT id, busy_until FROM pets WHERE busy_until IS NOT NULL");
const insert = db.prepare("INSERT OR IGNORE INTO pets (id) VALUES (?)");
const save = db.prepare(
  `UPDATE pets SET strength = ?, intelligence = ?, charisma = ?, money = ?, school = ?, credits = ?,
     stamina = ?, hygiene = ?, food = ?, soap = ?, hourglass = ?, construction_rank = ?, office_rank = ?, theatre_rank = ?,
     activity = ?, task = ?, busy_since = ?, busy_until = ?, reward = ?, wins = ?, losses = ?
   WHERE id = ?`,
);

type Row = Omit<Pet, "jobs" | "busySince" | "busyUntil" | "reward"> & {
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
  const { construction_rank, office_rank, theatre_rank, busy_since, busy_until, reward, ...pet } = row;
  return {
    ...pet,
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

// Logging in with an unknown ID claims a new pet with the base stats.
export function getOrCreatePet(id: string): { pet: Pet; created: boolean } {
  const { changes } = insert.run(id);
  if (changes > 0 && id !== BOT_ID) record({ kind: "joined", pet: id });
  return { pet: getPet(id)!, created: changes > 0 };
}

// A refusal can still carry `settled`: an activity that ended just before the
// request, saved on the way, which clients need to hear about.
export type Outcome = { pet: Pet } | { status: 404 | 409; error: string; settled?: Pet };

const schoolOf = (pet: Pet) => SCHOOLS.findIndex((s) => s.id === pet.school);

// Pays out an activity that has ended, moving up a school level if its
// credit completes one. Returns whether there was one to finish.
function finishIfDue(pet: Pet, now: number): boolean {
  if (pet.busyUntil === null || pet.busyUntil > now) return false;
  const reward = pet.reward!;
  for (const attribute of ATTRIBUTES) pet[attribute] += reward[attribute];
  pet.money += reward.money;
  pet.credits += reward.credits;
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
  return true;
}

// Saves the pet, and tells the feed if it just moved up a school or a job.
function write(pet: Pet): void {
  const before = getPet(pet.id)!;
  save.run(
    pet.strength, pet.intelligence, pet.charisma, pet.money, pet.school, pet.credits,
    pet.stamina, pet.hygiene, pet.food, pet.soap, pet.hourglass,
    pet.jobs.construction, pet.jobs.office, pet.jobs.theatre,
    pet.activity, pet.task, pet.busySince, pet.busyUntil, pet.reward === null ? null : JSON.stringify(pet.reward),
    pet.wins, pet.losses, pet.id,
  );
  if (pet.school !== before.school) record({ kind: "school", pet: pet.id, school: pet.school });
  for (const location of LOCATIONS) {
    if (pet.jobs[location.id] > before.jobs[location.id]) {
      record({ kind: "promoted", pet: pet.id, location: location.id, rank: pet.jobs[location.id] });
    }
  }
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
  const refusal = change(next);
  if (refusal) {
    if (!finished) return { status: 409, error: refusal };
    write(pet);
    return { status: 409, error: refusal, settled: getPet(id)! };
  }
  write(next);
  return { pet: getPet(id)! };
}

function busy(pet: Pet): string | undefined {
  if (pet.activity === "idle") return undefined;
  const doing = pet.activity === "studying" ? `studying ${pet.task}` : `working at the ${pet.task}`;
  return `Your pet is busy ${doing}. Wait until it's done.`;
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

export function work(id: string, locationId: LocationId, minutes: number): Outcome {
  const location = findLocation(locationId)!;
  return act(id, (pet) => {
    const cost = shiftCost(minutes);
    const refusal = busy(pet) ?? spend(pet, cost, cost, "work");
    if (refusal) return refusal;
    const money = Math.round((hourlyPay(pet, locationId) * minutes) / 60);
    start(pet, "working", location.name, minutes, { ...noReward(), money });
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

// Fights ---------------------------------------------------------------------

// Strength counts double; brains and charm help too.
export const POWER_WEIGHTS: Record<Attribute, number> = { strength: 2, intelligence: 1, charisma: 1 };
export const powerOf = (pet: Pet): number =>
  ATTRIBUTES.reduce((power, attribute) => power + POWER_WEIGHTS[attribute] * pet[attribute], 0);

// Each side rolls its power times a luck factor in [0.8, 1.2], so a pet with
// 1.5× its opponent's power always wins and close fights can go either way.
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
}

const insertFight = db.prepare(
  `INSERT INTO fights (attacker, defender, winner, attacker_power, defender_power, attacker_roll, defender_roll, spoils)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);
const FIGHT_COLUMNS = `id, attacker, defender, winner, attacker_power AS attackerPower,
  defender_power AS defenderPower, attacker_roll AS attackerRoll, defender_roll AS defenderRoll,
  spoils, fought_at AS foughtAt`;
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

export const recentFights = (id: string, limit: number): Fight[] => fightsFor.all(id, id, limit) as unknown as Fight[];

const roll = (power: number): number => power * (LUCK.min + Math.random() * (LUCK.max - LUCK.min));
// Rolls are compared exactly and only rounded for the record, so rounding
// can't turn a sure win into a tie.
const tenths = (n: number): number => Math.round(n * 10) / 10;

export type FightOutcome =
  | { fight: Fight; attacker: Pet; defender: Pet }
  | { status: 400 | 404 | 409 | 429; error: string };

// Why the attacker can't attack this defender again yet, if it can't.
function cooldown(attacker: Pet, defender: Pet, now: number): string | undefined {
  if (defender.id === BOT_ID) return undefined;
  const last = lastAttack.get(attacker.id, defender.id) as { foughtAt: string } | undefined;
  if (!last) return undefined;
  const left = Date.parse(last.foughtAt) + realMs(FIGHT_COOLDOWN_MINUTES) - now;
  if (left <= 0) return undefined;
  const minutes = Math.max(1, Math.ceil((left * TIME_SCALE) / 60_000));
  return `You attacked ${defender.id} recently; you can attack them again in ${minutes} min.`;
}

// Both pets and the fight are written in one transaction, then read back.
export function fight(attackerId: string, defenderId: string): FightOutcome {
  if (attackerId === defenderId) return { status: 400, error: "A pet can't fight itself." };
  const attacker = getPet(attackerId);
  if (!attacker) return { status: 404, error: "no such pet" };
  const defender = getPet(defenderId);
  if (!defender) return { status: 404, error: `There's no pet called ${defenderId}.` };
  const now = Date.now();
  finishIfDue(attacker, now);
  finishIfDue(defender, now);

  const refusal = busy(attacker);
  if (refusal) return { status: 409, error: refusal };
  const waiting = cooldown(attacker, defender, now);
  if (waiting) return { status: 429, error: waiting };
  const unfit = spend(attacker, FIGHT_NEEDS, FIGHT_COST, "fight");
  if (unfit) return { status: 409, error: unfit };

  const attackerPower = powerOf(attacker);
  const defenderPower = powerOf(defender);
  const attackerRoll = roll(attackerPower);
  const defenderRoll = roll(defenderPower);
  // A dead heat goes to the defender.
  const won = attackerRoll > defenderRoll;
  const winner = won ? attacker : defender;
  const loser = won ? defender : attacker;
  winner.wins++;
  loser.losses++;
  const spoils = attacker.id === BOT_ID || defender.id === BOT_ID ? 0 : spoilsFrom(loser);
  loser.money -= spoils;
  winner.money += spoils;

  begin.run();
  try {
    write(attacker);
    write(defender);
    const { lastInsertRowid } = insertFight.run(
      attacker.id, defender.id, winner.id, attackerPower, defenderPower, tenths(attackerRoll), tenths(defenderRoll), spoils,
    );
    record({ kind: "fight", pet: attacker.id, other: defender.id, winner: winner.id, spoils });
    commit.run();
    return {
      fight: selectFight.get(lastInsertRowid) as unknown as Fight,
      attacker: getPet(attacker.id)!,
      defender: getPet(defender.id)!,
    };
  } catch (err) {
    rollback.run();
    throw err;
  }
}
