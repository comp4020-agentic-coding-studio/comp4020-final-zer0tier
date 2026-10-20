import { expect, it } from 'vitest';
import { baseUrl, finish, freshId, getPet, must, post, signUp, signIn } from './helpers.ts';

async function sendAction(id: string, body = {}) {
  const state = await (await post('/api/adventure', {}, id)).json();
  return post('/api/adventure', { revision: state.revision, ...body }, id);
}

async function finishBattle(id: string, state: any) {
  for (let turn = 0; turn < 100 && state.battle?.playback?.status === 'active'; turn++) {
    const response = await post('/api/adventure', { action: 'battle-skill', battleId: state.battle.id,
      turnRevision: state.battle.playback.revision, ability: 'claw-strike' }, id);
    expect(response.status).toBe(200);
    state = await response.json();
  }
  expect(state.battle.playback.status).toBe('finished');
  return state;
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

it('locks the next floor until a saved monster drop and rejects forged keys or unlocks over HTTP', async () => {
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
  expect(state.exit).toEqual({ keyFound: false, unlocked: false, dropRate: 0.05 });
  // Safe walking can reach the gate, but cannot bypass it.
  for (const direction of ['w', ...Array(12).fill('d'), ...Array(12).fill('s'), 'a']) state = await act({ direction });
  expect(state).toMatchObject({ x: 13, y: 13, floor: 1, floorCount: 5 });
  const refused = await sendAction(id, { action: 'descend', keyFound: true, unlocked: true,
    exit: { keyFound: true, unlocked: true }, keyDrop: { floor: 1, name: 'Floor Key' } });
  expect(refused.status).toBe(409);
  expect((await refused.json()).error).toMatch(/locked.*5%.*Floor Key/);
  expect(await act()).toEqual(state);
  await post('/api/signout', {}, id); await signIn(id);
  expect(await act()).toEqual(state);
  expect((await sendAction(id, { action: 'ascend' })).status).toBe(409);
});

it('keeps hidden monsters and grass encounters unchanged while the map is read or refreshed', async () => {
  const id = freshId(); await signUp(id);
  const start = await (await post('/api/adventure', {}, id)).json();
  expect(start.grass).toHaveLength(16);
  expect(start.grass.some((row: string) => row.includes('g'))).toBe(true);
  expect(start.encounters).toEqual([]);
  for (const enemy of start.enemies) {
    expect(enemy.hidden).toBe(true);
    for (const key of ['x', 'y', 'route', 'leg']) expect(enemy).not.toHaveProperty(key);
  }
  for (let i = 0; i < 6; i++) expect(await (await post('/api/adventure', { action: 'patrol' }, id)).json()).toEqual(start);
  await post('/api/signout', {}, id); await signIn(id);
  expect(await (await post('/api/adventure', {}, id)).json()).toEqual(start);
});

it('walking in tall grass reveals a saved surprise battle within six grass steps, never on safe paths', async () => {
  const id = freshId(); await signUp(id);
  for (const direction of ['d', 'd']) {
    expect(await (await sendAction(id, { direction })).json()).toMatchObject({ battle: null });
  }
  let state: any;
  for (let i = 0; i < 6; i++) {
    state = await (await sendAction(id, { direction: i % 2 ? 'd' : i ? 'a' : 'd' })).json();
    expect(state.grass[state.y][state.x]).toBe('g');
    if (i < 2) expect(state.battle).toBeNull();
    if (state.battle) break;
    expect(await (await post('/api/adventure', { action: 'patrol' }, id)).json()).toEqual(state);
  }
  expect(state.battle).toMatchObject({ surprise: true, pending: true });
  expect(state.battle.enemyId).toMatch(/^f1-enemy-/);
  expect(await (await sendAction(id, { direction: 'a' })).json()).toEqual(state);
  expect((await sendAction(id, { action: 'continue', battleId: state.battle.id })).status).toBe(409);
  state = await finishBattle(id, state);
  const continued = await (await sendAction(id, { action: 'continue', battleId: state.battle.id })).json();
  expect(continued).toMatchObject({ x: state.x, y: state.y, battle: { pending: false } });
  expect(continued.enemies.some((e: { id: string }) => e.id === state.battle.enemyId)).toBe(!state.battle.won);
});

it('saves exactly one seeded grass encounter for concurrent moves and retries, including after returning to exploration', async () => {
  const id = freshId(); await signUp(id);
  const pet = await getPet(id);
  for (const direction of ['d', 'd']) await sendAction(id, { direction });
  let before: any, result: any;
  let request: Record<string, unknown> = {};
  for (let i = 0; i < 6; i++) {
    before = await (await post('/api/adventure', {}, id)).json();
    request = { direction: i % 2 ? 'd' : i ? 'a' : 'd', revision: before.revision, winner: id, strength: 9999, reward: 9999 };
    const results = await Promise.all(Array.from({ length: 6 }, async () => {
      const res = await post('/api/adventure', request, id);
      expect(res.status).toBe(200); return res.json();
    }));
    result = results[0];
    for (const duplicate of results) expect(duplicate).toEqual(result);
    if (result.battle) break;
  }
  expect(result.battle).toMatchObject({ pending: true, surprise: true });
  expect(result.enemies).toHaveLength(result.battle.won ? 3 : 4);
  expect(result.battle.playback.fighters[0]).toMatchObject({ id, maxHp: 15, maxMp: 5 });
  expect(result.battle.playback.fighters[1].id).toBe(`monster:${result.battle.enemyId}`);
  expect(await (await sendAction(id, { direction: 's' })).json()).toEqual(result);
  expect(await (await sendAction(id, { action: 'descend' })).json()).toEqual(result);
  await post('/api/signout', {}, id); await signIn(id);
  expect(await (await post('/api/adventure', {}, id)).json()).toEqual(result);
  expect((await sendAction(id, { action: 'continue', battleId: 'fake' })).status).toBe(409);
  result = await finishBattle(id, result);
  const continuation = { action: 'continue', battleId: result.battle.id, revision: result.revision };
  const continued = await (await post('/api/adventure', continuation, id)).json();
  expect(continued.battle.pending).toBe(false);
  expect(continued.battle.playback).toEqual(continued.failed ? result.battle.playback : null);
  expect(await (await post('/api/adventure', continuation, id)).json()).toEqual(continued);
  expect(await (await post('/api/adventure', request, id)).json()).toEqual(continued);
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

it('pet:updated — concurrent fresh entries reset once, charge once, and reach both windows within 1s', async () => {
  const id = freshId(); await signUp(id);
  const original = await getPet(id), before = await (await post('/api/adventure', {}, id)).json();
  const firstRequest = { action: 'enter', entryId: 'first-entry', revision: before.revision };
  const first = await (await post('/api/adventure', firstRequest, id)).json();
  expect(first).toMatchObject({ started: true, entryId: 'first-entry', x: 2, y: 2 });
  expect(await getPet(id)).toEqual(original);
  const moved = await (await sendAction(id, { direction: 'd' })).json();
  expect(await (await post('/api/adventure', firstRequest, id)).json()).toEqual(moved);
  const windows = await Promise.all([0, 1].map(() => new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(new URL('/ws', baseUrl).href.replace(/^http/, 'ws'));
    ws.addEventListener('open', () => resolve(ws)); ws.addEventListener('error', reject);
  })));
  try {
    const updates = windows.map(ws => new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no entry pet:updated within 1s')), 1000);
      ws.addEventListener('message', ({ data }) => {
        const event = JSON.parse(String(data));
        if (event.type === 'pet:updated' && event.pet.id === id) { clearTimeout(timer); resolve(event.pet); }
      });
    }));
    const request = { action: 'enter', revision: moved.revision, entryId: 'second-entry', cost: 0, hp: 9999, floor: 5 };
    const results = await Promise.all(Array.from({ length: 6 }, async () => {
      const response = await post('/api/adventure', request, id);
      expect(response.status).toBe(200); return response.json();
    }));
    for (const result of results) expect(result).toEqual(results[0]);
    const fresh = results[0], pet = await getPet(id);
    expect(fresh).toMatchObject({ entryId: 'second-entry', floor: 1, x: 2, y: 2, hp: 15, battle: null, records: [], battleCount: 0 });
    expect(pet).toMatchObject({ stamina: original.stamina - 40, hygiene: original.hygiene - 20 });
    for (const update of await Promise.all(updates)) expect(update).toEqual(pet);
    expect(await (await post('/api/adventure', request, id)).json()).toEqual(fresh);
    expect(await (await post('/api/adventure', { action: 'leave', revision: moved.revision }, id)).json()).toEqual(fresh);
    const left = await (await post('/api/adventure', { action: 'leave', revision: fresh.revision }, id)).json();
    expect(left).toMatchObject({ abandoned: true, entryId: 'second-entry' });
    expect(await (await post('/api/adventure', { action: 'leave', revision: fresh.revision }, id)).json()).toEqual(left);
  } finally { windows.forEach(ws => ws.close()); }
});

