import { expect, it } from 'vitest';
import { ABILITIES, simulateBattle } from '../src/combat.ts';

const a = { id: 'a', strength: 5, intelligence: 7, charisma: 3 };
const b = { id: 'b', strength: 5, intelligence: 5, charisma: 5 };
it('starts with the sum of attributes as HP, intelligence as MP, and only free Claw Strike', () => {
  expect(ABILITIES[0]).toMatchObject({ id: 'claw-strike', name: 'Claw Strike', mpCost: 0 });
  const battle = simulateBattle(a, b, [24, 16]);
  expect(battle.fighters[0]).toMatchObject({ maxHp: 15, maxMp: 7, damage: 6, abilities: ['claw-strike'] });
  expect(battle.fighters[1]).toMatchObject({ maxHp: 15, maxMp: 5, damage: 4 });
  let hp = [15, 15];
  for (const step of battle.turns) {
    expect(hp[step.actor]).toBeGreaterThan(0);
    expect(step.ability).toBe('claw-strike');
    expect(step.mp).toEqual([7, 5]);
    expect(step.hp[step.target]).toBe(hp[step.target] - step.damage);
    expect(step.hp[step.actor]).toBe(hp[step.actor]);
    expect(step.hp[step.target]).toBeGreaterThanOrEqual(0);
    hp = step.hp;
  }
  expect(battle.winner).toBe('a');
  expect(hp).toEqual([7, 0]);
});
it('initiative ties let the defender strike first; HP decides the winner', () => {
  const battle = simulateBattle({ ...a, intelligence: 5, charisma: 5 }, b, [20, 20]);
  expect(battle.turns[0].actor).toBe(1);
  expect(battle.winner).toBe('b');
  expect(battle.turns.at(-1)!.hp).toEqual([0, 5]);
});
it('groups extremely long fights without changing the knockout or using MP', () => {
  const tank = { id: 'tank', strength: 1, intelligence: 1000000, charisma: 5 };
  const other = { ...tank, id: 'other' };
  const battle = simulateBattle(tank, other, [1000007, 1000007]);
  expect(battle.turns.length).toBeLessThanOrEqual(64);
  expect(battle.turns.some(t => t.hits > 1)).toBe(true);
  expect(battle.turns.at(-1)!.hp).toEqual([0, 1]);
  expect(battle.turns.at(-1)!.mp).toEqual([1000000, 1000000]);
});

it('starts an Adventure battle at its carried HP/MP and saves those values for replay', () => {
  const resources: { hp: [number, number]; mp: [number, number] } = { hp: [8, 15], mp: [2, 5] };
  const battle = simulateBattle(a, b, [24, 16], resources);
  expect(battle.initialHp).toEqual([8, 15]);
  expect(battle.initialMp).toEqual([2, 5]);
  expect(battle.turns[0].hp).toEqual([8, 9]);
  expect(battle.turns.every(t => t.mp[0] === 2)).toBe(true);
  expect(resources).toEqual({ hp: [8, 15], mp: [2, 5] });
});

it('chooses the strongest learned affordable attack, spends MP, and falls back to free Claw Strike', () => {
  const caster = { id: 'caster', strength: 4, intelligence: 6, charisma: 30, abilities: ['firebolt', 'heavy-strike'] as const };
  const tank = { id: 'target', strength: 1, intelligence: 1, charisma: 100 };
  const battle = simulateBattle(caster, tank, [44, 103], { hp: [40, 102], mp: [5, 1] });
  const turns = battle.turns.filter(t => t.actor === 0);
  expect(turns.slice(0, 3).map(t => [t.ability, t.damage, t.mp[0]])).toEqual([
    ['firebolt', 9, 2], ['heavy-strike', 6, 0], ['claw-strike', 4, 0],
  ]);
  expect(battle.fighters[1].abilities).toEqual(['claw-strike']);
  expect(battle.turns.every(t => t.mp.every(value => value >= 0))).toBe(true);
});

it('breaks equal-damage ability ties in favor of lower MP cost', () => {
  const pet = { id: 'a', strength: 6, intelligence: 6, charisma: 20, abilities: ['firebolt', 'heavy-strike'] as const };
  const other = { id: 'b', strength: 1, intelligence: 1, charisma: 99 };
  const battle = simulateBattle(pet, other, [38, 10]);
  expect(battle.turns[0]).toMatchObject({ ability: 'heavy-strike', damage: 9, mp: [4, 1] });
});

it('groups long learned-ability battles only while the same attacks remain affordable', () => {
  const tank = { id: 'a', strength: 10, intelligence: 1000, charisma: 100000, abilities: ['heavy-strike'] as const };
  const battle = simulateBattle(tank, { ...tank, id: 'b' }, [101020, 101020]);
  expect(battle.turns.length).toBeLessThan(80);
  expect(battle.turns.some(t => t.hits > 1 && t.ability === 'heavy-strike')).toBe(true);
  for (const actor of [0, 1]) {
    const turns = battle.turns.filter(t => t.actor === actor);
    expect(turns.filter(t => t.ability === 'heavy-strike').reduce((sum, t) => sum + t.hits, 0)).toBe(500);
    expect(turns.reduce((sum, t) => sum + t.mpCost!, 0)).toBe(1000);
  }
  expect(battle.turns.at(-1)!.mp).toEqual([0, 0]);
  expect(battle.winner).toBe('b');
});
