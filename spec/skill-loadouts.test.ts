import { expect, it } from 'vitest';
import { baseUrl, finish, freshId, getPet, getRules, post, sessionFor, signIn, signUp } from './helpers.ts';

it('saves and switches learned setups only for the owner at their own home', async () => {
  const id = freshId(), visitor = freshId();
  await signUp(id); await signUp(visitor);
  const root = `/api/pets/${id}/skill-loadouts`;
  const abilities = ['claw-strike', 'heavy-breath-slam'];
  expect((await post(`${root}/adventure/save`, { abilities }, null)).status).toBe(401);
  expect((await post(`${root}/adventure/save`, { abilities }, visitor)).status).toBe(403);
  expect((await post(`${root}/adventure/save`, { abilities })).status).toBe(409);
  expect((await post(`${root}/adventure/equip`, {}, visitor)).status).toBe(403);
  expect((await post(`${root}/adventure/equip`, {}, null)).status).toBe(401);
  expect((await post(`${root}/arena/equip`)).status).toBe(409);
  expect((await post(`${root}/invalid/save`, { abilities: ['claw-strike'] })).status).toBe(409);
  expect((await post(`/api/pets/bad%20id/skill-loadouts/arena/equip`, {}, id)).status).toBe(404);
  expect((await post(`${root}/adventure/save`, {})).status).toBe(409);
  await post(`/api/pets/${id}/work/construction`, { minutes: 15, job: 'mover' });
  await finish(id);
  expect((await post(`${root}/adventure/save`, { abilities })).status).toBe(200);
  expect((await getPet(id)).equippedAbilities).toEqual(['claw-strike']);
  expect((await post(`${root}/adventure/equip`)).status).toBe(200);
  expect((await getPet(id)).equippedAbilities).toEqual(abilities);
  await signIn(id);
  expect((await getPet(id)).skillLoadouts).toEqual({ adventure: abilities });
  expect((await getRules()).fight.skillLoadouts.map((slot: any) => slot.id)).toEqual(['adventure', 'arena', 'support']);

  const readWorld = async () => (await (await fetch(new URL('/api/world', baseUrl), {
    headers: { cookie: sessionFor(id)! },
  })).json()).players.find((player: any) => player.id === id);
  for (const place of [{ scene: 'town', home: null }, { scene: 'home', home: visitor }]) {
    const moved = await post('/api/world', { ...await readWorld(), ...place }, id);
    expect(moved.status).toBe(200);
    for (const [path, body] of [
      [`${root}/arena/save`, { abilities: ['claw-strike'] }],
      [`${root}/adventure/equip`, {}],
      [`/api/pets/${id}/equip-skills`, { abilities: ['claw-strike'] }],
    ] as const) {
      const response = await post(path, body);
      expect(response.status).toBe(409);
      expect((await response.json()).error).toContain('at home');
    }
  }
  expect((await getPet(id))).toMatchObject({ equippedAbilities: abilities, skillLoadouts: { adventure: abilities } });
  await post('/api/world', { ...await readWorld(), scene: 'home', home: id }, id);
  expect((await post(`${root}/arena/save`, { abilities: ['claw-strike'] })).status).toBe(200);
});

it('pet:updated — saving and equipping loadouts reaches two windows within 1s', async () => {
  const id = freshId();
  await signUp(id);
  await post(`/api/pets/${id}/work/construction`, { minutes: 15, job: 'mover' });
  await finish(id);
  const windows = await Promise.all([1, 2].map(() => new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(new URL('/ws', baseUrl).href.replace(/^http/, 'ws'));
    socket.addEventListener('open', () => resolve(socket), { once: true });
    socket.addEventListener('error', reject, { once: true });
  })));
  const next = (socket: WebSocket) => new Promise<any>((resolve, reject) => {
    const listener = (message: MessageEvent) => {
      const event = JSON.parse(String(message.data));
      if (event.type === 'pet:updated' && event.pet.id === id) {
        clearTimeout(timer); socket.removeEventListener('message', listener); resolve(event.pet);
      }
    };
    const timer = setTimeout(() => { socket.removeEventListener('message', listener); reject(new Error('No pet:updated within 1s')); }, 1000);
    socket.addEventListener('message', listener);
  });
  try {
    const abilities = ['claw-strike', 'heavy-breath-slam'];
    for (const action of ['save', 'equip']) {
      const updates = windows.map(next);
      const response = await post(`/api/pets/${id}/skill-loadouts/adventure/${action}`, { abilities });
      expect(response.status).toBe(200);
      const saved = await response.json();
      for (const pet of await Promise.all(updates)) expect(pet).toEqual(saved);
      expect(saved.skillLoadouts.adventure).toEqual(abilities);
      expect(saved.equippedAbilities).toEqual(action === 'save' ? ['claw-strike'] : abilities);
    }
  } finally { windows.forEach(socket => socket.close()); }
});
