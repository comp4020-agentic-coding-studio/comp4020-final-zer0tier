import type { CoinId } from './treasure.ts';
// Monsters have a type and pets don't, so Arena and revenge stay neutral: a
// typed skill only hits harder or softer against a monster.
export const ELEMENTS = ['normal', 'fire', 'water', 'grass', 'earth'] as const;
export type Element = (typeof ELEMENTS)[number];
export const MONSTER_TYPES = { slime: 'grass', goblin: 'earth', 'slime-king': 'water' } as const satisfies Record<string, Element>;
export type MonsterKind = keyof typeof MONSTER_TYPES;
// Fire beats Grass, Water beats Earth and Grass beats Water. Each of those
// is halved against the other monster types; Normal skills always hit ×1.
export const TYPE_CHART: Record<Element, Partial<Record<Element, number>>> = {
  normal: {}, earth: {},
  fire: { grass: 2, water: 0.5, earth: 0.5 },
  water: { earth: 2, grass: 0.5, water: 0.5 },
  grass: { water: 2, grass: 0.5, earth: 0.5 },
};
export const effectiveness = (move: Element, target: Element | undefined): number =>
  target ? TYPE_CHART[move][target] ?? 1 : 1;
export const weaknessOf = (type: Element): Element[] => ELEMENTS.filter(move => effectiveness(move, type) > 1);
// A saved, server-resolved battle. HP/MP belong to this fight, not daily care.
// Each elemental skill deals one attribute × 1.5 × battle luck for 3 MP.
export const ABILITIES = [
  { id: 'claw-strike', name: 'Claw Strike', type: 'normal', mpCost: 0, description: 'A free Strength-based attack.' },
  { id: 'firebolt', name: 'Firebolt', type: 'fire', mpCost: 3, description: 'Intelligence × 1.5, adjusted by battle luck and rounded.' },
  { id: 'heavy-strike', name: 'Heavy Strike', type: 'normal', mpCost: 2, description: 'Claw Strike damage × 1.5, rounded up.' },
  { id: 'tide-crash', name: 'Tide Crash', type: 'water', mpCost: 3, description: 'Strength × 1.5, adjusted by battle luck and rounded.' },
  { id: 'vine-lash', name: 'Vine Lash', type: 'grass', mpCost: 3, description: 'Charisma × 1.5, adjusted by battle luck and rounded.' },
] as const;
// Chests teach every pet skill except the always-ready Claw Strike.
export const LEARNABLE_ABILITIES = ABILITIES.filter(
  (ability): ability is Exclude<(typeof ABILITIES)[number], { id: 'claw-strike' }> => ability.id !== 'claw-strike');
export type LearnableAbilityId = (typeof LEARNABLE_ABILITIES)[number]['id'];
// Monster-only moves: chests never teach these to pets.
export const MONSTER_ABILITIES = [
  { id: 'bump', name: 'Bump', type: 'normal', mpCost: 5, description: 'Two-thirds of the target’s current HP, rounded up.' },
] as const;
const ALL_ABILITIES = [...ABILITIES, ...MONSTER_ABILITIES];
export type AbilityId = (typeof ALL_ABILITIES)[number]['id'];
export type MonsterAbilityId = (typeof MONSTER_ABILITIES)[number]['id'];
// Battles saved before types lack each attack's type, so look it up by skill.
const typeOf = (id: AbilityId): Element => ALL_ABILITIES.find(ability => ability.id === id)?.type ?? 'normal';
// ×2 is exact and ×½ rounds up, so a typed hit always does at least 1 damage.
const typed = (damage: number, move: Element, target: Element | undefined) =>
  Math.ceil(damage * effectiveness(move, target));
