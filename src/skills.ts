// Shared catalogue: the server publishes these exact rules to the skill book.
export type AttributeType = 'str' | 'cha' | 'int' | 'normal';
export type Attribute = 'strength' | 'charisma' | 'intelligence';
export const JOBS = [
  { id: 'mover', name: 'Mover', location: 'construction' },
  { id: 'logger', name: 'Logger', location: 'construction' },
  { id: 'bouncer', name: 'Bouncer', location: 'construction' },
  { id: 'gym-trainer', name: 'Gym Trainer', location: 'construction' },
  { id: 'construction', name: 'Construction', location: 'construction' },
  { id: 'cafe-waiter', name: 'Cafe Waiter', location: 'theatre' },
  { id: 'street-performer', name: 'Street Performer', location: 'theatre' },
  { id: 'idol-stage', name: 'Idol Stage', location: 'theatre' },
  { id: 'stylist', name: 'Stylist', location: 'theatre' },
  { id: 'theater-actor', name: 'Theater Actor', location: 'theatre' },
  { id: 'librarian', name: 'Librarian', location: 'office' },
  { id: 'lab-assistant', name: 'Lab Assistant', location: 'office' },
  { id: 'alchemist', name: 'Alchemist', location: 'office' },
  { id: 'tutor', name: 'Tutor', location: 'office' },
  { id: 'researcher', name: 'Researcher', location: 'office' },
  { id: 'freelancer', name: 'Freelancer', location: 'office' },
] as const;
export type JobId = typeof JOBS[number]['id'];
// Completed game minutes, independent of wage promotions. First shift earns Lv.1.
export const JOB_LEVEL_MINUTES = [1, 60, 180, 360, 600] as const;
export const jobLevel = (minutes: number) => JOB_LEVEL_MINUTES.filter(required => minutes >= required).length;
export type Source =
  | { channel: 'job'; job: JobId; level: number; label: string }
  | { channel: 'monster'; monster: 'slime' | 'goblin' | 'slime-king'; floor: number; label: string }
  | { channel: 'chest'; floor: number; label: string };
const job = (id: JobId, level: number): Source => ({ channel: 'job', job: id, level, label: `Part-Time Job (${JOBS.find(j => j.id === id)!.name} Lv.${level})` });
// Existing woodland monsters carry the themed scrolls; floor gates preserve rarity.
const drop = (monster: 'slime' | 'goblin' | 'slime-king', floor: number, theme: string): Source => ({ channel: 'monster', monster, floor,
  label: `Monster Drop (${theme} scroll: ${monster === 'slime-king' ? 'Slime King' : monster === 'slime' ? 'Slime' : 'Goblin'}, floor ${floor}+)` });
