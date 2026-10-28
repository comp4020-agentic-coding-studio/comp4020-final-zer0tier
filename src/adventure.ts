import { randomUUID } from 'node:crypto';
import { db, transaction } from './db.ts';
import {
  ABILITIES, battleTraining, forfeitBattle, MONSTER_ABILITIES, mainAttribute, maxHpFor, maxMpFor, startBattle, takeBattleTurn, weaknessOf,
  type ActiveBattle, type Battle,
} from './combat.ts';
import {
  ADVENTURE_COOLDOWN_MINUTES, ADVENTURE_COST, busyNow, consumeHourglass, findItem, getPet, ITEMS, LUCK, MAX_CARE,
  powerOf, spendForAdventure, train, use, type Pet,
} from './pets.ts';
import { grantTreasure } from './inventory.ts';
import { COINS, rollTreasure, type TreasureReward } from './treasure.ts';
import { monsterSkills, MONSTER_SKILL_DROP_RATE } from './skills.ts';
import { monsterBuild, monsterMoves } from './monsters.ts';
import {
  createWorld, directions, FLOOR_COUNT, FLOOR_KEY_DROP_RATE, grassEncounter, nearby, prepareExit, prepareGrass, samePoint, SIZE, walkable, type Enemy, type Floor, type Point,
} from './adventure-world.ts';
import { realMs, TIME_SCALE } from './clock.ts';

export type AdventureBattle = {
  id: string; floor: number; enemyId: string; enemyName: string;
  won: boolean; pending: boolean; playback: Battle | ActiveBattle;
  recovery: { hp: number; mp: number };
  after?: { hp: number; mp: number }; // what the pet carries back to the map; absent in older saves
  fighter?: number; // this pet's place in a team battle's playback; absent means the first
  attacked?: true; // legacy battle where a patrolling monster caught the pet
  surprise?: true; // hidden monster encountered by walking into tall grass
  keyDrop?: { floor: number; name: 'Floor Key' };
  skillDrop?: TreasureReward;
  trained?: Partial<Record<'strength' | 'intelligence' | 'charisma', number>>; // this pet's victory gain
};
export const ADVENTURE_RECORD_LIMIT = 50;
type BattleRecords = { total: number; battles: AdventureBattle[] };
type SavedAdventure = {
  x: number; y: number; floor: number; world_json: string | null;
  revision: string | null; battle_json: string | null;
  hp: number | null; mp: number | null; cooldown_until: number | null; abandoned: number; patrolled_at: number | null;
  team_id: number | null; team_world: string | null; started: number;
  records_json: string | null; entry_id: string | null; awaiting_entry: number;
};
type Progress = {
  id: string; pet: Pet;
  x: number; y: number; floor: number; world: Floor[];
  revision: string; battle: AdventureBattle | null;
  hp: number; mp: number; maxHp: number; maxMp: number;
  cooldownUntil: number | null; abandoned: boolean; patrolledAt: number;
  teamId: number | null; // a team run shares its team's map; a solo run keeps its own
  started: boolean; // false until the pet first acts on the map, or sets off with a team
  records: BattleRecords; entryId: string | null; awaitingEntry: boolean;
  inventory: ReturnType<typeof inventoryView>;
};

function inventoryView(pet: Pet) {
  return {
    items: ITEMS.map(item => ({ ...item, quantity: pet[item.id],
      usable: pet[item.id] > 0 && (item.effect === 'skip' ? pet.activity !== 'idle' : pet[item.restores] < MAX_CARE),
    })),
    abilities: ABILITIES.map(a => ({ ...a, learned: pet.abilities.includes(a.id), equipped: pet.equippedAbilities.includes(a.id) })),
    coins: COINS.map(coin => ({ ...coin, quantity: pet.coins[coin.id], equipped: coin.id === pet.equippedCoin })),
    stamina: pet.stamina, hygiene: pet.hygiene,
  };
}

// Legacy saves may place the pet on an occupied tile. Move only
// that monster, keeping every other saved position and all defeated monsters.
function vacatePlayerTile(floor: Floor, player: Point): void {
  for (const enemy of floor.enemies.filter(e => samePoint(e, player))) {
    const free = floor.tiles.flatMap((row, y) => [...row].map((_, x) => ({ x, y })))
      .filter(p => walkable(floor, p) && !samePoint(p, player)
        && !floor.enemies.some(e => samePoint(e, p)) && !floor.chests.some(c => samePoint(c, p))
        && ![floor.up, floor.down].some(s => s && samePoint(s, p)))
      .sort((a, b) => (Math.abs(a.x - player.x) + Math.abs(a.y - player.y)) - (Math.abs(b.x - player.x) + Math.abs(b.y - player.y)))[0];
    enemy.x = free.x; enemy.y = free.y;
  }
}

