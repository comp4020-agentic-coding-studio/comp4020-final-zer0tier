import { expect, it } from 'vitest';
import { createWorld } from '../src/adventure-world.ts';
import { forfeitBattle, mainAttribute, startBattle, takeBattleTurn, type ActiveBattle, type AbilityId, type PetStats } from '../src/combat.ts';
import { monsterBuild, monsterMoves, type MonsterBuildId } from '../src/monsters.ts';

const pet: PetStats = { id: 'pet', strength: 40, intelligence: 40, charisma: 40,
  abilities: ['coffee-break', 'hardhat-guard', 'synapse-shock', 'heavy-breath-slam', 'bloodlust-crash', 'standing-ovation'] };
const power = (p: PetStats) => p.strength * 2 + p.intelligence + p.charisma;
function enemy(build: MonsterBuildId, floor = 5): PetStats {
  const saved = createWorld()[floor - 1].enemies.find(e => e.build === build)!;
  const profile = monsterBuild(saved)!;
  return { ...saved, monster: saved.kind, abilities: monsterMoves(saved, floor), tactic: profile.tactic, strategy: profile.strategy };
}
function start(build: MonsterBuildId, floor = 5, pets = [pet], options: Parameters<typeof startBattle>[3] = {}) {
  const monster = enemy(build, floor);
  return startBattle(pets, monster, [...pets.map(power), power(monster)], { random: () => 0.6, ...options });
}
function act(b: ActiveBattle, skill: AbilityId, random = () => 0): ActiveBattle {
  const next = takeBattleTurn(b, b.fighters[b.actor!].id, skill, b.revision, random);
  if ('error' in next) throw new Error(next.error);
  return next;
}

it('spawns STR bruisers, CHA dodgers and INT casters on every floor with sustainable skill costs', () => {
  for (const floor of createWorld()) {
    expect(floor.enemies.slice(0, 4).map(mainAttribute)).toEqual(['str', 'str', 'int', 'cha']);
    for (const saved of floor.enemies) {
      const monster = enemy(saved.build!, floor.number);
      const b = startBattle([pet], monster, [power(pet), power(monster)], { random: () => 0 });
      expect(b.fighters[1].tactic).toBe(monsterBuild(saved)!.tactic);
      expect(b.attacks[1].every(a => a.mpCost <= b.fighters[1].maxMp)).toBe(true);
      expect(b.attacks[1].some(a => a.mpCost === 0 && a.id !== 'claw-strike')).toBe(saved.kind !== 'slime-king');
    }
  }
  expect(monsterMoves({ kind: 'slime', build: 'mind-slime' }, 2)).not.toContain('gravity-formula');
  expect(monsterMoves({ kind: 'slime', build: 'mind-slime' }, 3)).toContain('gravity-formula');
});

it('a bruiser guards, attacks while guarded, then uses its free MP recovery when drained', () => {
  let b = start('goblin-bruiser');
  expect(b.turns[0]).toMatchObject({ ability: 'hardhat-guard', damage: 0, mpCost: 2 });
  b = act(b, 'coffee-break');
  expect(b.turns.at(-1)).toMatchObject({ ability: 'feral-maul', mpCost: 3 });
  b = act(b, 'coffee-break');
  expect(b.turns.at(-1)).toMatchObject({ ability: 'heavy-breath-slam', mpCost: 0 });
  expect(b.mp[1]).toBe(2);
});

it('a dodger raises CHA and uses doubled Riposte after the player misses', () => {
  let b = start('glimmer-goblin');
  expect(b.turns[0]).toMatchObject({ ability: 'makeover-glow', damage: 0 });
  expect(b.fighters[1].stats!.charisma).toBeCloseTo(25.2);
  b = act(b, 'coffee-break'); // Smile restores enough MP for Riposte.
  expect(b.turns.at(-1)!.ability).toBe('service-smile');
  const missed = { ...pet, strength: 100, intelligence: 30, charisma: 1 };
  let duel = start('glimmer-goblin', 5, [missed]);
  duel = act(duel, 'coffee-break');
  let roll = 0;
  duel = act(duel, 'heavy-breath-slam', () => roll++ === 0 ? 0.99 : 0);
  expect(duel.turns.at(-2)).toMatchObject({ ability: 'heavy-breath-slam', missed: true });
  expect(duel.turns.at(-1)).toMatchObject({ ability: 'dazzling-riposte', mpCost: 3, damage: 66 });
});

