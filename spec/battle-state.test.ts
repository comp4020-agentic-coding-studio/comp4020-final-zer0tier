import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
const directory=mkdtempSync(join(tmpdir(),'virtuepets-battle-'));
let pets: typeof import('../src/pets.ts');
let db: typeof import('../src/db.ts').db;
beforeAll(async()=>{vi.stubEnv('DATA_DIR',directory);pets=await import('../src/pets.ts');({db}=await import('../src/db.ts'));});
afterAll(()=>{db.close();vi.unstubAllEnvs();rmSync(directory,{recursive:true,force:true});});
it('keeps a saved battle and its result across a server restart',()=>{
  pets.getOrCreatePet('attacker');pets.getOrCreatePet('defender');
  let result: any=pets.fight('attacker','defender');
  const pending = execFileSync(process.execPath,['--input-type=module','-e',"import { battleSessionsFor } from './src/pets.ts'; console.log(JSON.stringify(battleSessionsFor('attacker')));"],{env:{...process.env,DATA_DIR:directory},encoding:'utf8'});
  expect(JSON.parse(pending)).toEqual([result.session]);
  expect(result.session.battle.turns).toEqual([]);
  expect(pets.recentFights('attacker',10)).toEqual([]);
  while (result.session.battle.status === 'active') {
    const {session} = result, battle = session.battle;
    result = pets.actInBattle(battle.fighters[battle.actor].id, session.id, 'turn', 'claw-strike', battle.revision);
  }
  expect(result).toHaveProperty('fight');
  if('error' in result) throw new Error(result.error);
  const output=execFileSync(process.execPath,['--input-type=module','-e',"import { recentFights } from './src/pets.ts'; console.log(JSON.stringify(recentFights('attacker',10)));"],{env:{...process.env,DATA_DIR:directory},encoding:'utf8'});
  expect(JSON.parse(output)[0]).toEqual(result.fight);
  db.prepare('UPDATE fights SET battle_json = NULL WHERE id = ?').run(result.fight.id);
  expect(pets.recentFights('attacker',10)[0].battle).toBeNull();
});

it('saves a learned skill loadout separately from inventory and snapshots it for battle',()=>{
  pets.getOrCreatePet('learner'); pets.getOrCreatePet('practice');
  db.prepare('INSERT INTO inventory (player_id, item_id, quantity) VALUES (?, ?, ?)').run('learner','firebolt',1);
  expect(pets.getPet('learner')!.equippedAbilities).toEqual(['claw-strike']);
  expect(pets.equipSkills('learner',['claw-strike','firebolt'])).toHaveProperty('pet');
  expect(pets.getPet('learner')!.abilities).toEqual(['claw-strike','firebolt']);
  const started = pets.fight('learner','practice');
  if ('error' in started) throw new Error(started.error);
  expect(started.session.battle.fighters[0].abilities).toEqual(['claw-strike','firebolt']);
  expect(pets.equipSkills('learner',['claw-strike'])).toMatchObject({status:409});
  const ended = pets.actInBattle('learner',started.session.id,'forfeit',undefined,started.session.battle.revision);
  if ('error' in ended) throw new Error(ended.error);
  expect(pets.equipSkills('learner',['claw-strike'])).toHaveProperty('pet');
  expect(pets.battleSessionFor('learner',started.session.id)!.battle.fighters[0].abilities).toEqual(['claw-strike','firebolt']);
});

it('uses the stronger defender’s coin and settles an opening bot knockout only once',()=>{
  pets.getOrCreatePet('challenger'); pets.getOrCreatePet('defending');
  db.prepare('UPDATE pets SET strength = ? WHERE id = ?').run(20,'defending');
  db.prepare('INSERT INTO inventory (player_id, item_id, quantity) VALUES (?, ?, ?)').run('defending','silver-coin',1);
  expect(pets.equipCoin('defending','silver-coin')).toHaveProperty('pet');
  const started = pets.fight('challenger','defending');
  if ('error' in started) throw new Error(started.error);
  expect(started.session.battle).toMatchObject({coinProvider:1,actor:1,initiative:{providerId:'defending',coin:'silver-coin'}});
  pets.actInBattle('challenger',started.session.id,'forfeit',undefined,started.session.battle.revision);
  pets.getOrCreatePet('bot-target'); pets.getOrCreatePet('0');
  db.prepare('UPDATE pets SET strength = ?, equipped_coin = ? WHERE id = ?').run(100,'silver-coin','0');
  const opening = pets.fight('bot-target','0');
  if ('error' in opening) throw new Error(opening.error);
  expect(opening.session.battle).toMatchObject({status:'finished',winner:'0'});
  expect(opening.fight).toMatchObject({winner:'0'});
  expect(pets.getPet('bot-target')!.losses).toBe(1);
  expect(pets.battleSessionsFor('bot-target')).toEqual([]);
});

