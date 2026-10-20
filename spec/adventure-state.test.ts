import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createWorld, type Enemy, type Floor } from '../src/adventure-world.ts';
import { type ActiveBattle } from '../src/combat.ts';
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
  expect(pets.getPet('legacy')).toMatchObject({ abilities: ['claw-strike'], coins: { 'copper-coin': 0, 'silver-coin': 0, 'gold-coin': 0 } });
});
it('preserves floor, player position, and enemy positions across a process restart', () => {
  grantFloorKey('legacy');
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
  const level = world[floor - 1];
  const enemy = level.enemies.find(e => e.kind === kind)!;
  level.enemies = [enemy, ...level.enemies.filter(e => e !== enemy)];
  level.encounter = { seed: 1, steps: 5 };
  db.prepare('UPDATE adventures SET x = ?, y = ?, floor = ?, world_json = ? WHERE player_id = ?')
    .run(enemy.x - 1, enemy.y, floor, JSON.stringify(world), id);
  return adventure.adventureFor(id);
}
function readyGrassBattle(id: string, enemyId: string) {
  const saved = db.prepare('SELECT world_json, floor FROM adventures WHERE player_id = ?').get(id) as { world_json: string; floor: number };
  const world = JSON.parse(saved.world_json) as Floor[], floor = world[saved.floor - 1];
  floor.enemies.sort((a, b) => Number(b.id === enemyId) - Number(a.id === enemyId));
  floor.encounter = { seed: 1, steps: 5 };
  db.prepare('UPDATE adventures SET world_json = ? WHERE player_id = ?').run(JSON.stringify(world), id);
}
function step(id: string, direction: string) {
  const result = adventure.moveAdventure(id, direction, adventure.adventureFor(id).revision);
  if ('error' in result) throw new Error(result.error);
  return finishBattle(id);
}
// Existing reward/carry tests choose every player move explicitly. Separate
// manual-turn tests below inspect the waiting state before making any choice.
function finishBattle(id: string) {
  let state = adventure.adventureFor(id);
  for (let turn = 0; turn < 500; turn++) {
    const battle = state.battle?.playback as ActiveBattle | null;
    if (!battle || battle.status !== 'active') return state;
    const actor = battle.actor!;
    const skill = battle.attacks[actor].filter(move => move.mpCost <= battle.mp[actor]).sort((a, b) => b.damage - a.damage || a.mpCost - b.mpCost)[0];
    const result = adventure.adventureBattleSkill(battle.fighters[actor].id, state.battle!.id, battle.revision, skill.id);
    if ('error' in result) throw new Error(result.error);
    state = adventure.adventureFor(id);
  }
  throw new Error('Battle did not finish in 500 chosen turns.');
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
function grantFloorKey(id: string, floor = 1) {
  const saved = db.prepare('SELECT world_json FROM adventures WHERE player_id = ?').get(id) as { world_json: string };
  const world = JSON.parse(saved.world_json) as Floor[];
  world[floor - 1].exit!.keyFound = true;
  db.prepare('UPDATE adventures SET world_json = ? WHERE player_id = ?').run(JSON.stringify(world), id);
}

function standOnChest(id: string, floor = 1) {
  pets.getOrCreatePet(id);
  adventure.adventureFor(id);
  db.prepare('UPDATE adventures SET x = ?, y = ?, floor = ? WHERE player_id = ?').run(11, 3, floor, id);
  return adventure.adventureFor(id);
}
function openChest(id: string, roll: number, within = 0) {
  const before = adventure.adventureFor(id);
  const random = vi.spyOn(Math, 'random').mockReturnValueOnce(roll).mockReturnValue(within);
  try {
    const result = adventure.openAdventureChest(id, before.revision);
    if ('error' in result) throw new Error(result.error);
    return result;
  } finally { random.mockRestore(); }
}

it.each([
  [0, 0, 'food'], [0.3, 0, 'soap'], [0.6, 0, 'firebolt'], [0.6, 0.9, 'heavy-strike'],
  [0.8, 0, 'hourglass'], [0.95, 0, 'copper-coin'], [0.95, 0.5, 'silver-coin'], [0.95, 0.9, 'gold-coin'],
] as const)('saves reward %s/%s (%s) once, preserving it and inventory across a process restart', (roll, within, item) => {
  const id = `treasure-${item}`, before = standOnChest(id);
  const result = openChest(id, roll, within);
  expect(result.chests[0].reward).toMatchObject({ id: item, quantity: 1 });
  expect(result.revision).not.toBe(before.revision);
  expect(result.enemies).toEqual(before.enemies);
  if (item === 'food' || item === 'soap' || item === 'hourglass') {
    expect(pets.getPet(id)![item]).toBe(1);
  } else if (item === 'firebolt' || item === 'heavy-strike') {
    expect(pets.getPet(id)!.abilities).toContain(item);
    expect(result.chests[0].reward!.learned).toBe(true);
  } else expect(pets.getPet(id)!.coins[item]).toBe(1);
  expect(adventure.openAdventureChest(id, before.revision)).toEqual(result);
  expect(adventure.openAdventureChest(id, result.revision)).toEqual(result);
  expect(afterRestart(id)).toEqual(result);
  expect(pets.getPet('legacy')!.abilities).toEqual(['claw-strike']);
});

it('keeps learned abilities and coins through defeat/new runs; duplicate ability drops do not stack', () => {
  const id = 'persistent-treasure'; standOnChest(id);
  openChest(id, 0.6);
  standOnChest(id, 2); openChest(id, 0.95, 0.9);
  standOnChest(id, 3);
  expect(openChest(id, 0.6).chests[0].reward).toMatchObject({ id: 'firebolt', learned: false });
  const pet = pets.getPet(id)!;
  expect(pet.abilities).toEqual(['claw-strike', 'firebolt']);
  db.prepare('UPDATE adventures SET hp = ? WHERE player_id = ?').run(0, id);
  const failed = adventure.adventureFor(id);
  expect(adventure.openAdventureChest(id, failed.revision)).toEqual(failed);
  const next = adventure.restartAdventure(id, failed.revision);
  expect(next).toMatchObject({ floor: 1, hp: 15 });
  // Restarting after a defeat now costs the flat adventure fee.
  expect(pets.getPet(id)).toEqual({ ...pet, stamina: pet.stamina - 40, hygiene: pet.hygiene - 20 });
  expect(adventure.openAdventureChest(id, failed.revision)).toEqual(next);
  standOnChest(id); expect(openChest(id, 0.6).chests[0].reward!.learned).toBe(false);
});

it('refuses remote chests and rolls back the reward if saving the opened chest fails', () => {
  const id = 'atomic-chest'; pets.getOrCreatePet(id);
  const start = adventure.adventureFor(id);
  expect(adventure.openAdventureChest(id, start.revision)).toMatchObject({ status: 409 });
  const before = standOnChest(id), pet = pets.getPet(id);
  db.exec("CREATE TRIGGER reject_chest_save BEFORE UPDATE OF world_json ON adventures BEGIN SELECT RAISE(ABORT, 'test disk failure'); END");
  try { expect(() => openChest(id, 0.6)).toThrow('test disk failure'); }
  finally { db.exec('DROP TRIGGER reject_chest_save'); }
  expect(pets.getPet(id)).toEqual(pet);
  expect(adventure.adventureFor(id)).toEqual(before);
  expect(openChest(id, 0.6).chests[0].reward!.learned).toBe(true);
});

it('uses chest food, soap, and hourglasses with existing effects and cannot consume twice on retry', () => {
  const id = 'use-treasure'; standOnChest(id); openChest(id, 0);
  standOnChest(id, 2); openChest(id, 0.3);
  standOnChest(id, 3); openChest(id, 0.8);
  db.prepare('UPDATE pets SET stamina = ?, hygiene = ? WHERE id = ?').run(30, 40, id);
  for (const item of ['food', 'soap'] as const) {
    const before = adventure.adventureFor(id);
    const result = adventure.useAdventureItem(id, item, before.revision);
    expect(result).not.toHaveProperty('error');
    expect(pets.getPet(id)![item]).toBe(0);
    expect(adventure.useAdventureItem(id, item, before.revision)).toEqual(result);
  }
  expect(pets.getPet(id)).toMatchObject({ stamina: 70, hygiene: 90 });
  expect(pets.study(id, 'math')).not.toHaveProperty('error');
  const before = adventure.adventureFor(id), result = adventure.useAdventureItem(id, 'hourglass', before.revision);
  expect(pets.getPet(id)).toMatchObject({ hourglass: 0, activity: 'idle', intelligence: 6 });
  expect(adventure.useAdventureItem(id, 'hourglass', before.revision)).toEqual(result);
  const current = adventure.adventureFor(id);
  expect(adventure.useAdventureItem(id, 'copper-coin', current.revision)).toMatchObject({ status: 400 });
  expect(adventure.useAdventureItem(id, 'food', current.revision)).toMatchObject({ status: 409 });
  expect(afterRestart(id)).toEqual(current);
});

it('loads equipped skills into monster battles, spending carried MP only once', () => {
  const id = 'learned-fighter'; standOnChest(id); openChest(id, 0.6);
  expect(pets.equipSkills(id, ['claw-strike', 'firebolt'])).not.toHaveProperty('error');
  const before = setupBattle(id, 'goblin', [5, 10, 12]);
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  try {
    const result = step(id, 'd');
    expect(result.battle!.playback!.turns.find(turn => turn.actor === 0)).toMatchObject({ ability: 'firebolt', mpCost: 3 });
    expect(adventure.moveAdventure(id, 'd', before.revision)).toEqual(result);
    expect(result.battle!.playback!.initialMp![0]).toBe(before.mp);

  } finally { random.mockRestore(); }
});

it.each(['slime', 'goblin', 'slime-king'] as const)('saves a %s victory, removes only that monster, and persists the exact replay', kind => {
  // A player may use a monster's ordinary ID; combat uses a separate namespace.
  const id = kind === 'slime-king' ? 'slime-king' : `fighter-${kind}`;
  const before = setupBattle(id, kind, [100, 100, 100]);
  const pet = pets.getPet(id);
  const result = step(id, 'd');
  expect(result.battle).toMatchObject({ won: true, pending: true, floor: before.floor });
  expect(result.enemies).toHaveLength(before.enemies.length - 1);
  expect(result.enemies.some(e => e.id === result.battle!.enemyId)).toBe(false);
  expect(result.battle!.playback!.fighters[1]).toMatchObject({ monster: kind });
  expect(result.completed).toBe(kind === 'slime-king');
  expect(afterRestart(id)).toEqual(result);
  const continued = continueRun(id);
  expect(afterRestart(id)).toEqual(continued);
  expect(continued.battle!.playback).toEqual(kind === 'slime-king' ? result.battle!.playback : null);
  expect(pets.getPet(id)).toEqual(pet);
});

it.each([[0, true], [0.049999, true], [0.05, false], [0.999999, false]] as const)(
  'uses the exact 5%% key threshold at %s and saves its result without rerolling', (roll, dropped) => {
    const id = `key-threshold-${roll}`, before = setupBattle(id, 'slime', [100, 100, 100]);
    const random = vi.spyOn(Math, 'random').mockReturnValue(roll);
    try {
      const fought = step(id, 'd');
      expect(fought.exit).toEqual({ keyFound: dropped, unlocked: false, dropRate: 0.05 });
      expect(fought.battle!.keyDrop).toEqual(dropped ? { floor: 1, name: 'Floor Key' } : undefined);
      expect(random).toHaveBeenCalledTimes(4);
      expect(adventure.moveAdventure(id, 'd', before.revision)).toEqual(fought);
      expect(adventure.patrolAdventure(id)).toEqual(fought);
      expect(afterRestart(id)).toEqual(fought);
      const continued = continueRun(id);
      expect(continued.battle!.keyDrop).toEqual(fought.battle!.keyDrop);
      expect(adventure.moveAdventure(id, 'd', before.revision)).toEqual(continued);
      expect(afterRestart(id)).toEqual(continued);
      expect(random).toHaveBeenCalledTimes(4);
    } finally { random.mockRestore(); }
  },
);

it('does not roll keys for defeats, an already found key, an unlocked gate, or the final boss floor', () => {
  for (const kind of ['defeat', 'found', 'unlocked', 'boss'] as const) {
    const id = `key-ineligible-${kind}`;
    setupBattle(id, kind === 'boss' ? 'slime-king' : 'goblin', kind === 'defeat' ? [1, 1, 1] : [100, 100, 100]);
    if (kind === 'found') grantFloorKey(id);
    if (kind === 'unlocked') {
      const row = db.prepare('SELECT world_json FROM adventures WHERE player_id = ?').get(id) as { world_json: string };
      const world = JSON.parse(row.world_json) as Floor[];
      world[0].exit!.unlocked = true;
      db.prepare('UPDATE adventures SET world_json = ? WHERE player_id = ?').run(JSON.stringify(world), id);
    }
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const fought = step(id, 'd');
      expect(fought.battle!.won).toBe(kind !== 'defeat');
      expect(fought.battle!.keyDrop).toBeUndefined();
      expect(random).toHaveBeenCalledTimes(3);
      if (kind === 'boss') expect(fought.exit).toBeNull();
    } finally { random.mockRestore(); }
  }
});

it('spends a floor key once to open its stairs permanently, leaving later floors locked and ascent free', () => {
  const id = 'key-stairs';
  setupBattle(id, 'slime', [100, 100, 100]);
  const random = vi.spyOn(Math, 'random').mockReturnValue(0);
  try { expect(step(id, 'd').battle!.keyDrop).toEqual({ floor: 1, name: 'Floor Key' }); }
  finally { random.mockRestore(); }
  continueRun(id);
  expect(adventure.changeFloor(id, 'descend', adventure.adventureFor(id).revision)).toMatchObject({ status: 409 });
  expect(adventure.adventureFor(id).exit!.keyFound).toBe(true);
  for (let floor = 1; floor < 5; floor++) {
    db.prepare('UPDATE adventures SET x = ?, y = ? WHERE player_id = ?').run(13, 13, id);
    const locked = adventure.adventureFor(id);
    if (floor > 1) {
      expect(adventure.changeFloor(id, 'descend', locked.revision)).toMatchObject({ status: 409 });
      grantFloorKey(id, floor);
    }
    const descended = adventure.changeFloor(id, 'descend', locked.revision);
    expect(descended).toMatchObject({ floor: floor + 1, x: 2, y: 2 });
    expect(adventure.changeFloor(id, 'descend', locked.revision)).toEqual(descended);
    expect(afterRestart(id)).toEqual(descended);
    const next = adventure.adventureFor(id);
    expect(next.exit).toEqual(floor === 4 ? null : { keyFound: false, unlocked: false, dropRate: 0.05 });
    const returned = adventure.changeFloor(id, 'ascend', next.revision);
    expect(returned).toMatchObject({ floor, x: 13, y: 13, exit: { keyFound: false, unlocked: true } });
    expect(afterRestart(id)).toEqual(returned);
    expect(adventure.changeFloor(id, 'descend', adventure.adventureFor(id).revision)).toMatchObject({ floor: floor + 1 });
  }
  expect(adventure.changeFloor(id, 'descend', adventure.adventureFor(id).revision)).toMatchObject({ status: 409 });
});

it('rolls back a key drop, removed monster, and battle together if the save fails', () => {
  const id = 'atomic-floor-key', before = setupBattle(id, 'slime', [100, 100, 100]);
  const random = vi.spyOn(Math, 'random').mockReturnValue(0);
  db.exec("CREATE TRIGGER reject_key_save BEFORE UPDATE OF world_json ON adventures BEGIN SELECT RAISE(ABORT, 'test key disk failure'); END");
  try { expect(() => step(id, 'd')).toThrow('test key disk failure'); }
  finally { db.exec('DROP TRIGGER reject_key_save'); random.mockRestore(); }
  expect(adventure.adventureFor(id)).toEqual(before);
  expect(afterRestart(id)).toEqual(before);
});

it('persists replenished monsters only after a grass step, and refreshes cannot refill a cleared floor', () => {
  const id = 'key-respawn'; setupBattle(id, 'slime', [100, 100, 100]);
  const row = db.prepare('SELECT world_json FROM adventures WHERE player_id = ?').get(id) as { world_json: string };
  const world = JSON.parse(row.world_json) as Floor[];
  world[0].enemies = []; world[0].encounter!.steps = 0;
  db.prepare('UPDATE adventures SET x = ?, y = ?, world_json = ? WHERE player_id = ?').run(3, 2, JSON.stringify(world), id);
  const cleared = adventure.adventureFor(id);
  expect(cleared.enemies).toEqual([]);
  expect(adventure.patrolAdventure(id)).toEqual(cleared);
  expect(afterRestart(id)).toEqual(cleared);
  expect(step(id, 'd').enemies).toEqual([]);
  const replenished = step(id, 'd');
  expect(replenished.battle).toBeNull();
  expect(replenished.enemies.map(enemy => enemy.id)).toEqual([0, 1, 2, 3].map(i => `f1-wave-1-enemy-${i}`));
  expect(adventure.moveAdventure(id, 'd', cleared.revision)).toEqual(replenished);
  expect(afterRestart(id)).toEqual(replenished);
});

it("the Slime King Bumps for two-thirds of the pet's current HP while that beats its Claw Strike", () => {
  const id = 'bumped';
  const before = setupBattle(id, 'slime-king', [30, 10, 30]); // 70 HP, hits for 30; the king's Claw Strike is 18
  expect(before.enemies.find(e => e.kind === 'slime-king')!.moves).toEqual([expect.objectContaining({ id: 'bump', mpCost: 5 })]);
  expect(before.enemies.filter(e => e.kind !== 'slime-king').every(e => e.moves.length === 0)).toBe(true);
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5); // tails: the king strikes first
  try {
    const result = step(id, 'd');
    expect(result.battle!.playback!.fighters[1].abilities).toEqual(['claw-strike', 'bump']);
    // ceil(70 × 2/3) = 47; then ceil(23 × 2/3) = 16 is less than Claw Strike's 18.
    expect(result.battle!.playback!.turns.map(t => [t.actor, t.ability, t.damage, t.hp])).toEqual([
      [1, 'bump', 47, [23, 40]], [0, 'claw-strike', 30, [23, 10]], [1, 'claw-strike', 18, [5, 10]], [0, 'claw-strike', 10, [5, 0]],
    ]);
    expect(result).toMatchObject({ completed: true, hp: 19, battle: { won: true } });
  } finally { random.mockRestore(); }
});

