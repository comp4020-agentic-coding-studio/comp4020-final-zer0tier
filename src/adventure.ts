import { randomUUID } from 'node:crypto';
import { db, transaction } from './db.ts';
import { ABILITIES, coinEffect, MONSTER_ABILITIES, simulateBattle, simulateTeamBattle, withAttributeBonus, type Battle } from './combat.ts';
import {
  ADVENTURE_COOLDOWN_MINUTES, ADVENTURE_COST, busyNow, consumeHourglass, findItem, getPet, ITEMS, LUCK, MAX_CARE,
  powerOf, spendForAdventure, use, type Pet,
} from './pets.ts';
import { grantTreasure } from './inventory.ts';
import { COINS, rollTreasure } from './treasure.ts';
import {
  createWorld, directions, FLOOR_COUNT, MONSTER_MOVES, nearby, patrol, samePoint, sees, SIZE, walkable, type Enemy, type Floor, type Point,
} from './adventure-world.ts';
import { realMs, TIME_SCALE } from './clock.ts';

export type AdventureBattle = {
  id: string; floor: number; enemyId: string; enemyName: string;
  won: boolean; pending: boolean; playback: Battle;
  recovery: { hp: number; mp: number };
  after?: { hp: number; mp: number }; // what the pet carries back to the map; absent in older saves
  fighter?: number; // this pet's place in a team battle's playback; absent means the first
  attacked?: true; // the monster walked into the pet, rather than the pet into it
};
type SavedAdventure = {
  x: number; y: number; floor: number; world_json: string | null;
  revision: string | null; battle_json: string | null;
  hp: number | null; mp: number | null; cooldown_until: number | null; abandoned: number; patrolled_at: number | null;
  team_id: number | null; team_world: string | null; started: number;
};
type Progress = {
  id: string; pet: Pet;
  x: number; y: number; floor: number; world: Floor[];
  revision: string; battle: AdventureBattle | null;
  hp: number; mp: number; maxHp: number; maxMp: number;
  cooldownUntil: number | null; abandoned: boolean; patrolledAt: number;
  teamId: number | null; // a team run shares its team's map; a solo run keeps its own
  started: boolean; // false until the pet first acts on the map, or sets off with a team
  inventory: ReturnType<typeof inventoryView>;
};

