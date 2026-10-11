import { expect, it } from 'vitest';
import { ABILITIES, simulateBattle } from '../src/combat.ts';

const a = { id: 'a', strength: 5, intelligence: 7, charisma: 3 };
const b = { id: 'b', strength: 5, intelligence: 5, charisma: 5 };
it('starts with the sum of attributes as HP, intelligence as MP, and only free Claw Strike', () => {
  expect(ABILITIES).toEqual([{ id: 'claw-strike', name: 'Claw Strike', mpCost: 0 }]);
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