export interface PetStats {
  id: string; strength: number; intelligence: number; charisma: number;
  color?: string; appearance?: string;
  name?: string; monster?: MonsterKind;
  abilities?: readonly AbilityId[];
  equippedCoin?: CoinId | null;
  equippedAbilities?: readonly AbilityId[];
}
export interface Fighter {
  id: string; maxHp: number; maxMp: number; damage: number;
  color: string; appearance: string; abilities: string[];
  name?: string; monster?: MonsterKind;
  type?: Element; // monsters only; absent in older saved replays
}
// Indices into the battle's fighters. A one-on-one battle has two; a team's
// Adventure battle lists its pets first and the monster last.
export interface BattleTurn {
  actor: number; target: number; ability: AbilityId;
  name?: string; mpCost?: number; // absent in older saved replays
  type?: Element; effectiveness?: number; // absent in older saved replays
  damage: number; hits: number; hp: number[]; mp: number[];
}
// How the turn order was decided, saved so every replay can show it. `toss`
// is null when the acting pet's Silver or Gold Coin fixed the order instead.
export interface Initiative {
  toss: 'heads' | 'tails' | null; coin: CoinId | null;
  provider?: number; providerId?: string;
}
export interface Battle {
  fighters: Fighter[]; turns: BattleTurn[]; winner: string;
  initialHp?: number[]; initialMp?: number[]; // absent in older saved replays
  initiative?: Initiative; // absent in older saved replays
}
// This effect is relative to the pet supplying the coin: heads/Silver put its
// side first, while tails/Gold put the opposing side first.
export interface CoinEffect extends Initiative { first: 0 | 1; doubleFirstStrike: boolean; attributeBonus: number }
export function coinEffect(coin: CoinId | null | undefined, random = Math.random): CoinEffect {
  if (coin === 'silver-coin') return { first: 0, doubleFirstStrike: false, attributeBonus: 0, toss: null, coin };
  if (coin === 'gold-coin') return { first: 1, doubleFirstStrike: true, attributeBonus: 0, toss: null, coin };
  const first = random() < 0.5 ? 0 : 1;
  return {
    first, doubleFirstStrike: false, attributeBonus: coin === 'copper-coin' ? 1 : 0,
    toss: first === 0 ? 'heads' : 'tails', coin: coin ?? null,
  };
}
// Copper's +1/attribute (and the HP/MP it implies) only ever applies for this
// fight's calculations; nothing is written back to the pet.
export function withAttributeBonus(pet: PetStats, bonus: number): PetStats {
  if (!bonus) return pet;
  return { ...pet, strength: pet.strength + bonus, intelligence: pet.intelligence + bonus, charisma: pet.charisma + bonus };
}
function fighterOf(pet: PetStats, roll: number): Fighter {
  return {
    id: pet.id,
    ...(pet.name ? { name: pet.name } : {}),
    ...(pet.monster ? { monster: pet.monster, type: MONSTER_TYPES[pet.monster] } : {}),
    maxHp: pet.strength + pet.intelligence + pet.charisma,
    maxMp: pet.intelligence,
    damage: Math.max(1, Math.round(pet.strength * roll / (2 * pet.strength + pet.intelligence + pet.charisma))),
    color: pet.color ?? "#f59e0b", appearance: pet.appearance ?? "blob",
    abilities: ALL_ABILITIES.filter(ability => ability.id === 'claw-strike' || pet.abilities?.includes(ability.id)).map(ability => ability.id),
  };
}
// Fixed per-hit damage before type effectiveness; Bump's depends on the
// target's HP, so each battle works it out per strike.
function attacksOf(pet: PetStats, fighter: Fighter, roll: number) {
  // An attribute × 1.5 × luck, at the same scale as Claw Strike's Strength.
  const scaled = (attribute: number) =>
    Math.max(1, Math.round(1.5 * attribute * roll / (2 * pet.strength + pet.intelligence + pet.charisma)));
  return ALL_ABILITIES.filter(ability => fighter.abilities.includes(ability.id)).map(ability => ({
    ...ability,
    damage: ability.id === 'firebolt' ? scaled(pet.intelligence)
      : ability.id === 'tide-crash' ? scaled(pet.strength)
      : ability.id === 'vine-lash' ? scaled(pet.charisma)
      : ability.id === 'heavy-strike' ? Math.ceil(fighter.damage * 1.5) : fighter.damage,
  }));
}

export interface BattleAttack {
  id: AbilityId; name: string; mpCost: number; description: string; damage: number;
  type?: Element; // absent in battles saved before types
}
// Everything needed to resume a live fight is saved as plain JSON. `turns`
// remains the replay format, while the current resources and turn are explicit.
export interface ActiveBattle extends Battle {
  status: 'active' | 'finished';
  actor: number | null;
  hp: number[]; mp: number[];
  revision: number;
  attacks: BattleAttack[][];
  coinProvider: number;
  order: number[];
  cursor: number;
  monsterIndex: number | null;
  automaticIds: string[];
  goldPending: boolean;
  forfeited: number[];
}
export interface BattleActionError { error: string; status: number }
export interface StartBattleOptions {
  mode?: 'pvp' | 'monster';
  hp?: number[]; mp?: number[];
  random?: () => number;
  // Only the server's fixed training bot belongs here. Human participants must
  // always select their own move, including when they disconnect.
  automaticIds?: string[];
}

