import { expect, it } from 'vitest';
import { freshId, post, signUp, signIn } from './helpers.ts';

it('saves one-block adventure movement, blocks trees, and isolates player positions', async () => {
  const id = freshId(); await signUp(id);
  const read = async () => (await post('/api/adventure', {}, id)).json();
  const start = await read();
  expect(start.tiles).toHaveLength(16);
  expect(start.tiles.every((row: string) => row.length === 16)).toBe(true);
  expect(start).toMatchObject({ x: 2, y: 2 });
  expect(await (await post('/api/adventure', { direction: 'w', x: 12 }, id)).json()).toMatchObject({ x: 2, y: 1 });
  expect((await post('/api/adventure', { direction: 'w' }, id)).status).toBe(409);
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
    const response = await post('/api/adventure', body, id);
    expect(response.status).toBe(200);
    return response.json();
  };
  expect((await post('/api/adventure', { action: 'ascend' }, id)).status).toBe(409);
  expect((await post('/api/adventure', { action: 'descend' }, id)).status).toBe(409);
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
  expect(state.enemies.find((e: any) => e.kind === 'slime-king')).toMatchObject({ name: 'Slime King' });
  expect(state.down).toBeNull();
  expect((await post('/api/adventure', { action: 'descend' }, id)).status).toBe(409);
  await post('/api/signout', {}, id); await signIn(id);
  expect(await act()).toEqual(state);
  expect(await act({ action: 'ascend' })).toMatchObject({ floor: 4, x: 13, y: 13 });
});

it('saves pursuit and encounters, allows escape, and does not advance enemies on reads or rejected moves', async () => {
  const id = freshId(); await signUp(id);
  const act = async (body = {}) => (await post('/api/adventure', body, id)).json();
  await act(); await act({ direction: 'd' });
  const noticed = await act({ direction: 'd' });
  expect(noticed.enemies[0]).toMatchObject({ x: 5, y: 2, alerted: true });
  expect(noticed.encounters).toContain(noticed.enemies[0].id);
  expect(await act()).toEqual(noticed);
  expect((await post('/api/adventure', { direction: 'd' }, id)).status).toBe(409);
  expect(await act()).toEqual(noticed);
  const escaped = await act({ direction: 'a' });
  expect(escaped.enemies[0]).toMatchObject({ x: 5, y: 2, alerted: false });
  expect(escaped.encounters).toEqual([]);
  await post('/api/signout', {}, id); await signIn(id);
  expect(await act()).toEqual(escaped);
});