it('validates entry and departure revisions and never lets a supplied player ID reset another account', async () => {
  const id = freshId(), other = freshId(); await signUp(id); await signUp(other);
  const state = await (await post('/api/adventure', {}, id)).json();
  const otherState = await (await post('/api/adventure', {}, other)).json();
  for (const body of [
    { action: 'enter', revision: state.revision },
    { action: 'enter', entryId: 'missing-revision' },
    { action: 'enter', revision: state.revision, entryId: '' },
    { action: 'enter', revision: state.revision, entryId: 'x'.repeat(101) },
    { action: 'leave' },
  ]) expect((await post('/api/adventure', body, id)).status).toBe(400);
  const request = { action: 'enter', revision: state.revision, entryId: 'identity-entry', player_id: id };
  expect((await post('/api/adventure', request, null)).status).toBe(401);
  expect(await (await post('/api/adventure', request, other)).json()).toEqual(otherState);
  expect(await (await post('/api/adventure', {}, id)).json()).toEqual(state);
});


it('manual adventure turns require the owner’s equipped move and apply once under concurrent retries', async () => {
  const id = freshId(), other = freshId(); await signUp(id); await signUp(other);
  for (const direction of ['d', 'd']) await sendAction(id, { direction });
  let state: any;
  for (let index = 0; index < 6; index++) {
    state = await (await sendAction(id, { direction: index % 2 ? 'd' : index ? 'a' : 'd' })).json();
    if (state.battle) break;
  }
  expect(state.battle.playback).toMatchObject({ status: 'active', actor: 0 });
  expect(state.battle.playback.turns.every((turn: { actor: number }) => turn.actor === 1)).toBe(true);
  expect(state.battleCount).toBe(0);
  const request = { action: 'battle-skill', battleId: state.battle.id, turnRevision: state.battle.playback.revision, ability: 'claw-strike', damage: 9999, winner: id };
  expect((await post('/api/adventure', request, null)).status).toBe(401);
  expect((await post('/api/adventure', { ...request, player_id: id }, other)).status).toBe(409);
  expect((await post('/api/adventure', { ...request, ability: 'firebolt' }, id)).status).toBe(400);
  expect((await post('/api/adventure', { ...request, turnRevision: undefined }, id)).status).toBe(400);
  const outcomes = await Promise.all(Array.from({ length: 6 }, async () => {
    const response = await post('/api/adventure', request, id);
    expect(response.status).toBe(200); return response.json();
  }));
  for (const outcome of outcomes) expect(outcome).toEqual(outcomes[0]);
  const next = outcomes[0];
  expect(next.battle.playback.turns.filter((turn: { actor: number }) => turn.actor === 0)).toHaveLength(1);
  expect(await (await post('/api/adventure', {}, id)).json()).toEqual(next);
  await post('/api/signout', {}, id); await signIn(id);
  expect(await (await post('/api/adventure', {}, id)).json()).toEqual(next);
  const ended = await (await post('/api/adventure', { action: 'battle-forfeit', battleId: next.battle.id,
    turnRevision: next.battle.playback.revision }, id)).json();
  if (next.battle.playback.status === 'active') {
    expect(ended).toMatchObject({ abandoned: true, battle: { pending: false, won: false, playback: { status: 'finished' } } });
  } else {
    // A lucky first strike can already beat a small slime. A stale retreat
    // must preserve that completed result instead of turning it into a loss.
    expect(ended).toEqual(next);
  }
});
