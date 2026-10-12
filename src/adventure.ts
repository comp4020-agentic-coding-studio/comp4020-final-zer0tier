import { randomUUID } from 'node:crypto';
import { db } from './db.ts';
import { ABILITIES, coinEffect, simulateBattle, withAttributeBonus, type Battle } from './combat.ts';
import {
  ADVENTURE_COOLDOWN_MINUTES, ADVENTURE_COST, consumeHourglass, findItem, getPet, ITEMS, LUCK, MAX_CARE,
  powerOf, spendForAdventure, use, type Pet,
} from './pets.ts';
import { grantTreasure } from './inventory.ts';
import { COINS, rollTreasure } from './treasure.ts';
import { advanceEnemies, createWorld, directions, FLOOR_COUNT, nearby, samePoint, SIZE, walkable, type Enemy, type Floor, type Point } from './adventure-world.ts';
import { realMs, TIME_SCALE } from './clock.ts';

export type AdventureBattle = {
  id: string; floor: number; enemyId: string; enemyName: string;
  won: boolean; pending: boolean; playback: Battle;
  recovery: { hp: number; mp: number };
  after?: { hp: number; mp: number }; // what the pet carries back to the map; absent in older saves
};
type SavedAdventure = {
  x: number; y: number; floor: number; world_json: string | null;
  revision: string | null; battle_json: string | null;
  hp: number | null; mp: number | null; cooldown_until: number | null;
};
type Progress = {
  x: number; y: number; floor: number; world: Floor[];
  revision: string; battle: AdventureBattle | null;
  hp: number; mp: number; maxHp: number; maxMp: number;
  cooldownUntil: number | null;
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
  const saved = db.prepare('SELECT x, y, floor, world_json, revision, battle_json, hp, mp, cooldown_until FROM adventures WHERE player_id = ?').get(id) as SavedAdventure;
  const pet = getPet(id)!;
  const maxHp = pet.strength + pet.intelligence + pet.charisma, maxMp = pet.intelligence;
  const hp = Math.min(saved.hp ?? maxHp, maxHp), mp = Math.min(saved.mp ?? maxMp, maxMp);
  const world: Floor[] = saved.world_json ? JSON.parse(saved.world_json) : createWorld();
  const revision = saved.revision ?? randomUUID();
  if (!saved.world_json || !saved.revision || saved.hp === null || saved.mp === null) {
    vacatePlayerTile(world[saved.floor - 1], saved);
    db.prepare('UPDATE adventures SET world_json = ?, revision = ?, hp = ?, mp = ? WHERE player_id = ?').run(JSON.stringify(world), revision, hp, mp, id);
  }
  return { x: saved.x, y: saved.y, floor: saved.floor, world, revision, hp, mp, maxHp, maxMp,
    cooldownUntil: saved.cooldown_until,
    inventory: inventoryView(pet),
    battle: saved.battle_json ? JSON.parse(saved.battle_json) as AdventureBattle : null };
}

function view(saved: Progress) {
  const floor = saved.world[saved.floor - 1];
  return {
    x: saved.x, y: saved.y, floor: saved.floor, floorCount: FLOOR_COUNT, size: SIZE,
    name: floor.name, tiles: floor.tiles, enemies: floor.enemies, chests: floor.chests,
    up: floor.up, down: floor.down, revision: saved.revision, battle: saved.battle,
    inventory: saved.inventory,
    hp: saved.hp, mp: saved.mp, maxHp: saved.maxHp, maxMp: saved.maxMp, failed: saved.hp === 0,
    completed: saved.hp > 0 && !saved.world[FLOOR_COUNT - 1].enemies.some(e => e.kind === 'slime-king'),
    encounters: floor.enemies.filter(e => nearby(e, saved)).map(e => e.id),
    cooldownUntil: saved.cooldownUntil, timeScale: TIME_SCALE,
    restartCost: ADVENTURE_COST, cooldownMinutes: ADVENTURE_COOLDOWN_MINUTES,
  };
}
export function adventureFor(id: string) { return view(load(id)); }

// Position, removed monsters, and the exact playback are one atomic write.
// A stale retry (even after Continue) cannot apply the same movement twice.
function save(id: string, saved: Progress) {
  db.prepare('UPDATE adventures SET x = ?, y = ?, floor = ?, world_json = ?, battle_json = ?, hp = ?, mp = ?, cooldown_until = ?, revision = ? WHERE player_id = ? AND revision = ?')
    .run(saved.x, saved.y, saved.floor, JSON.stringify(saved.world), saved.battle ? JSON.stringify(saved.battle) : null, saved.hp, saved.mp, saved.cooldownUntil, randomUUID(), id, saved.revision);
  return adventureFor(id);
}

