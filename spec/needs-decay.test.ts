import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// The rule behind needs that drop while a pet's owner is away, as a pure
// function. NEEDS_DECAY is read once at import, so each test loads it fresh.
const HOUR = 60 * 60 * 1000;
let needs: typeof import('../src/needs.ts');
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('NEEDS_DECAY', 'on');
  needs = await import('../src/needs.ts');
});
afterEach(() => { vi.unstubAllEnvs(); });

const pet = (stamina = 100, hygiene = 100, needsAt: number | null = 0, busy: [number, number] | null = null) =>
  ({ stamina, hygiene, needsAt, busySince: busy?.[0] ?? null, busyUntil: busy?.[1] ?? null });

it('is off unless NEEDS_DECAY is on, and then drops 2 points an hour to a floor of 30', async () => {
  vi.resetModules();
  vi.stubEnv('NEEDS_DECAY', '');
  const off = await import('../src/needs.ts');
  expect(off.NEEDS_DECAY.enabled).toBe(false);
  const untouched = pet();
  off.decay(untouched, 10 * HOUR, true);
  expect(untouched).toMatchObject({ stamina: 100, hygiene: 100, needsAt: 10 * HOUR });
  expect(needs.NEEDS_DECAY).toEqual({ enabled: true, perHour: { stamina: 2, hygiene: 2 }, floor: { stamina: 30, hygiene: 30 } });
});

it('drops whole points for away time, and stops at the floor', () => {
  const p = pet(100, 90);
  needs.decay(p, 10 * HOUR, true);
  expect(p).toMatchObject({ stamina: 80, hygiene: 70, needsAt: 10 * HOUR });
  // A whole day away: about half full, then resting on the floor.
  const day = pet();
  needs.decay(day, 24 * HOUR, true);
  expect(day).toMatchObject({ stamina: 52, hygiene: 52 });
  const week = pet();
  needs.decay(week, 7 * 24 * HOUR, true);
  expect(week).toMatchObject({ stamina: 30, hygiene: 30 });
});

it('never lowers a need that is already at or under the floor', () => {
  // A long shift left stamina at 10; time away doesn't make it worse.
  const p = pet(10, 60);
  needs.decay(p, 48 * HOUR, true);
  expect(p).toMatchObject({ stamina: 10, hygiene: 30 });
});

it('loses the same amount whether the owner checks in often or stays away', () => {
  // A point falls every 30 minutes. Checking in every 20 minutes for 10 hours...
  const often = pet();
  for (let t = 20 * 60_000; t <= 10 * HOUR; t += 20 * 60_000) needs.decay(often, t, true);
  // ...loses exactly what staying away for those 10 hours does.
  const away = pet();
  needs.decay(away, 10 * HOUR, true);
  expect(often.stamina).toBe(away.stamina);
  expect(often.stamina).toBe(80);
  // Under half an hour: nothing yet, and nothing forgotten.
  const brief = pet();
  needs.decay(brief, 29 * 60_000, true);
  expect(brief).toMatchObject({ stamina: 100, needsAt: 0 });
  needs.decay(brief, 31 * 60_000, true);
  expect(brief.stamina).toBe(99);
});

it('costs nothing while the owner is online, and starts counting from when they leave', () => {
  const p = pet();
  needs.decay(p, 5 * HOUR, false);
  expect(p).toMatchObject({ stamina: 100, needsAt: 5 * HOUR });
  needs.decay(p, 7 * HOUR, true);
  expect(p.stamina).toBe(96);
});

it('leaves out time spent studying or working, which already costs the pet', () => {
  // Away 10 hours, 4 of them on a shift: only 6 hours count.
  const p = pet(100, 100, 0, [2 * HOUR, 6 * HOUR]);
  needs.decay(p, 10 * HOUR, true);
  expect(p).toMatchObject({ stamina: 88, hygiene: 88 });
  // A pet that has never been brought up to date starts counting now.
  const fresh = pet(100, 100, null);
  needs.decay(fresh, 50 * HOUR, true);
  expect(fresh).toMatchObject({ stamina: 100, needsAt: 50 * HOUR });
});
