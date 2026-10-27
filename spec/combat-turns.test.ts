// Compatibility coverage for battles saved before the attribute-skill update.
import { expect, it } from 'vitest';
import {
  forfeitBattle, startBattle, takeBattleTurn,
  type ActiveBattle, type BattleActionError, type PetStats,
} from '../src/legacy-combat.ts';

const pet: PetStats = { id: 'pet', strength: 5, intelligence: 6, charisma: 9 };
const rival: PetStats = { id: 'rival', strength: 4, intelligence: 4, charisma: 14 };
const monster: PetStats = { id: 'monster:slime', monster: 'slime', strength: 2, intelligence: 1, charisma: 30 };
const power = (fighter: PetStats) => 2 * fighter.strength + fighter.intelligence + fighter.charisma;
function next(result: ActiveBattle | BattleActionError): ActiveBattle {
  expect(result).not.toHaveProperty('error');
  if ('error' in result) throw new Error(result.error);
  return result;
}

it('live PvP waits for an explicit skill choice on every human turn, including after JSON restoration', () => {
  const battle = startBattle([pet], rival, [power(pet), power(rival)], { random: () => 0 });
  expect(battle).toMatchObject({ status: 'active', winner: '', actor: 1, revision: 0, turns: [] });
  expect(battle.initiative).toEqual({ toss: 'heads', coin: null, provider: 1, providerId: 'rival' });
  const restored = JSON.parse(JSON.stringify(battle)) as ActiveBattle;
  const advanced = next(takeBattleTurn(restored, 'rival', 'claw-strike', 0));
  expect(advanced).toMatchObject({ status: 'active', winner: '', actor: 0, revision: 1 });
  expect(advanced.turns).toHaveLength(1);
  expect(advanced.turns[0]).toMatchObject({ actor: 1, target: 0, ability: 'claw-strike', damage: 4 });
  expect(advanced.hp).toEqual([16, 22]);
  expect(battle.turns).toEqual([]);
  expect(restored.turns).toEqual([]);
  expect(next(takeBattleTurn(advanced, 'pet', 'claw-strike', 1)).actor).toBe(1);
});

it('the stronger PvP defender supplies Silver or Gold instead of the initiating pet', () => {
  const attacker = { ...pet, equippedCoin: 'silver-coin' as const };
  const defender = { ...rival, equippedCoin: 'gold-coin' as const };
  let battle = startBattle([attacker], defender, [power(attacker), power(defender)]);
  expect(battle).toMatchObject({ actor: 0, coinProvider: 1, goldPending: true });
  expect(battle.initiative).toMatchObject({ coin: 'gold-coin', provider: 1, toss: null });
  battle = next(takeBattleTurn(battle, pet.id, 'claw-strike', battle.revision));
  battle = next(takeBattleTurn(battle, rival.id, 'claw-strike', battle.revision));
  expect(battle.turns.map(turn => turn.damage)).toEqual([5, 8]);
  battle = next(takeBattleTurn(battle, pet.id, 'claw-strike', battle.revision));
  battle = next(takeBattleTurn(battle, rival.id, 'claw-strike', battle.revision));
  expect(battle.turns.at(-1)!.damage).toBe(4);
  const silver = startBattle([attacker], { ...rival, equippedCoin: 'silver-coin' }, [power(attacker), power(rival)]);
  expect(silver.actor).toBe(1);
});

it('raw attribute ties keep the initiating pet as provider; a losing Copper cannot change the comparison', () => {
  const tied = { ...pet, id: 'tied', equippedCoin: 'gold-coin' as const };
  expect(startBattle([{ ...pet, equippedCoin: 'silver-coin' }], tied, [25, 25]).coinProvider).toBe(0);
  const copper = startBattle([{ ...pet, equippedCoin: 'copper-coin' }], rival, [25, 26], { random: () => 0 });
  expect(copper.coinProvider).toBe(1);
  expect(copper.fighters[0].maxHp).toBe(20);
  expect(copper.initiative!.coin).toBeNull();
});

