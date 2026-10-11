// A saved, server-resolved battle. HP/MP belong to this fight, not daily care.
export const ABILITIES = [
  { id: 'claw-strike', name: 'Claw Strike', mpCost: 0, description: 'A free Strength-based attack.' },
  { id: 'firebolt', name: 'Firebolt', mpCost: 3, description: 'Intelligence × 1.5, adjusted by battle luck and rounded.' },
  { id: 'heavy-strike', name: 'Heavy Strike', mpCost: 2, description: 'Claw Strike damage × 1.5, rounded up.' },
] as const;
export type AbilityId = (typeof ABILITIES)[number]['id'];
export type MonsterKind = 'slime' | 'goblin' | 'slime-king';
interface PetStats {
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
export interface Battle {
  fighters: [Fighter, Fighter]; turns: BattleTurn[]; winner: string;
  initialHp?: [number, number]; initialMp?: [number, number]; // absent in older saved replays
}
export function simulateBattle(a: PetStats, b: PetStats, rolls: [number, number], resources?: { hp: [number, number]; mp: [number, number] }): Battle {
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
  const initialHp = fighters.map((f, i) => Math.max(0, Math.min(f.maxHp, resources?.hp[i] ?? f.maxHp))) as [number, number];
  const initialMp = fighters.map((f, i) => Math.max(0, Math.min(f.maxMp, resources?.mp[i] ?? f.maxMp))) as [number, number];
  const hp: [number, number] = [...initialHp];
  const mp: [number, number] = [...initialMp];
  const first: 0 | 1 = rolls[0] > rolls[1] ? 0 : 1;
  const second = (1 - first) as 0 | 1;
  const turns: BattleTurn[] = [];
  const choose = (actor: 0 | 1) => attacks[actor].find(attack => attack.mpCost <= mp[actor])!;
  function strike(actor: 0 | 1, hits = 1, attack = choose(actor)) {
    const target = (1 - actor) as 0 | 1;
    const damage = Math.min(hp[target], attack.damage * hits);
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
  return { fighters, turns, winner: hp[0] > 0 ? a.id : b.id, initialHp, initialMp };
}
