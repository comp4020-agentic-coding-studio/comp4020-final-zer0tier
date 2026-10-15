// Pure map and movement rules, shared by persistence and focused rule tests.
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
  // A patrol walks back and forth between the two ends; `leg` is the end it's heading for.
  route: [Point, Point];
  leg: 0 | 1;
};
export type Floor = {
  number: number;
  name: string;
  tiles: string[];
  enemies: Enemy[];
  chests: (Point & { id: string; reward?: TreasureReward })[];
  up: Point | null;
  down: Point | null;
};
// What each kind knows besides the free Claw Strike. Looked up by kind rather
// than saved on each enemy, so maps saved before a move existed get it too.
export const MONSTER_MOVES: Record<Enemy['kind'], readonly MonsterAbilityId[]> = { slime: [], goblin: [], 'slime-king': ['bump'] };
export const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;
export const nearby = (a: Point, b: Point): boolean => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1;
// A monster sees the pet up to SIGHT blocks away in every direction, diagonals
// included (a 7 × 7 square), whatever trees stand between them.
export const SIGHT = 3;
export const sees = (enemy: Point, player: Point): boolean => Math.max(Math.abs(enemy.x - player.x), Math.abs(enemy.y - player.y)) <= SIGHT;
export const directions = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0] } as const;
export const walkable = (floor: Floor, point: Point): boolean => floor.tiles[point.y]?.[point.x] === '.';

export function createWorld(): Floor[] {
  const names = ['Woodland clearing', 'Goblin thicket', 'Mossy hollows', 'Deepwood paths', 'Slime King’s grove'];
  return names.map((name, index) => {
    const number = index + 1;
    const up = number > 1 ? { x: 2, y: 2 } : null;
    const down = number < FLOOR_COUNT ? { x: 13, y: 13 } : null;
    const chests = [{ id: `f${number}-chest`, x: 11, y: 3 }];
    // Each monster paces between its spawn and a post. No route comes within
    // sight of the stairs, so arriving on a floor never starts a chase.
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
    return { number, name, tiles, enemies, chests, up, down };
  });
}

// Moves `mover` one cardinal step along a shortest open path to `goal`. The
// goal itself may be taken (by the pet): the mover then stops beside it.
function stepToward(mover: Point, goal: Point, open: (p: Point) => boolean): void {
  const key = (p: Point) => `${p.x},${p.y}`;
  const cameFrom = new Map([[key(mover), mover]]), queue = [mover];
  for (let i = 0; i < queue.length; i++) {
    for (const [dx, dy] of Object.values(directions)) {
      const p = { x: queue[i].x + dx, y: queue[i].y + dy };
      if (cameFrom.has(key(p)) || !(samePoint(p, goal) || open(p))) continue;
      cameFrom.set(key(p), queue[i]);
      if (!samePoint(p, goal)) { queue.push(p); continue; }
      let step = p;
      while (cameFrom.get(key(step)) !== mover) step = cameFrom.get(key(step))!;
      if (open(step)) { mover.x = step.x; mover.y = step.y; }
      return;
    }
  }
}

// One real-time step for every monster on the floor. One that sees the pet
// walks toward it and stops beside it (it never starts a battle); the rest walk
// their routes, heading back to them after a chase. Trees, chests, stairs, the
// pet, and other monsters block the way.
export function patrol(floor: Floor, player: Point): void {
  const open = (p: Point) => walkable(floor, p) && !samePoint(p, player)
    && !floor.enemies.some(e => samePoint(e, p)) && !floor.chests.some(chest => samePoint(chest, p))
    && ![floor.up, floor.down].some(stair => stair && samePoint(stair, p));
  for (const enemy of floor.enemies) {
    if (sees(enemy, player)) { stepToward(enemy, player, open); continue; }
    if (samePoint(enemy, enemy.route[enemy.leg])) enemy.leg = enemy.leg === 0 ? 1 : 0;
    stepToward(enemy, enemy.route[enemy.leg], open);
  }
}
