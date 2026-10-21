import { expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { baseUrl, connectPlayer, disconnectPlayer, freshId, getPet, post, sessionFor, signUp } from './helpers.ts';

async function snapshot(id: string): Promise<any> {
  return (await fetch(new URL('/api/world', baseUrl), { headers: { cookie: sessionFor(id)! } })).json();
}
async function player() {
  const id = freshId(); await signUp(id); return id;
}
function next(socket: WebSocket, type: string, matches: (event: any) => boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    const listener = (data: Buffer) => {
      const event = JSON.parse(String(data));
      if (event.type !== type || !matches(event)) return;
      clearTimeout(timer); socket.off('message', listener); resolve(event);
    };
    const timer = setTimeout(() => { socket.off('message', listener); reject(new Error(`No ${type} within 1s`)); }, 1000);
    socket.on('message', listener);
  });
}
async function move(id: string, changes: Record<string, unknown>) {
  const state = (await snapshot(id)).players.find((p: any) => p.id === id);
  return post('/api/world', { ...state, ...changes }, id);
}

it('presence:updated announces authenticated arrivals and final departures to both windows within 1s', async () => {
  const owner = await player(), visitor = await player();
  const windows = [await connectPlayer(owner), await connectPlayer(visitor)];
  const newcomer = freshId();
  const arrivals = windows.map(ws => next(ws, 'presence:updated', e => e.players.includes(newcomer)));
  await signUp(newcomer);
  for (const event of await Promise.all(arrivals)) expect(event.players).toEqual(expect.arrayContaining([owner, visitor, newcomer]));
  const departures = windows.map(ws => next(ws, 'presence:updated', e => !e.players.includes(newcomer)));
  await disconnectPlayer(newcomer);
  await Promise.all(departures);
  expect((await snapshot(owner)).online).not.toContain(newcomer);
});

it('keeps another tab online, ignores forged identities, and removes revoked sessions immediately', async () => {
  const owner = await player(), viewer = await player();
  const extra = new WebSocket(new URL('/ws', baseUrl).href.replace(/^http/, 'ws'), { headers: { cookie: sessionFor(owner)! } });
  const fakeId = freshId();
  const forged = new WebSocket(new URL(`/ws?user=${fakeId}`, baseUrl).href.replace(/^http/, 'ws'));
  try {
    await Promise.all([extra, forged].map(ws => new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); })));
    await disconnectPlayer(owner);
    expect((await snapshot(viewer)).online).toContain(owner);
    expect((await snapshot(viewer)).online).not.toContain(fakeId);
    const ws = await connectPlayer(viewer);
    const gone = next(ws, 'presence:updated', e => !e.players.includes(owner));
    expect((await post('/api/signout', undefined, owner)).status).toBe(204);
    await gone;
    expect((await move(viewer, { scene: 'home', home: owner })).status).toBe(200);
  } finally { extra.terminate(); forged.terminate(); }
});

it('world:updated delivers saved visitor movement and facing to owner and another visitor within 1s', async () => {
  const owner = await player(), visitor = await player(), other = await player();
  await move(visitor, { scene: 'home', home: owner });
  await move(other, { scene: 'home', home: owner });
  const windows = [await connectPlayer(owner), await connectPlayer(other)];
  const changes = windows.map(ws => next(ws, 'world:updated', e => e.player.id === visitor && e.player.x === 520));
  const response = await move(visitor, { x: 520, y: 475, facing: 'right', moving: true });
  expect(response.status).toBe(200);
  const saved = await response.json();
  for (const event of await Promise.all(changes)) expect(event.player).toEqual(saved);
  expect((await snapshot(owner)).players.find((p: any) => p.id === visitor)).toEqual(saved);
  const stopped = windows.map(ws => next(ws, 'world:updated', e => e.player.id === visitor && !e.player.moving));
  await move(visitor, { moving: false });
  await Promise.all(stopped);
});

it('allows home visits and movement when the owner is elsewhere or offline, and isolates rooms', async () => {
  const owner = await player(), visitor = await player();
  await move(owner, { scene: 'town', home: null, x: 480, y: 585 });
  expect((await move(visitor, { scene: 'home', home: owner })).status).toBe(200);
  await disconnectPlayer(owner);
  const moved = await move(visitor, { x: 525, facing: 'right', moving: true });
  expect(moved.status).toBe(200);
  expect(await moved.json()).toMatchObject({ id: visitor, home: owner, x: 525 });
  expect((await snapshot(visitor)).online).not.toContain(owner);
  await connectPlayer(owner);
  expect((await snapshot(owner)).players.find((p: any) => p.id === owner)).toMatchObject({ scene: 'town', home: null, moving: false });
});

it('validates movement, rejects stale updates, and only moves the authenticated player', async () => {
  const owner = await player(), other = await player();
  const state = (await snapshot(owner)).players.find((p: any) => p.id === owner);
  expect((await post('/api/world', state, null)).status).toBe(401);
  for (const changes of [{ x: -1 }, { y: '475' }, { facing: 'sideways' }, { scene: 'unknown' }, { home: 'missing!id' }, { revision: -1 }, { moving: 'true' }]) {
    expect((await post('/api/world', { ...state, ...changes }, owner)).ok).toBe(false);
  }
  const saved = await (await post('/api/world', { ...state, id: other, x: 520 }, owner)).json();
  expect(saved).toMatchObject({ id: owner, x: 520, revision: state.revision + 1 });
  const stale = await post('/api/world', { ...state, x: 530 }, owner);
  expect(stale.status).toBe(409);
  expect((await stale.json()).player).toEqual(saved);
  expect((await snapshot(other)).players.find((p: any) => p.id === other).x).toBe(480);
});

it('refuses offline PvP without charging the attacker; online players can fight regardless of their room', async () => {
  const attacker = await player(), defender = await player();
  await disconnectPlayer(defender);
  const before = await getPet(attacker);
  const refused = await post(`/api/pets/${attacker}/fight/${defender}`);
  expect(refused.status).toBe(409);
  expect((await refused.json()).error).toMatch(/offline/i);
  expect(await getPet(attacker)).toEqual(before);
  await connectPlayer(defender);
  await move(defender, { scene: 'home', home: attacker });
  const started = await post(`/api/pets/${attacker}/fight/${defender}`);
  expect(started.status).toBe(200);
  const { session } = await started.json();
  expect(session.battle.status).toBe('active');
  await post(`/api/battles/${session.id}/forfeit`, { revision: session.battle.revision }, attacker);
});

it('stops saved walking on disconnect and resumes from the same saved position', async () => {
  const id = await player();
  await move(id, { x: 520, moving: true, facing: 'right' });
  await disconnectPlayer(id);
  await connectPlayer(id);
  const state = (await snapshot(id)).players.find((p: any) => p.id === id);
  expect(state).toMatchObject({ x: 520, y: 475, moving: false, facing: 'right' });
});
