import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

// The town goal's rules, in-process against a scratch database: the shared
// app's goal moves whenever any spec feeds a pet, so reaching it, claiming,
// and the week turning over are pinned down here.
const directory = mkdtempSync(join(tmpdir(), 'virtuepets-town-goal-'));
let db: typeof import('../src/db.ts').db;
let pets: typeof import('../src/pets.ts');
let goal: typeof import('../src/town-goal.ts');
beforeAll(async () => {
  vi.stubEnv('DATA_DIR', directory);
  ({ db } = await import('../src/db.ts'));
  pets = await import('../src/pets.ts');
  goal = await import('../src/town-goal.ts');
});
afterAll(() => { db.close(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });

const ok = <T extends object>(outcome: T) => {
  if ('error' in outcome) throw new Error(String(outcome.error));
  return outcome as Exclude<T, { error: string }>;
};
// A pet with some Food, hungry enough to eat it.
function hungry(id: string, food = 3) {
  pets.getOrCreatePet(id);
  db.prepare('UPDATE pets SET food = ?, stamina = 10 WHERE id = ?').run(food, id);
  return id;
}
// Meals are counted on real UTC weeks; pretend some served earlier this week.
const serve = (id: string, meals: number, now = Date.now()) => { for (let i = 0; i < meals; i++) goal.countMeal(id, now); };
const clearWeek = () => db.prepare('DELETE FROM town_goal_meals').run();

it('weeks run Monday 00:00 to Monday 00:00 UTC', () => {
  // Wednesday 2026-11-11 15:30 UTC is in the week of Monday 2026-11-09.
  expect(new Date(goal.weekStart(Date.UTC(2026, 10, 11, 15, 30))).toISOString()).toBe('2026-11-09T00:00:00.000Z');
  // Sunday just before midnight is still that week; Monday 00:00 starts the next.
  expect(new Date(goal.weekStart(Date.UTC(2026, 10, 15, 23, 59, 59))).toISOString()).toBe('2026-11-09T00:00:00.000Z');
  expect(new Date(goal.weekStart(Date.UTC(2026, 10, 16))).toISOString()).toBe('2026-11-16T00:00:00.000Z');
  const shown = goal.townGoal(Date.UTC(2026, 10, 11));
  expect(shown).toMatchObject({ week: Date.UTC(2026, 10, 9), endsAt: Date.UTC(2026, 10, 16), target: 100, reward: { money: 25, food: 1 } });
});

it("counts each Food a pet eats as a meal for whoever served it, and nothing else", () => {
  clearWeek();
  const owner = hungry('goal-owner'), visitor = hungry('goal-visitor'), other = hungry('goal-other');
  ok(pets.use(owner, 'food'));
  expect(goal.townGoalFor(owner)).toMatchObject({ meals: 1, helpers: 1, mine: { meals: 1, claimed: false, canClaim: false } });
  // A visitor's Food is the visitor's meal, not the fed pet's owner's.
  ok(pets.help(visitor, other, 'food'));
  expect(goal.townGoalFor(visitor).mine.meals).toBe(1);
  expect(goal.townGoalFor(other).mine.meals).toBe(0);
  expect(goal.townGoal()).toMatchObject({ meals: 2, helpers: 2 });
  // Soap isn't a meal, and a refused feeding counts for nothing.
  db.prepare('UPDATE pets SET soap = 1, hygiene = 10 WHERE id = ?').run(owner);
  ok(pets.use(owner, 'soap'));
  db.prepare('UPDATE pets SET stamina = 100 WHERE id = ?').run(owner);
  expect(pets.use(owner, 'food')).toMatchObject({ status: 409 });
  db.prepare('UPDATE pets SET food = 0, stamina = 10 WHERE id = ?').run(owner);
  expect(pets.use(owner, 'food')).toMatchObject({ status: 409 });
  expect(goal.townGoal()).toMatchObject({ meals: 2, helpers: 2 });
});

it('rolls a meal back with the feeding it belongs to', () => {
  clearWeek();
  const id = hungry('goal-rollback');
  db.exec("CREATE TRIGGER reject_food BEFORE UPDATE OF food ON pets WHEN NEW.id = 'goal-rollback' BEGIN SELECT RAISE(ABORT, 'test disk failure'); END");
  try { expect(() => pets.use(id, 'food')).toThrow('test disk failure'); }
  finally { db.exec('DROP TRIGGER reject_food'); }
  expect(goal.townGoal().meals).toBe(0);
  expect(pets.getPet(id)!.food).toBe(3);
});

it('pays every helper once the town reaches the goal, once each, and nobody who did not help', () => {
  clearWeek();
  const early = hungry('goal-early'), late = hungry('goal-late'), idle = hungry('goal-idle');
  serve(early, 60);
  serve(late, 39);
  expect(goal.townGoal()).toMatchObject({ meals: 99, reached: false, helpers: 2 });
  expect(goal.claimTownGoal(early)).toEqual({ status: 409, error: 'The town has served 99 of 100 meals this week. Keep feeding pets!' });
  // The hundredth meal is a real feeding.
  ok(pets.use(late, 'food'));
  expect(goal.townGoal()).toMatchObject({ meals: 100, reached: true });
  expect(goal.townGoalFor(early).mine).toEqual({ meals: 60, claimed: false, canClaim: true });
  const before = pets.getPet(early)!;
  const claimed = ok(goal.claimTownGoal(early));
  expect(claimed.goal.mine).toEqual({ meals: 60, claimed: true, canClaim: false });
  expect(pets.getPet(early)).toMatchObject({ money: before.money + 25, food: before.food + 1 });
  expect(goal.claimTownGoal(early)).toEqual({ status: 409, error: "You've already collected this week's town reward." });
  expect(pets.getPet(early)!.money).toBe(before.money + 25);
  // A player who served no meal this week doesn't share it.
  expect(goal.claimTownGoal(idle)).toEqual({ status: 409, error: "Serve a meal this week to share the town's reward." });
  expect(goal.townGoalFor(idle).mine.canClaim).toBe(false);
  // Meals past the target still count, and still earn a newcomer a share.
  ok(pets.use(idle, 'food'));
  expect(goal.townGoal()).toMatchObject({ meals: 101, helpers: 3 });
  expect(ok(goal.claimTownGoal(idle)).goal.mine.claimed).toBe(true);
});

it('starts each week from zero, forgetting last week, with a fresh reward to earn', () => {
  clearWeek();
  const id = hungry('goal-weekly');
  const lastWeek = Date.UTC(2026, 10, 12), thisWeek = Date.UTC(2026, 10, 17);
  serve(id, 100, lastWeek);
  expect(ok(goal.claimTownGoal(id, lastWeek)).goal.mine.claimed).toBe(true);
  expect(goal.townGoalFor(id, thisWeek)).toMatchObject({ meals: 0, helpers: 0, reached: false, mine: { meals: 0, claimed: false } });
  // The first meal of a new week deletes the old one's rows.
  serve(id, 1, thisWeek);
  expect(db.prepare('SELECT week, meals FROM town_goal_meals').all()).toEqual([{ week: Date.UTC(2026, 10, 16), meals: 1 }]);
});

it('tells followUp about a changed total only once', () => {
  clearWeek();
  goal.townGoalNews(); // settle what's already been announced
  expect(goal.townGoalNews()).toBeUndefined();
  serve(hungry('goal-news'), 1);
  expect(goal.townGoalNews()).toMatchObject({ meals: 1, helpers: 1 });
  expect(goal.townGoalNews()).toBeUndefined();
});
