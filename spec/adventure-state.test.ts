import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createWorld, type Enemy } from '../src/adventure-world.ts';
const directory = mkdtempSync(join(tmpdir(), 'virtuepets-adventure-'));
let adventure: typeof import('../src/adventure.ts');
let db: typeof import('../src/db.ts').db;
let pets: typeof import('../src/pets.ts');
beforeAll(async () => {
  const legacy = new DatabaseSync(join(directory, 'virtuepets.db'));
  legacy.exec('CREATE TABLE adventures (player_id TEXT PRIMARY KEY, x INTEGER NOT NULL, y INTEGER NOT NULL)');
  legacy.prepare('INSERT INTO adventures VALUES (?, ?, ?)').run('legacy', 5, 3);
  legacy.close();
  vi.stubEnv('DATA_DIR', directory);
  adventure = await import('../src/adventure.ts');
  ({ db } = await import('../src/db.ts'));
  pets = await import('../src/pets.ts');
  pets.getOrCreatePet('legacy');
});
afterAll(() => { db.close(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });
it('migrates a legacy clearing without moving its pet or overlapping a new enemy', () => {
  const state = adventure.adventureFor('legacy');
  expect(state).toMatchObject({ x: 5, y: 3, floor: 1 });
  expect(state.enemies.some(e => e.x === 5 && e.y === 3)).toBe(false);
  expect(adventure.adventureFor('legacy')).toEqual(state);
});
it('preserves floor, player position, and enemy positions across a process restart', () => {
  for (const direction of ['a', 'a', 'a', 'a', ...Array(11).fill('s'), ...Array(12).fill('d'), 'w']) {
    expect(adventure.moveAdventure('legacy', direction, adventure.adventureFor('legacy').revision)).not.toHaveProperty('error');
  }
  expect(adventure.changeFloor('legacy', 'descend', adventure.adventureFor('legacy').revision)).toMatchObject({ floor: 2 });
  adventure.moveAdventure('legacy', 'd', adventure.adventureFor('legacy').revision);
  adventure.moveAdventure('legacy', 'd', adventure.adventureFor('legacy').revision);
  const output = execFileSync(process.execPath, ['--input-type=module', '-e',
    "import { adventureFor } from './src/adventure.ts'; console.log(JSON.stringify(adventureFor('legacy')));"],
    { env: { ...process.env, DATA_DIR: directory }, encoding: 'utf8' });
  expect(JSON.parse(output)).toEqual(adventure.adventureFor('legacy'));
});

function setupBattle(id: string, kind: Enemy['kind'], stats = [12, 7, 12]) {
  pets.getOrCreatePet(id);
  db.prepare('UPDATE pets SET strength = ?, intelligence = ?, charisma = ? WHERE id = ?').run(...stats, id);
  adventure.adventureFor(id);
  const world = createWorld(), floor = kind === 'slime-king' ? 5 : 1;
  const enemy = world[floor - 1].enemies.find(e => e.kind === kind)!;
  db.prepare('UPDATE adventures SET x = ?, y = ?, floor = ?, world_json = ? WHERE player_id = ?')
    .run(enemy.x - 1, enemy.y, floor, JSON.stringify(world), id);
  return adventure.adventureFor(id);
}
function step(id: string, direction: string) {
  const result = adventure.moveAdventure(id, direction, adventure.adventureFor(id).revision);
  if ('error' in result) throw new Error(result.error);
  return result;
}
function continueRun(id: string) {
  const saved = adventure.adventureFor(id);
  const result = adventure.continueAdventure(id, saved.battle!.id, saved.revision);
  if ('error' in result) throw new Error(result.error);
  return result;
}
function afterRestart(id: string) {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    "import { adventureFor } from './src/adventure.ts'; console.log(JSON.stringify(adventureFor(process.argv[1])));", id],
  { env: { ...process.env, DATA_DIR: directory }, encoding: 'utf8' }));
}

