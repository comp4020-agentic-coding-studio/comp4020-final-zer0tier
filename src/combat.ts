import * as legacy from './legacy-combat.ts';
import { SKILLS, CHEST_SKILLS, type Attribute, type AttributeType, type SkillId } from './skills.ts';
export { coinEffect, simulateBattle, simulateTeamBattle } from './legacy-combat.ts';
export type { CoinEffect, Initiative, BattleActionError, MonsterKind, MonsterAbilityId } from './legacy-combat.ts';
export type TrainedAttribute = Attribute;
export type AbilityId = legacy.AbilityId | SkillId;
export type Element = legacy.Element | AttributeType;
export const ELEMENTS = ['normal', 'str', 'cha', 'int'] as const;
export const TYPE_CHART = { normal: {}, str: { cha: 1.2, int: 0.8 }, cha: { int: 1.2, str: 0.8 }, int: { str: 1.2, cha: 0.8 } };
// Kept for old clients; new monster views derive their type from their stats.
export const MONSTER_TYPES = { slime: 'str', goblin: 'str', 'slime-king': 'str' } as const;
export const effectiveness = (a: Element, b: Element | undefined): number => {
  if (!b) return 1;
  return (TYPE_CHART as Record<string, Record<string, number>>)[a]?.[b] ?? 1;
};
export const weaknessOf = (type: Element) => ELEMENTS.filter(t => effectiveness(t, type) > 1);
const trainsFor = (type: AttributeType): Attribute | null => ({ str: 'strength', cha: 'charisma', int: 'intelligence', normal: null } as const)[type];
// Existing learned moves remain usable. Only the 30 new skills have acquisition sources.
export const ABILITIES = [
  ...legacy.ABILITIES.map(a => ({ ...a, type: a.id === 'firebolt' ? 'int' as const : a.id === 'tide-crash' ? 'str' as const : a.id === 'vine-lash' ? 'cha' as const : 'normal' as const,
    category: a.id === 'claw-strike' ? 'Basic' as const : 'Attack' as const,
    power: a.id === 'claw-strike' ? 40 : 60, accuracy: 100 as number | 'sure-hit',
    description: a.id === 'claw-strike' ? 'A free STR-based starter attack. Restore 1 MP, even on a miss.' : `Legacy skill. ${a.description}` })),
  ...SKILLS.map(s => ({ ...s, trains: trainsFor(s.type) })),
];
export const LEARNABLE_ABILITIES = CHEST_SKILLS;
export type LearnableAbilityId = SkillId | Exclude<legacy.AbilityId, 'claw-strike' | 'bump'>;
export const MONSTER_ABILITIES = legacy.MONSTER_ABILITIES;
export type Stats = Record<Attribute, number>;
export type PetStats = Omit<legacy.PetStats, 'abilities' | 'equippedAbilities'> & { abilities?: readonly AbilityId[]; equippedAbilities?: readonly AbilityId[] };
export type Fighter = Omit<legacy.Fighter, 'type'> & { type?: Element; baseStats?: Stats; stats?: Stats; luck?: number };
export type BattleTurn = Omit<legacy.BattleTurn, 'ability' | 'type'> & {
  ability: AbilityId; type?: Element; missed?: boolean; events?: string[]; maxHp?: number[]; maxMp?: number[]; types?: Element[];
};
export type Battle = Omit<legacy.Battle, 'fighters' | 'turns'> & {
  fighters: Fighter[]; turns: BattleTurn[]; initialMaxHp?: number[]; initialMaxMp?: number[]; initialTypes?: Element[];
};
export type BattleAttack = Omit<legacy.BattleAttack, 'id' | 'type'> & {
  id: AbilityId; type?: Element; power?: number; accuracy?: number | 'sure-hit'; category?: string;
  currentMpCost?: number; unavailable?: string; hitChance?: number;
};
export type Effect = { id: string; name: string; expires: number; attribute?: Attribute | 'all'; amount?: number };
export type FighterState = { effects: Effect[]; lastMissed: boolean; surcharge: boolean };
export type ActiveBattle = Omit<legacy.ActiveBattle, keyof Battle | 'attacks'> & Battle & {
  attacks: BattleAttack[][]; rulesVersion?: 2; states?: FighterState[]; fieldUntil?: number; rng?: number;
  restoredHp?: number[]; restoredMp?: number[]; resourceBonus?: { hp: number; mp: number }[];
};
export type StartBattleOptions = legacy.StartBattleOptions;
export const isActiveBattle = (battle: Battle): battle is ActiveBattle => 'status' in battle && 'actor' in battle && 'revision' in battle;
export const maxHpFor = (stats: Stats) => Math.max(1, Math.floor(10 + 3 * stats.strength));
export const maxMpFor = (stats: Stats) => 5 + Math.floor(Math.max(0, stats.intelligence - 5) / 5);
export function mainAttribute(stats: Stats): AttributeType {
  const ordered = (['strength', 'charisma', 'intelligence'] as Attribute[]).sort((a, b) => stats[b] - stats[a]);
  const [first, second] = ordered;
  if (stats[first] > stats[second] && stats[first] >= stats[second] * 1.2) return ({ strength: 'str', charisma: 'cha', intelligence: 'int' } as const)[first];
  return 'normal';
}
export const balancedStats = (stats: Stats) => {
  const values = [stats.strength, stats.charisma, stats.intelligence];
  return Math.max(...values) <= 1.2 * Math.min(...values);
};
export function withAttributeBonus<T extends PetStats>(pet: T, bonus: number): T {
  return { ...pet, strength: pet.strength + bonus, charisma: pet.charisma + bonus, intelligence: pet.intelligence + bonus };
}
export function battleTraining(battle: Battle, index: number, random = Math.random): Attribute | undefined {
  const last = battle.turns.findLast(t => t.actor === index && t.damage > 0);
  if (!last) return;
  return ABILITIES.find(a => a.id === last.ability)?.trains ?? (['strength', 'intelligence', 'charisma'] as const)[Math.floor(random() * 3)];
}
const total = (p: Stats) => p.strength + p.charisma + p.intelligence;
const powerOf = (p: Stats) => total(p) + p.strength;
const has = (b: ActiveBattle, i: number, id: string) => b.states![i].effects.some(e => e.id === id && e.expires > b.revision);
function effectiveStats(b: ActiveBattle, i: number): Stats {
  const base = b.fighters[i].baseStats!;
  const stats = { ...base };
  for (const key of ['strength', 'charisma', 'intelligence'] as const) {
    const amounts = b.states![i].effects.filter(e => (e.attribute === key || e.attribute === 'all') && e.expires > b.revision).map(e => e.amount ?? 0);
    // Recasts refresh; different boosts/debuffs use the strongest of each sign.
    stats[key] = Math.max(0, base[key] * (1 + Math.max(0, ...amounts)) * (1 + Math.min(0, ...amounts)));
  }
  return stats;
}
function targetOf(b: ActiveBattle, actor: number): number {
  if (b.monsterIndex === null) return 1 - actor;
  if (actor !== b.monsterIndex) return b.monsterIndex;
  return b.hp.reduce((best, hp, i) => i !== b.monsterIndex && hp > 0 && (best < 0 || hp > b.hp[best]) ? i : best, -1);
}
function normalBonus(b: ActiveBattle, actor: number) {
  return mainAttribute(b.fighters[actor].stats!) === 'normal' && balancedStats(b.fighters[actor].stats!);
}
function typeScale(b: ActiveBattle, actor: number, target: number): number {
  if ((b.fieldUntil ?? 0) > b.revision) return 1;
  const scale = effectiveness(b.fighters[actor].type ?? 'normal', b.fighters[target].type);
  return scale > 1 ? (has(b, actor, 'peer-review') ? 1.4 : 1.2)
    : scale < 1 ? (has(b, target, 'peer-review') ? 0.6 : 0.8) : 1;
}
function hitChance(b: ActiveBattle, actor: number, target: number, attack: BattleAttack): number {
  if (attack.accuracy === 'sure-hit' || !attack.power) return 1;
  const gap = Math.max(0, b.fighters[target].stats!.charisma - b.fighters[actor].stats!.charisma);
  const evasion = has(b, target, 'feral-maul') ? 0 : Math.min(0.3, gap * 0.01) * (has(b, target, 'phantom-perfume') ? 2 : 1);
  return Math.max(0, Math.min(1, ((attack.accuracy ?? 100) + (has(b, actor, 'peer-review') ? 25 : 0)) / 100 - evasion));
}
function baseDamage(b: ActiveBattle, actor: number, target: number, attack: BattleAttack): number {
  if (attack.id === 'bump') return Math.ceil(b.hp[target] * 2 / 3);
  if (!attack.power) return 0;
  const stats = b.fighters[actor].stats!, rival = b.fighters[target].stats!;
  const attribute = attack.type === 'int' ? stats.intelligence : attack.type === 'cha' ? stats.charisma
    : attack.type === 'normal' && !['claw-strike', 'heavy-strike'].includes(attack.id) ? total(stats) / 3 : stats.strength;
  let power = attack.power;
  if (attack.id === 'dazzling-riposte' && b.states![target].lastMissed) power *= 2;
  if (attack.id === 'vip-velvet-rope') power += 2 * Math.max(0, stats.charisma - rival.charisma);
  let damage = attribute * power / 40 * b.fighters[actor].luck!;
  if (attack.id === 'titans-relic-press') damage += b.hp[actor] * 0.15;
  if (attack.id === 'gravity-formula') damage += b.fighters[target].maxHp * 0.1;
  if (attack.id === 'mind-gap') damage *= 1 + 0.1 * Math.max(0, b.mp[actor] - b.mp[target]);
  if (attack.id === 'jack-of-all-trades' && normalBonus(b, actor)) damage *= 1.25;
  return Math.max(1, Math.round(damage));
}
function costOf(b: ActiveBattle, actor: number, attack: BattleAttack) {
  return attack.mpCost + (attack.mpCost > 0 && b.states![actor].surcharge ? 2 : 0);
}
function unavailable(b: ActiveBattle, actor: number, attack: BattleAttack) {
  if (costOf(b, actor, attack) > b.mp[actor]) return 'Not enough MP';
  if (attack.id === 'bloodlust-crash' && b.hp[actor] <= Math.ceil(b.fighters[actor].maxHp * 0.15)) return 'Needs more than 15% Max HP';
  if (attack.id === 'golden-ratio' && !normalBonus(b, actor)) return 'Requires balanced Normal stats (within 20%)';
  return undefined;
}
function refresh(b: ActiveBattle) {
  b.fighters.forEach((f, i) => {
    b.states![i].effects = b.states![i].effects.filter(e => e.expires > b.revision);
    f.stats = effectiveStats(b, i);
    f.type = has(b, i, 'equalizer-field') ? 'normal' : mainAttribute(f.stats);
    f.maxHp = maxHpFor(f.stats); f.maxMp = maxMpFor(f.stats);
    b.hp[i] = Math.min(b.hp[i], f.maxHp); b.mp[i] = Math.min(b.mp[i], f.maxMp);
  });
  b.attacks.forEach((attacks, i) => {
    const target = targetOf(b, i);
    for (const attack of attacks) {
      attack.currentMpCost = costOf(b, i, attack);
      attack.unavailable = unavailable(b, i, attack);
      if (target >= 0) { attack.damage = baseDamage(b, i, target, attack); attack.hitChance = hitChance(b, i, target, attack); }
    }
  });
}
function addEffect(b: ActiveBattle, i: number, id: string, name: string, turns: number, attribute?: Attribute | 'all', amount?: number) {
  b.states![i].effects = b.states![i].effects.filter(e => e.id !== id);
  b.states![i].effects.push({ id, name, expires: b.revision + 1 + turns * b.order.length, attribute, amount });
}
function roll(b: ActiveBattle) {
  let seed = b.rng || 1;
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  b.rng = seed >>> 0;
  return b.rng / 0x100000000;
}
function strike(b: ActiveBattle, actor: number, attack: BattleAttack, random?: () => number) {
  const target = targetOf(b, actor), id = attack.id;
  const events: string[] = [];
  const scale = typeScale(b, actor, target);
  // Mind Gap's MP comparison and HP bonuses are taken before paying costs.
  const base = baseDamage(b, actor, target, attack);
  const paid = costOf(b, actor, attack);
  b.mp[actor] -= paid;
  if (attack.mpCost > 0) b.states![actor].surcharge = false;
  if (id === 'bloodlust-crash') {
    const paidHp = Math.ceil(b.fighters[actor].maxHp * 0.15);
    b.hp[actor] -= paidHp; events.push(`Sacrificed ${paidHp} HP`);
  }
  const missed = Boolean(attack.power) && (random?.() ?? roll(b)) >= hitChance(b, actor, target, attack);
  b.states![actor].lastMissed = missed;
  const boost = attack.power && b.goldPending && actor === b.coinProvider ? 2 : 1;
  if (attack.power && actor === b.coinProvider) b.goldPending = false;
  let damage = 0;
  const restoreMp = (i: number, amount: number) => {
    const gained = Math.min(amount, b.fighters[i].maxMp - b.mp[i]);
    b.mp[i] += gained;
    b.restoredMp![i] += gained;
    if (gained) events.push(`${b.fighters[i].name ?? b.fighters[i].id} restored ${gained} MP`);
  };
  const heal = (fraction: number) => {
    const healed = Math.min(Math.ceil(b.fighters[actor].maxHp * fraction), b.fighters[actor].maxHp - b.hp[actor]);
    b.hp[actor] += healed; b.restoredHp![actor] += healed; events.push(`Healed ${healed} HP`);
  };
  if (missed) {
    events.push('Missed');
    if (has(b, target, 'phantom-perfume')) restoreMp(target, 2);
  } else if (attack.power) {
    damage = Math.max(1, Math.round(base * scale * boost * (has(b, target, 'hardhat-guard') ? 0.7 : 1)));
    if (has(b, target, 'mana-barrier')) {
      const absorbed = Math.min(b.mp[target], Math.floor(damage / 2));
      b.mp[target] -= absorbed; damage -= absorbed;
      if (absorbed) events.push(`Mana Barrier absorbed ${absorbed} damage for ${absorbed} MP`);
    }
    damage = Math.min(b.hp[target], damage); b.hp[target] -= damage;
    if (has(b, target, 'hardhat-guard')) restoreMp(target, 1);
  }
  if (id === 'claw-strike') restoreMp(actor, 1);
  if (id === 'heavy-breath-slam' || id === 'service-smile') restoreMp(actor, 2);
  if (id === 'paperplane-dart') restoreMp(actor, 3);
  const effect = (who: number, turns: number, name: string, attr?: Attribute | 'all', amount?: number) => {
    addEffect(b, who, id, name, turns, attr, amount); events.push(`${name} (${turns} turns)`);
  };
  if (id === 'service-smile') effect(actor, 1, 'CHA +10%', 'charisma', 0.1);
  if (!missed) {
    if (id === 'humble-pie') effect(target, 2, 'CHA −25%', 'charisma', -0.25);
    if (id === 'hecklers-jab') effect(target, 2, 'CHA −20%', 'charisma', -0.2);
    if (id === 'feral-maul') effect(target, 1, 'Pinned: no evasion');
    if (id === 'apex-roar') effect(target, 3, 'CHA −35%', 'charisma', -0.35);
    if (id === 'gym-pump') effect(actor, 3, 'STR +25%', 'strength', 0.25);
    if (id === 'makeover-glow') effect(actor, 3, 'CHA +40%', 'charisma', 0.4);
    if (id === 'hardhat-guard') effect(actor, 2, 'Damage −30%; +1 MP on hit');
    if (id === 'phantom-perfume') effect(actor, 2, 'Double evasion; +2 MP on miss');
    if (id === 'peer-review') effect(actor, 2, 'Type bonus 40%; accuracy +25');
    if (id === 'mana-barrier') effect(actor, 2, 'Mana Barrier');
    if (id === 'sirens-lure') { b.states![target].surcharge = true; events.push('Target’s next paid skill costs +2 MP'); }
    if (id === 'synapse-shock' || id === 'crown-jewel-beam') {
      const drained = Math.min(3, b.mp[target]); b.mp[target] -= drained;
      events.push(`Target lost ${drained} MP`);
      if (id === 'crown-jewel-beam') restoreMp(actor, drained);
    }
    if (id === 'standing-ovation') {
      b.states![actor].effects = b.states![actor].effects.filter(e => !e.attribute || (e.amount ?? 0) >= 0);
      refresh(b); heal(0.35); events.push('Stat debuffs cleansed');
    }
    if (id === 'coffee-break') {
      effect(actor, 2, 'INT +20%', 'intelligence', 0.2); refresh(b); restoreMp(actor, Math.ceil(b.fighters[actor].maxMp * 0.5));
    }
    if (id === 'jack-of-all-trades' && normalBonus(b, actor)) restoreMp(actor, 1);
    if (id === 'equalizer-field') {
      effect(target, 3, 'Normal type'); b.fieldUntil = b.revision + 1 + 3 * b.order.length;
      events.push('All type advantages disabled');
    }
    if (id === 'golden-ratio') { heal(0.2); effect(actor, 3, 'All stats +15%', 'all', 0.15); }
  }
  b.revision++; refresh(b);
  b.turns.push({ actor, target, ability: id, name: attack.name, mpCost: paid, type: attack.type,
    ...(scale !== 1 && attack.power ? { effectiveness: scale } : {}),
    damage, hits: missed || !attack.power ? 0 : 1, missed, events, hp: [...b.hp], mp: [...b.mp],
    maxHp: b.fighters.map(f => f.maxHp), maxMp: b.fighters.map(f => f.maxMp), types: b.fighters.map(f => f.type ?? 'normal') });
  b.cursor = (b.cursor + 1) % b.order.length;
}
function finished(b: ActiveBattle) {
  if (b.monsterIndex !== null) {
    if (b.hp[b.monsterIndex] <= 0) b.winner = b.fighters[0].id;
    else if (!b.hp.some((hp, i) => i !== b.monsterIndex && hp > 0)) b.winner = b.fighters[b.monsterIndex].id;
  } else if (b.hp.some(hp => hp <= 0)) b.winner = b.fighters[b.hp[0] > 0 ? 0 : 1].id;
  if (!b.winner) return false;
  b.status = 'finished'; b.actor = null; return true;
}
function advance(b: ActiveBattle, random?: () => number) {
  while (!finished(b)) {
    while (b.hp[b.order[b.cursor]] <= 0) b.cursor = (b.cursor + 1) % b.order.length;
    const actor = b.order[b.cursor]; b.actor = actor;
    refresh(b);
    if (actor !== b.monsterIndex && !b.automaticIds.includes(b.fighters[actor].id)) return;
    const choices = b.attacks[actor].filter(a => a.power && !a.unavailable);
    const attack = choices.reduce((best, a) => a.damage * (a.hitChance ?? 1) > best.damage * (best.hitChance ?? 1) ? a : best);
    strike(b, actor, attack, random);
  }
}
export function startBattle(pets: PetStats[], opponent: PetStats, rolls: number[], options: StartBattleOptions = {}): ActiveBattle {
  const mode = options.mode ?? (opponent.monster ? 'monster' : 'pvp'), all = [...pets, opponent];
  if (!pets.length || (mode === 'pvp' && pets.length !== 1)) throw new Error('Choose the battle participants.');
  if (new Set(all.map(p => p.id)).size !== all.length) throw new Error('Each fighter must be different.');
  if (all.some(p => ![p.strength, p.intelligence, p.charisma].every(n => Number.isFinite(n) && n >= 0) || total(p) <= 0)) throw new Error('Fighter attributes must be valid.');
  if (all.some((_, i) => !Number.isFinite(rolls[i]) || rolls[i] < 0)) throw new Error('Each fighter needs a valid battle roll.');
  const candidates = mode === 'monster' ? pets : all;
  const provider = candidates.reduce((best, p, i) => total(p) > total(candidates[best]) ? i : best, 0);
  const coin = legacy.coinEffect(all[provider].equippedCoin, options.random);
  const prepared = all.map((p, i) => withAttributeBonus(p, i === provider ? coin.attributeBonus : 0));
  const fighters: Fighter[] = prepared.map((p, i) => {
    const selected = p.monster ? p.abilities : p.equippedAbilities ?? p.abilities;
    const allowed = p.monster ? [...ABILITIES, ...MONSTER_ABILITIES] : ABILITIES;
    const abilities = ['claw-strike', ...new Set((selected ?? []).filter(id => id !== 'claw-strike' && allowed.some(a => a.id === id)))];
    const stats = { strength: p.strength, intelligence: p.intelligence, charisma: p.charisma };
    return { id: p.id, name: p.name, monster: p.monster, baseStats: stats, stats, type: mainAttribute(p), luck: rolls[i] / powerOf(all[i]),
      maxHp: maxHpFor(p), maxMp: maxMpFor(p), damage: Math.max(1, Math.round(p.strength * rolls[i] / powerOf(all[i]))),
      color: p.color ?? '#f59e0b', appearance: p.appearance ?? 'blob', abilities };
  });
  const attacks: BattleAttack[][] = fighters.map(f => f.abilities.map(id => {
    const def = ABILITIES.find(a => a.id === id);
    if (def) return { ...def, damage: 0 };
    return { ...MONSTER_ABILITIES[0], power: 1, accuracy: 100, damage: 0 };
  }));
  const initialHp = fighters.map((f, i) => {
    const hp = options.hp?.[i] ?? maxHpFor(all[i]);
    return hp <= 0 ? 0 : Math.min(f.maxHp, hp + f.maxHp - maxHpFor(all[i]));
  });
  const initialMp = fighters.map((f, i) => Math.max(0, Math.min(f.maxMp, (options.mp?.[i] ?? maxMpFor(all[i])) + f.maxMp - maxMpFor(all[i]))));
  const monsterIndex = mode === 'monster' ? pets.length : null, petOrder = pets.map((_, i) => i);
  const order = monsterIndex === null ? coin.first === 0 ? [provider, 1 - provider] : [1 - provider, provider]
    : coin.first === 0 ? [...petOrder, monsterIndex] : [monsterIndex, ...petOrder];
  const b: ActiveBattle = { fighters, attacks, initialHp, initialMp, hp: [...initialHp], mp: [...initialMp], turns: [], winner: '', status: 'active', actor: null,
    initialMaxHp: fighters.map(f => f.maxHp), initialMaxMp: fighters.map(f => f.maxMp), initialTypes: fighters.map(f => f.type!),
    restoredHp: all.map(() => 0), restoredMp: all.map(() => 0),
    resourceBonus: fighters.map((f, i) => ({ hp: f.maxHp - maxHpFor(all[i]), mp: f.maxMp - maxMpFor(all[i]) })),
    revision: 0, coinProvider: provider, goldPending: coin.doubleFirstStrike, order, cursor: 0, monsterIndex,
    automaticIds: [...new Set(options.automaticIds ?? [])], forfeited: [], rulesVersion: 2,
    states: fighters.map(() => ({ effects: [], lastMissed: false, surcharge: false })), fieldUntil: 0,
    rng: Math.floor((options.random?.() ?? Math.random()) * 0x100000000) || 1,
    initiative: { toss: coin.toss, coin: coin.coin, provider, providerId: all[provider].id } };
  refresh(b); advance(b, options.random); return b;
}
export function takeBattleTurn(battle: ActiveBattle, actorId: string, ability: unknown, revision: unknown, random?: () => number): ActiveBattle | legacy.BattleActionError {
  if (battle.rulesVersion !== 2) return legacy.takeBattleTurn(battle as legacy.ActiveBattle, actorId, ability, revision) as ActiveBattle | legacy.BattleActionError;
  if (!Number.isInteger(revision) || revision !== battle.revision) return { error: 'The battle has moved on. Choose a move for the current turn.', status: 409 };
  if (battle.status !== 'active' || battle.actor === null) return { error: 'This battle has ended.', status: 409 };
  const actor = battle.actor;
  if (battle.fighters[actor].id !== actorId) return { error: 'Wait for your pet’s turn.', status: 403 };
  if (actor === battle.monsterIndex || battle.automaticIds.includes(actorId)) return { error: 'This fighter’s move is controlled by the game.', status: 403 };
  const next = structuredClone(battle); refresh(next);
  const attack = next.attacks[actor].find(a => a.id === ability);
  if (!attack) return { error: 'Choose one of your equipped skills.', status: 400 };
  if (attack.unavailable) return { error: attack.unavailable, status: 409 };
  strike(next, actor, attack, random); advance(next, random); return next;
}
export function forfeitBattle(battle: ActiveBattle, actorId: string, revision?: unknown): ActiveBattle | legacy.BattleActionError {
  if (battle.rulesVersion !== 2) return legacy.forfeitBattle(battle as legacy.ActiveBattle, actorId, revision) as ActiveBattle | legacy.BattleActionError;
  if (revision !== undefined && (!Number.isInteger(revision) || revision !== battle.revision)) return { error: 'The battle has moved on. Refresh it before leaving.', status: 409 };
  const actor = battle.fighters.findIndex(f => f.id === actorId);
  if (actor < 0 || actor === battle.monsterIndex || battle.automaticIds.includes(actorId)) return { error: 'You are not a player in this battle.', status: 403 };
  if (battle.status !== 'active') return { error: 'This battle has ended.', status: 409 };
  if (battle.forfeited.includes(actor)) return battle;
  const next = structuredClone(battle); next.hp[actor] = 0; next.forfeited.push(actor); next.revision++;
  advance(next); return next;
}