function load(id: string): Progress {
  db.prepare('INSERT OR IGNORE INTO adventures (player_id, x, y) VALUES (?, ?, ?)').run(id, 2, 2);
  const saved = db.prepare(`SELECT a.x, a.y, a.floor, a.world_json, a.revision, a.battle_json, a.hp, a.mp, a.cooldown_until, a.abandoned,
      a.patrolled_at, a.team_id, t.world_json AS team_world, a.started, a.records_json, a.entry_id, a.awaiting_entry
    FROM adventures a LEFT JOIN teams t ON t.id = a.team_id WHERE a.player_id = ?`).get(id) as SavedAdventure;
  const pet = getPet(id)!;
  const maxHp = maxHpFor(pet), maxMp = maxMpFor(pet);
  const hp = Math.min(saved.hp ?? maxHp, maxHp), mp = Math.min(saved.mp ?? maxMp, maxMp);
  const team = saved.team_id !== null;
  const world: Floor[] = team ? JSON.parse(saved.team_world!) : saved.world_json ? JSON.parse(saved.world_json) : createWorld();
  // Upgrade old solo and shared maps without replacing their walls, rewards,
  // remaining monsters, or saved battles. Persist the seed before returning it.
  const upgraded = world.map(floor => {
    const grass = prepareGrass(floor), exit = prepareExit(floor);
    return grass || exit;
  }).some(Boolean);
  if (upgraded) {
    if (team) db.prepare('UPDATE teams SET world_json = ? WHERE id = ?').run(JSON.stringify(world), saved.team_id);
    else db.prepare('UPDATE adventures SET world_json = ? WHERE player_id = ?').run(JSON.stringify(world), id);
  }
  const revision = saved.revision ?? randomUUID();
  // Setting off with a team saves every member's run in full.
  if (!team && (!saved.world_json || !saved.revision || saved.hp === null || saved.mp === null)) {
    vacatePlayerTile(world[saved.floor - 1], saved);
    db.prepare('UPDATE adventures SET world_json = ?, revision = ?, hp = ?, mp = ? WHERE player_id = ?').run(JSON.stringify(world), revision, hp, mp, id);
  }
  const battle = saved.battle_json ? JSON.parse(saved.battle_json) as AdventureBattle : null;
  // An older run has only its last battle available; retain that replay.
  const records = saved.records_json ? JSON.parse(saved.records_json) as BattleRecords
    : { total: battle ? 1 : 0, battles: battle ? [{ ...battle, pending: false }] : [] };
  return { id, pet, x: saved.x, y: saved.y, floor: saved.floor, world, revision, hp, mp, maxHp, maxMp,
    cooldownUntil: saved.cooldown_until, abandoned: saved.abandoned === 1, patrolledAt: saved.patrolled_at ?? 0,
    teamId: saved.team_id, started: saved.started === 1, inventory: inventoryView(pet),
    battle, records, entryId: saved.entry_id, awaitingEntry: saved.awaiting_entry === 1 };
}

// A run ends when the pet falls, the player leaves, or the Slime King falls.
const over = (saved: Progress) => saved.hp === 0 || saved.abandoned;
const complete = (saved: Progress) => !over(saved) && !saved.world[FLOOR_COUNT - 1].enemies.some(e => e.kind === 'slime-king');

// The rest of a team run's members, each with their own saved run on the shared map.
function teammates(saved: Progress): Progress[] {
  if (saved.teamId === null) return [];
  return (db.prepare('SELECT player_id FROM adventures WHERE team_id = ? AND player_id <> ? ORDER BY player_id')
    .all(saved.teamId, saved.id) as { player_id: string }[]).map(row => load(row.player_id));
}
// Teammates still exploring on the pet's floor can join a nearby encounter.
const floormates = (saved: Progress) => teammates(saved).filter(mate => mate.floor === saved.floor && !over(mate));

