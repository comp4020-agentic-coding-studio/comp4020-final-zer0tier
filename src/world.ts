import { db, worldDb } from './db.ts';
import { getPet, isValidId } from './pets.ts';

export const OUTFITS = ['amber', 'forest', 'ocean', 'berry', 'lavender', 'rose', 'slate', 'cream'] as const;
// Quick reactions a player can show above their character to everyone in the
// same home or town. Keys 1–4 pick them in this order.
export const EMOTES = ['wave', 'heart', 'laugh', 'question'] as const;
export type Emote = typeof EMOTES[number];
// Real milliseconds between one player's emotes, so nobody can flood a room.
export const EMOTE_COOLDOWN_MS = 1500;

export interface WorldPosition {
  id: string;
  scene: 'home' | 'town';
  home: string | null;
  x: number;
  y: number;
  facing: 'up' | 'down' | 'left' | 'right';
  moving: boolean;
  outfit: typeof OUTFITS[number];
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
  outfit TEXT NOT NULL DEFAULT 'amber',
  revision INTEGER NOT NULL DEFAULT 0
)`);
if (!db.prepare("SELECT name FROM pragma_table_info('world_positions') WHERE name = ?").get('outfit')) {
  db.exec("ALTER TABLE world_positions ADD COLUMN outfit TEXT NOT NULL DEFAULT 'amber'");
}
// Each player's latest emote: what it was, where they stood, and when. Saved
// before it is broadcast, and it sets the cooldown for the next one.
db.exec(`CREATE TABLE IF NOT EXISTS world_emotes (
  player_id TEXT PRIMARY KEY REFERENCES pets(id),
  emote TEXT NOT NULL,
  scene TEXT NOT NULL,
  home TEXT,
  at INTEGER NOT NULL
)`);
// Positions go through worldDb, which doesn't wait for the disk (see db.ts).
const initial = worldDb.prepare("INSERT OR IGNORE INTO world_positions (player_id, scene, home, x, y, facing) VALUES (?, 'home', ?, 480, 475, 'down')");
const read = worldDb.prepare('SELECT player_id AS id, scene, home, x, y, facing, moving, outfit, revision FROM world_positions WHERE player_id = ?');
const write = worldDb.prepare('UPDATE world_positions SET scene = ?, home = ?, x = ?, y = ?, facing = ?, moving = ?, revision = revision + 1 WHERE player_id = ? AND revision = ?');
const stop = worldDb.prepare('UPDATE world_positions SET moving = 0, revision = revision + 1 WHERE player_id = ? AND moving != 0');
// Appearance is a durable preference, so use the fully synchronous connection.
const dress = db.prepare('UPDATE world_positions SET outfit = ?, revision = revision + 1 WHERE player_id = ?');
export function stopWorld(id: string): WorldPosition { stop.run(id); return worldPosition(id); }
const saveEmote = db.prepare(`INSERT INTO world_emotes (player_id, emote, scene, home, at) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (player_id) DO UPDATE SET emote = excluded.emote, scene = excluded.scene, home = excluded.home, at = excluded.at`);
const readEmote = db.prepare('SELECT player_id AS id, emote, scene, home, at FROM world_emotes WHERE player_id = ?');

export interface WorldEmote { id: string; emote: Emote; scene: WorldPosition['scene']; home: string | null; at: number }

// Shows an emote where the player currently stands, unless they sent one too recently.
export function emoteWorld(id: string, emote: unknown, now = Date.now()): WorldEmote | { status: number; error: string } {
  if (typeof emote !== 'string' || !EMOTES.includes(emote as Emote)) return { status: 400, error: 'Choose an available emote.' };
  if (!isValidId(id) || !getPet(id)) return { status: 404, error: 'No such pet.' };
  const last = readEmote.get(id) as WorldEmote | undefined;
  // Capped, so a wall clock that jumped backwards can't stretch the wait.
  if (last && now - last.at < EMOTE_COOLDOWN_MS && now >= last.at) return { status: 429, error: 'Give it a moment before the next emote.' };
  const { scene, home } = worldPosition(id);
  saveEmote.run(id, emote, scene, home, now);
  return readEmote.get(id) as unknown as WorldEmote;
}

export function worldPosition(id: string): WorldPosition {
  initial.run(id, id);
  const row = read.get(id) as unknown as WorldPosition;
  return { ...row, moving: Boolean(row.moving) };
}

export function setWorldOutfit(id: string, outfit: unknown): WorldPosition | { status: number; error: string } {
  if (typeof outfit !== 'string' || !OUTFITS.includes(outfit as WorldPosition['outfit'])) {
    return { status: 400, error: 'Choose an available outfit colour.' };
  }
  if (!isValidId(id) || !getPet(id)) return { status: 404, error: 'No such pet.' };
  worldPosition(id);
  dress.run(outfit, id);
  return worldPosition(id);
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
