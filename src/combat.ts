// A saved, server-resolved battle. HP/MP belong to this fight, not daily care.
export const ABILITIES = [{ id: "claw-strike", name: "Claw Strike", mpCost: 0 }] as const;
export type MonsterKind = 'slime' | 'goblin' | 'slime-king';
interface PetStats {
  id: string; strength: number; intelligence: number; charisma: number;
  color?: string; appearance?: string;
  name?: string; monster?: MonsterKind;
}
export interface Fighter {
  id: string; maxHp: number; maxMp: number; damage: number;
  color: string; appearance: string; abilities: string[];
  name?: string; monster?: MonsterKind;
}
export interface BattleTurn {
  actor: 0 | 1; target: 0 | 1; ability: "claw-strike";
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
    abilities: ["claw-strike"],
  })) as [Fighter, Fighter];
  const initialHp = fighters.map((f, i) => Math.max(0, Math.min(f.maxHp, resources?.hp[i] ?? f.maxHp))) as [number, number];
  const initialMp = fighters.map((f, i) => Math.max(0, Math.min(f.maxMp, resources?.mp[i] ?? f.maxMp))) as [number, number];
  const hp: [number, number] = [...initialHp];
  const mp: [number, number] = [...initialMp];
  const first: 0 | 1 = rolls[0] > rolls[1] ? 0 : 1;
  const second = (1 - first) as 0 | 1;
  const turns: BattleTurn[] = [];
  function strike(actor: 0 | 1, hits = 1) {
    const target = (1 - actor) as 0 | 1;
    const damage = Math.min(hp[target], fighters[actor].damage * hits);
    hp[target] -= damage;
    turns.push({ actor, target, ability: "claw-strike", damage, hits, hp: [...hp], mp: [...mp] });
  }
  while (hp[0] > 0 && hp[1] > 0) {
    // Very high HP builds can take thousands of identical turns. Group only
    // non-lethal middle rounds, retaining the exact damage and final blow.
    if (turns.length === 60) {
      const rounds = Math.min(Math.ceil(hp[1] / fighters[0].damage), Math.ceil(hp[0] / fighters[1].damage)) - 1;
      if (rounds > 0) { strike(first, rounds); strike(second, rounds); }
    }
    strike(first);
    if (hp[second] > 0) strike(second);
  }
  return { fighters, turns, winner: hp[0] > 0 ? a.id : b.id, initialHp, initialMp };
}