function view(saved: Progress) {
  const floor = saved.world[saved.floor - 1];
  const recordsAvailable = (over(saved) || complete(saved)) && !saved.battle?.pending;
  return {
    x: saved.x, y: saved.y, floor: saved.floor, floorCount: FLOOR_COUNT, size: SIZE,
    name: floor.name, tiles: floor.tiles, grass: floor.grass!, chests: floor.chests,
    // Hidden monster coordinates/routes are deliberately absent from the API.
    enemies: floor.enemies.map(({ x, y, route: _route, leg: _leg, ...enemy }) => ({
      ...enemy, ...(enemy.kind === 'slime-king' ? { x, y } : {}),
      hidden: enemy.kind !== 'slime-king', alerted: false,
      type: mainAttribute(enemy), weakness: weaknessOf(mainAttribute(enemy)), maxHp: maxHpFor(enemy), maxMp: maxMpFor(enemy),
      skillDrops: monsterSkills(enemy.kind, floor.number).map(s => ({ id: s.id, name: s.name })),
      strategy: monsterBuild(enemy)?.strategy,
      moves: [...ABILITIES, ...MONSTER_ABILITIES].filter(a => monsterMoves(enemy, floor.number).some(id => id === a.id)),
    })),
    up: floor.up, down: floor.down, revision: saved.revision,
    battle: saved.battle ? { ...saved.battle, playback: saved.battle.pending || recordsAvailable ? saved.battle.playback : null } : null,
    records: recordsAvailable ? saved.records.battles : [], battleCount: saved.records.total, recordLimit: ADVENTURE_RECORD_LIMIT,
    entryId: saved.entryId, awaitingEntry: saved.awaitingEntry,
    exit: floor.down ? { ...floor.exit!, dropRate: FLOOR_KEY_DROP_RATE } : null,
    inventory: saved.inventory,
    hp: saved.hp, mp: saved.mp, maxHp: saved.maxHp, maxMp: saved.maxMp, failed: saved.hp === 0,
    abandoned: saved.abandoned, completed: complete(saved), started: saved.started,
    team: saved.teamId === null ? null : {
      id: saved.teamId,
      members: teammates(saved).map(mate => ({
        id: mate.id, color: mate.pet.color, appearance: mate.pet.appearance,
        floor: mate.floor, x: mate.x, y: mate.y, hp: mate.hp, maxHp: mate.maxHp,
        status: mate.abandoned ? 'abandoned' : mate.hp === 0 ? 'defeated' : 'exploring',
      })),
    },
    encounters: floor.enemies.filter(e => e.kind === 'slime-king' && nearby(e, saved)).map(e => e.id),
    cooldownUntil: saved.cooldownUntil, timeScale: TIME_SCALE, patrolMs: PATROL_MS,
    restartCost: ADVENTURE_COST, cooldownMinutes: ADVENTURE_COOLDOWN_MINUTES,
  };
}
export function adventureFor(id: string) { return view(load(id)); }

// A pet that's studying or working can't explore. Looking at the map,
// acknowledging a battle, and using items or an Hourglass stay open.
function busyRefusal(id: string) {
  const refusal = busyNow(getPet(id)!);
  return refusal ? { error: refusal, status: 409 as const } : undefined;
}

// Position, removed monsters, and the exact playback are one atomic write.
// A stale retry (even after Continue) cannot apply the same movement twice.
// A team run's map is the team's, written alongside.
// `trained` is a finished victory's attribute gain. It is written only with
// the revision it belongs to, so a stale retry can never train a pet twice.
function save(id: string, saved: Progress, trained?: AdventureBattle['trained']) {
  transaction(() => {
    const written = db.prepare('UPDATE adventures SET x = ?, y = ?, floor = ?, world_json = ?, battle_json = ?, records_json = ?, entry_id = ?, awaiting_entry = ?, hp = ?, mp = ?, cooldown_until = ?, abandoned = ?, team_id = ?, started = 1, revision = ? WHERE player_id = ? AND revision = ?')
      .run(saved.x, saved.y, saved.floor, saved.teamId === null ? JSON.stringify(saved.world) : null, saved.battle ? JSON.stringify(saved.battle) : null,
        JSON.stringify(saved.records), saved.entryId, Number(saved.awaitingEntry),
        saved.hp, saved.mp, saved.cooldownUntil, Number(saved.abandoned), saved.teamId, randomUUID(), id, saved.revision);
    if (written.changes === 1 && saved.teamId !== null) {
      db.prepare('UPDATE teams SET world_json = ? WHERE id = ?').run(JSON.stringify(saved.world), saved.teamId);
    }
    if (written.changes === 1 && trained) train(id, trained);
  });
  return adventureFor(id);
}

