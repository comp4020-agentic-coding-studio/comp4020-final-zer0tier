import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

// Saved history is trimmed as new history lands, in its own scratch database.
const directory = mkdtempSync(join(tmpdir(), 'virtuepets-history-'));
let pets: typeof import('../src/pets.ts');
let db: typeof import('../src/db.ts').db;
beforeAll(async () => {
  vi.stubEnv('DATA_DIR', directory);
  pets = await import('../src/pets.ts');
  ({ db } = await import('../src/db.ts'));
});
afterAll(() => { db.close(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });

const seedFight = (attacker: string, defender: string) => db.prepare(
  `INSERT INTO fights (attacker, defender, winner, attacker_power, defender_power, attacker_roll, defender_roll, spoils, battle_json, fought_at)
   VALUES (?, ?, ?, 10, 10, 10, 10, 0, '{}', '2026-01-01T00:00:00.000Z')`).run(attacker, defender, attacker).lastInsertRowid as number;
const fightIds = (pet: string) => (db.prepare('SELECT id FROM fights WHERE attacker = ? OR defender = ? ORDER BY id')
  .all(pet, pet) as { id: number }[]).map(row => row.id);
// Plays a started battle to the end with Claw Strike, so its result is saved.
function finish(result: any) {
  if ('error' in result) throw new Error(result.error);
  while (result.session.battle.status === 'active') {
    const { session } = result, battle = session.battle;
    result = pets.actInBattle(battle.fighters[battle.actor].id, session.id, 'turn', 'claw-strike', battle.revision);
    if ('error' in result) throw new Error(result.error);
  }
  return result;
}

it('keeps each pet’s newest 50 fights, and never a fight the other fighter still needs', () => {
  const { fights: kept } = pets.HISTORY_KEPT;
  for (const id of ['veteran', 'rookie', 'sparring']) pets.getOrCreatePet(id);
  // The rookie's only fight is the veteran's oldest; it must survive for the rookie.
  const rookieFight = seedFight('veteran', 'rookie');
  const oldest = Array.from({ length: kept + 5 }, () => seedFight('veteran', 'sparring'));
  const record = () => pets.getPet('veteran')!.wins + pets.getPet('veteran')!.losses;
  const before = record();
  const ended = finish(pets.fight('veteran', 'rookie'));
  expect(ended.fight).toBeDefined();
  const veteran = fightIds('veteran');
  // 50 fights against the sparring partner were kept for the sparring partner,
  // so nothing they share went; the rookie's old fight stays for the rookie.
  expect(veteran).toContain(rookieFight);
  expect(veteran).toContain(ended.fight.id);
  expect(fightIds('rookie')).toEqual([rookieFight, ended.fight.id]);
  // The sparring partner keeps exactly its newest 50; its older ones are gone.
  expect(fightIds('sparring')).toEqual(oldest.slice(-kept));
  // The journal and the win record are unaffected.
  expect(pets.recentFights('veteran', 10)[0].id).toBe(ended.fight.id);
  // Wins and losses are totals on the pet: one more fight, nothing taken away.
  expect(record()).toBe(before + 1);
});

it('keeps unresolved thefts for revenge and each victim’s newest 20 resolved ones', () => {
  const { resolvedThefts: kept } = pets.HISTORY_KEPT;
  pets.getOrCreatePet('victim'); pets.getOrCreatePet('thief');
  const seed = (result: string | null) => db.prepare('INSERT INTO thefts (thief, victim, amount, result) VALUES (?, ?, 10, ?)')
    .run('thief', 'victim', result).lastInsertRowid as number;
  const unresolved = [seed(null), seed(null)];
  const resolved = Array.from({ length: kept + 3 }, () => seed('lost'));
  const target = seed(null);
  // Revenge for the newest theft resolves it, then trims.
  db.prepare('UPDATE pets SET money = 1000 WHERE id = ?').run('thief');
  finish(pets.revenge('victim', target));
  const left = (db.prepare('SELECT id, result FROM thefts WHERE victim = ? ORDER BY id').all('victim') as { id: number; result: string | null }[]);
  expect(left.filter(row => row.result === null).map(row => row.id)).toEqual(unresolved);
  expect(left.filter(row => row.result !== null).map(row => row.id)).toEqual([...resolved.slice(-(kept - 1)), target]);
  expect(pets.theftsFor('victim').map(theft => theft.id)).toEqual([...unresolved].reverse());
});

it('keeps live battles and each player’s newest 20 finished ones, including the one just finished', () => {
  const { finishedBattles: kept } = pets.HISTORY_KEPT;
  for (const id of ['duelist', 'opponent', 'bystander', 'player-one', 'player-two']) pets.getOrCreatePet(id);
  const seed = (status: string, a = 'duelist', b = 'bystander') => {
    db.prepare(`INSERT INTO manual_battles (id, kind, player_a, player_b, status, state_json, meta_json) VALUES (?, 'arena', ?, ?, ?, '{}', '{}')`)
      .run(`seed-${status}-${Math.random()}`, a, b, status);
  };
  for (let i = 0; i < kept + 4; i++) seed('finished');
  const ended = finish(pets.fight('duelist', 'opponent'));
  const finished = db.prepare("SELECT id FROM manual_battles WHERE status = 'finished' AND (player_a = ? OR player_b = ?)").all('duelist', 'duelist') as { id: string }[];
  expect(finished).toHaveLength(kept);
  expect(finished.map(row => row.id)).toContain(ended.session.id);
  // The just-finished battle can still be read back for its result.
  expect(pets.battleSessionFor('duelist', ended.session.id)?.result?.fight).toBeDefined();
  // A battle still being played is never trimmed, however much history
  // its players have. (The game allows one live battle per pet.)
  seed('active', 'player-one', 'player-two');
  for (let i = 0; i < kept + 2; i++) seed('finished', 'player-one', 'bystander');
  finish(pets.fight('bystander', 'opponent'));
  finish(pets.fight('opponent', 'duelist'));
  expect(db.prepare("SELECT COUNT(*) AS n FROM manual_battles WHERE status = 'active' AND player_a = 'player-one'").get()).toEqual({ n: 1 });
  expect(db.prepare("SELECT COUNT(*) AS n FROM manual_battles WHERE status = 'finished' AND (player_a = 'bystander' OR player_b = 'bystander')").get()).toEqual({ n: kept });
});