it('solo monster battles always use the player’s coin, regardless of the monster’s attributes', () => {
  const king = { ...monster, charisma: 1000, equippedCoin: 'gold-coin' as const };
  const battle = startBattle([{ ...pet, equippedCoin: 'silver-coin' }], king, [power(pet), power(king)]);
  expect(battle).toMatchObject({ actor: 0, coinProvider: 0, turns: [], monsterIndex: 1 });
  expect(battle.initiative!.coin).toBe('silver-coin');
});

it('Copper boosts only the strongest participating teammate and preserves raw-roll luck and carried resources', () => {
  const copper = { ...rival, equippedCoin: 'copper-coin' as const };
  const battle = startBattle([pet, copper], monster, [power(pet), power(copper), power(monster)], {
    hp: [7, 8, 33], mp: [2, 1, 1], random: () => 0,
  });
  expect(battle.coinProvider).toBe(1);
  expect(battle.initialHp).toEqual([7, 11, 33]);
  expect(battle.initialMp).toEqual([2, 2, 1]);
  expect(battle.fighters.map(fighter => [fighter.maxHp, fighter.maxMp, fighter.damage])).toEqual([
    [20, 6, 5], [25, 5, 5], [33, 1, 2],
  ]);
  expect(copper).toMatchObject({ strength: 4, intelligence: 4, charisma: 14 });
});

it('team turns wait for each teammate, then advance the monster once and return to the first living pet', () => {
  let battle = startBattle([{ ...pet, equippedCoin: 'silver-coin' }, rival], monster,
    [power(pet), power(rival), power(monster)], { random: () => 0 });
  expect(battle.actor).toBe(0);
  battle = next(takeBattleTurn(battle, pet.id, 'claw-strike', battle.revision));
  expect(battle.actor).toBe(1);
  expect(battle.turns).toHaveLength(1);
  battle = next(takeBattleTurn(battle, rival.id, 'claw-strike', battle.revision));
  expect(battle.actor).toBe(0);
  expect(battle.turns.map(turn => [turn.actor, turn.target])).toEqual([[0, 2], [1, 2], [2, 1]]);
  expect(battle.revision).toBe(3);
});

it('Gold doubles the stronger teammate’s own first move without doubling the initiating teammate', () => {
  let battle = startBattle([pet, { ...rival, equippedCoin: 'gold-coin' }], monster,
    [power(pet), power(rival), power(monster)]);
  expect(battle.turns.map(turn => turn.actor)).toEqual([2]);
  expect(battle.actor).toBe(0);
  battle = next(takeBattleTurn(battle, pet.id, 'claw-strike', battle.revision));
  battle = next(takeBattleTurn(battle, rival.id, 'claw-strike', battle.revision));
  expect(battle.turns.slice(0, 3).map(turn => [turn.actor, turn.damage])).toEqual([[2, 2], [0, 5], [1, 8]]);
  expect(battle.goldPending).toBe(false);
});

it('only equipped pet skills are offered; spending MP is server-validated and never falls back to an automatic attack', () => {
  const caster = { ...pet, equippedCoin: 'silver-coin' as const,
    abilities: ['firebolt', 'heavy-strike'] as const, equippedAbilities: ['firebolt', 'bump'] as const };
  const battle = startBattle([caster], monster, [power(caster), power(monster)], { mp: [3, 1] });
  expect(battle.fighters[0].abilities).toEqual(['claw-strike', 'firebolt']);
  expect(battle.attacks[0]).toEqual([
    expect.objectContaining({ id: 'claw-strike', damage: 5, mpCost: 0 }),
    expect.objectContaining({ id: 'firebolt', damage: 9, mpCost: 3 }),
  ]);
  expect(takeBattleTurn(battle, pet.id, 'heavy-strike', battle.revision)).toMatchObject({ status: 400 });
  expect(takeBattleTurn(battle, pet.id, 'bump', battle.revision)).toMatchObject({ status: 400 });
  const spent = next(takeBattleTurn(battle, pet.id, 'firebolt', battle.revision));
  expect(spent.mp[0]).toBe(0);
  expect(spent.turns.map(turn => turn.actor)).toEqual([0, 1]);
  expect(takeBattleTurn(spent, pet.id, 'firebolt', spent.revision)).toMatchObject({ status: 409 });
  expect(spent.turns).toHaveLength(2);
  expect(next(takeBattleTurn(spent, pet.id, 'claw-strike', spent.revision)).mp[0]).toBe(0);
});