// Plays a live Arena battle to its end with each fighter's chosen skill.
function playOut(started: any, skills: Record<string, string>) {
  let result = started;
  while (result.session.battle.status === 'active') {
    const { session } = result, battle = session.battle, actor = battle.fighters[battle.actor].id;
    const skill = battle.attacks[battle.actor].some((move: any) => move.id === skills[actor] && move.mpCost <= battle.mp[battle.actor])
      ? skills[actor] : 'claw-strike';
    result = pets.actInBattle(actor, session.id, 'turn', skill, battle.revision);
    if ('error' in result) throw new Error(result.error);
  }
  return result;
}

it('a win over another player trains the attribute behind the final blow, once, and a loss trains nothing', () => {
  pets.getOrCreatePet('scholar'); pets.getOrCreatePet('sparring');
  db.prepare('UPDATE pets SET strength = ?, intelligence = ?, charisma = ? WHERE id = ?').run(6, 40, 6, 'scholar');
  db.prepare('INSERT INTO inventory (player_id, item_id, quantity) VALUES (?, ?, ?)').run('scholar', 'firebolt', 1);
  expect(pets.equipSkills('scholar', ['claw-strike', 'firebolt'])).toHaveProperty('pet');
  const before = { scholar: pets.getPet('scholar')!, sparring: pets.getPet('sparring')! };
  const started = pets.fight('scholar', 'sparring');
  if ('error' in started) throw new Error(started.error);
  const ended = playOut(started, { scholar: 'firebolt' });
  expect(ended.fight.winner).toBe('scholar');
  // Firebolt landed the final blow, so the win trains Intelligence.
  expect(ended.session.battle.turns.findLast((turn: any) => turn.actor === 0).ability).toBe('firebolt');
  expect(ended.session.result.trained).toEqual({ pet: 'scholar', attribute: 'intelligence', amount: 1 });
  expect(pets.getPet('scholar')).toMatchObject({
    strength: before.scholar.strength, intelligence: before.scholar.intelligence + 1, charisma: before.scholar.charisma,
  });
  expect(pets.getPet('sparring')).toMatchObject({
    strength: before.sparring.strength, intelligence: before.sparring.intelligence, charisma: before.sparring.charisma,
  });
  // Retrying the finished battle returns its saved result without training again.
  const retried = pets.actInBattle('scholar', ended.session.id, 'turn', 'claw-strike', ended.session.battle.revision);
  expect(retried).toMatchObject({ trained: { pet: 'scholar', attribute: 'intelligence', amount: 1 } });
  expect(pets.getPet('scholar')!.intelligence).toBe(before.scholar.intelligence + 1);
});

it('practice against the bot and forfeits train nothing', () => {
  pets.getOrCreatePet('trainee'); pets.getOrCreatePet('0');
  db.prepare('UPDATE pets SET strength = ?, intelligence = ?, charisma = ?, equipped_coin = NULL WHERE id = ?').run(1, 1, 1, '0');
  db.prepare('UPDATE pets SET strength = ? WHERE id = ?').run(60, 'trainee');
  const before = pets.getPet('trainee')!;
  const practice = pets.fight('trainee', '0');
  if ('error' in practice) throw new Error(practice.error);
  const won = playOut(practice, {});
  expect(won.fight.winner).toBe('trainee');
  expect(won.session.result).not.toHaveProperty('trained');
  expect(pets.getPet('trainee')).toMatchObject({ strength: 60, intelligence: before.intelligence, charisma: before.charisma });
  pets.getOrCreatePet('quitter'); pets.getOrCreatePet('stayer');
  const stayer = pets.getPet('stayer')!;
  const started = pets.fight('quitter', 'stayer');
  if ('error' in started) throw new Error(started.error);
  const quit = pets.actInBattle('quitter', started.session.id, 'forfeit', undefined, started.session.battle.revision);
  if ('error' in quit) throw new Error(quit.error);
  // A forfeit hands the win over without a final blow to train from.
  expect(quit.session.result!.fight!.winner).toBe('stayer');
  expect(pets.getPet('stayer')).toMatchObject({ strength: stayer.strength, intelligence: stayer.intelligence, charisma: stayer.charisma });
});
