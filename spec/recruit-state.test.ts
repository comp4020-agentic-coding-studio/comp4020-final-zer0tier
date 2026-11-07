import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createWorld, type Enemy } from '../src/adventure-world.ts';
import { type ActiveBattle } from '../src/combat.ts';

// Recruiting an offline friend's pet as an Adventure ally, in-process against a
// scratch database so tests can place pets beside a chosen monster. (The
// owner-offline check happens at the HTTP edge; see spec/recruit.test.ts.)
const directory = mkdtempSync(join(tmpdir(), 'virtuepets-recruit-'));
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

function ok<T extends object>(outcome: T): Exclude<T, { error: string }> {
  if ('error' in outcome) throw new Error(String(outcome.error));
  return outcome as Exclude<T, { error: string }>;
}
// A signed-up player's pet, with chosen attributes.
function player(id: string, stats: [number, number, number] = [5, 5, 5]) {
  pets.getOrCreatePet(id);
  db.prepare('INSERT OR IGNORE INTO accounts (id, password_hash) VALUES (?, ?)').run(id, 'x');
  db.prepare('UPDATE pets SET strength = ?, intelligence = ?, charisma = ? WHERE id = ?').run(...stats, id);
  return id;
}
// A started solo run, standing just left of the chosen monster.
function readyRun(id: string, kind: Enemy['kind'] = 'slime') {
  adventure.adventureFor(id);
  const world = createWorld(), floor = kind === 'slime-king' ? 5 : 1, level = world[floor - 1];
  const enemy = level.enemies.find(e => e.kind === kind)!;
  level.enemies = [enemy, ...level.enemies.filter(e => e !== enemy)];
  level.encounter = { seed: 1, steps: 5 };
  // Move onto grass beside a slime; the boss is reached by walking into it.
  const at = kind === 'slime-king' ? { x: enemy.x - 1, y: enemy.y } : { x: 4, y: 2 };
  if (kind !== 'slime-king') level.grass![2] = level.grass![2].slice(0, 5) + 'g' + level.grass![2].slice(6);
  db.prepare('UPDATE adventures SET x = ?, y = ?, floor = ?, world_json = ?, started = 1, abandoned = 0, battle_json = NULL WHERE player_id = ?')
    .run(at.x, at.y, floor, JSON.stringify(world), id);
  return adventure.adventureFor(id);
}
const recruit = (id: string, friend: string) => adventure.recruitAlly(id, friend, adventure.adventureFor(id).revision);
// Steps right, then plays the player's turns with their strongest affordable skill.
function fight(id: string) {
  ok(adventure.moveAdventure(id, 'd', adventure.adventureFor(id).revision));
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

it('recruits a friend at full HP/MP, fights beside it with its owner\'s saved skills, and pays the friend for the win', () => {
  // A weak pet of mine and a sturdier, brainier friend, so the ally both
  // outranks me on attributes and gets a turn before the slime falls.
  const me = player('rec-me', [2, 5, 5]), friend = player('rec-friend', [8, 30, 5]);
  pets.equipSkills(friend, ['claw-strike']);
  readyRun(me);
  const recruited = ok(recruit(me, friend));
  const full = pets.getPet(friend)!;
  expect(recruited.ally).toMatchObject({ id: friend, hp: full.combat!.maxHp, mp: full.combat!.maxMp, maxHp: full.combat!.maxHp, away: null, earned: 0 });
  const moneyBefore = full.money;
  // Heads (0.1): my pet, then the ally, then the slime; every attack hits.
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.1);
  let fought;
  try { fought = fight(me); } finally { random.mockRestore(); }
  const battle = fought.battle!.playback as ActiveBattle;
  // The friend's pet fought as a game-controlled fighter after mine, before the monster.
  expect(battle.fighters.map(f => f.id)).toEqual([me, friend, 'monster:f1-enemy-0']);
  expect(battle.automaticIds).toEqual([friend]);
  // Only a player's pet may supply the coin, even when the ally has more attributes.
  expect(battle.coinProvider).toBe(0);
  // The ally took its own turns, from its owner's saved skills, chosen by the game.
  const allyTurns = battle.turns.filter(t => t.actor === 1);
  expect(allyTurns.length).toBeGreaterThan(0);
  expect(allyTurns.every(t => t.ability === 'claw-strike')).toBe(true);
  expect(fought.battle).toMatchObject({ won: true, allyPay: { ally: friend, money: adventure.ALLY_PAY.win, knockedOut: false } });
  expect(pets.getPet(friend)!.money).toBe(moneyBefore + adventure.ALLY_PAY.win);
  // The ally never trains: its attributes are untouched.
  expect(pets.getPet(friend)).toMatchObject({ strength: 8, intelligence: 30, charisma: 5 });
  // Acknowledging and rereading never pay twice.
  ok(adventure.continueAdventure(me, fought.battle!.id, fought.revision));
  expect(adventure.continueAdventure(me, fought.battle!.id, fought.revision)).not.toHaveProperty('error');
  expect(pets.getPet(friend)!.money).toBe(moneyBefore + adventure.ALLY_PAY.win);
  expect(adventure.adventureFor(me).ally).toMatchObject({ id: friend, earned: adventure.ALLY_PAY.win });
});

