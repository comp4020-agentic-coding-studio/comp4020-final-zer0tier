import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { JOBS, JOB_LEVEL_MINUTES, SKILLS, monsterSkills } from '../src/skills.ts';
import { rollTreasure } from '../src/treasure.ts';
import { createWorld } from '../src/adventure-world.ts';
import type { ActiveBattle } from '../src/combat.ts';
const directory = mkdtempSync(join(tmpdir(), 'virtuepets-skill-acquisition-'));
let pets: typeof import('../src/pets.ts');
let adventure: typeof import('../src/adventure.ts');
let db: typeof import('../src/db.ts').db;
beforeAll(async () => {
  vi.stubEnv('DATA_DIR', directory); vi.stubEnv('TIME_SCALE', '1');
  pets = await import('../src/pets.ts'); adventure = await import('../src/adventure.ts');
  ({ db } = await import('../src/db.ts'));
});
afterAll(() => { db.close(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });
function finishShift(id: string, job: typeof JOBS[number], minutes = 60) {
  db.prepare('UPDATE pets SET stamina = 100, hygiene = 100 WHERE id = ?').run(id);
  const result = pets.work(id, job.location, minutes, job.id);
  if ('error' in result) throw new Error(result.error);
  const deadline = result.pet.busyUntil!;
  expect(pets.settle(id, deadline)!.finished).toBe(true);
  return pets.getPet(id)!;
}
it.each(JOBS)('$name teaches exactly its job skills at the required completed levels', job => {
  const id = `job-${job.id}`; pets.getOrCreatePet(id);
  const skills = SKILLS.filter(s => s.source.channel === 'job' && s.source.job === job.id);
  const levels = [15, 60, 180, 360, 600];
  let completed = 0;
  for (const target of levels) {
    while (completed < target) {
      const duration = Math.min(60, target - completed);
      finishShift(id, job, duration); completed += duration;
    }
    const pet = pets.getPet(id)!;
    expect(pet.skillJobs[job.id]).toBe(target);
    const expected = skills.filter(s => s.source.channel === 'job' && target >= JOB_LEVEL_MINUTES[s.source.level - 1]).map(s => s.id);
    expect(pet.abilities.filter(a => a !== 'claw-strike')).toEqual(expected);
    expect(pets.settle(id, Date.now())!.finished).toBe(false);
    expect(pets.getPet(id)!.skillJobs[job.id]).toBe(target);
  }
});
it('does not award progress for starting, rejects a job at the wrong workplace, and supports Hourglass completion', () => {
  const id = 'job-atomic'; pets.getOrCreatePet(id);
  const before = pets.getPet(id);
  expect(pets.work(id, 'office', 60, 'mover')).toHaveProperty('error');
  expect(pets.getPet(id)).toEqual(before);
  expect(pets.work(id, 'office', 60, 'librarian')).not.toHaveProperty('error');
  expect(pets.getPet(id)!.abilities).toEqual(['claw-strike']);
  db.prepare('UPDATE pets SET hourglass = 1 WHERE id = ?').run(id);
  expect(pets.use(id, 'hourglass')).not.toHaveProperty('error');
  expect(pets.getPet(id)!).toMatchObject({ skillJobs: { librarian: 60 }, abilities: ['claw-strike', 'paperplane-dart'] });
});
it('all chest scrolls are reachable, floor-gated, and never include job or monster skills', () => {
  const seen = new Set<string>();
  for (let floor = 1; floor <= 5; floor++) {
    for (let pick = 0; pick < 100; pick++) {
      let rolls = 0;
      const reward = rollTreasure(() => rolls++ === 0 ? 0.7 : pick / 100, floor);
      const skill = SKILLS.find(s => s.id === reward.id)!;
      expect(skill.source.channel).toBe('chest');
      if (skill.source.channel === 'chest') expect(skill.source.floor).toBeLessThanOrEqual(floor);
      seen.add(reward.id);
    }
  }
  expect([...seen].sort()).toEqual(SKILLS.filter(s => s.source.channel === 'chest').map(s => s.id).sort());
});
it('every monster technique is reachable on the existing five floors', () => {
  const seen = new Set<string>();
  for (const floor of createWorld()) for (const enemy of floor.enemies) for (const skill of monsterSkills(enemy.kind, floor.number)) seen.add(skill.id);
  expect([...seen].sort()).toEqual(SKILLS.filter(s => s.source.channel === 'monster').map(s => s.id).sort());
});
function setupBoss(id: string, mp = 0) {
  pets.getOrCreatePet(id);
  db.prepare("UPDATE pets SET strength = 999, intelligence = 40, charisma = 40, equipped_coin = 'silver-coin' WHERE id = ?").run(id);
  adventure.adventureFor(id);
  db.prepare('UPDATE adventures SET floor = 5, x = 9, y = 11, world_json = ?, hp = 100, mp = ? WHERE player_id = ?').run(JSON.stringify(createWorld()), mp, id);
  const state = adventure.adventureFor(id);
  const result = adventure.moveAdventure(id, 'd', state.revision);
  if ('error' in result) throw new Error(result.error);
  return result;
}
it('a victory grants a saved monster skill once, retains basic MP recovery, and permits equipping it', () => {
  const id = 'boss-drop';
  const random = vi.spyOn(Math, 'random').mockReturnValue(0);
  try {
    const state = setupBoss(id), battle = state.battle!.playback as ActiveBattle;
    const result = adventure.adventureBattleSkill(id, state.battle!.id, battle.revision, 'claw-strike');
    if ('error' in result) throw new Error(result.error);
    expect(result.battle).toMatchObject({ won: true, skillDrop: { id: 'bloodlust-crash', learned: true } });
    expect(result.mp).toBe(4); // 1 from basic, 3 from victory recovery
    expect(pets.getPet(id)!.abilities).toContain('bloodlust-crash');
    expect(adventure.adventureBattleSkill(id, state.battle!.id, battle.revision, 'claw-strike')).toEqual(result);
    expect(db.prepare('SELECT quantity FROM inventory WHERE player_id = ? AND item_id = ?').get(id, 'bloodlust-crash')).toEqual({ quantity: 1 });
    adventure.continueAdventure(id, result.battle!.id, result.revision);
    expect(pets.equipSkills(id, ['claw-strike', 'bloodlust-crash'])).not.toHaveProperty('error');
    expect(pets.equipSkills(id, ['claw-strike', 'forbidden-grimoire'])).toHaveProperty('error');
  } finally { random.mockRestore(); }
});
it('losing or forfeiting an adventure cannot award a skill', () => {
  const id = 'no-drop'; const state = setupBoss(id), battle = state.battle!.playback as ActiveBattle;
  const result = adventure.forfeitAdventureBattle(id, state.battle!.id, battle.revision);
  expect(result).not.toHaveProperty('error');
  expect(pets.getPet(id)!.abilities).toEqual(['claw-strike']);
});
it('preserves healing during an unfinished adventure fight and never repeats it on a retry', () => {
  const id = 'healing-carry'; pets.getOrCreatePet(id);
  db.prepare('INSERT INTO inventory VALUES (?, ?, 1)').run(id, 'standing-ovation');
  expect(pets.equipSkills(id, ['claw-strike', 'standing-ovation'])).not.toHaveProperty('error');
  const state = setupBoss(id, 5), battle = state.battle!.playback as ActiveBattle;
  const result = adventure.adventureBattleSkill(id, state.battle!.id, battle.revision, 'standing-ovation');
  if ('error' in result) throw new Error(result.error);
  expect(result.hp).toBeGreaterThan(100);
  expect(result.hp).toBe((result.battle!.playback as ActiveBattle).hp[0]);
  expect(result.battle!.recovery).toEqual({ hp: 0, mp: 0 });
  expect(adventure.adventureBattleSkill(id, state.battle!.id, battle.revision, 'standing-ovation')).toEqual(result);
});
it('rolls back job pay, progress and learning together if the skill cannot be saved', () => {
  const id = 'job-rollback'; pets.getOrCreatePet(id);
  const pending = pets.work(id, 'construction', 15, 'mover');
  if ('error' in pending) throw new Error(pending.error);
  db.exec("CREATE TRIGGER reject_skill BEFORE INSERT ON inventory BEGIN SELECT RAISE(ABORT, 'skill disk failure'); END");
  try { expect(() => pets.settle(id, pending.pet.busyUntil!)).toThrow('skill disk failure'); }
  finally { db.exec('DROP TRIGGER reject_skill'); }
  expect(pets.getPet(id)).toEqual(pending.pet);
  const finished = pets.settle(id, pending.pet.busyUntil!)!;
  expect(finished.pet).toMatchObject({ skillJobs: { mover: 15 }, abilities: ['claw-strike', 'heavy-breath-slam'] });
});
