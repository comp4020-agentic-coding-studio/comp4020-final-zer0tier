import { db } from './db.ts';

export const SIZE = 16;
// A fixed clearing for the exploration foundation. Later maps build on this grid.
export const tiles = Array.from({ length: SIZE }, (_, y) =>
  Array.from({ length: SIZE }, (_, x) =>
    x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ||
    (x === 6 && y >= 4 && y <= 10 && y !== 7) ? '#' : '.').join(''));
const directions = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0] } as const;
export function adventureFor(id: string) {
  db.prepare('INSERT OR IGNORE INTO adventures (player_id, x, y) VALUES (?, ?, ?)').run(id, 2, 2);
  const position = db.prepare('SELECT x, y FROM adventures WHERE player_id = ?').get(id) as { x: number; y: number };
  return { ...position, size: SIZE, tiles };
}
export function moveAdventure(id: string, direction: unknown) {
  if (typeof direction !== 'string' || !Object.hasOwn(directions, direction)) {
    return { error: 'Choose W, A, S, or D.', status: 400 };
  }
  const state = adventureFor(id);
  const [dx, dy] = directions[direction as keyof typeof directions];
  const x = state.x + dx, y = state.y + dy;
  if (tiles[y]?.[x] !== '.') return { error: 'A tree blocks that path.', status: 409 };
  db.prepare('UPDATE adventures SET x = ?, y = ? WHERE player_id = ?').run(x, y, id);
  return adventureFor(id);
}
