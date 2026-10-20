// Pure map and movement rules, shared by persistence and focused rule tests.
import { randomInt } from 'node:crypto';
import type { MonsterAbilityId } from './combat.ts';
import type { TreasureReward } from './treasure.ts';
export const SIZE = 16;
export const FLOOR_COUNT = 5;
export type Point = { x: number; y: number };
export type Enemy = Point & {
  id: string;
  kind: 'slime' | 'goblin' | 'slime-king';
  name: string;
  strength: number;
  intelligence: number;
  charisma: number;
  // Kept in saved maps for compatibility; ordinary monsters now hide in grass.
  route: [Point, Point];
  leg: 0 | 1;
};
export type Floor = {
  number: number;
  name: string;
  tiles: string[];
  // Separate from collision tiles so old maps keep their paths and landmarks.
  grass?: string[];
  encounter?: { seed: number; steps: number };
  enemies: Enemy[];
  // `openedBy` names the teammate who opened a chest on a team's shared map.
  chests: (Point & { id: string; reward?: TreasureReward; openedBy?: string })[];
  up: Point | null;
  down: Point | null;
  // Legacy patrol timestamp; no longer advances monsters.
  patrolledAt?: number;
};
// What each kind knows besides the free Claw Strike. Looked up by kind rather
// than saved on each enemy, so maps saved before a move existed get it too.
export const MONSTER_MOVES: Record<Enemy['kind'], readonly MonsterAbilityId[]> = { slime: [], goblin: [], 'slime-king': ['bump'] };
export const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;
export const nearby = (a: Point, b: Point): boolean => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1;
export const directions = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0] } as const;
export const walkable = (floor: Floor, point: Point): boolean => floor.tiles[point.y]?.[point.x] === '.';

export function createWorld(): Floor[] {
  const names = ['Woodland clearing', 'Goblin thicket', 'Mossy hollows', 'Deepwood paths', 'Slime King’s grove'];
  return names.map((name, index) => {
    const number = index + 1;
    const up = number > 1 ? { x: 2, y: 2 } : null;
    const down = number < FLOOR_COUNT ? { x: 13, y: 13 } : null;
    const chests = [{ id: `f${number}-chest`, x: 11, y: 3 }];
    // Stable IDs preserve the finite roster and old saved battles. Ordinary
    // coordinates are legacy data; only the boss occupies a visible map tile.
    const routes = [[[6, 2], [9, 2]], [[10, 5], [13, 5]], [[4, 11], [4, 8]], [[9, 12], [6, 12]]];
    const enemies: Enemy[] = routes.map(([[x, y], [postX, postY]], i) => {
      const goblin = i % 2 === 1;
      return {
        id: `f${number}-enemy-${i}`, x, y, kind: goblin ? 'goblin' : 'slime',
        name: goblin ? 'Goblin' : 'Slime', strength: (goblin ? 5 : 3) + index * 2,
        intelligence: (goblin ? 3 : 1) + index, charisma: 2 + index,
        route: [{ x, y }, { x: postX, y: postY }], leg: 1,
      };
    });
    if (number === FLOOR_COUNT) enemies.push({
      id: 'slime-king', kind: 'slime-king', name: 'Slime King', x: 10, y: 11,
      strength: 18, intelligence: 10, charisma: 12, route: [{ x: 10, y: 11 }, { x: 12, y: 11 }], leg: 1,
    });
    const tiles = Array.from({ length: SIZE }, (_, y) => Array.from({ length: SIZE }, (_, x) => {
      if (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1) return '#';
      if ([{ x: 2, y: 2 }, { x: 13, y: 13 }, ...chests, ...enemies].some(p => samePoint(p, { x, y }))) return '.';
      const wall = number === 1 ? x === 6 && y >= 4 && y <= 10 && y !== 7
        : number === 2 ? x === 8 && y >= 3 && y <= 11 && y !== 6
        : number === 3 ? y === 7 && x >= 4 && x <= 11 && x !== 8
        : number === 4 ? (x === 6 && y >= 4 && y <= 10 && y !== 5 && y !== 9) || (y === 9 && x >= 8 && x <= 11 && x !== 10)
        : x === 7 && y >= 4 && y <= 11 && y !== 6 && y !== 9;
      return wall ? '#' : '.';
    }).join(''));
    const floor: Floor = { number, name, tiles, enemies, chests, up, down };
    prepareGrass(floor);
    return floor;
  });
}

// Grass grows away from the outer walking route, entrances, chests, and the
// boss clearing. Deriving it from existing collision tiles preserves old runs.
export function grassFor(floor: Floor): string[] {
  const safe = [{ x: 2, y: 2 }, ...floor.chests, ...[floor.up, floor.down].filter(p => p !== null),
    ...floor.enemies.filter(enemy => enemy.kind === 'slime-king')];
  return floor.tiles.map((row, y) => [...row].map((_, x) => {
    const point = { x, y };
    const patch = (x >= 5 && x <= 8 && y >= 2 && y <= 5)
      || (x >= 10 && x <= 13 && y >= 5 && y <= 8)
      || (x >= 3 && x <= 5 && y >= 9 && y <= 12)
      || (x >= 7 && x <= 10 && y >= 11 && y <= 13);
    return patch && walkable(floor, point) && !safe.some(p => nearby(p, point)) ? 'g' : '.';
  }).join(''));
}

// A seed and the number of grass steps are part of the saved floor, including
// shared team floors. Reading or refreshing a map never rerolls an encounter.
export function prepareGrass(floor: Floor): boolean {
  let changed = false;
  if (!floor.grass) { floor.grass = grassFor(floor); changed = true; }
  if (!floor.encounter) { floor.encounter = { seed: randomInt(1, 0x100000000), steps: 0 }; changed = true; }
  return changed;
}

export const inGrass = (floor: Floor, point: Point): boolean => walkable(floor, point) && floor.grass?.[point.y]?.[point.x] === 'g';
function nextSeed(seed: number): number {
  let next = seed || 1;
  next ^= next << 13; next ^= next >>> 17; next ^= next << 5;
  return next >>> 0;
}

// Call only after an accepted movement. There are two quiet grass steps after
// each encounter, then a seeded chance, with an encounter guaranteed by six.
// The finite roster prevents defeated monsters returning on later visits.
export function grassEncounter(floor: Floor, point: Point): Enemy | undefined {
  const hidden = floor.enemies.filter(enemy => enemy.kind !== 'slime-king');
  if (!inGrass(floor, point) || !hidden.length) return;
  const encounter = floor.encounter!;
  encounter.steps++;
  if (encounter.steps < 3) return;
  encounter.seed = nextSeed(encounter.seed);
  if (encounter.steps < 6 && encounter.seed / 0x100000000 >= 0.35) return;
  encounter.seed = nextSeed(encounter.seed);
  encounter.steps = 0;
  return hidden[Math.floor(encounter.seed / 0x100000000 * hidden.length)];
}
