import { expect, it, vi } from 'vitest';
import { startBattle, takeBattleTurn, forfeitBattle, mainAttribute, maxHpFor, maxMpFor, balancedStats, type ActiveBattle, type AbilityId, type PetStats } from '../src/combat.ts';
import * as legacy from '../src/legacy-combat.ts';
import { SKILLS } from '../src/skills.ts';
const all = SKILLS.map(s => s.id);
const pet: PetStats = { id: 'pet', strength: 50, charisma: 50, intelligence: 50, abilities: all, equippedAbilities: all };
const rival: PetStats = { id: 'rival', strength: 500, charisma: 50, intelligence: 50, equippedCoin: 'gold-coin', abilities: ['coffee-break'] };
const power = (p: PetStats) => p.strength * 2 + p.charisma + p.intelligence;
function start(a = pet, b = rival, mp?: number[]) {
  return startBattle([a], b, [power(a), power(b)], { random: () => 0, mp });
}
function act(b: ActiveBattle, skill: AbilityId, random = () => 0): ActiveBattle {
  const result = takeBattleTurn(b, b.fighters[b.actor!].id, skill, b.revision, random);
  if ('error' in result) throw new Error(result.error);
  return result;
}
const again = (b: ActiveBattle) => act(b, 'coffee-break');
it('defines exactly 9 STR, 9 CHA, 9 INT and 3 Normal skills, with a source for every one', () => {
  expect(SKILLS).toHaveLength(30);
  expect(new Set(all).size).toBe(30);
  expect(['str', 'cha', 'int', 'normal'].map(t => SKILLS.filter(s => s.type === t).length)).toEqual([9, 9, 9, 3]);
  expect(SKILLS.every(s => ['job', 'monster', 'chest'].includes(s.source.channel))).toBe(true);
});
it('derives type, HP, and small MP pools at the exact 20% boundary', () => {
  expect(mainAttribute({ strength: 12, charisma: 10, intelligence: 10 })).toBe('str');
  expect(mainAttribute({ strength: 11, charisma: 10, intelligence: 10 })).toBe('normal');
  expect(mainAttribute({ strength: 20, charisma: 20, intelligence: 1 })).toBe('normal');
  expect(balancedStats({ strength: 20, charisma: 20, intelligence: 1 })).toBe(false);
  expect(maxHpFor({ strength: 5, charisma: 500, intelligence: 500 })).toBe(25);
  expect([0, 5, 10, 40].map(intelligence => maxMpFor({ strength: 5, charisma: 5, intelligence }))).toEqual([5, 5, 6, 12]);
});
it.each(SKILLS)('$name resolves as a selected server turn and survives JSON serialization', skill => {
  const b = start();
  const result = act(JSON.parse(JSON.stringify(b)), skill.id);
  expect(result.turns[0]).toMatchObject({ ability: skill.id, mpCost: skill.mpCost, missed: false });
  expect(result.hp.every((hp, i) => hp >= 0 && hp <= result.fighters[i].maxHp)).toBe(true);
  expect(result.mp.every((mp, i) => mp >= 0 && mp <= result.fighters[i].maxMp)).toBe(true);
  expect(b.revision).toBe(0);
});
it('basics replenish MP even on a miss; sure-hit Dart ignores evasion', () => {
  const b = start(pet, { ...rival, charisma: 500 }, [0, 0]);
  expect(act(b, 'heavy-breath-slam', () => 0.99).turns[0]).toMatchObject({ missed: true, damage: 0, mp: [2, 0] });
  expect(act(b, 'service-smile', () => 0.99).mp[0]).toBe(2);
  expect(act(b, 'paperplane-dart', () => 0.99).turns[0]).toMatchObject({ missed: false, damage: 50, mp: [3, 0] });
  expect(act(start(pet, rival, [13, 0]), 'paperplane-dart').mp[0]).toBe(14);
});
it('type advantage gives +20% damage and 20% mitigation, with neutral Normal', () => {
  const hit = (a: PetStats, b: PetStats) => act(start(a, b), 'claw-strike').turns[0];
  const a = { ...pet, strength: 60, intelligence: 5, charisma: 5 };
  const cha = { ...rival, strength: 50, charisma: 200, intelligence: 50 };
  expect(hit(a, cha)).toMatchObject({ damage: 72, effectiveness: 1.2 });
  expect(hit({ ...a, strength: 50, charisma: 60 }, { ...rival, strength: 200 })).toMatchObject({ damage: 40, effectiveness: 0.8 });
  expect(hit(pet, rival).effectiveness).toBeUndefined();
});
it('CHA debuffs alter dynamic typing and evasion, while pin and sure-hit bypass evasion', () => {
  let b = start(pet, { ...rival, strength: 100, charisma: 150, intelligence: 100 });
  expect(b.fighters[1].type).toBe('cha');
  b = act(b, 'apex-roar');
  expect(b.fighters[1].stats!.charisma).toBe(97.5);
  expect(b.fighters[1].type).toBe('normal');
  b = again(b);
  expect(act(b, 'lumberjack-sweep', () => 0.999).turns.at(-1)!.missed).toBe(false);
  let pinned = act(start(pet, { ...rival, charisma: 500 }), 'feral-maul');
  pinned = again(pinned);
  expect(pinned.attacks[0].find(a => a.id === 'heavy-breath-slam')!.hitChance).toBe(1);
  expect(act(pinned, 'heavy-breath-slam', () => 0.99).turns.at(-1)!.missed).toBe(false);
});
it('Bloodlust pays HP even on a miss, refuses lethal costs, and preserves the original snapshot', () => {
  const b = start(); b.hp[0] = 24;
  expect(takeBattleTurn(b, 'pet', 'bloodlust-crash', 0)).toMatchObject({ status: 409 });
  b.hp[0] = 100;
  expect(act(b, 'bloodlust-crash', () => 0.99).hp[0]).toBe(76);
  expect(b.hp[0]).toBe(100);
});
it('HP-based strikes use current/maximum HP, and Mind Gap compares pre-cost MP', () => {
  const b = start(); b.hp[0] = 100;
  expect(act(b, 'titans-relic-press').turns[0].damage).toBe(134); // round(118.75 + 15)
  expect(act(b, 'gravity-formula').turns[0].damage).toBe(226); // 75 + 151
  expect(act(start(pet, rival, [14, 0]), 'mind-gap').turns[0].damage).toBe(270);
});
it('buffs refresh without stacking, persist after reload, and expire without granting HP or MP', () => {
  let b = act(start(), 'gym-pump');
  expect(b.fighters[0]).toMatchObject({ maxHp: 197, stats: { strength: 62.5 } });
  expect(b.hp[0]).toBe(160);
  b = again(b); b = act(b, 'gym-pump');
  expect(b.fighters[0].stats!.strength).toBe(62.5);
  b = JSON.parse(JSON.stringify(b));
  for (let i = 0; i < 3; i++) { b = again(b); b = act(b, 'heavy-breath-slam'); }
  expect(b.fighters[0].stats!.strength).toBe(50);
  expect(b.fighters[0].maxHp).toBe(160);
});
it('Riposte doubles after a miss and loses the trigger after the opponent uses a utility', () => {
  let b = start(pet, { ...rival, strength: 100, abilities: ['coffee-break', 'humble-pie'] });
  b = act(b, 'heavy-breath-slam'); b = act(b, 'humble-pie', () => 0.999);
  const damage = act(b, 'dazzling-riposte').turns.at(-1)!.damage;
  expect(damage).toBe(163);
  b = again(act(b, 'heavy-breath-slam'));
  expect(act(b, 'dazzling-riposte').turns.at(-1)!.damage).toBe(81);
});
it('Siren surcharge never blocks free basics and is paid once by the next paid skill', () => {
  const enemy = { ...rival, abilities: ['humble-pie', 'coffee-break'] as AbilityId[] };
  let b = act(start(pet, enemy, [14, 3]), 'sirens-lure');
  expect(takeBattleTurn(b, 'rival', 'humble-pie', b.revision)).toMatchObject({ status: 409 });
  expect(b.attacks[1].find(a => a.id === 'claw-strike')!.currentMpCost).toBe(0);
  b = act(b, 'coffee-break'); b = act(b, 'heavy-breath-slam');
  b = act(b, 'humble-pie');
  expect(b.turns.at(-1)!.mpCost).toBe(5);
  expect(b.states![1].surcharge).toBe(false);
});
it('MP destruction/drain clamp at zero and a barrier spends only available MP', () => {
  expect(act(start(pet, rival, [14, 1]), 'synapse-shock').mp[1]).toBe(0);
  expect(act(start(pet, rival, [14, 2]), 'crown-jewel-beam').mp).toEqual([9, 0]);
  const enemy = { ...rival, strength: 60, charisma: 60, intelligence: 60 };
  let b = act(start(pet, enemy, [5, 14]), 'mana-barrier');
  b = act(b, 'claw-strike');
  // Gold doubles the rival's first hit: 120 damage, only 2 MP available to absorb it.
  expect(b.hp[0]).toBe(42); expect(b.mp[0]).toBe(0);
});
it('Guard mitigates damage and restores MP; perfume pays out on misses', () => {
  const enemy = { ...rival, strength: 60, charisma: 60, intelligence: 60 };
  let b = act(start(pet, enemy, [5, 14]), 'hardhat-guard');
  b = act(b, 'claw-strike');
  expect(b.hp[0]).toBe(76); expect(b.mp[0]).toBe(4);
  b = act(start(pet, enemy, [5, 14]), 'phantom-perfume');
  b = act(b, 'claw-strike', () => 0.999);
  // No CHA advantage here: deliberately create one before the miss scenario.
  const dodger = { ...pet, charisma: 100 };
  b = act(start(dodger, enemy, [5, 14]), 'phantom-perfume');
  b = act(b, 'claw-strike', () => 0.999);
  expect(b.mp[0]).toBe(3); expect(b.turns.at(-1)!.missed).toBe(true);
});
it('Ovation heals and cleanses only stat debuffs; Coffee restores MP and temporary INT', () => {
  let b = start(); b.hp[0] = 30;
  b.states![0].effects = [{ id: 'apex-roar', name: 'CHA down', attribute: 'charisma', amount: -0.35, expires: 20 }];
  b = act(b, 'standing-ovation');
  expect(b.hp[0]).toBe(86); expect(b.fighters[0].stats!.charisma).toBe(50);
  b = act(start(pet, rival, [0, 14]), 'coffee-break');
  expect(b.fighters[0]).toMatchObject({ maxMp: 16, stats: { intelligence: 60 } });
  expect(b.mp[0]).toBe(8);
});
it('Peer Review changes only favorable bonuses and expires; Equalizer suppresses both directions', () => {
  const a = { ...pet, intelligence: 60 };
  let b = again(act(start(a), 'peer-review'));
  expect(act(b, 'paperplane-dart').turns.at(-1)).toMatchObject({ effectiveness: 1.4, damage: 84 });
  b = again(act(start(a), 'equalizer-field'));
  expect(b.fighters[1].type).toBe('normal');
  expect(act(b, 'paperplane-dart').turns.at(-1)!.effectiveness).toBeUndefined();
});
it('Normal perks require balanced stats, and an artificial Normal field cannot unlock Golden Ratio', () => {
  const b = start(); b.hp[0] = 50;
  const gold = act(b, 'golden-ratio');
  expect(gold.hp[0]).toBe(82); expect(gold.fighters[0].stats!.strength).toBeCloseTo(57.5);
  expect(act(b, 'jack-of-all-trades').turns[0]).toMatchObject({ damage: 109, mp: [13, 14] });
  const uneven = start({ ...pet, strength: 50, charisma: 50, intelligence: 5 });
  expect(takeBattleTurn(uneven, 'pet', 'golden-ratio', 0)).toMatchObject({ status: 409 });
});
it('stale, out-of-turn, unequipped and unaffordable requests are atomic; old battles still resume', () => {
  const b = start(pet, rival, [0, 0]), saved = JSON.stringify(b);
  expect(takeBattleTurn(b, 'pet', 'forbidden-grimoire', 0)).toMatchObject({ status: 409 });
  expect(takeBattleTurn(b, 'rival', 'claw-strike', 0)).toMatchObject({ status: 403 });
  expect(takeBattleTurn(b, 'pet', 'paperplane-dart', 1)).toMatchObject({ status: 409 });
  expect(takeBattleTurn(b, 'pet', 'bump', 0)).toMatchObject({ status: 400 });
  expect(JSON.stringify(b)).toBe(saved);
  const old = legacy.startBattle([{ id: 'a', strength: 5, intelligence: 5, charisma: 5, equippedCoin: 'silver-coin' }],
    { id: 'b', strength: 5, intelligence: 5, charisma: 5 }, [20, 20]);
  const restored = takeBattleTurn(JSON.parse(JSON.stringify(old)), 'a', 'claw-strike', 0);
  expect(restored).toMatchObject({ revision: 1, hp: [15, 10], mp: [5, 5] });
});

