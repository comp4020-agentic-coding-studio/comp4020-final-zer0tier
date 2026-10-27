import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { type Floor } from '../src/adventure-world.ts';
import { type ActiveBattle } from '../src/combat.ts';

// The Team up window's rules and a team's shared run, in-process against a
// scratch database so tests can place pets and monsters exactly.
const directory = mkdtempSync(join(tmpdir(), 'virtuepets-team-'));
let adventure: typeof import('../src/adventure.ts');
let teams: typeof import('../src/teams.ts');
let db: typeof import('../src/db.ts').db;
let pets: typeof import('../src/pets.ts');
beforeAll(async () => {
  vi.stubEnv('DATA_DIR', directory);
  adventure = await import('../src/adventure.ts');
  teams = await import('../src/teams.ts');
  ({ db } = await import('../src/db.ts'));
  pets = await import('../src/pets.ts');
});
afterAll(() => { db.close(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });

// A signed-up player's pet (only players with accounts can be invited).
function player(id: string, stats?: [number, number, number]) {
  pets.getOrCreatePet(id);
  db.prepare('INSERT OR IGNORE INTO accounts (id, password_hash) VALUES (?, ?)').run(id, 'x');
  if (stats) db.prepare('UPDATE pets SET strength = ?, intelligence = ?, charisma = ? WHERE id = ?').run(...stats, id);
  return id;
}
function ok<T extends object>(outcome: T): Exclude<T, { error: string }> {
  if ('error' in outcome) throw new Error(String(outcome.error));
  return outcome as Exclude<T, { error: string }>;
}
// Forms a team led by the first pet, every other pet joining, and sets off.
function team(...ids: string[]) {
  const [leader, ...rest] = ids;
  for (const id of rest) {
    const { team } = ok(teams.invite(leader, id));
    ok(teams.accept(id, team.id));
  }
  return ok(teams.setOff(leader)).team;
}
// Places a pet on the shared map without going through a move.
const place = (id: string, x: number, y: number, floor = 1) =>
  db.prepare('UPDATE adventures SET x = ?, y = ?, floor = ? WHERE player_id = ?').run(x, y, floor, id);
function step(id: string, direction: string) {
  ok(adventure.moveAdventure(id, direction, adventure.adventureFor(id).revision));
  return finishBattle(id);
}

// Test callers choose every pet's move; production never chooses for a player.
function finishBattle(id: string) {
  let state = adventure.adventureFor(id);
  for (let turn = 0; turn < 500; turn++) {
    const battle = state.battle?.playback as ActiveBattle | null;
    if (!battle || battle.status !== 'active') return state;
    const actor = battle.actor!;
    const skill = battle.attacks[actor].filter(move => move.mpCost <= battle.mp[actor]).sort((a, b) => b.damage - a.damage || a.mpCost - b.mpCost)[0];
    ok(adventure.adventureBattleSkill(battle.fighters[actor].id, state.battle!.id, battle.revision, skill.id));
    state = adventure.adventureFor(id);
  }
  throw new Error('Battle did not finish in 500 chosen turns.');
}

// Arrange a deterministic grass encounter without changing its combat luck.
function readyEncounter(id: number, enemyId: string) {
  const saved = db.prepare('SELECT world_json FROM teams WHERE id = ?').get(id) as { world_json: string };
  const world = JSON.parse(saved.world_json) as Floor[], floor = world[0];
  floor.enemies.sort((a, b) => Number(b.id === enemyId) - Number(a.id === enemyId));
  floor.encounter = { seed: 1, steps: 5 };
  db.prepare('UPDATE teams SET world_json = ? WHERE id = ?').run(JSON.stringify(world), id);
  return floor.enemies[0];
}

it('forms a team: only the leader invites, at most 4 pets, and invitations go to real players only', () => {
  const [lead, b, c, d, e] = ['lead', 'b-pet', 'c-pet', 'd-pet', 'e-pet'].map(id => player(id));
  pets.getOrCreatePet('no-account');
  expect(teams.teamFor(lead)).toMatchObject({ team: null, invitations: [], size: 4, run: { team: null, state: 'new' } });
  expect(teams.invite(lead, lead)).toMatchObject({ status: 400 });
  expect(teams.invite(lead, 'nobody')).toMatchObject({ status: 404 });
  expect(teams.invite(lead, 'no-account')).toMatchObject({ status: 404 });
  const { team } = ok(teams.invite(lead, b));
  expect(team).toMatchObject({ leader: lead, status: 'forming', members: [{ id: lead, joined: true, waiting: null }, { id: b, joined: false }] });
  expect(teams.invite(lead, b)).toEqual({ status: 409, error: 'b-pet is already invited.' });
  expect(teams.teamFor(b)).toMatchObject({ team: null, invitations: [{ id: team.id, leader: lead }] });
  ok(teams.accept(b, team.id));
  expect(teams.invite(b, c)).toEqual({ status: 409, error: 'Only the team leader can invite players.' });
  ok(teams.invite(lead, c)); ok(teams.invite(lead, d));
  expect(teams.invite(lead, e)).toEqual({ status: 409, error: 'A team holds at most 4 pets, invitations included.' });
  // An invited pet joins one team at a time.
  const other = player('other-lead');
  const { team: second } = ok(teams.invite(other, c));
  ok(teams.accept(c, team.id));
  expect(teams.accept(c, second.id)).toEqual({ status: 409, error: 'Leave your current team before joining another.' });
  expect(teams.accept(e, team.id)).toMatchObject({ status: 404 });
  // Declining an invitation, and a member leaving, free their places.
  expect(ok(teams.leave(d, team.id)).team.members.map(m => m.id)).toEqual([lead, b, c]);
  expect(ok(teams.leave(c, team.id)).team.members.map(m => m.id)).toEqual([lead, b]);
  expect(teams.leave(c, team.id)).toMatchObject({ status: 404 });
  // The leader leaving disbands it: nobody is left on it.
  const disbanded = ok(teams.leave(lead, team.id)).team;
  expect(disbanded).toMatchObject({ status: 'disbanded', members: [] });
  expect(teams.teamFor(b)).toMatchObject({ team: null, invitations: [] });
  expect(teams.accept(b, team.id)).toMatchObject({ status: 404 });
});

it('sets off only once everyone joined is ready; each pays a fresh start and shares one map', () => {
  const [lead, mate, late] = ['so-lead', 'so-mate', 'so-late'].map(id => player(id));
  expect(teams.setOff(lead)).toEqual({ status: 409, error: 'Invite a teammate first.' });
  const { team } = ok(teams.invite(lead, mate));
  ok(teams.invite(lead, late));
  expect(teams.setOff(lead)).toEqual({ status: 409, error: 'Wait for at least one invited player to join.' });
  ok(teams.accept(mate, team.id));
  expect(teams.setOff(mate)).toEqual({ status: 409, error: 'Only the team leader can set off.' });
  // A teammate with a run under way must abandon it first; a tired one must rest.
  step(mate, 's');
  expect(teams.teamFor(lead).team!.members[1]).toMatchObject({ id: mate, waiting: 'has an adventure in progress; end it first' });
  expect(teams.setOff(lead)).toEqual({ status: 409, error: 'so-mate has an adventure in progress; end it first.' });
  ok(adventure.abandonAdventure(mate, adventure.adventureFor(mate).revision));
  db.prepare('UPDATE pets SET stamina = 39 WHERE id = ?').run(mate);
  expect(teams.setOff(lead)).toEqual({ status: 409, error: 'so-mate is too tired; it needs 40 stamina.' });
  db.prepare('UPDATE pets SET stamina = 100 WHERE id = ?').run(mate);
  expect(teams.teamFor(lead).team!.members[1]).toMatchObject({ waiting: null });
  const set = ok(teams.setOff(lead)).team;
  // Pending invitations lapse; the members are the pets on the map.
  expect(set).toMatchObject({ status: 'exploring', members: [{ id: lead }, { id: mate }] });
  expect(teams.teamFor(late)).toMatchObject({ invitations: [] });
  for (const id of [lead, mate]) {
    expect(pets.getPet(id)).toMatchObject({ stamina: 60, hygiene: 80 });
    expect(adventure.adventureFor(id)).toMatchObject({ floor: 1, x: 2, y: 2, started: true, failed: false, team: { id: team.id } });
    expect(adventure.adventureFor(id).cooldownUntil).toBeGreaterThan(Date.now());
    expect(teams.teamFor(id)).toMatchObject({ team: null, run: { team: team.id, state: 'exploring' } });
  }
  // One map: a move by one shows on the other's, and both see each other.
  const moved = step(mate, 'd');
  expect(moved.team!.members).toEqual([expect.objectContaining({ id: lead, floor: 1, x: 2, y: 2, status: 'exploring' })]);
  expect(adventure.adventureFor(lead).team!.members).toEqual([expect.objectContaining({ id: mate, x: 3, y: 2, hp: 25, maxHp: 25 })]);
  // Free again to form another team, once this run is over.
  expect(ok(teams.invite(mate, late)).team.leader).toBe(mate);
});

it('teammates beside the pet, diagonals included, join its battle; one further away does not', () => {
  const [lead, near, far] = [player('fb-lead', [6, 2, 2]), player('fb-near', [6, 2, 2]), player('fb-far', [6, 2, 2])];
  const { id } = team(lead, near, far);
  const slime = readyEncounter(id, 'f1-enemy-0');
  place(lead, slime.x - 1, slime.y); place(near, slime.x - 1, slime.y + 1); place(far, slime.x - 4, slime.y);
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  let result;
  try { result = step(lead, 'd'); } finally { random.mockRestore(); }
  const battle = result.battle!;
  expect(battle.playback!.fighters.map(f => f.id)).toEqual([lead, near, `monster:${slime.id}`]);
  expect(battle).toMatchObject({ won: true, pending: true });
  expect(battle.fighter).toBeUndefined();
  // The ally's run saves the same battle, from its own side.
  const ally = adventure.adventureFor(near);
  expect(ally.battle).toMatchObject({ id: battle.id, fighter: 1, won: true, pending: true });
  expect(ally.battle!.playback).toEqual(battle.playback);
  expect(adventure.adventureFor(far).battle).toBeNull();
  // The monster is gone from the shared map for everyone; the bumping pet takes its tile.
  for (const pet of [lead, near, far]) expect(adventure.adventureFor(pet).enemies.some(e => e.id === slime.id)).toBe(false);
  expect(result).toMatchObject({ x: slime.x, y: slime.y });
  // Both acknowledge it separately; the far teammate kept exploring meanwhile.
  expect(step(far, 's')).toMatchObject({ y: slime.y + 1 });
  ok(adventure.continueAdventure(near, battle.id, ally.revision));
  expect(adventure.adventureFor(near).battle!.pending).toBe(false);
  expect(adventure.adventureFor(lead).battle!.pending).toBe(true);
  expect(id).toBeGreaterThan(0);
});

it('rolls one shared Floor Key per team victory, saves it in each replay, and lets any teammate unlock the gate', () => {
  const [lead, near, far] = ['key-lead', 'key-near', 'key-far'].map(id => player(id, [100, 100, 100]));
  const { id } = team(lead, near, far);
  const slime = readyEncounter(id, 'f1-enemy-0');
  place(lead, slime.x - 1, slime.y); place(near, slime.x - 1, slime.y + 1); place(far, 13, 13);
  const before = adventure.adventureFor(lead), remoteBefore = adventure.adventureFor(far);
  const random = vi.spyOn(Math, 'random').mockReturnValue(0);
  try {
    const fought = step(lead, 'd');
    expect(fought.battle!.keyDrop).toEqual({ floor: 1, name: 'Floor Key' });
    expect(adventure.adventureFor(near).battle!.keyDrop).toEqual(fought.battle!.keyDrop);
    expect(adventure.adventureFor(far).battle).toBeNull();
    for (const member of [lead, near, far]) {
      expect(adventure.adventureFor(member).exit).toEqual({ keyFound: true, unlocked: false, dropRate: 0.05 });
    }
    // The coin, three fighter luck rolls, one drop, and the attribute roll for
    // the only pet that struck (the lead's Normal Claw Strike won at once).
    const rollsAfterFight = random.mock.calls.length;
    expect(rollsAfterFight).toBeGreaterThanOrEqual(6);
    expect(adventure.moveAdventure(lead, 'd', before.revision)).toEqual(fought);
    // Shared map updates do not invalidate a distant teammate's own movement revision.
    expect(ok(adventure.changeFloor(far, 'descend', remoteBefore.revision))).toMatchObject({
      floor: 2, exit: { keyFound: false, unlocked: false },
    });
    expect(adventure.adventureFor(lead).exit).toEqual({ keyFound: false, unlocked: true, dropRate: 0.05 });
    ok(adventure.continueAdventure(lead, fought.battle!.id, fought.revision));
    const ally = adventure.adventureFor(near);
    ok(adventure.continueAdventure(near, ally.battle!.id, ally.revision));
    expect(adventure.adventureFor(lead).exit!.unlocked).toBe(true);
    expect(adventure.adventureFor(near).battle!.keyDrop).toEqual(fought.battle!.keyDrop);
    // The near teammate never struck, so it trains nothing, and replays roll nothing more.
    expect(adventure.adventureFor(near).battle).not.toHaveProperty('trained');
    expect(random).toHaveBeenCalledTimes(rollsAfterFight);
    place(lead, 13, 13);
    expect(ok(adventure.changeFloor(lead, 'descend', adventure.adventureFor(lead).revision))).toMatchObject({ floor: 2 });
  } finally { random.mockRestore(); }
});

it('preserves legacy shared routes and defeated monsters while migrating missing floor gates once', () => {
  const [lead, mate] = ['old-key-lead', 'old-key-mate'].map(id => player(id));
  const { id } = team(lead, mate);
  const row = db.prepare('SELECT world_json FROM teams WHERE id = ?').get(id) as { world_json: string };
  const world = JSON.parse(row.world_json) as Floor[];
  for (const floor of world) delete floor.exit;
  world[0].enemies = [];
  db.prepare('UPDATE teams SET world_json = ? WHERE id = ?').run(JSON.stringify(world), id);
  const first = adventure.adventureFor(lead);
  expect(first.exit).toEqual({ keyFound: false, unlocked: true, dropRate: 0.05 });
  expect(first.enemies).toEqual([]);
  const migrated = db.prepare('SELECT world_json FROM teams WHERE id = ?').get(id);
  expect(adventure.adventureFor(mate).exit).toEqual(first.exit);
  expect(adventure.patrolAdventure(lead)).toEqual(first);
  expect(db.prepare('SELECT world_json FROM teams WHERE id = ?').get(id)).toEqual(migrated);
  place(mate, 5, 2);
  expect(step(mate, 'd').enemies).toEqual([]);
});

it('a knocked-out teammate is out of the run while the rest explore on, and recovery skips it', () => {
  const [lead, weak] = [player('ko-lead', [30, 7, 12]), player('ko-weak', [2, 1, 1])];
  const { id } = team(lead, weak);
  const goblin = readyEncounter(id, 'f1-enemy-1');
  place(lead, goblin.x - 1, goblin.y); place(weak, goblin.x - 1, goblin.y + 1);
  // On tails the goblin strikes first, at whichever pet has more HP: the weak
  // one (4 HP, to the lead's 3) falls, then the lead finishes the goblin.
  db.prepare('UPDATE adventures SET hp = ? WHERE player_id = ?').run(3, lead);
  db.prepare('UPDATE adventures SET hp = 4 WHERE player_id = ?').run(weak);
  const stats = { lead: pets.getPet(lead)!, weak: pets.getPet(weak)! };
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  let result;
  try { result = step(lead, 'd'); } finally { random.mockRestore(); }
  expect(result.battle!.playback!.turns.map(t => [t.actor, t.target, t.hp])).toEqual([[2, 1, [3, 0, 25]], [0, 2, [3, 0, 0]]]);
  // The lead's Normal Claw Strike won, so it trains a random attribute: at a 0.5 roll, Intelligence.
  expect(result).toMatchObject({ hp: 3 + 20, failed: false, battle: { won: true, recovery: { hp: 20, mp: 0 }, trained: { intelligence: 1 } } });
  const knocked = adventure.adventureFor(weak);
  expect(knocked).toMatchObject({ hp: 0, failed: true, battle: { won: true, fighter: 1, recovery: { hp: 0, mp: 0 }, after: { hp: 0 } } });
  // Only the pet still standing, whose Claw Strike won, trains; the fallen one gains nothing.
  expect(knocked.battle).not.toHaveProperty('trained');
  expect(pets.getPet(lead)).toMatchObject({ strength: stats.lead.strength, intelligence: stats.lead.intelligence + 1, charisma: stats.lead.charisma });
  expect(pets.getPet(weak)).toMatchObject({ strength: stats.weak.strength, intelligence: stats.weak.intelligence, charisma: stats.weak.charisma });
  expect(result.team!.members).toEqual([expect.objectContaining({ id: weak, status: 'defeated' })]);
  // The fallen pet can't move on, and starts over alone when it's ready.
  ok(adventure.continueAdventure(weak, knocked.battle!.id, knocked.revision));
  const fallen = adventure.adventureFor(weak);
  expect(adventure.moveAdventure(weak, 'w', fallen.revision)).toEqual(fallen);
  ok(adventure.continueAdventure(lead, result.battle!.id, result.revision));
  expect(step(lead, 'd')).toMatchObject({ x: goblin.x + 1, failed: false });
  db.prepare('UPDATE adventures SET cooldown_until = NULL WHERE player_id = ?').run(weak);
  expect(ok(adventure.restartAdventure(weak, fallen.revision))).toMatchObject({ team: null, floor: 1, hp: 16 });
  expect(adventure.adventureFor(lead).team!.members).toEqual([]);
});

it('a chest opens once for the whole team, rewarding whoever opened it', () => {
  const [lead, mate] = [player('ch-lead'), player('ch-mate')];
  team(lead, mate);
  place(lead, 11, 3); place(mate, 11, 3);
  const random = vi.spyOn(Math, 'random').mockReturnValue(0); // Food
  let opened;
  try { opened = ok(adventure.openAdventureChest(lead, adventure.adventureFor(lead).revision)); } finally { random.mockRestore(); }
  expect(opened.chests[0]).toMatchObject({ reward: { id: 'food' }, openedBy: lead });
  const seen = adventure.adventureFor(mate);
  expect(seen.chests[0]).toMatchObject({ reward: { id: 'food' }, openedBy: lead });
  expect(adventure.openAdventureChest(mate, seen.revision)).toEqual(seen);
  expect(pets.getPet(lead)!.food).toBe(1);
  expect(pets.getPet(mate)!.food).toBe(0);
});

it('shared map refreshes leave everyone safe and cannot advance the saved grass encounter', () => {
  const [lead, mate] = [player('pt-lead'), player('pt-mate')];
  const { id } = team(lead, mate);
  readyEncounter(id, 'f1-enemy-0');
  place(lead, 1, 14); place(mate, 6, 2);
  const before = db.prepare('SELECT world_json FROM teams WHERE id = ?').get(id);
  for (const pet of [lead, mate, lead, mate]) expect(adventure.patrolAdventure(pet).battle).toBeNull();
  expect(db.prepare('SELECT world_json FROM teams WHERE id = ?').get(id)).toEqual(before);
  expect(adventure.adventureFor(lead).enemies.every(enemy => enemy.hidden)).toBe(true);
});

it('only the walking teammate starts a surprise battle, with nearby allies and shared finite monsters', () => {
  const [lead, mate, near] = [player('am-lead', [6, 2, 2]), player('am-mate', [6, 2, 2]), player('am-near', [6, 2, 2])];
  const { id } = team(lead, mate, near);
  const slime = readyEncounter(id, 'f1-enemy-0');
  place(lead, 1, 14); place(mate, slime.x - 1, slime.y); place(near, slime.x - 1, slime.y + 1);
  expect(adventure.patrolAdventure(lead).battle).toBeNull();
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  let caught;
  try { caught = step(mate, 'd'); } finally { random.mockRestore(); }
  const remote = adventure.adventureFor(lead);
  expect(remote.battle).toBeNull();
  expect(remote.enemies.some(e => e.id === slime.id)).toBe(false);
  expect(caught).toMatchObject({ x: slime.x, y: slime.y, battle: { surprise: true, pending: true, won: true } });
  expect(caught.battle!.playback!.fighters.map(f => f.id)).toEqual([mate, near, `monster:${slime.id}`]);
  expect(adventure.adventureFor(near).battle).toMatchObject({ id: caught.battle!.id, fighter: 1, surprise: true });
  expect(adventure.patrolAdventure(lead)).toEqual(remote);
  expect(adventure.patrolAdventure(mate)).toEqual(caught);
  expect(step(mate, 'd')).toEqual(caught);
});

it('joins a fresh team once without charging again and leaves teammates’ map intact when a member reenters', () => {
  const [lead, mate] = [player('entry-team-lead'), player('entry-team-mate')];
  const { id } = team(lead, mate);
  const initial = adventure.adventureFor(lead), paid = pets.getPet(lead);
  expect(initial.awaitingEntry).toBe(true);
  const joined = ok(adventure.enterAdventure(lead, initial.revision, 'team-entry-one'));
  expect(joined).toMatchObject({ team: { id }, entryId: 'team-entry-one', awaitingEntry: false });
  expect(pets.getPet(lead)).toEqual(paid);
  expect(adventure.enterAdventure(lead, initial.revision, 'team-entry-one')).toEqual(joined);
  const mateBefore = adventure.adventureFor(mate), world = db.prepare('SELECT world_json FROM teams WHERE id = ?').get(id);
  const left = ok(adventure.leaveAdventure(lead, joined.revision));
  expect(left.abandoned).toBe(true);
  expect(adventure.adventureFor(mate)).toMatchObject({ revision: mateBefore.revision, abandoned: false, awaitingEntry: true });
  expect(db.prepare('SELECT world_json FROM teams WHERE id = ?').get(id)).toEqual(world);
  const mateJoined = ok(adventure.enterAdventure(mate, mateBefore.revision, 'mate-entry-one'));
  expect(mateJoined).toMatchObject({ team: { id }, awaitingEntry: false, abandoned: false });
  db.prepare('UPDATE adventures SET cooldown_until = NULL WHERE player_id = ?').run(lead);
  db.prepare('UPDATE pets SET stamina = ?, hygiene = ? WHERE id = ?').run(100, 100, lead);
  const solo = ok(adventure.enterAdventure(lead, left.revision, 'team-entry-two'));
  expect(solo).toMatchObject({ floor: 1, x: 2, y: 2, team: null, entryId: 'team-entry-two' });
  expect(adventure.adventureFor(mate)).toMatchObject({ revision: mateJoined.revision, team: { id, members: [] }, abandoned: false });
  expect(db.prepare('SELECT world_json FROM teams WHERE id = ?').get(id)).toEqual(world);
});

it('saves each teammate’s battle record and reveals it only when that member ends the run', () => {
  const [lead, mate] = [player('record-team-lead', [100, 100, 100]), player('record-team-mate', [100, 100, 100])];
  const { id } = team(lead, mate);
  const enemy = readyEncounter(id, 'f1-enemy-0');
  place(lead, enemy.x - 1, enemy.y); place(mate, enemy.x - 1, enemy.y + 1);
  const fought = step(lead, 'd'), ally = adventure.adventureFor(mate);
  expect(fought).toMatchObject({ records: [], battleCount: 1 });
  expect(ally).toMatchObject({ records: [], battleCount: 1 });
  const left = ok(adventure.leaveAdventure(mate, ally.revision));
  expect(left.records).toEqual([{ ...ally.battle, pending: false }]);
  expect(left.records[0].fighter).toBe(1);
  const continued = ok(adventure.continueAdventure(lead, fought.battle!.id, fought.revision));
  expect(continued).toMatchObject({ records: [], abandoned: false, battle: { pending: false, playback: null } });
  expect(continued.team!.members).toEqual([expect.objectContaining({ id: mate, status: 'abandoned' })]);
});

it('cooperative turns belong to each pet owner and use the strongest teammate’s coin', () => {
  const lead = player('manual-team-lead', [2, 4, 4]), mate = player('manual-team-mate', [3, 5, 5]);
  db.prepare('INSERT INTO inventory (player_id, item_id, quantity) VALUES (?, ?, ?)').run(mate, 'silver-coin', 1);
  expect(pets.equipCoin(mate, 'silver-coin')).not.toHaveProperty('error');
  const { id } = team(lead, mate), enemy = readyEncounter(id, 'f1-enemy-0');
  place(lead, enemy.x - 1, enemy.y); place(mate, enemy.x - 1, enemy.y + 1);
  const started = ok(adventure.moveAdventure(lead, 'd', adventure.adventureFor(lead).revision));
  const battle = started.battle!.playback as ActiveBattle;
  expect(battle).toMatchObject({ status: 'active', coinProvider: 1, initiative: { coin: 'silver-coin' }, turns: [] });
  expect(adventure.adventureFor(mate).battle!.playback).toEqual(battle);
  const actor = battle.fighters[battle.actor!].id, other = actor === lead ? mate : lead;
  expect(adventure.adventureBattleSkill(other, started.battle!.id, battle.revision, 'claw-strike')).toMatchObject({ status: 403 });
  const acted = ok(adventure.adventureBattleSkill(actor, started.battle!.id, battle.revision, 'claw-strike'));
  expect(adventure.adventureFor(other).battle!.playback).toEqual(acted.battle!.playback);
  expect(adventure.adventureBattleSkill(actor, started.battle!.id, battle.revision, 'claw-strike')).toEqual(acted);
  expect(adventure.adventureFor(lead).battleCount).toBe(0);
  const finished = finishBattle(lead);
  expect(finished.battleCount).toBe(1);
  expect(adventure.adventureFor(mate).battleCount).toBe(1);
});

it('a teammate can retreat on any turn without stranding the remaining player or reserving the monster twice', () => {
  const lead = player('retreat-team-lead', [2, 10, 10]), mate = player('retreat-team-mate', [4, 20, 20]), far = player('retreat-team-far');
  db.prepare('INSERT INTO inventory (player_id, item_id, quantity) VALUES (?, ?, ?)').run(mate, 'silver-coin', 1);
  pets.equipCoin(mate, 'silver-coin');
  const { id } = team(lead, mate, far), enemy = readyEncounter(id, 'f1-enemy-0');
  const saved = db.prepare('SELECT world_json FROM teams WHERE id = ?').get(id) as { world_json: string };
  const world = JSON.parse(saved.world_json) as Floor[];
  world[0].enemies = [enemy];
  db.prepare('UPDATE teams SET world_json = ? WHERE id = ?').run(JSON.stringify(world), id);
  place(lead, enemy.x - 1, enemy.y); place(mate, enemy.x - 1, enemy.y + 1); place(far, 5, 10);
  const started = ok(adventure.moveAdventure(lead, 'd', adventure.adventureFor(lead).revision));
  expect(adventure.adventureFor(far).battle).toBeNull();
  // A distant pet may keep walking grass; this enemy is already occupied.
  for (let index = 0; index < 8; index++) {
    const moved = ok(adventure.moveAdventure(far, index % 2 ? 'd' : 'a', adventure.adventureFor(far).revision));
    expect(moved.battle).toBeNull();
    expect(moved.enemies).toHaveLength(1);
  }
  const exited = ok(adventure.leaveAdventure(lead, started.revision));
  expect(exited).toMatchObject({ abandoned: true, hp: 0, battle: { pending: false, playback: { status: 'active' } }, records: [] });
  const remaining = adventure.adventureFor(mate);
  expect(remaining.battle!.playback).toMatchObject({ status: 'active', actor: 1 });
  const finished = finishBattle(mate);
  expect(finished).toMatchObject({ battle: { won: true }, abandoned: false, battleCount: 1 });
  const retired = adventure.adventureFor(lead);
  expect(retired).toMatchObject({ abandoned: true, hp: 0, battle: { pending: false, recovery: { hp: 0, mp: 0 } }, battleCount: 1 });
  expect(retired.records).toHaveLength(1);
});

it('a retired teammate can begin a new solo run while the remaining battle continues without later overwriting it', () => {
  const lead = player('new-run-team-lead', [2, 10, 10]), mate = player('new-run-team-mate', [4, 20, 20]);
  db.prepare('INSERT INTO inventory (player_id, item_id, quantity) VALUES (?, ?, ?)').run(mate, 'silver-coin', 1);
  pets.equipCoin(mate, 'silver-coin');
  const { id } = team(lead, mate), enemy = readyEncounter(id, 'f1-enemy-0');
  place(lead, enemy.x - 1, enemy.y); place(mate, enemy.x - 1, enemy.y + 1);
  const started = ok(adventure.moveAdventure(lead, 'd', adventure.adventureFor(lead).revision));
  const oldBattle = started.battle!.playback as ActiveBattle;
  const retired = ok(adventure.forfeitAdventureBattle(lead, started.battle!.id, oldBattle.revision));
  expect(retired).toMatchObject({ abandoned: true, battle: { pending: false, playback: { status: 'active' } } });
  expect(pets.equipSkills(lead, ['claw-strike'])).not.toHaveProperty('error');
  db.prepare('UPDATE adventures SET cooldown_until = NULL WHERE player_id = ?').run(lead);
  const fresh = ok(adventure.enterAdventure(lead, retired.revision, 'after-retreat'));
  expect(fresh).toMatchObject({ team: null, battle: null, records: [], hp: 16, abandoned: false });
  expect(finishBattle(mate)).toMatchObject({ battleCount: 1, battle: { won: true } });
  expect(adventure.adventureFor(lead)).toEqual(fresh);
});