it('out-of-turn, stale, malformed and unknown skill requests leave the saved battle untouched', () => {
  const battle = startBattle([{ ...pet, equippedCoin: 'silver-coin' }], monster, [power(pet), power(monster)]);
  const before = JSON.stringify(battle);
  expect(takeBattleTurn(battle, 'someone-else', 'claw-strike', 0)).toMatchObject({ status: 403 });
  expect(takeBattleTurn(battle, pet.id, 'claw-strike', '0')).toMatchObject({ status: 409 });
  expect(takeBattleTurn(battle, pet.id, 'claw-strike', 1)).toMatchObject({ status: 409 });
  expect(takeBattleTurn(battle, pet.id, {}, 0)).toMatchObject({ status: 400 });
  expect(JSON.stringify(battle)).toBe(before);
  const advanced = next(takeBattleTurn(battle, pet.id, 'claw-strike', 0));
  expect(takeBattleTurn(advanced, pet.id, 'claw-strike', 0)).toMatchObject({ status: 409 });
});

it('monster AI can strike first, uses Bump’s current-target HP, and never skips the next player choice', () => {
  const tank = { id: 'tank', strength: 1, intelligence: 1, charisma: 100, equippedCoin: 'gold-coin' as const };
  const king: PetStats = { id: 'king', monster: 'slime-king', strength: 18, intelligence: 10, charisma: 12, abilities: ['bump'] };
  const battle = startBattle([tank], king, [power(tank), power(king)]);
  expect(battle).toMatchObject({ status: 'active', actor: 0, revision: 1, hp: [34, 40], mp: [1, 5] });
  expect(battle.turns[0]).toMatchObject({ ability: 'bump', damage: 68 });
  const advanced = next(takeBattleTurn(battle, tank.id, 'claw-strike', battle.revision));
  expect(advanced.turns.at(-1)).toMatchObject({ actor: 1, ability: 'bump', damage: 23 });
  expect(advanced.mp[1]).toBe(0);
  expect(advanced.actor).toBe(0);
});

it('knocked-out teammates are skipped and a monster knockout completes without an extra enemy turn', () => {
  let battle = startBattle([pet, { ...rival, equippedCoin: 'copper-coin' }], monster,
    [power(pet), power(rival), power(monster)], { hp: [20, 0, 4], random: () => 0 });
  expect(battle.initialHp).toEqual([20, 0, 4]);
  expect(battle.actor).toBe(0);
  battle = next(takeBattleTurn(battle, pet.id, 'claw-strike', battle.revision));
  expect(battle).toMatchObject({ status: 'finished', winner: pet.id, actor: null, hp: [20, 0, 0] });
  expect(battle.turns).toHaveLength(1);
  expect(takeBattleTurn(battle, pet.id, 'claw-strike', battle.revision)).toMatchObject({ status: 409 });
});

it('a player can lose to the opening monster strike without generating any player attack', () => {
  const battle = startBattle([{ ...pet, equippedCoin: 'gold-coin' }], monster,
    [power(pet), power(monster)], { hp: [1, 33] });
  expect(battle).toMatchObject({ status: 'finished', actor: null, winner: monster.id, hp: [0, 33] });
  expect(battle.turns.map(turn => turn.actor)).toEqual([1]);
});

it('forfeiting PvP ends the fight for the opponent without fabricating an attack', () => {
  const battle = startBattle([pet], rival, [power(pet), power(rival)], { random: () => 0 });
  const ended = next(forfeitBattle(battle, pet.id, battle.revision));
  expect(ended).toMatchObject({ status: 'finished', winner: rival.id, actor: null, revision: 1, forfeited: [0], hp: [0, 22], turns: [] });
  expect(battle.hp).toEqual([20, 22]);
  expect(forfeitBattle(battle, 'outsider')).toMatchObject({ status: 403 });
  expect(forfeitBattle(battle, pet.id, 20)).toMatchObject({ status: 409 });
});