it('never waits for the ally: the saved battle always rests on a player\'s turn, and nobody can move or forfeit for it', () => {
  const me = player('ctl-me', [5, 5, 5]), friend = player('ctl-friend', [5, 5, 5]);
  readyRun(me);
  ok(recruit(me, friend));
  // On heads my pet strikes first, so the battle waits on my turn.
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.1);
  try { ok(adventure.moveAdventure(me, 'd', adventure.adventureFor(me).revision)); } finally { random.mockRestore(); }
  let state = adventure.adventureFor(me);
  let battle = state.battle!.playback as ActiveBattle;
  expect(battle).toMatchObject({ status: 'active', actor: 0 });
  // The friend's owner has no battle on my run to act in.
  expect(adventure.adventureBattleSkill(friend, state.battle!.id, battle.revision, 'claw-strike')).toMatchObject({ status: 409 });
  expect(adventure.forfeitAdventureBattle(friend, state.battle!.id, battle.revision)).toMatchObject({ status: 409 });
  // After my move the ally and the monster act at once, and it's my turn again.
  ok(adventure.adventureBattleSkill(me, state.battle!.id, battle.revision, 'claw-strike'));
  state = adventure.adventureFor(me);
  battle = state.battle!.playback as ActiveBattle;
  expect(battle.turns.map(t => t.actor).slice(0, 2)).toEqual([0, 1]);
  if (battle.status === 'active') expect(battle.actor).toBe(0);
});

it('sends a knocked-out ally home and still pays it for the win it fought in', () => {
  const me = player('ko-me', [40, 5, 5]), friend = player('ko-friend', [5, 5, 5]);
  readyRun(me);
  ok(recruit(me, friend));
  // A 0.6 roll is tails, so the slime strikes first, and it hits, at whoever
  // has the most HP: the 2-HP ally over my 1-HP pet. The ally falls; then my
  // 40-Strength pet finishes the slime.
  db.prepare('UPDATE adventures SET hp = 1, ally_json = ? WHERE player_id = ?').run(JSON.stringify({ hp: 2, mp: 5 }), me);
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.6);
  let fought;
  try { fought = fight(me); } finally { random.mockRestore(); }
  const turns = (fought.battle!.playback as ActiveBattle).turns;
  expect(turns[0]).toMatchObject({ actor: 2, target: 1, hp: [1, 0, expect.any(Number)] });
  expect(fought.battle).toMatchObject({ won: true, allyPay: { ally: friend, money: adventure.ALLY_PAY.win, knockedOut: true } });
  // Home now, with what it earned on the run still shown.
  expect(fought.ally).toEqual({ id: null, earned: adventure.ALLY_PAY.win });
  expect(adventure.recruitRefusal(me, friend)).toBeUndefined();
  // My next battle is mine alone.
  ok(adventure.continueAdventure(me, fought.battle!.id, fought.revision));
});

