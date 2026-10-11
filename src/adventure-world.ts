// Pure map and movement rules, shared by persistence and focused rule tests.
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
  alerted: boolean;
};
export type Floor = {
  number: number;
  name: string;
  tiles: string[];
  enemies: Enemy[];
  chests: (Point & { id: string })[];
  up: Point | null;
  down: Point | null;
};
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
    const enemies: Enemy[] = [[5, 3], [10, 5], [4, 11], [11, 10]].map(([x, y], i) => {
      const goblin = i % 2 === 1;
      return {
        id: `f${number}-enemy-${i}`, x, y, kind: goblin ? 'goblin' : 'slime',
        name: goblin ? 'Goblin' : 'Slime', strength: (goblin ? 5 : 3) + index * 2,
        intelligence: (goblin ? 3 : 1) + index, charisma: 2 + index, alerted: false,
      };
    });
    if (number === FLOOR_COUNT) enemies.push({
      id: 'slime-king', kind: 'slime-king', name: 'Slime King', x: 10, y: 11,
      strength: 18, intelligence: 10, charisma: 12, alerted: false,
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

// One cardinal step per successful pet step. Only the surrounding eight cells
// trigger detection; trees, stairs, chests, and other occupants block pursuit.
export function advanceEnemies(floor: Floor, player: Point): void {
  for (const enemy of floor.enemies) {
    enemy.alerted = nearby(enemy, player);
    if (!enemy.alerted) continue;
    const distance = (p: Point) => Math.abs(p.x - player.x) + Math.abs(p.y - player.y);
    const choices = Object.values(directions).map(([dx, dy]) => ({ x: enemy.x + dx, y: enemy.y + dy }))
      .filter(p => walkable(floor, p) && !samePoint(p, player)
        && !floor.enemies.some(other => other !== enemy && samePoint(other, p))
        && !floor.chests.some(chest => samePoint(chest, p))
        && ![floor.up, floor.down].some(stair => stair && samePoint(stair, p)))
      .sort((a, b) => distance(a) - distance(b));
    const next = choices.find(p => distance(p) < distance(enemy));
    if (next) { enemy.x = next.x; enemy.y = next.y; }
  }
}
