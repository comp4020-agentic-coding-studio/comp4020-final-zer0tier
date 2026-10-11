import { expect, it } from 'vitest';
import { rollTreasure } from '../src/treasure.ts';

it.each([
  [0, 'food'], [0.299999, 'food'], [0.3, 'soap'], [0.599999, 'soap'],
  [0.6, 'ability'], [0.799999, 'ability'], [0.8, 'hourglass'], [0.949999, 'hourglass'], [0.95, 'coin'], [0.999999, 'coin'],
])('uses the agreed category boundaries at %s', (roll, category) => {
  expect(rollTreasure(() => Number(roll)).category).toBe(category);
});

it('allocates 30/30/20/15/5 percent of the random range, with equal choices within abilities and coins', () => {
  const categories: Record<string, number> = {}, items: Record<string, number> = {};
  for (let n = 0; n < 6000; n++) {
    let call = 0;
    const reward = rollTreasure(() => call++ === 0 ? (n + 0.5) / 6000 : (n % 6 + 0.5) / 6);
    categories[reward.category] = (categories[reward.category] || 0) + 1;
    items[reward.id] = (items[reward.id] || 0) + 1;
  }
  expect(categories).toEqual({ food: 1800, soap: 1800, ability: 1200, hourglass: 900, coin: 300 });
  expect(items).toMatchObject({ firebolt: 600, 'heavy-strike': 600, 'copper-coin': 100, 'silver-coin': 100, 'gold-coin': 100 });
});
