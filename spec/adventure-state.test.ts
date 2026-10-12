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
  expect(pets.getPet('legacy')).toMatchObject({ abilities: ['claw-strike'], coins: { 'copper-coin': 0, 'silver-coin': 0, 'gold-coin': 0 } });
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

it('loads learned abilities into both monster and Arena battles, spending carried MP only once', () => {
  const id = 'learned-fighter'; standOnChest(id); openChest(id, 0.6);
  const before = setupBattle(id, 'goblin', [5, 10, 12]);
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  try {
    const result = step(id, 'd');
    expect(result.battle!.playback.turns.find(turn => turn.actor === 0)).toMatchObject({ ability: 'firebolt', mpCost: 3 });
    expect(adventure.moveAdventure(id, 'd', before.revision)).toEqual(result);
    expect(result.battle!.playback.initialMp![0]).toBe(before.mp);
    pets.getOrCreatePet('learned-opponent');
    const arena = pets.fight(id, 'learned-opponent');
    if ('error' in arena) throw new Error(arena.error);
    expect(arena.fight.battle!.turns.find(turn => turn.actor === 0)).toMatchObject({ ability: 'firebolt', mpCost: 3 });
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
  expect(result.battle!.playback.fighters[1]).toMatchObject({ monster: kind });
  expect(result.completed).toBe(kind === 'slime-king');
  expect(afterRestart(id)).toEqual(result);
  const continued = continueRun(id);
  expect(afterRestart(id)).toEqual(continued);
  expect(continued.battle!.playback).toEqual(result.battle!.playback);
  expect(pets.getPet(id)).toEqual(pet);
});

it("the Slime King Bumps for two-thirds of the pet's current HP while that beats its Claw Strike", () => {
  const id = 'bumped';
  const before = setupBattle(id, 'slime-king', [30, 10, 30]); // 70 HP, hits for 30; the king's Claw Strike is 18
  expect(before.enemies.find(e => e.kind === 'slime-king')!.moves).toEqual([expect.objectContaining({ id: 'bump', mpCost: 5 })]);
  expect(before.enemies.filter(e => e.kind !== 'slime-king').every(e => e.moves.length === 0)).toBe(true);
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5); // tails: the king strikes first
  try {
    const result = step(id, 'd');
    expect(result.battle!.playback.fighters[1].abilities).toEqual(['claw-strike', 'bump']);
    // ceil(70 × 2/3) = 47; then ceil(23 × 2/3) = 16 is less than Claw Strike's 18.
    expect(result.battle!.playback.turns.map(t => [t.actor, t.ability, t.damage, t.hp])).toEqual([
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
    expect(result.battle!.playback.initialHp).toEqual([17, 6]);
    expect(result.battle!.playback.initialMp).toEqual([0, 1]);
    expect(result).toMatchObject({ hp: 21, mp: 2, maxHp: 31, maxMp: 7, battle: { recovery: { hp: 7, mp: 2 } } });
    expect(adventure.moveAdventure(id, 'd', before.revision)).toEqual(result);
    expect(adventure.adventureFor(id)).toEqual(result);
    const continued = continueRun(id);
    expect(adventure.moveAdventure(id, 'd', before.revision)).toEqual(continued);
    // One coin toss plus a luck roll for each fighter.
    expect(random).toHaveBeenCalledTimes(3);
    db.prepare('UPDATE adventures SET x = ?, y = ? WHERE player_id = ?').run(13, 13, id);
    expect(adventure.changeFloor(id, 'descend', continued.revision)).toMatchObject({ floor: 2, hp: 21, mp: 2 });
    adventure.changeFloor(id, 'ascend', adventure.adventureFor(id).revision);
    db.prepare('UPDATE adventures SET x = ?, y = ? WHERE player_id = ?').run(9, 5, id);
    const next = step(id, 'd');
    expect(next.battle!.playback.initialHp![0]).toBe(21);
    expect(next.battle!.playback.initialMp![0]).toBe(2);
    expect(next).toMatchObject({ hp: 23, mp: 4 });
    continueRun(id);
    db.prepare('UPDATE adventures SET x = ?, y = ?, hp = ?, mp = ? WHERE player_id = ?').run(3, 11, 30, 6, id);
    const capped = step(id, 'd');
    expect(capped).toMatchObject({ hp: 31, mp: 7, battle: { recovery: { hp: 4, mp: 1 } } });
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
  // A run in progress has to be abandoned (ending it) before another can start.
  expect(adventure.restartAdventure(id, adventure.adventureFor(id).revision))
    .toEqual({ status: 409, error: 'Abandon this adventure before starting a new one.' });
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
  expect(result.battle!.playback.turns[0].actor).toBe(0);
  expect(result.battle!.playback.initiative).toEqual({ toss: null, coin: 'silver-coin' });
});

it("a Gold coin makes the pet attack second but doubles its own first hit", () => {
  const id = 'coin-gold';
  setupBattle(id, 'goblin', [3, 1, 5]); // maxHp 9, per-hit damage scales with luck
  grantCoin(id, 'gold-coin');
  expect(pets.equipCoin(id, 'gold-coin')).not.toHaveProperty('error');
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5); // luck factor exactly 1.0
  try {
    const result = step(id, 'd');
    const turns = result.battle!.playback.turns;
    expect(turns[0].actor).toBe(1); // the goblin, not the pet, strikes first
    const petTurns = turns.filter(t => t.actor === 0);
    expect(result.battle!.playback.fighters[0].damage).toBe(3);
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
    expect(result.battle!.playback.fighters[0]).toMatchObject({ maxHp: 34, maxMp: 8 });
    expect(result.battle!.playback.initialHp![0]).toBe(34);
    expect(result.battle!.playback.initialMp![0]).toBe(8);
    expect(result.battle!.playback.turns[0]).toMatchObject({ actor: 1, damage: 3, hp: [31, 6] });
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
    expect(result.battle!.playback.initialHp![0]).toBe(13);
    expect(result.battle!.playback.initialMp![0]).toBe(3);
    expect(result.battle!.playback.turns[0]).toMatchObject({ actor: 1, damage: 5, hp: [8, 10] });
    // 3 of the 5 damage came off the shield: 10 → 8, then a victory's 7 HP / 2 MP recovery.
    expect(result).toMatchObject({ hp: 15, mp: 4, battle: { won: true, recovery: { hp: 7, mp: 2 }, after: { hp: 15, mp: 4 } } });
  } finally { random.mockRestore(); }
});

it("an Arena fight applies only the attacker's equipped coin; the defender's is ignored", () => {
  const attacker = 'coin-attacker', defender = 'coin-defender';
  pets.getOrCreatePet(attacker); pets.getOrCreatePet(defender);
  db.prepare('UPDATE pets SET strength = 1, intelligence = 1, charisma = 1 WHERE id = ?').run(attacker);
  db.prepare('UPDATE pets SET strength = 20, intelligence = 1, charisma = 1 WHERE id = ?').run(defender);
  grantCoin(attacker, 'silver-coin'); grantCoin(defender, 'gold-coin');
  expect(pets.equipCoin(attacker, 'silver-coin')).not.toHaveProperty('error');
  expect(pets.equipCoin(defender, 'gold-coin')).not.toHaveProperty('error');
  const outcome = pets.fight(attacker, defender);
  if ('error' in outcome) throw new Error(outcome.error);
  // Silver forces the far weaker attacker first; the defender's Gold never applies.
  expect(outcome.fight.battle!.turns[0].actor).toBe(0);
});

it("a revenge battle applies only the victim's equipped coin; the thief's is ignored", () => {
  const victim = 'coin-victim', thief = 'coin-thief';
  pets.getOrCreatePet(victim); pets.getOrCreatePet(thief);
  db.prepare('UPDATE pets SET strength = 1, intelligence = 1, charisma = 1, money = 20 WHERE id = ?').run(victim);
  db.prepare('UPDATE pets SET strength = 20, intelligence = 1, charisma = 1, money = 1000 WHERE id = ?').run(thief);
  const stolen = pets.steal(thief, victim);
  if ('error' in stolen) throw new Error(stolen.error);
  grantCoin(victim, 'silver-coin'); grantCoin(thief, 'gold-coin');
  expect(pets.equipCoin(victim, 'silver-coin')).not.toHaveProperty('error');
  expect(pets.equipCoin(thief, 'gold-coin')).not.toHaveProperty('error');
  const [theft] = pets.theftsFor(victim);
  const outcome = pets.revenge(victim, theft.id);
  if ('error' in outcome) throw new Error(outcome.error);
  // Silver forces the far weaker victim first; the thief's Gold never applies.
  expect(outcome.battle.turns[0].actor).toBe(0);
});

it('a studying pet cannot move, use stairs, open chests, or start over, but can view, finish a battle, and use items', () => {
  const id = 'busy-explorer';
  setupBattle(id, 'slime');
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
