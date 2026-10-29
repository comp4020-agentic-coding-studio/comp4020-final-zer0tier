import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

const directory = mkdtempSync(join(tmpdir(), 'virtuepets-loadouts-'));
let pets: typeof import('../src/pets.ts');
let database: typeof import('../src/db.ts');
const restart = (source: string) => execFileSync(process.execPath, ['--input-type=module', '-e', source], {
  env: { ...process.env, DATA_DIR: directory }, encoding: 'utf8',
});

beforeAll(async () => {
  // Recreate the preceding schema with a pet that already learned and equipped a skill.
  restart(`
    import { getOrCreatePet, equipSkills } from './src/pets.ts';
    import { db, worldDb } from './src/db.ts';
    getOrCreatePet('existing');
    db.prepare('INSERT INTO inventory (player_id, item_id, quantity) VALUES (?, ?, ?)').run('existing', 'firebolt', 1);
    equipSkills('existing', ['claw-strike', 'firebolt']);
    db.exec('ALTER TABLE pets DROP COLUMN skill_loadouts');
    worldDb.close(); db.close();
  `);
  vi.stubEnv('DATA_DIR', directory);
  pets = await import('../src/pets.ts');
  database = await import('../src/db.ts');
});
afterAll(() => {
  database.worldDb.close(); database.db.close();
  vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true });
});

it('migrates existing pets without changing learned or equipped skills', () => {
  expect(pets.getPet('existing')).toMatchObject({
    skillLoadouts: {}, abilities: ['claw-strike', 'firebolt'], equippedAbilities: ['claw-strike', 'firebolt'],
  });
  expect(pets.getOrCreatePet('new').pet.skillLoadouts).toEqual({});
});

it('keeps three independent setups through edits, other pet actions, and restart', () => {
  pets.getOrCreatePet('collector');
  for (const skill of ['firebolt', 'heavy-strike', 'hardhat-guard', 'silver-coin']) {
    database.db.prepare('INSERT INTO inventory (player_id, item_id, quantity) VALUES (?, ?, ?)').run('collector', skill, 1);
  }
  pets.equipCoin('collector', 'silver-coin');
  const before = pets.getPet('collector')!;
  const setups = {
    adventure: ['claw-strike', 'firebolt'],
    arena: ['claw-strike', 'heavy-strike'],
    support: ['claw-strike', 'hardhat-guard'],
  };
  for (const [slot, abilities] of Object.entries(setups)) {
    expect(pets.saveSkillLoadout('collector', slot, abilities)).toHaveProperty('pet');
  }
  // Saving a setup never equips it or spends inventory, coins, money, HP, or care.
  expect(pets.getPet('collector')).toEqual({ ...before, skillLoadouts: setups });
  expect(pets.equipSkillLoadout('collector', 'support')).toHaveProperty('pet');
  expect(pets.getPet('collector')).toMatchObject({ equippedAbilities: setups.support, skillLoadouts: setups });
  pets.equipSkills('collector', ['claw-strike', 'firebolt', 'heavy-strike', 'hardhat-guard']);
  expect(pets.getPet('collector')!.skillLoadouts).toEqual(setups);
  setups.adventure = ['claw-strike'];
  pets.saveSkillLoadout('collector', 'adventure', setups.adventure);
  pets.setAppearance('collector', '#123456', 'cat');
  pets.equipSkillLoadout('collector', 'arena');
  const saved = pets.getPet('collector')!;
  expect(saved).toMatchObject({ skillLoadouts: setups, equippedAbilities: setups.arena, equippedCoin: 'silver-coin' });
  const reopened = JSON.parse(restart("import { getPet } from './src/pets.ts'; console.log(JSON.stringify(getPet('collector')));"));
  expect(reopened).toEqual(saved);
  expect(pets.getPet('existing')!.skillLoadouts).toEqual({});
});

it('rejects invalid setups without changing saved skills and revalidates skills before equipping', () => {
  pets.getOrCreatePet('validation');
  const before = pets.getPet('validation');
  for (const abilities of [undefined, null, 'claw-strike', {}, [], ['firebolt'], ['claw-strike', 'claw-strike'],
    ['claw-strike', 'firebolt'], ['claw-strike', 'bump'], ['claw-strike', 'unknown'], ['claw-strike', 3],
    ['claw-strike', 'firebolt', 'heavy-strike', 'hardhat-guard', 'coffee-break']]) {
    expect(pets.saveSkillLoadout('validation', 'adventure', abilities)).toMatchObject({ status: 409 });
    expect(pets.getPet('validation')).toEqual(before);
  }
  for (const slot of ['unknown', '__proto__', 'constructor', null, {}, 1]) {
    expect(pets.saveSkillLoadout('validation', slot, ['claw-strike'])).toMatchObject({ status: 409 });
    expect(pets.equipSkillLoadout('validation', slot)).toMatchObject({ status: 409 });
  }
  expect(pets.equipSkillLoadout('validation', 'support')).toMatchObject({ status: 409 });
  database.db.prepare('UPDATE pets SET skill_loadouts = ? WHERE id = ?')
    .run(JSON.stringify({ adventure: ['claw-strike', 'firebolt'] }), 'validation');
  expect(pets.equipSkillLoadout('validation', 'adventure')).toMatchObject({ status: 409 });
  expect(pets.getPet('validation')!.equippedAbilities).toEqual(['claw-strike']);
});

it('locks saved setups during battle and leaves completed battle snapshots unchanged', () => {
  pets.getOrCreatePet('fighter'); pets.getOrCreatePet('opponent');
  database.db.prepare('INSERT INTO inventory (player_id, item_id, quantity) VALUES (?, ?, ?)').run('fighter', 'firebolt', 1);
  pets.saveSkillLoadout('fighter', 'arena', ['claw-strike', 'firebolt']);
  pets.saveSkillLoadout('fighter', 'adventure', ['claw-strike']);
  pets.equipSkillLoadout('fighter', 'arena');
  const started = pets.fight('fighter', 'opponent');
  if ('error' in started) throw new Error(started.error);
  expect(started.session.battle.fighters[0].abilities).toEqual(['claw-strike', 'firebolt']);
  const before = pets.getPet('fighter');
  expect(pets.saveSkillLoadout('fighter', 'arena', ['claw-strike'])).toMatchObject({ status: 409 });
  expect(pets.equipSkillLoadout('fighter', 'adventure')).toMatchObject({ status: 409 });
  expect(pets.getPet('fighter')).toEqual(before);
  pets.actInBattle('fighter', started.session.id, 'forfeit', undefined, started.session.battle.revision);
  expect(pets.equipSkillLoadout('fighter', 'adventure')).toHaveProperty('pet');
  expect(pets.getPet('fighter')!.equippedAbilities).toEqual(['claw-strike']);
  expect(pets.battleSessionFor('fighter', started.session.id)!.battle.fighters[0].abilities).toEqual(['claw-strike', 'firebolt']);
});
