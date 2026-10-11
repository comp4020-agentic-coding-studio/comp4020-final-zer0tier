import { expect, it } from 'vitest';
import { advanceEnemies, createWorld, directions, samePoint, walkable } from '../src/adventure-world.ts';

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
  }
  expect(world[0].up).toBeNull(); expect(world[4].down).toBeNull();
});

it('detects all eight neighbouring cells, advances one cardinal step, and never occupies the player', () => {
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    if (dx === 0 && dy === 0) continue;
    const floor = createWorld()[0]; floor.enemies = [floor.enemies[0]];
    const enemy = floor.enemies[0], before = { ...enemy }, player = { x: enemy.x + dx, y: enemy.y + dy };
    advanceEnemies(floor, player);
    expect(enemy.alerted).toBe(true);
    expect(samePoint(enemy, player)).toBe(false);
    expect(Math.abs(enemy.x - before.x) + Math.abs(enemy.y - before.y)).toBeLessThanOrEqual(1);
  }
});

it('keeps enemies outside detection range stationary and prevents walking through blockers or other enemies', () => {
  const floor = createWorld()[0];
  const before = structuredClone(floor.enemies);
  advanceEnemies(floor, { x: 2, y: 2 });
  expect(floor.enemies).toEqual(before);
  // A diagonal target behind a tree: one route is a wall and the other a chest.
  floor.enemies = [{ ...before[0], x: 5, y: 4 }];
  floor.chests = [{ id: 'blocker', x: 5, y: 5 }];
  advanceEnemies(floor, { x: 6, y: 5 });
  expect(floor.enemies[0]).toMatchObject({ x: 5, y: 4, alerted: true });
  // An occupied path and a stair cannot be used to approach the pet either.
  floor.chests = [];
  floor.enemies = [{ ...before[0], x: 3, y: 3 }, { ...before[1], x: 3, y: 2 }];
  floor.up = { x: 2, y: 3 };
  advanceEnemies(floor, { x: 2, y: 2 });
  expect(floor.enemies[0]).toMatchObject({ x: 3, y: 3 });
  expect(new Set(floor.enemies.map(e => `${e.x},${e.y}`)).size).toBe(2);
});