it.each(['slime', 'goblin', 'slime-king'] as const)('saves a %s victory, removes only that monster, and persists the exact replay', kind => {
  // A player may use a monster's ordinary ID; combat uses a separate namespace.
  const id = kind === 'slime-king' ? 'slime-king' : `fighter-${kind}`;
  const before = setupBattle(id, kind, [100, 100, 100]);
  const pet = pets.getPet(id);
  const result = step(id, 'd');
  expect(result.battle).toMatchObject({ won: true, pending: true, floor: before.floor });
  expect(result.enemies).toHaveLength(before.enemies.length - 1);
  expect(result.enemies.some(e => e.id === result.battle!.enemyId)).toBe(false);
  expect(result.battle!.playback.fighters[1]).toMatchObject({ monster: kind });
  expect(result.completed).toBe(kind === 'slime-king');
  expect(afterRestart(id)).toEqual(result);
  const continued = continueRun(id);
  expect(afterRestart(id)).toEqual(continued);
  expect(continued.battle!.playback).toEqual(result.battle!.playback);
  expect(pets.getPet(id)).toEqual(pet);
});

it('carries HP/MP across battles and floors, restoring 20% of maximum rounded up only once per victory', () => {
  const id = 'recovery'; setupBattle(id, 'slime');
  db.prepare('UPDATE adventures SET hp = ?, mp = ? WHERE player_id = ?').run(17, 0, id);
  const before = adventure.adventureFor(id);
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  try {
    const result = step(id, 'd');
    expect(result.battle!.playback.initialHp).toEqual([17, 6]);
    expect(result.battle!.playback.initialMp).toEqual([0, 1]);
    expect(result).toMatchObject({ hp: 24, mp: 2, maxHp: 31, maxMp: 7, battle: { recovery: { hp: 7, mp: 2 } } });
    expect(adventure.moveAdventure(id, 'd', before.revision)).toEqual(result);
    expect(adventure.adventureFor(id)).toEqual(result);
    const continued = continueRun(id);
    expect(adventure.moveAdventure(id, 'd', before.revision)).toEqual(continued);
    expect(random).toHaveBeenCalledTimes(2);
    db.prepare('UPDATE adventures SET x = ?, y = ? WHERE player_id = ?').run(13, 13, id);
    expect(adventure.changeFloor(id, 'descend', continued.revision)).toMatchObject({ floor: 2, hp: 24, mp: 2 });
    adventure.changeFloor(id, 'ascend', adventure.adventureFor(id).revision);
    db.prepare('UPDATE adventures SET x = ?, y = ? WHERE player_id = ?').run(9, 5, id);
    const next = step(id, 'd');
    expect(next.battle!.playback.initialHp![0]).toBe(24);
    expect(next.battle!.playback.initialMp![0]).toBe(2);
    expect(next).toMatchObject({ hp: 31, mp: 4 });
    continueRun(id);
    db.prepare('UPDATE adventures SET x = ?, y = ?, hp = ?, mp = ? WHERE player_id = ?').run(3, 11, 30, 6, id);
    const capped = step(id, 'd');
    expect(capped).toMatchObject({ hp: 31, mp: 7, battle: { recovery: { hp: 1, mp: 1 } } });
    expect(afterRestart(id)).toEqual(capped);
  } finally { random.mockRestore(); }
});

it('ends the adventure on defeat and requires an explicit fresh run; old retries cannot damage or reset the new run', () => {
  const id = 'defeated'; const before = setupBattle(id, 'goblin', [1, 1, 1]);
  const result = step(id, 'd');
  expect(result).toMatchObject({ hp: 0, failed: true, x: before.x, y: before.y, battle: { won: false, recovery: { hp: 0, mp: 0 } } });
  expect(result.enemies.map(e => e.id)).toEqual(before.enemies.map(e => e.id));
  expect(adventure.restartAdventure(id, result.revision)).toEqual(result); // first return from the saved battle
  const failed = continueRun(id);
  expect(step(id, 'w')).toEqual(failed);
  expect(adventure.changeFloor(id, 'ascend', failed.revision)).toEqual(failed);
  expect(afterRestart(id)).toEqual(failed);
  const restarted = adventure.restartAdventure(id, failed.revision);
  expect(restarted).toMatchObject({ floor: 1, x: 2, y: 2, hp: 3, mp: 1, failed: false, battle: null });
  expect(adventure.restartAdventure(id, failed.revision)).toEqual(restarted);
  expect(adventure.moveAdventure(id, 'd', before.revision)).toEqual(restarted);
  expect(adventure.continueAdventure(id, result.battle!.id, result.revision)).toEqual(restarted);
  expect(adventure.restartAdventure(id, adventure.adventureFor(id).revision)).toMatchObject({ status: 409 });
  expect(afterRestart(id)).toEqual(restarted);
});