it('a teammate can forfeit its current turn while the others continue manually, including after restoration', () => {
  let battle = startBattle([pet, rival], monster, [power(pet), power(rival), power(monster)], { random: () => 0 });
  battle = next(forfeitBattle(battle, pet.id));
  expect(battle).toMatchObject({ actor: 1, revision: 1, hp: [0, 22, 33], turns: [], forfeited: [0] });
  battle = next(takeBattleTurn(JSON.parse(JSON.stringify(battle)), rival.id, 'claw-strike', battle.revision));
  expect(battle.actor).toBe(1);
  expect(battle.turns.map(turn => turn.actor)).toEqual([1, 2]);
  expect(forfeitBattle(battle, pet.id)).toEqual(battle);
  expect(next(forfeitBattle(battle, rival.id))).toMatchObject({ status: 'finished', winner: monster.id });
});

it('forfeiting the last teammate in a round advances the monster and skips that teammate on future rounds', () => {
  let battle = startBattle([pet, rival], monster, [power(pet), power(rival), power(monster)], { random: () => 0 });
  battle = next(takeBattleTurn(battle, pet.id, 'claw-strike', battle.revision));
  battle = next(forfeitBattle(battle, rival.id));
  expect(battle).toMatchObject({ actor: 0, revision: 3, hp: [18, 0, 28], forfeited: [1] });
  expect(battle.turns.map(turn => turn.actor)).toEqual([0, 2]);
});

it('the explicitly configured training bot may respond automatically, while the human still chooses every move', () => {
  const bot = { ...rival, id: '0', equippedCoin: 'silver-coin' as const };
  const battle = startBattle([pet], bot, [power(pet), power(bot)], { automaticIds: ['0'] });
  expect(battle).toMatchObject({ actor: 0, revision: 1 });
  expect(battle.turns.map(turn => turn.actor)).toEqual([1]);
  const advanced = next(takeBattleTurn(battle, pet.id, 'claw-strike', battle.revision));
  expect(advanced.turns.map(turn => turn.actor)).toEqual([1, 0, 1]);
  expect(advanced.actor).toBe(0);
});

// A balanced caster: Claw Strike hits for 6 and each elemental skill for 9
// before types, so ×2 is 18 and ×½ rounds up to 5.
const caster: PetStats = {
  id: 'caster', strength: 6, intelligence: 6, charisma: 6, equippedCoin: 'silver-coin',
  abilities: ['firebolt', 'heavy-strike', 'tide-crash', 'vine-lash'],
  equippedAbilities: ['claw-strike', 'firebolt', 'tide-crash', 'vine-lash'],
};
const target = (kind: 'slime' | 'goblin' | 'slime-king'): PetStats => ({ id: `monster:${kind}`, monster: kind, strength: 1, intelligence: 1, charisma: 200 });
const hit = (battle: ActiveBattle, ability: string) => next(takeBattleTurn(battle, caster.id, ability, battle.revision)).turns[0];

it.each([
  ['slime', 'grass', { 'claw-strike': 6, firebolt: 18, 'tide-crash': 5, 'vine-lash': 5 }],
  ['goblin', 'earth', { 'claw-strike': 6, firebolt: 5, 'tide-crash': 18, 'vine-lash': 5 }],
  ['slime-king', 'water', { 'claw-strike': 6, firebolt: 5, 'tide-crash': 5, 'vine-lash': 18 }],
] as const)('typed skills hit a %s (%s type) twice as hard when super effective and half as hard otherwise', (kind, type, expected) => {
  const battle = startBattle([caster], target(kind), [power(caster), power(target(kind))], { mp: [20, 1] });
  expect(battle.fighters[1]).toMatchObject({ monster: kind, type });
  expect(battle.fighters[0]).not.toHaveProperty('type');
  expect(battle.attacks[0].map(attack => [attack.id, attack.type, attack.damage])).toEqual([
    ['claw-strike', 'normal', 6], ['firebolt', 'fire', 9], ['tide-crash', 'water', 9], ['vine-lash', 'grass', 9],
  ]);
  for (const [ability, damage] of Object.entries(expected)) {
    const turn = hit(battle, ability);
    expect(turn, ability).toMatchObject({ ability, damage, hp: [18, 202 - damage] });
    const scale = damage === 18 ? 2 : damage === 5 ? 0.5 : undefined;
    if (scale) expect(turn.effectiveness, ability).toBe(scale);
    else expect(turn, ability).not.toHaveProperty('effectiveness');
  }
});

