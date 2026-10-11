import { db } from './db.ts';
import { ABILITIES, type AbilityId } from './combat.ts';
import { COINS, type CoinId, type TreasureReward } from './treasure.ts';

export function inventoryFor(id: string) {
  const rows = db.prepare('SELECT item_id, quantity FROM inventory WHERE player_id = ?').all(id) as { item_id: string; quantity: number }[];
  const quantity = (item: string) => rows.find(row => row.item_id === item)?.quantity ?? 0;
  return {
    abilities: ABILITIES.filter(a => a.id === 'claw-strike' || quantity(a.id) > 0).map(a => a.id) as AbilityId[],
    coins: Object.fromEntries(COINS.map(c => [c.id, quantity(c.id)])) as Record<CoinId, number>,
  };
}

// Called inside the same transaction that marks the chest opened.
export function grantTreasure(id: string, reward: TreasureReward): TreasureReward {
  if (reward.category === 'ability') {
    const result = db.prepare('INSERT OR IGNORE INTO inventory (player_id, item_id, quantity) VALUES (?, ?, ?)').run(id, reward.id, 1);
    return { ...reward, learned: result.changes === 1 };
  }
  if (reward.category === 'coin') {
    db.prepare('INSERT INTO inventory (player_id, item_id, quantity) VALUES (?, ?, ?) ON CONFLICT(player_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity')
      .run(id, reward.id, 1);
  } else {
    db.prepare('UPDATE pets SET food = food + ?, soap = soap + ?, hourglass = hourglass + ? WHERE id = ?')
      .run(Number(reward.id === 'food'), Number(reward.id === 'soap'), Number(reward.id === 'hourglass'), id);
  }
  return reward;
}
