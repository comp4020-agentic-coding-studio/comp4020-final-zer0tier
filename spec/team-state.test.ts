import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { type Floor } from '../src/adventure-world.ts';

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
  return ok(adventure.moveAdventure(id, direction, adventure.adventureFor(id).revision));
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
  expect(teams.teamFor(lead).team!.members[1]).toMatchObject({ id: mate, waiting: 'has an adventure in progress; abandon it first' });
  expect(teams.setOff(lead)).toEqual({ status: 409, error: 'so-mate has an adventure in progress; abandon it first.' });
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
  expect(adventure.adventureFor(lead).team!.members).toEqual([expect.objectContaining({ id: mate, x: 3, y: 2, hp: 15, maxHp: 15 })]);
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
  expect(battle.playback.fighters.map(f => f.id)).toEqual([lead, near, `monster:${slime.id}`]);
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

it('a knocked-out teammate is out of the run while the rest explore on, and recovery skips it', () => {
  const [lead, weak] = [player('ko-lead', [12, 7, 12]), player('ko-weak', [2, 1, 1])];
  const { id } = team(lead, weak);
  const goblin = readyEncounter(id, 'f1-enemy-1');
  place(lead, goblin.x - 1, goblin.y); place(weak, goblin.x - 1, goblin.y + 1);
  // On tails the goblin strikes first, at whichever pet has more HP: the weak
  // one (4 HP, to the lead's 3) falls, then the lead finishes the goblin.
  db.prepare('UPDATE adventures SET hp = ? WHERE player_id = ?').run(3, lead);
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  let result;
  try { result = step(lead, 'd'); } finally { random.mockRestore(); }
  expect(result.battle!.playback.turns.map(t => [t.actor, t.target, t.hp])).toEqual([[2, 1, [3, 0, 10]], [0, 2, [3, 0, 0]]]);
  expect(result).toMatchObject({ hp: 3 + 7, failed: false, battle: { won: true, recovery: { hp: 7, mp: 0 } } });
  const knocked = adventure.adventureFor(weak);
  expect(knocked).toMatchObject({ hp: 0, failed: true, battle: { won: true, fighter: 1, recovery: { hp: 0, mp: 0 }, after: { hp: 0 } } });
  expect(result.team!.members).toEqual([expect.objectContaining({ id: weak, status: 'defeated' })]);
  // The fallen pet can't move on, and starts over alone when it's ready.
  ok(adventure.continueAdventure(weak, knocked.battle!.id, knocked.revision));
  const fallen = adventure.adventureFor(weak);
  expect(adventure.moveAdventure(weak, 'w', fallen.revision)).toEqual(fallen);
  ok(adventure.continueAdventure(lead, result.battle!.id, result.revision));
  expect(step(lead, 'd')).toMatchObject({ x: goblin.x + 1, failed: false });
  db.prepare('UPDATE adventures SET cooldown_until = NULL WHERE player_id = ?').run(weak);
  expect(ok(adventure.restartAdventure(weak, fallen.revision))).toMatchObject({ team: null, floor: 1, hp: 4 });
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
  expect(caught.battle!.playback.fighters.map(f => f.id)).toEqual([mate, near, `monster:${slime.id}`]);
  expect(adventure.adventureFor(near).battle).toMatchObject({ id: caught.battle!.id, fighter: 1, surprise: true });
  expect(adventure.patrolAdventure(lead)).toEqual(remote);
  expect(adventure.patrolAdventure(mate)).toEqual(caught);
  expect(step(mate, 'd')).toEqual(caught);
});
