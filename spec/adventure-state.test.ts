import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
const directory = mkdtempSync(join(tmpdir(), 'virtuepets-adventure-'));
let adventure: typeof import('../src/adventure.ts');
let db: typeof import('../src/db.ts').db;
beforeAll(async () => {
  const legacy = new DatabaseSync(join(directory, 'virtuepets.db'));
  legacy.exec('CREATE TABLE adventures (player_id TEXT PRIMARY KEY, x INTEGER NOT NULL, y INTEGER NOT NULL)');
  legacy.prepare('INSERT INTO adventures VALUES (?, ?, ?)').run('legacy', 5, 3);
  legacy.close();
  vi.stubEnv('DATA_DIR', directory);
  adventure = await import('../src/adventure.ts');
  ({ db } = await import('../src/db.ts'));
});
afterAll(() => { db.close(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });
it('migrates a legacy clearing without moving its pet or overlapping a new enemy', () => {
  const state = adventure.adventureFor('legacy');
  expect(state).toMatchObject({ x: 5, y: 3, floor: 1 });
  expect(state.enemies.some(e => e.x === 5 && e.y === 3)).toBe(false);
  expect(adventure.adventureFor('legacy')).toEqual(state);
});
it('preserves floor, player position, and enemy positions across a process restart', () => {
  for (const direction of ['a', 'a', 'a', 'a', ...Array(11).fill('s'), ...Array(12).fill('d'), 'w']) {
    expect(adventure.moveAdventure('legacy', direction)).not.toHaveProperty('error');
  }
  expect(adventure.changeFloor('legacy', 'descend')).toMatchObject({ floor: 2 });
  adventure.moveAdventure('legacy', 'd');
  adventure.moveAdventure('legacy', 'd');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e',
    "import { adventureFor } from './src/adventure.ts'; console.log(JSON.stringify(adventureFor('legacy')));"],
    { env: { ...process.env, DATA_DIR: directory }, encoding: 'utf8' });
  expect(JSON.parse(output)).toEqual(adventure.adventureFor('legacy'));
});
