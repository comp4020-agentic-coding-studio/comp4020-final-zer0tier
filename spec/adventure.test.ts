import { expect, it } from 'vitest';
import { baseUrl, finish, freshId, getPet, must, post, signUp, signIn } from './helpers.ts';

async function sendAction(id: string, body = {}) {
  const state = await (await post('/api/adventure', {}, id)).json();
  return post('/api/adventure', { revision: state.revision, ...body }, id);
}

it('saves one-block adventure movement, blocks trees, and isolates player positions', async () => {
  const id = freshId(); await signUp(id);
  const read = async () => (await post('/api/adventure', {}, id)).json();
  const start = await read();
  expect(start.tiles).toHaveLength(16);
  expect(start.tiles.every((row: string) => row.length === 16)).toBe(true);
  expect(start).toMatchObject({ x: 2, y: 2 });
  expect(await (await sendAction(id, { direction: 'w', x: 12 })).json()).toMatchObject({ x: 2, y: 1 });
  expect((await sendAction(id, { direction: 'w' })).status).toBe(409);
  expect((await post('/api/adventure', { direction: '__proto__' }, id)).status).toBe(400);
  expect((await post('/api/adventure', { direction: [1, 0] }, id)).status).toBe(400);
  await post('/api/signout', {}, id); await signIn(id);
  expect(await read()).toMatchObject({ x: 2, y: 1 });
  const other = freshId(); await signUp(other);
  expect(await (await post('/api/adventure', { player_id: id }, other)).json()).toMatchObject({ x: 2, y: 2 });
  expect((await post('/api/adventure', {}, null)).status).toBe(401);
});

it('lets the owner descend all five floors only at stairs, ascend, and resume the same floor', async () => {
  const id = freshId(); await signUp(id);
  const act = async (body = {}) => {
    const response = await sendAction(id, body);
    expect(response.status).toBe(200);
    return response.json();
  };
  expect((await sendAction(id, { action: 'ascend' })).status).toBe(409);
  expect((await sendAction(id, { action: 'descend' })).status).toBe(409);
  expect((await post('/api/adventure', { action: 'teleport' }, id)).status).toBe(400);
  expect((await post('/api/adventure', { action: 'descend', direction: 's' }, id)).status).toBe(400);
  let state = await act();
  for (let floor = 1; floor < 5; floor++) {
    // The outer path avoids every monster's detection radius.
    for (const direction of ['w', ...Array(12).fill('d'), ...Array(12).fill('s'), 'a']) state = await act({ direction });
    expect(state).toMatchObject({ x: 13, y: 13, floor });
    state = await act({ action: 'descend' });
    expect(state).toMatchObject({ x: 2, y: 2, floor: floor + 1, floorCount: 5 });
  }
  expect(state.enemies.find((e: any) => e.kind === 'slime-king')).toMatchObject({ name: 'Slime King', moves: [{ id: 'bump', name: 'Bump', mpCost: 5 }] });
  expect(state.down).toBeNull();
  expect((await sendAction(id, { action: 'descend' })).status).toBe(409);
  await post('/api/signout', {}, id); await signIn(id);
  expect(await act()).toEqual(state);
  expect(await act({ action: 'ascend' })).toMatchObject({ floor: 4, x: 13, y: 13 });
});

it('saves pursuit and encounters, allows escape, and does not advance enemies on reads or rejected moves', async () => {
  const id = freshId(); await signUp(id);
  const act = async (body = {}) => (await sendAction(id, body)).json();
  await act(); await act({ direction: 'd' });
  const noticed = await act({ direction: 'd' });
  expect(noticed.enemies[0]).toMatchObject({ x: 5, y: 2, alerted: true });
  expect(noticed.encounters).toContain(noticed.enemies[0].id);
  expect(await act()).toEqual(noticed);
  expect((await sendAction(id, { direction: 'x' })).status).toBe(400);
  expect(await act()).toEqual(noticed);
  const escaped = await act({ direction: 'a' });
  expect(escaped.enemies[0]).toMatchObject({ x: 5, y: 2, alerted: false });
  expect(escaped.encounters).toEqual([]);
  await post('/api/signout', {}, id); await signIn(id);
  expect(await act()).toEqual(escaped);
});