export function isActiveBattle(battle: Battle): battle is ActiveBattle {
  return 'status' in battle && 'actor' in battle && 'revision' in battle;
}

function attributeTotal(pet: PetStats) {
  return pet.strength + pet.intelligence + pet.charisma;
}
function battlePower(pet: PetStats) {
  return 2 * pet.strength + pet.intelligence + pet.charisma;
}
function battleFinished(battle: ActiveBattle) {
  if (battle.monsterIndex !== null) {
    if (battle.hp[battle.monsterIndex] <= 0) battle.winner = battle.fighters[0].id;
    else if (!battle.hp.some((hp, i) => i !== battle.monsterIndex && hp > 0)) {
      battle.winner = battle.fighters[battle.monsterIndex].id;
    }
  } else if (battle.hp.some(hp => hp <= 0)) {
    battle.winner = battle.fighters[battle.hp[0] > 0 ? 0 : 1].id;
  }
  if (!battle.winner) return false;
  battle.status = 'finished';
  battle.actor = null;
  return true;
}
function targetOf(battle: ActiveBattle, actor: number) {
  if (battle.monsterIndex === null) return 1 - actor;
  if (actor !== battle.monsterIndex) return battle.monsterIndex;
  // Preserve the monster's existing targeting rule: most remaining HP,
  // keeping the earlier teammate on a tie.
  return battle.hp.reduce((target, hp, i) =>
    i !== battle.monsterIndex && hp > 0 && (target < 0 || hp > battle.hp[target]) ? i : target, -1);
}
// A fighter saved before types has none, so its battle keeps ×1 damage.
function attackDamage(battle: ActiveBattle, target: number, attack: BattleAttack) {
  const base = attack.id === 'bump' ? Math.ceil(battle.hp[target] * 2 / 3) : attack.damage;
  return typed(base, attack.type ?? typeOf(attack.id), battle.fighters[target].type);
}
function strikeInPlace(battle: ActiveBattle, actor: number, attack: BattleAttack) {
  const target = targetOf(battle, actor);
  const boost = battle.goldPending && actor === battle.coinProvider ? 2 : 1;
  if (actor === battle.coinProvider) battle.goldPending = false;
  const damage = Math.min(battle.hp[target], attackDamage(battle, target, attack) * boost);
  const type = attack.type ?? typeOf(attack.id), scale = effectiveness(type, battle.fighters[target].type);
  battle.hp[target] -= damage;
  battle.mp[actor] -= attack.mpCost;
  battle.turns.push({
    actor, target, ability: attack.id, name: attack.name, mpCost: attack.mpCost,
    type, ...(scale !== 1 ? { effectiveness: scale } : {}),
    damage, hits: 1, hp: [...battle.hp], mp: [...battle.mp],
  });
  battle.revision++;
  battle.cursor = (battle.cursor + 1) % battle.order.length;
}
function advanceInPlace(battle: ActiveBattle) {
  while (!battleFinished(battle)) {
    while (battle.hp[battle.order[battle.cursor]] <= 0) {
      battle.cursor = (battle.cursor + 1) % battle.order.length;
    }
    const actor = battle.order[battle.cursor];
    battle.actor = actor;
    if (actor !== battle.monsterIndex && !battle.automaticIds.includes(battle.fighters[actor].id)) return;
    const target = targetOf(battle, actor);
    const attack = battle.attacks[actor].filter(move => move.mpCost <= battle.mp[actor]).reduce((best, move) => {
      const gain = attackDamage(battle, target, move) - attackDamage(battle, target, best);
      return gain > 0 || (gain === 0 && move.mpCost < best.mpCost) ? move : best;
    });
    strikeInPlace(battle, actor, attack);
  }
}
function copyBattle(battle: ActiveBattle): ActiveBattle {
  // Structured cloning prevents an invalid/stale request or a failed database
  // transaction from changing the caller's previously persisted snapshot.
  return structuredClone(battle);
}