it('carries HP/MP across battles and floors, restoring 20% of maximum rounded up only once per victory', () => {
  const id = 'recovery'; setupBattle(id, 'slime');
  db.prepare('UPDATE adventures SET hp = ?, mp = ? WHERE player_id = ?').run(17, 0, id);
  const before = adventure.adventureFor(id);
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  try {
    const result = step(id, 'd');
    expect(result.battle!.playback!.initialHp).toEqual([17, 6]);
    expect(result.battle!.playback!.initialMp).toEqual([0, 1]);
    expect(result).toMatchObject({ hp: 21, mp: 2, maxHp: 31, maxMp: 7, battle: { recovery: { hp: 7, mp: 2 } } });
    expect(adventure.moveAdventure(id, 'd', before.revision)).toEqual(result);
    expect(adventure.adventureFor(id)).toEqual(result);
    const continued = continueRun(id);
    expect(adventure.moveAdventure(id, 'd', before.revision)).toEqual(continued);
    // One coin toss, a luck roll for each fighter, and one key drop roll.
    expect(random).toHaveBeenCalledTimes(4);
    grantFloorKey(id);
    db.prepare('UPDATE adventures SET x = ?, y = ? WHERE player_id = ?').run(13, 13, id);
    expect(adventure.changeFloor(id, 'descend', continued.revision)).toMatchObject({ floor: 2, hp: 21, mp: 2 });
    adventure.changeFloor(id, 'ascend', adventure.adventureFor(id).revision);
    db.prepare('UPDATE adventures SET x = ?, y = ? WHERE player_id = ?').run(9, 5, id);
    readyGrassBattle(id, 'f1-enemy-1');
    const next = step(id, 'd');
    expect(next.battle!.playback!.initialHp![0]).toBe(21);
    expect(next.battle!.playback!.initialMp![0]).toBe(2);
    expect(next).toMatchObject({ hp: 23, mp: 4 });
    continueRun(id);
    db.prepare('UPDATE adventures SET x = ?, y = ?, hp = ?, mp = ? WHERE player_id = ?').run(3, 11, 30, 6, id);
    readyGrassBattle(id, 'f1-enemy-2');
    const capped = step(id, 'd');
    expect(capped).toMatchObject({ hp: 31, mp: 7, battle: { recovery: { hp: 4, mp: 1 } } });
    expect(afterRestart(id)).toEqual(capped);
  } finally { random.mockRestore(); }
});

