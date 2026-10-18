import { expect, it } from 'vitest';
import { createWorld, directions, patrol, samePoint, sees, SIGHT, walkable, type Floor } from '../src/adventure-world.ts';

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
    // Patrols are straight open lines, and none comes within sight of the stairs.
    for (const enemy of floor.enemies) {
      const [from, to] = enemy.route;
      expect(from.x === to.x || from.y === to.y).toBe(true);
      expect(samePoint(enemy, from)).toBe(true);
      for (let i = 0; i <= Math.abs(to.x - from.x) + Math.abs(to.y - from.y); i++) {
        const p = { x: from.x + Math.sign(to.x - from.x) * i, y: from.y + Math.sign(to.y - from.y) * i };
        expect(walkable(floor, p)).toBe(true);
        for (const stair of [floor.up, floor.down, { x: 2, y: 2 }]) if (stair) expect(sees(p, stair)).toBe(false);
      }
    }
  }
  expect(world[0].up).toBeNull(); expect(world[4].down).toBeNull();
});

// One monster alone on floor one, so other monsters don't get in the way.
function alone(at: { x: number; y: number }): Floor {
  const floor = createWorld()[0];
  floor.enemies = [{ ...floor.enemies[0], ...at }];
  return floor;
}

it('a monster sees the pet anywhere within 3 blocks, diagonals included, and walks toward it one block at a time', () => {
  expect(SIGHT).toBe(3);
  for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) {
    const floor = alone({ x: 10, y: 8 }), enemy = floor.enemies[0];
    const player = { x: 10 + dx, y: 8 + dy };
    if (samePoint(player, enemy)) continue;
    expect(sees(enemy, player)).toBe(true);
    const gap = Math.abs(dx) + Math.abs(dy);
    patrol(floor, player);
    expect(Math.abs(enemy.x - player.x) + Math.abs(enemy.y - player.y)).toBe(Math.max(1, gap - 1));
  }
});

it('walks up beside the pet, never onto it, and on its next step attacks it', () => {
  for (const player of [{ x: 7, y: 2 }, { x: 7, y: 3 }, { x: 8, y: 4 }]) {
    const floor = alone({ x: 6, y: 2 }), enemy = floor.enemies[0];
    const gap = () => Math.abs(enemy.x - player.x) + Math.abs(enemy.y - player.y);
    while (gap() > 1) expect(patrol(floor, player)).toEqual([]);
    const at = { x: enemy.x, y: enemy.y };
    // Beside it, the monster attacks the pet it caught, and stays where it is.
    expect(patrol(floor, player)).toEqual([{ enemy, pet: player }]);
    expect(enemy).toMatchObject(at);
  }
  // A diagonal neighbour isn't beside it yet: the monster steps in first.
  const floor = alone({ x: 6, y: 2 });
  expect(patrol(floor, { x: 7, y: 3 })).toEqual([]);
  expect(patrol(floor, { x: 7, y: 3 })).toHaveLength(1);
});

it('attacks whichever pet it chases, the nearest it sees, and only that one', () => {
  const floor = alone({ x: 6, y: 2 }), near = { x: 7, y: 2 }, far = { x: 6, y: 4 };
  expect(patrol(floor, [far, near])).toEqual([{ enemy: floor.enemies[0], pet: near }]);
});

it('patrols back and forth along its route while the pet is more than 3 blocks away', () => {
  const floor = createWorld()[0], player = { x: 14, y: 1 };
  const slime = floor.enemies[0];
  expect(slime.route).toEqual([{ x: 6, y: 2 }, { x: 9, y: 2 }]);
  const path = [];
  for (let i = 0; i < 7; i++) { patrol(floor, player); path.push(slime.x); }
  expect(path).toEqual([7, 8, 9, 8, 7, 6, 7]);
  expect(slime.y).toBe(2);
});

it('chases around trees by the shortest open path, then returns to its route once it loses the pet', () => {
  // A tree stands between them: floor one's wall runs down column 7 (index 6).
  const floor = alone({ x: 5, y: 5 }), enemy = floor.enemies[0];
  patrol(floor, { x: 7, y: 5 });
  expect([{ x: 5, y: 4 }, { x: 5, y: 6 }]).toContainEqual({ x: enemy.x, y: enemy.y });
  // Out of sight: it heads back toward the end of its route it was walking to.
  const before = Math.abs(enemy.x - 9) + Math.abs(enemy.y - 2);
  patrol(floor, { x: 13, y: 13 });
  expect(Math.abs(enemy.x - 9) + Math.abs(enemy.y - 2)).toBe(before - 1);
});

it('cannot walk through trees, chests, stairs, or other monsters, and waits when every way is blocked', () => {
  // A tree, a chest, the stairs, and another monster fill every way out.
  const floor = alone({ x: 2, y: 3 });
  floor.up = { x: 2, y: 4 };
  floor.chests = [{ id: 'blocker', x: 3, y: 3 }];
  floor.enemies.push({ ...floor.enemies[0], id: 'other', x: 2, y: 2 });
  floor.tiles = floor.tiles.map((row, y) => y === 3 ? '##' + row.slice(2) : row);
  patrol(floor, { x: 4, y: 4 });
  expect(floor.enemies[0]).toMatchObject({ x: 2, y: 3 });
  // Every monster still stands on an open tile of its own.
  const world = createWorld();
  for (const level of world) {
    for (let i = 0; i < 40; i++) patrol(level, { x: 2, y: 2 });
    expect(new Set(level.enemies.map(e => `${e.x},${e.y}`)).size).toBe(level.enemies.length);
    for (const e of level.enemies) {
      expect(walkable(level, e)).toBe(true);
      expect([...level.chests, level.up, level.down].some(p => p && samePoint(p, e))).toBe(false);
    }
  }
});