it('pays the boss bonus when the Slime King falls, but never the woodland prize or training', () => {
  const me = player('boss-me', [100, 100, 100]), friend = player('boss-friend', [5, 5, 5]);
  readyRun(me, 'slime-king');
  ok(recruit(me, friend));
  const before = pets.getPet(friend)!;
  const fought = fight(me);
  expect(fought.battle).toMatchObject({ won: true, enemyId: 'slime-king', allyPay: { money: adventure.ALLY_PAY.win + adventure.ALLY_PAY.boss } });
  expect(pets.getPet(friend)).toMatchObject({
    money: before.money + adventure.ALLY_PAY.win + adventure.ALLY_PAY.boss,
    strength: 5, intelligence: 5, charisma: 5, woodlandClears: 0, coins: before.coins,
  });
});

it('recruits only a free friend: not yourself, the bot, a stranger, someone on an adventure, or another run\'s ally', () => {
  const me = player('who-me'), other = player('who-other'), friend = player('who-friend'), explorer = player('who-explorer');
  readyRun(me); readyRun(other); readyRun(explorer);
  expect(recruit(me, me)).toMatchObject({ status: 409 });
  expect(recruit(me, '0')).toMatchObject({ status: 409, error: 'The training bot stays in the arena.' });
  expect(recruit(me, 'nobody-here')).toMatchObject({ status: 404 });
  expect(recruit(me, explorer)).toMatchObject({ status: 409, error: `${explorer}'s pet is on an adventure of its own.` });
  ok(recruit(other, friend));
  expect(recruit(me, friend)).toMatchObject({ status: 409, error: `${friend}'s pet is already helping someone else on an adventure.` });
  // Once the other run ends, the friend is free again.
  ok(adventure.leaveAdventure(other, adventure.adventureFor(other).revision));
  ok(recruit(me, friend));
  expect(recruit(me, explorer)).toMatchObject({ status: 409, error: `${friend}'s pet is already with you. Send it home first.` });
  ok(adventure.dismissAlly(me, adventure.adventureFor(me).revision));
  expect(adventure.adventureFor(me).ally).toBeNull();
});

it('a recruited friend who starts its own adventure sits out without rewriting the recruiter\'s run', () => {
  const me = player('away-me', [20, 5, 5]), friend = player('away-friend');
  readyRun(me);
  ok(recruit(me, friend));
  const revision = adventure.adventureFor(me).revision;
  readyRun(friend);
  const state = adventure.adventureFor(me);
  expect(state.revision).toBe(revision);
  expect(state.ally).toMatchObject({ id: friend, away: 'is on an adventure of its own' });
  const fought = fight(me);
  expect((fought.battle!.playback as ActiveBattle).fighters.map(f => f.id)).toEqual([me, 'monster:f1-enemy-0']);
  expect(fought.battle).not.toHaveProperty('allyPay');
});

it('team runs: each teammate\'s ally fights in shared battles and the coin still comes from a player', () => {
  const lead = player('tr-lead', [30, 5, 5]), mate = player('tr-mate', [30, 5, 5]), friend = player('tr-friend', [90, 90, 90]);
  ok(teams.invite(lead, mate)); ok(teams.accept(mate, teams.teamFor(mate).invitations[0].id)); ok(teams.setOff(lead));
  for (const id of [lead, mate]) ok(adventure.enterAdventure(id, adventure.adventureFor(id).revision, `${id}-entry`));
  ok(recruit(mate, friend));
  // Stand the teammate beside the lead, then step the lead into a grass encounter.
  const row = db.prepare('SELECT team_id FROM adventures WHERE player_id = ?').get(lead) as { team_id: number };
  const world = JSON.parse((db.prepare('SELECT world_json FROM teams WHERE id = ?').get(row.team_id) as { world_json: string }).world_json);
  world[0].encounter = { seed: 1, steps: 5 };
  world[0].grass[2] = world[0].grass[2].slice(0, 5) + 'g' + world[0].grass[2].slice(6);
  db.prepare('UPDATE teams SET world_json = ? WHERE id = ?').run(JSON.stringify(world), row.team_id);
  db.prepare('UPDATE adventures SET x = 4, y = 2 WHERE player_id = ?').run(lead);
  db.prepare('UPDATE adventures SET x = 4, y = 3 WHERE player_id = ?').run(mate);
  ok(adventure.moveAdventure(lead, 'd', adventure.adventureFor(lead).revision));
  const battle = adventure.adventureFor(lead).battle!.playback as ActiveBattle;
  expect(battle.fighters.map(f => f.id).slice(0, 3)).toEqual([lead, mate, friend]);
  expect(battle.automaticIds).toEqual([friend]);
  expect([0, 1]).toContain(battle.coinProvider);
});

