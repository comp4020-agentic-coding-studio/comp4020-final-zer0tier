import { type CoinId } from './treasure.ts';
// A saved, server-resolved battle. HP/MP belong to this fight, not daily care.
export const ABILITIES = [
  { id: 'claw-strike', name: 'Claw Strike', mpCost: 0, description: 'A free Strength-based attack.' },
  { id: 'firebolt', name: 'Firebolt', mpCost: 3, description: 'Intelligence × 1.5, adjusted by battle luck and rounded.' },
  { id: 'heavy-strike', name: 'Heavy Strike', mpCost: 2, description: 'Claw Strike damage × 1.5, rounded up.' },
] as const;
// Monster-only moves: chests never teach these to pets.
export const MONSTER_ABILITIES = [
  { id: 'bump', name: 'Bump', mpCost: 5, description: 'Two-thirds of the target’s current HP, rounded up.' },
] as const;
const ALL_ABILITIES = [...ABILITIES, ...MONSTER_ABILITIES];
export type AbilityId = (typeof ALL_ABILITIES)[number]['id'];
export type MonsterAbilityId = (typeof MONSTER_ABILITIES)[number]['id'];
export type MonsterKind = 'slime' | 'goblin' | 'slime-king';
export interface PetStats {
  id: string; strength: number; intelligence: number; charisma: number;
  color?: string; appearance?: string;
  name?: string; monster?: MonsterKind;
  abilities?: readonly AbilityId[];
}
export interface Fighter {
  id: string; maxHp: number; maxMp: number; damage: number;
  color: string; appearance: string; abilities: string[];
  name?: string; monster?: MonsterKind;
}
// Indices into the battle's fighters. A one-on-one battle has two; a team's
// Adventure battle lists its pets first and the monster last.
export interface BattleTurn {
  actor: number; target: number; ability: AbilityId;
  name?: string; mpCost?: number; // absent in older saved replays
  damage: number; hits: number; hp: number[]; mp: number[];
}
// How the turn order was decided, saved so every replay can show it. `toss`
// is null when the acting pet's Silver or Gold Coin fixed the order instead.
export interface Initiative { toss: 'heads' | 'tails' | null; coin: CoinId | null }
export interface Battle {
  fighters: Fighter[]; turns: BattleTurn[]; winner: string;
  initialHp?: number[]; initialMp?: number[]; // absent in older saved replays
  initiative?: Initiative; // absent in older saved replays
}
// Before battle, a coin toss decides initiative (heads = fighter 0 first), fair
// unless the acting pet's equipped coin overrides it. Only the acting side's
// coin ever applies; the opponent's equipped coin (if any) is ignored.
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
    ...(pet.monster ? { monster: pet.monster } : {}),
    maxHp: pet.strength + pet.intelligence + pet.charisma,
    maxMp: pet.intelligence,
    damage: Math.max(1, Math.round(pet.strength * roll / (2 * pet.strength + pet.intelligence + pet.charisma))),
    color: pet.color ?? "#f59e0b", appearance: pet.appearance ?? "blob",
    abilities: ALL_ABILITIES.filter(ability => ability.id === 'claw-strike' || pet.abilities?.includes(ability.id)).map(ability => ability.id),
  };
}
// Fixed per-hit damage; Bump's depends on the target's HP, so each battle works it out per strike.
function attacksOf(pet: PetStats, fighter: Fighter, roll: number) {
  return ALL_ABILITIES.filter(ability => fighter.abilities.includes(ability.id)).map(ability => ({
    ...ability,
    damage: ability.id === 'firebolt'
      ? Math.max(1, Math.round(1.5 * pet.intelligence * roll / (2 * pet.strength + pet.intelligence + pet.charisma)))
      : ability.id === 'heavy-strike' ? Math.ceil(fighter.damage * 1.5) : fighter.damage,
  }));
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
    attack.id === 'bump' ? Math.ceil(hp[1 - actor] * 2 / 3) : attack.damage;
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
    hp[target] -= damage;
    mp[actor] -= attack.mpCost * hits;
    turns.push({ actor, target, ability: attack.id, name: attack.name, mpCost: attack.mpCost * hits, damage, hits, hp: [...hp], mp: [...mp] });
  }
  while (hp[0] > 0 && hp[1] > 0) {
    // Very high HP builds can take thousands of identical turns. Group only
    // non-lethal middle rounds, stopping when either fighter changes ability.
    if (turns.length >= 60) {
      const choices = [choose(0), choose(1)];
      // Bump hits for less each time, so only fixed-damage attacks are grouped.
      const rounds = choices.some(attack => attack.id === 'bump') ? 0 : Math.min(...choices.map((attack, actor) => Math.min(
        Math.ceil(hp[1 - actor] / attack.damage) - 1,
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
    attack.id === 'bump' ? Math.ceil(hp[target] * 2 / 3) : attack.damage;
  let zeroHasStruck = false;
  function strike(actor: number, target: number) {
    const attack = attacks[actor].filter(a => a.mpCost <= mp[actor]).reduce((best, a) => {
      const gain = damageOf(target, a) - damageOf(target, best);
      return gain > 0 || (gain === 0 && a.mpCost < best.mpCost) ? a : best;
    });
    const boost = options.doubleFirstStrike && actor === 0 && !zeroHasStruck ? 2 : 1;
    if (actor === 0) zeroHasStruck = true;
    const damage = Math.min(hp[target], damageOf(target, attack) * boost);
    hp[target] -= damage;
    mp[actor] -= attack.mpCost;
    turns.push({ actor, target, ability: attack.id, name: attack.name, mpCost: attack.mpCost, damage, hits: 1, hp: [...hp], mp: [...mp] });
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
