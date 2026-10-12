import { type CoinId } from './treasure.ts';
// A saved, server-resolved battle. HP/MP belong to this fight, not daily care.
export const ABILITIES = [
  { id: 'claw-strike', name: 'Claw Strike', mpCost: 0, description: 'A free Strength-based attack.' },
  { id: 'firebolt', name: 'Firebolt', mpCost: 3, description: 'Intelligence × 1.5, adjusted by battle luck and rounded.' },
  { id: 'heavy-strike', name: 'Heavy Strike', mpCost: 2, description: 'Claw Strike damage × 1.5, rounded up.' },
] as const;
export type AbilityId = (typeof ABILITIES)[number]['id'];
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
export interface BattleTurn {
  actor: 0 | 1; target: 0 | 1; ability: AbilityId;
  name?: string; mpCost?: number; // absent in older saved replays
  damage: number; hits: number; hp: [number, number]; mp: [number, number];
}
// How the turn order was decided, saved so every replay can show it. `toss`
// is null when the acting pet's Silver or Gold Coin fixed the order instead.
export interface Initiative { toss: 'heads' | 'tails' | null; coin: CoinId | null }
export interface Battle {
  fighters: [Fighter, Fighter]; turns: BattleTurn[]; winner: string;
  initialHp?: [number, number]; initialMp?: [number, number]; // absent in older saved replays
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
export function simulateBattle(
  a: PetStats, b: PetStats, rolls: [number, number],
  // A coin's effect can be spread in whole; its attribute bonus must already be
  // applied to `a` (withAttributeBonus), so it is ignored here.
  options?: { hp?: [number, number]; mp?: [number, number] } & Partial<CoinEffect>,
): Battle {
  const fighters = [a, b].map((pet, i) => ({
    id: pet.id,
    ...(pet.name ? { name: pet.name } : {}),
    ...(pet.monster ? { monster: pet.monster } : {}),
    maxHp: pet.strength + pet.intelligence + pet.charisma,
    maxMp: pet.intelligence,
    damage: Math.max(1, Math.round(pet.strength * rolls[i] / (2 * pet.strength + pet.intelligence + pet.charisma))),
    color: pet.color ?? "#f59e0b", appearance: pet.appearance ?? "blob",
    abilities: ABILITIES.filter(ability => ability.id === 'claw-strike' || pet.abilities?.includes(ability.id)).map(ability => ability.id),
  })) as [Fighter, Fighter];
  const attacks = [a, b].map((pet, i) => ABILITIES.filter(ability => fighters[i].abilities.includes(ability.id)).map(ability => ({
    ...ability,
    damage: ability.id === 'firebolt'
      ? Math.max(1, Math.round(1.5 * pet.intelligence * rolls[i] / (2 * pet.strength + pet.intelligence + pet.charisma)))
      : ability.id === 'heavy-strike' ? Math.ceil(fighters[i].damage * 1.5) : fighters[i].damage,
  })).sort((a, b) => b.damage - a.damage || a.mpCost - b.mpCost));
  const initialHp = fighters.map((f, i) => Math.max(0, Math.min(f.maxHp, options?.hp?.[i] ?? f.maxHp))) as [number, number];
  const initialMp = fighters.map((f, i) => Math.max(0, Math.min(f.maxMp, options?.mp?.[i] ?? f.maxMp))) as [number, number];
  const hp: [number, number] = [...initialHp];
  const mp: [number, number] = [...initialMp];
  const first: 0 | 1 = options?.first ?? (rolls[0] > rolls[1] ? 0 : 1);
  const second = (1 - first) as 0 | 1;
  const turns: BattleTurn[] = [];
  const choose = (actor: 0 | 1) => attacks[actor].find(attack => attack.mpCost <= mp[actor])!;
  // Gold's "first attack deals double damage" always refers to fighter 0's own
  // first strike, whichever turn order it lands on.
  let zeroHasStruck = false;
  function strike(actor: 0 | 1, hits = 1, attack = choose(actor)) {
    const target = (1 - actor) as 0 | 1;
    const boost = options?.doubleFirstStrike && actor === 0 && !zeroHasStruck ? 2 : 1;
    if (actor === 0) zeroHasStruck = true;
    const damage = Math.min(hp[target], attack.damage * hits * boost);
    hp[target] -= damage;
    mp[actor] -= attack.mpCost * hits;
    turns.push({ actor, target, ability: attack.id, name: attack.name, mpCost: attack.mpCost * hits, damage, hits, hp: [...hp], mp: [...mp] });
  }
  while (hp[0] > 0 && hp[1] > 0) {
    // Very high HP builds can take thousands of identical turns. Group only
    // non-lethal middle rounds, stopping when either fighter changes ability.
    if (turns.length >= 60) {
      const choices = [choose(0), choose(1)];
      const rounds = Math.min(...choices.map((attack, actor) => Math.min(
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
