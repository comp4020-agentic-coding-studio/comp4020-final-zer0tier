import type { MonsterKind, MonsterAbilityId } from './legacy-combat.ts';
import type { SkillId } from './skills.ts';

export type MonsterTactic = 'bruiser' | 'dodger' | 'caster' | 'boss';
type MonsterBuild = {
  kind: MonsterKind; name: string; tactic: MonsterTactic; color: string; strategy: string;
  // STR / INT / CHA, with the same growth on every deeper floor.
  stats: readonly [number, number, number]; growth: readonly [number, number, number];
  moves: readonly { id: SkillId | MonsterAbilityId; floor: number }[];
};

export const MONSTER_BUILDS = {
  'woodland-slime': {
    kind: 'slime', name: 'Slime', tactic: 'bruiser', color: '#0891b2',
    strategy: 'A sturdy STR bruiser. Heavy Breath Slam restores its MP.',
    stats: [3, 1, 2], growth: [2, 1, 1],
    moves: [{ id: 'heavy-breath-slam', floor: 1 }],
  },
  'goblin-bruiser': {
    kind: 'goblin', name: 'Goblin Bruiser', tactic: 'bruiser', color: '#b36b43',
    strategy: 'Guards between STR attacks. From floor 2, Feral Maul can pin evasive pets.',
    stats: [5, 3, 2], growth: [2, 1, 1],
    moves: [{ id: 'heavy-breath-slam', floor: 1 }, { id: 'hardhat-guard', floor: 1 }, { id: 'feral-maul', floor: 2 }],
  },
  'mind-slime': {
    kind: 'slime', name: 'Mind Slime', tactic: 'caster', color: '#7c74bd',
    strategy: 'Drains MP with Synapse Shock, then recovers MP with Paperplane Dart. From floor 3, Gravity Formula punishes high HP.',
    stats: [3, 6, 2], growth: [1, 3, 1],
    moves: [{ id: 'paperplane-dart', floor: 1 }, { id: 'synapse-shock', floor: 1 }, { id: 'gravity-formula', floor: 3 }],
  },
  'glimmer-goblin': {
    kind: 'goblin', name: 'Glimmer Goblin', tactic: 'dodger', color: '#bd6c9e',
    strategy: 'Raises CHA with Makeover Glow and punishes missed attacks with Dazzling Riposte.',
    stats: [3, 2, 6], growth: [1, 1, 3],
    moves: [{ id: 'service-smile', floor: 1 }, { id: 'makeover-glow', floor: 1 }, { id: 'dazzling-riposte', floor: 1 }],
  },
  'slime-king': {
    kind: 'slime-king', name: 'Slime King', tactic: 'boss', color: '#c026d3',
    strategy: 'Spends a turn charging Bump at a named target. Guard or drain its MP before its next turn.',
    stats: [18, 10, 12], growth: [0, 0, 0],
    moves: [{ id: 'bump', floor: 1 }],
  },
} as const satisfies Record<string, MonsterBuild>;
export type MonsterBuildId = keyof typeof MONSTER_BUILDS;

// Maps without a build keep their original moves. Active fights snapshot
// their moves and tactic, so adding a build never rewrites a saved battle.
export const MONSTER_MOVES: Record<MonsterKind, readonly MonsterAbilityId[]> = { slime: [], goblin: [], 'slime-king': ['bump'] };
export function monsterBuild(enemy: { build?: MonsterBuildId }): MonsterBuild | undefined {
  return enemy.build ? MONSTER_BUILDS[enemy.build] : undefined;
}
export function monsterMoves(enemy: { kind: MonsterKind; build?: MonsterBuildId }, floor: number): readonly (SkillId | MonsterAbilityId)[] {
  return monsterBuild(enemy)?.moves.filter(move => move.floor <= floor).map(move => move.id) ?? MONSTER_MOVES[enemy.kind];
}