it('forfeiting withdraws the ally too, so it never plays on alone, wins, or earns', () => {
  const me = player('quit-me', [5, 5, 5]), friend = player('quit-friend', [200, 5, 5]);
  readyRun(me);
  ok(recruit(me, friend));
  const before = pets.getPet(friend)!.money;
  // Heads: my pet moves first, so the battle waits on my turn.
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.1);
  try { ok(adventure.moveAdventure(me, 'd', adventure.adventureFor(me).revision)); } finally { random.mockRestore(); }
  const state = adventure.adventureFor(me);
  const live = state.battle!.playback as ActiveBattle;
  expect(live).toMatchObject({ status: 'active', actor: 0 });
  // My 200-Strength friend would win this alone in one hit; leaving takes it home.
  ok(adventure.forfeitAdventureBattle(me, state.battle!.id, live.revision));
  const after = adventure.adventureFor(me);
  const ended = after.battle!.playback as ActiveBattle;
  expect(ended.status).toBe('finished');
  expect(ended.winner).toBe('monster:f1-enemy-0');
  expect(ended.turns.some(turn => turn.actor === 1)).toBe(false);
  expect(ended.forfeited).toEqual([0, 1]);
  expect(after.battle).toMatchObject({ won: false, allyPay: { ally: friend, money: 0, knockedOut: false } });
  expect(after.enemies.some(enemy => enemy.id === 'f1-enemy-0')).toBe(true);
  expect(pets.getPet(friend)!.money).toBe(before);
});

it('leaving mid-battle withdraws the ally the same way', () => {
  const me = player('leave-me', [5, 5, 5]), friend = player('leave-friend', [200, 5, 5]);
  readyRun(me);
  ok(recruit(me, friend));
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.1);
  try { ok(adventure.moveAdventure(me, 'd', adventure.adventureFor(me).revision)); } finally { random.mockRestore(); }
  ok(adventure.leaveAdventure(me, adventure.adventureFor(me).revision));
  const ended = adventure.adventureFor(me).battle!.playback as ActiveBattle;
  expect(ended.winner).toBe('monster:f1-enemy-0');
  expect(ended.turns.some(turn => turn.actor === 1)).toBe(false);
});

it("a friend whose pet fights as someone's ally stays free to play: nothing of theirs is busy", () => {
  const me = player('busy-me', [5, 5, 5]), friend = player('busy-friend', [5, 5, 5]);
  readyRun(me);
  ok(recruit(me, friend));
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.1);
  try { ok(adventure.moveAdventure(me, 'd', adventure.adventureFor(me).revision)); } finally { random.mockRestore(); }
  // My battle waits on me, with the friend's pet standing in it.
  const live = adventure.adventureFor(me).battle!.playback as ActiveBattle;
  expect(live.status).toBe('active');
  expect(live.hp[1]).toBeGreaterThan(0);
  expect(pets.combatBusy(friend)).toBeUndefined();
  expect(pets.busyNow(pets.getPet(friend)!)).toBeUndefined();
  expect(pets.study(friend, 'math')).not.toHaveProperty('error');
});

it("keeps the run's whole ally pay after old replays are trimmed", () => {
  const me = player('long-me', [100, 100, 100]), friend = player('long-friend', [5, 5, 5]);
  readyRun(me);
  ok(recruit(me, friend));
  // Pretend 60 paid wins already happened; only the newest 50 replays remain.
  const row = db.prepare('SELECT records_json FROM adventures WHERE player_id = ?').get(me) as { records_json: string | null };
  const records = row.records_json ? JSON.parse(row.records_json) : { total: 0, battles: [] };
  db.prepare('UPDATE adventures SET records_json = ? WHERE player_id = ?')
    .run(JSON.stringify({ ...records, total: 60, allyEarned: 60 * adventure.ALLY_PAY.win }), me);
  const fought = fight(me);
  expect(fought.battle).toMatchObject({ won: true, allyPay: { money: adventure.ALLY_PAY.win } });
  expect(fought.ally).toMatchObject({ earned: 61 * adventure.ALLY_PAY.win });
});