const chest = (floor: number, name: string): Source => ({ channel: 'chest', floor, label: `Treasure Box (${name}, floor ${floor}+)` });
type SkillDefinition = {
  id: string; name: string; type: AttributeType; category: 'Basic' | 'Attack' | 'Finisher' | 'Utility' | 'Defensive';
  power: number; accuracy: number | 'sure-hit'; mpCost: number; source: Source; description: string;
};
export const SKILLS = [
  { id: 'heavy-breath-slam', name: 'Heavy Breath Slam', type: 'str', category: 'Basic', power: 40, accuracy: 100, mpCost: 0, source: job('mover', 1), description: 'STR damage. Restore 2 MP, even on a miss.' },
  { id: 'lumberjack-sweep', name: 'Lumberjack Sweep', type: 'str', category: 'Attack', power: 55, accuracy: 'sure-hit', mpCost: 2, source: job('logger', 2), description: 'Cannot miss; ignores CHA evasion.' },
  { id: 'humble-pie', name: 'Humble Pie', type: 'str', category: 'Attack', power: 65, accuracy: 95, mpCost: 3, source: job('bouncer', 3), description: 'On hit: target CHA −25% for 2 turns.' },
  { id: 'feral-maul', name: 'Feral Maul', type: 'str', category: 'Attack', power: 75, accuracy: 90, mpCost: 3, source: drop('goblin', 1, 'Wild Beast'), description: 'On hit: pin the target, setting evasion to 0 for 1 turn.' },
  { id: 'bloodlust-crash', name: 'Bloodlust Crash', type: 'str', category: 'Finisher', power: 115, accuracy: 90, mpCost: 4, source: drop('slime-king', 5, 'Alpha Boss'), description: 'Pay 15% Max HP to cast. Cannot use if that would knock you out.' },
  { id: 'titans-relic-press', name: 'Titan’s Relic Press', type: 'str', category: 'Finisher', power: 95, accuracy: 95, mpCost: 5, source: chest(2, 'Ruins Chest'), description: 'Add 15% of your current HP to damage before mitigation.' },
  { id: 'gym-pump', name: 'Gym Pump', type: 'str', category: 'Utility', power: 0, accuracy: 100, mpCost: 2, source: job('gym-trainer', 2), description: 'STR +25% for 3 turns, increasing damage and Max HP. Does not heal.' },
  { id: 'apex-roar', name: 'Apex Roar', type: 'str', category: 'Utility', power: 0, accuracy: 100, mpCost: 3, source: drop('goblin', 3, 'Apex Predator'), description: 'Target CHA −35% for 3 turns. Cannot miss.' },
  { id: 'hardhat-guard', name: 'Hardhat Guard', type: 'str', category: 'Defensive', power: 0, accuracy: 100, mpCost: 2, source: job('construction', 3), description: 'Take 30% less damage for 2 turns. Recover 1 MP each time an attack hits you.' },
  { id: 'service-smile', name: 'Service Smile', type: 'cha', category: 'Basic', power: 35, accuracy: 100, mpCost: 0, source: job('cafe-waiter', 1), description: 'CHA damage. Restore 2 MP and gain CHA +10% for 1 turn, even on a miss.' },
  { id: 'hecklers-jab', name: 'Heckler’s Jab', type: 'cha', category: 'Attack', power: 60, accuracy: 100, mpCost: 2, source: job('street-performer', 2), description: 'On hit: target CHA −20% for 2 turns.' },
  { id: 'dazzling-riposte', name: 'Dazzling Riposte', type: 'cha', category: 'Attack', power: 65, accuracy: 95, mpCost: 3, source: drop('slime', 1, 'Fey Creature'), description: '130 Power if the target missed an attack on its last turn.' },
  { id: 'sirens-lure', name: 'Siren’s Lure', type: 'cha', category: 'Attack', power: 70, accuracy: 95, mpCost: 4, source: drop('slime', 3, 'Siren/Mimic'), description: 'On hit: target’s next paid skill costs 2 extra MP. Free basics stay free.' },
  { id: 'vip-velvet-rope', name: 'VIP Velvet Rope', type: 'cha', category: 'Finisher', power: 85, accuracy: 95, mpCost: 6, source: job('idol-stage', 5), description: 'Add 2 Power for each point your CHA exceeds the target’s.' },
  { id: 'crown-jewel-beam', name: 'Crown Jewel Beam', type: 'cha', category: 'Finisher', power: 115, accuracy: 90, mpCost: 7, source: chest(3, 'Royal Vault'), description: 'On hit: drain up to 3 MP from the target into your own pool.' },
  { id: 'makeover-glow', name: 'Makeover Glow', type: 'cha', category: 'Utility', power: 0, accuracy: 100, mpCost: 3, source: job('stylist', 3), description: 'CHA +40% for 3 turns.' },
  { id: 'phantom-perfume', name: 'Phantom Perfume', type: 'cha', category: 'Defensive', power: 0, accuracy: 100, mpCost: 4, source: chest(2, 'Mirage Chest'), description: 'Double CHA evasion (up to 60%) for 2 turns. Restore 2 MP whenever an attack misses you.' },
  { id: 'standing-ovation', name: 'Standing Ovation', type: 'cha', category: 'Defensive', power: 0, accuracy: 100, mpCost: 5, source: job('theater-actor', 4), description: 'Cleanse all stat debuffs and heal 35% Max HP.' },
  { id: 'paperplane-dart', name: 'Paperplane Dart', type: 'int', category: 'Basic', power: 40, accuracy: 'sure-hit', mpCost: 0, source: job('librarian', 1), description: 'INT damage; cannot miss. Restore 3 MP.' },
  { id: 'synapse-shock', name: 'Synapse Shock', type: 'int', category: 'Attack', power: 55, accuracy: 95, mpCost: 3, source: drop('slime', 2, 'Mind Slime'), description: 'On hit: destroy up to 3 of the target’s MP.' },
  { id: 'gravity-formula', name: 'Gravity Formula', type: 'int', category: 'Attack', power: 60, accuracy: 95, mpCost: 4, source: job('lab-assistant', 2), description: 'Add 10% of target Max HP to damage before mitigation.' },
  { id: 'laser-trajectory', name: 'Laser Trajectory', type: 'int', category: 'Attack', power: 75, accuracy: 'sure-hit', mpCost: 5, source: job('alchemist', 3), description: 'Cannot miss; ignores CHA evasion.' },
  { id: 'mind-gap', name: 'Mind Gap', type: 'int', category: 'Finisher', power: 90, accuracy: 90, mpCost: 8, source: drop('goblin', 4, 'Elder Construct'), description: 'Damage +10% per MP you have over the target, measured before paying the cost.' },
  { id: 'forbidden-grimoire', name: 'Forbidden Grimoire', type: 'int', category: 'Finisher', power: 140, accuracy: 85, mpCost: 12, source: chest(5, 'Ancient Archive'), description: 'A 140 Power INT spell. Requires at least 12 current MP.' },
  { id: 'peer-review', name: 'Peer Review', type: 'int', category: 'Utility', power: 0, accuracy: 100, mpCost: 3, source: job('tutor', 3), description: 'For 2 turns, your favorable type bonus and mitigation become 40%; accuracy +25 percentage points.' },
  { id: 'mana-barrier', name: 'Mana Barrier', type: 'int', category: 'Defensive', power: 0, accuracy: 100, mpCost: 3, source: chest(1, 'Crystal Chest'), description: 'For 2 turns, redirect half of incoming damage to MP, at 1 MP per damage. Overflow hits HP.' },
  { id: 'coffee-break', name: 'Coffee Break', type: 'int', category: 'Defensive', power: 0, accuracy: 100, mpCost: 0, source: job('researcher', 4), description: 'INT +20% for 2 turns; restore 50% of the resulting Max MP. Takes your turn.' },
  { id: 'jack-of-all-trades', name: 'Jack of All Trades', type: 'normal', category: 'Attack', power: 70, accuracy: 'sure-hit', mpCost: 2, source: job('freelancer', 3), description: 'Scales with average STR/CHA/INT. Balanced Normal pets deal +25% damage and recover 1 MP.' },
  { id: 'equalizer-field', name: 'Equalizer Field', type: 'normal', category: 'Utility', power: 0, accuracy: 100, mpCost: 3, source: drop('goblin', 2, 'Chameleon Beast'), description: 'For 3 turns, target becomes Normal and all type advantages on the field are disabled.' },
  { id: 'golden-ratio', name: 'Golden Ratio', type: 'normal', category: 'Finisher', power: 110, accuracy: 100, mpCost: 5, source: chest(4, 'Sacred Shrine'), description: 'Requires balanced Normal stats. On hit: heal 20% Max HP and gain all stats +15% for 3 turns.' },
] as const satisfies readonly SkillDefinition[];
export type SkillId = typeof SKILLS[number]['id'];
export const CHEST_SKILLS = SKILLS.filter(s => s.source.channel === 'chest');
export const MONSTER_SKILL_DROP_RATE = 0.25;
export const monsterSkills = (monster: string, floor: number) => SKILLS.filter(s =>
  s.source.channel === 'monster' && s.source.monster === monster && s.source.floor <= floor);