it('ends the adventure on defeat and requires an explicit fresh run; old retries cannot damage or reset the new run', () => {
  const id = 'defeated'; const before = setupBattle(id, 'goblin', [1, 1, 1]);
  const result = step(id, 'd');
  expect(result).toMatchObject({ hp: 0, failed: true, x: before.x + 1, y: before.y, battle: { won: false, recovery: { hp: 0, mp: 0 } } });
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
  // A run in progress has to be abandoned (ending it) before another can start.
  expect(adventure.restartAdventure(id, adventure.adventureFor(id).revision))
    .toEqual({ status: 409, error: 'End this adventure before starting a new one.' });
  expect(afterRestart(id)).toEqual(restarted);
});

function grantCoin(id: string, coin: string) {
  db.prepare('INSERT INTO inventory (player_id, item_id, quantity) VALUES (?, ?, 1)').run(id, coin);
}

it('rejects unknown coins and coins the pet does not own; equipping is reusable, not consumed', () => {
  const id = 'coin-validate'; pets.getOrCreatePet(id);
  expect(pets.equipCoin(id, 'bogus-coin')).toMatchObject({ status: 409 });
  expect(pets.equipCoin(id, 'silver-coin')).toMatchObject({ status: 409 }); // not owned yet
  grantCoin(id, 'silver-coin');
  const equipped = pets.equipCoin(id, 'silver-coin');
  if ('error' in equipped) throw new Error(equipped.error);
  expect(equipped.pet.equippedCoin).toBe('silver-coin');
  expect(pets.getPet(id)!.coins['silver-coin']).toBe(1); // not spent
  const unequipped = pets.equipCoin(id, null);
  if ('error' in unequipped) throw new Error(unequipped.error);
  expect(unequipped.pet.equippedCoin).toBe(null);
});

