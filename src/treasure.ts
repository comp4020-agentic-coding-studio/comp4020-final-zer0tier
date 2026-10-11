export const COINS = [
  { id: 'copper-coin', name: 'Copper Coin' },
  { id: 'silver-coin', name: 'Silver Coin' },
  { id: 'gold-coin', name: 'Gold Coin' },
] as const;
export type CoinId = (typeof COINS)[number]['id'];
export const TREASURE_RATES = { food: 30, soap: 30, ability: 20, hourglass: 15, coin: 5 } as const;
export type TreasureReward = {
  category: keyof typeof TREASURE_RATES;
  id: 'food' | 'soap' | 'hourglass' | 'firebolt' | 'heavy-strike' | CoinId;
  name: string;
  quantity: 1;
  learned?: boolean;
};

// A second roll only chooses within a category; it never changes its weight.
export function rollTreasure(random = Math.random): TreasureReward {
  const roll = random() * 100;
  if (roll < 30) return { category: 'food', id: 'food', name: 'Food', quantity: 1 };
  if (roll < 60) return { category: 'soap', id: 'soap', name: 'Soap', quantity: 1 };
  if (roll < 80) return { category: 'ability', ...(random() < 0.5
    ? { id: 'firebolt' as const, name: 'Firebolt' } : { id: 'heavy-strike' as const, name: 'Heavy Strike' }), quantity: 1 };
  if (roll < 95) return { category: 'hourglass', id: 'hourglass', name: 'Hourglass', quantity: 1 };
  return { category: 'coin', ...COINS[Math.floor(random() * COINS.length)], quantity: 1 };
}