it('keeps PvP neutral: pets have no type, so typed skills deal their base damage to another pet', () => {
  const rivalPet: PetStats = { id: 'rival', strength: 1, intelligence: 1, charisma: 200 };
  // The rival's larger total supplies the coin; heads (random 0) lets it lead
  // with the caster still choosing every move after the rival's opening hit.
  const opened = startBattle([caster], rivalPet, [power(caster), power(rivalPet)], { mode: 'pvp', mp: [20, 1], random: () => 0 });
  const battle = next(takeBattleTurn(opened, rivalPet.id, 'claw-strike', opened.revision));
  expect(battle.actor).toBe(0);
  expect(battle.fighters.map(fighter => fighter.type)).toEqual([undefined, undefined]);
  for (const [ability, damage] of [['claw-strike', 6], ['firebolt', 9], ['tide-crash', 9], ['vine-lash', 9]] as const) {
    const turn = next(takeBattleTurn(battle, caster.id, ability, battle.revision)).turns[1];
    expect(turn, ability).toMatchObject({ damage });
    expect(turn, ability).not.toHaveProperty('effectiveness');
  }
});

it('scales each elemental skill on its own attribute and keeps a halved hit at 1 damage or more', () => {
  const lopsided: PetStats = { ...caster, strength: 2, intelligence: 4, charisma: 10 };
  const battle = startBattle([lopsided], target('goblin'), [power(lopsided), power(target('goblin'))], { mp: [4, 1] });
  // Attribute × 1.5 at the same scale as Claw Strike's Strength (2).
  expect(battle.attacks[0].map(attack => [attack.id, attack.damage])).toEqual([
    ['claw-strike', 2], ['firebolt', 6], ['tide-crash', 3], ['vine-lash', 15],
  ]);
  const weak: PetStats = { id: 'weak', strength: 1, intelligence: 3, charisma: 1, equippedCoin: 'silver-coin', abilities: ['firebolt'], equippedAbilities: ['firebolt'] };
  const king = target('slime-king');
  const small = startBattle([weak], king, [power(weak) / 3, power(king)], { mp: [5, 1] });
  expect(small.attacks[0].find(attack => attack.id === 'firebolt')!.damage).toBe(2);
  expect(next(takeBattleTurn(small, weak.id, 'firebolt', small.revision)).turns[0]).toMatchObject({ damage: 1, effectiveness: 0.5 });
});

it('Gold doubles a super-effective first hit, and a monster’s own attacks still deal their usual damage', () => {
  const gold = { ...caster, equippedCoin: 'gold-coin' as const };
  const slime: PetStats = { ...target('slime'), strength: 4, intelligence: 1, charisma: 60 };
  let battle = startBattle([gold], slime, [power(gold), power(slime)], { mp: [20, 1] });
  // Gold puts the slime first; its free Claw Strike ignores the pet's (absent) type.
  expect(battle.turns[0]).toMatchObject({ actor: 1, ability: 'claw-strike', damage: 4, type: 'normal' });
  expect(battle.turns[0]).not.toHaveProperty('effectiveness');
  battle = next(takeBattleTurn(battle, gold.id, 'firebolt', battle.revision));
  // 9 base × 2 for Fire on Grass × 2 for Gold's first strike.
  expect(battle.turns[1]).toMatchObject({ actor: 0, ability: 'firebolt', damage: 36, effectiveness: 2, hp: [14, 29] });
});

it('replays and resumes battles saved before types without type effects', () => {
  const kept = startBattle([caster], target('slime'), [power(caster), power(target('slime'))], { mp: [20, 1] });
  // A battle saved before types has no fighter or attack types.
  const legacy = JSON.parse(JSON.stringify(kept)) as ActiveBattle;
  delete legacy.fighters[1].type;
  for (const attacks of legacy.attacks) for (const attack of attacks) delete attack.type;
  expect(hit(legacy, 'firebolt')).toMatchObject({ damage: 9 });
  expect(hit(legacy, 'firebolt')).not.toHaveProperty('effectiveness');
  expect(hit(kept, 'firebolt')).toMatchObject({ damage: 18, effectiveness: 2 });
});