it("a Silver coin forces the pet to attack first against a much stronger goblin", () => {
  const id = 'coin-silver';
  setupBattle(id, 'goblin', [1, 1, 1]); // power 4, far below floor-1 goblin's 15
  grantCoin(id, 'silver-coin');
  expect(pets.equipCoin(id, 'silver-coin')).not.toHaveProperty('error');
  const result = step(id, 'd');
  expect(result.battle!.playback!.turns[0].actor).toBe(0);
  expect(result.battle!.playback!.initiative).toMatchObject({ toss: null, coin: 'silver-coin', provider: 0, providerId: id });
});

it("a Gold coin makes the pet attack second but doubles its own first hit", () => {
  const id = 'coin-gold';
  setupBattle(id, 'goblin', [3, 1, 5]); // maxHp 9, per-hit damage scales with luck
  grantCoin(id, 'gold-coin');
  expect(pets.equipCoin(id, 'gold-coin')).not.toHaveProperty('error');
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5); // luck factor exactly 1.0
  try {
    const result = step(id, 'd');
    const turns = result.battle!.playback!.turns;
    expect(turns[0].actor).toBe(1); // the goblin, not the pet, strikes first
    const petTurns = turns.filter(t => t.actor === 0);
    expect(result.battle!.playback!.fighters[0].damage).toBe(3);
    expect(petTurns[0].damage).toBe(6); // double the base 3
  } finally { random.mockRestore(); }
});

it("a Copper coin adds HP/MP to one monster battle as a shield, without changing real attributes or the saved max", () => {
  const id = 'coin-copper';
  const before = setupBattle(id, 'slime', [12, 7, 12]); // maxHp 31, maxMp 7
  grantCoin(id, 'copper-coin');
  expect(pets.equipCoin(id, 'copper-coin')).not.toHaveProperty('error');
  expect(before).toMatchObject({ hp: 31, mp: 7, maxHp: 31, maxMp: 7 });
  const realStats = pets.getPet(id)!;
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5); // tails: the slime hits first, for exactly 3
  try {
    const result = step(id, 'd');
    expect(result.battle!.playback!.fighters[0]).toMatchObject({ maxHp: 34, maxMp: 8 });
    expect(result.battle!.playback!.initialHp![0]).toBe(34);
    expect(result.battle!.playback!.initialMp![0]).toBe(8);
    expect(result.battle!.playback!.turns[0]).toMatchObject({ actor: 1, damage: 3, hp: [31, 6] });
    // The shield took the whole hit; its unused MP is gone, and nothing is recovered past full.
    expect(result).toMatchObject({ hp: 31, mp: 7, maxHp: 31, maxMp: 7, battle: { won: true, after: { hp: 31, mp: 7 } } });
  } finally { random.mockRestore(); }
  expect(pets.getPet(id)).toMatchObject({
    strength: realStats.strength, intelligence: realStats.intelligence, charisma: realStats.charisma,
  });
});

it("a Copper shield absorbs damage for a hurt pet first but never heals it", () => {
  const id = 'coin-copper-hurt';
  setupBattle(id, 'goblin', [12, 7, 12]); // maxHp 31, maxMp 7; the goblin hits for exactly 5
  db.prepare('UPDATE adventures SET hp = ?, mp = ? WHERE player_id = ?').run(10, 2, id);
  grantCoin(id, 'copper-coin');
  expect(pets.equipCoin(id, 'copper-coin')).not.toHaveProperty('error');
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  try {
    const result = step(id, 'd');
    expect(result.battle!.playback!.initialHp![0]).toBe(13);
    expect(result.battle!.playback!.initialMp![0]).toBe(3);
    expect(result.battle!.playback!.turns[0]).toMatchObject({ actor: 1, damage: 5, hp: [8, 10] });
    // 3 of the 5 damage came off the shield: 10 → 8, then a victory's 7 HP / 2 MP recovery.
    expect(result).toMatchObject({ hp: 15, mp: 4, battle: { won: true, recovery: { hp: 7, mp: 2 }, after: { hp: 15, mp: 4 } } });
  } finally { random.mockRestore(); }
});

