import { db } from './db.ts';
import { advanceEnemies, createWorld, directions, FLOOR_COUNT, nearby, samePoint, SIZE, walkable, type Floor } from './adventure-world.ts';

type SavedAdventure = { x: number; y: number; floor: number; world_json: string | null };
function load(id: string) {
  db.prepare('INSERT OR IGNORE INTO adventures (player_id, x, y) VALUES (?, ?, ?)').run(id, 2, 2);
  const saved = db.prepare('SELECT x, y, floor, world_json FROM adventures WHERE player_id = ?').get(id) as SavedAdventure;
  const world: Floor[] = saved.world_json ? JSON.parse(saved.world_json) : createWorld();
  if (!saved.world_json) {
    // A legacy player may already occupy one of the new spawn cells. Keep
    // their position, placing that monster in the nearest free walkable cell.
    const floor = world[saved.floor - 1];
    for (const enemy of floor.enemies.filter(e => samePoint(e, saved))) {
      const free = floor.tiles.flatMap((row, y) => [...row].map((_, x) => ({ x, y })))
        .filter(p => walkable(floor, p) && !samePoint(p, saved)
          && !floor.enemies.some(e => samePoint(e, p)) && !floor.chests.some(c => samePoint(c, p))
          && ![floor.up, floor.down].some(s => s && samePoint(s, p)))
        .sort((a, b) => (Math.abs(a.x - saved.x) + Math.abs(a.y - saved.y)) - (Math.abs(b.x - saved.x) + Math.abs(b.y - saved.y)))[0];
      enemy.x = free.x; enemy.y = free.y;
    }
    db.prepare('UPDATE adventures SET world_json = ? WHERE player_id = ?').run(JSON.stringify(world), id);
  }
  return { x: saved.x, y: saved.y, floor: saved.floor, world };
}
export function adventureFor(id: string) {
  const saved = load(id);
  const floor = saved.world[saved.floor - 1];
  return {
    x: saved.x, y: saved.y, floor: saved.floor, floorCount: FLOOR_COUNT, size: SIZE,
    name: floor.name, tiles: floor.tiles, enemies: floor.enemies, chests: floor.chests,
    up: floor.up, down: floor.down,
    encounters: floor.enemies.filter(e => nearby(e, saved)).map(e => e.id),
  };
}
export function moveAdventure(id: string, direction: unknown) {
  if (typeof direction !== 'string' || !Object.hasOwn(directions, direction)) {
    return { error: 'Choose W, A, S, or D.', status: 400 };
  }
  const saved = load(id), floor = saved.world[saved.floor - 1];
  const [dx, dy] = directions[direction as keyof typeof directions];
  const player = { x: saved.x + dx, y: saved.y + dy };
  if (!walkable(floor, player)) return { error: 'A tree blocks that path.', status: 409 };
  if (floor.enemies.some(e => samePoint(e, player))) {
    return { error: 'A monster blocks that path. Go around it; battles are coming next.', status: 409 };
  }
  advanceEnemies(floor, player);
  db.prepare('UPDATE adventures SET x = ?, y = ?, world_json = ? WHERE player_id = ?')
    .run(player.x, player.y, JSON.stringify(saved.world), id);
  return adventureFor(id);
}
export function changeFloor(id: string, action: unknown) {
  if (action !== 'ascend' && action !== 'descend') return { error: 'Choose ascend or descend.', status: 400 };
  const saved = load(id), floor = saved.world[saved.floor - 1];
  const stair = action === 'descend' ? floor.down : floor.up;
  if (!stair || !samePoint(saved, stair)) return { error: 'Stand on the matching stairs first.', status: 409 };
  const destination = saved.floor + (action === 'descend' ? 1 : -1);
  const landing = action === 'descend' ? saved.world[destination - 1].up! : saved.world[destination - 1].down!;
  db.prepare('UPDATE adventures SET x = ?, y = ?, floor = ? WHERE player_id = ?').run(landing.x, landing.y, destination, id);
  return adventureFor(id);
}
