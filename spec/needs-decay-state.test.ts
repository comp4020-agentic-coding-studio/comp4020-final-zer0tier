import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

// Needs that drop while the owner is away, in-process against a scratch
// database with NEEDS_DECAY on and the clock under the test's control. Nobody
// is connected here, so every pet's owner counts as away unless a test says.
const HOUR = 60 * 60 * 1000;
const directory = mkdtempSync(join(tmpdir(), 'virtuepets-needs-'));
let db: typeof import('../src/db.ts').db;
let pets: typeof import('../src/pets.ts');
let realtime: typeof import('../src/realtime.ts');
let now = Date.UTC(2026, 10, 9, 12);
beforeAll(async () => {
  vi.stubEnv('DATA_DIR', directory);
  vi.stubEnv('NEEDS_DECAY', 'on');
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  ({ db } = await import('../src/db.ts'));
  pets = await import('../src/pets.ts');
  realtime = await import('../src/realtime.ts');
});
afterAll(() => { vi.restoreAllMocks(); db.close(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });

const ok = <T extends object>(outcome: T) => {
  if ('error' in outcome) throw new Error(String(outcome.error));
  return outcome as Exclude<T, { error: string }>;
};
const needsAt = (id: string) => (db.prepare('SELECT needs_at FROM pets WHERE id = ?').get(id) as { needs_at: number | null }).needs_at;
// A new pet, brought up to date now (its owner arriving), so its away clock starts.
function newPet(id: string, set: { stamina?: number; hygiene?: number; food?: number; soap?: number } = {}) {
  pets.getOrCreatePet(id);
  db.prepare('UPDATE pets SET stamina = coalesce(?, stamina), hygiene = coalesce(?, hygiene), food = coalesce(?, food), soap = coalesce(?, soap) WHERE id = ?')
    .run(set.stamina ?? null, set.hygiene ?? null, set.food ?? null, set.soap ?? null, id);
  pets.freshenNeeds(id);
  expect(needsAt(id)).toBe(now);
  return id;
}

it('shows what a pet lost while away on its next action, saved once and never taken twice', () => {
  const id = newPet('away-ten-hours');
  now += 10 * HOUR;
  // Reading a pet changes nothing: only bringing it up to date saves the drop.
  expect(pets.getPet(id)).toMatchObject({ stamina: 100, hygiene: 100 });
  const pet = ok(pets.setAppearance(id, '#123456', 'cat')).pet;
  expect(pet).toMatchObject({ stamina: 80, hygiene: 80 });
  expect(needsAt(id)).toBe(now);
  // A second action straight after loses nothing more.
  expect(ok(pets.setAppearance(id, '#654321', 'dog')).pet).toMatchObject({ stamina: 80, hygiene: 80 });
  // Clients never see the bookkeeping.
  expect(pet).not.toHaveProperty('needsAt');
});

it('saves and shows the drop even when the action is refused', () => {
  const id = newPet('too-tired', { stamina: 60 });
  now += 24 * HOUR;
  // A day away takes 48 points: stamina rests on its floor of 30, hygiene
  // falls to 52. A refused action (no Foreman without 20 strength) still
  // saves that and shows it.
  const refused = pets.upgrade(id, 'construction');
  expect(refused).toMatchObject({ status: 409, settled: { stamina: 30, hygiene: 52 } });
  expect(pets.getPet(id)).toMatchObject({ stamina: 30, hygiene: 52 });
  expect(needsAt(id)).toBe(now);
});

it('lets the owner and visitors put a hungry, grubby pet right', () => {
  const owner = newPet('hungry-owner', { food: 1, soap: 1 });
  const visitor = newPet('kind-visitor', { food: 1, soap: 1 });
  now += 20 * HOUR;
  // A visitor's Food lands on the drained stamina, not the old 100.
  const helped = ok(pets.help(visitor, owner, 'food'));
  expect(helped.amount).toBe(40);
  expect(helped.pet).toMatchObject({ stamina: 100, hygiene: 60 });
  ok(pets.use(owner, 'soap'));
  expect(pets.getPet(owner)).toMatchObject({ stamina: 100, hygiene: 100 });
});

it("still never stops a neglected pet working its way back", () => {
  const id = newPet('neglected');
  now += 30 * 24 * HOUR;
  // A month away: both needs rest on the floor, which still covers an hour's shift.
  const shift = ok(pets.work(id, 'construction', 60)).pet;
  expect(shift).toMatchObject({ activity: 'working', stamina: 20, hygiene: 10 });
});

it('takes nothing while the pet studies or works, and the bot never gets hungry', () => {
  const id = newPet('busy-bee', { stamina: 100, hygiene: 100 });
  ok(pets.work(id, 'construction', 240)); // a 4-hour shift costs 40 stamina and 80 hygiene
  const started = pets.getPet(id)!;
  // The shift runs 4 hours of game time, a moment of real time on any clock here.
  now = started.busyUntil! + 3 * HOUR;
  const settled = pets.settle(id)!;
  expect(settled.finished).toBe(true);
  // Only the 3 hours after the shift count: 6 stamina points (60 → 54). Hygiene
  // was left at 20 by the shift, under the floor, so it stays.
  expect(pets.getPet(id)).toMatchObject({ stamina: started.stamina - 6, hygiene: started.hygiene });
  pets.getOrCreatePet(pets.BOT_ID);
  now += 100 * HOUR;
  expect(pets.freshenNeeds(pets.BOT_ID)).toBeUndefined();
  expect(pets.getPet(pets.BOT_ID)).toMatchObject({ stamina: 100, hygiene: 100 });
});

it('costs nothing while the owner is online', () => {
  const id = newPet('online-all-day');
  const spy = vi.spyOn(realtime, 'onlineNow').mockImplementation(player => player === id);
  try {
    now += 12 * HOUR;
    expect(ok(pets.setAppearance(id, '#abcdef', 'panda')).pet).toMatchObject({ stamina: 100, hygiene: 100 });
    expect(needsAt(id)).toBe(now);
  } finally { spy.mockRestore(); }
  // Logged off now: the away clock starts from that last update.
  now += 5 * HOUR;
  expect(pets.freshenNeeds(id)).toMatchObject({ stamina: 90, hygiene: 90 });
});

it('does no database work on arriving or leaving while decay is off', async () => {
  vi.resetModules();
  vi.stubEnv('NEEDS_DECAY', '');
  const offPets = await import('../src/pets.ts');
  const { db: offDb } = await import('../src/db.ts');
  const spy = vi.spyOn(offDb, 'prepare');
  const calls = spy.mock.calls.length;
  expect(offPets.freshenNeeds('anyone-at-all')).toBeUndefined();
  // Not even a transaction: presence changes cost nothing with decay off.
  expect(spy.mock.calls.length).toBe(calls);
  spy.mockRestore();
  vi.stubEnv('NEEDS_DECAY', 'on');
});