it("an Arena fight uses the stronger defender's equipped coin", () => {
  const attacker = 'coin-attacker', defender = 'coin-defender';
  pets.getOrCreatePet(attacker); pets.getOrCreatePet(defender);
  db.prepare('UPDATE pets SET strength = 1, intelligence = 1, charisma = 1 WHERE id = ?').run(attacker);
  db.prepare('UPDATE pets SET strength = 20, intelligence = 1, charisma = 1 WHERE id = ?').run(defender);
  grantCoin(attacker, 'silver-coin'); grantCoin(defender, 'gold-coin');
  expect(pets.equipCoin(attacker, 'silver-coin')).not.toHaveProperty('error');
  expect(pets.equipCoin(defender, 'gold-coin')).not.toHaveProperty('error');
  const outcome = pets.fight(attacker, defender);
  if ('error' in outcome) throw new Error(outcome.error);
  expect(outcome.session.battle).toMatchObject({ coinProvider: 1, actor: 0, turns: [], initiative: { coin: 'gold-coin' } });
});

it('a studying pet cannot move, use stairs, open chests, or start over, but can view, finish a battle, and use items', () => {
  const id = 'busy-explorer';
  setupBattle(id, 'slime');
  grantFloorKey(id);
  const fought = step(id, 'd'); // the battle started while idle
  expect(pets.study(id, 'math')).not.toHaveProperty('error');
  const continued = adventure.continueAdventure(id, fought.battle!.id, adventure.adventureFor(id).revision);
  if ('error' in continued) throw new Error(continued.error);
  const busy = { status: 409, error: 'Your pet is busy studying Math. Wait until it\'s done.' };
  expect(adventure.moveAdventure(id, 'd', continued.revision)).toEqual(busy);
  db.prepare('UPDATE adventures SET x = ?, y = ? WHERE player_id = ?').run(11, 3, id);
  expect(adventure.openAdventureChest(id, continued.revision)).toEqual(busy);
  db.prepare('UPDATE adventures SET x = ?, y = ? WHERE player_id = ?').run(13, 13, id);
  expect(adventure.changeFloor(id, 'descend', continued.revision)).toEqual(busy);
  const pet = pets.getPet(id)!;
  expect(adventure.restartAdventure(id, continued.revision)).toEqual(busy);
  expect(pets.getPet(id)).toEqual(pet); // nothing charged
  expect(adventure.adventureFor(id)).toMatchObject({ floor: 1, x: 13, y: 13, revision: continued.revision });
  db.prepare('UPDATE pets SET food = 1 WHERE id = ?').run(id);
  expect(adventure.useAdventureItem(id, 'food', continued.revision)).not.toHaveProperty('error');
  // Once the lesson's time is up the pet may explore, even before its timer pays it out.
  db.prepare('UPDATE pets SET busy_until = ? WHERE id = ?').run(Date.now() - 1, id);
  expect(pets.getPet(id)!.activity).toBe('studying');
  expect(adventure.changeFloor(id, 'descend', adventure.adventureFor(id).revision)).toMatchObject({ floor: 2 });
});

it('migrates old maps once, conceals ordinary monster coordinates, and keeps polls read-only', () => {
  const id = 'old-grass'; pets.getOrCreatePet(id);
  const start = adventure.adventureFor(id), world = createWorld();
  world[0].enemies.shift();
  for (const floor of world) { delete floor.grass; delete floor.encounter; delete floor.exit; }
  db.prepare('UPDATE adventures SET world_json = ? WHERE player_id = ?').run(JSON.stringify(world), id);
  const migrated = adventure.adventureFor(id);
  expect(migrated.revision).toBe(start.revision);
  expect(migrated.grass.some(row => row.includes('g'))).toBe(true);
  expect(migrated.enemies).toHaveLength(3);
  expect(migrated.exit).toEqual({ keyFound: false, unlocked: true, dropRate: 0.05 });
  for (const enemy of migrated.enemies) {
    expect(enemy.hidden).toBe(true);
    for (const key of ['x', 'y', 'route', 'leg']) expect(enemy).not.toHaveProperty(key);
  }
  const saved = db.prepare('SELECT world_json FROM adventures WHERE player_id = ?').get(id);
  for (let i = 0; i < 5; i++) expect(adventure.patrolAdventure(id)).toEqual(migrated);
  expect(db.prepare('SELECT world_json FROM adventures WHERE player_id = ?').get(id)).toEqual(saved);
  expect(afterRestart(id)).toEqual(migrated);
});

it('saves surprise battles on the entered grass tile, while waiting and retries cannot reroll them', () => {
  const id = 'ambushed', start = setupBattle(id, 'slime', [100, 100, 100]);
  expect(adventure.patrolAdventure(id)).toEqual(start);
  const attacked = step(id, 'd');
  expect(attacked).toMatchObject({ x: start.x + 1, y: start.y, battle: { surprise: true, pending: true, won: true, enemyId: 'f1-enemy-0' } });
  expect(attacked.revision).not.toBe(start.revision);
  expect(attacked.enemies.some(e => e.id === 'f1-enemy-0')).toBe(false);
  expect(afterRestart(id)).toEqual(attacked);
  expect(adventure.moveAdventure(id, 'd', start.revision)).toEqual(attacked);
  expect(continueRun(id)).toMatchObject({ x: start.x + 1, battle: { pending: false } });
  const after = db.prepare('SELECT world_json FROM adventures WHERE player_id = ?').get(id) as { world_json: string };
  expect((JSON.parse(after.world_json) as Floor[])[0].encounter!.steps).toBe(0);
});