// Teammates beside the pet join its battle, unless they're out, already in
// one, or busy studying or working.
function alliesOf(saved: Progress): Progress[] {
  return floormates(saved).filter(mate => nearby(mate, saved) && !mate.battle?.pending && !busyNow(mate.pet));
}

function activeBattle(battle: Battle): battle is ActiveBattle {
  return 'status' in battle && battle.status === 'active';
}

// Every participant saves the same turn state. The map and rewards change only
// when its final turn resolves; retries cannot award recovery or a key twice.
function saveBattle(saved: Progress, participants: Progress[], playback: ActiveBattle) {
  return transaction(() => {
    const encounter = saved.battle!, finished = playback.status === 'finished';
    const monster = playback.fighters.at(-1)!;
    const won = finished && playback.winner !== monster.id;
    const floor = saved.world[encounter.floor - 1];
    const keyDrop = won && floor.down && floor.exit && !floor.exit.keyFound && !floor.exit.unlocked
      && Math.random() < FLOOR_KEY_DROP_RATE;
    if (keyDrop) floor.exit!.keyFound = true;
    if (won) {
      const enemy = floor.enemies.find(enemy => enemy.id === encounter.enemyId);
      floor.enemies = floor.enemies.filter(enemy => enemy.id !== encounter.enemyId);
      // Only the initiating pet advances onto a defeated visible boss's tile.
      const leader = participants.find(fighter => fighter.id === playback.fighters[0].id);
      if (leader && enemy && playback.hp[0] > 0 && !encounter.surprise) {
        leader.x = enemy.x; leader.y = enemy.y;
      }
    }
    for (const fighter of participants) {
      const index = playback.fighters.findIndex(member => member.id === fighter.id);
      // Healing and basic MP recovery must survive the return to exploration.
      // Temporary stat buffs can never raise the run's permanent resource caps.
      const carryHp = playback.rulesVersion === 2
        ? playback.initialHp![index] - (playback.resourceBonus?.[index].hp ?? 0) + (playback.restoredHp?.[index] ?? 0) : fighter.hp;
      const carryMp = playback.rulesVersion === 2
        ? playback.initialMp![index] - (playback.resourceBonus?.[index].mp ?? 0) + (playback.restoredMp?.[index] ?? 0) : fighter.mp;
      fighter.hp = Math.min(playback.hp[index], fighter.maxHp, carryHp);
      fighter.mp = Math.min(playback.mp[index], fighter.maxMp, carryMp);
      const standing = won && fighter.hp > 0 && !fighter.abandoned;
      const recovery = {
        hp: standing ? Math.min(Math.ceil(fighter.maxHp * 0.2), fighter.maxHp - fighter.hp) : 0,
        mp: standing ? Math.min(Math.ceil(fighter.maxMp * 0.2), fighter.maxMp - fighter.mp) : 0,
      };
      fighter.hp += recovery.hp; fighter.mp += recovery.mp;
      // Each pet still standing grows the attribute behind its own last hit; the
      // Slime King, the woodland's final boss, grows all three. A pet that never
      // struck (its teammates finished the monster first) gains nothing.
      const attribute = standing ? battleTraining(playback, index) : undefined;
      const trained = !attribute ? undefined : monster.monster === 'slime-king'
        ? { strength: 1, intelligence: 1, charisma: 1 }
        : { [attribute]: 1 };
      fighter.battle = {
        ...fighter.battle!, won, playback, recovery,
        ...(finished ? { after: { hp: fighter.hp, mp: fighter.mp } } : {}),
        ...(keyDrop ? { keyDrop: { floor: encounter.floor, name: 'Floor Key' as const } } : {}),
        ...(trained ? { trained } : {}),
      };
      if (standing && monster.monster && (monster.monster === 'slime-king' || Math.random() < MONSTER_SKILL_DROP_RATE)) {
        const eligible = monsterSkills(monster.monster, encounter.floor);
        const unlearned = eligible.filter(s => !fighter.pet.abilities.includes(s.id));
        const pool = unlearned.length ? unlearned : eligible;
        const skill = pool[Math.floor(Math.random() * pool.length)];
        if (skill) fighter.battle.skillDrop = grantTreasure(fighter.id, { category: 'ability', id: skill.id, name: skill.name, quantity: 1 });
      }
      if (finished) {
        fighter.records.total++;
        fighter.records.battles.push({ ...fighter.battle, pending: false });
        fighter.records.battles = fighter.records.battles.slice(-ADVENTURE_RECORD_LIMIT);
      }
      // Loaders may have read the team map separately; save the current shared
      // world with each row so one participant cannot restore a defeated enemy.
      fighter.world = saved.world;
    }
    for (const fighter of participants) save(fighter.id, fighter, finished ? fighter.battle?.trained : undefined);
    return adventureFor(saved.id);
  });
}