it('a caster drains MP, recovers with its INT basic, and uses Gravity against depleted targets', () => {
  let b = start('mind-slime', 3, [{ ...pet, strength: 5 }]);
  expect(b.turns[0]).toMatchObject({ ability: 'synapse-shock', mpCost: 3 });
  expect(b.mp[0]).toBe(b.initialMp![0] - 3);
  b.mp[0] = 0;
  b = act(b, 'claw-strike');
  expect(b.turns.at(-1)).toMatchObject({ ability: 'paperplane-dart', mpCost: 0 });
  expect(b.mp[1]).toBe(6);
  // A zero-luck player still deals minimum damage, keeping the test target alive.
  b = start('mind-slime', 3, [{ ...pet, strength: 1 }], { mp: [0, 6] });
  expect(b.turns[0]).toMatchObject({ ability: 'gravity-formula', mpCost: 4 });
});

it('a boss telegraph costs a whole turn, spends no MP, and survives serialization and invalid retries', () => {
  const b = start('slime-king');
  expect(b.turns).toHaveLength(1);
  expect(b.turns[0]).toMatchObject({ actor: 1, ability: 'bump', telegraph: true, damage: 0, mpCost: 0 });
  expect(b.monsterIntent).toEqual({ ability: 'bump', target: 0 });
  expect(b.hp).toEqual(b.initialHp);
  expect(b.mp).toEqual(b.initialMp);
  const restored = JSON.parse(JSON.stringify(b));
  expect(takeBattleTurn(restored, 'pet', 'hardhat-guard', b.revision - 1)).toMatchObject({ status: 409 });
  expect(restored).toEqual(b);
  const guarded = act(restored, 'hardhat-guard');
  expect(guarded.turns.at(-1)).toMatchObject({ ability: 'bump', damage: Math.round(Math.ceil(b.hp[0] * 2 / 3) * 0.7), mpCost: 5 });
  expect(guarded.turns.at(-1)).not.toHaveProperty('telegraph');
  expect(guarded.monsterIntent).toBeUndefined();
  expect(guarded.mp[1]).toBe(1);
  expect(b.monsterIntent).toBeDefined(); // Input snapshot is untouched.
});

it('MP drain interrupts a charged Bump and makes the boss fall back to Claw Strike', () => {
  const b = act(start('slime-king'), 'synapse-shock');
  expect(b.turns.at(-1)).toMatchObject({ ability: 'claw-strike', mpCost: 0, events: expect.arrayContaining(['Bump interrupted: not enough MP']) });
  expect(b.turns.filter(t => t.ability === 'bump')).toHaveLength(1);
  expect(b.monsterIntent).toBeUndefined();
  expect(b.mp.every(mp => mp >= 0)).toBe(true);
});

it('the whole team can respond, and healing another pet never silently changes the announced target', () => {
  const ally = { ...pet, id: 'ally', strength: 60 };
  const king = enemy('slime-king');
  let b = startBattle([pet, ally], king, [0, 0, power(king)], { random: () => 0.6, hp: [130, 100, 64] });
  expect(b.monsterIntent!.target).toBe(0);
  b = act(b, 'bloodlust-crash');
  expect(b.actor).toBe(1);
  expect(b.turns.filter(t => t.actor === 2)).toHaveLength(1);
  b = act(b, 'standing-ovation');
  expect(b.hp[1]).toBeGreaterThan(110);
  expect(b.turns.at(-1)).toMatchObject({ actor: 2, target: 0, ability: 'bump', damage: 74 });
});

it('a charged target forfeiting cancels Bump without redirecting it at a teammate', () => {
  let b = start('slime-king', 5, [pet, { ...pet, id: 'ally' }]);
  const next = forfeitBattle(b, 'pet', b.revision);
  if ('error' in next) throw new Error(next.error);
  b = act(next, 'coffee-break');
  expect(b.turns.at(-1)).toMatchObject({ ability: 'claw-strike', target: 1, events: expect.arrayContaining(['Bump interrupted: the target has left the battle']) });
  expect(b.monsterIntent).toBeUndefined();
});

it('defeating the boss during its charge clears the warning and prevents a posthumous attack', () => {
  const b = act(start('slime-king', 5, [{ ...pet, strength: 200 }]), 'heavy-breath-slam');
  expect(b.status).toBe('finished');
  expect(b.winner).toBe('pet');
  expect(b.monsterIntent).toBeUndefined();
  expect(b.turns.filter(t => t.actor === 1)).toHaveLength(1);
});

it('older maps and v2 battles without a tactic retain their original attacks', () => {
  expect(monsterMoves({ kind: 'slime' }, 5)).toEqual([]);
  expect(monsterMoves({ kind: 'goblin' }, 5)).toEqual([]);
  const king = enemy('slime-king'); delete king.tactic; delete king.strategy;
  const b = startBattle([pet], king, [power(pet), power(king)], { random: () => 0.6 });
  expect(b.turns[0]).toMatchObject({ ability: 'bump', damage: 87, mpCost: 5 });
  expect(b.monsterIntent).toBeUndefined();
  const resumed = act(JSON.parse(JSON.stringify(b)), 'coffee-break');
  expect(resumed.turns.every(t => !t.telegraph)).toBe(true);
});