it('does not advance grass encounters for blocked moves, busy pets, or a pending battle', () => {
  const id = 'grass-paused'; setupBattle(id, 'slime', [100, 100, 100]);
  const savedWorld = () => db.prepare('SELECT world_json FROM adventures WHERE player_id = ?').get(id);
  const before = savedWorld();
  db.prepare('UPDATE adventures SET x = ?, y = ? WHERE player_id = ?').run(1, 1, id);
  expect(adventure.moveAdventure(id, 'w', adventure.adventureFor(id).revision)).toMatchObject({ status: 409 });
  expect(savedWorld()).toEqual(before);
  expect(pets.study(id, 'math')).not.toHaveProperty('error');
  db.prepare('UPDATE adventures SET x = ?, y = ? WHERE player_id = ?').run(5, 2, id);
  expect(adventure.moveAdventure(id, 'd', adventure.adventureFor(id).revision)).toMatchObject({ status: 409 });
  expect(savedWorld()).toEqual(before);
  db.prepare('UPDATE pets SET busy_until = ? WHERE id = ?').run(Date.now() - 1, id);
  const fought = step(id, 'd'), after = savedWorld();
  expect(adventure.patrolAdventure(id)).toEqual(fought);
  expect(step(id, 'd')).toEqual(fought);
  expect(savedWorld()).toEqual(after);
  continueRun(id);
  const abandoned = adventure.abandonAdventure(id, adventure.adventureFor(id).revision);
  expect(adventure.patrolAdventure(id)).toEqual(abandoned);
});

it('refuses to restart when stamina or hygiene is too low, spending nothing; charges the flat cost on success', () => {
  const id = 'restart-cost'; pets.getOrCreatePet(id);
  const saved = adventure.abandonAdventure(id, adventure.adventureFor(id).revision);
  if ('error' in saved) throw new Error(saved.error);
  db.prepare('UPDATE pets SET stamina = ?, hygiene = ? WHERE id = ?').run(39, 100, id);
  expect(adventure.restartAdventure(id, saved.revision)).toMatchObject({ status: 409 });
  expect(pets.getPet(id)).toMatchObject({ stamina: 39, hygiene: 100 });
  db.prepare('UPDATE pets SET stamina = ?, hygiene = ? WHERE id = ?').run(100, 19, id);
  expect(adventure.restartAdventure(id, saved.revision)).toMatchObject({ status: 409 });
  expect(pets.getPet(id)).toMatchObject({ stamina: 100, hygiene: 19 });
  db.prepare('UPDATE pets SET stamina = ?, hygiene = ? WHERE id = ?').run(100, 100, id);
  expect(adventure.restartAdventure(id, saved.revision)).toMatchObject({ floor: 1 });
  expect(pets.getPet(id)).toMatchObject({ stamina: 60, hygiene: 80 });
});

it('abandoning ends a run in progress at once and for free; the next fresh run pays the flat cost', () => {
  const id = 'abandon-run';
  const before = setupBattle(id, 'slime');
  db.prepare('UPDATE adventures SET x = ?, y = ? WHERE player_id = ?').run(11, 3, id); // on the chest
  const pet = pets.getPet(id)!;
  expect(adventure.adventureFor(id)).toMatchObject({ failed: false, completed: false, abandoned: false });
  const abandoned = adventure.abandonAdventure(id, before.revision);
  if ('error' in abandoned) throw new Error(abandoned.error);
  expect(abandoned).toMatchObject({ abandoned: true, failed: false, completed: false, floor: 1, x: 11, y: 3, cooldownUntil: null });
  expect(pets.getPet(id)).toEqual(pet); // nothing charged
  // The ended run can't be played on, and retries or a second abandon change nothing.
  expect(adventure.moveAdventure(id, 'a', abandoned.revision)).toEqual(abandoned);
  expect(adventure.openAdventureChest(id, abandoned.revision)).toEqual(abandoned);
  expect(adventure.abandonAdventure(id, before.revision)).toEqual(abandoned);
  expect(adventure.abandonAdventure(id, abandoned.revision)).toEqual(abandoned);
  expect(afterRestart(id)).toEqual(abandoned);
  const fresh = adventure.restartAdventure(id, abandoned.revision);
  if ('error' in fresh) throw new Error(fresh.error);
  expect(fresh).toMatchObject({ abandoned: false, floor: 1, x: 2, y: 2 });
  expect(fresh.cooldownUntil).toBeGreaterThan(Date.now());
  expect(pets.getPet(id)).toMatchObject({ stamina: pet.stamina - 40, hygiene: pet.hygiene - 20 });
});

it('cannot abandon a run with a pending battle or one already over', () => {
  const id = 'abandon-ended';
  setupBattle(id, 'goblin', [1, 1, 1]);
  const lost = step(id, 'd');
  expect(lost).toMatchObject({ failed: true, battle: { pending: true } });
  expect(adventure.abandonAdventure(id, lost.revision)).toEqual(lost);
  const failed = continueRun(id);
  expect(adventure.abandonAdventure(id, failed.revision)).toEqual(failed);
  expect(failed.abandoned).toBe(false);
  const king = 'abandon-complete';
  setupBattle(king, 'slime-king', [100, 100, 100]); step(king, 'd');
  const complete = continueRun(king);
  expect(complete.completed).toBe(true);
  expect(adventure.abandonAdventure(king, complete.revision)).toEqual(complete);
});

it('opens a cooldown after restarting, refuses another restart until it expires, and can be skipped with an Hourglass', () => {
  const id = 'adventure-cooldown'; pets.getOrCreatePet(id);
  const first = adventure.abandonAdventure(id, adventure.adventureFor(id).revision);
  if ('error' in first) throw new Error(first.error);
  const fresh = adventure.restartAdventure(id, first.revision);
  if ('error' in fresh) throw new Error(fresh.error);
  expect(fresh.cooldownUntil).toBeGreaterThan(Date.now());
  // Abandoning stays free during the cooldown; starting the next run waits for it.
  const started = adventure.abandonAdventure(id, fresh.revision);
  if ('error' in started) throw new Error(started.error);
  expect(started).toMatchObject({ abandoned: true, cooldownUntil: fresh.cooldownUntil });
  const blocked = adventure.restartAdventure(id, started.revision);
  expect(blocked).toMatchObject({ status: 429 });
  expect((blocked as { error: string }).error).toMatch(/rest/i);
  expect(adventure.skipAdventureCooldown(id, started.revision)).toMatchObject({ status: 409 }); // no hourglass yet
  db.prepare('UPDATE pets SET hourglass = 1 WHERE id = ?').run(id);
  const skipped = adventure.skipAdventureCooldown(id, adventure.adventureFor(id).revision);
  if ('error' in skipped) throw new Error(skipped.error);
  expect(skipped.cooldownUntil).toBe(null);
  expect(pets.getPet(id)).toMatchObject({ hourglass: 0 });
  expect(adventure.restartAdventure(id, skipped.revision)).not.toHaveProperty('error');
});

it('treats skipping the cooldown as a harmless no-op when none is active', () => {
  const id = 'no-cooldown-to-skip'; pets.getOrCreatePet(id);
  const saved = adventure.adventureFor(id);
  expect(saved.cooldownUntil).toBe(null);
  expect(adventure.skipAdventureCooldown(id, saved.revision)).toEqual(saved);
});