// A surprise encounter keeps the pet on the grass tile it just entered. Only
// monsters choose attacks automatically: a pet's saved turn waits for its owner.
function resolveBattle(id: string, saved: Progress, enemy: Enemy, surprise = false) {
  const allies = alliesOf(saved), participants = [saved, ...allies];
  const build = monsterBuild(enemy);
  const monster = { ...enemy, id: `monster:${enemy.id}`, monster: enemy.kind, abilities: monsterMoves(enemy, saved.floor),
    tactic: build?.tactic, strategy: build?.strategy,
    color: build?.color ?? { slime: '#0891b2', goblin: '#15803d', 'slime-king': '#c026d3' }[enemy.kind] };
  const roll = (stats: Parameters<typeof powerOf>[0]) => powerOf(stats) * (LUCK.min + Math.random() * (LUCK.max - LUCK.min));
  const playback = startBattle(participants.map(fighter => fighter.pet), monster,
    [...participants.map(fighter => roll(fighter.pet)), roll(monster)], {
      mode: 'monster', hp: [...participants.map(fighter => fighter.hp), maxHpFor(monster)],
      mp: [...participants.map(fighter => fighter.mp), maxMpFor(monster)],
    });
  const battleId = randomUUID();
  participants.forEach((fighter, index) => {
    fighter.battle = {
      id: battleId, floor: saved.floor, enemyId: enemy.id, enemyName: enemy.name,
      won: false, pending: true, playback, recovery: { hp: 0, mp: 0 },
      ...(index ? { fighter: index } : {}), ...(surprise ? { surprise: true as const } : {}),
    };
  });
  return saveBattle(saved, participants, playback);
}

// The pets in this player's current battle, whose saved rows a win may train.
export function battleFighters(id: string): string[] {
  const battle = load(id).battle;
  return battle?.pending ? battle.playback.fighters.filter(fighter => !fighter.monster).map(fighter => fighter.id) : [];
}

function battleParticipants(saved: Progress): Progress[] {
  return saved.battle!.playback.fighters.filter(fighter => !fighter.monster).map(fighter => fighter.id === saved.id ? saved : load(fighter.id))
    .filter(fighter => fighter.battle?.id === saved.battle!.id);
}

function battleAction(id: string, battleId: unknown, turnRevision: unknown, ability: unknown, forfeit: boolean) {
  if (typeof battleId !== 'string' || !Number.isInteger(turnRevision)) {
    return { error: 'Choose the saved battle and its current turn.', status: 400 };
  }
  return transaction(() => {
    const saved = load(id), battle = saved.battle;
    if (!battle || battle.id !== battleId) return { error: 'That battle is not your current encounter.', status: 409 };
    if (!activeBattle(battle.playback)) return view(saved);
    if (turnRevision !== battle.playback.revision) return view(saved);
    if (saved.abandoned) return { error: 'You have already left this battle.', status: 409 };
    const playback = forfeit ? forfeitBattle(battle.playback, id, turnRevision)
      : takeBattleTurn(battle.playback, id, ability, turnRevision);
    if ('error' in playback) return playback;
    if (forfeit) { saved.abandoned = true; battle.pending = false; saved.awaitingEntry = false; }
    return saveBattle(saved, battleParticipants(saved), playback);
  });
}
export function adventureBattleSkill(id: string, battleId: unknown, turnRevision: unknown, ability: unknown) {
  return battleAction(id, battleId, turnRevision, ability, false);
}
export function forfeitAdventureBattle(id: string, battleId: unknown, turnRevision: unknown) {
  return battleAction(id, battleId, turnRevision, undefined, true);
}

