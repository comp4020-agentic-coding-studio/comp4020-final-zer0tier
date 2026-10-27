import { db, worldDb } from './db.ts';
import { getPet, isValidId } from './pets.ts';

export interface WorldPosition {
  id: string;
  scene: 'home' | 'town';
  home: string | null;
  x: number;
  y: number;
  facing: 'up' | 'down' | 'left' | 'right';
  moving: boolean;
  revision: number;
}

db.exec(`CREATE TABLE IF NOT EXISTS world_positions (
  player_id TEXT PRIMARY KEY REFERENCES pets(id),
  scene TEXT NOT NULL,
  home TEXT,
  x REAL NOT NULL,
  y REAL NOT NULL,
  facing TEXT NOT NULL,
  moving INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0
)`);
// Positions go through worldDb, which doesn't wait for the disk (see db.ts).
const initial = worldDb.prepare("INSERT OR IGNORE INTO world_positions (player_id, scene, home, x, y, facing) VALUES (?, 'home', ?, 480, 475, 'down')");
const read = worldDb.prepare('SELECT player_id AS id, scene, home, x, y, facing, moving, revision FROM world_positions WHERE player_id = ?');
const write = worldDb.prepare('UPDATE world_positions SET scene = ?, home = ?, x = ?, y = ?, facing = ?, moving = ?, revision = revision + 1 WHERE player_id = ? AND revision = ?');
const stop = worldDb.prepare('UPDATE world_positions SET moving = 0, revision = revision + 1 WHERE player_id = ? AND moving != 0');
export function stopWorld(id: string): WorldPosition { stop.run(id); return worldPosition(id); }

export function worldPosition(id: string): WorldPosition {
  initial.run(id, id);
  const row = read.get(id) as unknown as WorldPosition;
  return { ...row, moving: Boolean(row.moving) };
}

export function moveWorld(id: string, input: unknown): WorldPosition | { status: number; error: string; player?: WorldPosition } {
  const body = input as Partial<WorldPosition> | null;
  if (!body || !['home', 'town'].includes(body.scene!) ||
    !['up', 'down', 'left', 'right'].includes(body.facing!) || typeof body.moving !== 'boolean' ||
    !Number.isFinite(body.x) || !Number.isFinite(body.y) || !Number.isSafeInteger(body.revision)) {
    return { status: 400, error: 'Invalid room or position.' };
  }
  const { scene, x, y, facing, moving, revision } = body as WorldPosition;
  const home = scene === 'home' ? body.home : null;
  if (scene === 'home' && (!isValidId(home) || !getPet(home))) return { status: 404, error: 'No such home.' };
  const bounds = scene === 'home' ? [76, 174, 884, 570] : [44, 30, 870, 614];
  if (x < bounds[0] || y < bounds[1] || x > bounds[2] || y > bounds[3]) return { status: 400, error: 'Stay inside the room.' };
  const before = worldPosition(id);
  if (before.revision !== revision) return { status: 409, error: 'Your position changed in another window.', player: before };
  write.run(scene, home ?? null, x, y, facing, moving ? 1 : 0, id, revision);
  return worldPosition(id);
}