function enter(id: string, entryId: string) {
  const result = adventure.enterAdventure(id, adventure.adventureFor(id).revision, entryId);
  if ('error' in result) throw new Error(result.error);
  return result;
}

it('starts the first solo entry free and resets progress on later entries exactly once, preserving earned inventory', () => {
  const id = 'fresh-entries'; pets.getOrCreatePet(id);
  const original = pets.getPet(id), unread = adventure.adventureFor(id);
  const first = enter(id, 'entry-one');
  expect(first).toMatchObject({ started: true, entryId: 'entry-one', awaitingEntry: false, cooldownUntil: null });
  expect(pets.getPet(id)).toEqual(original);
  standOnChest(id); openChest(id, 0);
  grantFloorKey(id);
  db.prepare('UPDATE adventures SET x = ?, y = ? WHERE player_id = ?').run(13, 13, id);
  adventure.changeFloor(id, 'descend', adventure.adventureFor(id).revision);
  const explored = step(id, 'd');
  expect(explored.floor).toBe(2);
  expect(adventure.patrolAdventure(id)).toEqual(explored);
  expect(adventure.enterAdventure(id, unread.revision, 'entry-one')).toEqual(explored);
  expect(afterRestart(id)).toEqual(explored);
  const next = enter(id, 'entry-two');
  expect(next).toMatchObject({ floor: 1, x: 2, y: 2, hp: 15, mp: 5, battle: null, battleCount: 0, records: [],
    entryId: 'entry-two', exit: { keyFound: false, unlocked: false }, abandoned: false, team: null });
  expect(next.chests[0]).not.toHaveProperty('reward');
  expect(pets.getPet(id)).toMatchObject({ food: 1, stamina: 60, hygiene: 80 });
  expect(adventure.enterAdventure(id, explored.revision, 'entry-two')).toEqual(next);
  expect(adventure.enterAdventure(id, explored.revision, 'stale-third-entry')).toEqual(next);
  expect(adventure.moveAdventure(id, 'd', explored.revision)).toEqual(next);
  expect(pets.getPet(id)).toMatchObject({ food: 1, stamina: 60, hygiene: 80 });
  expect(afterRestart(id)).toEqual(next);
});

it('ends a previous run before refusing a new entry for rest, care, or a busy pet', () => {
  for (const reason of ['rest', 'care', 'busy'] as const) {
    const id = `entry-refusal-${reason}`; pets.getOrCreatePet(id); enter(id, 'old-entry');
    step(id, 'd');
    if (reason === 'rest') db.prepare('UPDATE adventures SET cooldown_until = ? WHERE player_id = ?').run(Date.now() + 60_000, id);
    if (reason === 'care') db.prepare('UPDATE pets SET stamina = ? WHERE id = ?').run(0, id);
    if (reason === 'busy') pets.study(id, 'math');
    const before = adventure.adventureFor(id), pet = pets.getPet(id);
    expect(adventure.enterAdventure(id, before.revision, 'new-entry')).toMatchObject({ status: reason === 'rest' ? 429 : 409 });
    const ended = adventure.adventureFor(id);
    expect(ended).toMatchObject({ abandoned: true, entryId: 'old-entry', x: 3, y: 2 });
    expect(adventure.moveAdventure(id, 'd', ended.revision)).toEqual(ended);
    expect(pets.getPet(id)).toEqual(pet);
    expect(afterRestart(id)).toEqual(ended);
  }
});

it('reveals accumulated exact battle records only after leaving, and a later entry clears that run’s records', () => {
  const id = 'ended-records'; setupBattle(id, 'slime', [100, 100, 100]);
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  try {
    const first = step(id, 'd');
    expect(first).toMatchObject({ records: [], battleCount: 1 });
    expect(first.battle!.playback).not.toBeNull();
    const continued = continueRun(id);
    expect(continued).toMatchObject({ records: [], battleCount: 1, battle: { playback: null, pending: false } });
    expect(afterRestart(id)).toEqual(continued);
    db.prepare('UPDATE adventures SET x = ?, y = ? WHERE player_id = ?').run(9, 5, id);
    readyGrassBattle(id, 'f1-enemy-1');
    const second = step(id, 'd');
    expect(second.records).toEqual([]);
    const left = adventure.leaveAdventure(id, second.revision);
    if ('error' in left) throw new Error(left.error);
    expect(left).toMatchObject({ abandoned: true, battleCount: 2, battle: { pending: false } });
    expect(left.records).toEqual([{ ...first.battle, pending: false }, { ...second.battle, pending: false }]);
    expect(adventure.leaveAdventure(id, second.revision)).toEqual(left);
    expect(adventure.leaveAdventure(id, left.revision)).toEqual(left);
    expect(afterRestart(id)).toEqual(left);
    expect(random).toHaveBeenCalledTimes(8);
    const fresh = enter(id, 'records-next-entry');
    expect(fresh).toMatchObject({ records: [], battleCount: 0, battle: null, abandoned: false });
    expect(adventure.leaveAdventure(id, left.revision)).toEqual(fresh);
  } finally { random.mockRestore(); }
});

it('reveals defeat and completion records after acknowledging the final encounter', () => {
  for (const result of ['defeat', 'completion'] as const) {
    const id = `records-${result}`;
    setupBattle(id, result === 'completion' ? 'slime-king' : 'goblin', result === 'completion' ? [100, 100, 100] : [1, 1, 1]);
    const fought = step(id, 'd');
    expect(fought.records).toEqual([]);
    const ended = continueRun(id);
    expect(ended.records).toEqual([{ ...fought.battle, pending: false }]);
    expect(ended.battle!.playback).toEqual(fought.battle!.playback);
    expect(adventure.moveAdventure(id, 'd', ended.revision)).toEqual(ended);
    expect(adventure.openAdventureChest(id, ended.revision)).toEqual(ended);
    expect(adventure.changeFloor(id, 'ascend', ended.revision)).toEqual(ended);
    expect(afterRestart(id)).toEqual(ended);
  }
});

it('retains the last saved replay when migrating a run without a battle record list', () => {
  const id = 'legacy-battle-record'; setupBattle(id, 'slime', [100, 100, 100]);
  const fought = step(id, 'd');
  db.prepare('UPDATE adventures SET records_json = NULL WHERE player_id = ?').run(id);
  expect(adventure.adventureFor(id)).toMatchObject({ records: [], battleCount: 1 });
  const left = adventure.leaveAdventure(id, fought.revision);
  if ('error' in left) throw new Error(left.error);
  expect(left.records).toEqual([{ ...fought.battle, pending: false }]);
  expect(afterRestart(id)).toEqual(left);
});