function resolveBattle(id: string, saved: Progress, enemy: Enemy) {
  const pet = getPet(id);
  if (!pet) return { error: 'Your pet could not be found.', status: 404 };
  const monster = { ...enemy, id: `monster:${enemy.id}`, monster: enemy.kind,
    color: { slime: '#0891b2', goblin: '#15803d', 'slime-king': '#c026d3' }[enemy.kind] };
  const roll = (stats: Parameters<typeof powerOf>[0]) => powerOf(stats) * (LUCK.min + Math.random() * (LUCK.max - LUCK.min));
  // Only the pet's own equipped coin applies; monsters never carry coins.
  const coin = coinEffect(pet.equippedCoin);
  const boostedPet = withAttributeBonus(pet, coin.attributeBonus);
  // Copper's extra HP/MP sit on top of what the pet carries in, as a shield.
  const shieldHp = boostedPet.strength + boostedPet.intelligence + boostedPet.charisma - saved.maxHp;
  const shieldMp = boostedPet.intelligence - saved.maxMp;
  const playback = simulateBattle(boostedPet, monster, [roll(boostedPet), roll(monster)], {
    hp: [saved.hp + shieldHp, monster.strength + monster.intelligence + monster.charisma],
    mp: [saved.mp + shieldMp, monster.intelligence],
    first: coin.first, doubleFirstStrike: coin.doubleFirstStrike,
  });
  const won = playback.winner === pet.id;
  const floor = saved.world[saved.floor - 1];
  const last = playback.turns.at(-1)!;
  // Damage spends the shield first; whatever is left of it disappears, so a
  // fight never leaves the pet with more HP/MP than it brought.
  saved.hp = Math.min(last.hp[0], saved.hp); saved.mp = Math.min(last.mp[0], saved.mp);
  const recovery = {
    hp: won ? Math.min(Math.ceil(saved.maxHp * 0.2), saved.maxHp - saved.hp) : 0,
    mp: won ? Math.min(Math.ceil(saved.maxMp * 0.2), saved.maxMp - saved.mp) : 0,
  };
  saved.hp += recovery.hp; saved.mp += recovery.mp;
  saved.battle = {
    id: randomUUID(), floor: saved.floor, enemyId: enemy.id, enemyName: enemy.name, won, pending: true, playback, recovery,
    after: { hp: saved.hp, mp: saved.mp },
  };
  if (won) {
    floor.enemies = floor.enemies.filter(e => e.id !== enemy.id);
    saved.x = enemy.x; saved.y = enemy.y;
  }
  for (const other of floor.enemies) other.alerted = nearby(other, saved);
  return save(id, saved);
}

export function moveAdventure(id: string, direction: unknown, revision?: unknown) {
  if (typeof direction !== 'string' || !Object.hasOwn(directions, direction)) {
    return { error: 'Choose W, A, S, or D.', status: 400 };
  }
  if (typeof revision !== 'string') return { error: 'Reload the map before moving.', status: 400 };
  const saved = load(id), floor = saved.world[saved.floor - 1];
  if (revision !== saved.revision || saved.battle?.pending || saved.hp === 0) return view(saved);
  const [dx, dy] = directions[direction as keyof typeof directions];
  const player = { x: saved.x + dx, y: saved.y + dy };
  if (!walkable(floor, player)) return { error: 'A tree blocks that path.', status: 409 };
  const enemy = floor.enemies.find(e => samePoint(e, player));
  if (enemy) return resolveBattle(id, saved, enemy);
  advanceEnemies(floor, player);
  saved.x = player.x; saved.y = player.y;
  return save(id, saved);
}

export function changeFloor(id: string, action: unknown, revision?: unknown) {
  if (action !== 'ascend' && action !== 'descend') return { error: 'Choose ascend or descend.', status: 400 };
  if (typeof revision !== 'string') return { error: 'Reload the map before using the stairs.', status: 400 };
  const saved = load(id), floor = saved.world[saved.floor - 1];
  if (revision !== saved.revision || saved.battle?.pending || saved.hp === 0) return view(saved);
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

// Consumables live on the pet; abilities/coins live in inventory. Commit those
// rows together with the opened chest or consumed action's new map revision.
function transaction<T>(action: () => T): T {
  db.prepare('BEGIN IMMEDIATE').run();
  try {
    const result = action();
    db.prepare('COMMIT').run();
    return result;
  } catch (error) {
    db.prepare('ROLLBACK').run();
    throw error;
  }
}

// Starting fresh — after winning, failing, or abandoning a run in progress —
// costs stamina/hygiene and opens a cooldown, the same way a fight or a shift
// does. Resuming an unfinished run (just reopening the map) stays free.
export function restartAdventure(id: string, revision: unknown) {
  if (typeof revision !== 'string') return { error: 'Reload the map before starting again.', status: 400 };
  return transaction(() => {
    const saved = load(id);
    if (revision !== saved.revision || saved.battle?.pending) return view(saved);
    const now = Date.now();
    if (saved.cooldownUntil && saved.cooldownUntil > now) {
      const minutes = Math.max(1, Math.ceil(((saved.cooldownUntil - now) * TIME_SCALE) / 60_000));
      return { error: `Your pet needs to rest before another adventure; it opens again in ${minutes} min.`, status: 429 };
    }
    const outcome = spendForAdventure(id);
    if ('error' in outcome) return outcome;
    saved.world = createWorld(); saved.floor = 1; saved.x = 2; saved.y = 2;
    saved.hp = saved.maxHp; saved.mp = saved.maxMp; saved.battle = null;
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
    if (revision !== saved.revision || saved.battle?.pending || saved.hp === 0) return view(saved);
    const chest = saved.world[saved.floor - 1].chests.find(c => samePoint(c, saved));
    if (!chest) return { error: 'Stand on a treasure chest first.', status: 409 };
    if (chest.reward) return view(saved);
    chest.reward = grantTreasure(id, rollTreasure());
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
