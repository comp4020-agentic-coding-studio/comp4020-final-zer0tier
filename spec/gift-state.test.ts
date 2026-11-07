import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

// Unfair Coins only come from chests and the Slime King, so these gifting
// rules run in-process against a scratch database where a test can hand a
// pet coins directly.
const directory = mkdtempSync(join(tmpdir(), 'virtuepets-gift-'));
let db: typeof import('../src/db.ts').db;
let pets: typeof import('../src/pets.ts');
beforeAll(async () => {
  vi.stubEnv('DATA_DIR', directory);
  ({ db } = await import('../src/db.ts'));
  pets = await import('../src/pets.ts');
});
afterAll(() => { db.close(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });

function pet(id: string, coins: Record<string, number> = {}, equipped: string | null = null) {
  pets.getOrCreatePet(id);
  for (const [coin, quantity] of Object.entries(coins)) {
    db.prepare('INSERT INTO inventory (player_id, item_id, quantity) VALUES (?, ?, ?)').run(id, coin, quantity);
  }
  db.prepare('UPDATE pets SET equipped_coin = ? WHERE id = ?').run(equipped, id);
  return id;
}
const ok = <T extends object>(outcome: T) => {
  if ('error' in outcome) throw new Error(String(outcome.error));
  return outcome as Exclude<T, { error: string }>;
};

it('moves one spare coin, keeps the equipped one, and drops an emptied stack', () => {
  const giver = pet('coin-giver', { 'silver-coin': 2, 'gold-coin': 1 }, 'silver-coin'), friend = pet('coin-friend');
  const first = ok(pets.gift(giver, friend, 'silver-coin'));
  expect(first.giver).toMatchObject({ coins: { 'silver-coin': 1 }, equippedCoin: 'silver-coin' });
  expect(first.pet).toMatchObject({ coins: { 'silver-coin': 1 }, equippedCoin: null });
  // The equipped Silver Coin is now the giver's only one: it stays.
  const worn = pets.gift(giver, friend, 'silver-coin');
  expect(worn).toEqual({ status: 409, error: "You're wearing your only Silver Coin. Equip another coin, or none, to give it away." });
  // An unequipped coin's last copy can go, and its row goes with it.
  const last = ok(pets.gift(giver, friend, 'gold-coin'));
  expect(last.giver.coins['gold-coin']).toBe(0);
  expect(db.prepare('SELECT 1 FROM inventory WHERE player_id = ? AND item_id = ?').get(giver, 'gold-coin')).toBeUndefined();
  expect(last.pet.coins).toEqual({ 'copper-coin': 0, 'silver-coin': 1, 'gold-coin': 1 });
  expect(pets.gift(giver, friend, 'gold-coin')).toMatchObject({ status: 409, error: 'You have no gold coin to give.' });
});

it('lets the giver hand over its last copy once it unequips the coin', () => {
  const giver = pet('unequip-giver', { 'copper-coin': 1 }, 'copper-coin'), friend = pet('unequip-friend');
  expect(pets.giftable(pets.getPet(giver)!, 'copper-coin')).toBe(0);
  ok(pets.equipCoin(giver, null));
  expect(pets.giftable(pets.getPet(giver)!, 'copper-coin')).toBe(1);
  expect(ok(pets.gift(giver, friend, 'copper-coin')).pet.coins['copper-coin']).toBe(1);
});

it('records a gifted entry for each gift and none for a refusal', () => {
  const giver = pet('feed-giver', { 'gold-coin': 1 }), friend = pet('feed-friend');
  const before = (db.prepare('SELECT coalesce(max(id), 0) AS id FROM feed').get() as { id: number }).id;
  ok(pets.gift(giver, friend, 'gold-coin'));
  pets.gift(giver, friend, 'gold-coin');
  const news = db.prepare('SELECT kind, pet, detail FROM feed WHERE id > ?').all(before);
  expect(news).toEqual([{ kind: 'gifted', pet: giver, detail: JSON.stringify({ other: friend, item: 'gold-coin' }) }]);
});
