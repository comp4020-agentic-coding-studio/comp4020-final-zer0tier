import { expect, it } from 'vitest';
import { baseUrl, freshId, getPet, post, sessionFor, signUp } from './helpers.ts';

// Reads the Team up window (no body) or acts in it, as the signed-in `as`.
const team = (as: string | null, body?: unknown) => body === undefined
  ? fetch(new URL('/api/team', baseUrl), { headers: as ? { cookie: sessionFor(as)! } : {} })
  : post('/api/team', body, as);

it('refuses Team up requests without a session or with a malformed player ID, action or team', async () => {
  const id = freshId(); await signUp(id);
  expect((await team(null)).status).toBe(401);
  expect((await team(null, { action: 'invite', player: id })).status).toBe(401);
  for (const player of ['', 'a b', 'x'.repeat(33), 7, ['a'], '../x']) {
    expect((await team(id, { action: 'invite', player })).status).toBe(400);
  }
  for (const body of [{}, { action: 'teleport' }, { action: 'accept' }, { action: 'leave', team: '1' }, { action: 'accept', team: 1.5 }, { action: 'accept', team: -1 }]) {
    expect((await team(id, body)).status).toBe(400);
  }
  expect((await team(id, { action: 'accept', team: 999_999_999 })).status).toBe(404);
  expect((await team(id, { action: 'invite', player: freshId() })).status).toBe(404);
  // A first visit: no team, no invitations, and a run that hasn't started.
  expect(await (await team(id)).json()).toEqual({ team: null, invitations: [], run: { team: null, state: 'new', awaitingEntry: false }, size: 4 });
});

it('two players team up, set off together, and explore one shared map with their own HP', async () => {
  const leader = freshId(), mate = freshId(); await signUp(leader); await signUp(mate);
  const { team: forming } = await (await team(leader, { action: 'invite', player: mate })).json();
  // The invitation waits for the mate, who joins it.
  expect((await (await team(mate)).json()).invitations).toMatchObject([{ id: forming.id, leader }]);
  expect(await (await team(mate, { action: 'accept', team: forming.id })).json()).toMatchObject({ team: { id: forming.id }, invitations: [] });
  // Only the leader sets off.
  expect((await team(mate, { action: 'set-off' })).status).toBe(409);
  expect((await team(leader, { action: 'set-off' })).status).toBe(200);
  for (const id of [leader, mate]) expect(await getPet(id)).toMatchObject({ stamina: 60, hygiene: 80 });
  // Each sees the other on the shared map.
  const map = async (id: string, body = {}) => (await post('/api/adventure', body, id)).json();
  const start = await map(leader);
  expect(start).toMatchObject({ x: 2, y: 2, floor: 1, started: true, team: { id: forming.id, members: [{ id: mate, x: 2, y: 2, status: 'exploring' }] } });
  const moved = await map(mate, { direction: 's', revision: (await map(mate)).revision });
  expect(moved).toMatchObject({ x: 2, y: 3, team: { members: [{ id: leader, x: 2, y: 2 }] } });
  expect((await map(leader)).team.members).toMatchObject([{ id: mate, x: 2, y: 3, hp: 25, maxHp: 25 }]);
  // Back in the Team up window, both are on their run, not forming a team.
  expect(await (await team(leader)).json()).toMatchObject({ team: null, run: { team: forming.id, state: 'exploring' } });
});