// A shared monster belongs to one active battle at a time, even when another
// teammate explores elsewhere on the same floor.
function reservedEnemies(saved: Progress): string[] {
  return floormates(saved).filter(mate => mate.battle && activeBattle(mate.battle.playback))
    .map(mate => mate.battle!.enemyId);
}

export function moveAdventure(id: string, direction: unknown, revision?: unknown) {
  if (typeof direction !== 'string' || !Object.hasOwn(directions, direction)) {
    return { error: 'Choose W, A, S, or D.', status: 400 };
  }
  if (typeof revision !== 'string') return { error: 'Reload the map before moving.', status: 400 };
  const saved = load(id), floor = saved.world[saved.floor - 1];
  if (revision !== saved.revision || saved.battle?.pending || over(saved) || complete(saved)) return view(saved);
  const busy = busyRefusal(id);
  if (busy) return busy;
  const [dx, dy] = directions[direction as keyof typeof directions];
  const player = { x: saved.x + dx, y: saved.y + dy };
  if (!walkable(floor, player)) return { error: 'A tree blocks that path.', status: 409 };
  const enemy = floor.enemies.find(e => e.kind === 'slime-king' && samePoint(e, player));
  if (enemy) {
    if (reservedEnemies(saved).includes(enemy.id)) return { error: 'Your teammates are already fighting this monster.', status: 409 };
    return resolveBattle(id, saved, enemy);
  }
  saved.x = player.x; saved.y = player.y;
  const hidden = grassEncounter(floor, player, reservedEnemies(saved));
  if (hidden) return resolveBattle(id, saved, hidden, true);
  return save(id, saved);
}

// Keep the established refresh action for shared-map updates and old clients.
// Reading the map cannot move monsters or begin a battle: only walking does.
export const PATROL_MS = 1000;
export function patrolAdventure(id: string) { return adventureFor(id); }

export function changeFloor(id: string, action: unknown, revision?: unknown) {
  if (action !== 'ascend' && action !== 'descend') return { error: 'Choose ascend or descend.', status: 400 };
  if (typeof revision !== 'string') return { error: 'Reload the map before using the stairs.', status: 400 };
  const saved = load(id), floor = saved.world[saved.floor - 1];
  if (revision !== saved.revision || saved.battle?.pending || over(saved) || complete(saved)) return view(saved);
  const busy = busyRefusal(id);
  if (busy) return busy;
  const stair = action === 'descend' ? floor.down : floor.up;
  if (!stair || !samePoint(saved, stair)) return { error: 'Stand on the matching stairs first.', status: 409 };
  if (action === 'descend' && !floor.exit!.unlocked) {
    if (!floor.exit!.keyFound) return { error: 'These stairs are locked. Defeat monsters on this floor for a 5% chance to find its Floor Key.', status: 409 };
    floor.exit!.keyFound = false;
    floor.exit!.unlocked = true;
  }
  const destination = saved.floor + (action === 'descend' ? 1 : -1);
  const landing = action === 'descend' ? saved.world[destination - 1].up! : saved.world[destination - 1].down!;
  saved.x = landing.x; saved.y = landing.y; saved.floor = destination;
  return save(id, saved);
}

export function continueAdventure(id: string, battleId: unknown, revision: unknown) {
  if (typeof battleId !== 'string' || typeof revision !== 'string') return { error: 'Choose the saved battle to continue.', status: 400 };
  const saved = load(id);
  if (revision !== saved.revision) return view(saved);
  if (!saved.battle || saved.battle.id !== battleId) return { error: 'That battle is not your current encounter.', status: 409 };
  if (!saved.battle.pending) return view(saved);
  if (activeBattle(saved.battle.playback)) return { error: 'Finish the battle or retreat before returning to the map.', status: 409 };
  saved.battle.pending = false;
  return save(id, saved);
}

// Consumables live on the pet; abilities/coins live in inventory. The actions
// below commit those rows together with the opened chest or consumed action's
// new map revision.

// Giving up ends the run on the spot, like a defeat. It costs nothing: the
// cost and cooldown apply when the player starts the next adventure.
export function abandonAdventure(id: string, revision: unknown) {
  if (typeof revision !== 'string') return { error: 'Reload the map before abandoning it.', status: 400 };
  const saved = load(id);
  if (revision !== saved.revision || saved.battle?.pending || over(saved) || complete(saved)) return view(saved);
  saved.abandoned = true;
  return save(id, saved);
}