it('saves exactly one monster battle for concurrent moves and retries, including after returning to exploration', async () => {
  const id = freshId(); await signUp(id);
  const pet = await getPet(id);
  await sendAction(id, { direction: 'd' });
  const before = await (await sendAction(id, { direction: 'd' })).json();
  const request = { direction: 'd', revision: before.revision, winner: id, strength: 9999, reward: 9999 };
  const results = await Promise.all(Array.from({ length: 6 }, async () => {
    const res = await post('/api/adventure', request, id);
    expect(res.status).toBe(200);
    return res.json();
  }));
  const result = results[0];
  for (const duplicate of results) expect(duplicate).toEqual(result);
  expect(result).toMatchObject({ x: 5, y: 2, battle: { pending: true, enemyName: 'Slime', won: true } });
  expect(result.enemies).toHaveLength(3);
  expect(result.battle.playback.fighters[0]).toMatchObject({ id, maxHp: 15, maxMp: 5 });
  expect(result.battle.playback.fighters[1]).toMatchObject({ id: 'monster:f1-enemy-0', name: 'Slime', monster: 'slime', maxHp: 6, maxMp: 1 });
  expect(await (await sendAction(id, { direction: 's' })).json()).toEqual(result);
  expect(await (await sendAction(id, { action: 'descend' })).json()).toEqual(result);
  await post('/api/signout', {}, id); await signIn(id);
  expect(await (await post('/api/adventure', {}, id)).json()).toEqual(result);
  expect((await sendAction(id, { action: 'continue', battleId: 'fake' })).status).toBe(409);
  const continuation = { action: 'continue', battleId: result.battle.id, revision: result.revision };
  const continued = await (await post('/api/adventure', continuation, id)).json();
  expect(continued.battle.pending).toBe(false);
  expect(continued.battle.playback).toEqual(result.battle.playback);
  expect(await (await post('/api/adventure', continuation, id)).json()).toEqual(continued);
  expect(await (await post('/api/adventure', request, id)).json()).toEqual(continued);
  expect(await (await sendAction(id, { direction: 's' })).json()).toMatchObject({ x: 5, y: 3 });
  expect(await getPet(id)).toEqual(pet);
});

it('requires a saved map revision and cannot move another account using a previous login’s revision', async () => {
  const id = freshId(), other = freshId(); await signUp(id); await signUp(other);
  const before = await (await post('/api/adventure', {}, id)).json();
  const otherBefore = await (await post('/api/adventure', {}, other)).json();
  expect((await post('/api/adventure', { direction: 'd' }, id)).status).toBe(400);
  expect((await post('/api/adventure', { action: 'continue', battleId: 'fake' }, id)).status).toBe(400);
  expect((await post('/api/adventure', { direction: 'd', revision: before.revision }, null)).status).toBe(401);
  expect(await (await post('/api/adventure', { direction: 'd', revision: before.revision, player_id: id }, other)).json()).toEqual(otherBefore);
  expect(await (await post('/api/adventure', {}, id)).json()).toEqual(before);
});

it('pet:updated — opening a chest grants exactly one reward under concurrent retries and reaches both windows within 1s', async () => {
  const id = freshId(), other = freshId(); await signUp(id); await signUp(other);
  expect((await sendAction(id, { action: 'open-chest' })).status).toBe(409);
  for (const direction of ['w', ...Array(9).fill('d'), 's', 's']) await sendAction(id, { direction });
  const before = await (await post('/api/adventure', {}, id)).json();
  expect(before).toMatchObject({ x: 11, y: 3, battle: null });
  const windows = await Promise.all([0, 1].map(() => new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(new URL('/ws', baseUrl).href.replace(/^http/, 'ws'));
    ws.addEventListener('open', () => resolve(ws)); ws.addEventListener('error', reject);
  })));
  try {
    const updates = windows.map(ws => new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no pet:updated within 1s')), 1000);
      ws.addEventListener('message', ({ data }) => {
        const event = JSON.parse(String(data));
        if (event.type === 'pet:updated' && event.pet.id === id) { clearTimeout(timer); resolve(event.pet); }
      });
    }));
    const request = { action: 'open-chest', revision: before.revision, reward: { id: 'gold-coin', quantity: 9999 }, player_id: other };
    const results = await Promise.all(Array.from({ length: 6 }, async () => {
      const response = await post('/api/adventure', request, id);
      expect(response.status).toBe(200); return response.json();
    }));
    for (const result of results) expect(result).toEqual(results[0]);
    const result = results[0], reward = result.chests[0].reward, pet = await getPet(id);
    for (const update of await Promise.all(updates)) expect(update).toEqual(pet);
    expect(reward.quantity).toBe(1);
    expect(pet.food + pet.soap + pet.hourglass + pet.abilities.length - 1 + Object.values<number>(pet.coins).reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(await (await sendAction(id, { action: 'open-chest' })).json()).toEqual(result);
    const moved = await (await sendAction(id, { direction: 'w' })).json();
    expect(await (await post('/api/adventure', request, id)).json()).toEqual(moved);
    const otherBefore = await (await post('/api/adventure', {}, other)).json();
    expect(await (await post('/api/adventure', request, other)).json()).toEqual(otherBefore);
    expect((await post('/api/adventure', request, null)).status).toBe(401);
    expect((await post('/api/adventure', { action: 'open-chest' }, id)).status).toBe(400);
    expect((await sendAction(id, { action: 'use-item', item: 'gold-coin' })).status).toBe(400);
    await post('/api/signout', {}, id); await signIn(id);
    expect(await getPet(id)).toEqual(pet);
    expect(await (await post('/api/adventure', {}, id)).json()).toEqual(moved);
  } finally { windows.forEach(ws => ws.close()); }
});

it('refuses exploring while the pet works a shift, keeps the map viewable, and allows it once the shift ends', async () => {
  const id = freshId(); await signUp(id);
  await must(`/api/pets/${id}/work/office`, { minutes: 240 });
  const refused = await sendAction(id, { direction: 's' });
  expect(refused.status).toBe(409);
  expect((await refused.json()).error).toMatch(/busy working at the Office/i);
  expect(await (await post('/api/adventure', {}, id)).json()).toMatchObject({ x: 2, y: 2 });
  await finish(id);
  expect(await (await sendAction(id, { direction: 's' })).json()).toMatchObject({ x: 2, y: 3 });
});