it('bounds saved replays during an unlimited key search while retaining the full battle count', () => {
  const id = 'bounded-records'; setupBattle(id, 'slime', [100, 100, 100]);
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const battles: string[] = [];
  try {
    for (let i = 0; i < 57; i++) {
      db.prepare('UPDATE adventures SET x = ?, y = ? WHERE player_id = ?').run(5, 2, id);
      readyGrassBattle(id, 'f1-enemy-0');
      const fought = step(id, 'd');
      expect(fought.battle!.pending).toBe(true);
      battles.push(fought.battle!.id);
      continueRun(id);
    }
    const hidden = adventure.adventureFor(id);
    expect(hidden).toMatchObject({ records: [], battleCount: 57, recordLimit: 50 });
    const left = adventure.leaveAdventure(id, hidden.revision);
    if ('error' in left) throw new Error(left.error);
    expect(left.records.map(battle => battle.id)).toEqual(battles.slice(-50));
    expect(left.battleCount).toBe(57);
    expect(afterRestart(id)).toEqual(left);
    const stored = db.prepare('SELECT records_json FROM adventures WHERE player_id = ?').get(id) as { records_json: string };
    expect(JSON.parse(stored.records_json).battles).toHaveLength(50);
  } finally { random.mockRestore(); }
});

it('rolls back entry charges and retired progress together if creating the fresh run fails', () => {
  const id = 'atomic-entry'; pets.getOrCreatePet(id); enter(id, 'atomic-first'); step(id, 'd');
  const before = adventure.adventureFor(id), pet = pets.getPet(id);
  db.exec("CREATE TRIGGER reject_entry BEFORE UPDATE OF entry_id ON adventures WHEN NEW.entry_id <> OLD.entry_id BEGIN SELECT RAISE(ABORT, 'test entry disk failure'); END");
  try { expect(() => enter(id, 'atomic-next')).toThrow('test entry disk failure'); }
  finally { db.exec('DROP TRIGGER reject_entry'); }
  expect(adventure.adventureFor(id)).toEqual(before);
  expect(pets.getPet(id)).toEqual(pet);
});

it('waits for an equipped skill, persists unfinished turns, and never attacks on reads or acknowledgements', () => {
  const id = 'manual-turns';
  const before = setupBattle(id, 'slime', [3, 10, 10]);
  grantCoin(id, 'silver-coin'); pets.equipCoin(id, 'silver-coin');
  const started = adventure.moveAdventure(id, 'd', before.revision);
  if ('error' in started) throw new Error(started.error);
  const battle = started.battle!.playback as ActiveBattle;
  expect(battle).toMatchObject({ status: 'active', actor: 0, turns: [], hp: [23, 6], mp: [10, 1], coinProvider: 0 });
  expect(started).toMatchObject({ battleCount: 0, records: [], battle: { won: false, pending: true } });
  expect(started.enemies.some(enemy => enemy.id === started.battle!.enemyId)).toBe(true);
  expect(adventure.patrolAdventure(id)).toEqual(started);
  expect(afterRestart(id)).toEqual(started);
  expect(adventure.continueAdventure(id, started.battle!.id, started.revision)).toMatchObject({ status: 409 });
  for (const ability of ['firebolt', '__proto__', null, ['claw-strike']]) {
    expect(adventure.adventureBattleSkill(id, started.battle!.id, battle.revision, ability)).toHaveProperty('error');
  }
  expect(adventure.adventureBattleSkill(id, started.battle!.id, undefined, 'claw-strike')).toMatchObject({ status: 400 });
  expect(adventure.adventureBattleSkill(id, 'other-battle', battle.revision, 'claw-strike')).toMatchObject({ status: 409 });
  const chosen = adventure.adventureBattleSkill(id, started.battle!.id, battle.revision, 'claw-strike');
  if ('error' in chosen) throw new Error(chosen.error);
  expect(chosen.battle!.playback!.turns.map(turn => turn.actor)).toEqual([0, 1]);
  expect(chosen.battleCount).toBe(0);
  expect(adventure.adventureBattleSkill(id, started.battle!.id, battle.revision, 'claw-strike')).toEqual(chosen);
  expect(afterRestart(id)).toEqual(chosen);
  const final = finishBattle(id);
  expect(final).toMatchObject({ battleCount: 1, records: [], battle: { won: true, playback: { status: 'finished' } } });
  expect(adventure.adventureBattleSkill(id, started.battle!.id, battle.revision, 'claw-strike')).toEqual(final);
});

it('retreating from an unfinished solo encounter ends it without a key or victory recovery', () => {
  const id = 'manual-retreat', before = setupBattle(id, 'slime');
  grantCoin(id, 'silver-coin'); pets.equipCoin(id, 'silver-coin');
  const started = adventure.moveAdventure(id, 'd', before.revision);
  if ('error' in started) throw new Error(started.error);
  const battle = started.battle!.playback as ActiveBattle;
  const random = vi.spyOn(Math, 'random');
  try {
    const ended = adventure.forfeitAdventureBattle(id, started.battle!.id, battle.revision);
    if ('error' in ended) throw new Error(ended.error);
    expect(ended).toMatchObject({ abandoned: true, hp: 0, battleCount: 1, battle: { pending: false, won: false, playback: { status: 'finished' }, recovery: { hp: 0, mp: 0 } } });
    expect(ended.records).toHaveLength(1);
    expect(ended.battle!.keyDrop).toBeUndefined();
    expect(ended.enemies).toEqual(started.enemies);
    expect(random).not.toHaveBeenCalled();
    expect(adventure.forfeitAdventureBattle(id, started.battle!.id, battle.revision)).toEqual(ended);
  } finally { random.mockRestore(); }
});

it('rolls back a final manual turn, its recovery, monster removal, and key together when saving fails', () => {
  const id = 'manual-final-atomic', before = setupBattle(id, 'slime', [100, 100, 100]);
  grantCoin(id, 'silver-coin'); pets.equipCoin(id, 'silver-coin');
  const started = adventure.moveAdventure(id, 'd', before.revision);
  if ('error' in started) throw new Error(started.error);
  const battle = started.battle!.playback as ActiveBattle;
  db.exec("CREATE TRIGGER reject_manual_turn BEFORE UPDATE OF battle_json ON adventures BEGIN SELECT RAISE(ABORT, 'test turn disk failure'); END");
  const random = vi.spyOn(Math, 'random').mockReturnValue(0);
  try {
    expect(() => adventure.adventureBattleSkill(id, started.battle!.id, battle.revision, 'claw-strike')).toThrow('test turn disk failure');
  } finally { db.exec('DROP TRIGGER reject_manual_turn'); random.mockRestore(); }
  expect(adventure.adventureFor(id)).toEqual(started);
  expect(finishBattle(id).battleCount).toBe(1);
});