/** Start a fight without selecting any human pet's move. Rolls use raw stats. */
export function startBattle(
  pets: PetStats[], opponent: PetStats, rolls: number[], options: StartBattleOptions = {},
): ActiveBattle {
  const mode = options.mode ?? (opponent.monster ? 'monster' : 'pvp');
  if (!pets.length || (mode === 'pvp' && pets.length !== 1)) throw new Error('Choose the battle participants.');
  const all = [...pets, opponent];
  if (new Set(all.map(pet => pet.id)).size !== all.length) throw new Error('Each fighter must be different.');
  if (all.some(pet => ![pet.strength, pet.intelligence, pet.charisma].every(value => Number.isFinite(value) && value >= 0)
    || attributeTotal(pet) <= 0)) throw new Error('Fighter attributes must be valid.');
  if (all.some((_, i) => !Number.isFinite(rolls[i]) || rolls[i] < 0)) throw new Error('Each fighter needs a valid battle roll.');

  const candidates = mode === 'monster' ? pets : all;
  const provider = candidates.reduce((strongest, pet, i) =>
    attributeTotal(pet) > attributeTotal(candidates[strongest]) ? i : strongest, 0);
  const effect = coinEffect(all[provider].equippedCoin, options.random);
  const prepared = all.map((pet, i) => {
    const monster = mode === 'monster' && i === pets.length;
    const selected = monster ? pet.abilities : pet.equippedAbilities ?? pet.abilities;
    const abilities = [...new Set(selected ?? [])].filter(id =>
      (monster ? ALL_ABILITIES : ABILITIES).some(ability => ability.id === id));
    return withAttributeBonus({ ...pet, abilities }, i === provider ? effect.attributeBonus : 0);
  });
  const adjustedRolls = rolls.map((roll, i) => roll * battlePower(prepared[i]) / battlePower(all[i]));
  const fighters = prepared.map((pet, i) => fighterOf(pet, adjustedRolls[i]));
  const attacks = prepared.map((pet, i) => attacksOf(pet, fighters[i], adjustedRolls[i]));
  const initialHp = fighters.map((fighter, i) => {
    const carried = options.hp?.[i] ?? attributeTotal(all[i]);
    return carried <= 0 ? 0 : Math.min(fighter.maxHp, carried + (i === provider ? effect.attributeBonus * 3 : 0));
  });
  const initialMp = fighters.map((fighter, i) => Math.max(0, Math.min(fighter.maxMp,
    (options.mp?.[i] ?? all[i].intelligence) + (i === provider ? effect.attributeBonus : 0))));
  const monsterIndex = mode === 'monster' ? pets.length : null;
  const petOrder = pets.map((_, i) => i);
  const order = monsterIndex === null
    ? effect.first === 0 ? [provider, 1 - provider] : [1 - provider, provider]
    : effect.first === 0 ? [...petOrder, monsterIndex] : [monsterIndex, ...petOrder];
  const battle: ActiveBattle = {
    fighters, attacks, turns: [], winner: '', status: 'active', actor: null,
    initialHp, initialMp, hp: [...initialHp], mp: [...initialMp], revision: 0,
    initiative: { toss: effect.toss, coin: effect.coin, provider, providerId: all[provider].id },
    coinProvider: provider, goldPending: effect.doubleFirstStrike,
    order, cursor: 0, monsterIndex, automaticIds: [...new Set(options.automaticIds ?? [])],
    forfeited: [],
  };
  advanceInPlace(battle);
  return battle;
}

/** Validate and resolve one selected pet move, then any following monster move. */
export function takeBattleTurn(
  battle: ActiveBattle, actorId: string, ability: unknown, revision: unknown,
): ActiveBattle | BattleActionError {
  if (!Number.isInteger(revision) || revision !== battle.revision) {
    return { error: 'The battle has moved on. Choose a move for the current turn.', status: 409 };
  }
  if (battle.status !== 'active' || battle.actor === null) return { error: 'This battle has ended.', status: 409 };
  const actor = battle.actor;
  if (battle.fighters[actor].id !== actorId) return { error: 'Wait for your pet’s turn.', status: 403 };
  if (actor === battle.monsterIndex || battle.automaticIds.includes(actorId)) {
    return { error: 'This fighter’s move is controlled by the game.', status: 403 };
  }
  const attack = battle.attacks[actor].find(move => move.id === ability);
  if (!attack) return { error: 'Choose one of your equipped skills.', status: 400 };
  if (attack.mpCost > battle.mp[actor]) return { error: 'Your pet does not have enough MP for that skill.', status: 409 };
  const next = copyBattle(battle);
  strikeInPlace(next, actor, attack);
  advanceInPlace(next);
  return next;
}

