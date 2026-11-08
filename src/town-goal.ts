import { db, transaction } from "./db.ts";

// The town's weekly goal: every player's care adds up. Each Food a pet eats
// counts as one meal, whoever served it: an owner feeding their own pet (at
// home or from the Adventure backpack) or a visitor feeding someone else's.
// Once the town reaches the target, every player who served at least one meal
// that week can collect a small reward, once.
//
// Weeks run Monday 00:00 to Monday 00:00 UTC, on real time like the daily
// limits, so a fast test clock never rushes a week.
export const TOWN_GOAL = { meals: 100, reward: { money: 25, food: 1 }, resetTimezone: "UTC" } as const;

// A meal tally and claim per player per week. Old weeks are deleted as new
// ones begin, so the table holds at most one week's players.
const add = db.prepare(
  `INSERT INTO town_goal_meals (week, player_id, meals) VALUES (?, ?, 1)
   ON CONFLICT (week, player_id) DO UPDATE SET meals = meals + 1`,
);
const forget = db.prepare("DELETE FROM town_goal_meals WHERE week < ?");
const totals = db.prepare("SELECT coalesce(sum(meals), 0) AS meals, count(*) AS helpers FROM town_goal_meals WHERE week = ?");
const mine = db.prepare("SELECT meals, claimed FROM town_goal_meals WHERE week = ? AND player_id = ?");
const markClaimed = db.prepare("UPDATE town_goal_meals SET claimed = 1 WHERE week = ? AND player_id = ? AND claimed = 0");
const pay = db.prepare("UPDATE pets SET money = money + ?, food = food + ? WHERE id = ?");

// The Monday 00:00 UTC that starts the week holding `now`, as epoch ms.
export function weekStart(now = Date.now()): number {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return start.getTime();
}
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// What everyone sees: the town's progress this week. Who helped and who
// claimed is each player's own business, in `TownGoalStatus`.
export type TownGoal = {
  week: number; // epoch ms of the Monday this week began
  endsAt: number; // epoch ms of the next Monday, when it starts again from zero
  target: number;
  meals: number; // as saved; can pass the target, and keeps counting
  helpers: number; // players who served at least one meal this week
  reached: boolean;
  reward: { money: number; food: number };
};
export type TownGoalStatus = TownGoal & { mine: { meals: number; claimed: boolean; canClaim: boolean } };
export type ClaimOutcome = { goal: TownGoalStatus } | { status: 409; error: string };

export function townGoal(now = Date.now()): TownGoal {
  const week = weekStart(now);
  const { meals, helpers } = totals.get(week) as { meals: number; helpers: number };
  return {
    week, endsAt: week + WEEK_MS, target: TOWN_GOAL.meals, meals, helpers,
    reached: meals >= TOWN_GOAL.meals, reward: { ...TOWN_GOAL.reward },
  };
}

export function townGoalFor(id: string, now = Date.now()): TownGoalStatus {
  const goal = townGoal(now);
  const row = mine.get(goal.week, id) as { meals: number; claimed: number } | undefined;
  const meals = row?.meals ?? 0, claimed = row?.claimed === 1;
  return { ...goal, mine: { meals, claimed, canClaim: goal.reached && meals > 0 && !claimed } };
}

// Counts one meal served by `feeder`, in the caller's transaction, together
// with the feeding it belongs to: if that rolls back, so does the meal.
export function countMeal(feeder: string, now = Date.now()): void {
  const week = weekStart(now);
  forget.run(week);
  add.run(week, feeder);
}

// Collecting the week's reward: only once the town reached its goal, only for
// a player who served a meal, and only once. The reward and the claim are
// saved together.
export function claimTownGoal(id: string, now = Date.now()): ClaimOutcome {
  return transaction(() => {
    const status = townGoalFor(id, now);
    if (!status.reached) {
      return { status: 409, error: `The town has served ${status.meals} of ${status.target} meals this week. Keep feeding pets!` };
    }
    if (status.mine.meals === 0) return { status: 409, error: "Serve a meal this week to share the town's reward." };
    if (status.mine.claimed) return { status: 409, error: "You've already collected this week's town reward." };
    if (markClaimed.run(status.week, id).changes !== 1) return { status: 409, error: "You've already collected this week's town reward." };
    pay.run(TOWN_GOAL.reward.money, TOWN_GOAL.reward.food, id);
    return { goal: townGoalFor(id, now) };
  });
}

// The saved total last broadcast as town:goal, so followUp sends news only
// when a meal (or a new week) changed it.
let announced: string | null = null;
export function townGoalNews(now = Date.now()): TownGoal | undefined {
  const goal = townGoal(now);
  const key = `${goal.week}:${goal.meals}:${goal.helpers}`;
  if (key === announced) return undefined;
  announced = key;
  return goal;
}
townGoalNews(); // the total at startup is what clients load; only changes are news