// Leaving retires only this pet. In a cooperative battle its teammates keep
// their saved turns, and a departed pet can never strand the turn order.
function endRun(saved: Progress) {
  if (saved.abandoned && !saved.battle?.pending) return view(saved);
  if (saved.battle && activeBattle(saved.battle.playback)) {
    const playback = forfeitBattle(saved.battle.playback, saved.id);
    if ('error' in playback) return playback;
    saved.abandoned = true; saved.battle.pending = false; saved.awaitingEntry = false;
    saveBattle(saved, battleParticipants(saved), playback);
    return adventureFor(saved.id);
  }
  const changed = Boolean(saved.battle?.pending) || (!over(saved) && !complete(saved));
  if (!saved.started || !changed) return view(saved);
  if (!over(saved) && !complete(saved)) saved.abandoned = true;
  if (saved.battle) saved.battle.pending = false;
  saved.awaitingEntry = false;
  return save(saved.id, saved);
}
export function leaveAdventure(id: string, revision: unknown) {
  if (typeof revision !== 'string') return { error: 'Reload the map before leaving.', status: 400 };
  const saved = load(id);
  if (revision !== saved.revision) return view(saved);
  return endRun(saved);
}

const restMinutes = (until: number, now: number) => Math.max(1, Math.ceil(((until - now) * TIME_SCALE) / 60_000));

function freshRun(saved: Progress, entryId: string) {
  const busy = busyRefusal(saved.id);
  if (busy) return busy;
  const now = Date.now();
  if (saved.started) {
    if (saved.cooldownUntil && saved.cooldownUntil > now) {
      return { error: `Your pet needs to rest before another adventure; it opens again in ${restMinutes(saved.cooldownUntil, now)} min.`, status: 429 };
    }
    const outcome = spendForAdventure(saved.id);
    if ('error' in outcome) return outcome;
    saved.cooldownUntil = now + realMs(ADVENTURE_COOLDOWN_MINUTES);
  }
  saved.world = createWorld(); saved.floor = 1; saved.x = 2; saved.y = 2; saved.teamId = null;
  saved.hp = saved.maxHp; saved.mp = saved.maxMp; saved.battle = null; saved.abandoned = false;
  saved.records = { total: 0, battles: [] }; saved.entryId = entryId; saved.awaitingEntry = false;
  return save(saved.id, saved);
}

// A scene opening is explicit, unlike polling or reading the town cooldown.
// A caller-stable ID makes retrying an accepted entry harmless. A fresh team
// set-off grants each member one entry without resetting its shared map.
export function enterAdventure(id: string, revision: unknown, entryId: unknown) {
  if (typeof revision !== 'string' || typeof entryId !== 'string' || !entryId.length || entryId.length > 100) {
    return { error: 'Choose a new adventure entry and reload the map before setting off.', status: 400 };
  }
  return transaction(() => {
    let saved = load(id);
    if (entryId === saved.entryId || revision !== saved.revision) return view(saved);
    if (saved.awaitingEntry && saved.teamId !== null && !over(saved) && !complete(saved)) {
      const busy = busyRefusal(id);
      if (busy) return busy;
      saved.entryId = entryId; saved.awaitingEntry = false;
      return save(id, saved);
    }
    // Keep this retirement even when a new entry is refused for rest or care:
    // reopening must never silently resume the old run.
    if (saved.started) { endRun(saved); saved = load(id); }
    return freshRun(saved, entryId);
  });
}

// Why a pet can't set off with its team right now, if it can't: the checks
// Start new adventure makes, worded for the Team up window.
export function setOffRefusal(id: string, now = Date.now()): string | undefined {
  const saved = load(id), pet = saved.pet;
  if (saved.battle?.pending) return 'has to return from its last battle first';
  const busy = busyNow(pet, now);
  if (busy) return pet.activity === 'studying' ? `is studying ${pet.task}` : pet.activity === 'working' ? `is working at the ${pet.task}` : 'is already in a battle';
  if (saved.started && !over(saved) && !complete(saved)) return 'has an adventure in progress; end it first';
  if (saved.cooldownUntil && saved.cooldownUntil > now) return `is resting; its next adventure opens in ${restMinutes(saved.cooldownUntil, now)} min`;
  if (pet.stamina < ADVENTURE_COST.stamina) return `is too tired; it needs ${ADVENTURE_COST.stamina} stamina`;
  if (pet.hygiene < ADVENTURE_COST.hygiene) return `is too dirty; it needs ${ADVENTURE_COST.hygiene} hygiene`;
  return undefined;
}

