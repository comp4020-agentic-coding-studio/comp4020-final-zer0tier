// Pure map and movement rules, shared by persistence and focused rule tests.
import { randomInt } from 'node:crypto';
import { MONSTER_BUILDS, type MonsterBuildId } from './monsters.ts';
import type { TreasureReward } from './treasure.ts';
export const SIZE = 16;
export const FLOOR_COUNT = 5;
export const FLOOR_KEY_DROP_RATE = 0.05;
export type Point = { x: number; y: number };
export type Enemy = Point & {
  id: string;
  kind: 'slime' | 'goblin' | 'slime-king';
  name: string;
  strength: number;
  intelligence: number;
  charisma: number;
  build?: MonsterBuildId;
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
  // The key belongs to this floor and is shared by everyone on the run.
  exit?: { keyFound: boolean; unlocked: boolean };
  spawnWave?: number;
  enemies: Enemy[];
  // `openedBy` names the teammate who opened a chest on a team's shared map.
  chests: (Point & { id: string; reward?: TreasureReward; openedBy?: string })[];
  up: Point | null;
  down: Point | null;
  // Legacy patrol timestamp; no longer advances monsters.
  patrolledAt?: number;
};
export { MONSTER_MOVES } from './monsters.ts';
export const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;
export const nearby = (a: Point, b: Point): boolean => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1;
export const directions = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0] } as const;
export const walkable = (floor: Floor, point: Point): boolean => floor.tiles[point.y]?.[point.x] === '.';

function ordinaryEnemies(number: number, wave = 0): Enemy[] {
  const index = number - 1;
  const routes = [[[6, 2], [9, 2]], [[10, 5], [13, 5]], [[4, 11], [4, 8]], [[9, 12], [6, 12]]];
  const builds = ['woodland-slime', 'goblin-bruiser', 'mind-slime', 'glimmer-goblin'] as const;
  return routes.map(([[x, y], [postX, postY]], i) => {
    const build = builds[i], profile = MONSTER_BUILDS[build];
    const [strength, intelligence, charisma] = profile.stats.map((stat, i) => stat + index * profile.growth[i]);
    return {
      id: wave ? `f${number}-wave-${wave}-enemy-${i}` : `f${number}-enemy-${i}`,
      x, y, build, kind: profile.kind, name: profile.name,
      strength, intelligence, charisma, route: [{ x, y }, { x: postX, y: postY }], leg: 1,
    };
  });
}

export function createWorld(): Floor[] {
  const names = ['Woodland clearing', 'Goblin thicket', 'Mossy hollows', 'Deepwood paths', 'Slime King’s grove'];
  return names.map((name, index) => {
    const number = index + 1;
    const up = number > 1 ? { x: 2, y: 2 } : null;
    const down = number < FLOOR_COUNT ? { x: 13, y: 13 } : null;
    const chests = [{ id: `f${number}-chest`, x: 11, y: 3 }];
    // Stable IDs preserve old saved battles. Ordinary
    // coordinates are legacy data; only the boss occupies a visible map tile.
    const enemies = ordinaryEnemies(number);
    if (number === FLOOR_COUNT) enemies.push({
      id: 'slime-king', kind: 'slime-king', build: 'slime-king', name: 'Slime King', x: 10, y: 11,
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
    const floor: Floor = { number, name, tiles, enemies, chests, up, down,
      ...(down ? { exit: { keyFound: false, unlocked: false } } : {}),
    };
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

// Old runs had freely accessible stairs. Keep those routes open instead of
// imposing a new lock on progress whose visited floors were never recorded.
export function prepareExit(floor: Floor): boolean {
  if (!floor.down || floor.exit) return false;
  floor.exit = { keyFound: false, unlocked: true };
  return true;
}

export const inGrass = (floor: Floor, point: Point): boolean => walkable(floor, point) && floor.grass?.[point.y]?.[point.x] === 'g';
function nextSeed(seed: number): number {
  let next = seed || 1;
  next ^= next << 13; next ^= next >>> 17; next ^= next << 5;
  return next >>> 0;
}

// Call only after an accepted movement. There are two quiet grass steps after
// each encounter, then a seeded chance, with an encounter guaranteed by six.
// Until the key drops, fresh monsters replace an exhausted ordinary roster.
// Refill only while walking in grass, never on a read or a safe path.
export function grassEncounter(floor: Floor, point: Point, reserved: readonly string[] = []): Enemy | undefined {
  if (!inGrass(floor, point)) return;
  let hidden = floor.enemies.filter(enemy => enemy.kind !== 'slime-king');
  if (!hidden.length && floor.down && floor.exit && !floor.exit.keyFound && !floor.exit.unlocked) {
    floor.spawnWave = (floor.spawnWave ?? 0) + 1;
    hidden = ordinaryEnemies(floor.number, floor.spawnWave);
    floor.enemies.push(...hidden);
  }
  hidden = hidden.filter(enemy => !reserved.includes(enemy.id));
  if (!hidden.length) return;
  const encounter = floor.encounter!;
  encounter.steps++;
  if (encounter.steps < 3) return;
  encounter.seed = nextSeed(encounter.seed);
  if (encounter.steps < 6 && encounter.seed / 0x100000000 >= 0.35) return;
  encounter.seed = nextSeed(encounter.seed);
  encounter.steps = 0;
  return hidden[Math.floor(encounter.seed / 0x100000000 * hidden.length)];
}