/** Remove only this participant; remaining teammates retain their own turns. */
export function forfeitBattle(
  battle: ActiveBattle, actorId: string, revision?: unknown,
): ActiveBattle | BattleActionError {
  if (revision !== undefined && (!Number.isInteger(revision) || revision !== battle.revision)) {
    return { error: 'The battle has moved on. Refresh it before leaving.', status: 409 };
  }
  const actor = battle.fighters.findIndex(fighter => fighter.id === actorId);
  if (actor < 0 || actor === battle.monsterIndex || battle.automaticIds.includes(actorId)) {
    return { error: 'You are not a player in this battle.', status: 403 };
  }
  if (battle.status !== 'active') return { error: 'This battle has ended.', status: 409 };
  if (battle.forfeited.includes(actor)) return battle;
  const next = copyBattle(battle);
  next.hp[actor] = 0;
  next.forfeited.push(actor);
  next.revision++;
  advanceInPlace(next);
  return next;
}

export function simulateBattle(
  a: PetStats, b: PetStats, rolls: [number, number],
  // A coin's effect can be spread in whole; its attribute bonus must already be
  // applied to `a` (withAttributeBonus), so it is ignored here.
  options?: { hp?: [number, number]; mp?: [number, number] } & Partial<CoinEffect>,
): Battle {
  const fighters = [a, b].map((pet, i) => fighterOf(pet, rolls[i])) as [Fighter, Fighter];
  const attacks = [a, b].map((pet, i) => attacksOf(pet, fighters[i], rolls[i]));
  const initialHp = fighters.map((f, i) => Math.max(0, Math.min(f.maxHp, options?.hp?.[i] ?? f.maxHp))) as [number, number];
  const initialMp = fighters.map((f, i) => Math.max(0, Math.min(f.maxMp, options?.mp?.[i] ?? f.maxMp))) as [number, number];
  const hp: [number, number] = [...initialHp];
  const mp: [number, number] = [...initialMp];
  const first: 0 | 1 = options?.first ?? (rolls[0] > rolls[1] ? 0 : 1);
  const second = (1 - first) as 0 | 1;
  const turns: BattleTurn[] = [];
  const damageOf = (actor: 0 | 1, attack: (typeof attacks)[number][number]) =>
    typed(attack.id === 'bump' ? Math.ceil(hp[1 - actor] * 2 / 3) : attack.damage, attack.type, fighters[1 - actor].type);
  // The hardest-hitting attack the fighter can afford right now, the cheaper on a tie.
  const choose = (actor: 0 | 1) => attacks[actor].filter(attack => attack.mpCost <= mp[actor]).reduce((best, attack) => {
    const gain = damageOf(actor, attack) - damageOf(actor, best);
    return gain > 0 || (gain === 0 && attack.mpCost < best.mpCost) ? attack : best;
  });
  // Gold's "first attack deals double damage" always refers to fighter 0's own
  // first strike, whichever turn order it lands on.
  let zeroHasStruck = false;
  function strike(actor: 0 | 1, hits = 1, attack = choose(actor)) {
    const target = (1 - actor) as 0 | 1;
    const boost = options?.doubleFirstStrike && actor === 0 && !zeroHasStruck ? 2 : 1;
    if (actor === 0) zeroHasStruck = true;
    const damage = Math.min(hp[target], damageOf(actor, attack) * hits * boost);
    const scale = effectiveness(attack.type, fighters[target].type);
    hp[target] -= damage;
    mp[actor] -= attack.mpCost * hits;
    turns.push({ actor, target, ability: attack.id, name: attack.name, mpCost: attack.mpCost * hits, type: attack.type,
      ...(scale !== 1 ? { effectiveness: scale } : {}), damage, hits, hp: [...hp], mp: [...mp] });
  }
  while (hp[0] > 0 && hp[1] > 0) {
    // Very high HP builds can take thousands of identical turns. Group only
    // non-lethal middle rounds, stopping when either fighter changes ability.
    if (turns.length >= 60) {
      const choices = [choose(0), choose(1)];
      // Bump hits for less each time, so only fixed-damage attacks are grouped.
      const rounds = choices.some(attack => attack.id === 'bump') ? 0 : Math.min(...choices.map((attack, actor) => Math.min(
        Math.ceil(hp[1 - actor] / damageOf(actor as 0 | 1, attack)) - 1,
        attack.mpCost ? Math.floor(mp[actor] / attack.mpCost) : Infinity,
      )));
      if (rounds > 1) { strike(first, rounds, choices[first]); strike(second, rounds, choices[second]); }
    }
    strike(first);
    if (hp[second] > 0) strike(second);
  }
  const initiative = options?.toss !== undefined ? { initiative: { toss: options.toss, coin: options.coin ?? null } } : {};
  return { fighters, turns, winner: hp[0] > 0 ? a.id : b.id, initialHp, initialMp, ...initiative };
}