// Sets a team off together on a new shared map. Each member pays for a fresh
// adventure and opens its cooldown, as Start new adventure would. Runs in the
// caller's transaction, once setOffRefusal has cleared every member.
export function startTeamRun(teamId: number, ids: readonly string[]): void {
  const now = Date.now();
  db.prepare('UPDATE teams SET status = ?, world_json = ? WHERE id = ?').run('exploring', JSON.stringify(createWorld()), teamId);
  for (const id of ids) {
    const outcome = spendForAdventure(id);
    if ('error' in outcome) throw new Error(outcome.error);
    const { strength, intelligence, charisma } = outcome.pet;
    db.prepare(`UPDATE adventures SET x = ?, y = ?, floor = ?, world_json = NULL, battle_json = NULL, records_json = NULL,
        entry_id = NULL, awaiting_entry = 1, hp = ?, mp = ?, cooldown_until = ?,
        abandoned = 0, patrolled_at = NULL, team_id = ?, started = 1, revision = ? WHERE player_id = ?`)
      .run(2, 2, 1, maxHpFor({ strength, intelligence, charisma }), maxMpFor({ strength, intelligence, charisma }), now + realMs(ADVENTURE_COOLDOWN_MINUTES), teamId, randomUUID(), id);
  }
}

// What the Team up window needs to know about the pet's own run: whether
// it's a team's, and whether it's waiting to start, under way, or over.
export function runFor(id: string) {
  const saved = load(id);
  return {
    team: saved.teamId,
    state: !saved.started ? 'new' : over(saved) || complete(saved) ? 'ended' : 'exploring',
    awaitingEntry: saved.awaitingEntry,
  };
}

// Starting fresh — after winning, failing, or abandoning a run — costs
// stamina/hygiene and opens a cooldown, the same way a fight or a shift does.
// Kept for old clients; new scene openings use enterAdventure.
export function restartAdventure(id: string, revision: unknown) {
  if (typeof revision !== 'string') return { error: 'Reload the map before starting again.', status: 400 };
  return transaction(() => {
    const saved = load(id);
    if (revision !== saved.revision || saved.battle?.pending) return view(saved);
    const busy = busyRefusal(id);
    if (busy) return busy;
    if (!over(saved) && !complete(saved)) return { error: 'End this adventure before starting a new one.', status: 409 };
    return freshRun(saved, randomUUID());
  });
}

export function skipAdventureCooldown(id: string, revision: unknown) {
  if (typeof revision !== 'string') return { error: 'Reload the map before skipping the wait.', status: 400 };
  return transaction(() => {
    const saved = load(id);
    if (revision !== saved.revision) return view(saved);
    if (!saved.cooldownUntil || saved.cooldownUntil <= Date.now()) return view(saved);
    const outcome = consumeHourglass(id);
    if ('error' in outcome) return outcome;
    saved.cooldownUntil = null;
    return save(id, saved);
  });
}

export function openAdventureChest(id: string, revision: unknown) {
  if (typeof revision !== 'string') return { error: 'Reload the map before opening a chest.', status: 400 };
  return transaction(() => {
    const saved = load(id);
    if (revision !== saved.revision || saved.battle?.pending || over(saved) || complete(saved)) return view(saved);
    const chest = saved.world[saved.floor - 1].chests.find(c => samePoint(c, saved));
    if (!chest) return { error: 'Stand on a treasure chest first.', status: 409 };
    if (chest.reward) return view(saved);
    const busy = busyRefusal(id);
    if (busy) return busy;
    // Each chest holds one reward per run, so on a team's map it goes to whoever opens it first.
    chest.reward = grantTreasure(id, rollTreasure(Math.random, saved.floor));
    if (saved.teamId !== null) chest.openedBy = id;
    return save(id, saved);
  });
}

export function useAdventureItem(id: string, itemId: unknown, revision: unknown) {
  const item = typeof itemId === 'string' ? findItem(itemId) : undefined;
  if (!item || typeof revision !== 'string') return { error: 'Choose a food, soap, or hourglass from your backpack.', status: 400 };
  return transaction(() => {
    const saved = load(id);
    if (revision !== saved.revision || saved.battle?.pending) return view(saved);
    const outcome = use(id, item.id);
    if ('error' in outcome) return outcome;
    return save(id, saved);
  });
}
