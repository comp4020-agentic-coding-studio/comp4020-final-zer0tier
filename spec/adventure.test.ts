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
