import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('migrates existing characters to Amber and preserves saved outfits after restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'virtuepets-outfits-'));
  const restart = (source: string) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', source], {
    env: { ...process.env, DATA_DIR: directory }, encoding: 'utf8',
  }));
  try {
    const old = restart(`
      import { getOrCreatePet } from './src/pets.ts';
      import { worldPosition, moveWorld } from './src/world.ts';
      import { db, worldDb } from './src/db.ts';
      getOrCreatePet('existing');
      const saved = moveWorld('existing', { ...worldPosition('existing'), x: 620, facing: 'left' });
      db.exec('ALTER TABLE world_positions DROP COLUMN outfit');
      console.log(JSON.stringify(saved));
      worldDb.close(); db.close();
    `);
    const saved = restart(`
      import { worldPosition, setWorldOutfit } from './src/world.ts';
      const migrated = worldPosition('existing');
      console.log(JSON.stringify({ migrated, dressed: setWorldOutfit('existing', 'lavender') }));
    `);
    expect(saved.migrated).toEqual(old);
    expect(saved.dressed).toEqual({ ...old, outfit: 'lavender', revision: old.revision + 1 });
    expect(restart(`
      import { worldPosition } from './src/world.ts';
      console.log(JSON.stringify(worldPosition('existing')));
    `)).toEqual(saved.dressed);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
