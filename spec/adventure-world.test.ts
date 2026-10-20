import { expect, it } from 'vitest';
import { createWorld, directions, grassEncounter, grassFor, inGrass, nearby, prepareExit, prepareGrass, walkable } from '../src/adventure-world.ts';

it('builds five connected 16 × 16 floors with reachable chests, stairs, stronger enemies, and a final boss', () => {
  const world = createWorld();
  expect(world).toHaveLength(5);
  expect(new Set(world.map(f => f.tiles.join(''))).size).toBe(5);
  for (const [index, floor] of world.entries()) {
    expect(floor.tiles).toHaveLength(16);
    expect(floor.tiles.every(row => row.length === 16)).toBe(true);
    const queue = [{ x: 2, y: 2 }], seen = new Set(['2,2']);
    for (let i = 0; i < queue.length; i++) {
      for (const [dx, dy] of Object.values(directions)) {
        const p = { x: queue[i].x + dx, y: queue[i].y + dy }, key = `${p.x},${p.y}`;
        if (walkable(floor, p) && !seen.has(key)) { seen.add(key); queue.push(p); }
      }
    }
    expect(floor.chests.length).toBeGreaterThanOrEqual(1);
    expect(floor.enemies.length).toBeGreaterThanOrEqual(4);
    expect(floor.enemies.map(e => e.kind)).toEqual(expect.arrayContaining(['slime', 'goblin']));
    const objects = [...floor.enemies, ...floor.chests, ...[floor.up, floor.down].filter(p => p !== null)];
    expect(new Set(objects.map(p => `${p.x},${p.y}`)).size).toBe(objects.length);
    for (const p of objects) expect(seen.has(`${p.x},${p.y}`)).toBe(true);
    if (index > 0) for (let i = 0; i < 4; i++) {
      for (const stat of ['strength', 'intelligence', 'charisma'] as const) {
        expect(floor.enemies[i][stat]).toBeGreaterThan(world[index - 1].enemies[i][stat]);
      }
    }
    expect(floor.enemies.some(e => e.kind === 'slime-king')).toBe(index === 4);
    expect(floor.exit).toEqual(index === 4 ? undefined : { keyFound: false, unlocked: false });
    expect(floor.grass).toHaveLength(16);
    expect(floor.grass!.some(row => row.includes('g'))).toBe(true);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (!inGrass(floor, { x, y })) continue;
      expect(seen.has(`${x},${y}`)).toBe(true);
      expect(x > 1 && x < 14 && y > 1 && y < 14).toBe(true);
      for (const safe of [...floor.chests, { x: 2, y: 2 }, floor.up, floor.down]) {
        if (safe) expect(nearby(safe, { x, y })).toBe(false);
      }
    }
  }
  expect(world[0].up).toBeNull(); expect(world[4].down).toBeNull();
});

it('derives grass for legacy maps without changing paths, rewards, or the surviving roster', () => {
  const floor = createWorld()[0];
  floor.enemies.shift();
  const before = structuredClone(floor);
  delete floor.grass; delete floor.encounter;
  expect(prepareGrass(floor)).toBe(true);
  expect(floor.grass).toEqual(grassFor(before));
  expect(floor.tiles).toEqual(before.tiles);
  expect(floor.enemies).toEqual(before.enemies);
  expect(floor.chests).toEqual(before.chests);
  expect(prepareGrass(floor)).toBe(false);
});

it('only accepted grass steps advance seeded encounters, with two quiet steps and a maximum of six', () => {
  const floor = createWorld()[0], grass = { x: 6, y: 2 };
  expect(inGrass(floor, grass)).toBe(true);
  for (const seed of [1, 12345, 987654321, 0xffffffff]) {
    floor.encounter = { seed, steps: 0 };
    for (const point of [{ x: 1, y: 1 }, { x: 11, y: 3 }, { x: 6, y: 4 }]) {
      expect(grassEncounter(floor, point)).toBeUndefined();
      expect(floor.encounter).toEqual({ seed, steps: 0 });
    }
    expect(grassEncounter(floor, grass)).toBeUndefined();
    expect(grassEncounter(floor, grass)).toBeUndefined();
    let found;
    for (let steps = 3; steps <= 6 && !found; steps++) found = grassEncounter(floor, grass);
    expect(found?.kind).not.toBe('slime-king');
    expect(found).toBeDefined();
    expect(floor.encounter.steps).toBe(0);
  }
});

it('replays the same saved seed, selects varied hidden monsters, and never restores a defeated monster', () => {
  const floor = createWorld()[4], original = structuredClone(floor), found = new Set();
  for (let i = 0; i < 80; i++) {
    const first = grassEncounter(floor, { x: 6, y: 2 });
    const replayed = grassEncounter(original, { x: 6, y: 2 });
    expect(replayed?.id).toBe(first?.id);
    expect(original.encounter).toEqual(floor.encounter);
    if (first) found.add(first.id);
  }
  expect(found.size).toBeGreaterThan(1);
  floor.enemies = floor.enemies.filter(enemy => enemy.kind === 'slime-king');
  const cleared = structuredClone(floor);
  for (let i = 0; i < 20; i++) expect(grassEncounter(floor, { x: 6, y: 2 })).toBeUndefined();
  expect(floor).toEqual(cleared);
});

it('replenishes exhausted locked floors only on grass steps with fresh identities and unchanged difficulty', () => {
  const floor = createWorld()[2], original = structuredClone(floor.enemies);
  floor.enemies = [];
  const emptied = structuredClone(floor);
  expect(grassEncounter(floor, { x: 1, y: 1 })).toBeUndefined();
  expect(floor).toEqual(emptied);
  expect(grassEncounter(floor, { x: 6, y: 2 })).toBeUndefined();
  expect(floor.spawnWave).toBe(1);
  expect(floor.enemies).toHaveLength(4);
  for (const [index, enemy] of floor.enemies.entries()) {
    expect(enemy.id).toBe(`f3-wave-1-enemy-${index}`);
    expect({ ...enemy, id: original[index].id }).toEqual(original[index]);
  }
  floor.enemies = []; floor.encounter!.steps = 0;
  grassEncounter(floor, { x: 6, y: 2 });
  expect(floor.spawnWave).toBe(2);
  expect(floor.enemies.every(enemy => enemy.id.startsWith('f3-wave-2-'))).toBe(true);
  for (const exit of [{ keyFound: true, unlocked: false }, { keyFound: false, unlocked: true }]) {
    floor.exit = exit; floor.enemies = [];
    const stopped = structuredClone(floor);
    for (let i = 0; i < 8; i++) expect(grassEncounter(floor, { x: 6, y: 2 })).toBeUndefined();
    expect(floor).toEqual(stopped);
  }
});

it('grandfathers old stairs once without altering a new or already saved gate', () => {
  const world = createWorld();
  expect(prepareExit(world[0])).toBe(false);
  delete world[1].exit;
  expect(prepareExit(world[1])).toBe(true);
  expect(world[1].exit).toEqual({ keyFound: false, unlocked: true });
  expect(prepareExit(world[1])).toBe(false);
  expect(prepareExit(world[4])).toBe(false);
  expect(world[4].exit).toBeUndefined();
});