// Teammates fighting one monster together in Adventure: pets first, monster
// last. A round is every pet still standing striking the monster in order,
// then the monster striking whichever pet has the most HP left (the earlier
// on a tie); `first: 1` puts the monster's strike first. A pet at 0 HP drops
// out, and the battle ends once the monster or every pet is down. Every
// strike does at least 1 damage, so the monster's HP bounds its length.
export function simulateTeamBattle(
  pets: PetStats[], monster: PetStats, rolls: number[],
  // As in simulateBattle, the coin is the first pet's own, its attribute bonus already applied.
  options: { hp: number[]; mp: number[] } & Partial<CoinEffect>,
): Battle {
  const all = [...pets, monster], boss = pets.length;
  const fighters = all.map((pet, i) => fighterOf(pet, rolls[i]));
  const attacks = all.map((pet, i) => attacksOf(pet, fighters[i], rolls[i]));
  const initialHp = fighters.map((f, i) => Math.max(0, Math.min(f.maxHp, options.hp[i] ?? f.maxHp)));
  const initialMp = fighters.map((f, i) => Math.max(0, Math.min(f.maxMp, options.mp[i] ?? f.maxMp)));
  const hp = [...initialHp], mp = [...initialMp];
  const turns: BattleTurn[] = [];
  const damageOf = (target: number, attack: (typeof attacks)[number][number]) =>
    typed(attack.id === 'bump' ? Math.ceil(hp[target] * 2 / 3) : attack.damage, attack.type, fighters[target].type);
  let zeroHasStruck = false;
  function strike(actor: number, target: number) {
    const attack = attacks[actor].filter(a => a.mpCost <= mp[actor]).reduce((best, a) => {
      const gain = damageOf(target, a) - damageOf(target, best);
      return gain > 0 || (gain === 0 && a.mpCost < best.mpCost) ? a : best;
    });
    const boost = options.doubleFirstStrike && actor === 0 && !zeroHasStruck ? 2 : 1;
    if (actor === 0) zeroHasStruck = true;
    const damage = Math.min(hp[target], damageOf(target, attack) * boost);
    const scale = effectiveness(attack.type, fighters[target].type);
    hp[target] -= damage;
    mp[actor] -= attack.mpCost;
    turns.push({ actor, target, ability: attack.id, name: attack.name, mpCost: attack.mpCost, type: attack.type,
      ...(scale !== 1 ? { effectiveness: scale } : {}), damage, hits: 1, hp: [...hp], mp: [...mp] });
  }
  const standing = () => pets.map((_, i) => i).filter(i => hp[i] > 0);
  const petsStrike = () => { for (const i of standing()) if (hp[boss] > 0) strike(i, boss); };
  const monsterStrikes = () => strike(boss, standing().reduce((most, i) => hp[i] > hp[most] ? i : most));
  while (hp[boss] > 0 && standing().length) {
    if (options.first === 1) { monsterStrikes(); if (standing().length) petsStrike(); }
    else { petsStrike(); if (hp[boss] > 0) monsterStrikes(); }
  }
  const initiative = options.toss !== undefined ? { initiative: { toss: options.toss, coin: options.coin ?? null } } : {};
  return { fighters, turns, winner: hp[boss] > 0 ? monster.id : pets[0].id, initialHp, initialMp, ...initiative };
}
