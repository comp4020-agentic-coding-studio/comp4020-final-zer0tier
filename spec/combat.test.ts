import { expect, it } from 'vitest';
import { ABILITIES, coinEffect, MONSTER_ABILITIES, simulateBattle, simulateTeamBattle } from '../src/combat.ts';

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

it('tosses a fair coin for initiative with no coin equipped (heads: fighter 0 first), and leaves damage unboosted', () => {
  expect(coinEffect(null, () => 0.49)).toEqual({ first: 0, doubleFirstStrike: false, attributeBonus: 0, toss: 'heads', coin: null });
  expect(coinEffect(undefined, () => 0.5)).toEqual({ first: 1, doubleFirstStrike: false, attributeBonus: 0, toss: 'tails', coin: null });
});
it('Copper adds an attribute bonus without changing the coin toss odds', () => {
  expect(coinEffect('copper-coin', () => 0.49)).toEqual({ first: 0, doubleFirstStrike: false, attributeBonus: 1, toss: 'heads', coin: 'copper-coin' });
  expect(coinEffect('copper-coin', () => 0.5)).toEqual({ first: 1, doubleFirstStrike: false, attributeBonus: 1, toss: 'tails', coin: 'copper-coin' });
});
it('Silver always goes first and Gold always goes second, replacing the toss', () => {
  for (const random of [() => 0, () => 0.999999]) {
    expect(coinEffect('silver-coin', random)).toEqual({ first: 0, doubleFirstStrike: false, attributeBonus: 0, toss: null, coin: 'silver-coin' });
    expect(coinEffect('gold-coin', random)).toEqual({ first: 1, doubleFirstStrike: true, attributeBonus: 0, toss: null, coin: 'gold-coin' });
  }
});
it('saves how initiative was decided with the battle, so replays can show the toss', () => {
  const tails = simulateBattle(a, b, [24, 16], coinEffect(null, () => 0.5));
  expect(tails.initiative).toEqual({ toss: 'tails', coin: null });
  expect(tails.turns[0].actor).toBe(1);
  const silver = simulateBattle(a, b, [10, 24], { hp: [8, 15], ...coinEffect('silver-coin') });
  expect(silver.initiative).toEqual({ toss: null, coin: 'silver-coin' });
  expect(silver.turns[0].actor).toBe(0);
  expect(simulateBattle(a, b, [24, 16], { first: 0 })).not.toHaveProperty('initiative');
});
it('an explicit first option overrides the rolls comparison (Silver-style: fighter 0 always first)', () => {
  // Rolls alone would put b first (16 < 24 is false... use a losing roll for a).
  const battle = simulateBattle(a, b, [10, 24], { first: 0 });
  expect(battle.turns[0].actor).toBe(0);
});
it("doubleFirstStrike doubles only fighter 0's own first hit, even when it goes second (Gold-style)", () => {
  const battle = simulateBattle(a, b, [24, 16], { first: 1, doubleFirstStrike: true });
  expect(battle.turns[0].actor).toBe(1);
  const zeroTurns = battle.turns.filter(t => t.actor === 0);
  expect(battle.fighters[0].damage).toBe(6);
  expect(zeroTurns[0].damage).toBe(12);
  // A later hit (uncapped by the target's remaining HP) is not doubled.
  const plainTurns = simulateBattle(a, b, [24, 16], { first: 0 }).turns.filter(t => t.actor === 0);
  expect(plainTurns[1].damage).toBe(6);
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
it("Bump deals two-thirds of the target's current HP, rounded up, for 5 MP, and gives way to a harder Claw Strike", () => {
  expect(MONSTER_ABILITIES).toEqual([expect.objectContaining({ id: 'bump', name: 'Bump', mpCost: 5 })]);
  const king = { id: 'king', strength: 18, intelligence: 10, charisma: 12, abilities: ['bump'] as const }; // Claw Strike 18
  // A 102 HP pet: Bump beats Claw Strike twice (68, then ceil(34 × 2/3) = 23); at 0 MP the king falls back to Claw.
  const tank = simulateBattle({ id: 'tank', strength: 1, intelligence: 1, charisma: 100 }, king, [103, 58], { first: 1 });
  expect(tank.fighters[1].abilities).toEqual(['claw-strike', 'bump']);
  expect(tank.turns.filter(t => t.actor === 1).map(t => [t.ability, t.damage, t.mpCost, t.mp[1]])).toEqual([
    ['bump', 68, 5, 5], ['bump', 23, 5, 0], ['claw-strike', 11, 0, 0],
  ]);
  // A 20 HP pet: Claw Strike's 18 beats Bump's 14, so the king keeps its MP.
  const small = simulateBattle({ id: 'small', strength: 1, intelligence: 1, charisma: 18 }, king, [21, 58], { first: 1 });
  expect(small.turns.filter(t => t.actor === 1).every(t => t.ability === 'claw-strike' && t.mp[1] === 10)).toBe(true);
  // Pets never learn it, even if their saved abilities somehow named it.
  expect(ABILITIES.map(ability => ability.id)).not.toContain('bump');
});
it('never groups Bump into multi-hit rounds, even past the turn where long battles start grouping', () => {
  // ~10^15 HP keeps Bump the stronger attack for over 30 of the king's turns.
  const king = { id: 'king', strength: 1, intelligence: 1000, charisma: 1, abilities: ['bump'] as const };
  const tank = { id: 'tank', strength: 1, intelligence: 1, charisma: 1e15 };
  const battle = simulateBattle(tank, king, [1e15 + 3, 1003], { first: 1 });
  const bumps = battle.turns.map((turn, i) => ({ turn, i, before: i ? battle.turns[i - 1].hp[0] : 1e15 + 2 }))
    .filter(({ turn }) => turn.ability === 'bump');
  expect(bumps.at(-1)!.i).toBeGreaterThanOrEqual(60);
  for (const { turn, before } of bumps) expect(turn).toMatchObject({ hits: 1, damage: Math.ceil(before * 2 / 3) });
});

it('a team battle: every standing pet strikes in turn, then the monster hits whichever pet has the most HP', () => {
  // Rolls of half each fighter's power make each Claw Strike exactly half its strength.
  const rex = { id: 'rex', strength: 4, intelligence: 1, charisma: 1 }; // 6 HP, hits for 2
  const ace = { id: 'ace', strength: 6, intelligence: 1, charisma: 1 }; // 8 HP, hits for 3
  const goblin = { id: 'monster:g', strength: 10, intelligence: 1, charisma: 9 }; // 20 HP, hits for 5
  const battle = simulateTeamBattle([rex, ace], goblin, [5, 7, 15], { hp: [6, 8, 20], mp: [1, 1, 1], first: 0 });
  expect(battle.fighters.map(f => f.id)).toEqual(['rex', 'ace', 'monster:g']);
  expect(battle.turns.map(t => [t.actor, t.target, t.damage, t.hp])).toEqual([
    [0, 2, 2, [6, 8, 18]], [1, 2, 3, [6, 8, 15]], [2, 1, 5, [6, 3, 15]], // ace has more HP, so it's hit
    [0, 2, 2, [6, 3, 13]], [1, 2, 3, [6, 3, 10]], [2, 0, 5, [1, 3, 10]], // now rex has more
    [0, 2, 2, [1, 3, 8]], [1, 2, 3, [1, 3, 5]], [2, 1, 3, [1, 0, 5]], // ace is knocked out and drops out
    [0, 2, 2, [1, 0, 3]], [2, 0, 1, [0, 0, 3]],
  ]);
  expect(battle.winner).toBe('monster:g');
  expect(battle.initialHp).toEqual([6, 8, 20]);
});

it('a team can win with a pet knocked out; tails puts the monster first, and Gold doubles only the first pet\'s first hit', () => {
  const rex = { id: 'rex', strength: 4, intelligence: 1, charisma: 1 };
  const ace = { id: 'ace', strength: 6, intelligence: 1, charisma: 1 };
  const slime = { id: 'monster:s', strength: 10, intelligence: 1, charisma: 1 }; // 12 HP, hits for 5
  const tails = simulateTeamBattle([rex, ace], slime, [5, 7, 11], { hp: [6, 4, 12], mp: [1, 1, 1], ...coinEffect(null, () => 0.5) });
  expect(tails.initiative).toEqual({ toss: 'tails', coin: null });
  expect(tails.turns.map(t => [t.actor, t.target, t.damage])).toEqual([
    [2, 0, 5], [0, 2, 2], [1, 2, 3], [2, 1, 4], [0, 2, 2], [2, 0, 1],
  ]);
  expect(tails.winner).toBe('monster:s');
  // Gold: the monster goes first, then rex's first hit is doubled (4), never again.
  const gold = simulateTeamBattle([rex, ace], slime, [5, 7, 11], { hp: [6, 8, 12], mp: [1, 1, 1], ...coinEffect('gold-coin') });
  expect(gold.turns.map(t => [t.actor, t.target, t.damage])).toEqual([
    [2, 1, 5], [0, 2, 4], [1, 2, 3], [2, 0, 5], [0, 2, 2], [1, 2, 3],
  ]);
  expect(gold.turns.at(-1)!.hp).toEqual([1, 3, 0]);
  expect(gold.winner).toBe('rex'); // the team's win
  // A team can win with a teammate down: ace falls, then rex finishes the slime.
  const costly = simulateTeamBattle([rex, ace], slime, [5, 7, 11], { hp: [6, 3, 7], mp: [1, 1, 1], first: 1 });
  expect(costly.turns.map(t => [t.actor, t.target, t.hp])).toEqual([
    [2, 0, [1, 3, 7]], [0, 2, [1, 3, 5]], [1, 2, [1, 3, 2]], [2, 1, [1, 0, 2]], [0, 2, [1, 0, 0]],
  ]);
  expect(costly.winner).toBe('rex');
});
