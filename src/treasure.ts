import { LEARNABLE_ABILITIES, type LearnableAbilityId } from './combat.ts';

export const COINS = [
  { id: 'copper-coin', name: 'Copper Coin', effect: 'Before battle, +1 to every attribute for that fight only. The coin toss stays a fair 50/50.' },
  { id: 'silver-coin', name: 'Silver Coin', effect: 'Your pet always attacks first.' },
  { id: 'gold-coin', name: 'Gold Coin', effect: 'Your pet always attacks second, but its first attack deals double damage.' },
] as const;
export type CoinId = (typeof COINS)[number]['id'];
export const isCoinId = (value: unknown): value is CoinId => COINS.some(c => c.id === value);
export const TREASURE_RATES = { food: 30, soap: 30, ability: 20, hourglass: 15, coin: 5 } as const;
export type TreasureReward = {
  category: keyof typeof TREASURE_RATES;
  id: 'food' | 'soap' | 'hourglass' | LearnableAbilityId | CoinId;
  name: string;
  quantity: 1;
  learned?: boolean;
};

// A second roll only chooses within a category; it never changes its weight.
export function rollTreasure(random = Math.random, floor = 5): TreasureReward {
  const roll = random() * 100;
  if (roll < 30) return { category: 'food', id: 'food', name: 'Food', quantity: 1 };
  if (roll < 60) return { category: 'soap', id: 'soap', name: 'Soap', quantity: 1 };
  if (roll < 80) {
    const eligible = LEARNABLE_ABILITIES.filter(a => a.source.channel === 'chest' && a.source.floor <= floor);
    const { id, name } = eligible[Math.floor(random() * eligible.length)];
    return { category: 'ability', id, name, quantity: 1 };
  }
  if (roll < 95) return { category: 'hourglass', id: 'hourglass', name: 'Hourglass', quantity: 1 };
  const coin = COINS[Math.floor(random() * COINS.length)];
  return { category: 'coin', id: coin.id, name: coin.name, quantity: 1 };
}