function teamBattle() {
  const leader = { ...pet, equippedCoin: 'silver-coin' as const };
  const ally = { ...pet, id: 'ally', strength: 1, charisma: 1, intelligence: 1 };
  const monster = { ...rival, id: 'monster', monster: 'slime' as const, charisma: 1, abilities: [] };
  return startBattle([leader, ally], monster, [power(leader), power(ally), 0], { random: () => 0 });
}
it.each(['gym-pump', 'equalizer-field'] as const)('%s expires after three rounds even when a teammate has left', skill => {
  let b = act(teamBattle(), skill);
  const quit = forfeitBattle(b, 'ally', b.revision);
  if ('error' in quit) throw new Error(quit.error);
  b = JSON.parse(JSON.stringify(quit));
  for (let i = 0; i < 2; i++) b = act(b, 'coffee-break');
  expect(b.states!.flatMap(s => s.effects).some(e => e.id === skill)).toBe(true);
  b = act(b, 'coffee-break');
  expect(b.states!.flatMap(s => s.effects).some(e => e.id === skill)).toBe(false);
  if (skill === 'gym-pump') expect(b.fighters[0].stats!.strength).toBe(50);
  else expect(b.fighters[2].type).toBe('str');
});
it('an off-turn forfeit cannot expire a buff before its owner acts', () => {
  let b = act(teamBattle(), 'service-smile');
  b = act(b, 'coffee-break'); // ally acts, then the monster; the leader is next
  expect(b.actor).toBe(0);
  const quit = forfeitBattle(JSON.parse(JSON.stringify(b)), 'ally', b.revision);
  if ('error' in quit) throw new Error(quit.error);
  expect(quit.fighters[0].stats!.charisma).toBeCloseTo(55);
  expect(quit.actor).toBe(0);
});
it('resumes active skill effects from saves that predate the separate effect clock', () => {
  let b = again(act(start(), 'service-smile'));
  const old = JSON.parse(JSON.stringify(b));
  delete old.effectTick;
  const restored = act(old, 'heavy-breath-slam');
  b = act(b, 'heavy-breath-slam');
  expect(restored).toEqual(b);
  expect(restored.fighters[0].stats!.charisma).toBe(50);
});
it('rolls accuracy when a move is accepted instead of exposing predictable future rolls', () => {
  const b = start();
  expect(b).not.toHaveProperty('rng');
  const restored = JSON.parse(JSON.stringify({ ...b, rng: 1 })); // saved before this fix
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.999);
  try {
    const result = takeBattleTurn(restored, 'pet', 'humble-pie', restored.revision);
    if ('error' in result) throw new Error(result.error);
    expect(result.turns[0].missed).toBe(true);
    expect(result).not.toHaveProperty('rng');
    expect(takeBattleTurn(result, 'pet', 'humble-pie', restored.revision)).toMatchObject({ status: 409 });
    expect(random).toHaveBeenCalledTimes(1);
  } finally { random.mockRestore(); }
});