function inventoryView(pet: Pet) {
  return {
    items: ITEMS.map(item => ({ ...item, quantity: pet[item.id],
      usable: pet[item.id] > 0 && (item.effect === 'skip' ? pet.activity !== 'idle' : pet[item.restores] < MAX_CARE),
    })),
    abilities: ABILITIES.map(a => ({ ...a, learned: pet.abilities.includes(a.id) })),
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
      a.patrolled_at, a.team_id, t.world_json AS team_world, a.started
    FROM adventures a LEFT JOIN teams t ON t.id = a.team_id WHERE a.player_id = ?`).get(id) as SavedAdventure;
  const pet = getPet(id)!;
  const maxHp = pet.strength + pet.intelligence + pet.charisma, maxMp = pet.intelligence;
  const hp = Math.min(saved.hp ?? maxHp, maxHp), mp = Math.min(saved.mp ?? maxMp, maxMp);
  const team = saved.team_id !== null;
  const world: Floor[] = team ? JSON.parse(saved.team_world!) : saved.world_json ? JSON.parse(saved.world_json) : createWorld();
  // Maps saved before monsters patrolled give each one its route from a fresh map.
  if (world.some(floor => floor.enemies.some(e => !e.route))) {
    const fresh = createWorld();
    for (const floor of world) for (const enemy of floor.enemies) {
      enemy.route ??= fresh[floor.number - 1].enemies.find(e => e.id === enemy.id)?.route ?? [{ x: enemy.x, y: enemy.y }, { x: enemy.x, y: enemy.y }];
      enemy.leg ??= 1;
    }
  }
  const revision = saved.revision ?? randomUUID();
  // Setting off with a team saves every member's run in full.
  if (!team && (!saved.world_json || !saved.revision || saved.hp === null || saved.mp === null)) {
    vacatePlayerTile(world[saved.floor - 1], saved);
    db.prepare('UPDATE adventures SET world_json = ?, revision = ?, hp = ?, mp = ? WHERE player_id = ?').run(JSON.stringify(world), revision, hp, mp, id);
  }
  return { id, pet, x: saved.x, y: saved.y, floor: saved.floor, world, revision, hp, mp, maxHp, maxMp,
    cooldownUntil: saved.cooldown_until, abandoned: saved.abandoned === 1, patrolledAt: saved.patrolled_at ?? 0,
    teamId: saved.team_id, started: saved.started === 1, inventory: inventoryView(pet),
    battle: saved.battle_json ? JSON.parse(saved.battle_json) as AdventureBattle : null };
}

// A run is over once the pet is defeated or the player abandons it. It is
// complete, but still explorable, once the Slime King falls.
const over = (saved: Progress) => saved.hp === 0 || saved.abandoned;
const complete = (saved: Progress) => !over(saved) && !saved.world[FLOOR_COUNT - 1].enemies.some(e => e.kind === 'slime-king');

// The rest of a team run's members, each with their own saved run on the shared map.
function teammates(saved: Progress): Progress[] {
  if (saved.teamId === null) return [];
  return (db.prepare('SELECT player_id FROM adventures WHERE team_id = ? AND player_id <> ? ORDER BY player_id')
    .all(saved.teamId, saved.id) as { player_id: string }[]).map(row => load(row.player_id));
}
// Teammates still exploring on the pet's floor: monsters see and chase them too.
const floormates = (saved: Progress) => teammates(saved).filter(mate => mate.floor === saved.floor && !over(mate));

function view(saved: Progress) {
  const floor = saved.world[saved.floor - 1];
  return {
    x: saved.x, y: saved.y, floor: saved.floor, floorCount: FLOOR_COUNT, size: SIZE,
    name: floor.name, tiles: floor.tiles, chests: floor.chests,
    // `alerted`: the monster sees the pet and is walking toward it.
    enemies: floor.enemies.map(e => ({ ...e, alerted: sees(e, saved), moves: MONSTER_ABILITIES.filter(a => MONSTER_MOVES[e.kind].includes(a.id)) })),
    up: floor.up, down: floor.down, revision: saved.revision, battle: saved.battle,
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
    encounters: floor.enemies.filter(e => nearby(e, saved)).map(e => e.id),
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
function save(id: string, saved: Progress) {
  transaction(() => {
    const written = db.prepare('UPDATE adventures SET x = ?, y = ?, floor = ?, world_json = ?, battle_json = ?, hp = ?, mp = ?, cooldown_until = ?, abandoned = ?, team_id = ?, started = 1, revision = ? WHERE player_id = ? AND revision = ?')
      .run(saved.x, saved.y, saved.floor, saved.teamId === null ? JSON.stringify(saved.world) : null, saved.battle ? JSON.stringify(saved.battle) : null,
        saved.hp, saved.mp, saved.cooldownUntil, Number(saved.abandoned), saved.teamId, randomUUID(), id, saved.revision);
    if (written.changes === 1 && saved.teamId !== null) {
      db.prepare('UPDATE teams SET world_json = ? WHERE id = ?').run(JSON.stringify(saved.world), saved.teamId);
    }
  });
  return adventureFor(id);
}

// Teammates beside the pet join its battle, unless they're out, already in
// one, or busy studying or working.
function alliesOf(saved: Progress): Progress[] {
  return floormates(saved).filter(mate => nearby(mate, saved) && !mate.battle?.pending && !busyNow(mate.pet));
}

// `attacked`: the monster walked into the pet, so a win leaves the pet where
// it stands rather than moving it onto the monster's tile.
function resolveBattle(id: string, saved: Progress, enemy: Enemy, attacked = false) {
  const pet = getPet(id);
  if (!pet) return { error: 'Your pet could not be found.', status: 404 };
  const allies = alliesOf(saved);
  const monster = { ...enemy, id: `monster:${enemy.id}`, monster: enemy.kind, abilities: MONSTER_MOVES[enemy.kind],
    color: { slime: '#0891b2', goblin: '#15803d', 'slime-king': '#c026d3' }[enemy.kind] };
  const roll = (stats: Parameters<typeof powerOf>[0]) => powerOf(stats) * (LUCK.min + Math.random() * (LUCK.max - LUCK.min));
  // Only the pet's own equipped coin applies, even when teammates join in;
  // monsters never carry coins.
  const coin = coinEffect(pet.equippedCoin);
  const boostedPet = withAttributeBonus(pet, coin.attributeBonus);
  // Copper's extra HP/MP sit on top of what the pet carries in, as a shield.
  const shieldHp = boostedPet.strength + boostedPet.intelligence + boostedPet.charisma - saved.maxHp;
  const shieldMp = boostedPet.intelligence - saved.maxMp;
  const monsterHp = monster.strength + monster.intelligence + monster.charisma;
  const playback = allies.length === 0
    ? simulateBattle(boostedPet, monster, [roll(boostedPet), roll(monster)], {
      hp: [saved.hp + shieldHp, monsterHp], mp: [saved.mp + shieldMp, monster.intelligence], ...coin,
    })
    : simulateTeamBattle([boostedPet, ...allies.map(ally => ally.pet)], monster,
      [roll(boostedPet), ...allies.map(ally => roll(ally.pet)), roll(monster)], {
        hp: [saved.hp + shieldHp, ...allies.map(ally => ally.hp), monsterHp],
        mp: [saved.mp + shieldMp, ...allies.map(ally => ally.mp), monster.intelligence], ...coin,
      });
  const won = playback.winner !== monster.id;
  const floor = saved.world[saved.floor - 1];
  const last = playback.turns.at(-1)!;
  const battleId = randomUUID();
  // Each fighter keeps what it has left. Damage spends a Copper shield first;
  // whatever is left of it disappears, so a fight never leaves the pet with
  // more HP/MP than it brought. A pet knocked out is out even if its team
  // wins; the rest recover after a victory.
  [saved, ...allies].forEach((fighter, index) => {
    fighter.hp = Math.min(last.hp[index], fighter.hp); fighter.mp = Math.min(last.mp[index], fighter.mp);
    const standing = won && fighter.hp > 0;
    const recovery = {
      hp: standing ? Math.min(Math.ceil(fighter.maxHp * 0.2), fighter.maxHp - fighter.hp) : 0,
      mp: standing ? Math.min(Math.ceil(fighter.maxMp * 0.2), fighter.maxMp - fighter.mp) : 0,
    };
    fighter.hp += recovery.hp; fighter.mp += recovery.mp;
    fighter.battle = {
      id: battleId, floor: saved.floor, enemyId: enemy.id, enemyName: enemy.name, won, pending: true, playback, recovery,
      after: { hp: fighter.hp, mp: fighter.mp }, ...(index ? { fighter: index } : {}), ...(attacked ? { attacked: true as const } : {}),
    };
  });
  if (won) {
    floor.enemies = floor.enemies.filter(e => e.id !== enemy.id);
    if (saved.hp > 0 && !attacked) { saved.x = enemy.x; saved.y = enemy.y; }
  }
  return transaction(() => {
    for (const ally of allies) {
      db.prepare('UPDATE adventures SET hp = ?, mp = ?, battle_json = ?, revision = ? WHERE player_id = ? AND revision = ?')
        .run(ally.hp, ally.mp, JSON.stringify(ally.battle), randomUUID(), ally.id, ally.revision);
    }
    return save(id, saved);
  });
}

export function moveAdventure(id: string, direction: unknown, revision?: unknown) {
  if (typeof direction !== 'string' || !Object.hasOwn(directions, direction)) {
    return { error: 'Choose W, A, S, or D.', status: 400 };
  }
  if (typeof revision !== 'string') return { error: 'Reload the map before moving.', status: 400 };
  const saved = load(id), floor = saved.world[saved.floor - 1];
  if (revision !== saved.revision || saved.battle?.pending || over(saved)) return view(saved);
  const busy = busyRefusal(id);
  if (busy) return busy;
  const [dx, dy] = directions[direction as keyof typeof directions];
  const player = { x: saved.x + dx, y: saved.y + dy };
  if (!walkable(floor, player)) return { error: 'A tree blocks that path.', status: 409 };
  const enemy = floor.enemies.find(e => samePoint(e, player));
  if (enemy) return resolveBattle(id, saved, enemy);
  saved.x = player.x; saved.y = player.y;
  return save(id, saved);
}

// Monsters move in real time, but only while their owner has the map open:
// the page asks for a step every PATROL_MS, and the server takes one at most
// that often (less a little slack for timer jitter), however many windows ask.
// A step keeps the revision, so a move sent at the same moment still applies,
// to the monsters' new positions. Nothing moves during a battle, after the run
// ends, or while the pet studies or works. On a team's map each floor steps on
// its own clock, for any teammate there who asks, and its monsters chase
// whichever teammate is nearest.
// A monster already beside the pet it's chasing walks into it instead, which
// starts a battle as if the pet had walked into the monster; that battle
// changes the revision. A pet that's busy, out, or already has a battle
// waiting isn't attacked: the monster waits beside it.
export const PATROL_MS = 1000;
export function patrolAdventure(id: string) {
  const saved = load(id), now = Date.now(), floor = saved.world[saved.floor - 1];
  const last = saved.teamId === null ? saved.patrolledAt : floor.patrolledAt ?? 0;
  if (saved.battle?.pending || over(saved) || busyNow(saved.pet) || now - last < PATROL_MS * 0.8) return view(saved);
  return transaction(() => {
    let attacks;
    if (saved.teamId === null) {
      attacks = patrol(floor, saved);
      db.prepare('UPDATE adventures SET world_json = ?, patrolled_at = ? WHERE player_id = ? AND revision = ?')
        .run(JSON.stringify(saved.world), now, id, saved.revision);
    } else {
      attacks = patrol(floor, [saved, ...floormates(saved)]);
      floor.patrolledAt = now;
      db.prepare('UPDATE teams SET world_json = ? WHERE id = ?').run(JSON.stringify(saved.world), saved.teamId);
    }
    // Each battle reads the map as the one before it left it: a teammate
    // drawn into an earlier battle, or a monster it removed, is skipped, and
    // so is any attack the saved map no longer matches.
    for (const attack of attacks) {
      const victim = load(attack.pet.id), enemy = victim.world[victim.floor - 1].enemies.find(e => e.id === attack.enemy.id);
      if (!enemy || !samePoint(enemy, attack.enemy) || !samePoint(victim, attack.pet) || victim.floor !== saved.floor
        || victim.battle?.pending || over(victim) || busyNow(victim.pet)) continue;
      resolveBattle(victim.id, victim, enemy, true);
    }
    return adventureFor(id);
  });
}

export function changeFloor(id: string, action: unknown, revision?: unknown) {
  if (action !== 'ascend' && action !== 'descend') return { error: 'Choose ascend or descend.', status: 400 };
  if (typeof revision !== 'string') return { error: 'Reload the map before using the stairs.', status: 400 };
  const saved = load(id), floor = saved.world[saved.floor - 1];
  if (revision !== saved.revision || saved.battle?.pending || over(saved)) return view(saved);
  const busy = busyRefusal(id);
  if (busy) return busy;
  const stair = action === 'descend' ? floor.down : floor.up;
  if (!stair || !samePoint(saved, stair)) return { error: 'Stand on the matching stairs first.', status: 409 };
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

const restMinutes = (until: number, now: number) => Math.max(1, Math.ceil(((until - now) * TIME_SCALE) / 60_000));

// Why a pet can't set off with its team right now, if it can't: the checks
// Start new adventure makes, worded for the Team up window.
export function setOffRefusal(id: string, now = Date.now()): string | undefined {
  const saved = load(id), pet = saved.pet;
  if (saved.battle?.pending) return 'has to return from its last battle first';
  if (busyNow(pet, now)) return pet.activity === 'studying' ? `is studying ${pet.task}` : `is working at the ${pet.task}`;
  if (saved.started && !over(saved) && !complete(saved)) return 'has an adventure in progress; abandon it first';
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
    db.prepare(`UPDATE adventures SET x = ?, y = ?, floor = ?, world_json = NULL, battle_json = NULL, hp = ?, mp = ?, cooldown_until = ?,
        abandoned = 0, patrolled_at = NULL, team_id = ?, started = 1, revision = ? WHERE player_id = ?`)
      .run(2, 2, 1, strength + intelligence + charisma, intelligence, now + realMs(ADVENTURE_COOLDOWN_MINUTES), teamId, randomUUID(), id);
  }
}

// What the Team up window needs to know about the pet's own run: whether
// it's a team's, and whether it's waiting to start, under way, or over.
export function runFor(id: string) {
  const saved = load(id);
  return {
    team: saved.teamId,
    state: !saved.started ? 'new' : over(saved) || complete(saved) ? 'ended' : 'exploring',
  };
}

// Starting fresh — after winning, failing, or abandoning a run — costs
// stamina/hygiene and opens a cooldown, the same way a fight or a shift does.
// Resuming an unfinished run (just reopening the map) stays free.
export function restartAdventure(id: string, revision: unknown) {
  if (typeof revision !== 'string') return { error: 'Reload the map before starting again.', status: 400 };
  return transaction(() => {
    const saved = load(id);
    if (revision !== saved.revision || saved.battle?.pending) return view(saved);
    const busy = busyRefusal(id);
    if (busy) return busy;
    if (!over(saved) && !complete(saved)) return { error: 'Abandon this adventure before starting a new one.', status: 409 };
    const now = Date.now();
    if (saved.cooldownUntil && saved.cooldownUntil > now) {
      return { error: `Your pet needs to rest before another adventure; it opens again in ${restMinutes(saved.cooldownUntil, now)} min.`, status: 429 };
    }
    const outcome = spendForAdventure(id);
    if ('error' in outcome) return outcome;
    // A fresh start is always a solo run; teams set off from the Team up window.
    saved.world = createWorld(); saved.floor = 1; saved.x = 2; saved.y = 2; saved.teamId = null;
    saved.hp = saved.maxHp; saved.mp = saved.maxMp; saved.battle = null; saved.abandoned = false;
    saved.cooldownUntil = now + realMs(ADVENTURE_COOLDOWN_MINUTES);
    return save(id, saved);
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
    if (revision !== saved.revision || saved.battle?.pending || over(saved)) return view(saved);
    const chest = saved.world[saved.floor - 1].chests.find(c => samePoint(c, saved));
    if (!chest) return { error: 'Stand on a treasure chest first.', status: 409 };
    if (chest.reward) return view(saved);
    const busy = busyRefusal(id);
    if (busy) return busy;
    // Each chest holds one reward per run, so on a team's map it goes to whoever opens it first.
    chest.reward = grantTreasure(id, rollTreasure());
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
