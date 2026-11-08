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

// Asking to join from a host's home: the visitor asks, the host (team leader)
// lets them in or turns them down. Only a host getting a team together, and
// online to answer, can be asked.
it('asks to join a host who is getting a team together, and the host lets them in or turns them down', async () => {
  const host = freshId(), invited = freshId(), visitor = freshId(), other = freshId();
  for (const id of [host, invited, visitor, other]) await signUp(id);
  // Not yet getting a team together: nothing to ask to join.
  const early = await team(visitor, { action: 'ask', player: host });
  expect(early.status).toBe(409);
  expect((await early.json()).error).toMatch(/isn't getting a team together/);
  // The host starts a team by inviting someone; now the visitor can ask.
  const { team: forming } = await (await team(host, { action: 'invite', player: invited })).json();
  const asked = await team(visitor, { action: 'ask', player: host });
  expect(asked.status).toBe(200);
  const shown = (await (await team(host)).json()).team;
  expect(shown.members.map((m: any) => [m.id, m.joined, m.requested])).toEqual([[host, true, false], [invited, false, false], [visitor, false, true]]);
  // Asking twice, or for your own home, is refused.
  expect((await team(visitor, { action: 'ask', player: host })).status).toBe(409);
  expect((await team(host, { action: 'ask', player: host })).status).toBe(400);
  // Only the leader answers; the visitor can't let themselves in.
  expect((await team(visitor, { action: 'answer', player: visitor, accept: true })).status).toBe(409);
  expect((await team(host, { action: 'answer', player: visitor })).status).toBe(400);
  const letIn = await (await team(host, { action: 'answer', player: visitor, accept: true })).json();
  expect(letIn.team.members.find((m: any) => m.id === visitor)).toMatchObject({ joined: true, requested: false });
  // A second visitor is turned down: their request goes.
  expect((await team(other, { action: 'ask', player: host })).status).toBe(200);
  const declined = await (await team(host, { action: 'answer', player: other, accept: false })).json();
  expect(declined.team.members.some((m: any) => m.id === other)).toBe(false);
  expect((await team(host, { action: 'answer', player: other, accept: true })).status).toBe(404);
  expect(forming.id).toBe(letIn.team.id);
});

it("won't ask an offline host, or a full team, and the request lapses when the team sets off without it", async () => {
  const host = freshId(), mate = freshId(), visitor = freshId();
  for (const id of [host, mate, visitor]) await signUp(id);
  await team(host, { action: 'invite', player: mate });
  await team(mate, { action: 'accept', team: (await (await team(mate)).json()).invitations[0].id });
  // Offline hosts can't answer, so they can't be asked.
  const { disconnectPlayer, connectPlayer } = await import('./helpers.ts');
  await disconnectPlayer(host);
  const offline = await team(visitor, { action: 'ask', player: host });
  expect(offline.status).toBe(409);
  expect((await offline.json()).error).toMatch(/offline/);
  await connectPlayer(host);
  expect((await team(visitor, { action: 'ask', player: host })).status).toBe(200);
  // Setting off without answering: the request lapses with any invitations.
  expect((await team(host, { action: 'set-off' })).status).toBe(200);
  expect((await (await team(visitor)).json()).invitations).toEqual([]);
  expect((await team(host, { action: 'answer', player: visitor, accept: true })).status).toBe(409);
});

it("joining a team withdraws the player's requests to join others, so no leader is left with one they can't answer", async () => {
  const hostA = freshId(), hostB = freshId(), mateA = freshId(), mateB = freshId(), visitor = freshId();
  for (const id of [hostA, hostB, mateA, mateB, visitor]) await signUp(id);
  await team(hostA, { action: 'invite', player: mateA });
  const { team: b } = await (await team(hostB, { action: 'invite', player: visitor })).json();
  // The visitor asks to join A, then accepts B's invitation instead.
  expect((await team(visitor, { action: 'ask', player: hostA })).status).toBe(200);
  expect((await (await team(hostA)).json()).team.members.some((m: any) => m.id === visitor && m.requested)).toBe(true);
  expect((await team(visitor, { action: 'accept', team: b.id })).status).toBe(200);
  // A's leader no longer sees a request they could never let in.
  expect((await (await team(hostA)).json()).team.members.some((m: any) => m.id === visitor)).toBe(false);
  expect((await team(hostA, { action: 'answer', player: visitor, accept: true })).status).toBe(404);
});

it("starting your own team withdraws your requests to join others, and inviting someone who asked points to Let in", async () => {
  const hostA = freshId(), mateA = freshId(), visitor = freshId(), friend = freshId();
  for (const id of [hostA, mateA, visitor, friend]) await signUp(id);
  await team(hostA, { action: 'invite', player: mateA });
  expect((await team(visitor, { action: 'ask', player: hostA })).status).toBe(200);
  // The leader invites someone who already asked: Let in is the way.
  const already = await team(hostA, { action: 'invite', player: visitor });
  expect(already.status).toBe(409);
  expect((await already.json()).error).toBe(`${visitor} already asked to join. Let them in from your team.`);
  // The visitor starts a team of their own by inviting a friend instead.
  expect((await team(visitor, { action: 'invite', player: friend })).status).toBe(200);
  // A's leader no longer sees a request they could never let in.
  expect((await (await team(hostA)).json()).team.members.some((m: any) => m.id === visitor)).toBe(false);
});
